"""Planning intelligent — projection du planning (V3, lot 4).

« Anticiper indéfiniment » = le cycle est mathématiquement projetable sans date de fin. Rien
n'est matérialisé : on STOCKE LA RÈGLE (versions du modèle : ancre, durée de rotation, ordre des
groupes, date d'effet, confiance, source) et les décisions humaines datées ; les occurrences
sont CALCULÉES à la demande pour la période consultée. Aucune ligne future n'est créée.

Reproductibilité : chaque créneau est calculé avec la version en vigueur À SA DATE (plus haute
version dont la date d'effet le précède) et les décisions humaines alors applicables. Créer une
version 2 ne change jamais ce qu'affiche une période antérieure à sa date d'effet.

La projection n'est jamais une vérité supérieure au réel : pour le passé, le réel (feuille,
écarts, décisions) est restitué à côté du prévu. Voir docs/attendance-rotation-projection.md.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.alerts.models import Alert, AlertEvidence, AlertHistory
from app.modules.alerts.rules import RULE_ROTATION_MODEL_REVIEW
from app.modules.attendance import deviations, learning
from app.modules.attendance.models import (
    CHECK_CONFORM,
    DECISION_PERMANENT,
    DECISION_TEMPORARY,
    MEMBER_PROBABLE,
    MODE_OFF,
    SITE_LEARNING,
    SITE_REVIEW,
    SITE_STABLE,
    AttendanceSheet,
    AttendanceSheetLine,
    RotationCheck,
    RotationDecision,
    RotationMembership,
    RotationModelVersion,
    RotationSheetObservation,
    RotationSiteModel,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Site

MAX_HORIZON_DAYS = 92
ACTIVE_STATUSES = frozenset({"actif", "active"})
BANNERS = {
    SITE_LEARNING: {"code": "LEARNING", "label": "PRÉVISION EN APPRENTISSAGE", "reliable": False},
    SITE_STABLE: {"code": "ACTIVE", "label": "PLANNING INTELLIGENT ACTIF", "reliable": True},
    SITE_REVIEW: {"code": "REVIEW_REQUIRED", "label": "RÉVISION DU PLANNING REQUISE", "reliable": False},
}


# ── Versions (règle de cycle) ────────────────────────────────────────────────────────────
def record_human_version(db: Session, model: RotationSiteModel, *, effective_at: datetime, actor: str | None,
                         sheet_id: int | None, now: datetime) -> RotationModelVersion | None:
    """Un changement de groupe confirmé ouvre une nouvelle version du planning, datée de sa prise
    d'effet. La règle de cycle est reprise de la version courante : seule l'appartenance change,
    et elle est portée par la décision datée. Les versions antérieures ne sont jamais modifiées."""
    latest = db.execute(select(RotationModelVersion).where(RotationModelVersion.site_id == model.site_id)
                        .order_by(RotationModelVersion.version.desc()).limit(1)).scalar_one_or_none()
    if latest is None:
        return None                                                  # aucun modèle appris : rien à versionner
    version = RotationModelVersion(
        site_id=model.site_id, version=int(model.model_version or latest.version) + 1, effective_at=effective_at,
        state=latest.state, previous_state=latest.state, params=latest.params, groups=latest.groups, cycle=latest.cycle,
        reasons=latest.reasons, sheets_observed=latest.sheets_observed, mean_confidence=latest.mean_confidence,
        fingerprint=latest.fingerprint, engine_version=learning.ENGINE_VERSION, source=deviations.SOURCE_HUMAN,
        source_sheet_id=sheet_id, actor=actor, created_at=now)
    model.model_version = version.version
    db.add(version)
    db.flush()
    return version


def coverage_start(version: RotationModelVersion) -> datetime:
    """Début de la rotation pendant laquelle la version prend effet : une règle connue en cours de
    rotation s'applique à cette rotation entière (sinon la rotation en cours disparaîtrait du
    planning à chaque nouvelle version)."""
    cycle = version.cycle
    anchor, duration = datetime.fromisoformat(cycle["anchor"]), timedelta(minutes=cycle["shift_minutes"])
    return anchor + ((version.effective_at - anchor) // duration) * duration


def version_at(versions: list[RotationModelVersion], moment: datetime) -> RotationModelVersion | None:
    """Version dont le cycle régit le créneau commençant à `moment` : plus haute version dont la
    couverture a déjà commencé. Une version à venir (changement daté) ne s'applique qu'à partir
    de sa date ; avant la première règle, aucun planning n'existe."""
    usable = [v for v in versions if (v.cycle or {}).get("found") and coverage_start(v) <= moment]
    return max(usable, key=lambda v: v.version) if usable else None


