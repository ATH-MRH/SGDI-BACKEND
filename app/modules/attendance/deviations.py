"""Planning intelligent — comparaison prévu / réel, alertes et qualification OPS (V3, lot 3).

LE POINTAGE RÉEL EST UN FAIT : il est écrit par Attendance Core AVANT toute analyse ; cette
couche ne le bloque jamais, ne le modifie jamais, et une erreur ici est annulée dans son point
de sauvegarde. Trois notions restent séparées :
- OBSERVATION RÉELLE  : la ligne de feuille (lot 1) ;
- PRÉDICTION MOTEUR   : `rotation_checks` (attendu, observé, résultat, confiance d'alors) ;
- DÉCISION HUMAINE    : `rotation_decisions` + qualification portée par le contrôle.

Référence attendue d'un salarié, par priorité décroissante :
  1. remplacement temporaire OPS actif à l'instant du pointage ;
  2. groupe confirmé par OPS (dernier changement confirmé déjà en vigueur) ;
  3. groupe APPRIS, seulement si PROBABLE avec une confiance ≥ `alert_confidence`.
Le planning théorique des affectations (gabarits de rotation) garde son propre contrôle dans
Attendance Core (anomalie « hors planning ») : il n'est ni dupliqué ni remplacé ici.

Un écart n'est émis que si la référence est fiable : site en mode ACTIVE, état mesuré STABLE,
cycle démontré. En LEARNING ou REVIEW_REQUIRED, rien n'est comparé (aucune sur-alerte).
Voir docs/attendance-rotation-deviations.md.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.config import settings
from app.modules.alerts.models import Alert, AlertEvidence, AlertHistory
from app.modules.alerts.rules import RULE_ROTATION_DEVIATION
from app.modules.attendance import learning
from app.modules.attendance.models import (
    CHECK_CONFORM,
    CHECK_DEVIATIONS,
    CHECK_PERSISTENT_CHANGE,
    CHECK_UNEXPECTED_ROTATION,
    CHECK_UNPLANNED_PRESENCE,
    DECISION_PERMANENT,
    DECISION_TEMPORARY,
    DEVIATION_ACKNOWLEDGED,
    DEVIATION_DISMISSED,
    DEVIATION_OPEN,
    DEVIATION_RESOLVED,
    EVENT_ARRIVAL,
    MEMBER_LEARNING,
    MEMBER_PROBABLE,
    MODE_ACTIVE,
    QUALIFICATIONS,
    QUALIFY_FALSE_POSITIVE,
    QUALIFY_GROUP_CHANGE,
    QUALIFY_LATER,
    QUALIFY_PERMUTATION,
    QUALIFY_REPLACEMENT,
    SITE_STABLE,
    AttendanceEvent,
    AttendanceSheet,
    AttendanceSheetLine,
    RotationCheck,
    RotationDecision,
    RotationGroup,
    RotationMembership,
    RotationMembershipHistory,
    RotationSheetObservation,
    RotationSiteModel,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Site

logger = logging.getLogger(__name__)

SOURCE_TEMPORARY = "TEMPORARY"
SOURCE_CONFIRMED = "CONFIRMED"
SOURCE_LEARNED = "LEARNED"
SOURCE_HUMAN = "HUMAN"
REFERENCE_PRIORITY = (SOURCE_TEMPORARY, SOURCE_CONFIRMED, SOURCE_LEARNED)
TYPE_LABELS = {
    CHECK_CONFORM: "Conforme",
    CHECK_UNEXPECTED_ROTATION: "Rotation inhabituelle",
    CHECK_UNPLANNED_PRESENCE: "Présence sur un créneau de repos",
    CHECK_PERSISTENT_CHANGE: "Changement de rotation durable possible",
}
QUALIFICATION_LABELS = {
    QUALIFY_PERMUTATION: "Permutation exceptionnelle",
    QUALIFY_REPLACEMENT: "Remplacement temporaire",
    QUALIFY_GROUP_CHANGE: "Changement de groupe confirmé",
    QUALIFY_FALSE_POSITIVE: "Erreur / faux positif",
    QUALIFY_LATER: "À examiner plus tard",
}
# Qualification → (statut de l'écart, action du Centre d'alertes existant).
_OUTCOMES = {
    QUALIFY_PERMUTATION: (DEVIATION_RESOLVED, "treated"),
    QUALIFY_REPLACEMENT: (DEVIATION_RESOLVED, "treated"),
    QUALIFY_GROUP_CHANGE: (DEVIATION_RESOLVED, "treated"),
    QUALIFY_FALSE_POSITIVE: (DEVIATION_DISMISSED, "ignore"),
    QUALIFY_LATER: (DEVIATION_ACKNOWLEDGED, "acknowledge"),
}


class AlreadyQualified(ValueError):
    """L'écart a déjà reçu une qualification définitive différente."""


