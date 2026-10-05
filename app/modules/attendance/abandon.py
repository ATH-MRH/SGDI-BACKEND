"""Abandon de poste : qualification d'une sortie, dans la transaction Attendance Core.

La vacation est l'instantané de l'arrivée ; aucune vacation n'est inventée.
Les transmissions sont des alertes durables du cockpit existant, pas des emails.
"""
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select

from app.core.audit import append_audit
from app.core.scope_policy import society_key
from app.modules.attendance.models import AttendanceEvent, EVENT_ARRIVAL, EVENT_ABANDON, SOURCE_POINTER


def context(db, employee, *, now=None):
    from app.modules.attendance import core
    from app.modules.ops.models import Site
    from app.modules.ops.routes import _site_society

    now = now or core._now_local()
    events = core._last_scan_events(db, employee.id)
    arrival = events[-1] if events else None
    if arrival is None or arrival.event_type != EVENT_ARRIVAL:
        raise HTTPException(409, "Abandon de poste refusé : aucune prise de service ouverte")
    assignment = core.active_assignment(db, employee.id)
    site = db.get(Site, arrival.site_id) if arrival.site_id else None
    if not assignment or not site or not site.active or assignment.site_id != site.id:
        raise HTTPException(409, "Vacation hors de l’affectation actuelle")
    if (assignment.start_date > arrival.presence_date
            or (assignment.end_date is not None and assignment.end_date < arrival.presence_date)):
        raise HTTPException(409, "Affectation non valide pour cette vacation")
    if (society_key(arrival.society) != society_key(employee.society)
            or society_key(_site_society(site)) != society_key(employee.society)):
        raise HTTPException(409, "Société de la vacation incohérente")
    snapshot = (arrival.data or {}).get("counted")
    if not isinstance(snapshot, dict) or not snapshot.get("scheduled_start") or not snapshot.get("scheduled_end"):
        raise HTTPException(409, "Abandon de poste refusé : aucune vacation valide enregistrée")
    start, end = (datetime.fromisoformat(snapshot[key]) for key in ("scheduled_start", "scheduled_end"))
    if now < start or now < core.to_local(arrival.occurred_at) or now >= end:
        raise HTTPException(409, "Abandon de poste refusé : vacation non commencée ou déjà terminée")
    presence = core._presence_for(db, employee.id, arrival.presence_date)
    if presence is None or presence.closed_at is not None:
        raise HTTPException(409, "Abandon de poste refusé : présence inexistante ou journée clôturée")
    remaining = (end - now).total_seconds() / 60
    threshold = core.settings.attendance_abandon_threshold_minutes
    return {
        "shift_id": arrival.id, "scheduled_start_at": start.isoformat(), "scheduled_end_at": end.isoformat(),
        "actual_departure_at": now.isoformat(), "remaining_minutes": remaining,
        "threshold_minutes": threshold, "applicable": end - now >= timedelta(minutes=threshold),
        "employee_id": employee.id, "matricule": employee.code,
        "employee_name": f"{employee.last_name or ''} {employee.first_name or ''}".strip(),
        "society": employee.society, "site_id": site.id, "site_name": site.name or site.indicatif or "",
        "position": employee.position or "", "shift": snapshot.get("shift"), "group": snapshot.get("group"),
    }


def existing(db, employee_id, shift_id):
    return db.scalar(select(AttendanceEvent).where(
        AttendanceEvent.source == SOURCE_POINTER,
        AttendanceEvent.idempotency_key == f"abandon:{employee_id}:{shift_id}",
        AttendanceEvent.employee_id == employee_id, AttendanceEvent.event_type == EVENT_ABANDON))


def response(event, *, duplicate=False):
    return {"success": True, "duplicate": duplicate, "event_id": event.id,
            "action": "abandon_poste", "message": "ABANDON DE POSTE ENREGISTRÉ",
            "observation": event.observation, **event.data}


def record(db, *, departure, employee, actor, details):
    """Appelé avant le commit du départ : fait, alertes et audit sont atomiques."""
    from app.modules.attendance import core
    from app.modules.alerts.models import Alert, AlertEvidence, AlertHistory
    from app.modules.alerts.repository import ensure_rule_catalog
    from app.modules.alerts.rules import ABANDON_RULES

    ensure_rule_catalog(db, commit=False)
    now = departure.occurred_at
    data = {**details, "departure_event_id": departure.id,
            "recorded_by_role": getattr(actor, "role", None), "recorded_by_user_id": getattr(actor, "id", None),
            "recorded_by": getattr(actor, "username", None), "source": SOURCE_POINTER,
            "notifications": {}}
    event = AttendanceEvent(employee_id=employee.id, society=employee.society, site_id=departure.site_id,
        presence_id=departure.presence_id, presence_date=departure.presence_date, occurred_at=now,
        event_type=EVENT_ABANDON, source=SOURCE_POINTER,
        idempotency_key=f"abandon:{employee.id}:{details['shift_id']}", cycle=departure.cycle,
        actor_user_id=departure.actor_user_id, actor_label=departure.actor_label,
        observation=departure.observation, data={**data, "notifications": {}})
    db.add(event); db.flush()
    for audience, rule in ABANDON_RULES.items():
        alert = Alert(rule_key=rule, rule_version=1, source_type="employee", source_id=str(employee.id),
            society=employee.society or "", site_id=departure.site_id, status="open", severity="warning",
            score=80, confidence=100, title=f"ABANDON DE POSTE · {audience} · {details['employee_name']}"[:240],
            summary=(f"Matricule : {employee.code} · Société : {employee.society} · Site : {details['site_name']}\n"
                     f"Départ : {details['actual_departure_at']} · Fin prévue : {details['scheduled_end_at']} · "
                     f"Temps restant : {details['remaining_minutes']:.1f} min\n"
                     f"Observation : {departure.observation}\nSignalé par : {departure.actor_label}"),
            first_detected_at=now, last_detected_at=now, occurrence_count=1,
            dedup_key=f"ABANDON_POSTE:{event.id}:{audience}")
        db.add(alert); db.flush()
        db.add(AlertEvidence(alert_id=alert.id, evidence_type="attendance_event", evidence_key="detection_snapshot",
                            observed_at=now, evidence_value_json={**details, "event_id": event.id,
                                "event_type": EVENT_ABANDON, "audience": audience, "observation": event.observation,
                                "recorded_by": departure.actor_label}))
        db.add(AlertHistory(alert_id=alert.id, action="detected", previous_status=None, new_status="open",
                            actor_user_id=departure.actor_user_id))
        data["notifications"][audience] = {"status": "CREATED", "alert_id": alert.id}
    event.data = dict(data)
    core.raise_anomaly(db, anomaly_type=EVENT_ABANDON, employee=employee, site_id=departure.site_id,
        presence_date=departure.presence_date, event=event, source=SOURCE_POINTER,
        message="Abandon de poste", details=details, dedupe_key=event.idempotency_key)
    append_audit(db, action="attendance.abandon_poste", resource="attendance_event", resource_id=event.id,
                 result="success", user=actor, society=employee.society,
                 new_state={**data, "observation": event.observation, "event_type": EVENT_ABANDON})
    return event
