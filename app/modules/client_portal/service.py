from datetime import date, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.modules.auth.models import User
from app.modules.client_portal.models import ClientObservation, ClientPortalUser
from app.modules.client_portal.schemas import URGENT_CATEGORIES
from app.modules.client_portal.security import generate_temporary_password
from app.modules.commercial.models import Client
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from app.modules.ops.routes import _allowed_assignment_site_ids


def authenticate_client_user(db: Session, username: str, password: str) -> ClientPortalUser:
    user = db.execute(
        select(ClientPortalUser).where(ClientPortalUser.username == username.strip())
    ).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants incorrects")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Compte désactivé")
    client = db.get(Client, user.client_id)
    if not client or not client.portal_enabled:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Accès portail désactivé")
    return user


def change_client_password(db: Session, user: ClientPortalUser, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Mot de passe actuel incorrect")
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    db.commit()


def _client_site_ids(db: Session, client_id: int) -> list[int]:
    return list(db.execute(select(Site.id).where(Site.client_id == client_id)).scalars().all())


def visible_employees_for_client(db: Session, client_id: int) -> list[dict[str, Any]]:
    site_ids = _client_site_ids(db, client_id)
    if not site_ids:
        return []
    rows = db.execute(
        select(Assignment, Employee, Site)
        .join(Employee, Employee.id == Assignment.employee_id)
        .join(Site, Site.id == Assignment.site_id)
        .where(Assignment.active == 1, Assignment.site_id.in_(site_ids))
        .order_by(Employee.last_name, Employee.first_name)
    ).all()
    return [
        {
            "id": employee.id,
            "code": employee.code,
            "first_name": employee.first_name,
            "last_name": employee.last_name,
            "position": assignment.position or employee.position,
            "site_id": site.id,
            "site_name": site.name,
        }
        for assignment, employee, site in rows
    ]


def _ensure_employee_visible_to_client(db: Session, client_id: int, employee_id: int) -> Site | None:
    """Vérifie que l'employé est bien actuellement affecté à un site du client, et renvoie
    ce site. Empêche un compte client de signaler un employé qui n'est pas (ou plus) le
    sien — même en devinant un employee_id valide par ailleurs."""
    site_ids = _client_site_ids(db, client_id)
    if not site_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent introuvable")
    assignment = db.execute(
        select(Assignment).where(
            Assignment.employee_id == employee_id,
            Assignment.active == 1,
            Assignment.site_id.in_(site_ids),
        )
    ).scalars().first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent introuvable")
    return db.get(Site, assignment.site_id)


def create_observation(db: Session, client_user: ClientPortalUser, payload) -> ClientObservation:
    site = _ensure_employee_visible_to_client(db, client_user.client_id, payload.employee_id)
    severity = "normale"
    if payload.kind == "probleme" and any(c in URGENT_CATEGORIES for c in payload.categories):
        severity = "urgente"
    row = ClientObservation(
        client_id=client_user.client_id,
        client_user_id=client_user.id,
        employee_id=payload.employee_id,
        site_id=site.id if site else None,
        kind=payload.kind,
        categories=payload.categories if payload.kind == "probleme" else [],
        severity=severity,
        description=payload.description,
        incident_date=payload.incident_date,
        status="nouveau",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def observation_out_dict(db: Session, row: ClientObservation) -> dict[str, Any]:
    employee = db.get(Employee, row.employee_id)
    site = db.get(Site, row.site_id) if row.site_id else None
    return {
        "id": row.id,
        "employee_id": row.employee_id,
        "employee_name": f"{employee.last_name} {employee.first_name}".strip() if employee else "—",
        "site_name": site.name if site else None,
        "kind": row.kind,
        "categories": row.categories or [],
        "severity": row.severity,
        "description": row.description,
        "incident_date": row.incident_date,
        "status": row.status,
        "created_at": row.created_at,
    }


def list_observations_for_client(
    db: Session, client_id: int, employee_id: int | None = None, status_filter: str | None = None
) -> list[dict[str, Any]]:
    stmt = select(ClientObservation).where(ClientObservation.client_id == client_id)
    if employee_id:
        stmt = stmt.where(ClientObservation.employee_id == employee_id)
    if status_filter:
        stmt = stmt.where(ClientObservation.status == status_filter)
    rows = db.execute(stmt.order_by(ClientObservation.incident_date.desc(), ClientObservation.id.desc())).scalars().all()
    return [observation_out_dict(db, row) for row in rows]


def list_observations_for_ops(
    db: Session,
    user: User,
    client_id: int | None = None,
    employee_id: int | None = None,
    site_id: int | None = None,
    status_filter: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    stmt = select(ClientObservation)
    allowed_site_ids = _allowed_assignment_site_ids(db, user)
    if allowed_site_ids is not None:
        if not allowed_site_ids:
            return []
        stmt = stmt.where(ClientObservation.site_id.in_(allowed_site_ids))
    if client_id:
        stmt = stmt.where(ClientObservation.client_id == client_id)
    if employee_id:
        stmt = stmt.where(ClientObservation.employee_id == employee_id)
    if site_id:
        stmt = stmt.where(ClientObservation.site_id == site_id)
    if status_filter:
        stmt = stmt.where(ClientObservation.status == status_filter)
    if date_from:
        stmt = stmt.where(ClientObservation.incident_date >= date_from)
    if date_to:
        stmt = stmt.where(ClientObservation.incident_date <= date_to)
    rows = db.execute(stmt.order_by(ClientObservation.incident_date.desc(), ClientObservation.id.desc())).scalars().all()
    return [observation_ops_out_dict(db, row) for row in rows]


def observation_ops_out_dict(db: Session, row: ClientObservation) -> dict[str, Any]:
    base = observation_out_dict(db, row)
    client = db.get(Client, row.client_id)
    resolver = db.get(User, row.resolved_by) if row.resolved_by else None
    return {
        **base,
        "client_id": row.client_id,
        "client_name": client.name if client else "—",
        "site_id": row.site_id,
        "resolution_note": row.resolution_note,
        "resolved_by_name": resolver.full_name if resolver else None,
        "resolved_at": row.resolved_at,
    }


def resolve_observation(db: Session, observation_id: int, user: User, payload) -> ClientObservation:
    row = db.get(ClientObservation, observation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Signalement introuvable")
    allowed_site_ids = _allowed_assignment_site_ids(db, user)
    if allowed_site_ids is not None and row.site_id not in allowed_site_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Site non autorisé")
    row.status = payload.status
    row.resolution_note = payload.resolution_note
    if payload.status == "traite":
        row.resolved_by = user.id
        row.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


# ── Administration des comptes client ────────────────────────────────────────────────

def create_client_portal_user(db: Session, payload) -> tuple[ClientPortalUser, str]:
    if not db.get(Client, payload.client_id):
        raise HTTPException(status_code=404, detail="Client introuvable")
    if db.execute(select(ClientPortalUser).where(ClientPortalUser.username == payload.username.strip())).scalars().first():
        raise HTTPException(status_code=409, detail="Cet identifiant existe déjà")
    temp_password = generate_temporary_password()
    row = ClientPortalUser(
        client_id=payload.client_id,
        full_name=payload.full_name.strip(),
        username=payload.username.strip(),
        password_hash=hash_password(temp_password),
        is_active=True,
        must_change_password=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, temp_password


def reset_client_portal_user_password(db: Session, user_id: int) -> str:
    row = db.get(ClientPortalUser, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    temp_password = generate_temporary_password()
    row.password_hash = hash_password(temp_password)
    row.must_change_password = True
    db.commit()
    return temp_password