# ── Référence attendue ───────────────────────────────────────────────────────────────────
def decisions_for(db: Session, site_id: int, employee_ids: list[int] | None = None) -> dict[int, list[RotationDecision]]:
    query = select(RotationDecision).where(RotationDecision.site_id == site_id)
    if employee_ids is not None:
        query = query.where(RotationDecision.employee_id.in_(employee_ids or [0]))
    out: dict[int, list[RotationDecision]] = {}
    for row in db.execute(query.order_by(RotationDecision.effective_from, RotationDecision.id)).scalars().all():
        out.setdefault(row.employee_id, []).append(row)
    return out


def reference_at(decisions: list[RotationDecision], membership: RotationMembership | None, moment: datetime,
                 params: dict[str, Any]) -> dict[str, Any] | None:
    """Groupe attendu d'un salarié à l'instant `moment` (fonction pure sur des données datées :
    une période passée se relit avec les décisions qui étaient alors en vigueur)."""
    temporary = [d for d in decisions if d.kind == DECISION_TEMPORARY and d.effective_from <= moment
                 and (d.effective_to is None or moment < d.effective_to)]
    if temporary:
        chosen = max(temporary, key=lambda d: (d.effective_from, d.id))
        return {"group": chosen.group_label, "source": SOURCE_TEMPORARY, "decision_id": chosen.id, "confidence": None}
    permanent = [d for d in decisions if d.kind == DECISION_PERMANENT and d.effective_from <= moment]
    if permanent:
        chosen = max(permanent, key=lambda d: (d.effective_from, d.id))
        return {"group": chosen.group_label, "source": SOURCE_CONFIRMED, "decision_id": chosen.id, "confidence": None}
    if membership is None:
        return None
    if membership.confirmed_group and not any(d.kind == DECISION_PERMANENT for d in decisions):
        return {"group": membership.confirmed_group, "source": SOURCE_CONFIRMED, "decision_id": None, "confidence": None}
    if (membership.learned_group and membership.status == MEMBER_PROBABLE
            and float(membership.confidence or 0) >= params["alert_confidence"]):
        return {"group": membership.learned_group, "source": SOURCE_LEARNED, "decision_id": None,
                "confidence": membership.confidence}
    return None


def slot_group(cycle: dict[str, Any] | None, window_start: datetime, window_end: datetime) -> tuple[str | None, int | None]:
    """Groupe que le cycle DÉMONTRÉ place sur ce créneau (None si le cycle ne s'applique pas)."""
    if not cycle or not cycle.get("found"):
        return None, None
    duration = timedelta(minutes=cycle["shift_minutes"])
    offset = window_start - datetime.fromisoformat(cycle["anchor"])
    if window_end - window_start != duration or offset % duration:
        return None, None
    index = offset // duration
    return cycle["pattern"][index % cycle["period"]], index


def nearest_slot(cycle: dict[str, Any], index: int, group: str) -> tuple[str, str] | None:
    """Créneau le plus proche où le cycle place `group` (pour afficher « attendu : A · 06:00–14:00 »)."""
    if group not in cycle["pattern"]:
        return None
    anchor, duration = datetime.fromisoformat(cycle["anchor"]), timedelta(minutes=cycle["shift_minutes"])
    for distance in range(cycle["period"] + 1):
        for candidate in (index + distance, index - distance):
            if cycle["pattern"][candidate % cycle["period"]] == group:
                start = anchor + candidate * duration
                return learning._local_hhmm(start), learning._local_hhmm(start + duration)
    return None


# ── Contrôle à l'arrivée ─────────────────────────────────────────────────────────────────
def _employee_label(employee: Employee) -> str:
    return f"{employee.code} — {(employee.last_name or '').strip()} {(employee.first_name or '').strip()}".strip()


def alert_out(check: RotationCheck) -> dict[str, Any]:
    """Ce que le poste de pointage affiche : attendu, observé — et rien d'autre."""
    return {
        "id": check.id, "type": check.outcome, "label": "ROTATION INHABITUELLE",
        "expected": {"group": check.expected_group, "start": check.expected_start, "end": check.expected_end},
        "observed": {"group": check.observed_group, "start": check.observed_start, "end": check.observed_end},
        "recorded": True,
    }


