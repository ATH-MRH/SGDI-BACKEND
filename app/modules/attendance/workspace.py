"""Shared, read-only monthly projection of Attendance Core. No BEO store or writes.
Population follows dated assignments; facts remain DailyPresence and AttendanceAnomaly.
The daily pointed/total progression is aggregated over assigned employee-days.
"""
from calendar import monthrange
from datetime import date
import unicodedata
from fastapi import HTTPException
from sqlalchemy import select
from app.modules.attendance import core
from app.modules.attendance import counted as counted_time
from app.modules.attendance.models import AttendanceAnomaly, ANOMALY_OPEN
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site, RotationTemplate

CODES = (
    {"status": "present", "code": "P", "label": "Présent", "tone": "present"},
    {"status": "absent", "code": "A", "label": "Absent", "tone": "absent"},
    {"status": "maladie", "code": "M", "label": "Maladie", "tone": "maladie"},
    {"status": "conge", "code": "C", "label": "Congé", "tone": "conge"},
    {"status": "repos", "code": "R", "label": "Repos", "tone": "repos"},
    {"status": "mission", "code": "MI", "label": "Mission", "tone": "mission"},
)
CODE_MAP = {c["status"]: c["code"] for c in CODES}


def completion(pointed, total):
    # Existing BEO daily progression, Math.round semantics, now shared server-side.
    return int(pointed * 100 / total + .5) if total else 0


def fold(value):
    return "".join(c for c in unicodedata.normalize("NFKD", str(value or "").casefold()) if not unicodedata.combining(c))


