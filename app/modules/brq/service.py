from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.scope_policy import (
    ScopeKind,
    SocietyScopeError,
    effective_society_values,
    society_key,
    society_scope,
)
from app.modules.attendance import core
from app.modules.attendance.models import EVENT_ABANDON, AttendanceEvent
from app.modules.drh.models import Employee
from app.modules.irongs.sql_bridge import flatten_employee_extra
from app.modules.ops.models import Assignment, DailyPresence, Site
from app.modules.ops.routes import _site_society

ACTIVE_EMPLOYEE_STATUSES = frozenset({"actif", "active"})
EXIT_EMPLOYEE_STATUSES = frozenset({
    "sortant", "sorti", "sortie", "demission", "démission", "demissionne",
    "démissionné", "licencie", "licencié",
})
EXCUSED_STATUSES = frozenset({"conge", "maladie", "repos", "mission"})
INACTIVE_EMPLOYEE_STATUSES = frozenset({
    "inactif", "inactive", "sorti", "sortie", "demission", "démission",
    "licencie", "licencié", "archive", "archivé", "archived", "blacklist",
    "suspendu", "suspension",
})


def _site_ids(user: Any) -> set[int]:
    values = user.authorized_sites if isinstance(user.authorized_sites, list) else []
    return {int(value) for value in values if str(value).strip().lstrip("-").isdigit()}


def _exit_date(employee: Employee) -> tuple[date | None, str]:
    value = flatten_employee_extra(employee.extra).get("dateSortie")
    if isinstance(value, datetime):
        return value.date(), "DATE_SORTIE"
    if isinstance(value, date):
        return value, "DATE_SORTIE"
    if isinstance(value, str):
        clean = value.strip()
        for pattern in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y"):
            try:
                return datetime.strptime(clean[:19], pattern).date(), "DATE_SORTIE"
            except ValueError:
                continue
    if str(employee.status or "").strip().casefold() in INACTIVE_EMPLOYEE_STATUSES:
        return None, "INCOMPLET"
    return None, "NON_SORTANT"


def _status(row: DailyPresence | None, plan: dict[str, Any], day: date, now: datetime) -> str:
    if row is not None:
        status = str(row.status or "present").strip().casefold()
        if status in {"present", "absent", *EXCUSED_STATUSES}:
            return status
        return f"statut_inconnu:{status}" if status else "statut_inconnu"
    if not plan.get("known"):
        return "planning_non_defini"
    if plan.get("on") is False:
        return "repos_planifie"
    start = str(plan.get("start_time") or "").strip()
    if not start:
        return "non_pointe"
    try:
        shift_start = datetime.combine(day, time.fromisoformat(start))
    except ValueError:
        return "non_pointe"
    local_now = now.astimezone(core.TZ).replace(tzinfo=None)
    cutoff = shift_start + timedelta(minutes=max(0, int(settings.attendance_late_tolerance_minutes)))
    return "absent" if local_now >= cutoff else "non_pointe"


def _planned_bounds(day: date, plan: dict[str, Any]) -> tuple[datetime | None, datetime | None]:
    try:
        start_time = time.fromisoformat(str(plan.get("start_time") or ""))
        end_time = time.fromisoformat(str(plan.get("end_time") or ""))
    except ValueError:
        return None, None
    start = datetime.combine(day, start_time, tzinfo=core.TZ)
    end = datetime.combine(day, end_time, tzinfo=core.TZ)
    if end <= start:
        end += timedelta(days=1)
    return start, end


def _local_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    return parsed.replace(tzinfo=core.TZ) if parsed.tzinfo is None else parsed.astimezone(core.TZ)


def _availability(day: date, presence: DailyPresence | None, plan: dict[str, Any],
                  abandon: AttendanceEvent | None, now: datetime, *, expected: bool,
                  state: str) -> bool:
    if not expected or state != "present" or presence is None:
        return False

    local_now = now.astimezone(core.TZ)
    _shift_start, shift_end = _planned_bounds(day, plan)
    if day < local_now.date():
        evaluated_at = shift_end or datetime.combine(day, time.max, tzinfo=core.TZ)
    else:
        evaluated_at = local_now

    arrival_time = str(presence.arrival_time or "").strip()
    if arrival_time:
        try:
            arrival_clock = time.fromisoformat(arrival_time)
        except ValueError:
            arrival_clock = None
        if arrival_clock is not None:
            arrival_day = day
            start, end = _planned_bounds(day, plan)
            if start is not None and end is not None and end.date() > day and arrival_clock < start.timetz().replace(tzinfo=None):
                arrival_day += timedelta(days=1)
            arrival_at = datetime.combine(arrival_day, arrival_clock, tzinfo=core.TZ)
            if arrival_at > evaluated_at:
                return False

    if abandon is not None:
        data = abandon.data if isinstance(abandon.data, dict) else {}
        actual_departure = _local_timestamp(data.get("actual_departure_at"))
        if actual_departure is None:
            actual_departure = core.to_local(abandon.occurred_at)
        if actual_departure <= evaluated_at:
            return False
    return True