def _create_alert(db: Session, check: RotationCheck, employee: Employee, site: Site, now: datetime) -> Alert:
    from app.modules.alerts.service import build_dedup_key
    from app.modules.ops.routes import _site_society

    expected = f"Groupe {check.expected_group}" + (f" · {check.expected_start}–{check.expected_end}" if check.expected_start else "")
    observed = (f"Groupe {check.observed_group}" if check.observed_group else "Créneau de repos") + f" · {check.observed_start}–{check.observed_end}"
    dedup_key = build_dedup_key(RULE_ROTATION_DEVIATION, {"site": check.site_id, "employee": check.employee_id, "sheet": check.sheet_id})
    alert = Alert(
        rule_key=RULE_ROTATION_DEVIATION, rule_version=1, source_type="employee", source_id=str(employee.id),
        society=str(_site_society(site) or employee.society or "")[:150], site_id=site.id, status="open",
        severity=check.severity or "warning", score=80 if check.severity == "critical" else 60,
        confidence=int(round(float(check.confidence if check.confidence is not None else 1) * 100)),
        title=f"Changement de rotation détecté — {_employee_label(employee)}"[:240],
        summary=f"{site.name or site.indicatif or ''} · Attendu : {expected} · Observé : {observed}. Pointage enregistré.",
        first_detected_at=now, last_detected_at=now, occurrence_count=1, dedup_key=dedup_key)
    db.add(alert)
    db.flush()
    db.add(AlertEvidence(alert_id=alert.id, evidence_type="rotation_check", evidence_key="detection_snapshot", observed_at=now,
                         evidence_value_json={"check_id": check.id, "sheet_id": check.sheet_id, "event_id": check.event_id,
                                              "type": check.outcome, "expected_group": check.expected_group,
                                              "expected_source": check.expected_source, "observed_group": check.observed_group,
                                              "confidence": check.confidence, "model_version": check.model_version}))
    db.add(AlertHistory(alert_id=alert.id, action="detected", previous_status=None, new_status="open"))
    return alert


def check_arrival(db: Session, *, event: AttendanceEvent, employee: Employee, site: Site | None,
                  line: AttendanceSheetLine | None, now: datetime) -> RotationCheck | None:
    """Compare la prise de poste à la référence attendue. Une seule ligne par (feuille, salarié) ;
    retourne le contrôle (conforme ou non) ou None si rien n'est comparable."""
    if (not settings.rotation_learning_enabled or site is None or line is None or event.event_type != EVENT_ARRIVAL
            or line.last_event_id != event.id):
        return None
    model = learning.model_for(db, site.id)
    if model is None or model.mode != MODE_ACTIVE or model.state != SITE_STABLE:
        return None
    existing = db.execute(select(RotationCheck).where(RotationCheck.sheet_id == line.sheet_id,
                                                      RotationCheck.employee_id == employee.id)).scalar_one_or_none()
    if existing is not None:
        return existing                                              # retour dans la même rotation : déjà contrôlé
    sheet = db.get(AttendanceSheet, line.sheet_id)
    observed, index = slot_group(model.cycle, sheet.window_start, sheet.window_end)
    if observed is None:
        return None
    params = learning.effective_params(model)
    membership = db.execute(select(RotationMembership).where(RotationMembership.site_id == site.id,
                                                             RotationMembership.employee_id == employee.id)).scalar_one_or_none()
    reference = reference_at(decisions_for(db, site.id, [employee.id]).get(employee.id, []), membership, event.occurred_at, params)
    if reference is None:
        return None                                                  # référence non fiable ⇒ aucun écart inventé
    rest = observed == learning.EMPTY_SLOT
    if reference["group"] == observed:
        outcome = CHECK_CONFORM
    elif rest:
        outcome = CHECK_UNPLANNED_PRESENCE
    else:
        outcome = CHECK_UNEXPECTED_ROTATION
        needed = params["persistent_deviations"] - 1
        previous = db.execute(select(RotationCheck.outcome, RotationCheck.observed_group)
                              .where(RotationCheck.site_id == site.id, RotationCheck.employee_id == employee.id)
                              .order_by(RotationCheck.occurred_at.desc(), RotationCheck.id.desc()).limit(needed)).all()
        if len(previous) == needed and all(o in CHECK_DEVIATIONS and g == observed for o, g in previous):
            outcome = CHECK_PERSISTENT_CHANGE
    expected_slot = nearest_slot(model.cycle, index, reference["group"]) if outcome != CHECK_CONFORM else None
    deviating = outcome != CHECK_CONFORM
    from app.modules.ops.routes import _site_society
    check = RotationCheck(
        site_id=site.id, employee_id=employee.id, sheet_id=sheet.id, line_id=line.id, event_id=event.id,
        society=_site_society(site) or employee.society, occurred_at=event.occurred_at, outcome=outcome,
        severity=("critical" if outcome == CHECK_PERSISTENT_CHANGE else "warning") if deviating else None,
        expected_group=reference["group"], expected_source=reference["source"],
        expected_start=expected_slot[0] if expected_slot else None, expected_end=expected_slot[1] if expected_slot else None,
        observed_group=None if rest else observed, observed_start=learning._local_hhmm(sheet.window_start),
        observed_end=learning._local_hhmm(sheet.window_end),
        confidence=reference["confidence"] if reference["confidence"] is not None else model.mean_confidence,
        model_version=model.model_version, engine_version=learning.ENGINE_VERSION,
        status=DEVIATION_OPEN if deviating else None,
        explanation={"reference_source": reference["source"], "reference_decision_id": reference["decision_id"],
                     "priority": list(REFERENCE_PRIORITY), "cycle_period": model.cycle["period"],
                     "cycle_concordance": model.cycle.get("concordance"), "site_state": model.state,
                     "membership": {"observations": membership.observations, "with_group": membership.with_group,
                                    "confidence": membership.confidence, "status": membership.status} if membership else None})
    db.add(check)
    db.flush()
    if sheet.expected_group is None and not rest:
        sheet.expected_group = observed[:8]                          # colonne prévue par le lot 1 pour le planning
    if deviating:
        from app.modules.attendance import core
        check.alert_id = _create_alert(db, check, employee, site, core.to_utc_naive(now)).id
        db.flush()
    return check


