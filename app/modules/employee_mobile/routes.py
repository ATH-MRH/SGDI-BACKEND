"""Libre-service de l'employé sur ATLAS MOBILE : uniquement SES données, en lecture.

Aucune route ne reçoit d'identifiant d'employé : tout part de la fiche du jeton
(`current_employee`). Aucun calcul métier ici : planning, pointage et paie sont lus tels
que les moteurs ATLAS les ont produits.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.config import settings
from app.db.session import get_db
from app.modules.drh.models import Document, Employee, Leave
from app.modules.employee_mobile.security import create_employee_token, current_employee
from app.modules.ops.models import Assignment, DailyPresence, Site

router = APIRouter()

ABSENCE_STATUSES = ("absent", "maladie")


def _profile(db: Session, employee: Employee) -> dict[str, Any]:
    assignment = db.execute(
        select(Assignment).where(Assignment.employee_id == employee.id, Assignment.active == 1).order_by(Assignment.id.desc())
    ).scalars().first()
    site = db.get(Site, assignment.site_id) if assignment else None
    return {
        "id": employee.id,
        "matricule": employee.code,
        "first_name": employee.first_name,
        "last_name": employee.last_name,
        "position": employee.position,
        "society": employee.society,
        "status": employee.status,
        "contract_type": employee.contract_type,
        "recruit_date": employee.recruit_date.isoformat() if employee.recruit_date else None,
        "contract_end_date": employee.contract_end_date.isoformat() if employee.contract_end_date else None,
        "site": {"id": site.id, "name": site.name} if site else None,
        "group": assignment.group_code if assignment else None,
    }


@router.post("/login")
def employee_mobile_login(payload: dict[str, Any], request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Même compte et même mot de passe que le portail employé, mais un jeton d'une autre famille."""
    from app.modules.portal.routes import authenticate_portal_account

    account, matricule, _row, _agent = authenticate_portal_account(db, request, payload)
    # Rattachement STRICT par matricule exact : jamais par nom, e-mail ou identifiant numérique.
    employee = db.execute(select(Employee).where(Employee.code == str(matricule))).scalar_one_or_none()
    if employee is None or not account.get("id"):
        raise HTTPException(status_code=403, detail="Ce compte n'est rattaché à aucune fiche employé")
    if account.get("mustChangePassword"):
        raise HTTPException(status_code=403, detail="Changez d'abord votre mot de passe provisoire sur le portail employé")
    append_audit(db, action="auth.employee_mobile_login", resource="employee", resource_id=employee.id, result="success",
                 request=request, society=employee.society)
    db.commit()
    return {
        "access_token": create_employee_token(employee, account),
        "token_type": "bearer",
        "expires_in": settings.employee_mobile_token_minutes * 60,
        "employee": _profile(db, employee),
    }


@router.get("/me")
def my_profile(employee: Employee = Depends(current_employee), db: Session = Depends(get_db)) -> dict[str, Any]:
    return _profile(db, employee)


def _presences(db: Session, employee: Employee, days: int, statuses: tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    from app.modules.attendance import core

    since = core._now_local().date() - timedelta(days=days - 1)
    query = select(DailyPresence).where(DailyPresence.employee_id == employee.id, DailyPresence.presence_date >= since)
    if statuses:
        query = query.where(DailyPresence.status.in_(statuses))
    rows = db.execute(query.order_by(DailyPresence.presence_date.desc())).scalars().all()
    site_ids = {row.site_id for row in rows if row.site_id}
    names = dict(db.execute(select(Site.id, Site.name).where(Site.id.in_(site_ids))).all()) if site_ids else {}
    return [
        {"date": row.presence_date.isoformat(), "status": row.status, "site": names.get(row.site_id, ""),
         "arrival": row.arrival_time or "", "departure": row.departure_time or ""}
        for row in rows
    ]


@router.get("/me/attendance")
def my_attendance(days: int = Query(31, ge=1, le=92), employee: Employee = Depends(current_employee),
                  db: Session = Depends(get_db)) -> dict[str, Any]:
    return {"days": _presences(db, employee, days)}


@router.get("/me/absences")
def my_absences(days: int = Query(92, ge=1, le=366), employee: Employee = Depends(current_employee),
                db: Session = Depends(get_db)) -> dict[str, Any]:
    return {"days": _presences(db, employee, days, ABSENCE_STATUSES)}


@router.get("/me/leaves")
def my_leaves(employee: Employee = Depends(current_employee), db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.execute(select(Leave).where(Leave.employee_id == employee.id).order_by(Leave.start_date.desc()).limit(100)).scalars().all()
    return {"items": [
        {"id": row.id, "leave_type": row.leave_type, "start_date": row.start_date.isoformat(), "end_date": row.end_date.isoformat(),
         "reason": row.reason, "status": row.status}
        for row in rows
    ]}


@router.get("/me/planning")
def my_planning(days: int = Query(14, ge=1, le=31), employee: Employee = Depends(current_employee),
                db: Session = Depends(get_db)) -> dict[str, Any]:
    """Vacations prévues sur le site d'affectation. Les collègues attendus ne sont jamais renvoyés."""
    from app.modules.attendance import core, projection

    assignment = db.execute(
        select(Assignment).where(Assignment.employee_id == employee.id, Assignment.active == 1).order_by(Assignment.id.desc())
    ).scalars().first()
    site = db.get(Site, assignment.site_id) if assignment else None
    if site is None:
        return {"site": None, "shifts": []}
    start = core._now_local().date()
    try:
        projected = projection.project(db, site, date_from=start, date_to=start + timedelta(days=days - 1), employee_id=employee.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    shifts = [
        {"date": item.get("date"), "start": item.get("start"), "end": item.get("end"), "group": item.get("group"), "rest": bool(item.get("rest"))}
        for item in projected.get("occurrences") or []
        if isinstance(item, dict)
    ]
    return {"site": {"id": site.id, "name": site.name}, "shifts": shifts}


@router.get("/me/documents")
def my_documents(employee: Employee = Depends(current_employee), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Liste seulement : ni chemin de fichier ni contenu. Le téléchargement n'est pas ouvert."""
    rows = db.execute(
        select(Document).where(Document.owner_type == "employee", Document.owner_id == employee.id).order_by(Document.id.desc()).limit(200)
    ).scalars().all()
    return {"items": [
        {"id": row.id, "label": row.label, "mime_type": row.mime_type,
         "created_at": row.created_at.isoformat() if getattr(row, "created_at", None) else None}
        for row in rows
    ]}


@router.get("/me/payslips")
def my_payslips(employee: Employee = Depends(current_employee), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Bulletins VALIDÉS de l'employé, tels que calculés par la paie ATLAS. Aucun recalcul, aucun PDF."""
    from app.modules.payroll.models import PayrollRun, PayrollSlip

    rows = db.execute(
        select(PayrollSlip, PayrollRun.period)
        .join(PayrollRun, PayrollRun.id == PayrollSlip.payroll_run_id)
        .where(PayrollSlip.employee_id == employee.id, PayrollSlip.status == "validated")
        .order_by(PayrollRun.period.desc())
        .limit(36)
    ).all()
    return {"items": [
        {"id": slip.id, "period": period, "brut": str(slip.brut), "net_a_payer": str(slip.net_a_payer), "status": slip.status}
        for slip, period in rows
    ]}
