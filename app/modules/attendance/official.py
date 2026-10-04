"""Planning OFFICIEL du travail posté 24 h/24 — socle (lot 0).

Le RÉGIME de travail est une donnée EXPLICITE portée par l'AFFECTATION (`Assignment.work_regime`).
Il n'est jamais déduit du poste, de `group_code` seul, du texte `Site.rotation_system`, de
l'historique des pointages ni du Planning intelligent.

    PLANNING OFFICIEL     = vérité attendue (ce module) ;
    PLANNING INTELLIGENT  = observation / apprentissage / comparaison (learning, deviations,
                            projection) — il ne modifie jamais régime, groupe ni cycle officiel.

Une affectation POSTE_CONTINU désigne explicitement son groupe (A / B / C / D) et son modèle
officiel (`rotation_templates.official = 1`). Le cycle est ANCRÉ PAR SITE, pour tous les groupes à
la fois : `SiteRotation.start_date` est le jour J1 du groupe A (Matin 06:00–14:00). Cette date
n'est jamais inventée : une affectation postée peut être préparée avant l'ancrage du site, et
`official_shift` répond alors « ROTATION_NOT_CONFIGURED » sans aucune vacation. Sans régime explicite
(affectations historiques), rien ne change : `official_shift` répond « LEGACY » et les règles
existantes continuent de s'appliquer.

Heure RÉELLE et intervalle THÉORIQUE restent deux notions distinctes : ce module ne renvoie que
le théorique (`scheduled_start`, `scheduled_end`, `normal_minutes`) ; il ne lit ni n'écrit aucun
pointage. Voir docs/attendance-official-shift-regime.md.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from itertools import product
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.ops.models import Assignment, RotationTemplate, SiteRotation

REGIME_NORMAL = "NORMAL"
REGIME_POSTE_CONTINU = "POSTE_CONTINU"
REGIMES = (REGIME_NORMAL, REGIME_POSTE_CONTINU)
REGIME_LABELS = {REGIME_NORMAL: "Horaire normal", REGIME_POSTE_CONTINU: "Travail posté 24h/24"}

SHIFT_MORNING = "MATIN"
SHIFT_AFTERNOON = "APRES_MIDI"
SHIFT_NIGHT = "NUIT"
SHIFT_OFF = "OFF"
WORKED_SHIFTS = (SHIFT_MORNING, SHIFT_AFTERNOON, SHIFT_NIGHT)
SHIFTS = (*WORKED_SHIFTS, SHIFT_OFF)
SHIFT_LABELS = {SHIFT_MORNING: "Matin", SHIFT_AFTERNOON: "Après-midi", SHIFT_NIGHT: "Nuit", SHIFT_OFF: "Repos"}
SHIFT_TIMES = {SHIFT_MORNING: ("06:00", "14:00"), SHIFT_AFTERNOON: ("14:00", "22:00"), SHIFT_NIGHT: ("22:00", "06:00")}
NORMAL_SHIFT_MINUTES = 480
GROUPS = ("A", "B", "C", "D")

OFFICIAL_MODEL_CODE = "3X8-CONTINU-2222"
OFFICIAL_MODEL_NAME = "3x8 continu — 4 groupes — cycle 8 jours (2/2/2/2)"
# `status` reste lisible par le moteur historique (ops.service.configured_rotation_for_date).
_LEGACY_STATUS = {SHIFT_MORNING: "matin", SHIFT_AFTERNOON: "apres_midi", SHIFT_NIGHT: "nuit", SHIFT_OFF: "repos"}

STATUS_OFFICIAL = "OFFICIAL"
STATUS_NORMAL = "NORMAL"
STATUS_LEGACY = "LEGACY"
STATUS_NO_ASSIGNMENT = "NO_ASSIGNMENT"
# Affectation postée préparée (régime, groupe, modèle explicites) sur un site dont le cycle n'est
# pas encore ancré : aucun planning n'est calculé ni deviné.
STATUS_NOT_CONFIGURED = "ROTATION_NOT_CONFIGURED"


def _cycle_day(shift: str) -> dict[str, str]:
    start, end = SHIFT_TIMES.get(shift, ("", ""))
    return {"status": _LEGACY_STATUS[shift], "shift": shift, "label": shift, "start_time": start, "end_time": end}


# J1-J2 Matin, J3-J4 Après-midi, J5-J6 Nuit, J7-J8 OFF.
OFFICIAL_CYCLE_DAYS: list[dict[str, str]] = [_cycle_day(shift) for shift in SHIFTS for _ in range(2)]


# ── Cycle et décalages (fonctions pures) ─────────────────────────────────────────────────
def shift_of(day: dict[str, Any] | None) -> str | None:
    shift = str((day or {}).get("shift") or "").strip().upper()
    return shift if shift in SHIFTS else None


def covers_continuously(cycle_days: list[dict[str, Any]], offsets: dict[str, int]) -> bool:
    """Chaque jour du cycle : exactement UN groupe par vacation (Matin, Après-midi, Nuit) et UN
    groupe OFF. Les vacations se succédant sans trou sur 24 h, c'est la couverture continue."""
    length = len(cycle_days)
    if not length or len(offsets) != len(SHIFTS):
        return False
    return all(
        sorted(str(shift_of(cycle_days[(day + int(offset)) % length])) for offset in offsets.values()) == sorted(SHIFTS)
        for day in range(length)
    )