def check_arrival_safely(db: Session, **kwargs: Any) -> dict[str, Any] | None:
    """Jamais bloquant : le pointage est déjà écrit. Retourne l'alerte à afficher au poste, ou
    None (conforme, non comparable, ou erreur journalisée)."""
    try:
        with db.begin_nested():
            check = check_arrival(db, **kwargs)
    except IntegrityError:
        # Même écart créé en parallèle : la contrainte unique garantit UNE ligne et UNE alerte.
        line = kwargs.get("line")
        check = db.execute(select(RotationCheck).where(RotationCheck.sheet_id == line.sheet_id,
                                                       RotationCheck.employee_id == kwargs["employee"].id)).scalar_one_or_none()
    except Exception:  # noqa: BLE001 — isolation volontaire du chemin critique de pointage
        logger.exception("Comparaison prévu / réel impossible (pointage conservé)")
        return None
    # Un écart déjà tranché par OPS n'est plus rappelé au poste lors d'un retour dans la rotation.
    visible = check is not None and check.outcome != CHECK_CONFORM and check.status in (DEVIATION_OPEN, DEVIATION_ACKNOWLEDGED)
    return alert_out(check) if visible else None


def alerts_for_events(db: Session, event_ids: list[int]) -> dict[int, dict[str, Any]]:
    """Écarts rattachés à des événements (flux temps réel du poste de pointage) — une requête."""
    if not event_ids:
        return {}
    rows = db.execute(select(RotationCheck).where(RotationCheck.event_id.in_(event_ids),
                                                  RotationCheck.outcome != CHECK_CONFORM)).scalars().all()
    return {row.event_id: alert_out(row) for row in rows}


