from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.config import settings
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.auth.routes import require_admin
from app.modules.client_portal import service
from app.modules.client_portal.models import ClientPortalUser
from app.modules.client_portal.schemas import (
    OBSERVATION_CATEGORIES,
    ClientChangePasswordIn,
    ClientLoginRequest,
    ClientMeOut,
    ClientPortalTokenOut,
    ClientPortalUserCreate,
    ClientPortalUserCreatedOut,
    ClientPortalUserOut,
    ClientPortalUserUpdate,
    EmployeeVisibleOut,
    ObservationCreate,
    ObservationOpsOut,
    ObservationOut,
    ObservationResolveIn,
)
from app.modules.client_portal.security import create_client_portal_token, current_client_user
from app.modules.commercial.models import Client
from sqlalchemy import select


router = APIRouter()

CLIENT_PORTAL_DEFAULT_PERMISSIONS = {
    "view_employees": True,
    "view_observations": True,
    "create_observations": True,
}


def _client_permissions(db: Session, user: ClientPortalUser) -> dict[str, bool]:
    client = db.get(Client, user.client_id)
    data = client.data if client and isinstance(client.data, dict) else {}
    configured = data.get("portalPermissions") if isinstance(data.get("portalPermissions"), dict) else {}
    camel_keys = {
        "view_employees": "viewEmployees",
        "view_observations": "viewObservations",
        "create_observations": "createObservations",
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


@router.get("/employees", response_model=list[EmployeeVisibleOut])
def employees(db: Session = Depends(get_db), user: ClientPortalUser = Depends(current_client_user)):
    _require_client_permission(db, user, "view_employees")
    return service.visible_employees_for_client(db, user.client_id)


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
