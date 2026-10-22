"""Points critiques : projection et traitement du registre canonique des anomalies.

Aucune seconde présence, aucun recalcul du planning. Le workflow est conservé dans le JSON
versionné de l'anomalie ; chaque transition produit une entrée d'audit avant/après.
"""
from datetime import datetime

from fastapi import HTTPException

from app.core.audit import append_audit
from app.modules.attendance.models import ANOMALY_OPEN, ANOMALY_RESOLVED

STATES = ("DETECTED", "TO_PROCESS", "IN_PROGRESS", "TO_VALIDATE", "VALIDATED", "ARCHIVED")
LABELS = dict(zip(STATES, ("Détecté", "À traiter", "En cours", "À valider", "Validé", "Archivé")))


def view(row):
    details = row.details or {}
    workflow = details.get("workflow") or {}
    status = workflow.get("status") or ("DETECTED" if row.status == ANOMALY_OPEN else "ARCHIVED")
    return {"id": row.id, "type": row.anomaly_type, "severity": row.severity,
            "status": status, "status_label": LABELS[status], "employee_id": row.employee_id,
            "site_id": row.site_id, "group": details.get("group"),
            "date": row.presence_date.isoformat() if row.presence_date else None,
            "message": row.message, "treatment": row.resolution or "",
            "responsible": workflow.get("responsible") or row.resolved_by,
            "event_id": row.event_id, "history": workflow.get("history") or []}


def transition(db, row, *, target, reason, responsible, actor, request=None):
    before = view(row)
    if target not in STATES or STATES.index(target) != STATES.index(before["status"]) + 1:
        raise HTTPException(409, "Transition de situation invalide")
    responsible = responsible.strip()
    if not responsible:
        raise HTTPException(422, "Responsable obligatoire")
    reason = reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, "Motif de traitement obligatoire")
    now = datetime.utcnow()
    history = [*before["history"], {"from": before["status"], "to": target, "reason": reason,
                "by": actor.username, "at": now.isoformat()}]
    row.details = {**(row.details or {}), "workflow": {"status": target, "responsible": responsible,
                                                    "history": history}}
    row.resolution = reason
    if target in ("VALIDATED", "ARCHIVED"):
        row.status, row.resolved_by, row.resolved_at = ANOMALY_RESOLVED, actor.username, now
        close_projections(db,row)
    append_audit(db, action="attendance.situation.transition", resource="attendance_anomaly", resource_id=row.id,
                 result="success", user=actor, request=request, society=row.society,
                 old_state=before, new_state=view(row))
    return view(row)


def detect_maintenance(db, site_ids, now):
    """Rattrapage idempotent des vacations toujours ouvertes après la fin officielle."""
    from sqlalchemy import select
    from app.modules.attendance import core
    from app.modules.attendance.models import AttendanceEvent, AttendanceAnomaly, EVENT_ARRIVAL, EVENT_DEPARTURE
    from app.modules.drh.models import Employee
    from datetime import timedelta
    from app.modules.attendance import live
    last = live._latest_scans(db,site_ids=site_ids,since=core.to_utc_naive(now-timedelta(hours=30)))
    due = []
    for event in last.values():
        snapshot = (event.data or {}).get('counted') or {}
        if event.event_type != EVENT_ARRIVAL or snapshot.get('policy_version') != 7 or not snapshot.get('scheduled_end'):
            continue
        if site_ids is not None and event.site_id not in site_ids:
            continue
        if now > datetime.fromisoformat(snapshot['scheduled_end']):
            due.append((event,snapshot))
    keys = {f'MAINTENANCE:{event.id}' for event,_ in due}
    known = set(db.scalars(select(AttendanceAnomaly.dedupe_key).where(AttendanceAnomaly.dedupe_key.in_(keys)))) if keys else set()
    missing = [(event,snapshot) for event,snapshot in due if f'MAINTENANCE:{event.id}' not in known]
    employees = {employee.id:employee for employee in db.scalars(select(Employee).where(
        Employee.id.in_({event.employee_id for event,_ in missing} or {-1})))} if missing else {}
    for event,snapshot in missing:
        end = datetime.fromisoformat(snapshot['scheduled_end'])
        core.raise_anomaly(db, anomaly_type='MAINTENANCE', employee=employees.get(event.employee_id),
            site_id=event.site_id, presence_date=event.presence_date, event=event, source=event.source,
            dedupe_key=f'MAINTENANCE:{event.id}', message=f"Maintenu après la fin prévue à {end.strftime('%H:%M')}",
            details={'policy_version':7,'scheduled_end':snapshot['scheduled_end'],'group':snapshot.get('group'),'actual_entry':snapshot.get('actual_entry')})