# ── Qualification OPS ────────────────────────────────────────────────────────────────────
def decide(db: Session, *, site_id: int, employee_id: int, kind: str, group: str, start: datetime, end: datetime | None,
           reason: str | None, user: Any, check: RotationCheck | None = None, membership: RotationMembership | None = None,
           now: datetime | None = None) -> RotationDecision:
    """Décision humaine DATÉE (UTC naïf) : remplacement temporaire ou changement de groupe
    confirmé. Elle prime sur le modèle pendant sa période d'effet et ne touche jamais au passé :
    une période antérieure à `start` se relit avec les décisions qui la précèdent."""
    if kind not in (DECISION_TEMPORARY, DECISION_PERMANENT):
        raise ValueError("Type de décision inconnu")
    if not (reason or "").strip():
        raise ValueError("Un motif est obligatoire pour cette décision")
    known = set(db.execute(select(RotationGroup.label).where(RotationGroup.site_id == site_id)).scalars().all())
    if not group or group not in known:
        raise ValueError("Groupe inconnu sur ce site")
    now = now or datetime.utcnow()
    username = getattr(user, "username", None)
    # Verrou du modèle du site AVANT l'appartenance (même ordre que l'apprentissage) : les
    # versions restent sans doublon et aucune étreinte fatale n'est possible avec une clôture.
    model = learning.model_for(db, site_id, lock=True)
    if membership is None:
        membership = db.execute(select(RotationMembership).where(RotationMembership.site_id == site_id,
                                                                 RotationMembership.employee_id == employee_id)
                                .with_for_update()).scalar_one_or_none()
    params = {**learning.effective_params(model), "alert_confidence": 0}
    permanent = [d for d in decisions_for(db, site_id, [employee_id]).get(employee_id, []) if d.kind == DECISION_PERMANENT]
    usual = reference_at(permanent, membership, start, params)
    if kind == DECISION_TEMPORARY:
        if end is None or end <= start:
            raise ValueError("La fin du remplacement doit suivre son début")
        decision = RotationDecision(kind=DECISION_TEMPORARY, effective_to=end)
    else:
        decision = RotationDecision(kind=DECISION_PERMANENT, effective_to=None)
        if membership is None:
            membership = RotationMembership(site_id=site_id, employee_id=employee_id, status=MEMBER_LEARNING, source=SOURCE_HUMAN,
                                            confidence=0, observations=0, with_group=0, model_version=0)
            db.add(membership)
        before = (membership.confirmed_group or membership.learned_group, membership.status, membership.confidence)
        membership.confirmed_group = group
        membership.status = learning._status_of(bool(membership.learned_group), membership.learned_group, group)[1]
        membership.updated_at = now
        # Nouvelle version de l'appartenance : ancienne / nouvelle valeur, validateur, motif,
        # alerte source, confiance du modèle au moment de la décision. Rien de rétroactif.
        db.add(RotationMembershipHistory(
            site_id=site_id, employee_id=employee_id, old_group=before[0], new_group=group,
            old_status=before[1], new_status=membership.status, old_confidence=before[2], new_confidence=membership.confidence,
            source=SOURCE_HUMAN, source_sheet_id=check.sheet_id if check else None, actor=username,
            engine_version=learning.ENGINE_VERSION, model_version=(model.model_version if model else 0) or 0, changed_at=now))
    decision.site_id, decision.employee_id = site_id, employee_id
    decision.group_label, decision.previous_group, decision.effective_from = group, usual["group"] if usual else None, start
    decision.reason, decision.validator, decision.validator_user_id = reason.strip(), username, getattr(user, "id", None)
    decision.check_id, decision.alert_id = (check.id, check.alert_id) if check else (None, None)
    decision.model_confidence = check.confidence if check else (membership.confidence if membership else None)
    decision.model_version = check.model_version if check else (model.model_version if model else None)
    db.add(decision)
    db.flush()
    if kind == DECISION_PERMANENT and model is not None:
        from app.modules.attendance import projection
        projection.record_human_version(db, model, effective_at=start, actor=username, sheet_id=check.sheet_id if check else None, now=now)
    return decision


