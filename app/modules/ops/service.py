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



def delete_row(db: Session, model: Type, row_id: int):
    row = get_or_404(db, model, row_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": row_id}

def compute_post_total(day_count: int, night_count: int, rotation_system: str | None) -> int:
    if rotation_system == "1/1":
        return day_count
    return (day_count + night_count) * 2


def dashboard(db: Session):
    return {
        "active_sites": 0,
        "active_assignments": 0,
        "open_events": 0,
        "daily_presence_rows_today": 0,
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


def rotation_for_date(rotation_system: str | None, group_code: str | None, work_date: date, base_date: date | None = None) -> dict[str, Any]:
    system = rotation_system or "24/48"
    groups = ["A", "B", "C", "D"]
    group = (group_code or "A").upper()[:1]
    idx = groups.index(group) if group in groups else 0
    start = base_date or date(work_date.year, 1, 1)
    diff = max(0, (work_date - start).days)
    weekday = work_date.weekday()
    is_weekend = weekday in (4, 5)  # vendredi/samedi
    if system == "1/1":
        on = idx == 0 and not is_weekend
        return {"on": on, "period": "jour" if on else "recuperation", "faction": "jour" if on else "repos", "recovery": 0 if on else 1}
    if system == "1/3":
        if idx == 0:
            on = not is_weekend
            return {"on": on, "period": "jour" if on else "recuperation", "faction": "jour" if on else "repos", "recovery": 0 if on else 1}
        night_idx = (idx - 1) % 3
        on = diff % 3 == night_idx
        return {"on": on, "period": "nuit" if on else "recuperation", "faction": "nuit" if on else "repos", "recovery": 0 if on else 1}
    if system == "1/2":
        on = diff % 2 == idx % 2
        period = "jour" if idx < 2 else "nuit"
        return {"on": on, "period": period if on else "recuperation", "faction": period if on else "repos", "recovery": 0 if on else 1}
    cycle = ["jour", "nuit", "recuperation", "recuperation"]
    period = cycle[(diff + idx) % len(cycle)]
    on = period in ("jour", "nuit")
    return {"on": on, "period": period, "faction": period if on else "repos", "recovery": 0 if on else 1}


def generate_rotation_daily_presence(db: Session, payload: Any):
    presence_date = payload.presence_date or date.today()
    stmt = select(Assignment).where(
        Assignment.active == 1,
        Assignment.start_date <= presence_date,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= presence_date),
    )
    if payload.site_id:
        stmt = stmt.where(Assignment.site_id == payload.site_id)
    assignments = db.execute(stmt).scalars().all()
    created = updated = skipped = 0
    standby: list[dict[str, Any]] = []
    active_site_ids: set[int] = set()
    for assignment in assignments:
        employee = db.get(Employee, assignment.employee_id)
        site = db.get(Site, assignment.site_id)
        if not employee or not site or site.active != 1:
            skipped += 1
            continue
        site_society = site.equipment_plan.get("societe") if isinstance(site.equipment_plan, dict) else None
        if payload.society and employee.society != payload.society and site_society != payload.society:
            skipped += 1
            continue
        active_site_ids.add(site.id)
        rot = rotation_for_date(site.rotation_system, assignment.group_code, presence_date, assignment.start_date)
        existing = db.execute(select(DailyPresence).where(DailyPresence.presence_date == presence_date, DailyPresence.employee_id == assignment.employee_id).order_by(DailyPresence.id.desc())).scalars().first()
        if not rot["on"]:
            standby.append({
                "employee_id": employee.id,
                "code": employee.code,
                "name": f"{employee.last_name} {employee.first_name}",
                "phone": employee.phone,
                "society": employee.society,
                "site_id": site.id,
                "site_name": site.name,
                "group_code": assignment.group_code,
                "rotation_system": site.rotation_system,
                "reason": "Récupération / astreinte disponible",
            })
            continue
        if existing and existing.closed_at:
            skipped += 1
            continue
        if existing and not payload.overwrite_generated and existing.generated:
            skipped += 1
            continue
        row = existing or DailyPresence(presence_date=presence_date, employee_id=assignment.employee_id)
        row.site_id = assignment.site_id
        row.group_code = assignment.group_code
        row.status = row.status or "present"
        row.generated = 1
        row.rotation_system = site.rotation_system
        row.rotation_group = assignment.group_code
        row.rotation_period = rot["period"]
        row.faction = rot["faction"]
        row.recovery = 0
        row.standby = 0
        row.data = {"generated_by": "rotation", "position": assignment.position, "site_name": site.name}
        if existing:
            updated += 1
        else:
            db.add(row)
            created += 1
    db.commit()
    return {"date": presence_date, "created": created, "updated": updated, "skipped": skipped, "sites": len(active_site_ids), "standby": standby}


def standby_personnel(db: Session, presence_date: date, society: str | None = None, site_id: int | None = None):
    stmt = select(Assignment).where(
        Assignment.active == 1,
        Assignment.start_date <= presence_date,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= presence_date),
    )
    if site_id:
        stmt = stmt.where(Assignment.site_id == site_id)
    rows = []
    assignments = db.execute(stmt).scalars().all()
    used = {
        row.employee_id
        for row in db.execute(select(DailyPresence).where(DailyPresence.presence_date == presence_date)).scalars().all()
        if row.employee_id
    }
    for assignment in assignments:
        if assignment.employee_id in used:
            continue
        employee = db.get(Employee, assignment.employee_id)
        site = db.get(Site, assignment.site_id)
        if not employee or not site or site.active != 1:
            continue
        site_society = site.equipment_plan.get("societe") if isinstance(site.equipment_plan, dict) else None
        if society and employee.society != society and site_society != society:
            continue
        rot = rotation_for_date(site.rotation_system, assignment.group_code, presence_date, assignment.start_date)
        if rot["on"]:
            continue
        rows.append({
            "employee_id": employee.id,
            "code": employee.code,
            "name": f"{employee.last_name} {employee.first_name}",
            "phone": employee.phone,
            "society": employee.society,
            "site_id": site.id,
            "site_name": site.name,
            "group_code": assignment.group_code,
            "rotation_system": site.rotation_system,
            "period": rot["period"],
            "reason": "Récupération / astreinte disponible",
        })
    return rows


def close_event(db: Session, event_id: int, action_taken: str | None = None):
    event = get_or_404(db, Event, event_id)
    event.status = "clos"
    event.action_taken = action_taken or event.action_taken
    event.closed_at = datetime.utcnow()
    db.commit()
    db.refresh(event)
    return event