def _card(employee: Employee, assignment: Assignment, site: Site, day: date,
          presence: DailyPresence | None, plan: dict[str, Any], abandon: AttendanceEvent | None,
          now: datetime) -> dict[str, Any]:
    exit_date, exit_status = _exit_date(employee)
    planned = bool(plan.get("known") and plan.get("on") is True)
    raw_state = _status(presence, plan, day, now)
    state = raw_state
    if abandon is not None and raw_state == "absent":
        state = "abandon_poste"
    elif raw_state == "present" and not planned:
        state = "presence_hors_planning"
    expected = planned and (exit_date is None or exit_date > day)
    return {
        "employee_id": employee.id,
        "matricule": employee.code or "",
        "nom": f"{employee.last_name or ''} {employee.first_name or ''}".strip(),
        "fonction": assignment.position or employee.position or "",
        "society": _site_society(site) or employee.society or "",
        "site_id": site.id,
        "site": site.name or site.indicatif or "",
        "wilaya": site.wilaya or "",
        "state": state,
        "expected": expected,
        "available": _availability(
            day, presence, plan, abandon, now, expected=expected, state=raw_state,
        ),
        "date_sortie": exit_date,
        "sortie_date_status": exit_status,
        "planning": {
            "known": bool(plan.get("known")),
            "working": plan.get("on"),
            "period": plan.get("period") or "",
            "start_time": plan.get("start_time") or "",
            "end_time": plan.get("end_time") or "",
        },
        "arrival": (presence.arrival_time or "") if presence else "",
        "departure": (presence.departure_time or "") if presence else "",
        "abandon": _abandon_card(abandon) if abandon else None,
    }


def _abandon_card(event: AttendanceEvent) -> dict[str, Any]:
    data = event.data if isinstance(event.data, dict) else {}
    actual = data.get("actual_departure_at")
    if not actual:
        actual = core.to_local(event.occurred_at).isoformat(timespec="seconds")
    return {
        "event_id": event.id,
        "actual_departure_at": actual,
        "scheduled_end_at": data.get("scheduled_end_at"),
        "threshold_minutes": data.get("threshold_minutes"),
        "notifications": data.get("notifications") or {},
    }


def _visible_sites(db: Session, user: Any, *, society: str | None,
                   wilaya: str | None, site_id: int | None) -> tuple[dict[int, Site], list[str] | None]:
    scope = society_scope(user)
    if scope.kind is ScopeKind.NONE:
        raise HTTPException(status_code=403, detail="Aucun périmètre société explicite")
    try:
        societies = effective_society_values(user, society)
    except SocietyScopeError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    allowed_sites = _site_ids(user)
    sites = db.execute(select(Site).where(Site.active == 1).order_by(Site.id)).scalars().all()
    if allowed_sites:
        sites = [site for site in sites if site.id in allowed_sites]
    if scope.kind is ScopeKind.LIMITED:
        sites = [
            site for site in sites
            if not _site_society(site) or scope.allows(_site_society(site))
        ]
    if societies is not None:
        keys = {society_key(item) for item in societies}
        sites = [
            site for site in sites
            if not _site_society(site) or society_key(_site_society(site)) in keys
        ]
    if wilaya:
        target = " ".join(wilaya.strip().casefold().split())
        sites = [site for site in sites if " ".join(str(site.wilaya or "").casefold().split()) == target]
    visible = {site.id: site for site in sites}
    if site_id is not None and site_id not in visible:
        raise HTTPException(status_code=403, detail="Site hors du périmètre autorisé")
    if site_id is not None:
        visible = {site_id: visible[site_id]}
    return visible, societies


def _query_assignments(db: Session, day: date, sites: dict[int, Site]) -> list[Assignment]:
    if not sites:
        return []
    return db.execute(
        select(Assignment).where(
            Assignment.site_id.in_(sites),
            Assignment.active == 1,
            Assignment.start_date <= day,
            (Assignment.end_date.is_(None)) | (Assignment.end_date >= day),
        ).order_by(Assignment.id)
    ).scalars().all()


def _filter_employee_society(employee: Employee, site: Site, societies: list[str] | None) -> bool:
    if societies is None:
        return True
    label = _site_society(site) or employee.society or ""
    return society_key(label) in {society_key(value) for value in societies}