def read_workspace(db, *, site_ids, month, q="", employee_status=None, employee_id=None, page=1, page_size=10):
    try:
        year, mo = map(int, month.split("-"))
        first = date(year, mo, 1)
        last = date(year, mo, monthrange(year, mo)[1])
    except (ValueError, TypeError):
        raise HTTPException(422, "Mois invalide (AAAA-MM)")
    days = [date(year, mo, n) for n in range(1, last.day + 1)]
    ids = list(site_ids or [])
    sites = {s.id: s for s in db.scalars(select(Site).where(Site.id.in_(ids or [-1])))}
    assignments = list(db.scalars(select(Assignment).where(
        Assignment.site_id.in_(ids or [-1]), Assignment.active == 1,
        Assignment.start_date <= last, (Assignment.end_date.is_(None)) | (Assignment.end_date >= first)
    ).order_by(Assignment.id)))
    emp_ids = {a.employee_id for a in assignments}
    if employee_id is not None and employee_id not in emp_ids:
        raise HTTPException(404, "Employé hors du périmètre")
    employees = {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_(emp_ids or [-1])))}
    # Warm identity map: planned_day reuses configured rotations, without N+1 SQL.
    rotations = list(db.scalars(select(RotationTemplate).where(RotationTemplate.id.in_({a.rotation_id for a in assignments if a.rotation_id} or [-1]))))
    facts = {(p.employee_id, p.presence_date): p for p in db.scalars(select(DailyPresence).where(
        DailyPresence.site_id.in_(ids or [-1]), DailyPresence.employee_id.in_(emp_ids or [-1]),
        DailyPresence.presence_date >= first, DailyPresence.presence_date <= last
    ).order_by(DailyPresence.id))}
    anomalies = {}
    for a in db.scalars(select(AttendanceAnomaly).where(
        AttendanceAnomaly.site_id.in_(ids or [-1]), AttendanceAnomaly.employee_id.in_(emp_ids or [-1]),
        AttendanceAnomaly.presence_date >= first, AttendanceAnomaly.presence_date <= last,
        AttendanceAnomaly.status == ANOMALY_OPEN
    )):
        anomalies.setdefault((a.employee_id, a.presence_date), []).append({"id": a.id, "type": a.anomaly_type, "message": a.message})
    by_employee = {}
    for a in assignments:
        by_employee.setdefault(a.employee_id, []).append(a)
    rows = []
    summary = {"agents": 0, "recorded": 0, "present": 0, "absent": 0, "anomalies": 0, "total": 0, "completion": 0}
    counts = {c["status"]: 0 for c in CODES}
    society_rows = {}
    for eid, items in by_employee.items():
        e = employees.get(eid)
        if e is None or (employee_id is not None and eid != employee_id):
            continue
        name = " ".join(filter(None, [e.last_name, e.first_name]))
        if employee_status and e.status != employee_status:
            continue
        if q and fold(q) not in fold(name + " " + (e.code or "") + " " + " ".join(sites[a.site_id].name for a in items)):
            continue
        cells = []
        own = {"total": 0, "recorded": 0, **{c["status"]: 0 for c in CODES}}
        for day in days:
            a = next((a for a in reversed(items) if a.start_date <= day and (a.end_date is None or a.end_date >= day)), None)
            if a is None:
                cells.append({"date": day.isoformat(), "available": False, "code": "", "status": "non_pointe"})
                continue
            site = sites[a.site_id]
            plan = core.planned_day(db, a, site, day)
            fact = facts.get((eid, day))
            if fact is not None and fact.site_id != a.site_id:
                fact = None
            status = (fact.status or "present") if fact else ("repos" if plan["known"] and plan["on"] is False else "non_pointe")
            cell = {"date": day.isoformat(), "available": True, "site_id": a.site_id,
                    "status": status, "code": CODE_MAP.get(status, "?" if fact else ""),
                    "recorded": fact is not None, "presence_id": fact.id if fact else None,
                    "closed": bool(fact and fact.closed_at), "planning": plan,
                    "arrival": fact.arrival_time if fact else None, "departure": fact.departure_time if fact else None,
                    "anomalies": anomalies.get((eid, day), []),
                    "counted": counted_time.view((fact.data or {}).get("_legacy")) if fact and isinstance(fact.data, dict) else None,
                    "extra_shift": counted_time.view({"counted": ((fact.data or {}).get("_legacy") or {}).get("countedExtra")}) if fact and isinstance(fact.data, dict) else None}
            cells.append(cell)
            own["total"] += 1
            summary["total"] += 1
            society = (site.equipment_plan or {}).get("societe") or (site.equipment_plan or {}).get("society") or e.society or ""
            sc = society_rows.setdefault(society, {"society": society, "total": 0, "recorded": 0, "agents": set(), **{c["status"]: 0 for c in CODES}})
            sc["agents"].add(eid)
            sc["total"] += 1
            if fact:
                own["recorded"] += 1
                summary["recorded"] += 1
                sc["recorded"] += 1
            if status in counts:
                own[status] += 1
                counts[status] += 1
                sc[status] += 1
            summary["anomalies"] += len(cell["anomalies"])
        own["completion"] = completion(own["recorded"], own["total"])
        last_site = sites[items[-1].site_id]
        rows.append({"employee_id": eid, "name": name, "code": e.code, "employee_status": e.status,
                     "site_id": last_site.id, "site": last_site.name, "days": cells, "totals": own})
    rows.sort(key=lambda r: (fold(r["name"]), r["employee_id"]))
    summary.update(agents=len(rows), present=counts["present"], absent=counts["absent"], completion=completion(summary["recorded"], summary["total"]))
    for sc in society_rows.values():
        sc["agents"] = len(sc["agents"])
        sc["completion"] = completion(sc["recorded"], sc["total"])
    start = (page - 1) * page_size
    return {"month": month, "calendar": [{"date": d.isoformat(), "day": d.day, "weekday": d.weekday(), "weekend": d.weekday() in (4, 5)} for d in days],
            "codes": list(CODES), "summary": summary, "counts": counts, "societies": list(society_rows.values()),
            "employee_statuses": sorted({e.status for e in employees.values() if e.status}),
            "total": len(rows), "page": page, "page_size": page_size, "pages": max(1, -(-len(rows) // page_size)), "items": rows[start:start + page_size]}