def detect_missing(db, site_ids, now):
    """Absences V7 à T+30 : uniquement les attendus officiels, hors congé/maladie/mission."""
    from sqlalchemy import select
    from app.modules.attendance import core, official, live
    from app.modules.attendance.models import AttendanceAnomaly, EVENT_ARRIVAL
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment, DailyPresence, RotationTemplate
    from datetime import timedelta
    stmt = select(Assignment).join(RotationTemplate, Assignment.rotation_id == RotationTemplate.id).where(
        RotationTemplate.code == official.FIXED_MODEL_CODE, Assignment.active == 1,
        Assignment.start_date <= now.date(), (Assignment.end_date.is_(None)) | (Assignment.end_date >= now.date()))
    if site_ids is not None:
        stmt = stmt.where(Assignment.site_id.in_(list(site_ids) or [-1]))
    assignments = list(db.scalars(stmt))
    boards = {site:official.site_shift(db,site_id=site,at=now)['current'] for site in {a.site_id for a in assignments}}
    expected = [(a,boards[a.site_id]) for a in assignments if boards[a.site_id]
        and a.group_code == boards[a.site_id]['group'] and now-boards[a.site_id]['scheduled_start'] >= timedelta(minutes=30)]
    if not expected:
        return
    ids = {a.employee_id for a,_ in expected}
    last = live._last_scan_by_employee(db,ids,core.to_utc_naive(now-timedelta(hours=30)))
    excused = set(db.execute(select(DailyPresence.employee_id,DailyPresence.presence_date).where(
        DailyPresence.employee_id.in_(ids), DailyPresence.status.in_(live.EXCUSED_STATUSES))).all())
    keys = {f"ABSENT:{a.employee_id}:{a.site_id}:{slot['scheduled_start'].isoformat()}" for a,slot in expected}
    known = set(db.scalars(select(AttendanceAnomaly.dedupe_key).where(AttendanceAnomaly.dedupe_key.in_(keys))))
    employees = {e.id:e for e in db.scalars(select(Employee).where(Employee.id.in_(ids)))}
    for assignment,slot in expected:
        employee = employees.get(assignment.employee_id)
        key = f"ABSENT:{assignment.employee_id}:{assignment.site_id}:{slot['scheduled_start'].isoformat()}"
        event = last.get(assignment.employee_id)
        if key in known or not employee or str(employee.status or '').strip().lower() not in ('actif','active') or (employee.id,slot['work_date']) in excused:
            continue
        if event and event.site_id == assignment.site_id and (event.event_type == EVENT_ARRIVAL or
                ((event.data or {}).get('counted') or {}).get('scheduled_start') == slot['scheduled_start'].isoformat()):
            continue
        core.raise_anomaly(db,anomaly_type='ABSENT',severity='warning',employee=employee,
            site_id=assignment.site_id,presence_date=slot['work_date'],source='SYSTEM',dedupe_key=key,
            message='Non pointé sur la vacation officielle après 30 minutes',
            details={'policy_version':7,'group':assignment.group_code,'scheduled_start':slot['scheduled_start'].isoformat(),
                     'scheduled_end':slot['scheduled_end'].isoformat()})


def publish(db, row):
    """Projections durables OPS/DRH d'une situation V7, sans nouvelle règle de présence."""
    from sqlalchemy import select
    from app.modules.alerts.models import Alert, AlertEvidence, AlertHistory
    from app.modules.alerts.repository import ensure_rule_catalog
    from app.modules.alerts.rules import SITUATION_RULES
    if (row.details or {}).get('policy_version') != 7 or row.anomaly_type == 'ABANDON_POSTE':
        return
    ensure_rule_catalog(db,commit=False)
    for audience,rule in SITUATION_RULES.items():
        key=f'ATTENDANCE_SITUATION:{row.id}:{audience}'
        if db.scalar(select(Alert.id).where(Alert.dedup_key==key)):
            continue
        alert=Alert(rule_key=rule,rule_version=1,source_type='employee',source_id=str(row.employee_id),
            society=row.society or '',site_id=row.site_id,status='open',severity=row.severity,
            score=90 if row.severity=='critical' else 50,confidence=100,
            title=f'{row.anomaly_type} · {audience}'[:240],summary=row.message,dedup_key=key,
            first_detected_at=row.created_at,last_detected_at=row.created_at,occurrence_count=1)
        db.add(alert);db.flush()
        db.add(AlertEvidence(alert_id=alert.id,evidence_type='attendance_anomaly',evidence_key='canonical_situation',
            observed_at=row.created_at,evidence_value_json={**view(row),'audience':audience}))
        db.add(AlertHistory(alert_id=alert.id,action='detected',previous_status=None,new_status='open'))


def close_projections(db,row):
    from sqlalchemy import select
    from app.modules.alerts.models import Alert,AlertHistory
    rows=db.scalars(select(Alert).where(Alert.dedup_key.in_(
        [f'ATTENDANCE_SITUATION:{row.id}:{audience}' for audience in ('OPS','DRH')]),Alert.status!='resolved'))
    for alert in rows:
        previous=alert.status;alert.status='resolved'
        db.add(AlertHistory(alert_id=alert.id,action='resolved',previous_status=previous,new_status='resolved',
                            reason=row.resolution))
