"""API Attendance — centre de contrôle (pointage.irongs.com) et Employé 360.

Lecture et pilotage de la présence canonique (DailyPresence + journal d'événements). Toute
écriture passe par app/modules/attendance/core.py. Périmètre : sites autorisés du compte
(authorized_sites) ou sa société — même règle que le module OPS
(_allowed_assignment_site_ids : None = compte global).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.attendance import core, deviations, learning, projection, sheets
from app.modules.attendance.models import (
    ANOMALY_DISMISSED,
    ANOMALY_OPEN,
    ANOMALY_RESOLVED,
    EVENT_ARRIVAL,
    EVENT_DEPARTURE,
    SOURCE_MANUAL,
    SOURCE_SYSTEM,
    SHEET_STATUSES,
    AttendanceAnomaly,
    AttendanceEvent,
    AttendanceSheet,
    AttendanceSheetLine,
    CHECK_DEVIATIONS,
    DEVIATION_STATUSES,
    RotationCheck,
    RotationMembership,
    RotationModelVersion,
    RotationSetting,
)
from app.core.audit import append_audit
from app.modules.auth.dependencies import AUTHORIZED_ACTIONS, current_user
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site
from app.modules.ops.routes import _allowed_assignment_site_ids, _ensure_site_allowed, _site_society

from app.modules.attendance.pointer_users import router as pointer_users_router

router = APIRouter()
router.include_router(pointer_users_router)

KPI_STATUSES = ("present", "absent", "conge", "maladie", "repos", "mission")


def _require_action(user: User, action: str) -> None:
    """Action au-delà de la déduction HTTP (ex. correction d'une journée clôturée) : même
    politique authorized_actions que le reste du backend (liste vide = profil)."""
    actions = [str(v).strip().lower() for v in (user.authorized_actions or [])]
    actions = [v for v in actions if v in AUTHORIZED_ACTIONS]
    if actions and action not in actions and "admin" not in actions:
        raise HTTPException(status_code=403, detail=f"Action non autorisée : {action}")


def _scope(db: Session, user: User, site_id: int | None) -> list[int] | None:
    """Sites visibles pour la requête. None = compte global sans filtre."""
    if site_id is not None:
        _ensure_site_allowed(db, user, site_id)
        return [site_id]
    return _allowed_assignment_site_ids(db, user)


def _presence_in_scope(db: Session, user: User, row: DailyPresence) -> None:
    allowed = _allowed_assignment_site_ids(db, user)
    if allowed is None:
        return
    if row.site_id is None or row.site_id not in set(allowed):
        raise HTTPException(status_code=404, detail="Pointage introuvable")


def _local_hhmm(value: datetime | None) -> str:
    return core.to_local(value).strftime("%H:%M") if value else ""


# ── Tableau du jour ──────────────────────────────────────────────────────────────────────
@router.get("/board")
def board(
    presence_date: date | None = None,
    site_id: int | None = None,
    society: str | None = None,
    status: str | None = None,
    source: str | None = None,
    anomaly: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Situation d'une journée : population = affectations actives du périmètre. KPI calculés
    sur TOUTE la population filtrée côté serveur (jamais sur la page affichée)."""
    day = presence_date or core._now_local().date()
    site_ids = _scope(db, user, site_id)
    stmt = select(Assignment).where(
        Assignment.active == 1, Assignment.start_date <= day,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= day),
    )
    if site_ids is not None:
        if not site_ids:
            return _empty_board(day, page, page_size)
        stmt = stmt.where(Assignment.site_id.in_(site_ids))
    assignments = db.execute(stmt.order_by(Assignment.id)).scalars().all()
    by_employee: dict[int, Assignment] = {}
    for a in assignments:  # une ligne par employé (dernière affectation active)
        by_employee[a.employee_id] = a
    employee_ids = list(by_employee)
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_(employee_ids))).scalars()} if employee_ids else {}
    sites = {s.id: s for s in db.execute(select(Site).where(Site.id.in_({a.site_id for a in by_employee.values()}))).scalars()} if by_employee else {}
    presences = {p.employee_id: p for p in db.execute(select(DailyPresence).where(
        DailyPresence.presence_date == day, DailyPresence.employee_id.in_(employee_ids)).order_by(DailyPresence.id)).scalars()} if employee_ids else {}
    events: dict[int, list[AttendanceEvent]] = {}
    for ev in (db.execute(select(AttendanceEvent).where(
            AttendanceEvent.presence_date == day, AttendanceEvent.employee_id.in_(employee_ids)
    ).order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars() if employee_ids else []):
        events.setdefault(ev.employee_id, []).append(ev)
    open_anomalies: dict[int, list[AttendanceAnomaly]] = {}
    for an in (db.execute(select(AttendanceAnomaly).where(
            AttendanceAnomaly.presence_date == day, AttendanceAnomaly.status == ANOMALY_OPEN,
            AttendanceAnomaly.employee_id.in_(employee_ids))).scalars() if employee_ids else []):
        open_anomalies.setdefault(an.employee_id, []).append(an)

    rows: list[dict[str, Any]] = []
    for employee_id, assignment in by_employee.items():
        employee = employees.get(employee_id)
        site = sites.get(assignment.site_id)
        if not employee or not site:
            continue
        site_society = _site_society(site) or employee.society or ""
        if society and site_society != society and employee.society != society:
            continue
        plan = core.planned_day(db, assignment, site, day)
        presence = presences.get(employee_id)
        evs = events.get(employee_id, [])
        arrivals = [e for e in evs if e.event_type == EVENT_ARRIVAL]
        departures = [e for e in evs if e.event_type == EVENT_DEPARTURE]
        last_source = evs[-1].source if evs else ""
        if presence:
            day_status = presence.status or "present"
        elif plan["known"] and plan["on"] is False:
            day_status = "repos"
        else:
            day_status = "non_pointe"
        incomplete = bool(arrivals) and not departures and day < core._now_local().date()
        anomalies = open_anomalies.get(employee_id, [])
        rows.append({
            "employee_id": employee_id, "matricule": employee.code,
            "nom": f"{employee.last_name or ''} {employee.first_name or ''}".strip(),
            "fonction": assignment.position or employee.position or "",
            "society": site_society, "site_id": site.id, "site": site.name,
            "planning": {"known": plan["known"], "working": plan["on"], "period": plan["period"],
                         "start_time": plan["start_time"], "end_time": plan["end_time"]},
            "arrival": _local_hhmm(arrivals[0].occurred_at) if arrivals else (presence.arrival_time if presence and presence.arrival_time not in (None, "P") else ""),
            "departure": _local_hhmm(departures[-1].occurred_at) if departures else (presence.departure_time or "" if presence else ""),
            "status": day_status, "source": last_source, "incomplete": incomplete,
            "closed": bool(presence and presence.closed_at), "presence_id": presence.id if presence else None,
            "anomalies": [{"id": a.id, "type": a.anomaly_type, "severity": a.severity, "message": a.message} for a in anomalies],
        })

    expected = [r for r in rows if r["planning"]["working"] is not False]
    kpi = {
        "expected": len(expected),
        "present": sum(1 for r in rows if r["status"] == "present"),
        "absent": sum(1 for r in rows if r["status"] == "absent"),
        "not_pointed": sum(1 for r in expected if r["status"] == "non_pointe"),
        "late": sum(1 for r in rows if any(a["type"] == "LATE" for a in r["anomalies"])),
        "conge": sum(1 for r in rows if r["status"] == "conge"),
        "maladie": sum(1 for r in rows if r["status"] == "maladie"),
        "repos": sum(1 for r in rows if r["status"] == "repos"),
        "anomalies": sum(len(r["anomalies"]) for r in rows),
        "incomplete": sum(1 for r in rows if r["incomplete"]),
    }
    filtered = rows
    if status:
        filtered = [r for r in filtered if r["status"] == status]
    if source:
        filtered = [r for r in filtered if r["source"] == source]
    if anomaly:
        filtered = [r for r in filtered if (r["anomalies"] if anomaly == "any" else any(a["type"] == anomaly for a in r["anomalies"]))]
    if q:
        needle = q.strip().lower()
        filtered = [r for r in filtered if needle in r["nom"].lower() or needle in (r["matricule"] or "").lower()]
    filtered.sort(key=lambda r: (r["site"], r["nom"]))
    total = len(filtered)
    start = (page - 1) * page_size
    return {"date": day.isoformat(), "kpi": kpi, "total": total, "page": page, "page_size": page_size,
            "pages": max(1, -(-total // page_size)), "items": filtered[start:start + page_size]}


def _empty_board(day: date, page: int, page_size: int) -> dict[str, Any]:
    kpi = {k: 0 for k in ("expected", "present", "absent", "not_pointed", "late", "conge", "maladie", "repos", "anomalies", "incomplete")}
    return {"date": day.isoformat(), "kpi": kpi, "total": 0, "page": page, "page_size": page_size, "pages": 1, "items": []}


@router.get("/sites")
def sites(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    allowed = _allowed_assignment_site_ids(db, user)
    stmt = select(Site).where(Site.active == 1)
    if allowed is not None:
        if not allowed:
            return []
        stmt = stmt.where(Site.id.in_(allowed))
    return [{"id": s.id, "name": s.name, "society": _site_society(s) or ""} for s in db.execute(stmt.order_by(Site.name)).scalars()]


# ── Anomalies ────────────────────────────────────────────────────────────────────────────
class AnomalyResolution(BaseModel):
    status: str = Field(ANOMALY_RESOLVED)
    resolution: str = Field(min_length=3, max_length=2000)


def _anomaly_out(a: AttendanceAnomaly, employee: Employee | None, site: Site | None) -> dict[str, Any]:
    return {
        "id": a.id, "type": a.anomaly_type, "severity": a.severity, "status": a.status, "message": a.message,
        "employee_id": a.employee_id, "matricule": employee.code if employee else "",
        "nom": f"{employee.last_name or ''} {employee.first_name or ''}".strip() if employee else "",
        "site_id": a.site_id, "site": site.name if site else "", "date": a.presence_date.isoformat() if a.presence_date else "",
        "source": a.source or "", "details": a.details or {}, "resolution": a.resolution or "",
        "resolved_by": a.resolved_by or "", "resolved_at": a.resolved_at.isoformat() if a.resolved_at else "",
        "created_at": a.created_at.isoformat() if a.created_at else "",
    }


@router.get("/anomalies")
def anomalies(
    date_from: date | None = None, date_to: date | None = None, site_id: int | None = None,
    status: str | None = ANOMALY_OPEN, anomaly_type: str | None = None,
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db), user: User = Depends(current_user),
) -> dict[str, Any]:
    site_ids = _scope(db, user, site_id)
    stmt = select(AttendanceAnomaly)
    if site_ids is not None:
        if not site_ids:
            return {"total": 0, "page": page, "page_size": page_size, "pages": 1, "items": []}
        stmt = stmt.where(AttendanceAnomaly.site_id.in_(site_ids))
    if date_from:
        stmt = stmt.where(AttendanceAnomaly.presence_date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceAnomaly.presence_date <= date_to)
    if status:
        stmt = stmt.where(AttendanceAnomaly.status == status)
    if anomaly_type:
        stmt = stmt.where(AttendanceAnomaly.anomaly_type == anomaly_type)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(AttendanceAnomaly.presence_date.desc(), AttendanceAnomaly.id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).scalars().all()
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_({r.employee_id for r in rows if r.employee_id}))).scalars()} if rows else {}
    site_map = {s.id: s for s in db.execute(select(Site).where(Site.id.in_({r.site_id for r in rows if r.site_id}))).scalars()} if rows else {}
    return {"total": total, "page": page, "page_size": page_size, "pages": max(1, -(-total // page_size)),
            "items": [_anomaly_out(r, employees.get(r.employee_id), site_map.get(r.site_id)) for r in rows]}


@router.patch("/anomalies/{anomaly_id}")
def resolve_anomaly(anomaly_id: int, payload: AnomalyResolution, request: Request,
                    db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    from app.core.audit import append_audit

    _require_action(user, "validate")
    if payload.status not in (ANOMALY_RESOLVED, ANOMALY_DISMISSED):
        raise HTTPException(status_code=422, detail="Statut de résolution invalide")
    row = db.get(AttendanceAnomaly, anomaly_id)
    allowed = _allowed_assignment_site_ids(db, user)
    if not row or (allowed is not None and row.site_id not in set(allowed)):
        raise HTTPException(status_code=404, detail="Anomalie introuvable")
    if row.status != ANOMALY_OPEN:
        raise HTTPException(status_code=409, detail="Anomalie déjà traitée")
    row.status = payload.status
    row.resolution = payload.resolution.strip()
    row.resolved_by = user.username
    row.resolved_at = datetime.utcnow()
    append_audit(db, action="attendance.anomaly.resolve", resource="attendance_anomaly", resource_id=row.id,
                 result="success", user=user, request=request, society=row.society,
                 new_state={"status": row.status, "resolution": row.resolution})
    db.commit()
    return _anomaly_out(row, db.get(Employee, row.employee_id) if row.employee_id else None,
                        db.get(Site, row.site_id) if row.site_id else None)


# ── Corrections, clôture, réouverture ────────────────────────────────────────────────────
class CorrectionIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    status: str | None = None
    arrival_time: str | None = None
    departure_time: str | None = None
    notes: str | None = None


@router.patch("/presences/{presence_id}")
def correct(presence_id: int, payload: CorrectionIn, request: Request,
            db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    row = db.get(DailyPresence, presence_id)
    if not row:
        raise HTTPException(status_code=404, detail="Pointage introuvable")
    _presence_in_scope(db, user, row)
    _require_action(user, "update")
    if row.closed_at is not None:
        _require_action(user, "validate")  # permission renforcée après clôture
    fields = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if k != "reason"}
    if not fields:
        raise HTTPException(status_code=422, detail="Aucune valeur à corriger")
    core.correct_presence(db, row=row, reason=payload.reason, source=SOURCE_MANUAL, actor=user,
                          allow_closed=True, request=request, **fields)
    db.commit()
    return {"id": row.id, "status": row.status, "arrival_time": row.arrival_time,
            "departure_time": row.departure_time, "closed": row.closed_at is not None}


class CloseIn(BaseModel):
    presence_date: date
    site_id: int | None = None


@router.post("/close")
def close(payload: CloseIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Clôture (action validate déduite du chemin). Les anomalies ouvertes sont renvoyées et
    restent ouvertes ; une clôture n'en masque jamais."""
    site_ids = _scope(db, user, payload.site_id)
    result = core.close_day(db, day=payload.presence_date, site_ids=site_ids, actor=user, source=SOURCE_SYSTEM, request=request)
    db.commit()
    return result


class ReopenIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/presences/{presence_id}/unlock")
def reopen(presence_id: int, payload: ReopenIn, request: Request,
           db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Réouverture d'une journée clôturée : action « unlock » (déduite du chemin) + motif + audit."""
    row = db.get(DailyPresence, presence_id)
    if not row:
        raise HTTPException(status_code=404, detail="Pointage introuvable")
    _presence_in_scope(db, user, row)
    core.reopen_presence(db, row=row, reason=payload.reason, actor=user, source=SOURCE_MANUAL, request=request)
    db.commit()
    return {"id": row.id, "closed": False}


# ── Employé 360 : onglet Pointages ───────────────────────────────────────────────────────
@router.get("/employees/{employee_id}")
def employee_attendance(employee_id: int, days: int = Query(31, ge=1, le=366),
                        db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    allowed = _allowed_assignment_site_ids(db, user)
    if allowed is not None:
        visible = db.execute(select(Assignment.id).where(
            Assignment.employee_id == employee_id, Assignment.site_id.in_(allowed or [-1]))).first()
        if not visible:
            raise HTTPException(status_code=404, detail="Employé introuvable")
    since = core._now_local().date() - timedelta(days=days - 1)
    presences = db.execute(select(DailyPresence).where(
        DailyPresence.employee_id == employee_id, DailyPresence.presence_date >= since,
    ).order_by(DailyPresence.presence_date.desc())).scalars().all()
    events = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.employee_id == employee_id, AttendanceEvent.presence_date >= since,
    ).order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.id.desc()).limit(500)).scalars().all()
    anomalies_rows = db.execute(select(AttendanceAnomaly).where(
        AttendanceAnomaly.employee_id == employee_id, AttendanceAnomaly.presence_date >= since,
    ).order_by(AttendanceAnomaly.id.desc())).scalars().all()
    site_ids = {p.site_id for p in presences if p.site_id} | {e.site_id for e in events if e.site_id}
    site_map = {s.id: s.name for s in db.execute(select(Site).where(Site.id.in_(site_ids))).scalars()} if site_ids else {}
    assignment = core.active_assignment(db, employee_id)
    today = core._now_local().date()
    current = next((p for p in presences if p.presence_date == today), None)
    return {
        "employee_id": employee_id,
        "current": {
            "date": today.isoformat(), "status": current.status if current else "non_pointe",
            "site": site_map.get(current.site_id, "") if current else (db.get(Site, assignment.site_id).name if assignment else ""),
            "closed": bool(current and current.closed_at),
        },
        "days": [{"id": p.id, "date": p.presence_date.isoformat(), "status": p.status, "site": site_map.get(p.site_id, ""),
                  "arrival": p.arrival_time if p.arrival_time != "P" else "", "departure": p.departure_time or "",
                  "closed": p.closed_at is not None} for p in presences],
        "events": [{"id": e.id, "date": e.presence_date.isoformat(), "at": core.to_local(e.occurred_at).isoformat(),
                    "type": e.event_type, "source": e.source, "site": site_map.get(e.site_id, ""),
                    "actor": e.actor_label or "", "device_id": e.device_id, "observation": e.observation or "",
                    "changes": (e.data or {}).get("changes") if e.event_type == "CORRECTION" else None}
                   for e in events],
        "anomalies": [{"id": a.id, "date": a.presence_date.isoformat() if a.presence_date else "", "type": a.anomaly_type,
                       "severity": a.severity, "status": a.status, "message": a.message} for a in anomalies_rows],
    }


# ── Feuilles de présence par rotation (Pointage & Planning intelligent V3 — lot 1) ─────────
class RotationSettingIn(BaseModel):
    first_shift_time: str = Field(min_length=5, max_length=5)
    shift_minutes: int
    groups_count: int
    early_margin_minutes: int
    active: bool = True


@router.get("/rotation-settings")
def get_rotation_settings(
    site_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Paramètres de rotation d'un site (ou valeurs initiales proposées s'il n'est pas configuré)."""
    _ensure_site_allowed(db, user, site_id)
    row = db.execute(select(RotationSetting).where(RotationSetting.site_id == site_id)).scalar_one_or_none()
    return {"site_id": site_id, **sheets.setting_out(row), "active": bool(row.active) if row else False}


@router.put("/rotation-settings/{site_id}")
def put_rotation_settings(
    site_id: int,
    payload: RotationSettingIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Configure la rotation d'un site. Les feuilles déjà créées gardent leur fenêtre : la
    nouvelle règle s'applique aux rotations suivantes (l'historique reste reproductible)."""
    _require_action(user, "update")
    _ensure_site_allowed(db, user, site_id)
    try:
        sheets.validate_setting(payload.first_shift_time, payload.shift_minutes, payload.groups_count, payload.early_margin_minutes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    now = datetime.utcnow()
    row = db.execute(select(RotationSetting).where(RotationSetting.site_id == site_id)).scalar_one_or_none()
    old_state = sheets.setting_out(row) if row else None
    values = payload.model_dump()
    values["active"] = 1 if payload.active else 0
    if row is None:
        row = RotationSetting(site_id=site_id, version=1, created_at=now, **values)
        db.add(row)
    else:
        window_changed = any(getattr(row, key) != values[key] for key in ("first_shift_time", "shift_minutes", "groups_count", "early_margin_minutes"))
        for key, value in values.items():
            setattr(row, key, value)
        if window_changed:
            row.version = int(row.version or 1) + 1
    row.updated_by = user.username
    row.updated_at = now
    db.flush()
    site = db.get(Site, site_id)
    append_audit(db, action="attendance.rotation_settings", resource="attendance_rotation_settings", resource_id=row.id,
                 result="success", user=user, request=request, society=_site_society(site) if site else None,
                 old_state=old_state, new_state=sheets.setting_out(row))
    db.commit()
    return {"site_id": site_id, **sheets.setting_out(row), "active": bool(row.active)}


@router.get("/sheets")
def list_sheets(
    site_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Historique des feuilles de rotation (DRH / OPS) : en cours, clôturées, archivées."""
    scope = _scope(db, user, site_id)
    sheets.maintain(db, site_ids=scope)
    db.commit()
    query = select(AttendanceSheet)
    if scope is not None:
        query = query.where(AttendanceSheet.site_id.in_(scope))
    if date_from:
        query = query.where(AttendanceSheet.local_date >= date_from)
    if date_to:
        query = query.where(AttendanceSheet.local_date <= date_to)
    if status:
        if status.upper() not in SHEET_STATUSES:
            raise HTTPException(status_code=422, detail="Statut de feuille inconnu")
        query = query.where(AttendanceSheet.status == status.upper())
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = db.execute(query.order_by(AttendanceSheet.window_start.desc(), AttendanceSheet.id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).scalars().all()
    names = {s.id: (s.name or s.indicatif or "") for s in db.execute(select(Site).where(Site.id.in_({r.site_id for r in rows} or {0}))).scalars().all()}
    learned = learning.interpretations(db, [row.id for row in rows])
    return {"total": int(total), "page": page, "page_size": page_size,
            "items": [{**sheets.sheet_out(db, row), "site": names.get(row.site_id, ""),
                       "interpretation": learned.get(row.id)} for row in rows]}


@router.get("/sheets/{sheet_id}")
def get_sheet(
    sheet_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Une feuille : synthèse par employé + événements BRUTS rattachés (jamais modifiés)."""
    sheet = db.get(AttendanceSheet, sheet_id)
    allowed = _allowed_assignment_site_ids(db, user)
    if sheet is None or (allowed is not None and sheet.site_id not in set(allowed)):
        raise HTTPException(status_code=404, detail="Feuille introuvable")
    site = db.get(Site, sheet.site_id)
    events = sheets.line_events_out(db, sheet)
    learned = learning.interpretations(db, [sheet.id]).get(sheet.id)
    checks = deviations.checks_for_sheet(db, sheet.id)
    lines = [{**line, "events": events.get(line["id"], []),
              **deviations.line_check_out(checks.get(line["employee_id"]), learned["group"] if learned else None)}
             for line in sheets.lines_out(db, sheet)]
    return {**sheets.sheet_out(db, sheet), "site": (site.name or site.indicatif or "") if site else "", "lines": lines,
            "interpretation": learning.interpretations(db, [sheet.id]).get(sheet.id)}


# ── Planning intelligent — apprentissage des groupes et des rotations (lot 2) ──────────────
# Lecture du modèle appris (DRH / OPS) et pilotage explicite. Aucune alerte, aucune projection.
class RotationLearningIn(BaseModel):
    mode: str = Field(min_length=2, max_length=12)
    params: dict[str, Any] | None = None


class RotationRebuildIn(BaseModel):
    date_from: date | None = None
    date_to: date | None = None
    dry_run: bool = True


def _learning_sites(db: Session, user: User, site_id: int | None) -> list[Site]:
    scope = _scope(db, user, site_id)
    query = select(Site).join(RotationSetting, RotationSetting.site_id == Site.id)
    if scope is not None:
        query = query.where(Site.id.in_(scope))
    return list(db.execute(query.order_by(Site.name, Site.id)).scalars().all())


@router.get("/rotation-learning")
def rotation_learning_overview(
    site_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """État d'apprentissage des sites à rotation paramétrée du périmètre (valeurs mesurées)."""
    rows = _learning_sites(db, user, site_id)
    sheets.maintain(db, site_ids=[site.id for site in rows], ensure_current=False)
    db.commit()
    return {"enabled": learning.settings.rotation_learning_enabled, "engine_version": learning.ENGINE_VERSION,
            "items": [learning.site_out(db, site, learning.model_for(db, site.id)) for site in rows]}


@router.put("/rotation-learning/{site_id}")
def put_rotation_learning(
    site_id: int,
    payload: RotationLearningIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Active (LEARNING) ou fige (OFF) l'apprentissage d'un site et règle ses paramètres."""
    _require_action(user, "update")
    _ensure_site_allowed(db, user, site_id)
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="Site introuvable")
    try:
        model, old_state = learning.set_mode(db, site_id, mode=payload.mode.upper(), params=payload.params, username=user.username)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    append_audit(db, action="attendance.rotation_learning.settings", resource="rotation_site_model", resource_id=site_id,
                 result="success", user=user, request=request, society=_site_society(site),
                 old_state=old_state, new_state={"mode": model.mode, "params": model.params})
    db.commit()
    return learning.site_out(db, site, model)


@router.get("/rotation-learning/employees/{employee_id}")
def rotation_learning_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Fiche rotation d'un salarié : groupe déclaré / appris / confirmé, observations,
    confiance expliquée, historique d'appartenance. Complète la fiche RH, ne la remplace pas."""
    employee = db.get(Employee, employee_id)
    allowed = _allowed_assignment_site_ids(db, user)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    if allowed is not None:
        known = db.execute(select(func.count(RotationMembership.id)).where(
            RotationMembership.employee_id == employee_id, RotationMembership.site_id.in_(list(allowed) or [0]))).scalar_one()
        assigned = db.execute(select(func.count(Assignment.id)).where(
            Assignment.employee_id == employee_id, Assignment.site_id.in_(list(allowed) or [0]))).scalar_one()
        if not known and not assigned:
            raise HTTPException(status_code=404, detail="Employé introuvable")
    return learning.employee_out(db, employee, list(allowed) if allowed is not None else None)


@router.get("/rotation-learning/{site_id}/groups")
def rotation_learning_groups(
    site_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Groupes DÉTECTÉS d'un site : membres probables / confirmés / en apprentissage, créneau
    habituel, confiance. Le groupe déclaré de chaque salarié est rappelé, jamais modifié."""
    _ensure_site_allowed(db, user, site_id)
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="Site introuvable")
    return {**learning.site_out(db, site, learning.model_for(db, site_id)), "groups": learning.groups_out(db, site_id)}


@router.get("/rotation-learning/{site_id}/versions")
def rotation_learning_versions(
    site_id: int,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Versions successives du modèle d'un site (jamais réécrites)."""
    _ensure_site_allowed(db, user, site_id)
    rows = db.execute(select(RotationModelVersion).where(RotationModelVersion.site_id == site_id)
                      .order_by(RotationModelVersion.version.desc()).limit(limit)).scalars().all()
    return {"site_id": site_id, "items": [{
        "version": row.version, "effective_at": core.to_local(row.effective_at).isoformat(), "state": row.state,
        "previous_state": row.previous_state, "params": row.params, "groups": row.groups, "cycle": row.cycle,
        "conditions": row.reasons, "sheets_observed": row.sheets_observed, "mean_confidence": row.mean_confidence,
        "source": row.source, "source_sheet_id": row.source_sheet_id, "actor": row.actor,
        "engine_version": row.engine_version} for row in rows]}


@router.post("/rotation-learning/{site_id}/rebuild")
def rotation_learning_rebuild(
    site_id: int,
    payload: RotationRebuildIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Reconstruction administrative du modèle d'un site sur une période (simulation par défaut)."""
    _require_action(user, "admin")
    _ensure_site_allowed(db, user, site_id)
    try:
        result = learning.rebuild(db, site_id, date_from=payload.date_from, date_to=payload.date_to,
                                  dry_run=payload.dry_run, actor=user, request=request)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    return result


@router.get("/rotation-learning/{site_id}/backfill-preview")
def rotation_learning_backfill_preview(
    site_id: int,
    date_from: date,
    date_to: date,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Audit en LECTURE SEULE : ce que les anciens pointages permettraient de reconstituer."""
    _ensure_site_allowed(db, user, site_id)
    if date_to < date_from or (date_to - date_from).days > 92:
        raise HTTPException(status_code=422, detail="Période invalide (92 jours au plus)")
    return learning.backfill_preview(db, site_id, date_from, date_to)


# ── Planning intelligent — écarts prévu / réel et qualification OPS (lot 3) ─────────────────
# Voir : périmètre de sites du compte. Qualifier (dont confirmer un changement de groupe) :
# action « validate ». Paramètres : « update ». Reconstruction du modèle : « admin ».
class RotationQualifyIn(BaseModel):
    action: str = Field(min_length=3, max_length=20)
    reason: str | None = Field(default=None, max_length=1000)
    group: str | None = Field(default=None, max_length=12)
    start_at: datetime | None = None          # heure locale du site (début de rotation)
    end_at: datetime | None = None            # heure locale du site (fin de rotation)


def _scoped_check(db: Session, user: User, check_id: int) -> RotationCheck:
    check = db.get(RotationCheck, check_id)
    allowed = _allowed_assignment_site_ids(db, user)
    if check is None or check.outcome not in CHECK_DEVIATIONS or (allowed is not None and check.site_id not in set(allowed)):
        raise HTTPException(status_code=404, detail="Écart introuvable")
    return check


@router.get("/rotation-deviations")
def list_rotation_deviations(
    site_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    employee_id: int | None = None,
    group: str | None = None,
    type: str | None = None,
    severity: str | None = None,
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Écarts de rotation persistés (OPS / DRH) : période, site, employé, groupe, type, sévérité, statut."""
    if status and status.upper() not in DEVIATION_STATUSES:
        raise HTTPException(status_code=422, detail="Statut d'écart inconnu")
    if type and type.upper() not in CHECK_DEVIATIONS:
        raise HTTPException(status_code=422, detail="Type d'écart inconnu")
    return deviations.list_deviations(
        db, site_ids=_scope(db, user, site_id), date_from=date_from, date_to=date_to, employee_id=employee_id, group=group,
        deviation_type=type.upper() if type else None, severity=severity, status=status.upper() if status else None,
        page=page, page_size=page_size)


@router.get("/rotation-deviations/{check_id}")
def get_rotation_deviation(check_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """« Examiner » : employé, site, date, heure, groupe et rotation attendus / observés,
    historique récent, confiance du modèle, explication."""
    return deviations.detail(db, _scoped_check(db, user, check_id))


@router.post("/rotation-deviations/{check_id}/qualify")
def qualify_rotation_deviation(
    check_id: int,
    payload: RotationQualifyIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Qualification OPS. Le pointage et les feuilles ne sont jamais modifiés."""
    _require_action(user, "validate")
    _scoped_check(db, user, check_id)
    try:
        check = deviations.qualify(
            db, check_id, action=payload.action.upper(), user=user, reason=payload.reason, group=payload.group,
            start_at=core.to_utc_naive(payload.start_at) if payload.start_at else None,
            end_at=core.to_utc_naive(payload.end_at) if payload.end_at else None, request=request)
    except deviations.AlreadyQualified as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    return deviations.detail(db, check)


@router.get("/rotation-history")
def rotation_history(
    site_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    employee_id: int | None = None,
    group: str | None = None,
    outcome: str | None = None,
    anomaly: str | None = None,
    status: str | None = None,
    q: str | None = Query(None, max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Historique de pointage par rotation (DRH / OPS) : une ligne réelle par salarié et par
    feuille, avec prévu / réel / écart / décision tels qu'enregistrés au moment du pointage."""
    if status and status.upper() not in SHEET_STATUSES:
        raise HTTPException(status_code=422, detail="Statut de feuille inconnu")
    return deviations.history_rows(
        db, site_ids=_scope(db, user, site_id), date_from=date_from, date_to=date_to, employee_id=employee_id, group=group,
        outcome=outcome.upper() if outcome else None, anomaly=anomaly, sheet_status=status.upper() if status else None,
        q=q, page=page, page_size=page_size)


# ── Planning intelligent — projection du planning (lot 4) ──────────────────────────────────
# Occurrences CALCULÉES à la demande depuis la règle de cycle versionnée et les décisions datées :
# rien n'est matérialisé. Consultation : périmètre de sites. Décision planifiée : action « validate ».
class RotationDecisionIn(BaseModel):
    employee_id: int
    kind: str = Field(min_length=3, max_length=12)       # TEMPORARY | PERMANENT
    group: str = Field(min_length=1, max_length=12)
    start_at: datetime                                    # heure locale du site
    end_at: datetime | None = None
    reason: str = Field(min_length=1, max_length=1000)


@router.get("/rotation-planning")
def rotation_planning(
    site_id: int,
    date_from: date | None = None,
    date_to: date | None = None,
    group: str | None = None,
    employee_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Planning d'un site : aujourd'hui par défaut, jusqu'à 92 jours. Passé = prévu / réel /
    écart / décision ; futur = prévision, présentée selon l'état du modèle."""
    _ensure_site_allowed(db, user, site_id)
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="Site introuvable")
    start = date_from or core._now_local().date()
    try:
        return projection.project(db, site, date_from=start, date_to=date_to or start, group=group, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/rotation-planning/{site_id}/decisions")
def rotation_planning_decisions(site_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Décisions humaines datées du site (remplacements temporaires, changements confirmés)."""
    _ensure_site_allowed(db, user, site_id)
    return {"site_id": site_id, "items": projection.decisions_out(db, site_id)}


@router.post("/rotation-planning/{site_id}/decisions")
def create_rotation_decision(
    site_id: int,
    payload: RotationDecisionIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Décision OPS planifiée (override) : remplacement temporaire ou changement de groupe à une
    date d'effet. Prioritaire sur la projection pendant sa période ; jamais rétroactive."""
    _require_action(user, "validate")
    _ensure_site_allowed(db, user, site_id)
    employee = db.get(Employee, payload.employee_id)
    model = learning.model_for(db, site_id, lock=True)
    if employee is None or model is None or model.mode == "OFF":
        raise HTTPException(status_code=404, detail="Site ou employé introuvable pour le planning intelligent")
    try:
        decision = deviations.decide(
            db, site_id=site_id, employee_id=employee.id, kind=payload.kind.upper(), group=payload.group.strip(),
            start=core.to_utc_naive(payload.start_at), end=core.to_utc_naive(payload.end_at) if payload.end_at else None,
            reason=payload.reason, user=user)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    site = db.get(Site, site_id)
    append_audit(db, action="attendance.rotation_planning.decision", resource="rotation_decision", resource_id=decision.id,
                 result="success", user=user, request=request, society=_site_society(site) if site else None,
                 old_state={"group": decision.previous_group},
                 new_state={"employee_id": employee.id, "kind": decision.kind, "group": decision.group_label,
                            "effective_from": decision.effective_from.isoformat(),
                            "effective_to": decision.effective_to.isoformat() if decision.effective_to else None,
                            "reason": decision.reason})
    db.commit()
    return projection.decision_out(decision, employee)
