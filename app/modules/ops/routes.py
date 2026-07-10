from datetime import date
import unicodedata

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.pagination import paginate_list, paginate_statement
from app.db.session import get_db
from app.modules.erp.service import unrestricted_scope
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops import iron_sync, service
from app.modules.ops.models import Assignment, DailyPresence, Event, OpsMovement, Site, SitePost
from app.modules.ops.schemas import (
    AssignmentCreate,
    AssignmentOut,
    AssignmentUpdate,
    DailyPresenceCreate,
    DailyPresenceOut,
    DailyPresenceUpdate,
    OpsMovementCreate,
    OpsMovementOut,
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
    if unrestricted_scope(user):
        return []
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [_normalize_society(v) for v in values if _normalize_society(v)]


def _authorized_site_ids(user: User) -> list[int]:
    if unrestricted_scope(user):
        return []
    values = user.authorized_sites if isinstance(user.authorized_sites, list) else []
    return [int(v) for v in values if str(v).strip().lstrip("-").isdigit()]


def _normalize_society(value: object) -> str:
    text = " ".join(str(value or "").strip().upper().split())
    text = "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")
    if text == "IRON GLOBAL SECURITE":
        return "IRON GLOBAL SECURITE"
    return text


def _site_society(site: Site | None) -> str | None:
    plan = site.equipment_plan if site and isinstance(site.equipment_plan, dict) else {}
    legacy = plan.get("_legacy") if isinstance(plan.get("_legacy"), dict) else {}
    return (
        plan.get("societe")
        or plan.get("society")
        or legacy.get("societe")
        or legacy.get("society")
        or None
    )