# ── Alerte OPS : révision du planning requise ────────────────────────────────────────────
def sync_review_alert(db: Session, model: RotationSiteModel, conditions: list[dict[str, Any]], now: datetime) -> None:
    """Site ACTIVE passant en REVIEW_REQUIRED ⇒ une alerte OPS (une seule par site, réouverte si
    le problème revient) ; résolue quand le modèle redevient cohérent. Jamais bloquant."""
    from app.modules.alerts.service import build_dedup_key
    from app.modules.ops.routes import _site_society

    dedup_key = build_dedup_key(RULE_ROTATION_MODEL_REVIEW, {"site": model.site_id})
    alert = db.execute(select(Alert).where(Alert.dedup_key == dedup_key)).scalar_one_or_none()
    failed = [c["label"] for c in conditions if c.get("status") == "failed"]
    if model.state != SITE_REVIEW:
        if alert is not None and alert.status in ("open", "acknowledged", "assigned", "deferred"):
            db.add(AlertHistory(alert_id=alert.id, action="resolved", previous_status=alert.status, new_status="resolved",
                                reason="Le modèle de rotation est de nouveau cohérent."))
            alert.status = "resolved"
        return
    site = db.get(Site, model.site_id)
    summary = f"{(site.name or site.indicatif or '') if site else ''} · conditions contredites : {' ; '.join(failed) or 'modèle incohérent'}"
    if alert is None:
        alert = Alert(rule_key=RULE_ROTATION_MODEL_REVIEW, rule_version=1, source_type="site", source_id=str(model.site_id),
                      society=str(_site_society(site) or "")[:150], site_id=model.site_id, status="open", severity="warning",
                      score=70, confidence=100, title=f"Révision du planning requise — {(site.name or '') if site else model.site_id}"[:240],
                      summary=summary, first_detected_at=now, last_detected_at=now, occurrence_count=1, dedup_key=dedup_key)
        try:
            with db.begin_nested():
                db.add(alert)
                db.flush()
                db.add(AlertEvidence(alert_id=alert.id, evidence_type="rotation_model", evidence_key="detection_snapshot",
                                     evidence_value_json={"model_version": model.model_version, "conditions": conditions}, observed_at=now))
                db.add(AlertHistory(alert_id=alert.id, action="detected", previous_status=None, new_status="open"))
        except IntegrityError:
            return
        return
    previous = alert.status
    alert.last_detected_at, alert.summary = now, summary
    alert.occurrence_count = int(alert.occurrence_count or 0) + 1
    if previous == "resolved":
        alert.status = "open"
        db.add(AlertHistory(alert_id=alert.id, action="reopened", previous_status=previous, new_status="open",
                            reason="Le modèle est de nouveau incohérent."))


# ── Projection (calcul à la demande, rien n'est écrit) ───────────────────────────────────
def _slots(cycle: dict[str, Any], start: datetime, end: datetime):
    """Créneaux du cycle recouvrant [start, end) — arithmétique pure, sans borne de date."""
    anchor, duration = datetime.fromisoformat(cycle["anchor"]), timedelta(minutes=cycle["shift_minutes"])
    index = (start - anchor) // duration
    while anchor + index * duration < end:
        slot_start = anchor + index * duration
        if slot_start + duration > start:
            yield index, slot_start, slot_start + duration, cycle["pattern"][index % cycle["period"]]
        index += 1


def _learned_groups(version: RotationModelVersion) -> dict[int, str]:
    return {employee: group["label"] for group in (version.groups or []) for employee in group.get("members_probable") or []}


