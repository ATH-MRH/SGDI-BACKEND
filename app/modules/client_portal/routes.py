from datetime import date
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.config import settings
from app.core.photo_storage import DOCS_DIR, PUBLIC_DOC_PREFIX
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.auth.routes import require_admin
from app.modules.client_portal import service
from app.modules.client_portal.models import ClientPortalUser
from app.modules.drh.models import Document
from app.modules.ops.models import RotationTemplate, Site
from app.modules.client_portal.schemas import (
    OBSERVATION_CATEGORIES,
    GROUP_LETTERS,
    ClientChangePasswordIn,
    ClientLoginRequest,
    ClientMeOut,
    ClientPortalTokenOut,
    ClientPortalUserCreate,
    ClientPortalUserCreatedOut,
    ClientPortalUserOut,
    ClientPortalUserUpdate,
    EmployeeGroupUpdateIn,
    EmployeeVisibleOut,
    EquipmentCatalogOut,
    EquipmentCreateIn,
    EquipmentVisibleOut,
    ObservationCreate,
    ObservationOpsOut,
    ObservationOut,
    ObservationResolveIn,
    SiteCreateIn,
    SiteGroupQuotasIn,
    SiteVisibleOut,
)
from app.modules.client_portal.security import create_client_portal_token, current_client_user
from app.modules.commercial.models import Client
from sqlalchemy import select


router = APIRouter()

CLIENT_PORTAL_DEFAULT_PERMISSIONS = {
    "view_employees": True,
    "view_observations": True,
    "create_observations": True,
    "view_sites": True,
    "view_equipment": True,
    "create_sites": True,
    "assign_employees": True,
    "create_equipment": True,
}


def _client_permissions(db: Session, user: ClientPortalUser) -> dict[str, bool]:
    client = db.get(Client, user.client_id)
    data = client.data if client and isinstance(client.data, dict) else {}
    configured = data.get("portalPermissions") if isinstance(data.get("portalPermissions"), dict) else {}
    camel_keys = {
        "view_employees": "viewEmployees",
        "view_observations": "viewObservations",
        "create_observations": "createObservations",
        "view_sites": "viewSites",
        "view_equipment": "viewEquipment",
        "create_sites": "createSites",
        "assign_employees": "assignEmployees",
        "create_equipment": "createEquipment",
    }
    return {key: bool(configured.get(key, configured.get(camel_keys[key], default))) for key, default in CLIENT_PORTAL_DEFAULT_PERMISSIONS.items()}


def _require_client_permission(db: Session, user: ClientPortalUser, permission: str) -> None:
    if not _client_permissions(db, user).get(permission, False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cette fonctionnalité n'est pas autorisée pour votre compte client.")


def _ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _limit_public(request: Request, name: str, maxn: int) -> None:
    key = f"client_portal:{name}:{_ip(request)}"
    if rate_limit.record_failure(key, settings.login_window_seconds) > maxn:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives. Réessayez dans quelques minutes.",
            headers={"Retry-After": str(settings.login_window_seconds)},
        )


@router.get("/public/branding")
def public_branding(request: Request, db: Session = Depends(get_db)):
    """Identité visuelle du client (nom, logo, couleurs) résolue depuis le sous-domaine —
    volontairement PUBLIC (pas de current_client_user) : l'écran de connexion en a besoin
    avant toute authentification. N'expose rien de sensible, uniquement de la présentation."""
    host = (request.headers.get("host") or "").split(":")[0].lower()
    slug = host.split(".")[0] if "." in host else host
    client = db.execute(
        select(Client).where(Client.portal_slug == slug, Client.portal_enabled.is_(True))
    ).scalar_one_or_none()
    if not client:
        return {"client_name": None, "logo_data_uri": None, "primary_color": None, "accent_color": None}
    data = client.data if isinstance(client.data, dict) else {}
    return {
        "client_name": client.name,
        "logo_data_uri": data.get("portalLogoDataUri") or None,
        "primary_color": data.get("portalPrimaryColor") or None,
        "accent_color": data.get("portalAccentColor") or None,
    }


@router.post("/auth/login", response_model=ClientPortalTokenOut)
def login(payload: ClientLoginRequest, request: Request, db: Session = Depends(get_db)):
    _limit_public(request, "login", 20)
    user = service.authenticate_client_user(db, payload.username, payload.password)
    client = db.get(Client, user.client_id)
    return ClientPortalTokenOut(
        access_token=create_client_portal_token(user),
        must_change_password=user.must_change_password,
        client_id=user.client_id,
        client_name=client.name if client else "",
        full_name=user.full_name,
        permissions=_client_permissions(db, user),
    )


