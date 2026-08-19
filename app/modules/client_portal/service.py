from datetime import date, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.modules.auth.models import User
from app.modules.client_portal.models import ClientObservation, ClientPortalUser
from app.modules.client_portal.schemas import URGENT_CATEGORIES
from app.modules.client_portal.security import generate_temporary_password
from app.modules.commercial.models import Client
from app.modules.drh.models import Employee
from app.modules.materiel.models import EmployeeEquipment, MaterialAssignment, StockArticle
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


def visible_sites_for_client(db: Session, client_id: int) -> list[dict[str, Any]]:
    sites = db.execute(
        select(Site).where(Site.client_id == client_id, Site.active == 1).order_by(Site.name)
    ).scalars().all()
    if not sites:
        return []
    site_ids = [s.id for s in sites]
    counts = dict(
        db.execute(
            select(Assignment.site_id, func.count(Assignment.id))
            .where(Assignment.active == 1, Assignment.site_id.in_(site_ids))
            .group_by(Assignment.site_id)
        ).all()
    )
    return [
        {
            "id": s.id,
            "name": s.name,
            "address": s.address,
            "commune": s.commune,
            "wilaya": s.wilaya,
            "site_type": s.site_type,
            "required_staff": s.contractual_staff or (s.day_staff + s.night_staff) or 0,
            "actual_staff": counts.get(s.id, 0),
        }
        for s in sites
    ]


# État réel de l'article (voir sgdi-app.js "etatArticle") -> libellé/couleur affichés au client.
# "remboursé"/"perdu" côté dotation employé signifient que l'article n'est plus en dotation
# active : ces lignes ne sont de toute façon jamais remontées ici (filtrées par statut "attribue").
_ITEM_STATE_DISPLAY: dict[str, tuple[str, str]] = {
    "neuf": ("En service", "pill-green"),
    "rénové": ("En service", "pill-green"),
    "usagé": ("À surveiller", "pill-amber"),
    "réformé": ("Hors service", "pill-gray"),
    "perdu": ("Hors service", "pill-red"),
}


def _equipment_display(item_state: str | None) -> tuple[str, str]:
    return _ITEM_STATE_DISPLAY.get(item_state or "neuf", ("En service", "pill-green"))


def visible_equipment_for_client(db: Session, client_id: int) -> list[dict[str, Any]]:
    site_ids = _client_site_ids(db, client_id)
    if not site_ids:
        return []
    results: list[dict[str, Any]] = []

    # Matériel affecté directement au site (extincteurs, barrières, radio de poste...).
    site_rows = db.execute(
        select(MaterialAssignment, StockArticle, Site)
        .join(StockArticle, StockArticle.id == MaterialAssignment.article_id)
        .join(Site, Site.id == MaterialAssignment.site_id)
        .where(
            MaterialAssignment.target_type == "site",
            MaterialAssignment.site_id.in_(site_ids),
            MaterialAssignment.status == "attribue",
        )
    ).all()
    for assignment, article, site in site_rows:
        state = assignment.item_state or article.item_state or "neuf"
        label, tone = _equipment_display(state)
        results.append(
            {
                "id": f"site-{assignment.id}",
                "designation": article.designation,
                "category": article.category,
                "code": article.code,
                "site_id": site.id,
                "site_name": site.name,
                "assignee": "Commun au site",
                "item_state": state,
                "status_label": label,
                "status_tone": tone,
                "dotation_date": assignment.dotation_date,
            }
        )

    # Matériel nominatif des agents actuellement affectés à ces sites (gilet, badge, lampe...).
    employee_rows = db.execute(
        select(EmployeeEquipment, StockArticle, Employee, Site)
        .join(StockArticle, StockArticle.id == EmployeeEquipment.article_id)
        .join(Employee, Employee.id == EmployeeEquipment.employee_id)
        .join(Assignment, (Assignment.employee_id == Employee.id) & (Assignment.active == 1))
        .join(Site, Site.id == Assignment.site_id)
        .where(Assignment.site_id.in_(site_ids), EmployeeEquipment.status == "attribue")
    ).all()
    for equipment, article, employee, site in employee_rows:
        state = equipment.item_state or article.item_state or "neuf"
        label, tone = _equipment_display(state)
        results.append(
            {
                "id": f"emp-{equipment.id}",
                "designation": article.designation,
                "category": article.category,
                "code": article.code,
                "site_id": site.id,
                "site_name": site.name,
                "assignee": f"{employee.last_name} {employee.first_name}".strip(),
                "item_state": state,
                "status_label": label,
                "status_tone": tone,
                "dotation_date": equipment.dotation_date,
            }
        )

    results.sort(key=lambda row: (row["site_name"] or "", row["designation"] or ""))
    return results


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
    temp_password = payload.password or generate_temporary_password()
    row = ClientPortalUser(
        client_id=payload.client_id,
        full_name=payload.full_name.strip(),
        username=payload.username.strip(),
        password_hash=hash_password(temp_password),
        is_active=payload.is_active,
        must_change_password=payload.must_change_password,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, temp_password


def update_client_portal_user(db: Session, user_id: int, payload) -> ClientPortalUser:
    row = db.get(ClientPortalUser, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    changes = payload.model_dump(exclude_unset=True)
    if "client_id" in changes and not db.get(Client, changes["client_id"]):
        raise HTTPException(status_code=404, detail="Client introuvable")
    if "username" in changes:
        username = str(changes["username"] or "").strip()
        if not username:
            raise HTTPException(status_code=422, detail="L'identifiant est requis")
        duplicate = db.execute(
            select(ClientPortalUser).where(ClientPortalUser.username == username, ClientPortalUser.id != user_id)
        ).scalars().first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Cet identifiant existe déjà")
        changes["username"] = username
    if "full_name" in changes:
        changes["full_name"] = str(changes["full_name"] or "").strip()
        if not changes["full_name"]:
            raise HTTPException(status_code=422, detail="Le nom de l'interlocuteur est requis")
    password = changes.pop("password", None)
    if password:
        row.password_hash = hash_password(password)
    for key, value in changes.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def reset_client_portal_user_password(db: Session, user_id: int) -> str:
    row = db.get(ClientPortalUser, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    temp_password = generate_temporary_password()
    row.password_hash = hash_password(temp_password)
    row.must_change_password = True
    db.commit()
    return temp_password