def compatible_offsets(cycle_days: list[dict[str, Any]] | None = None, groups: tuple[str, ...] = GROUPS) -> list[dict[str, int]]:
    """Tous les décalages assurant la couverture continue, le premier groupe étant la référence
    (décalage 0). Recherche exhaustive : aucun décalage n'est posé a priori."""
    days = OFFICIAL_CYCLE_DAYS if cycle_days is None else cycle_days
    found = []
    for combo in product(range(len(days)), repeat=len(groups) - 1):
        offsets = dict(zip(groups, (0, *combo)))
        if covers_continuously(days, offsets):
            found.append(offsets)
    return found


# Parmi les décalages compatibles (tous des permutations de 2 / 4 / 6 jours pour B, C, D), le
# modèle retient l'ordre de relève A → B → C → D : le jour où A est du Matin, B est d'Après-midi,
# C de Nuit et D en repos.
OFFICIAL_GROUP_OFFSETS: dict[str, int] = {"A": 0, "B": 2, "C": 4, "D": 6}


def validate_model(rotation: RotationTemplate | None) -> None:
    """Refuse un modèle officiel qui ne décrit pas des vacations de 480 min couvrant 24 h/24."""
    if rotation is None or not rotation.official or not rotation.active:
        raise ValueError("Modèle de rotation officiel introuvable ou inactif")
    days = rotation.cycle_days if isinstance(rotation.cycle_days, list) else []
    offsets = rotation.group_offsets if isinstance(rotation.group_offsets, dict) else {}
    if not days or len(days) != rotation.cycle_length or any(shift_of(day) is None for day in days):
        raise ValueError("Modèle officiel invalide : cycle incomplet")
    for day in days:
        if shift_of(day) == SHIFT_OFF:
            continue
        start, end = _minutes(day.get("start_time")), _minutes(day.get("end_time"))
        if start is None or end is None or (end - start) % (24 * 60) != NORMAL_SHIFT_MINUTES:
            raise ValueError("Modèle officiel invalide : une vacation travaillée dure 480 minutes")
    try:
        covered = covers_continuously(days, {str(group): int(offset) for group, offset in offsets.items()})
    except (TypeError, ValueError):
        covered = False
    if not covered:
        raise ValueError("Modèle officiel invalide : les groupes ne couvrent pas chaque vacation")


def _minutes(value: Any) -> int | None:
    try:
        text = str(value or "")
        return int(text[:2]) * 60 + int(text[3:5])
    except (TypeError, ValueError):
        return None


# ── Données ──────────────────────────────────────────────────────────────────────────────
def official_model(db: Session) -> RotationTemplate | None:
    return db.execute(select(RotationTemplate).where(RotationTemplate.code == OFFICIAL_MODEL_CODE,
                                                     RotationTemplate.official == 1)).scalar_one_or_none()


def ensure_official_model(db: Session) -> RotationTemplate:
    """Modèle officiel 3x8 2/2/2/2 (idempotent). En production il est créé par la migration ;
    cette fonction sert aux bases construites sans migration (tests, développement)."""
    row = official_model(db)
    if row is None:
        row = RotationTemplate(code=OFFICIAL_MODEL_CODE, name=OFFICIAL_MODEL_NAME, cycle_length=len(OFFICIAL_CYCLE_DAYS),
                               description="Modèle officiel du travail posté 24h/24 : 2 Matin, 2 Après-midi, 2 Nuit, 2 OFF.",
                               cycle_days=[dict(day) for day in OFFICIAL_CYCLE_DAYS],
                               group_offsets=dict(OFFICIAL_GROUP_OFFSETS), active=1, official=1, version=1)
        db.add(row)
        db.flush()
    return row


def site_anchor(db: Session, site_id: int, rotation_id: int, day: date) -> SiteRotation | None:
    """Lien site ↔ modèle en vigueur à `day` : sa date de début est le J1 du groupe de décalage 0."""
    return db.execute(
        select(SiteRotation).where(
            SiteRotation.site_id == site_id, SiteRotation.rotation_id == rotation_id, SiteRotation.active == 1,
            SiteRotation.start_date <= day, (SiteRotation.end_date.is_(None)) | (SiteRotation.end_date >= day),
        ).order_by(SiteRotation.start_date.desc(), SiteRotation.id.desc())
    ).scalars().first()


