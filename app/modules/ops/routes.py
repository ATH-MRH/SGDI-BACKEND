from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.pagination import paginate_statement
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
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


@router.get("/dashboard")
def ops_dashboard(db: Session = Depends(get_db)):
    return service.dashboard(db)


@router.get("/sites/page")
def sites_page(active: int | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    stmt = select(Site)
    if active is not None:
        stmt = stmt.where(Site.active == active)
    return paginate_statement(db, stmt, model=Site, search_fields=[Site.name, Site.indicatif, Site.client_name, Site.commune, Site.wilaya], q=q, page=page, page_size=page_size)


@router.get("/sites", response_model=list[SiteOut])
def sites(active: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Site, {"active": active})


@router.post("/sites", response_model=SiteOut)
def create_site(payload: SiteCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Site, payload)


@router.get("/sites/situation-generale")
def sites_general_situation(db: Session = Depends(get_db)):
    return service.general_sites_situation(db)


@router.get("/sites/{site_id}")
def get_site(site_id: int, db: Session = Depends(get_db)):
    return service.site_situation(db, site_id)


@router.put("/sites/{site_id}", response_model=SiteOut)
def update_site(site_id: int, payload: SiteUpdate, db: Session = Depends(get_db)):
    return service.update_row(db, Site, site_id, payload)


@router.delete("/sites/{site_id}")
def delete_site(site_id: int, db: Session = Depends(get_db)):
    return service.delete_row(db, Site, site_id)


@router.post("/site-posts", response_model=SitePostOut)
def create_site_post(payload: SitePostCreate, db: Session = Depends(get_db)):
    return service.create_row(db, SitePost, payload)


@router.get("/site-posts", response_model=list[SitePostOut])
def site_posts(site_id: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, SitePost, {"site_id": site_id})


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