def qualify(db: Session, check_id: int, *, action: str, user: Any, reason: str | None = None, group: str | None = None,
            start_at: datetime | None = None, end_at: datetime | None = None, request: Any = None,
            now: datetime | None = None) -> RotationCheck:
    """Décision OPS sur un écart. Le pointage, la feuille et les anciennes feuilles ne sont
    jamais modifiés. Rejouer la même décision ne crée rien de plus (idempotent) ; une décision
    définitive différente est refusée. `start_at` / `end_at` : UTC naïf."""
    if action not in QUALIFICATIONS:
        raise ValueError("Qualification inconnue")
    reason = (reason or "").strip() or None
    check = db.execute(select(RotationCheck).where(RotationCheck.id == check_id).with_for_update()
                       .execution_options(populate_existing=True)).scalar_one_or_none()
    if check is None or check.outcome == CHECK_CONFORM:
        raise LookupError("Écart introuvable")
    if check.status in (DEVIATION_RESOLVED, DEVIATION_DISMISSED):
        if check.qualification == action:
            return check
        raise AlreadyQualified(f"Écart déjà qualifié : {QUALIFICATION_LABELS.get(check.qualification, check.qualification)}")
    if action == QUALIFY_FALSE_POSITIVE and not reason:
        raise ValueError("Une justification est obligatoire pour un faux positif")
    if action in (QUALIFY_REPLACEMENT, QUALIFY_GROUP_CHANGE) and not reason:
        raise ValueError("Un motif est obligatoire pour cette décision")
    now = now or datetime.utcnow()
    username = getattr(user, "username", None)
    sheet = db.get(AttendanceSheet, check.sheet_id)
    learning.model_for(db, check.site_id, lock=True)                # ordre des verrous : modèle, puis appartenance
    membership = db.execute(select(RotationMembership).where(RotationMembership.site_id == check.site_id,
                                                             RotationMembership.employee_id == check.employee_id)
                            .with_for_update()).scalar_one_or_none()
    old_state = {"status": check.status, "qualification": check.qualification,
                 "confirmed_group": membership.confirmed_group if membership else None}
    decision: RotationDecision | None = None
    if action in (QUALIFY_REPLACEMENT, QUALIFY_GROUP_CHANGE):
        decision = decide(db, site_id=check.site_id, employee_id=check.employee_id,
                          kind=DECISION_TEMPORARY if action == QUALIFY_REPLACEMENT else DECISION_PERMANENT,
                          group=(group or check.observed_group or "").strip(), start=start_at or sheet.window_start, end=end_at,
                          reason=reason, user=user, check=check, membership=membership, now=now)
        check.decision_id = decision.id
    status, alert_action = _OUTCOMES[action]
    check.status, check.qualification, check.reason = status, action, reason
    check.decided_by, check.decided_at = username, now
    db.flush()
    append_audit(db, action="attendance.rotation_deviation.qualify", resource="rotation_check", resource_id=check.id,
                 result="success", user=user, request=request, society=check.society, old_state=old_state,
                 new_state={"status": status, "qualification": action, "reason": reason, "alert_id": check.alert_id,
                            "decision_id": decision.id if decision else None,
                            "group": decision.group_label if decision else None,
                            "previous_group": decision.previous_group if decision else None,
                            "effective_from": decision.effective_from.isoformat() if decision else None,
                            "effective_to": decision.effective_to.isoformat() if decision and decision.effective_to else None})
    alert = db.get(Alert, check.alert_id) if check.alert_id else None
    if alert is not None:
        from app.modules.alerts.lifecycle import InvalidTransitionError
        from app.modules.alerts.service import apply_lifecycle_action
        try:                                                         # transition historisée par le Centre d'alertes
            apply_lifecycle_action(db, alert, action=alert_action, actor_user_id=getattr(user, "id", None),
                                   reason=f"{QUALIFICATION_LABELS[action]}{' — ' + reason if reason else ''}")
        except InvalidTransitionError:
            pass                                                     # ex. déjà acquittée : l'écart reste la référence
    return check


# ── Lecture ──────────────────────────────────────────────────────────────────────────────
def _iso(value: datetime | None) -> str | None:
    return learning._iso_local(value)


def check_out(check: RotationCheck, employee: Employee | None, site_name: str) -> dict[str, Any]:
    from app.modules.attendance import core

    local = core.to_local(check.occurred_at)
    return {
        "id": check.id, "type": check.outcome, "type_label": TYPE_LABELS.get(check.outcome, check.outcome),
        "severity": check.severity, "status": check.status, "qualification": check.qualification,
        "qualification_label": QUALIFICATION_LABELS.get(check.qualification) if check.qualification else None,
        "site_id": check.site_id, "site": site_name, "society": check.society or "", "employee_id": check.employee_id,
        "matricule": employee.code if employee else "",
        "name": f"{employee.last_name or ''} {employee.first_name or ''}".strip() if employee else "",
        "date": local.strftime("%Y-%m-%d"), "heure": local.strftime("%H:%M"), "occurred_at": local.isoformat(),
        "sheet_id": check.sheet_id, "event_id": check.event_id, "alert_id": check.alert_id,
        "expected_group": check.expected_group, "expected_source": check.expected_source,
        "expected_rotation": f"{check.expected_start} – {check.expected_end}" if check.expected_start else None,
        "observed_group": check.observed_group, "observed_rotation": f"{check.observed_start} – {check.observed_end}",
        "confidence": check.confidence, "model_version": check.model_version, "engine_version": check.engine_version,
        "reason": check.reason, "decided_by": check.decided_by, "decided_at": _iso(check.decided_at),
        "decision_id": check.decision_id,
    }