def _ensure_society_allowed(user: User, society: str | None) -> None:
    if unrestricted_scope(user):
        return
    allowed = _allowed_societies(user)
    if allowed and (not society or _normalize_society(society) not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _ensure_site_allowed(db: Session, user: User, site_id: int | None) -> Site | None:
    if site_id is None:
        return None
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    allowed_ids = _authorized_site_ids(user)
    if allowed_ids:
        if site_id not in allowed_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Site non autorisé")
        return site
    society = _site_society(site)
    if society:
        _ensure_society_allowed(user, society)
    return site


def _ensure_employee_allowed(db: Session, user: User, employee_id: int | None) -> Employee | None:
    if employee_id is None:
        return None
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    _ensure_society_allowed(user, employee.society)
    return employee


def _filter_site_rows(rows: list[Site], user: User, society: str | None = None) -> list[Site]:
    allowed_ids = _authorized_site_ids(user)
    if allowed_ids:
        rows = [row for row in rows if row.id in allowed_ids]
        if society:
            norm = _normalize_society(society)
            rows = [row for row in rows if _normalize_society(_site_society(row)) == norm]
        return rows
    if society:
        norm = _normalize_society(society)
        return [row for row in rows if _normalize_society(_site_society(row)) == norm]
    allowed = _allowed_societies(user)
    if allowed:
        rows = [row for row in rows if _normalize_society(_site_society(row)) in allowed]
    return rows


def _site_matches_query(site: Site, q: str | None) -> bool:
    query = str(q or "").strip().lower()
    if not query:
        return True
    values = [site.name, site.indicatif, site.client_name, site.commune, site.wilaya]
    return any(query in str(value or "").lower() for value in values)


@router.get("/dashboard")
def ops_dashboard(db: Session = Depends(get_db)):
    return service.dashboard(db)


@router.get("/sites/page")
def sites_page(active: int | None = None, society: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.execute(select(Site).order_by(Site.id.desc())).scalars().all()
    if active is not None:
        rows = [row for row in rows if row.active == active]
    rows = _filter_site_rows(rows, user, society)
    rows = [row for row in rows if _site_matches_query(row, q)]
    return paginate_list(rows, page=page, page_size=page_size)


@router.get("/sites", response_model=list[SiteOut])
def sites(active: int | None = None, society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = service.list_rows(db, Site, {"active": active})
    return _filter_site_rows(rows, user, society)


@router.post("/sites", response_model=SiteOut)
def create_site(payload: SiteCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    plan = payload.equipment_plan if isinstance(payload.equipment_plan, dict) else {}
    _ensure_society_allowed(user, plan.get("societe") or plan.get("society"))
    return service.create_row(db, Site, payload)


def _recompute_situation_totals(rows: list) -> dict:
    return {
        "active_sites": sum(1 for r in rows if r["site"].active),
        "instance_assignment_sites": sum(1 for r in rows if r["site"].active and r["realized_staff"] == 0),
        "operational_sites": sum(1 for r in rows if service.site_is_operational(r["site"])),
        "contractual_staff": sum(r["contractual_staff"] or 0 for r in rows),
        "realized_staff": sum(r["realized_staff"] for r in rows),
        "missing_staff": sum(r["missing_staff"] for r in rows),
        "surplus_staff": sum(r.get("surplus_staff", max((r.get("realized_staff") or 0) - (r.get("contractual_staff") or 0), 0)) for r in rows),
        "sites": rows,
    }


@router.get("/sites/situation-generale")
def sites_general_situation(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = service.general_sites_situation(db)
    rows = data.get("sites", [])
    sites = _filter_site_rows([r.get("site") for r in rows if r.get("site")], user, society)
    allowed_site_ids = {site.id for site in sites}
    rows = [r for r in rows if r.get("site") and r["site"].id in allowed_site_ids]

    if _allowed_societies(user) or society:
        return _recompute_situation_totals(rows)
    return data


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
        allowed_site_ids = {row.id for row in service.list_rows(db, Site, {}) if _normalize_society(_site_society(row)) in allowed}
        rows = [row for row in rows if row.site_id in allowed_site_ids]
    return rows


@router.post("/assignments", response_model=AssignmentOut)
def create_assignment(payload: AssignmentCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    site = _ensure_site_allowed(db, user, payload.site_id) if payload.site_id else None
    employee = _ensure_employee_allowed(db, user, payload.employee_id)
    if site and employee and _site_society(site) and employee.society:
        if _normalize_society(_site_society(site)) != _normalize_society(employee.society):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société employé/site incohérente")
    result = service.create_assignment(db, payload)
    if employee and site and _normalize_society(employee.society) == "IRON GLOBAL SECURITE":
        sync_data = iron_sync.build_payload(employee, site, result)
        background_tasks.add_task(iron_sync.push_payload, sync_data)
    return result


@router.patch("/assignments/{assignment_id}", response_model=AssignmentOut)
def update_assignment(assignment_id: int, payload: AssignmentUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    assignment = service.get_or_404(db, Assignment, assignment_id)
    employee = _ensure_employee_allowed(db, user, assignment.employee_id)
    was_active = assignment.active == 1
    going_inactive = payload.active == 0

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(assignment, key, value)
    if going_inactive and not assignment.end_date:
        assignment.end_date = date.today()
    db.commit()
    db.refresh(assignment)

    # Sync "inactif" si : agent Iron Global, affectation vient d'être clôturée, et aucune autre affectation active
    if (was_active and going_inactive
            and employee
            and _normalize_society(employee.society) == "IRON GLOBAL SECURITE"
            and not service.employee_has_active_assignment(db, employee.id)):
        site = db.get(Site, assignment.site_id)
        if site:
            sync_data = iron_sync.build_payload(employee, site, assignment)
            background_tasks.add_task(iron_sync.push_payload, sync_data)
    return assignment


@router.get("/assignments/page")
def assignments_page(site_id: int | None = None, employee_id: int | None = None, active: int | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    stmt = select(Assignment)
    if site_id is not None:
        _ensure_site_allowed(db, user, site_id)
        stmt = stmt.where(Assignment.site_id == site_id)
    elif allowed:
        allowed_site_ids = [s.id for s in db.execute(select(Site)).scalars().all() if _normalize_society(_site_society(s)) in allowed]
        stmt = stmt.where(Assignment.site_id.in_(allowed_site_ids))
    if employee_id is not None:
        _ensure_employee_allowed(db, user, employee_id)
        stmt = stmt.where(Assignment.employee_id == employee_id)
    if active is not None:
        stmt = stmt.where(Assignment.active == active)
    return paginate_statement(db, stmt, model=Assignment, search_fields=[Assignment.group_code, Assignment.position, Assignment.change_reason], q=q, page=page, page_size=page_size)


@router.get("/assignments", response_model=list[AssignmentOut])
def assignments(site_id: int | None = None, employee_id: int | None = None, active: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if site_id:
        _ensure_site_allowed(db, user, site_id)
    if employee_id:
        _ensure_employee_allowed(db, user, employee_id)
    rows = service.list_rows(db, Assignment, {"site_id": site_id, "employee_id": employee_id, "active": active})
    allowed = _allowed_societies(user)
    if allowed and not site_id and not employee_id:
        allowed_site_ids = {s.id for s in db.execute(select(Site)).scalars().all() if _normalize_society(_site_society(s)) in allowed}
        rows = [row for row in rows if row.site_id in allowed_site_ids]
    return rows


@router.post("/pointage/daily/generate")
def generate_daily(presence_date: date | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return service.generate_daily_presence(db, presence_date or date.today())


@router.post("/pointage/daily/generate-rotation")
def generate_daily_rotation(payload: RotationGenerateRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return service.generate_rotation_daily_presence(db, payload)


@router.get("/pointage/standby")
def pointage_standby(presence_date: date | None = None, society: str | None = None, site_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    effective_society = society
    if not effective_society and len(allowed) == 1:
        effective_society = allowed[0]
    if society:
        _ensure_society_allowed(user, society)
    return service.standby_personnel(db, presence_date or date.today(), effective_society, site_id)


@router.post("/pointage/daily/close")
def close_daily(presence_date: date | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return service.close_daily_presence(db, presence_date or date.today())


@router.get("/pointage/daily/page")
def daily_presence_page(presence_date: date | None = None, site_id: int | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if site_id is not None:
        _ensure_site_allowed(db, user, site_id)
    stmt = select(DailyPresence).where(DailyPresence.presence_date == (presence_date or date.today()))
    if site_id is not None:
        stmt = stmt.where(DailyPresence.site_id == site_id)
    return paginate_statement(db, stmt, model=DailyPresence, search_fields=[DailyPresence.group_code, DailyPresence.status, DailyPresence.notes, DailyPresence.faction], q=q, page=page, page_size=page_size)


@router.get("/pointage/daily", response_model=list[DailyPresenceOut])
def daily_presence(presence_date: date | None = None, site_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if site_id:
        _ensure_site_allowed(db, user, site_id)
    return service.list_rows(db, DailyPresence, {"presence_date": presence_date or date.today(), "site_id": site_id})


@router.post("/pointage/daily", response_model=DailyPresenceOut)
def create_daily_presence(payload: DailyPresenceCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if hasattr(payload, "site_id") and payload.site_id:
        _ensure_site_allowed(db, user, payload.site_id)
    return service.create_row(db, DailyPresence, payload)


@router.patch("/pointage/daily/{presence_id}", response_model=DailyPresenceOut)
def update_daily_presence(presence_id: int, payload: DailyPresenceUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
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


@router.get("/movements", response_model=list[OpsMovementOut])
def list_movements(
    society: str | None = None,
    limit: int = 500,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    response: Response = None,
):
    if not unrestricted_scope(user):
        allowed = _allowed_societies(user)
        if allowed and society and _normalize_society(society) not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")
        if not society and allowed:
            society = allowed[0] if len(allowed) == 1 else None
    total = service.count_movements(db, society=society)
    if response is not None:
        response.headers["X-Total-Count"] = str(total)
    return service.list_movements(db, society=society, limit=limit)


@router.post("/movements", response_model=OpsMovementOut)
def upsert_movement(payload: OpsMovementCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    society = str(payload.society or "").strip()
    if society:
        _ensure_society_allowed(user, society)
    # mode="json" : les dates deviennent des chaînes ISO, indispensables car le bridge
    # recopie l'item brut dans la colonne JSON data["_legacy"] (un objet date y casse).
    return service.upsert_movement(db, payload.model_dump(mode="json", exclude_unset=True))
