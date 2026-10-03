"""Planning intelligent — apprentissage des groupes et des rotations (V3, lot 2).

LE POINTAGE RÉEL EST UN FAIT. Ce moteur OBSERVE les feuilles clôturées et PROPOSE : il n'écrit
ni dans `attendance_events`, ni dans les feuilles, ni dans les affectations RH. Il est
déterministe (statistiques simples, aucun LLM, aucun aléa) : mêmes feuilles ⇒ même modèle.

Principe
- Une feuille CLOSED / ARCHIVED = UNE observation (`rotation_sheet_observations`, clé = feuille).
  Un salarié = une ligne par feuille : plusieurs pointages ne pèsent jamais plus d'une fois.
  Une feuille OPEN n'est jamais apprise.
- Chaque feuille est rattachée UNE fois au groupe détecté dont le noyau (salariés présents dans
  au moins `core_share` de ses feuilles) lui ressemble le plus (indice de Dice ≥
  `link_threshold`), sinon elle ouvre un groupe candidat. Le rattachement est conservé :
  c'est l'interprétation du moteur, distincte de l'observation brute (les lignes de la feuille).
- Appartenance d'un salarié = statistiques sur ses observations de la fenêtre glissante :
  confiance = évidence × (w_share·part + w_time·horaires + w_recency·récence).
- Cycle = plus petite période p telle que groupe(créneau i) = groupe(créneau i+p) pour au moins
  `cycle_threshold` des comparaisons.
- État du site (LEARNING / STABLE / REVIEW_REQUIRED) = conditions MESURÉES, jamais un délai.

Le modèle est mis à jour à la CLÔTURE d'une feuille (pas à chaque pointage), sous verrou de la
ligne `rotation_site_models` du site : deux workers ne doublent ni observation ni version.
Lot 2 n'émet aucune alerte et ne projette pas le planning (lots 3 et 4).
Voir docs/attendance-rotation-learning.md.
"""
from __future__ import annotations