def list_deviations(db: Session, *, site_ids: list[int] | None, date_from=None, date_to=None, employee_id: int | None = None,
                    group: str | None = None, deviation_type: str | None = None, severity: str | None = None,
                    status: str | None = None, page: int = 1, page_size: int = 25) -> dict[str, Any]:
    from app.modules.attendance import core
    from datetime import time as dtime

    query = select(RotationCheck).where(RotationCheck.outcome != CHECK_CONFORM)
    if site_ids is not None:
        query = query.where(RotationCheck.site_id.in_(site_ids or [0]))
    if date_from:
        query = query.where(RotationCheck.occurred_at >= core.to_utc_naive(datetime.combine(date_from, dtime.min, core.TZ)))
    if date_to:
        query = query.where(RotationCheck.occurred_at < core.to_utc_naive(datetime.combine(date_to + timedelta(days=1), dtime.min, core.TZ)))
    if employee_id is not None:
        query = query.where(RotationCheck.employee_id == employee_id)
    if group:
        query = query.where((RotationCheck.expected_group == group) | (RotationCheck.observed_group == group))
    if deviation_type:
        query = query.where(RotationCheck.outcome == deviation_type)
    if severity:
        query = query.where(RotationCheck.severity == severity)
    if status:
        query = query.where(RotationCheck.status == status)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = db.execute(query.order_by(RotationCheck.occurred_at.desc(), RotationCheck.id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).scalars().all()
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_({r.employee_id for r in rows} or {0}))).scalars().all()}
    sites = {s.id: s.name or s.indicatif or "" for s in db.execute(select(Site).where(Site.id.in_({r.site_id for r in rows} or {0}))).scalars().all()}
    return {"total": int(total), "page": page, "page_size": page_size,
            "items": [check_out(row, employees.get(row.employee_id), sites.get(row.site_id, "")) for row in rows]}


def history_rows(db: Session, *, site_ids: list[int] | None, date_from=None, date_to=None, site_id: int | None = None,
                 employee_id: int | None = None, group: str | None = None, outcome: str | None = None,
                 anomaly: str | None = None, sheet_status: str | None = None, q: str | None = None,
                 page: int = 1, page_size: int = 50) -> dict[str, Any]:
    """Historique de pointage par rotation : une ligne RÉELLE par (salarié, feuille), enrichie de
    ce que le moteur attendait et de la décision OPS. Rien n'est recalculé a posteriori : attendu
    et résultat sont ceux enregistrés au moment du pointage (« non évalué » sinon)."""
    from app.modules.attendance import core

    query = (select(AttendanceSheetLine, AttendanceSheet, RotationCheck, RotationSheetObservation.group_label)
             .join(AttendanceSheet, AttendanceSheet.id == AttendanceSheetLine.sheet_id)
             .outerjoin(RotationCheck, (RotationCheck.sheet_id == AttendanceSheetLine.sheet_id)
                        & (RotationCheck.employee_id == AttendanceSheetLine.employee_id))
             .outerjoin(RotationSheetObservation, RotationSheetObservation.sheet_id == AttendanceSheet.id))
    if site_ids is not None:
        query = query.where(AttendanceSheet.site_id.in_(site_ids or [0]))
    if site_id is not None:
        query = query.where(AttendanceSheet.site_id == site_id)
    if date_from:
        query = query.where(AttendanceSheet.local_date >= date_from)
    if date_to:
        query = query.where(AttendanceSheet.local_date <= date_to)
    if employee_id is not None:
        query = query.where(AttendanceSheetLine.employee_id == employee_id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        matching = select(Employee.id).where(func.lower(Employee.code).like(like) | func.lower(Employee.last_name).like(like)
                                             | func.lower(Employee.first_name).like(like))
        query = query.where(AttendanceSheetLine.employee_id.in_(matching))
    if group:
        query = query.where((RotationCheck.expected_group == group) | (RotationCheck.observed_group == group)
                            | (RotationSheetObservation.group_label == group))
    if outcome == "NOT_EVALUATED":
        query = query.where(RotationCheck.id.is_(None))
    elif outcome == "DEVIATION":
        query = query.where(RotationCheck.outcome.in_(CHECK_DEVIATIONS))
    elif outcome:
        query = query.where(RotationCheck.outcome == outcome)
    if anomaly:
        query = query.where(AttendanceSheetLine.anomaly == anomaly)
    if sheet_status:
        query = query.where(AttendanceSheet.status == sheet_status)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = db.execute(query.order_by(AttendanceSheet.window_start.desc(), AttendanceSheetLine.id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_({r[0].employee_id for r in rows} or {0}))).scalars().all()}
    sites = {s.id: s.name or s.indicatif or "" for s in db.execute(select(Site).where(Site.id.in_({r[1].site_id for r in rows} or {0}))).scalars().all()}
    items = []
    for line, sheet, check, learned in rows:
        employee = employees.get(line.employee_id)
        items.append({
            "sheet_id": sheet.id, "site_id": sheet.site_id, "site": sites.get(sheet.site_id, ""), "date": sheet.local_date.isoformat(),
            "rotation": f"{learning._local_hhmm(sheet.window_start)} – {learning._local_hhmm(sheet.window_end)}",
            "sheet_status": sheet.status, "employee_id": line.employee_id, "matricule": employee.code if employee else "",
            "name": f"{employee.last_name or ''} {employee.first_name or ''}".strip() if employee else "",
            "first_entry": core.to_local(line.first_entry_at).strftime("%H:%M") if line.first_entry_at else "",
            "last_exit": core.to_local(line.last_exit_at).strftime("%H:%M") if line.last_exit_at else "",
            "events_count": line.events_count, "state": line.state, "anomaly": line.anomaly,
            "declared_group": line.declared_group, **line_check_out(check, learned)})
    return {"total": int(total), "page": page, "page_size": page_size, "items": items}