def project(db: Session, site: Site, *, date_from: date, date_to: date, group: str | None = None,
            employee_id: int | None = None, now: datetime | None = None) -> dict[str, Any]:
    """Planning d'un site sur une période bornée. Nombre de requêtes CONSTANT quelle que soit la
    période (versions, décisions, appartenances, salariés, puis le réel du passé) : aucun N+1."""
    from app.modules.attendance import core

    if date_to < date_from or (date_to - date_from).days > MAX_HORIZON_DAYS:
        raise ValueError(f"Période invalide ({MAX_HORIZON_DAYS} jours au plus)")
    now_utc = core.to_utc_naive((now or datetime.now(core.TZ)).astimezone(core.TZ))
    start = core.to_utc_naive(datetime.combine(date_from, time.min, core.TZ))
    end = core.to_utc_naive(datetime.combine(date_to + timedelta(days=1), time.min, core.TZ))
    model = learning.model_for(db, site.id)
    base: dict[str, Any] = {
        "site_id": site.id, "site": site.name or site.indicatif or "", "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(), "mode": model.mode if model else MODE_OFF, "state": model.state if model else None,
        "model_version": model.model_version if model else 0, "banner": None, "cycle": None, "occurrences": [],
        "materialized": False, "generated_at": learning._iso_local(now_utc),
    }
    if model is None or model.mode == MODE_OFF:
        return {**base, "banner": {"code": "OFF", "label": "PLANNING INTELLIGENT NON ACTIVÉ POUR CE SITE", "reliable": False}}
    versions = list(db.execute(select(RotationModelVersion).where(RotationModelVersion.site_id == site.id)
                               .order_by(RotationModelVersion.version)).scalars().all())
    cycles = [v for v in versions if (v.cycle or {}).get("found")]
    base["banner"] = dict(BANNERS.get(model.state, BANNERS[SITE_LEARNING]))
    if not cycles:
        return {**base, "banner": {**base["banner"], "detail": "Aucun cycle démontré pour l'instant : rien n'est projeté."}}
    current = max(cycles, key=lambda v: v.version)
    base["cycle"] = {"period": current.cycle["period"], "pattern": current.cycle["pattern"], "shift_minutes": current.cycle["shift_minutes"],
                     "anchor": learning._iso_local(datetime.fromisoformat(current.cycle["anchor"])),
                     "concordance": current.cycle.get("concordance"), "version": current.version,
                     "effective_at": learning._iso_local(current.effective_at), "source": current.source,
                     "confidence": current.mean_confidence, "validated_by": current.actor}

    decisions = deviations.decisions_for(db, site.id)
    memberships = {m.employee_id: m for m in db.execute(select(RotationMembership).where(RotationMembership.site_id == site.id)).scalars().all()}
    people = set(memberships) | set(decisions) | {e for v in cycles for e in _learned_groups(v)}
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_(people or {0}))).scalars().all()}
    # Réel du passé : feuilles, lignes, contrôles de la période (trois requêtes, quelle que soit la durée).
    sheets = {s.window_start: s for s in db.execute(select(AttendanceSheet).where(
        AttendanceSheet.site_id == site.id, AttendanceSheet.window_start >= start - timedelta(days=1), AttendanceSheet.window_start < end)).scalars().all()}
    sheet_ids = [s.id for s in sheets.values()] or [0]
    lines: dict[int, list[AttendanceSheetLine]] = {}
    for line in db.execute(select(AttendanceSheetLine).where(AttendanceSheetLine.sheet_id.in_(sheet_ids),
                                                             AttendanceSheetLine.first_entry_at.is_not(None))).scalars().all():
        lines.setdefault(line.sheet_id, []).append(line)
    checks = {(c.sheet_id, c.employee_id): c for c in db.execute(select(RotationCheck).where(RotationCheck.sheet_id.in_(sheet_ids))).scalars().all()}
    learned_sheets = dict(db.execute(select(RotationSheetObservation.sheet_id, RotationSheetObservation.group_label)
                                     .where(RotationSheetObservation.sheet_id.in_(sheet_ids))).all())
    employees.update({e.id: e for e in db.execute(select(Employee).where(Employee.id.in_(
        {l.employee_id for ls in lines.values() for l in ls} - set(employees) or {0}))).scalars().all()})

    def person(employee_id: int) -> dict[str, Any]:
        employee = employees.get(employee_id)
        return {"employee_id": employee_id, "matricule": employee.code if employee else "",
                "name": f"{employee.last_name or ''} {employee.first_name or ''}".strip() if employee else ""}

    no_threshold = {"alert_confidence": 0}
    learned_cache: dict[int, dict[int, str]] = {}
    # Chaque créneau est calculé avec la version en vigueur à SA date (périodes passées reproductibles).
    boundaries = sorted({coverage_start(v) for v in cycles if start < coverage_start(v) < end})
    segments = list(zip([start, *boundaries], [*boundaries, end]))
    occurrences = []
    for segment_start, segment_end in segments:
        version = version_at(cycles, segment_start)
        if version is None:
            continue                                                 # avant la première règle : aucun planning à cette date
        learned = learned_cache.setdefault(version.version, _learned_groups(version))
        for _index, slot_start, slot_end, label in _slots(version.cycle, segment_start, segment_end):
            if not segment_start <= slot_start < segment_end:
                continue
            rest = label == learning.EMPTY_SLOT
            expected, exceptions = [], []
            for employee in sorted(set(learned) | set(decisions) | {e for e, m in memberships.items() if m.confirmed_group}):
                rows = decisions.get(employee, [])
                membership = memberships.get(employee)
                snapshot = SimpleNamespace(learned_group=learned.get(employee), status=MEMBER_PROBABLE if employee in learned else None,
                                           confidence=1.0, confirmed_group=membership.confirmed_group if membership else None)
                reference = deviations.reference_at(rows, snapshot, slot_start, no_threshold)
                if reference is None:
                    continue
                usual = deviations.reference_at([d for d in rows if d.kind == DECISION_PERMANENT], snapshot, slot_start, no_threshold)
                temporary = reference["source"] == deviations.SOURCE_TEMPORARY
                if temporary and usual and usual["group"] == label and reference["group"] != label:
                    exceptions.append({**person(employee), "type": "REPLACED_ELSEWHERE", "label": f"Remplacement temporaire vers le groupe {reference['group']}"})
                if rest or reference["group"] != label:
                    continue
                record = employees.get(employee)
                if record is not None and str(record.status or "").strip().lower() not in ACTIVE_STATUSES:
                    exceptions.append({**person(employee), "type": "INACTIVE", "label": f"Salarié {record.status or 'inactif'} : non attendu"})
                    continue
                expected.append({**person(employee), "source": reference["source"]})
                if temporary:
                    exceptions.append({**person(employee), "type": "TEMPORARY", "label": f"Remplacement temporaire (habituel : groupe {usual['group'] if usual else '—'})"})
            if group and label != group:
                continue
            if employee_id is not None and not any(p["employee_id"] == employee_id for p in expected):
                continue
            past = slot_end <= now_utc
            actual = None
            sheet = sheets.get(slot_start)
            if sheet is not None and (past or lines.get(sheet.id)):
                present = lines.get(sheet.id, [])
                gaps = [{**person(l.employee_id), **deviations.line_check_out(checks.get((sheet.id, l.employee_id)), learned_sheets.get(sheet.id))}
                        for l in present if (c := checks.get((sheet.id, l.employee_id))) is not None and c.outcome != CHECK_CONFORM]
                expected_ids = {p["employee_id"] for p in expected}
                actual = {"sheet_id": sheet.id, "status": sheet.status, "present": len(present),
                          "observed_group": learned_sheets.get(sheet.id),
                          "missing": [p for p in expected if p["employee_id"] not in {l.employee_id for l in present}] if past else [],
                          "unexpected": [person(l.employee_id) for l in present if l.employee_id not in expected_ids],
                          "deviations": gaps}
            occurrences.append({
                "date": core.to_local(slot_start).strftime("%Y-%m-%d"), "start": learning._local_hhmm(slot_start),
                "end": learning._local_hhmm(slot_end), "starts_at": learning._iso_local(slot_start), "ends_at": learning._iso_local(slot_end),
                "group": None if rest else label, "rest": rest, "expected": expected, "expected_count": len(expected),
                "exceptions": exceptions, "version": version.version, "version_source": version.source,
                "period": "past" if past else ("current" if slot_start <= now_utc else "future"), "actual": actual})
    return {**base, "occurrences": occurrences}


def decision_out(row: RotationDecision, employee: Employee | None) -> dict[str, Any]:
    return {"id": row.id, "employee_id": row.employee_id, "matricule": employee.code if employee else "",
            "name": f"{employee.last_name or ''} {employee.first_name or ''}".strip() if employee else "",
            "kind": row.kind, "kind_label": "Remplacement temporaire" if row.kind == DECISION_TEMPORARY else "Changement de groupe confirmé",
            "group": row.group_label, "previous_group": row.previous_group, "effective_from": learning._iso_local(row.effective_from),
            "effective_to": learning._iso_local(row.effective_to), "reason": row.reason, "validator": row.validator,
            "check_id": row.check_id, "alert_id": row.alert_id, "model_confidence": row.model_confidence,
            "created_at": learning._iso_local(row.created_at)}


def decisions_out(db: Session, site_id: int) -> list[dict[str, Any]]:
    rows = db.execute(select(RotationDecision).where(RotationDecision.site_id == site_id)
                      .order_by(RotationDecision.effective_from.desc(), RotationDecision.id.desc()).limit(200)).scalars().all()
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_({r.employee_id for r in rows} or {0}))).scalars().all()}
    return [decision_out(row, employees.get(row.employee_id)) for row in rows]