def assignment_at(db: Session, employee_id: int, site_id: int, day: date) -> Assignment | None:
    """Affectation de l'employé sur ce site à cette date (l'affectation active prime)."""
    return db.execute(
        select(Assignment).where(
            Assignment.employee_id == employee_id, Assignment.site_id == site_id, Assignment.start_date <= day,
            (Assignment.end_date.is_(None)) | (Assignment.end_date >= day),
        ).order_by(Assignment.active.desc(), Assignment.id.desc())
    ).scalars().first()


def is_posted(assignment: Assignment | None) -> bool:
    return getattr(assignment, "work_regime", None) == REGIME_POSTE_CONTINU


def validate_posted_assignment(db: Session, *, site_id: int, group_code: str | None, rotation_id: int | None) -> None:
    """Une affectation POSTE_CONTINU nomme explicitement son groupe et son modèle officiel.
    L'ancrage du cycle sur le site n'est PAS exigé : l'affectation peut être préparée avant ;
    le planning officiel reste alors « ROTATION_NOT_CONFIGURED »."""
    rotation = db.get(RotationTemplate, rotation_id) if rotation_id else None
    if rotation is None or not rotation.official:
        raise ValueError("Travail posté : le modèle de rotation officiel est obligatoire")
    validate_model(rotation)
    if str(group_code or "") not in (rotation.group_offsets or {}) or group_code not in GROUPS:
        raise ValueError("Travail posté : le groupe doit être A, B, C ou D")


# ── Source officielle ────────────────────────────────────────────────────────────────────
def _local(at: datetime) -> datetime:
    from app.modules.attendance import core

    return (at.replace(tzinfo=core.TZ) if at.tzinfo is None else at).astimezone(core.TZ)


def _base(assignment: Assignment | None, employee_id: int, site_id: int, status: str, reason: str | None = None) -> dict[str, Any]:
    regime = assignment.work_regime if assignment is not None else None
    return {
        "status": status, "official": False, "reason": reason, "employee_id": employee_id, "site_id": site_id,
        "assignment_id": assignment.id if assignment is not None else None,
        "regime": regime, "regime_label": REGIME_LABELS.get(regime or ""),
        "group": assignment.group_code if is_posted(assignment) else None,
        "shift": None, "shift_label": None, "working": None, "in_progress": None, "work_date": None, "cycle_day": None,
        "scheduled_start": None, "scheduled_end": None, "normal_minutes": None, "model": None,
    }


