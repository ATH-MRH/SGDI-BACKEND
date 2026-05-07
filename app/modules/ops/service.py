from datetime import date, datetime
from typing import Any, Type

from fastapi import HTTPException
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Event, Site, SitePost


def list_rows(db: Session, model: Type, filters: dict[str, Any] | None = None):
    stmt = select(model)
    for key, value in (filters or {}).items():
        if value not in (None, "") and hasattr(model, key):
            stmt = stmt.where(getattr(model, key) == value)
    return db.execute(stmt.order_by(model.id.desc())).scalars().all()


def get_or_404(db: Session, model: Type, row_id: int):
    row = db.get(model, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    return row


def create_row(db: Session, model: Type, payload: Any):
    row = model(**payload.model_dump(exclude_unset=True))
    if isinstance(row, SitePost):
        row.total_count = compute_post_total(row.day_count, row.night_count, row.rotation_system)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_row(db: Session, model: Type, row_id: int, payload: Any):
    row = get_or_404(db, model, row_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def compute_post_total(day_count: int, night_count: int, rotation_system: str | None) -> int:
    if rotation_system == "1/1":
        return day_count
    return (day_count + night_count) * 2


def dashboard(db: Session):
    active_sites = db.scalar(select(func.count(Site.id)).where(Site.active == 1)) or 0
    active_assignments = db.scalar(select(func.count(Assignment.id)).where(Assignment.active == 1)) or 0
    open_events = db.scalar(select(func.count(Event.id)).where(Event.status == "ouvert")) or 0
    today_rows = db.scalar(select(func.count(DailyPresence.id)).where(DailyPresence.presence_date == date.today())) or 0
    return {
        "active_sites": active_sites,
        "active_assignments": active_assignments,
        "open_events": open_events,
        "daily_presence_rows_today": today_rows,
    }


def site_situation(db: Session, site_id: int):
    site = get_or_404(db, Site, site_id)
    assignments = list_rows(db, Assignment, {"site_id": site_id, "active": 1})
    by_group: dict[str, list[dict[str, Any]]] = {"A": [], "B": [], "C": [], "D": []}
    for assignment in assignments:
        employee = db.get(Employee, assignment.employee_id)
        if employee:
            by_group.setdefault(assignment.group_code, []).append(
                {
                    "assignment_id": assignment.id,
                    "employee_id": employee.id,
                    "code": employee.code,
                    "name": f"{employee.last_name} {employee.first_name}",
                    "position": assignment.position or employee.position,
                    "start_date": assignment.start_date,
                }
            )
    realized = len(assignments)
    missing = max((site.contractual_staff or 0) - realized, 0)
    return {
        "site": site,
        "contractual_staff": site.contractual_staff,
        "realized_staff": realized,
        "missing_staff": missing,
        "by_group": by_group,
    }


def general_sites_situation(db: Session):
    sites = db.execute(select(Site)).scalars().all()
    rows = [site_situation(db, s.id) for s in sites]
    return {
        "active_sites": sum(1 for s in sites if s.active),
        "operational_sites": sum(1 for r in rows if r["missing_staff"] == 0),
        "contractual_staff": sum(r["contractual_staff"] or 0 for r in rows),
        "realized_staff": sum(r["realized_staff"] for r in rows),
        "missing_staff": sum(r["missing_staff"] for r in rows),
        "sites": rows,
    }


def generate_daily_presence(db: Session, presence_date: date):
    assignments = db.execute(
        select(Assignment).where(
            Assignment.active == 1,
            Assignment.start_date <= presence_date,
            (Assignment.end_date.is_(None)) | (Assignment.end_date >= presence_date),
        )
    ).scalars().all()
    created = 0
    for assignment in assignments:
        exists = db.scalar(
            select(func.count(DailyPresence.id)).where(
                and_(
                    DailyPresence.presence_date == presence_date,
                    DailyPresence.employee_id == assignment.employee_id,
                )
            )
        )
        if exists:
            continue
        db.add(
            DailyPresence(
                presence_date=presence_date,
                employee_id=assignment.employee_id,
                site_id=assignment.site_id,
                group_code=assignment.group_code,
                generated=1,
                status="present",
            )
        )
        created += 1
    db.commit()
    return {"generated": created, "date": presence_date}


def close_daily_presence(db: Session, presence_date: date):
    rows = db.execute(select(DailyPresence).where(DailyPresence.presence_date == presence_date)).scalars().all()
    now = datetime.utcnow()
    for row in rows:
        row.closed_at = now
    db.commit()
    return {"closed": len(rows), "date": presence_date}

def close_event(db: Session, event_id: int, action_taken: str | None = None):
    event = get_or_404(db, Event, event_id)
    event.status = "clos"
    event.action_taken = action_taken or event.action_taken
    event.closed_at = datetime.utcnow()
    db.commit()
    db.refresh(event)
    return event