import hashlib
import json
import logging
from bisect import insort
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.config import settings
from app.modules.attendance.models import (
    MEMBER_CONFIRMED,
    MEMBER_LEARNING,
    MEMBER_OVERRIDDEN,
    MEMBER_PROBABLE,
    MODE_ACTIVE,
    MODE_LEARNING,
    MODE_OFF,
    SHEET_ARCHIVED,
    SHEET_CLOSED,
    SITE_LEARNING,
    SITE_REVIEW,
    SITE_STABLE,
    AttendanceSheet,
    AttendanceSheetLine,
    RotationGroup,
    RotationMembership,
    RotationMembershipHistory,
    RotationModelVersion,
    RotationSetting,
    RotationSheetObservation,
    RotationSiteModel,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site

logger = logging.getLogger(__name__)

ENGINE_VERSION = "rot-learn-1"
SOURCE_LEARNED = "LEARNED"
SOURCE_REBUILD = "REBUILD"
GROUP_LEARNING = "LEARNING"          # groupe candidat : pas encore assez de feuilles
GROUP_ESTABLISHED = "STABLE"         # groupe consolidé (≥ min_group_sheets feuilles)
EMPTY_SLOT = "∅"                     # créneau sans présence (repos) dans un cycle
MAX_PENDING_PER_PASS = 500

# Paramètres : (type, minimum, maximum). Valeurs initiales dans app/core/config.py
# (`rotation_learning_<clé>`), surchargées site par site dans `rotation_site_models.params`.
PARAMS: dict[str, tuple[type, float, float]] = {
    "window_sheets": (int, 4, 2000),
    "link_threshold": (float, 0.05, 1.0),
    "core_share": (float, 0.05, 1.0),
    "min_group_sheets": (int, 1, 500),
    "min_observations": (int, 1, 500),
    "probable_threshold": (float, 0.05, 1.0),
    "recent_observations": (int, 1, 100),
    "arrival_tolerance_minutes": (int, 0, 720),
    "weight_share": (float, 0.0, 1.0),
    "weight_time": (float, 0.0, 1.0),
    "weight_recency": (float, 0.0, 1.0),
    "min_site_sheets": (int, 1, 2000),
    "stable_member_ratio": (float, 0.05, 1.0),
    "stable_sheet_ratio": (float, 0.05, 1.0),
    "cycle_threshold": (float, 0.5, 1.0),
    "min_cycle_comparisons": (int, 1, 2000),
    "max_cycle_slots": (int, 1, 1000),
}


# ── Paramètres ───────────────────────────────────────────────────────────────────────────
def default_params() -> dict[str, Any]:
    return {key: kind(getattr(settings, f"rotation_learning_{key}")) for key, (kind, _lo, _hi) in PARAMS.items()}


def validate_params(overrides: dict[str, Any] | None) -> dict[str, Any]:
    """Surcharges d'un site : clés connues, bornes respectées, pondérations non toutes nulles."""
    clean: dict[str, Any] = {}
    for key, value in (overrides or {}).items():
        if key not in PARAMS:
            raise ValueError(f"Paramètre d'apprentissage inconnu : {key}")
        kind, low, high = PARAMS[key]
        try:
            number = kind(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Valeur invalide pour {key}") from exc
        if isinstance(value, bool) or not low <= number <= high:
            raise ValueError(f"{key} doit être compris entre {low} et {high}")
        clean[key] = number
    merged = {**default_params(), **clean}
    if merged["weight_share"] + merged["weight_time"] + merged["weight_recency"] <= 0:
        raise ValueError("Au moins une pondération de confiance doit être positive")
    return clean


def effective_params(model: RotationSiteModel | None) -> dict[str, Any]:
    params = default_params()
    for key, value in ((model.params if model is not None else None) or {}).items():
        if key in PARAMS:
            params[key] = PARAMS[key][0](value)
    return params


def is_learning(model: RotationSiteModel | None) -> bool:
    """L'apprentissage exige le drapeau global ET un mode posé explicitement sur le site."""
    return bool(settings.rotation_learning_enabled and model is not None and model.mode in (MODE_LEARNING, MODE_ACTIVE))


def model_for(db: Session, site_id: int, *, lock: bool = False) -> RotationSiteModel | None:
    query = select(RotationSiteModel).where(RotationSiteModel.site_id == site_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return db.execute(query).scalar_one_or_none()


# ── Observations (une feuille clôturée = une observation) ────────────────────────────────
@dataclass(order=True)
class Obs:
    window_start: datetime
    sheet_id: int = field(compare=True)
    window_end: datetime = field(compare=False, default=None)  # type: ignore[assignment]
    local_date: date = field(compare=False, default=None)      # type: ignore[assignment]
    label: str | None = field(compare=False, default=None)
    members: dict[int, tuple[datetime, datetime | None]] = field(compare=False, default_factory=dict)
    declared: dict[int, str | None] = field(compare=False, default_factory=dict)


def _chunks(values: list[int], size: int = 500):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def _fill_members(db: Session, observations: list[Obs]) -> None:
    """Présences d'une feuille = lignes ayant une ENTRÉE (une ligne par salarié : un salarié
    compte une fois quel que soit son nombre de pointages). Une sortie sans entrée dans la
    feuille n'établit pas une prise de poste : elle n'est pas comptée."""
    by_id = {obs.sheet_id: obs for obs in observations}
    for ids in _chunks(sorted(by_id)):
        rows = db.execute(
            select(AttendanceSheetLine.sheet_id, AttendanceSheetLine.employee_id, AttendanceSheetLine.first_entry_at,
                   AttendanceSheetLine.last_exit_at, AttendanceSheetLine.declared_group)
            .where(AttendanceSheetLine.sheet_id.in_(ids), AttendanceSheetLine.first_entry_at.is_not(None))
        ).all()
        for sheet_id, employee_id, entry, leave, declared in rows:
            by_id[sheet_id].members[employee_id] = (entry, leave)
            by_id[sheet_id].declared[employee_id] = declared


def _from_sheet(sheet: AttendanceSheet, label: str | None = None) -> Obs:
    return Obs(window_start=sheet.window_start, sheet_id=sheet.id, window_end=sheet.window_end,
               local_date=sheet.local_date, label=label)


def _load_observations(db: Session, site_id: int, limit: int | None) -> list[Obs]:
    query = (select(RotationSheetObservation.group_label, AttendanceSheet)
             .join(AttendanceSheet, AttendanceSheet.id == RotationSheetObservation.sheet_id)
             .where(RotationSheetObservation.site_id == site_id)
             .order_by(AttendanceSheet.window_start.desc(), AttendanceSheet.id.desc()))
    if limit is not None:
        query = query.limit(limit)
    observations = sorted(_from_sheet(sheet, label) for label, sheet in db.execute(query).all())
    _fill_members(db, observations)
    return observations


def _pending_sheets(db: Session, site_id: int, date_from: date | None = None, date_to: date | None = None) -> list[AttendanceSheet]:
    done = select(RotationSheetObservation.sheet_id).where(RotationSheetObservation.site_id == site_id)
    query = (select(AttendanceSheet)
             .where(AttendanceSheet.site_id == site_id, AttendanceSheet.status.in_((SHEET_CLOSED, SHEET_ARCHIVED)),
                    AttendanceSheet.id.not_in(done))
             .order_by(AttendanceSheet.window_start, AttendanceSheet.id).limit(MAX_PENDING_PER_PASS))
    if date_from:
        query = query.where(AttendanceSheet.local_date >= date_from)
    if date_to:
        query = query.where(AttendanceSheet.local_date <= date_to)
    return list(db.execute(query).scalars().all())


# ── Rattachement feuille → groupe (fonctions pures) ──────────────────────────────────────
def group_cores(prior: list[Obs], params: dict[str, Any]) -> dict[str, set[int]]:
    """Noyau de chaque groupe : salariés présents dans au moins `core_share` de ses feuilles
    (fenêtre glissante). Un passage ponctuel n'entre donc pas dans le noyau."""
    sheets_by_label: dict[str, list[Obs]] = {}
    for obs in [o for o in prior if o.members][-params["window_sheets"]:]:
        if obs.label:
            sheets_by_label.setdefault(obs.label, []).append(obs)
    cores: dict[str, set[int]] = {}
    for label, sheets in sheets_by_label.items():
        counts = Counter(employee for obs in sheets for employee in obs.members)
        cores[label] = {employee for employee, count in counts.items() if count / len(sheets) >= params["core_share"]}
    return cores


def dice(left: set[int], right: set[int]) -> float:
    return 2 * len(left & right) / (len(left) + len(right)) if left and right else 0.0


def _new_label(obs: Obs, used: set[str]) -> tuple[str, str]:
    """Nom d'un nouveau groupe détecté : le groupe DÉCLARÉ strictement majoritaire parmi les
    présents s'il est libre (pour que déclaré et appris se comparent), sinon G<n>. Ce n'est
    qu'un NOM : l'appartenance apprise ne dépend jamais du groupe déclaré."""
    declared = Counter(group for group in obs.declared.values() if group)
    if declared:
        name, count = min(declared.items(), key=lambda item: (-item[1], item[0]))
        if count * 2 > len(obs.members) and name not in used:
            return name[:12], "declared_majority"
    number = len(used) + 1
    while f"G{number}" in used:
        number += 1
    return f"G{number}", "sequence"


def assign_group(prior: list[Obs], obs: Obs, used: set[str], params: dict[str, Any]) -> dict[str, Any]:
    """Interprétation d'une feuille : groupe existant le plus ressemblant, sinon groupe candidat."""
    if not obs.members:
        return {"label": None, "score": None, "created": False}
    present = set(obs.members)
    best: tuple[float, int, str] | None = None
    for label, core in sorted(group_cores(prior, params).items()):
        score = dice(present, core)
        candidate = (score, len(present & core), label)
        if best is None or (candidate[0], candidate[1]) > (best[0], best[1]):
            best = candidate
    if best is not None and best[0] >= params["link_threshold"]:
        return {"label": best[2], "score": round(best[0], 4), "created": False}
    label, source = _new_label(obs, used)
    return {"label": label, "score": round(best[0], 4) if best else None, "created": True, "label_source": source}


# ── Calcul du modèle (fonctions pures sur les observations de la fenêtre) ────────────────
def _local_hhmm(value: datetime) -> str:
    from app.modules.attendance import core
    return core.to_local(value).strftime("%H:%M")


def compute_memberships(window: list[Obs], group_sheets: dict[str, int], params: dict[str, Any]) -> dict[int, dict[str, Any]]:
    """Par salarié : observations, groupe en tête, composantes et score de confiance.

    confiance = évidence × (w_share·part + w_time·horaires + w_recency·récence) / (somme des w)
      part     = observations avec le groupe en tête / observations
      horaires = observations où la première entrée est à ± `arrival_tolerance_minutes` du
                 début de la rotation / observations
      récence  = part du groupe en tête dans les `recent_observations` dernières observations
      évidence = min(1, observations / `min_observations`) — une seule rotation ne vaut jamais 100 %.
    """
    per_employee: dict[int, list[Obs]] = {}
    for obs in window:
        for employee in obs.members:
            per_employee.setdefault(employee, []).append(obs)
    weights = (params["weight_share"], params["weight_time"], params["weight_recency"])
    tolerance = params["arrival_tolerance_minutes"] * 60
    out: dict[int, dict[str, Any]] = {}
    for employee, seen in per_employee.items():
        counts = Counter(obs.label for obs in seen if obs.label)
        last_index = {obs.label: index for index, obs in enumerate(seen) if obs.label}
        lead = max(counts, key=lambda label: (counts[label], last_index[label], label))
        total, with_group = len(seen), counts[lead]
        on_time = sum(1 for obs in seen if abs((obs.members[employee][0] - obs.window_start).total_seconds()) <= tolerance)
        recent = seen[-params["recent_observations"]:]
        recent_with = sum(1 for obs in recent if obs.label == lead)
        share, time_share, recency = with_group / total, on_time / total, recent_with / len(recent)
        evidence = min(1.0, total / params["min_observations"])
        base = (weights[0] * share + weights[1] * time_share + weights[2] * recency) / sum(weights)
        confidence = round(evidence * base, 4)
        probable = (total >= params["min_observations"] and confidence >= params["probable_threshold"]
                    and group_sheets.get(lead, 0) >= params["min_group_sheets"])
        out[employee] = {
            "candidate": lead, "probable": probable, "confidence": confidence,
            "observations": total, "with_group": with_group,
            "first_observed_at": seen[0].window_start, "last_observed_at": seen[-1].window_start,
            "explanation": {
                "candidate": lead, "observations": total, "with_group": with_group, "time_consistent": on_time,
                "recent": {"observations": len(recent), "with_group": recent_with},
                "by_group": dict(sorted(counts.items())),
                "components": {"share": round(share, 4), "time": round(time_share, 4), "recency": round(recency, 4),
                               "evidence": round(evidence, 4)},
                "group_consolidated": group_sheets.get(lead, 0) >= params["min_group_sheets"],
                "tracked": total >= params["min_observations"],
            },
        }
    return out


def compute_groups(window: list[Obs], memberships: dict[int, dict[str, Any]], params: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Par groupe détecté : feuilles, créneau habituel (GROUPE ≠ CRÉNEAU), variations, membres."""
    by_label: dict[str, list[Obs]] = {}
    for obs in window:
        if obs.label and obs.members:
            by_label.setdefault(obs.label, []).append(obs)
    cores = group_cores(window, params)
    out: dict[str, dict[str, Any]] = {}
    for label, sheets in sorted(by_label.items()):
        slots = Counter((_local_hhmm(obs.window_start), _local_hhmm(obs.window_end)) for obs in sheets)
        (start, end), usual = min(slots.items(), key=lambda item: (-item[1], item[0]))
        offsets = [(entry - obs.window_start).total_seconds() / 60 for obs in sheets for entry, _leave in obs.members.values()]
        stays = [(leave - entry).total_seconds() / 60 for obs in sheets for entry, leave in obs.members.values() if leave]
        members = {emp: data for emp, data in memberships.items() if data["candidate"] == label}
        tracked = [data["confidence"] for data in members.values() if data["explanation"]["tracked"]]
        out[label] = {
            "sheets_count": len(sheets),
            "status": GROUP_ESTABLISHED if len(sheets) >= params["min_group_sheets"] else GROUP_LEARNING,
            "usual_start": start, "usual_end": end, "usual_share": round(usual / len(sheets), 4),
            "confidence": round(sum(tracked) / len(tracked), 4) if tracked else None,
            "last_observed_at": sheets[-1].window_start,
            "members_probable": sorted(emp for emp, data in members.items() if data["probable"]),
            "members_learning": sorted(emp for emp, data in members.items() if not data["probable"]),
            "explanation": {
                "slots": {f"{s} – {e}": count for (s, e), count in sorted(slots.items())},
                "shift_minutes": int((sheets[-1].window_end - sheets[-1].window_start).total_seconds() // 60),
                "median_arrival_offset_minutes": round(median(offsets), 1) if offsets else None,
                "median_presence_minutes": round(median(stays), 1) if stays else None,
                "mean_present": round(sum(len(obs.members) for obs in sheets) / len(sheets), 2),
                "core": sorted(cores.get(label, set())),
            },
        }
    return out


def compute_cycle(window: list[Obs], params: dict[str, Any]) -> dict[str, Any]:
    """Succession des groupes sur les créneaux consécutifs. Un créneau sans présence compte
    (repos). Le cycle n'est retenu que si les données le démontrent : plus petite période p
    testable dont la concordance atteint `cycle_threshold`."""
    if not window:
        return {"found": False, "status": "pending", "slots": 0}
    duration = window[-1].window_end - window[-1].window_start
    run: list[Obs] = []
    for obs in reversed(window):                      # même durée de rotation que la dernière feuille
        if obs.window_end - obs.window_start != duration or (obs.window_start - window[-1].window_start) % duration:
            break
        run.append(obs)
    run.reverse()
    max_slots = 4 * params["window_sheets"]
    while run and (run[-1].window_start - run[0].window_start) // duration + 1 > max_slots:
        run.pop(0)
    anchor = run[0].window_start
    sequence = [EMPTY_SLOT] * ((run[-1].window_start - anchor) // duration + 1)
    for obs in run:
        sequence[(obs.window_start - anchor) // duration] = obs.label if obs.label and obs.members else EMPTY_SLOT
    size = len(sequence)
    base = {"slots": size, "anchor": anchor.isoformat(), "shift_minutes": int(duration.total_seconds() // 60)}
    if all(label == EMPTY_SLOT for label in sequence):
        return {"found": False, "status": "pending", **base}
    best: dict[str, Any] | None = None
    highest = min(params["max_cycle_slots"], size // 2)
    tested = 0
    for period in range(1, highest + 1):
        comparisons = size - period
        if comparisons < max(params["min_cycle_comparisons"], period):
            break
        tested = period
        matches = sum(1 for index in range(comparisons) if sequence[index] == sequence[index + period])
        concordance = round(matches / comparisons, 4)
        if best is None or concordance > best["concordance"]:
            best = {"period": period, "concordance": concordance, "comparisons": comparisons}
        if concordance >= params["cycle_threshold"]:
            pattern = []
            for phase in range(period):
                votes = Counter(sequence[phase::period])
                pattern.append(min(votes.items(), key=lambda item: (-item[1], item[0]))[0])
            return {"found": True, "status": "ok", "period": period, "pattern": pattern, "concordance": concordance,
                    "comparisons": comparisons, **base}
    # Contradictoire seulement quand tout ce qui est testable l'a été : fenêtre pleine ou
    # période maximale atteinte. Avant, un cycle plus long reste possible ⇒ « en attente ».
    exhausted = tested >= params["max_cycle_slots"] or len([o for o in window if o.members]) >= params["window_sheets"]
    return {"found": False, "status": "failed" if exhausted and tested else "pending", "best": best, "tested_up_to": tested, **base}


def evaluate_site(*, sheets: int, groups: dict[str, dict[str, Any]], memberships: dict[int, dict[str, Any]],
                  cycle: dict[str, Any], expected_groups: int | None, covered: int, params: dict[str, Any]) -> tuple[str, list[dict[str, Any]], float | None]:
    """État du site à partir de conditions MESURÉES (jamais un nombre de jours calendaires).

    STABLE = toutes les conditions remplies ; REVIEW_REQUIRED = au moins une condition
    contredite par les observations ; LEARNING sinon (données encore insuffisantes)."""
    enough = sheets >= params["min_site_sheets"]
    established = [label for label, data in groups.items() if data["status"] == GROUP_ESTABLISHED]
    tracked = [data for data in memberships.values() if data["explanation"]["tracked"]]
    probable = [data for data in tracked if data["probable"]]
    mean = round(sum(data["confidence"] for data in tracked) / len(tracked), 4) if tracked else None

    def verdict(ok: bool, *, pending: bool = False) -> str:
        if ok:
            return "ok"
        return "pending" if pending or not enough else "failed"

    coverage = round(covered / sheets, 4) if sheets else 0.0
    member_ratio = round(len(probable) / len(tracked), 4) if tracked else 0.0
    conditions = [
        {"key": "sheets", "label": "Rotations observées", "value": sheets, "required": params["min_site_sheets"],
         "status": "ok" if enough else "pending"},
        {"key": "groups", "label": "Groupes consolidés (attendu : paramètres du site)", "value": len(established),
         "required": expected_groups,
         "status": verdict(bool(established) and (expected_groups is None or len(established) == expected_groups),
                           pending=not established)},
        {"key": "coverage", "label": "Feuilles rattachées à un groupe consolidé", "value": coverage,
         "required": params["stable_sheet_ratio"], "status": verdict(coverage >= params["stable_sheet_ratio"])},
        {"key": "members", "label": "Salariés suivis dont le groupe est probable", "value": member_ratio,
         "required": params["stable_member_ratio"], "tracked": len(tracked),
         "status": verdict(bool(tracked) and member_ratio >= params["stable_member_ratio"], pending=not tracked)},
        {"key": "confidence", "label": "Confiance moyenne des salariés suivis", "value": mean,
         "required": params["probable_threshold"],
         "status": verdict(mean is not None and mean >= params["probable_threshold"], pending=mean is None)},
        {"key": "cycle", "label": "Cycle de succession démontré", "value": cycle.get("concordance") or (cycle.get("best") or {}).get("concordance"),
         "required": params["cycle_threshold"],
         "status": "ok" if cycle.get("found") else ("failed" if enough and cycle.get("status") == "failed" else "pending")},
    ]
    statuses = {condition["status"] for condition in conditions}
    state = SITE_STABLE if statuses == {"ok"} else SITE_REVIEW if "failed" in statuses else SITE_LEARNING
    return state, conditions, mean


def _fingerprint(state: str, groups: dict[str, dict[str, Any]], cycle: dict[str, Any], members: dict[int, tuple[str | None, str]]) -> str:
    """Empreinte de ce qui constitue le MODÈLE (état, groupes, cycle, appartenances). Compteurs,
    scores bruts et créneau habituel (qui tourne légitimement d'un cycle à l'autre) n'en font
    pas partie : une version = un changement réel ; chaque version photographie le reste."""
    payload = {
        "state": state,
        "groups": [[label, data["status"]] for label, data in sorted(groups.items())],
        "cycle": [cycle.get("period"), cycle.get("pattern")] if cycle.get("found") else None,
        "members": [[employee, group, status] for employee, (group, status) in sorted(members.items())],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


# ── Persistance ──────────────────────────────────────────────────────────────────────────
def _declared_groups(db: Session, site_id: int, employees: list[int]) -> dict[int, str | None]:
    """Groupe DÉCLARÉ = affectation active du salarié sur le site (lecture seule)."""
    out: dict[int, str | None] = {}
    for ids in _chunks(employees):
        rows = db.execute(select(Assignment.employee_id, Assignment.group_code)
                          .where(Assignment.site_id == site_id, Assignment.employee_id.in_(ids), Assignment.active == 1)
                          .order_by(Assignment.start_date, Assignment.id)).all()
        for employee_id, group in rows:
            out[employee_id] = (group or None) and str(group)[:12]
    return out


def _status_of(probable: bool, candidate: str | None, confirmed: str | None) -> tuple[str | None, str]:
    """(groupe appris, statut). Le groupe CONFIRMÉ (décision humaine) n'est jamais modifié ici :
    CONFIRMED tant que le moteur ne le contredit pas, OVERRIDDEN quand il apprend autre chose."""
    learned = candidate if probable else None
    if confirmed:
        return learned, MEMBER_OVERRIDDEN if learned and learned != confirmed else MEMBER_CONFIRMED
    return learned, MEMBER_PROBABLE if probable else MEMBER_LEARNING


def _recompute(db: Session, model: RotationSiteModel, observations: list[Obs], *, source: str,
               source_sheet_id: int | None, actor: str | None, now: datetime,
               created: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    params = effective_params(model)
    site_id = model.site_id
    window = observations[-params["window_sheets"]:]
    filled = [obs for obs in window if obs.members]
    group_sheets = Counter(obs.label for obs in filled if obs.label)
    memberships = compute_memberships(filled, group_sheets, params)
    groups = compute_groups(window, memberships, params)
    cycle = compute_cycle(window, params)
    setting = db.execute(select(RotationSetting).where(RotationSetting.site_id == site_id)).scalar_one_or_none()
    covered = sum(1 for obs in filled if groups.get(obs.label, {}).get("status") == GROUP_ESTABLISHED)
    state, conditions, mean = evaluate_site(
        sheets=len(filled), groups=groups, memberships=memberships, cycle=cycle,
        expected_groups=setting.groups_count if setting is not None else None, covered=covered, params=params)

    # Appartenances : déclaré / appris / confirmé conservés séparément.
    rows = {row.employee_id: row for row in db.execute(select(RotationMembership).where(RotationMembership.site_id == site_id)).scalars().all()}
    declared = _declared_groups(db, site_id, sorted(set(memberships) | set(rows)))
    final: dict[int, tuple[str | None, str]] = {}
    changes: list[dict[str, Any]] = []
    pending_history: list[RotationMembershipHistory] = []
    touched: list[RotationMembership] = []
    for employee in sorted(set(memberships) | set(rows)):
        data = memberships.get(employee)
        row = rows.get(employee)
        if row is None:
            row = RotationMembership(site_id=site_id, employee_id=employee, status=MEMBER_LEARNING, source=SOURCE_LEARNED,
                                     confidence=0, observations=0, with_group=0, model_version=0, updated_at=now)
            db.add(row)
            old = (None, None, None)
        else:
            old = (row.learned_group, row.status, row.confidence)
        learned, status = _status_of(bool(data and data["probable"]), data["candidate"] if data else None, row.confirmed_group)
        confidence = data["confidence"] if data else 0.0
        if employee in declared or row.declared_group is None:
            row.declared_group = declared.get(employee)
        row.learned_group, row.status, row.confidence = learned, status, confidence
        row.observations = data["observations"] if data else 0
        row.with_group = data["with_group"] if data else 0
        row.first_observed_at = data["first_observed_at"] if data else row.first_observed_at
        row.last_observed_at = data["last_observed_at"] if data else row.last_observed_at
        row.explanation = data["explanation"] if data else {"observations": 0, "out_of_window": True}
        row.source = source
        row.updated_at = now
        final[employee] = (learned, status)
        touched.append(row)
        if (old[0], old[1]) != (learned, status):
            changes.append({"employee_id": employee, "old_group": old[0], "new_group": learned, "old_status": old[1],
                            "new_status": status, "old_confidence": old[2], "new_confidence": confidence})
            pending_history.append(RotationMembershipHistory(
                site_id=site_id, employee_id=employee, old_group=old[0], new_group=learned, old_status=old[1],
                new_status=status, old_confidence=old[2], new_confidence=confidence, source=source,
                source_sheet_id=source_sheet_id, actor=actor, engine_version=ENGINE_VERSION, changed_at=now))

    fingerprint = _fingerprint(state, groups, cycle, final)
    changed = fingerprint != model.fingerprint
    previous_state = model.state if model.fingerprint else None
    version = int(model.model_version or 0) + (1 if changed else 0)
    for history in pending_history:
        history.model_version = version
        db.add(history)
    if changed:
        for row in touched:
            row.model_version = version

    # Groupes détectés (un seul par (site, nom) — contrainte unique).
    used_labels = {label for label in db.execute(select(RotationSheetObservation.group_label)
                   .where(RotationSheetObservation.site_id == site_id, RotationSheetObservation.group_label.is_not(None)).distinct()).scalars().all()}
    group_rows = {row.label: row for row in db.execute(select(RotationGroup).where(RotationGroup.site_id == site_id)).scalars().all()}
    for label, row in list(group_rows.items()):
        if label not in used_labels:                       # plus aucune observation (reconstruction)
            db.delete(row)
            group_rows.pop(label)
    for label in sorted(used_labels):
        data = groups.get(label)
        row = group_rows.get(label)
        if row is None:
            row = RotationGroup(site_id=site_id, label=label, explanation={})
            db.add(row)
        kept = {**(created or {}).get(label, {}),
                **{key: value for key, value in (row.explanation or {}).items() if key in ("label_source", "created_from_sheet")}}
        if data is None:                                    # hors fenêtre : conservé, sans membres
            row.sheets_count, row.members_probable, row.members_learning = 0, 0, 0
            row.status, row.confidence = GROUP_LEARNING, None
            row.explanation = {**kept, "out_of_window": True}
        else:
            row.sheets_count, row.status = data["sheets_count"], data["status"]
            row.members_probable, row.members_learning = len(data["members_probable"]), len(data["members_learning"])
            row.usual_start, row.usual_end, row.usual_share = data["usual_start"], data["usual_end"], data["usual_share"]
            row.confidence, row.last_observed_at = data["confidence"], data["last_observed_at"]
            row.explanation = {**kept, **data["explanation"]}
        row.model_version = version
        row.updated_at = now

    old_summary = {"state": model.state, "model_version": model.model_version, "groups_detected": model.groups_detected,
                   "sheets_observed": model.sheets_observed}
    established = sum(1 for data in groups.values() if data["status"] == GROUP_ESTABLISHED)
    model.state, model.reasons, model.cycle = state, conditions, cycle
    model.sheets_observed, model.days_observed = len(filled), len({obs.local_date for obs in filled})
    model.groups_detected, model.mean_confidence = established, mean
    model.engine_version, model.computed_at = ENGINE_VERSION, now
    if changed:
        model.model_version, model.fingerprint = version, fingerprint
        db.add(RotationModelVersion(
            site_id=site_id, version=version, effective_at=now, state=state, previous_state=previous_state, params=params,
            groups=[{"label": label, "status": data["status"], "sheets_count": data["sheets_count"],
                     "usual_start": data["usual_start"], "usual_end": data["usual_end"], "usual_share": data["usual_share"],
                     "confidence": data["confidence"], "members_probable": data["members_probable"],
                     "members_learning": data["members_learning"]} for label, data in sorted(groups.items())],
            cycle=cycle, reasons=conditions, sheets_observed=len(filled), mean_confidence=mean, fingerprint=fingerprint,
            engine_version=ENGINE_VERSION, source=source, source_sheet_id=source_sheet_id, actor=actor))
        site = db.get(Site, site_id)
        from app.modules.ops.routes import _site_society
        append_audit(db, action="attendance.rotation_learning.model", resource="rotation_site_model", resource_id=site_id,
                     result="success", society=_site_society(site) if site else None, old_state=old_summary,
                     new_state={"state": state, "model_version": version, "groups_detected": established,
                                "sheets_observed": len(filled), "source": source, "source_sheet_id": source_sheet_id,
                                "engine_version": ENGINE_VERSION, "actor": actor, "membership_changes": len(changes)})
    db.flush()
    return {"site_id": site_id, "state": state, "model_version": version, "changed": changed, "sheets_observed": len(filled),
            "groups_detected": established, "mean_confidence": mean, "membership_changes": changes, "fingerprint": fingerprint}


def _labels_before(db: Session, site_id: int, moment: datetime) -> set[str]:
    """Noms de groupes déjà portés par une observation ANTÉRIEURE (un nom n'est jamais réattribué
    à un autre groupe ; rejouer une période redonne donc les mêmes noms)."""
    return set(db.execute(
        select(RotationSheetObservation.group_label).distinct()
        .join(AttendanceSheet, AttendanceSheet.id == RotationSheetObservation.sheet_id)
        .where(RotationSheetObservation.site_id == site_id, RotationSheetObservation.group_label.is_not(None),
               AttendanceSheet.window_start < moment)).scalars().all())


def _ingest(db: Session, model: RotationSiteModel, observations: list[Obs], sheets: list[AttendanceSheet], now: datetime,
            created: dict[str, dict[str, Any]]) -> int | None:
    """Rattache chaque feuille (dans l'ordre chronologique) et enregistre SON observation.
    `created` reçoit l'origine du nom de chaque groupe ouvert pendant ce passage."""
    params = effective_params(model)
    fresh = [_from_sheet(sheet) for sheet in sheets]
    _fill_members(db, fresh)
    last: int | None = None
    for obs in sorted(fresh):
        prior = [other for other in observations if other.window_start < obs.window_start]
        result = assign_group(prior, obs, set(), params)
        if result["created"]:                              # rare : le nom dépend de tout l'historique antérieur
            result = assign_group(prior, obs, _labels_before(db, model.site_id, obs.window_start), params)
            created[result["label"]] = {"label_source": result["label_source"], "created_from_sheet": obs.sheet_id}
        obs.label = result["label"]
        db.add(RotationSheetObservation(sheet_id=obs.sheet_id, site_id=model.site_id, members_count=len(obs.members),
                                        group_label=obs.label, engine_version=ENGINE_VERSION, processed_at=now))
        db.flush()
        insort(observations, obs)
        last = obs.sheet_id
    return last


def learn_site(db: Session, site_id: int, *, now: datetime | None = None) -> dict[str, Any] | None:
    """Apprentissage incrémental : intègre les feuilles clôturées non encore observées du site,
    puis met le modèle à jour. Idempotent ; sérialisé par site (verrou de ligne)."""
    model = model_for(db, site_id, lock=True)
    if not is_learning(model):
        return None
    pending = _pending_sheets(db, site_id)
    if not pending:
        return None
    now = now or datetime.utcnow()
    observations = _load_observations(db, site_id, effective_params(model)["window_sheets"])
    created: dict[str, dict[str, Any]] = {}
    last = _ingest(db, model, observations, pending, now, created)
    return _recompute(db, model, observations, source=SOURCE_LEARNED, source_sheet_id=last, actor=None, now=now, created=created)


def learn_pending(db: Session, site_ids: set[int] | list[int] | None = None, *, now: datetime | None = None) -> int:
    """Sites en apprentissage ayant des feuilles clôturées à intégrer. Une seule requête quand
    il n'y a rien à faire ; jamais bloquant pour l'appelant (point de sauvegarde par site)."""
    if not settings.rotation_learning_enabled:
        return 0
    done = select(RotationSheetObservation.sheet_id)
    query = (select(AttendanceSheet.site_id).distinct()
             .join(RotationSiteModel, RotationSiteModel.site_id == AttendanceSheet.site_id)
             .where(RotationSiteModel.mode.in_((MODE_LEARNING, MODE_ACTIVE)),
                    AttendanceSheet.status.in_((SHEET_CLOSED, SHEET_ARCHIVED)), AttendanceSheet.id.not_in(done)))
    if site_ids is not None:
        query = query.where(AttendanceSheet.site_id.in_(list(site_ids)))
    learned = 0
    for site_id in sorted(db.execute(query).scalars().all()):
        try:
            with db.begin_nested():
                learned += 1 if learn_site(db, site_id, now=now) else 0
        except Exception:  # noqa: BLE001 — l'apprentissage ne doit jamais gêner feuilles ni pointage
            logger.exception("Apprentissage des rotations impossible pour le site %s", site_id)
    return learned


def rebuild(db: Session, site_id: int, *, date_from: date | None = None, date_to: date | None = None,
            dry_run: bool = True, actor: Any = None, request: Any = None, now: datetime | None = None) -> dict[str, Any]:
    """Reconstruction administrative, explicite et bornée (site, période). Rejoue dans l'ordre
    chronologique les feuilles clôturées de la période ; les observations hors période sont
    conservées. Idempotente : la rejouer ne change rien. `dry_run` calcule le résultat puis
    annule tout (point de sauvegarde). Toujours auditée."""
    model = model_for(db, site_id, lock=True)
    if model is None or model.mode == MODE_OFF:
        raise ValueError("L'apprentissage n'est pas activé pour ce site")
    if not settings.rotation_learning_enabled:
        raise ValueError("L'apprentissage des rotations est désactivé (ROTATION_LEARNING_ENABLED)")
    if date_from and date_to and date_from > date_to:
        raise ValueError("Période invalide")
    now = now or datetime.utcnow()
    username = getattr(actor, "username", None)
    before = {"state": model.state, "model_version": model.model_version, "sheets_observed": model.sheets_observed,
              "groups_detected": model.groups_detected, "mean_confidence": model.mean_confidence}
    savepoint = db.begin_nested()
    scope = select(AttendanceSheet.id).where(AttendanceSheet.site_id == site_id)
    if date_from:
        scope = scope.where(AttendanceSheet.local_date >= date_from)
    if date_to:
        scope = scope.where(AttendanceSheet.local_date <= date_to)
    removed = db.execute(delete(RotationSheetObservation)
                         .where(RotationSheetObservation.site_id == site_id, RotationSheetObservation.sheet_id.in_(scope))
                         .execution_options(synchronize_session=False)).rowcount or 0
    db.expire_all()
    model = model_for(db, site_id)
    observations = _load_observations(db, site_id, None)
    replayed = 0
    last: int | None = None
    created: dict[str, dict[str, Any]] = {}
    while True:
        batch = _pending_sheets(db, site_id, date_from, date_to)
        if not batch:
            break
        last = _ingest(db, model, observations, batch, now, created)
        replayed += len(batch)
    result = _recompute(db, model, observations, source=SOURCE_REBUILD, source_sheet_id=last, actor=username, now=now, created=created)
    after = {key: result[key] for key in ("state", "model_version", "sheets_observed", "groups_detected", "mean_confidence")}
    if dry_run:
        savepoint.rollback()
        db.expire_all()
    else:
        savepoint.commit()
    site = db.get(Site, site_id)
    from app.modules.ops.routes import _site_society
    append_audit(db, action="attendance.rotation_learning.rebuild", resource="rotation_site_model", resource_id=site_id,
                 result="dry_run" if dry_run else "success", user=actor, request=request,
                 society=_site_society(site) if site else None, old_state=before,
                 new_state={**after, "date_from": date_from.isoformat() if date_from else None,
                            "date_to": date_to.isoformat() if date_to else None, "sheets_replayed": replayed,
                            "observations_removed": int(removed), "engine_version": ENGINE_VERSION})
    return {"dry_run": dry_run, "site_id": site_id, "sheets_replayed": replayed, "observations_removed": int(removed),
            "before": before, "after": after, "model_changed": result["changed"],
            "membership_changes": result["membership_changes"]}


def set_mode(db: Session, site_id: int, *, mode: str, params: dict[str, Any] | None, username: str | None) -> tuple[RotationSiteModel, dict[str, Any] | None]:
    """Activation explicite par site. Passer à OFF fige le modèle (rien n'est effacé)."""
    if mode not in (MODE_OFF, MODE_LEARNING):
        # ACTIVE (comparaison prévu / réel) relève du lot 3 : refusé tant qu'il n'existe pas.
        raise ValueError("Mode inconnu (OFF ou LEARNING)")
    clean = validate_params(params) if params is not None else None
    model = model_for(db, site_id, lock=True)
    old = None
    if model is None:
        model = RotationSiteModel(site_id=site_id, mode=MODE_OFF, state=SITE_LEARNING, model_version=0,
                                  sheets_observed=0, days_observed=0, groups_detected=0)
        db.add(model)
    else:
        old = {"mode": model.mode, "params": model.params}
    model.mode = mode
    if clean is not None:
        model.params = clean or None
    model.updated_by = username
    db.flush()
    return model, old


# ── Audit du backfill historique (lecture seule) ─────────────────────────────────────────
def backfill_preview(db: Session, site_id: int, date_from: date, date_to: date) -> dict[str, Any]:
    """Les anciens `attendance_events` permettraient-ils de reconstituer des feuilles ? Mesure
    seulement, n'écrit rien : événements ARRIVÉE / DÉPART du site non rattachés à une feuille,
    fenêtres qu'ils couvriraient avec les paramètres ACTUELS du site (hypothèse : la rotation
    n'était pas paramétrée à l'époque), et limites de fiabilité constatées."""
    from app.modules.attendance import core, sheets as sheet_service
    from app.modules.attendance.models import EVENT_ARRIVAL, EVENT_DEPARTURE, AttendanceEvent, AttendanceSheetEvent

    setting = sheet_service.setting_for(db, site_id)
    attached = select(AttendanceSheetEvent.event_id)
    base = (AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)), AttendanceEvent.presence_date >= date_from,
            AttendanceEvent.presence_date <= date_to, AttendanceEvent.id.not_in(attached))
    rows = db.execute(select(AttendanceEvent.employee_id, AttendanceEvent.occurred_at, AttendanceEvent.event_type)
                      .where(AttendanceEvent.site_id == site_id, *base).order_by(AttendanceEvent.occurred_at)).all()
    windows: dict[datetime, set[int]] = {}
    if setting is not None:
        for employee_id, occurred_at, event_type in rows:
            if event_type == EVENT_ARRIVAL:
                window = sheet_service.window_at(setting, core.to_local(occurred_at), arrival=True)
                windows.setdefault(window.start, set()).add(employee_id)
    arrivals = sum(1 for row in rows if row[2] == EVENT_ARRIVAL)
    limits = ["Fenêtres calculées avec les paramètres actuels du site : la rotation réelle de l'époque n'est pas connue.",
              "Le groupe déclaré au moment du pointage n'est pas conservé dans les anciens événements."]
    if arrivals != len(rows) - arrivals:
        limits.append("Entrées et sorties non appariées sur la période : certaines présences sont incomplètes.")
    return {"site_id": site_id, "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
            "configured": setting is not None, "events_unattached": len(rows), "arrivals": arrivals,
            "departures": len(rows) - arrivals, "employees": len({row[0] for row in rows}),
            "sheets_reconstructible": len(windows),
            "sheets_with_several_employees": sum(1 for members in windows.values() if len(members) > 1),
            "written": False, "limits": limits}


# ── Lecture (API) ────────────────────────────────────────────────────────────────────────
def _iso_local(value: datetime | None) -> str | None:
    from app.modules.attendance import core
    return core.to_local(value).isoformat() if value else None


def next_rotation(model: RotationSiteModel, now: datetime | None = None) -> dict[str, Any] | None:
    """Créneau suivant selon le cycle DÉMONTRÉ (sinon rien : aucune valeur fictive). Simple
    lecture du cycle pour le prochain créneau — la projection du planning relève du lot 4."""
    from app.modules.attendance import core

    cycle = model.cycle or {}
    if not cycle.get("found"):
        return None
    anchor = datetime.fromisoformat(cycle["anchor"])
    duration = timedelta(minutes=cycle["shift_minutes"])
    now_utc = core.to_utc_naive((now or datetime.now(core.TZ)).astimezone(core.TZ))
    index = max(0, (now_utc - anchor) // duration + 1)
    start = anchor + index * duration
    label = cycle["pattern"][index % cycle["period"]]
    return {"group": None if label == EMPTY_SLOT else label, "rest": label == EMPTY_SLOT,
            "start": _iso_local(start), "end": _iso_local(start + duration),
            "label": f"{_local_hhmm(start)} – {_local_hhmm(start + duration)}",
            "indicative": model.state != SITE_STABLE}


def site_out(db: Session, site: Site, model: RotationSiteModel | None, now: datetime | None = None) -> dict[str, Any]:
    setting = db.execute(select(RotationSetting).where(RotationSetting.site_id == site.id)).scalar_one_or_none()
    out: dict[str, Any] = {
        "site_id": site.id, "site": site.name or site.indicatif or "",
        "sheets_configured": bool(setting is not None and setting.active),
        "expected_groups": setting.groups_count if setting is not None else None,
        "enabled": bool(settings.rotation_learning_enabled),
        "mode": model.mode if model is not None else MODE_OFF,
        "learning": is_learning(model),
        "state": None, "conditions": [], "sheets_observed": 0, "days_observed": 0, "groups_detected": 0,
        "mean_confidence": None, "cycle": None, "next": None, "model_version": 0, "computed_at": None,
        "engine_version": ENGINE_VERSION, "params": effective_params(model), "overrides": (model.params if model else None) or {},
    }
    if model is not None and model.mode != MODE_OFF:
        out["state"] = model.state
    if model is not None and model.computed_at is not None:
        out.update({
            "state": model.state, "conditions": model.reasons or [], "sheets_observed": model.sheets_observed,
            "days_observed": model.days_observed, "groups_detected": model.groups_detected,
            "mean_confidence": model.mean_confidence, "cycle": model.cycle, "next": next_rotation(model, now),
            "model_version": model.model_version, "computed_at": _iso_local(model.computed_at),
            "engine_version": model.engine_version or ENGINE_VERSION,
        })
    return out


def explain(row: RotationMembership) -> str:
    """Phrase d'explication construite UNIQUEMENT à partir des chiffres enregistrés."""
    data = row.explanation or {}
    total = int(data.get("observations") or 0)
    if not total:
        return "Aucune rotation observée dans la fenêtre d'apprentissage."
    group = data.get("candidate")
    parts = [f"{total} rotation(s) observée(s)", f"{data.get('with_group', 0)} avec le groupe {group}",
             f"{data.get('time_consistent', 0)}/{total} horaires cohérents"]
    if not data.get("tracked"):
        parts.append("observations encore insuffisantes pour proposer un groupe")
    elif not data.get("group_consolidated"):
        parts.append("groupe encore candidat")
    return " · ".join(parts)


def membership_out(row: RotationMembership) -> dict[str, Any]:
    data = row.explanation or {}
    return {
        "site_id": row.site_id, "employee_id": row.employee_id, "declared_group": row.declared_group,
        "learned_group": row.learned_group, "confirmed_group": row.confirmed_group,
        "candidate_group": data.get("candidate"), "status": row.status, "source": row.source,
        "confidence": row.confidence, "observations": row.observations, "with_group": row.with_group,
        "time_consistent": data.get("time_consistent"), "by_group": data.get("by_group") or {},
        "components": data.get("components") or {}, "recent": data.get("recent") or {},
        "first_observed_at": _iso_local(row.first_observed_at), "last_observed_at": _iso_local(row.last_observed_at),
        "model_version": row.model_version, "engine_version": ENGINE_VERSION, "explanation": explain(row),
    }


def groups_out(db: Session, site_id: int) -> list[dict[str, Any]]:
    groups = db.execute(select(RotationGroup).where(RotationGroup.site_id == site_id).order_by(RotationGroup.label)).scalars().all()
    rows = db.execute(select(RotationMembership, Employee).join(Employee, Employee.id == RotationMembership.employee_id)
                      .where(RotationMembership.site_id == site_id, RotationMembership.observations > 0)
                      .order_by(Employee.last_name, Employee.first_name, Employee.id)).all()
    out = []
    for group in groups:
        members = []
        for row, employee in rows:
            candidate = (row.explanation or {}).get("candidate")
            if row.confirmed_group == group.label or (not row.confirmed_group and candidate == group.label):
                members.append({**membership_out(row), "matricule": employee.code,
                                "name": f"{employee.last_name or ''} {employee.first_name or ''}".strip(),
                                "fonction": employee.position or ""})
        explanation = group.explanation or {}
        out.append({
            "id": group.id, "label": group.label, "site_id": site_id, "status": group.status,
            "sheets_count": group.sheets_count, "usual_start": group.usual_start, "usual_end": group.usual_end,
            "usual_share": group.usual_share, "slots": explanation.get("slots") or {},
            "shift_minutes": explanation.get("shift_minutes"),
            "median_arrival_offset_minutes": explanation.get("median_arrival_offset_minutes"),
            "median_presence_minutes": explanation.get("median_presence_minutes"),
            "mean_present": explanation.get("mean_present"), "label_source": explanation.get("label_source"),
            "confidence": group.confidence, "last_observed_at": _iso_local(group.last_observed_at),
            "members_probable": [m for m in members if m["status"] == MEMBER_PROBABLE],
            "members_confirmed": [m for m in members if m["status"] in (MEMBER_CONFIRMED, MEMBER_OVERRIDDEN)],
            "members_learning": [m for m in members if m["status"] == MEMBER_LEARNING],
        })
    return out


def employee_out(db: Session, employee: Employee, site_ids: list[int] | None) -> dict[str, Any]:
    """Fiche rotation d'un salarié (complément de la fiche RH, jamais son remplacement)."""
    query = select(RotationMembership).where(RotationMembership.employee_id == employee.id)
    if site_ids is not None:
        query = query.where(RotationMembership.site_id.in_(site_ids))
    rows = db.execute(query.order_by(RotationMembership.last_observed_at.desc().nullslast())).scalars().all()
    names = {site.id: site.name or site.indicatif or "" for site in
             db.execute(select(Site).where(Site.id.in_({row.site_id for row in rows} or {0}))).scalars().all()}
    history_query = select(RotationMembershipHistory).where(RotationMembershipHistory.employee_id == employee.id)
    recent_query = (select(AttendanceSheetLine, AttendanceSheet, RotationSheetObservation.group_label)
                    .join(AttendanceSheet, AttendanceSheet.id == AttendanceSheetLine.sheet_id)
                    .join(RotationSheetObservation, RotationSheetObservation.sheet_id == AttendanceSheet.id)
                    .where(AttendanceSheetLine.employee_id == employee.id, AttendanceSheetLine.first_entry_at.is_not(None)))
    if site_ids is not None:
        history_query = history_query.where(RotationMembershipHistory.site_id.in_(site_ids))
        recent_query = recent_query.where(AttendanceSheet.site_id.in_(site_ids))
    history = db.execute(history_query.order_by(RotationMembershipHistory.changed_at.desc(), RotationMembershipHistory.id.desc()).limit(50)).scalars().all()
    recent = db.execute(recent_query.order_by(AttendanceSheet.window_start.desc()).limit(20)).all()
    from app.modules.attendance import core
    return {
        "employee_id": employee.id, "matricule": employee.code,
        "name": f"{employee.last_name or ''} {employee.first_name or ''}".strip(), "fonction": employee.position or "",
        "memberships": [{**membership_out(row), "site": names.get(row.site_id, "")} for row in rows],
        "history": [{"site_id": h.site_id, "site": names.get(h.site_id, ""), "changed_at": _iso_local(h.changed_at),
                     "old_group": h.old_group, "new_group": h.new_group, "old_status": h.old_status, "new_status": h.new_status,
                     "old_confidence": h.old_confidence, "new_confidence": h.new_confidence, "source": h.source,
                     "source_sheet_id": h.source_sheet_id, "actor": h.actor, "engine_version": h.engine_version,
                     "model_version": h.model_version} for h in history],
        "observations": [{"sheet_id": sheet.id, "site_id": sheet.site_id, "date": sheet.local_date.isoformat(),
                          "label": f"{_local_hhmm(sheet.window_start)} – {_local_hhmm(sheet.window_end)}",
                          "group": label, "declared_group": line.declared_group,
                          "first_entry": core.to_local(line.first_entry_at).strftime("%H:%M"),
                          "last_exit": core.to_local(line.last_exit_at).strftime("%H:%M") if line.last_exit_at else ""}
                         for line, sheet, label in recent],
    }


def interpretations(db: Session, sheet_ids: list[int]) -> dict[int, dict[str, Any]]:
    """Interprétation du moteur pour des feuilles (à côté de l'observation brute)."""
    if not sheet_ids:
        return {}
    rows = db.execute(select(RotationSheetObservation).where(RotationSheetObservation.sheet_id.in_(sheet_ids))).scalars().all()
    return {row.sheet_id: {"group": row.group_label, "engine_version": row.engine_version,
                           "processed_at": _iso_local(row.processed_at)} for row in rows}