def line_check_out(check: RotationCheck | None, learned_group: str | None) -> dict[str, Any]:
    """Prévu / réel / écart / décision d'une ligne (valeurs enregistrées, jamais recalculées)."""
    if check is None:
        return {"expected_group": None, "observed_group": learned_group, "outcome": "NOT_EVALUATED",
                "outcome_label": "Non évalué", "deviation_id": None, "deviation_status": None,
                "qualification": None, "qualification_label": None}
    conform = check.outcome == CHECK_CONFORM
    return {"expected_group": check.expected_group, "expected_source": check.expected_source,
            "observed_group": check.observed_group or learned_group, "outcome": check.outcome,
            "outcome_label": TYPE_LABELS.get(check.outcome, check.outcome),
            "deviation_id": None if conform else check.id, "deviation_status": check.status,
            "qualification": check.qualification,
            "qualification_label": QUALIFICATION_LABELS.get(check.qualification) if check.qualification else None}


def checks_for_sheet(db: Session, sheet_id: int) -> dict[int, RotationCheck]:
    rows = db.execute(select(RotationCheck).where(RotationCheck.sheet_id == sheet_id)).scalars().all()
    return {row.employee_id: row for row in rows}


def detail(db: Session, check: RotationCheck) -> dict[str, Any]:
    """Tout ce qu'OPS doit voir pour « Examiner » : attendu, observé, confiance, explication,
    historique récent du salarié, historique de l'alerte, décision éventuelle."""
    employee = db.get(Employee, check.employee_id)
    site = db.get(Site, check.site_id)
    membership = db.execute(select(RotationMembership).where(RotationMembership.site_id == check.site_id,
                                                             RotationMembership.employee_id == check.employee_id)).scalar_one_or_none()
    recent = history_rows(db, site_ids=[check.site_id], employee_id=check.employee_id, page_size=10)["items"]
    decision = db.get(RotationDecision, check.decision_id) if check.decision_id else None
    alert_history = []
    if check.alert_id:
        for entry in db.execute(select(AlertHistory).where(AlertHistory.alert_id == check.alert_id)
                                .order_by(AlertHistory.id)).scalars().all():
            alert_history.append({"action": entry.action, "previous_status": entry.previous_status, "new_status": entry.new_status,
                                  "actor_user_id": entry.actor_user_id, "reason": entry.reason, "at": _iso(entry.created_at)})
    groups = db.execute(select(RotationGroup.label).where(RotationGroup.site_id == check.site_id, RotationGroup.sheets_count > 0)
                        .order_by(RotationGroup.label)).scalars().all()
    sources = {SOURCE_TEMPORARY: "remplacement temporaire en cours", SOURCE_CONFIRMED: "groupe confirmé par OPS",
               SOURCE_LEARNED: "groupe appris par le moteur"}
    explanation = (f"Référence attendue : groupe {check.expected_group} ({sources.get(check.expected_source, check.expected_source)}). "
                   + (f"Le cycle observé du site place le groupe {check.observed_group} sur la rotation {check.observed_start}–{check.observed_end}."
                      if check.observed_group else f"Le cycle observé du site ne place aucun groupe sur la rotation {check.observed_start}–{check.observed_end}.")
                   + (" " + learning.explain(membership) if membership is not None else ""))
    return {**check_out(check, employee, (site.name or site.indicatif or "") if site else ""),
            "fonction": employee.position or "" if employee else "", "explanation": explanation,
            "details": check.explanation or {},
            "membership": learning.membership_out(membership) if membership is not None else None,
            "recent": recent, "alert_history": alert_history, "groups": list(groups),
            "decision": {"id": decision.id, "kind": decision.kind, "group": decision.group_label,
                         "previous_group": decision.previous_group, "effective_from": _iso(decision.effective_from),
                         "effective_to": _iso(decision.effective_to), "reason": decision.reason,
                         "validator": decision.validator, "model_confidence": decision.model_confidence} if decision else None,
            "actions": [{"key": key, "label": QUALIFICATION_LABELS[key]} for key in QUALIFICATIONS]}