def shift_on(db: Session, assignment: Assignment, work_date: date) -> dict[str, Any]:
    """Vacation officielle d'une affectation pour la journée de cycle `work_date` (jour où la
    vacation COMMENCE : une Nuit du jour J s'achève à J+1 06:00 et reste rattachée à J)."""
    from app.modules.attendance import core

    out = _base(assignment, assignment.employee_id, assignment.site_id, STATUS_NOT_CONFIGURED)
    if assignment.work_regime is None:
        return {**out, "status": STATUS_LEGACY, "reason": "Affectation sans régime explicite : comportement historique"}
    if assignment.work_regime != REGIME_POSTE_CONTINU:
        return {**out, "status": STATUS_NORMAL, "reason": "Horaire normal : hors moteur du travail posté"}
    rotation = db.get(RotationTemplate, assignment.rotation_id) if assignment.rotation_id else None
    try:
        validate_model(rotation)
    except ValueError as exc:
        return {**out, "reason": str(exc)}
    out["model"] = {"id": rotation.id, "code": rotation.code, "name": rotation.name, "version": rotation.version,
                    "cycle_length": rotation.cycle_length, "anchor_date": None}
    if assignment.group_code not in rotation.group_offsets:
        return {**out, "reason": "Groupe absent du modèle officiel"}
    anchor = site_anchor(db, assignment.site_id, rotation.id, work_date)
    if anchor is None:
        return {**out, "reason": "Rotation non configurée : cycle officiel non ancré sur ce site à cette date"}
    index = ((work_date - anchor.start_date).days + int(rotation.group_offsets[assignment.group_code])) % rotation.cycle_length
    day = rotation.cycle_days[index]
    shift = shift_of(day)
    out.update({"status": STATUS_OFFICIAL, "official": True, "shift": shift, "shift_label": SHIFT_LABELS[shift],
                "work_date": work_date, "cycle_day": index + 1, "model": {**out["model"], "anchor_date": anchor.start_date}})
    if shift == SHIFT_OFF:
        return {**out, "working": False, "in_progress": False, "normal_minutes": 0}
    start_minutes, end_minutes = _minutes(day["start_time"]), _minutes(day["end_time"])
    start = datetime.combine(work_date, time(start_minutes // 60, start_minutes % 60), tzinfo=core.TZ)
    return {**out, "working": True, "scheduled_start": start,
            "scheduled_end": start + timedelta(minutes=(end_minutes - start_minutes) % (24 * 60)),
            "normal_minutes": NORMAL_SHIFT_MINUTES}


def official_shift(db: Session, *, employee_id: int, site_id: int, at: datetime) -> dict[str, Any]:
    """SOURCE OFFICIELLE : régime, groupe et vacation prévue d'un employé sur un site à un instant.

    Une vacation de la veille encore en cours à `at` (Nuit 22:00 → 06:00) est renvoyée telle
    quelle, rattachée à sa journée de cycle ; sinon c'est la vacation de la journée civile de
    `at` (commencée, à venir ou terminée — `in_progress` le précise). `at` naïf = heure du site.
    """
    local = _local(at)
    today = local.date()
    previous = assignment_at(db, employee_id, site_id, today - timedelta(days=1))
    if is_posted(previous):
        spill = shift_on(db, previous, today - timedelta(days=1))
        if spill["scheduled_end"] is not None and spill["scheduled_start"] <= local < spill["scheduled_end"]:
            return {**spill, "in_progress": True}
    assignment = assignment_at(db, employee_id, site_id, today)
    if assignment is None:
        return _base(None, employee_id, site_id, STATUS_NO_ASSIGNMENT, "Aucune affectation sur ce site à cette date")
    result = shift_on(db, assignment, today)
    if result["scheduled_start"] is not None:
        result["in_progress"] = result["scheduled_start"] <= local < result["scheduled_end"]
    return result


def legacy_rotation(db: Session, assignment: Assignment, work_date: date) -> dict[str, Any] | None:
    """Vacation officielle au format du moteur historique (`rotation_for_date`), pour que les
    écrans existants lisent la même vérité. None si l'affectation n'est pas en travail posté ;
    `known: False` si la rotation n'est pas configurée (ni travaillé ni repos : rien n'est déduit)."""
    if not is_posted(assignment):
        return None
    plan = shift_on(db, assignment, work_date)
    if not plan["official"]:
        return {"known": False, "on": None, "period": "", "faction": "", "recovery": 0, "start_time": "", "end_time": ""}
    working = bool(plan["working"])
    period = _LEGACY_STATUS[plan["shift"]] if working else "recuperation"
    return {"known": True, "on": working, "period": period, "faction": period if working else "repos",
            "recovery": 0 if working else 1, "cycle_day": plan["cycle_day"],
            "start_time": plan["scheduled_start"].strftime("%H:%M") if working else "",
            "end_time": plan["scheduled_end"].strftime("%H:%M") if working else ""}


# ── Sérialisation / catalogue (interface Affectation à venir) ────────────────────────────
def shift_out(result: dict[str, Any]) -> dict[str, Any]:
    out = dict(result)
    for key in ("scheduled_start", "scheduled_end", "work_date"):
        out[key] = out[key].isoformat() if out[key] is not None else None
    if out["model"] is not None:
        anchor = out["model"]["anchor_date"]
        out["model"] = {**out["model"], "anchor_date": anchor.isoformat() if anchor else None}
    return out


def catalog(db: Session) -> dict[str, Any]:
    models = db.execute(select(RotationTemplate).where(RotationTemplate.official == 1, RotationTemplate.active == 1)
                        .order_by(RotationTemplate.name)).scalars().all()
    from app.modules.attendance import counted

    return {
        "time_labels": {**counted.LABELS, "entry_status": dict(counted.ENTRY_STATUS_LABELS),
                        "early_window_minutes": int(counted.EARLY_WINDOW.total_seconds() // 60)},
        "regimes": [{"value": value, "label": REGIME_LABELS[value]} for value in REGIMES],
        "groups": list(GROUPS),
        "shifts": [{"value": shift, "label": SHIFT_LABELS[shift], "start": SHIFT_TIMES.get(shift, (None, None))[0],
                    "end": SHIFT_TIMES.get(shift, (None, None))[1],
                    "normal_minutes": 0 if shift == SHIFT_OFF else NORMAL_SHIFT_MINUTES} for shift in SHIFTS],
        "models": [{"id": m.id, "code": m.code, "name": m.name, "version": m.version, "cycle_length": m.cycle_length,
                    "cycle": [shift_of(day) for day in (m.cycle_days or [])], "group_offsets": m.group_offsets} for m in models],
    }
