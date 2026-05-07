from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.ops import service
from app.modules.ops.models import Assignment, DailyPresence, Event, Site, SitePost
from app.modules.ops.schemas import (
    AssignmentCreate,
    AssignmentOut,
    DailyPresenceCreate,
    DailyPresenceOut,
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


@router.post("/site-posts", response_model=SitePostOut)
def create_site_post(payload: SitePostCreate, db: Session = Depends(get_db)):
    return service.create_row(db, SitePost, payload)


@router.get("/site-posts", response_model=list[SitePostOut])
def site_posts(site_id: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, SitePost, {"site_id": site_id})


@router.post("/assignments", response_model=AssignmentOut)
def create_assignment(payload: AssignmentCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Assignment, payload)


@router.get("/assignments", response_model=list[AssignmentOut])
def assignments(site_id: int | None = None, employee_id: int | None = None, active: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Assignment, {"site_id": site_id, "employee_id": employee_id, "active": active})


@router.post("/pointage/daily/generate")
def generate_daily(presence_date: date | None = None, db: Session = Depends(get_db)):
    return service.generate_daily_presence(db, presence_date or date.today())


@router.post("/pointage/daily/close")
def close_daily(presence_date: date | None = None, db: Session = Depends(get_db)):
    return service.close_daily_presence(db, presence_date or date.today())


@router.get("/pointage/daily", response_model=list[DailyPresenceOut])
def daily_presence(presence_date: date | None = None, site_id: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, DailyPresence, {"presence_date": presence_date or date.today(), "site_id": site_id})


@router.post("/pointage/daily", response_model=DailyPresenceOut)
def create_daily_presence(payload: DailyPresenceCreate, db: Session = Depends(get_db)):
    return service.create_row(db, DailyPresence, payload)


@router.get("/events", response_model=list[EventOut])
def events(status: str | None = None, level: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Event, {"status": status, "level": level})


@router.post("/events", response_model=EventOut)
def create_event(payload: EventCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Event, payload)


@router.post("/events/{event_id}/close", response_model=EventOut)
def close_event(event_id: int, action_taken: str | None = None, db: Session = Depends(get_db)):
    return service.close_event(db, event_id, action_taken)
