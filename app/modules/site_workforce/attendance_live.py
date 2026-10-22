"""Scoped read-only projection of Attendance Core facts for BEO supervision.

No snapshot store, write, biometric payload, or parallel attendance calculation.
KPI populations use the same open-cycle predicate as Pointeur; daily statuses
and non-pointed days follow the existing administrative workspace.
"""
from datetime import datetime, timedelta
import re
from fastapi import HTTPException
from sqlalchemy.orm import load_only
from sqlalchemy import and_, or_, exists, select
from app.modules.attendance import core, live, official
from app.modules.attendance.models import AttendanceEvent as Event, AttendanceAnomaly as Anomaly, ANOMALY_OPEN, EVENT_ARRIVAL, EVENT_DEPARTURE, SOURCES
from app.modules.attendance.workspace import fold
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, RotationTemplate
from app.modules.site_workforce.security import _active_assignment_filter


def read_live(db, scope, *, q='', group='', movement='', method='', event_status='',
              population='', employee_id=None, before_id=None, limit=50, now=None, photo_allowed=False):
    now = (now or core._now_local()).astimezone(core.TZ)
    today = now.date()
    start = core.to_utc_naive(datetime.combine(today, datetime.min.time(), core.TZ))
    end = core.to_utc_naive(datetime.combine(today + timedelta(days=1), datetime.min.time(), core.TZ))
    sites = {sid: scope.sites[sid] for sid in scope.selected}
    assignments = list(db.scalars(select(Assignment).where(
        Assignment.site_id.in_(list(sites)), *_active_assignment_filter(today)
    ).order_by(Assignment.id)))
    pairs = {(a.employee_id, a.site_id): a for a in assignments}
    employees = {e.id: e for e in db.scalars(select(Employee).options(load_only(Employee.id, Employee.code, Employee.first_name, Employee.last_name, Employee.position)).where(Employee.id.in_({a.employee_id for a in assignments} or {-1})))}
    if employee_id is not None and employee_id not in employees:
        raise HTTPException(404, 'Employé hors du périmètre')
    allowed = {eid for eid, e in employees.items() if (employee_id is None or eid == employee_id)
               and (not q or fold(q) in fold(f'{e.last_name} {e.first_name} {e.code} {e.position or ""}'))}
    selected_assignments = [a for a in assignments if a.employee_id in allowed and (not group or a.group_code == group)]
    allowed = {a.employee_id for a in selected_assignments}
    # SQL pair restriction prevents a group at one site granting access to another group's events.
    def pair_clause(model):
        return exists(select(Assignment.id).where(
            Assignment.employee_id == model.employee_id, Assignment.site_id == model.site_id,
            Assignment.site_id.in_(list(sites)), *_active_assignment_filter(today),
            *([Assignment.group_code == group] if group else [])))
    event_scope = [Event.site_id.in_(list(sites)), Event.employee_id.in_(allowed or {-1}), pair_clause(Event)]
    anomaly_scope = [Anomaly.site_id.in_(list(sites)), Anomaly.employee_id.in_(allowed or {-1}), pair_clause(Anomaly),
                     Anomaly.presence_date == today, Anomaly.status == ANOMALY_OPEN]
    anomalies = list(db.scalars(select(Anomaly).where(*anomaly_scope)))
    facts = list(db.scalars(select(DailyPresence).where(
        DailyPresence.site_id.in_(list(sites)), DailyPresence.employee_id.in_(allowed or {-1}),
        pair_clause(DailyPresence), DailyPresence.presence_date == today)))
    current = live._last_scan_by_employee(db, allowed, since=core.to_utc_naive(now - core.OPEN_24H_CYCLE_MAX))
    present = {eid for eid, e in current.items() if (eid, e.site_id) in pairs and e.site_id in sites
               and (not group or pairs[eid, e.site_id].group_code == group) and live._is_present(e, now, sites)}
    absent = {f.employee_id for f in facts if f.status == 'absent'}
    late = {a.employee_id for a in anomalies if a.anomaly_type == 'LATE'}
    # Existing workspace rule: an assigned day without a fact, unless configured as rest.
    rotations = list(db.scalars(select(RotationTemplate).where(
        RotationTemplate.id.in_({a.rotation_id for a in selected_assignments if a.rotation_id} or {-1}))))
    anchors = official.anchors_for(db, list(sites))
    recorded = {f.employee_id for f in facts}
    not_clocked = {a.employee_id for a in selected_assignments if a.employee_id not in recorded
                   and not (lambda p: p['known'] and p['on'] is False)(core.planned_day(db, a, sites[a.site_id], today, anchors=anchors))}
    counts = live.summary(db, set(sites), now, employee_ids=allowed, event_clause=pair_clause(Event), presence_clause=pair_clause(DailyPresence))
    counts.update(employees=len(allowed), present_now=len(present), absent_today=len(absent), late=len(late),
                  anomalies=len(anomalies), not_clocked=len(not_clocked))
    populations = {'present_now': present, 'absent_today': absent, 'late': late, 'not_clocked': not_clocked}
    visible = populations.get(population, allowed)
    stmt = select(Event).where(*event_scope, Event.employee_id.in_(visible or {-1}),
                               Event.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)),
                               Event.occurred_at >= start, Event.occurred_at < end)
    if movement:
        stmt = stmt.where(Event.event_type == movement)
    if method:
        stmt = stmt.where(Event.source == method)
    anomaly_exists = exists(select(Anomaly.id).where(*anomaly_scope, Anomaly.event_id == Event.id))
    if event_status:
        stmt = stmt.where(anomaly_exists if event_status == 'anomaly' else ~anomaly_exists)
    # Timestamp + ID keyset: delayed/backdated events still sort by occurrence.
    if before_id and not population:
        anchor = db.scalar(select(Event).where(*event_scope, Event.id == before_id))
        if anchor is None:
            raise HTTPException(404, "Curseur hors du périmètre")
        stmt = stmt.where(or_(Event.occurred_at < anchor.occurred_at,
                              and_(Event.occurred_at == anchor.occurred_at, Event.id < anchor.id)))
    rows = list(db.scalars(stmt.order_by(Event.occurred_at.desc(), Event.id.desc()).limit(limit + 1)))
    page = rows[:limit]
    agent_ids = sorted(visible, reverse=True)
    if before_id and population:
        agent_ids = [eid for eid in agent_ids if eid < before_id]
    # Only photographs for the returned page, through the canonical permission-gated route.
    from app.modules.ops.employee_photos import canonical_photos
    photo_ids = {e.employee_id for e in page} | set(agent_ids[:limit])
    photos = canonical_photos(db, photo_ids) if photo_allowed else {}
    def agent(eid):
        e = employees[eid]
        return {'id': e.id, 'matricule': e.code, 'nom': e.last_name, 'prenom': e.first_name,
                'poste': e.position, 'photo_url': f'/api/site-workforce/positions/{eid}/photo' if photos.get(eid) else None}
    def event_out(e):
        problems = [a for a in anomalies if a.event_id == e.id]
        terminal = str((e.data or {}).get("terminal_name") or "") if isinstance(e.data, dict) else ""
        terminal = terminal if re.fullmatch(r"[\w -]{1,80}", terminal) else None
        return {'id': e.id, 'occurred_at': core.to_local(e.occurred_at).isoformat(),
                'employee': agent(e.employee_id), 'movement': e.event_type, 'method': e.source,
                'status': 'anomaly' if problems else 'recorded', **scope.label(e.site_id),
                'group': pairs[e.employee_id, e.site_id].group_code, 'terminal': terminal,
                'anomalies': [{'type': a.anomaly_type, 'message': a.message, 'severity': a.severity} for a in problems]}
    # Population lists are paginated too, including agents with no events.
    return {'generated_at': now.isoformat(), 'summary': counts, 'events': [event_out(e) for e in page],
            'agents': [agent(eid) for eid in agent_ids[:limit]] if population else [],
            'next_before_id': (agent_ids[limit-1] if len(agent_ids) > limit else None) if population else (page[-1].id if len(rows) > limit else None),
            'population': population, 'employee': agent(employee_id) if employee_id in allowed else None,
            'filters': {'groups': sorted({a.group_code for a in assignments if a.group_code}),
                        'methods': sorted(SOURCES), 'sites': [scope.label(sid) for sid in sites]},
            'permissions': {'write': False}}