@router.post("/auth/change-password")
def change_password(
    payload: ClientChangePasswordIn,
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    service.change_client_password(db, user, payload.current_password, payload.new_password)
    return {"status": "success"}


@router.get("/me", response_model=ClientMeOut)
def me(db: Session = Depends(get_db), user: ClientPortalUser = Depends(current_client_user)):
    client = db.get(Client, user.client_id)
    return ClientMeOut(
        must_change_password=user.must_change_password,
        client_id=user.client_id,
        client_name=client.name if client else "",
        full_name=user.full_name,
        permissions=_client_permissions(db, user),
    )


@router.get("/reference/assignment-options")
def assignment_options(db: Session = Depends(get_db), user: ClientPortalUser = Depends(current_client_user)):
    _require_client_permission(db, user, "assign_employees")
    sites = db.execute(select(Site).where(Site.client_id == user.client_id, Site.active == 1).order_by(Site.name)).scalars().all()
    rotations = db.execute(select(RotationTemplate).where(RotationTemplate.active == 1).order_by(RotationTemplate.name)).scalars().all()
    site_options = []
    for row in sites:
        plan = row.equipment_plan if isinstance(row.equipment_plan, dict) else {}
        rotation = plan.get("clientPortalRotation") if isinstance(plan.get("clientPortalRotation"), dict) else {}
        system = str(rotation.get("system") or "").strip()
        first_shift = str(rotation.get("first_shift_time") or "").strip()
        planning_label = f"24h/7j — {system.upper()} · première relève {first_shift}" if system else "Aucun planning configuré"
        site_options.append({"id": row.id, "name": row.name, "planning_label": planning_label, "has_site_planning": bool(system)})
    return {
        "sites": site_options,
        "groups": list(GROUP_LETTERS),
        "plannings": [{"id": row.id, "code": row.code, "name": row.name} for row in rotations],
    }


@router.get("/employees", response_model=list[EmployeeVisibleOut])
def employees(db: Session = Depends(get_db), user: ClientPortalUser = Depends(current_client_user)):
    _require_client_permission(db, user, "view_employees")
    return service.visible_employees_for_client(db, user.client_id)


@router.patch("/employees/{employee_id}/group", response_model=EmployeeVisibleOut)
def update_employee_group(
    employee_id: int,
    payload: EmployeeGroupUpdateIn,
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    _require_client_permission(db, user, "assign_employees")
    return service.update_employee_group_for_client(db, user.client_id, employee_id, payload)


@router.get("/sites", response_model=list[SiteVisibleOut])
def sites(db: Session = Depends(get_db), user: ClientPortalUser = Depends(current_client_user)):
    _require_client_permission(db, user, "view_sites")
    return service.visible_sites_for_client(db, user.client_id)


@router.post("/sites", response_model=SiteVisibleOut, status_code=status.HTTP_201_CREATED)
def create_site(
    payload: SiteCreateIn,
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    _require_client_permission(db, user, "create_sites")
    return service.create_site_for_client(db, user.client_id, payload)


@router.put("/sites/{site_id}", response_model=SiteVisibleOut)
def update_site(
    site_id: int,
    payload: SiteCreateIn,
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    _require_client_permission(db, user, "create_sites")
    return service.update_site_for_client(db, user.client_id, site_id, payload)


@router.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_site(
    site_id: int,
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    _require_client_permission(db, user, "create_sites")
    service.archive_site_for_client(db, user.client_id, site_id)


@router.put("/sites/{site_id}/groups", response_model=SiteVisibleOut)
def update_site_group_quotas(
    site_id: int,
    payload: SiteGroupQuotasIn,
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    _require_client_permission(db, user, "assign_employees")
    return service.update_site_group_quotas_for_client(db, user.client_id, site_id, payload)


@router.get("/equipment", response_model=list[EquipmentVisibleOut])
def equipment(db: Session = Depends(get_db), user: ClientPortalUser = Depends(current_client_user)):
    _require_client_permission(db, user, "view_equipment")
    return service.visible_equipment_for_client(db, user.client_id)


@router.get("/equipment/catalog", response_model=list[EquipmentCatalogOut])
def equipment_catalog(db: Session = Depends(get_db), user: ClientPortalUser = Depends(current_client_user)):
    _require_client_permission(db, user, "view_equipment")
    return service.equipment_catalog(db)


@router.post("/equipment", response_model=EquipmentVisibleOut, status_code=status.HTTP_201_CREATED)
def create_equipment(
    payload: EquipmentCreateIn,
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    _require_client_permission(db, user, "create_equipment")
    return service.create_equipment_for_client(db, user.client_id, payload)


@router.get("/observations", response_model=list[ObservationOut])
def observations(
    employee_id: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    _require_client_permission(db, user, "view_observations")
    return service.list_observations_for_client(db, user.client_id, employee_id, status)


@router.post("/observations", response_model=ObservationOut, status_code=status.HTTP_201_CREATED)
def create_observation(
    payload: ObservationCreate,
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    _require_client_permission(db, user, "create_observations")
    row = service.create_observation(db, user, payload)
    return service.observation_out_dict(db, row)


@router.post("/employee-action-requests", response_model=ObservationOut, status_code=status.HTTP_201_CREATED)
async def create_employee_action_request(
    employee_id: Annotated[int, Form()],
    action: Annotated[str, Form()],
    reason: Annotated[str, Form()],
    target_site_id: Annotated[int | None, Form()] = None,
    target_group_code: Annotated[str | None, Form()] = None,
    target_rotation_id: Annotated[int | None, Form()] = None,
    effective_date: Annotated[date | None, Form()] = None,
    file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    user: ClientPortalUser = Depends(current_client_user),
):
    _require_client_permission(db, user, "create_observations")
    content = None
    if file and file.filename:
        allowed_types = {"application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
        if file.content_type not in allowed_types:
            raise HTTPException(status_code=422, detail="Formats autorisés : PDF, image, Word")
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=422, detail="La pièce jointe ne doit pas dépasser 10 Mo")
    row = service.create_employee_action_request(
        db, user, employee_id, action, reason,
        target_site_id, target_group_code, target_rotation_id, effective_date,
    )
    if file and file.filename and content is not None:
        suffix = {
            "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
            "application/msword": ".doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        }[file.content_type]
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
        stored_name = f"client_request_{row.id}_{uuid4().hex}{suffix}"
        (DOCS_DIR / stored_name).write_bytes(content)
        db.add(Document(
            owner_type="client_observation", owner_id=row.id,
            label="Pièce jointe à la demande client", file_name=Path(file.filename).name[:255],
            file_path=f"{PUBLIC_DOC_PREFIX}/{stored_name}", mime_type=file.content_type,
            uploaded_by=user.username,
        ))
        db.commit()
    return service.observation_out_dict(db, row)


@router.get("/reference/categories")
def reference_categories():
    return OBSERVATION_CATEGORIES


# ── Écran interne OPS (triage des signalements) ─────────────────────────────────────────
# Ces endpoints vivent ici (plutôt que dans app/modules/ops/routes.py) pour éviter un
# import circulaire : client_portal.service dépend déjà des helpers de périmètre de
# ops.routes (_allowed_assignment_site_ids), donc ops.routes ne peut pas dépendre en
# retour de client_portal.

@router.get("/ops/observations", response_model=list[ObservationOpsOut])
def ops_observations(
    client_id: int | None = None,
    employee_id: int | None = None,
    site_id: int | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return service.list_observations_for_ops(db, user, client_id, employee_id, site_id, status, date_from, date_to)


@router.post("/ops/observations/{observation_id}/resolve", response_model=ObservationOpsOut)
def ops_resolve_observation(
    observation_id: int,
    payload: ObservationResolveIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    row = service.resolve_observation(db, observation_id, user, payload)
    return service.observation_ops_out_dict(db, row)


# ── Administration (comptes staff internes, réservé aux admins) ────────────────────────

@router.get("/admin/users", response_model=list[ClientPortalUserOut])
def admin_list_users(client_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    stmt = select(ClientPortalUser)
    if client_id:
        stmt = stmt.where(ClientPortalUser.client_id == client_id)
    return db.execute(stmt.order_by(ClientPortalUser.id.desc())).scalars().all()


@router.post("/admin/users", response_model=ClientPortalUserCreatedOut, status_code=status.HTTP_201_CREATED)
def admin_create_user(payload: ClientPortalUserCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    row, temp_password = service.create_client_portal_user(db, payload)
    return ClientPortalUserCreatedOut(**ClientPortalUserOut.model_validate(row).model_dump(), temporary_password=temp_password)


@router.patch("/admin/users/{user_id}", response_model=ClientPortalUserOut)
def admin_update_user(user_id: int, payload: ClientPortalUserUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    return service.update_client_portal_user(db, user_id, payload)


@router.post("/admin/users/{user_id}/reset-password")
def admin_reset_password(user_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    temp_password = service.reset_client_portal_user_password(db, user_id)
    return {"temporary_password": temp_password}


@router.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    row = db.get(ClientPortalUser, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": user_id}