def _filter_abandon_society(event: AttendanceEvent, employee: Employee, site: Site | None,
                            societies: list[str] | None) -> bool:
    if societies is None:
        return True
    label = event.society or (_site_society(site) if site else "") or employee.society or ""
    return society_key(label) in {society_key(value) for value in societies}


def build_report(db: Session, user: Any, *, day: date, society: str | None = None,
                 wilaya: str | None = None, site_id: int | None = None) -> dict[str, Any]:
    now = core._now_local()
    sites, societies = _visible_sites(db, user, society=society, wilaya=wilaya, site_id=site_id)
    assignments = _query_assignments(db, day, sites)
    latest: dict[int, Assignment] = {}
    for assignment in assignments:
        latest[assignment.employee_id] = assignment
    employee_ids = set(latest)
    employees = {
        employee.id: employee
        for employee in db.execute(select(Employee).where(Employee.id.in_(employee_ids or {-1}))).scalars()
    }
    presences = {
        row.employee_id: row
        for row in db.execute(select(DailyPresence).where(
            DailyPresence.presence_date == day,
            DailyPresence.employee_id.in_(employee_ids or {-1}),
        ).order_by(DailyPresence.id)).scalars()
    }
    abandon_events = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.event_type == EVENT_ABANDON,
        AttendanceEvent.presence_date == day,
        AttendanceEvent.site_id.in_(sites or {-1}),
    ).order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars().all()
    missing_abandon_employee_ids = {event.employee_id for event in abandon_events} - set(employees)
    if missing_abandon_employee_ids:
        employees.update({
            employee.id: employee
            for employee in db.execute(select(Employee).where(
                Employee.id.in_(missing_abandon_employee_ids),
            )).scalars()
        })
    abandon_events = [
        event for event in abandon_events
        if event.employee_id in employees
        and _filter_abandon_society(event, employees[event.employee_id], sites.get(event.site_id), societies)
    ]
    abandons_by_employee: dict[int, AttendanceEvent] = {}
    for event in abandon_events:
        abandons_by_employee.setdefault(event.employee_id, event)
    abandoned_employee_ids = {event.employee_id for event in abandon_events}

    rows: list[dict[str, Any]] = []
    for employee_id, assignment in latest.items():
        employee = employees.get(employee_id)
        site = sites.get(assignment.site_id)
        employee_status = str(employee.status or "").strip().casefold() if employee else ""
        exit_date, _exit_status = _exit_date(employee) if employee else (None, "INCOMPLET")
        if (
            employee is None
            or site is None
            or (
                employee_status not in ACTIVE_EMPLOYEE_STATUSES
                and not (
                    employee_status in EXIT_EMPLOYEE_STATUSES
                    and exit_date is not None
                    and exit_date >= day
                )
            )
            or not _filter_employee_society(employee, site, societies)
        ):
            continue
        if exit_date is not None and exit_date < day:
            continue
        plan = core.planned_day(db, assignment, site, day)
        rows.append(_card(
            employee, assignment, site, day, presences.get(employee_id), plan,
            abandons_by_employee.get(employee_id), now,
        ))

    return {
        "date": day,
        "timezone": core.TZ_NAME,
        "filters": {"society": society, "wilaya": wilaya, "site_id": site_id},
        "items": rows,
        "abandon_events": abandon_events,
        "abandon_rows": [
            {
                "employee_id": event.employee_id,
                "matricule": employees[event.employee_id].code or "",
                "nom": f"{employees[event.employee_id].last_name or ''} {employees[event.employee_id].first_name or ''}".strip(),
                "fonction": employees[event.employee_id].position or "",
                "society": event.society or "",
                "site_id": event.site_id,
                "site": (sites[event.site_id].name or sites[event.site_id].indicatif or "")
                        if event.site_id in sites else "",
                "wilaya": sites[event.site_id].wilaya or "" if event.site_id in sites else "",
                "state": "abandon_poste",
                "expected": False,
                "available": False,
                "date_sortie": None,
                "sortie_date_status": None,
                "planning": {},
                "arrival": "",
                "departure": "",
                "abandon": _abandon_card(event),
            }
            for event in abandon_events if event.employee_id in employees
        ],
        "sortants": _sortants(db, user, day, society, wilaya, site_id, sites, societies),
        "now": now,
    }


