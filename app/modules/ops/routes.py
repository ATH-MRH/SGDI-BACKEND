from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.pagination import paginate_statement
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops import service
from app.modules.ops.models import Assignment, DailyPresence, Event, Site, SitePost
from app.modules.ops.schemas import (
    AssignmentCreate,
    AssignmentOut,
    DailyPresenceCreate,
    DailyPresenceOut,
    DailyPresenceUpdate,
    RotationGenerateRequest,
    EventCreate,
    EventOut,
    SiteCreate,
    SiteOut,
    SitePostCreate,
    SitePostOut,
    SiteUpdate,
)


router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _site_society(site: Site | None) -> str | None:
    plan = site.equipment_plan if site and isinstance(site.equipment_plan, dict) else {}
    return plan.get("societe") or plan.get("society")


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _ensure_site_allowed(db: Session, user: User, site_id: int | None) -> Site | None:
    if site_id is None:
        return None
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    _ensure_society_allowed(user, _site_society(site))
    return site


def _ensure_employee_allowed(db: Session, user: User, employee_id: int | None) -> Employee | None:
    if employee_id is None:
        return None
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    _ensure_society_allowed(user, employee.society)
    return employee


def _site_scope_statement(stmt, user: User):
    allowed = _allowed_societies(user)
    if allowed:
        stmt = stmt.where(Site.equipment_plan["societe"].as_string().in_(allowed))
    return stmt


@router.get("/dashboard")
def ops_dashboard(db: Session = Depends(get_db)):
    return service.dashboard(db)