def _sortants(db: Session, user: Any, day: date, society: str | None, wilaya: str | None,
              site_id: int | None, sites: dict[int, Site],
              societies: list[str] | None) -> list[dict[str, Any]]:
    employees = db.execute(select(Employee).order_by(Employee.id)).scalars().all()
    if not employees:
        return []
    assignments = db.execute(select(Assignment).where(
        Assignment.employee_id.in_([employee.id for employee in employees]),
        Assignment.start_date <= day,
    ).order_by(Assignment.start_date, Assignment.id)).scalars().all()
    last_assignment: dict[int, Assignment] = {}
    for assignment in assignments:
        last_assignment[assignment.employee_id] = assignment
    output: list[dict[str, Any]] = []
    for employee in employees:
        exit_date, exit_status = _exit_date(employee)
        employee_status = str(employee.status or "").strip().casefold()
        if exit_date != day and not (
            exit_date is None and employee_status in EXIT_EMPLOYEE_STATUSES
        ):
            continue
        if societies is not None and society_key(employee.society) not in {
            society_key(value) for value in societies
        }:
            continue
        assignment = last_assignment.get(employee.id)
        site = sites.get(assignment.site_id) if assignment else None
        if assignment and site is None:
            continue
        if _site_ids(user) and site is None:
            continue
        if site is not None:
            site_label = _site_society(site) or employee.society or ""
            if societies is not None and society_key(site_label) not in {society_key(v) for v in societies}:
                continue
            if site_id is not None and site.id != site_id:
                continue
            if wilaya and " ".join(str(site.wilaya or "").casefold().split()) != " ".join(wilaya.casefold().split()):
                continue
        output.append({
            "employee_id": employee.id,
            "matricule": employee.code or "",
            "nom": f"{employee.last_name or ''} {employee.first_name or ''}".strip(),
            "fonction": (assignment.position if assignment else None) or employee.position or "",
            "society": (site and _site_society(site)) or employee.society or "",
            "site_id": site.id if site else None,
            "site": (site.name or site.indicatif or "") if site else "",
            "wilaya": (site.wilaya or "") if site else employee.wilaya or "",
            "state": "sortie_effective" if exit_date == day else "incomplet",
            "expected": False,
            "date_sortie": exit_date,
            "sortie_date_status": exit_status,
            "planning": {},
            "arrival": "",
            "departure": "",
            "abandon": None,
        })
    return output


def situation(report: dict[str, Any]) -> dict[str, Any]:
    items = report["items"]
    expected = [item for item in items if item["expected"]]
    present = [item for item in expected if item["state"] == "present"]
    abandon_ids = {
        event.employee_id for event in report["abandon_events"]
    }
    absent = [
        item for item in expected
        if item["state"] == "absent" and item["employee_id"] not in abandon_ids
    ]
    unpointed = [
        item for item in expected
        if item["state"] == "non_pointe" and item["employee_id"] not in abandon_ids
    ]
    exits_today = [item for item in report["sortants"] if item["state"] == "sortie_effective"]
    planned_count = len(expected)
    present_count = len(present)
    available_count = sum(1 for item in expected if item["available"])
    return {
        "date": report["date"],
        "timezone": report["timezone"],
        "filters": report["filters"],
        "items": items,
        "notes": [
            "Les abandons de poste proviennent exclusivement des événements Attendance existants.",
            "La présence historique est conservée après un abandon; la disponibilité cesse à l'heure réelle du départ.",
            "Pour une date passée, la disponibilité est évaluée à la fin de la vacation planifiée; pour aujourd'hui, à l'instant de consultation.",
            "À partir de dateSortie, le salarié est exclu de l'effectif prévu; les sortants du jour restent visibles à cette date exacte.",
        ],
        "kpis": {
            "effectif_prevu": planned_count,
            "presents": present_count,
            "absents": len(absent),
            "non_pointes": len(unpointed),
            "planning_non_defini": sum(1 for item in items if item["state"] == "planning_non_defini"),
            "abandons_poste": len(report["abandon_events"]),
            "sortants": len(exits_today),
            "effectif_disponible": available_count,
            "couverture_pct": round(available_count * 100 / planned_count, 1) if planned_count else None,
            "ecart": available_count - planned_count,
        },
    }


def collection_items(report: dict[str, Any], view: str) -> list[dict[str, Any]]:
    items = report["items"]
    if view == "presences":
        return [item for item in items if item["state"] in {"present", "presence_hors_planning"}]
    if view == "absences":
        abandon_ids = {event.employee_id for event in report["abandon_events"]}
        return [
            item for item in items
            if item["expected"] and item["state"] == "absent" and item["employee_id"] not in abandon_ids
        ]
    if view == "abandons-poste":
        return report["abandon_rows"]
    if view == "sortants":
        return report["sortants"]
    raise HTTPException(status_code=422, detail="Vue BRQ invalide")