@router.get("/sites/page")
def sites_page(active: int | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    stmt = select(Site)
    stmt = _site_scope_statement(stmt, user)
    if active is not None:
        stmt = stmt.where(Site.active == active)
    return paginate_statement(db, stmt, model=Site, search_fields=[Site.name, Site.indicatif, Site.client_name, Site.commune, Site.wilaya], q=q, page=page, page_size=page_size)


@router.get("/sites", response_model=list[SiteOut])
def sites(active: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = service.list_rows(db, Site, {"active": active})
    allowed = _allowed_societies(user)
    if allowed:
        rows = [row for row in rows if _site_society(row) in allowed]
    return rows


@router.post("/sites", response_model=SiteOut)
def create_site(payload: SiteCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    plan = payload.equipment_plan if isinstance(payload.equipment_plan, dict) else {}
    _ensure_society_allowed(user, plan.get("societe") or plan.get("society"))
    return service.create_row(db, Site, payload)


@router.get("/sites/situation-generale")
def sites_general_situation(db: Session = Depends(get_db), user: User = Depends(current_user)):
    if _allowed_societies(user):
        sites = service.list_rows(db, Site, {})
        allowed_ids = {site.id for site in sites if _site_society(site) in _allowed_societies(user)}
        data = service.general_sites_situation(db)
        data["sites"] = [row for row in data.get("sites", []) if getattr(row.get("site"), "id", None) in allowed_ids]
        data["active_sites"] = sum(1 for row in data["sites"] if row["site"].active)
        return data
    return service.general_sites_situation(db)


@router.get("/sites/{site_id}")
def get_site(site_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_site_allowed(db, user, site_id)
    return service.site_situation(db, site_id)


@router.put("/sites/{site_id}", response_model=SiteOut)
def update_site(site_id: int, payload: SiteUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_site_allowed(db, user, site_id)
    plan = payload.equipment_plan if isinstance(payload.equipment_plan, dict) else None
    if plan is not None:
        _ensure_society_allowed(user, plan.get("societe") or plan.get("society"))
    return service.update_row(db, Site, site_id, payload)


@router.delete("/sites/{site_id}")
def delete_site(site_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_site_allowed(db, user, site_id)
    return service.delete_row(db, Site, site_id)


@router.post("/site-posts", response_model=SitePostOut)
def create_site_post(payload: SitePostCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_site_allowed(db, user, payload.site_id)
    return service.create_row(db, SitePost, payload)


@router.get("/site-posts", response_model=list[SitePostOut])
def site_posts(site_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if site_id is not None:
        _ensure_site_allowed(db, user, site_id)
    rows = service.list_rows(db, SitePost, {"site_id": site_id})
    allowed = _allowed_societies(user)
    if allowed and site_id is None:
        allowed_site_ids = {row.id for row in service.list_rows(db, Site, {}) if _site_society(row) in allowed}
        rows = [row for row in rows if row.site_id in allowed_site_ids]
    return rows


@router.post("/assignments", response_model=AssignmentOut)
def create_assignment(payload: AssignmentCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Assignment, payload)


@router.get("/assignments/page")
def assignments_page(site_id: int | None = None, employee_id: int | None = None, active: int | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    stmt = select(Assignment)
    if site_id is not None:
        stmt = stmt.where(Assignment.site_id == site_id)
    if employee_id is not None:
        stmt = stmt.where(Assignment.employee_id == employee_id)
    if active is not None:
        stmt = stmt.where(Assignment.active == active)
    return paginate_statement(db, stmt, model=Assignment, search_fields=[Assignment.group_code, Assignment.position, Assignment.change_reason], q=q, page=page, page_size=page_size)


@router.get("/assignments", response_model=list[AssignmentOut])
def assignments(site_id: int | None = None, employee_id: int | None = None, active: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Assignment, {"site_id": site_id, "employee_id": employee_id, "active": active})


@router.post("/pointage/daily/generate")
def generate_daily(presence_date: date | None = None, db: Session = Depends(get_db)):
    return service.generate_daily_presence(db, presence_date or date.today())


@router.post("/pointage/daily/generate-rotation")
def generate_daily_rotation(payload: RotationGenerateRequest, db: Session = Depends(get_db)):
    return service.generate_rotation_daily_presence(db, payload)


@router.get("/pointage/standby")
def pointage_standby(presence_date: date | None = None, society: str | None = None, site_id: int | None = None, db: Session = Depends(get_db)):
    return service.standby_personnel(db, presence_date or date.today(), society, site_id)


@router.post("/pointage/daily/close")
def close_daily(presence_date: date | None = None, db: Session = Depends(get_db)):
    return service.close_daily_presence(db, presence_date or date.today())


@router.get("/pointage/daily/page")
def daily_presence_page(presence_date: date | None = None, site_id: int | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    stmt = select(DailyPresence).where(DailyPresence.presence_date == (presence_date or date.today()))
    if site_id is not None:
        stmt = stmt.where(DailyPresence.site_id == site_id)
    return paginate_statement(db, stmt, model=DailyPresence, search_fields=[DailyPresence.group_code, DailyPresence.status, DailyPresence.notes, DailyPresence.faction], q=q, page=page, page_size=page_size)


@router.get("/pointage/daily", response_model=list[DailyPresenceOut])
def daily_presence(presence_date: date | None = None, site_id: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, DailyPresence, {"presence_date": presence_date or date.today(), "site_id": site_id})


@router.post("/pointage/daily", response_model=DailyPresenceOut)
def create_daily_presence(payload: DailyPresenceCreate, db: Session = Depends(get_db)):
    return service.create_row(db, DailyPresence, payload)


@router.patch("/pointage/daily/{presence_id}", response_model=DailyPresenceOut)
def update_daily_presence(presence_id: int, payload: DailyPresenceUpdate, db: Session = Depends(get_db)):
    return service.update_row(db, DailyPresence, presence_id, payload)


@router.get("/events/page")
def events_page(status: str | None = None, level: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    stmt = select(Event)
    if status:
        stmt = stmt.where(Event.status == status)
    if level:
        stmt = stmt.where(Event.level == level)
    return paginate_statement(db, stmt, model=Event, search_fields=[Event.event_type, Event.level, Event.title, Event.message, Event.status, Event.action_taken], q=q, page=page, page_size=page_size)


@router.get("/events", response_model=list[EventOut])
def events(status: str | None = None, level: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Event, {"status": status, "level": level})


@router.post("/events", response_model=EventOut)
def create_event(payload: EventCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Event, payload)


@router.post("/events/{event_id}/close", response_model=EventOut)
def close_event(event_id: int, action_taken: str | None = None, db: Session = Depends(get_db)):
    return service.close_event(db, event_id, action_taken)
