import hmac
import smtplib
import re
from email.message import EmailMessage
from email.utils import formataddr

from fastapi import APIRouter, Depends, HTTPException, Request, status
from urllib.parse import unquote
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.config import settings
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import AccessRule, User
from app.core.audit import append_audit
from app.core.granular_permissions import (
    is_global_administrator,
    load_explicit_permissions,
    load_feature_permissions,
    replace_explicit_permissions,
    replace_feature_permissions,
    validate_feature_permissions,
    validate_permission_pairs,
)
from app.core.permission_catalog import CANONICAL_ACTIONS, CANONICAL_MODULES, feature_catalog_payload
from app.modules.auth.schemas import (
    AccessRuleIn,
    AccessRuleOut,
    AdminSystemLoginIn,
    AdminRecoveryIn,
    FeaturePermissionCatalogOut,
    FeaturePermissionOut,
    FeaturePermissionsReplaceIn,
    LoginIn,
    ModulePermissionCatalogOut,
    ModulePermissionOut,
    ModulePermissionsReplaceIn,
    TokenOut,
    UserCreate,
    UserOut,
    UserUpdate,
    UserModulePermissionsOut,
    UserFeaturePermissionsOut,
)
from app.core.security import create_access_token, hash_password
from app.modules.auth.service import authenticate, create_user, update_user


router = APIRouter()


DEDICATED_LOGIN_RULES: dict[str, tuple[tuple[str, ...], str]] = {
    "drh": (("DRH",), "DRH"),
    "ops": (("OPS",), "OPS"),
    "materiel": (("MAT",), "MATERIEL/EQUIP"),
    "fac": (("FAC", "FIN"), "FACTURATION"),
    "finances": (("FIN", "FAC"), "FINANCES/COMPTA"),
    "finance": (("FIN", "FAC"), "FINANCES/COMPTA"),
    "commercial": (("COM",), "COMMERCIAL"),
    "secretariat": (("SEC",), "SECRETARIAT GENERAL"),
    "agenda": (("AGD",), "AGENDA"),
    "pointage": (("PTG",), "POINTAGE"),
    "pointeur": (("PTG", "OPS", "SUP"), "POINTEUR"),
    "recrute": (("REC",), "RECRUTEMENT"),
    "pret": (("PRET", "DRH", "FIN", "PAI", "DG", "ADG", "ADM"), "PRÊTS ET AVANCES"),
    "caisse": (("CAI", "TRS", "FIN", "DG", "ADG", "ADM"), "CAISSE"),
}


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _host_subdomain(request: Request) -> str:
    host = (request.headers.get("host") or "").split(":")[0].strip().lower()
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return ""
    return host.split(".")[0] if "." in host else ""


def _username_prefix(username: str | None) -> str:
    match = re.match(r"^([A-Z]+)", (username or "").strip().upper())
    return match.group(1) if match else ""


def enforce_subdomain_login_scope(request: Request, user: User) -> None:
    subdomain = _host_subdomain(request)
    if not subdomain or subdomain in {"atlas", "sgdi", "www"}:
        return
    # Politique centrale nouvelle : un même compte et un même mot de passe ouvrent
    # tous les modules explicitement cochés par l'administrateur. Les comptes créés
    # avant cette fonctionnalité (NULL) conservent le contrôle historique ci-dessous.
    if user.authorized_modules is not None:
        allowed = {str(value or "").strip().lower() for value in user.authorized_modules}
        aliases = {"finance": "finances", "commercial": "dc", "portail-rh": "portail"}
        module_key = aliases.get(subdomain, subdomain)
        if is_admin_role(user.role) or subdomain in allowed or module_key in allowed:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ce module n'est pas autorisé pour votre compte. Contactez l'Administration système.",
        )
    if subdomain == "dc":
        # dc.irongs.com reprend le module Commercial d'ATLAS : l'autorisation dépend du
        # périmètre Commercial configuré sur le compte, pas de son préfixe historique.
        structures = {
            str(value or "").strip().lower()
            for value in (user.authorized_structures or [])
            if str(value or "").strip()
        }
        if (
            is_admin_role(user.role)
            or _username_prefix(user.username) == "COM"
            or "commercial" in structures
        ):
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ce compte n'est pas autorisé à accéder au module Commercial.",
        )
    rule = DEDICATED_LOGIN_RULES.get(subdomain)
    if rule is None:
        return
    prefixes, label = rule
    if _username_prefix(user.username) in prefixes:
        return
    expected = " ou ".join(f"{prefix}xx" for prefix in prefixes)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Ce sous-domaine est réservé aux comptes {label} ({expected}). Utilisez atlas.irongs.com pour le portail central.",
    )


def _enforce_login_rate(ip: str) -> None:
    key = f"login:{ip}"
    if rate_limit.failure_count(key, settings.login_window_seconds) >= settings.login_max_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives de connexion. Réessayez dans quelques minutes.",
            headers={"Retry-After": str(settings.login_window_seconds)},
        )


def is_admin_role(role: str | None) -> bool:
    value = (role or "").strip().upper()
    return value in {"ADMIN", "ADM", "ADM1", "ADM2"}


def is_admin_system_username(username: str | None) -> bool:
    normalized = (username or "").strip().upper()
    configured = (settings.admin_system_username or settings.admin_initial_username or "").strip().upper()
    return bool(normalized) and (
        normalized == configured or normalized == "ADMIN" or normalized.startswith("ADM") or normalized.startswith("ADG")
    )


def require_admin(user: User) -> None:
    if not is_admin_role(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès administrateur requis")


def require_explicit_global_admin(user: User) -> None:
    """Contrôle additionnel, exécuté après current_user et ses gardes legacy."""
    if not is_global_administrator(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administration globale explicite requise",
        )


def send_user_credentials_email(recipient: str, username: str, password: str, validation_password: str) -> None:
    if not settings.smtp_host or not (settings.smtp_from_email or settings.smtp_username):
        raise RuntimeError("Serveur SMTP non configuré")
    from_email = settings.smtp_from_email or settings.smtp_username
    message = EmailMessage()
    message["From"] = formataddr((settings.smtp_from_name, from_email))
    message["To"] = recipient
    message["Subject"] = "ATLAS - Création de votre compte utilisateur"
    message.set_content(
        "Votre compte ATLAS a été créé.\n\n"
        f"Identifiant : {username}\n"
        f"Mot de passe de connexion initial : {password}\n"
        f"Mot de passe de validation : {validation_password}\n\n"
        "Le mot de passe de validation est demandé pour confirmer les actions sensibles, notamment la validation finale d'une fiche candidat.\n"
        "Conservez ces informations de manière confidentielle."
    )
    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
        return
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_username and settings.smtp_password:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


def admin_system_username_candidates() -> list[str]:
    candidates = [
        settings.admin_system_username,
        settings.admin_initial_username,
        "ADG01",
        "admin",
        "ADM01",
    ]
    clean: list[str] = []
    seen: set[str] = set()
    for value in candidates:
        username = (value or "").strip()
        key = username.lower()
        if username and key not in seen:
            clean.append(username)
            seen.add(key)
    return clean


def find_admin_system_user(db: Session) -> User | None:
    for username in admin_system_username_candidates():
        user = (
            db.query(User)
            .filter(func.lower(User.username) == username.lower(), User.is_active.is_(True))
            .one_or_none()
        )
        if user is not None and is_admin_role(user.role) and is_admin_system_username(user.username):
            return user
    admins = (
        db.query(User)
        .filter(User.is_active.is_(True))
        .order_by(User.username)
        .all()
    )
    active_admins = [user for user in admins if is_admin_role(user.role)]
    for user in active_admins:
        if (user.access_level or "").strip().upper() == "H5" and is_admin_system_username(user.username):
            return user
    for user in active_admins:
        if is_admin_system_username(user.username):
            return user
    return None


def admin_system_recovery_password_ok(password: str) -> bool:
    return bool(
        settings.admin_recovery_enabled
        and settings.admin_recovery_secret
        and hmac.compare_digest(password, settings.admin_recovery_secret)
    )


def ensure_admin_system_user(db: Session, password: str, username: str | None = None) -> User | None:
    requested_username = (username or "").strip()
    if requested_username:
        requested_user = find_user_by_identifier(db, requested_username)
        if (
            requested_user is not None
            and requested_user.is_active
            and is_admin_role(requested_user.role)
            and (requested_user.access_level or "").strip().upper() == "H5"
            and is_admin_system_username(requested_user.username)
        ):
            return requested_user
        return None
    user = find_admin_system_user(db)
    if user is not None:
        return user
    return None


def find_user_by_identifier(db: Session, identifier: str) -> User | None:
    lookup = unquote(identifier or "").strip()
    candidates = [lookup]
    if "/" in lookup:
        candidates.append(lookup.replace("/", ""))
        candidates.append(lookup.replace("/", "-"))
        candidates.append(lookup.split("/")[-1])
    candidates = list(dict.fromkeys(c for c in candidates if c))
    lowered = [c.lower() for c in candidates]
    return (
        db.query(User)
        .filter(
            or_(
                User.username.in_(candidates),
                User.email.in_(candidates),
                func.lower(User.username).in_(lowered),
                func.lower(User.email).in_(lowered),
            )
        )
        .one_or_none()
    )


@router.post("/register", response_model=UserOut)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if not settings.allow_public_registration:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inscription publique désactivée")
    # Une inscription publique ne peut jamais s'attribuer un périmètre global,
    # quels que soient les champs envoyés par le client.
    safe_payload = payload.model_copy(update={
        "role": "user", "access_level": None, "authorized_societies": [],
        "authorized_structures": [], "authorized_sites": [], "authorized_actions": ["read"],
        "authorized_modules": [], "global_society_access": False,
    })
    return create_user(db, safe_payload)


@router.post("/users", response_model=UserOut)
def create_user_as_admin(
    payload: UserCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require_admin(user)
    if not payload.email:
        raise HTTPException(status_code=422, detail="Une adresse email personnelle est obligatoire pour chaque utilisateur")
    if not payload.validation_password:
        raise HTTPException(status_code=422, detail="Le mot de passe de validation est obligatoire")
    created = create_user(db, payload)
    created.has_validation_password = bool(created.validation_password_hash)
    created.credentials_email_sent = False
    created.credentials_email_error = None
    if payload.email and payload.validation_password:
        try:
            send_user_credentials_email(str(payload.email), created.username, payload.password, payload.validation_password)
            created.credentials_email_sent = True
        except Exception as exc:
            created.credentials_email_error = str(exc)[:180]
    return created


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    return db.query(User).order_by(User.username).all()


@router.patch("/users/{username:path}", response_model=UserOut)
def patch_user(
    username: str,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require_admin(user)
    target = find_user_by_identifier(db, username)
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return update_user(db, target, payload)


@router.delete("/users/{username:path}")
def delete_user(username: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    target = find_user_by_identifier(db, username)
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="Impossible de supprimer votre propre compte")
    db.delete(target)
    db.commit()
    return {"deleted": target.username}


@router.get("/access-rules", response_model=list[AccessRuleOut])
def list_access_rules(db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not is_admin_role(user.role):
        rules = db.query(AccessRule).filter(AccessRule.role == user.role).order_by(AccessRule.module_key).all()
    else:
        rules = db.query(AccessRule).order_by(AccessRule.module_key, AccessRule.role).all()
    return rules


@router.put("/access-rules", response_model=list[AccessRuleOut])
def replace_access_rules(
    payload: list[AccessRuleIn],
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require_admin(user)
    db.query(AccessRule).delete()
    for item in payload:
        db.add(AccessRule(module_key=item.module_key, role=item.role, allowed=item.allowed))
    db.commit()
    return db.query(AccessRule).order_by(AccessRule.module_key, AccessRule.role).all()


@router.patch("/access-rules/{module_key}/{role}", response_model=AccessRuleOut)
def patch_access_rule(
    module_key: str,
    role: str,
    payload: AccessRuleIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require_admin(user)
    rule = db.query(AccessRule).filter(AccessRule.module_key == module_key, AccessRule.role == role).one_or_none()
    if rule is None:
        rule = AccessRule(module_key=module_key, role=role, allowed=payload.allowed)
        db.add(rule)
    else:
        rule.allowed = payload.allowed
    db.commit()
    db.refresh(rule)
    return rule


@router.get("/granular-permissions/catalog", response_model=ModulePermissionCatalogOut)
def granular_permission_catalog(user: User = Depends(current_user)):
    require_explicit_global_admin(user)
    return {"modules": list(CANONICAL_MODULES), "actions": list(CANONICAL_ACTIONS)}


@router.get("/granular-permissions/feature-catalog", response_model=FeaturePermissionCatalogOut)
def granular_feature_permission_catalog(user: User = Depends(current_user)):
    require_explicit_global_admin(user)
    return feature_catalog_payload()


def _module_permissions_response(target: User, db: Session) -> dict:
    permissions = load_explicit_permissions(db, target.id)
    return {
        "user_id": target.id,
        "username": target.username,
        "permissions": [
            ModulePermissionOut(module_key=row.module_key, action_key=row.action_key)
            for row in permissions
        ],
        "permission_count": len(permissions),
        "granular_permissions_active": False,
        "legacy_permissions_active": True,
        "authorized_societies": target.authorized_societies,
        "authorized_sites": target.authorized_sites,
    }


@router.get(
    "/users/{user_id}/module-permissions",
    response_model=UserModulePermissionsOut,
)
def get_user_module_permissions(
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require_explicit_global_admin(user)
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return _module_permissions_response(target, db)


@router.put(
    "/users/{user_id}/module-permissions",
    response_model=UserModulePermissionsOut,
)
def put_user_module_permissions(
    user_id: int,
    payload: ModulePermissionsReplaceIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require_explicit_global_admin(user)
    target = db.execute(select(User).where(User.id == user_id).with_for_update()).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    try:
        validate_permission_pairs(payload.permissions)
    except ValueError as exc:
        append_audit(
            db,
            action="granular_permission.replace",
            resource="user_module_permission",
            resource_id=target.id,
            result="refused",
            user=user,
            request=request,
            new_state={"target_user_id": target.id, "reason": str(exc)},
        )
        db.commit()
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        additions, removals = replace_explicit_permissions(
            db,
            user_id=target.id,
            created_by_user_id=user.id,
            permissions=payload.permissions,
        )
        for module_key, action_key in additions:
            append_audit(
                db,
                action="granular_permission.add",
                resource="user_module_permission",
                resource_id=target.id,
                result="success",
                user=user,
                request=request,
                new_state={
                    "target_user_id": target.id,
                    "target_username": target.username,
                    "module": module_key,
                    "action": action_key,
                    "change": "add",
                },
            )
        for module_key, action_key in removals:
            append_audit(
                db,
                action="granular_permission.remove",
                resource="user_module_permission",
                resource_id=target.id,
                result="success",
                user=user,
                request=request,
                old_state={
                    "target_user_id": target.id,
                    "target_username": target.username,
                    "module": module_key,
                    "action": action_key,
                    "change": "remove",
                },
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _module_permissions_response(target, db)


def _feature_permissions_response(target: User, db: Session) -> dict:
    permissions = load_feature_permissions(db, target.id)
    return {
        "user_id": target.id,
        "username": target.username,
        "permissions": [
            FeaturePermissionOut(
                module_key=row.module_key,
                feature_key=row.feature_key,
                action_key=row.action_key,
            )
            for row in permissions
        ],
        "permission_count": len(permissions),
        "granular_permissions_active": False,
        "legacy_permissions_active": True,
        "authorized_societies": target.authorized_societies,
        "authorized_sites": target.authorized_sites,
    }


@router.get(
    "/users/{user_id}/feature-permissions",
    response_model=UserFeaturePermissionsOut,
)
def get_user_feature_permissions(
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require_explicit_global_admin(user)
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return _feature_permissions_response(target, db)


@router.put(
    "/users/{user_id}/feature-permissions",
    response_model=UserFeaturePermissionsOut,
)
def put_user_feature_permissions(
    user_id: int,
    payload: FeaturePermissionsReplaceIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require_explicit_global_admin(user)
    target = db.execute(select(User).where(User.id == user_id).with_for_update()).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    try:
        validate_feature_permissions(payload.permissions)
    except ValueError as exc:
        append_audit(
            db,
            action="feature_permission.replace",
            resource="user_feature_permission",
            resource_id=target.id,
            result="refused",
            user=user,
            request=request,
            new_state={"target_user_id": target.id, "reason": str(exc)},
        )
        db.commit()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        additions, removals = replace_feature_permissions(
            db,
            user_id=target.id,
            created_by_user_id=user.id,
            permissions=payload.permissions,
        )
        for module_key, feature_key, action_key in additions:
            append_audit(
                db,
                action="feature_permission.add",
                resource="user_feature_permission",
                resource_id=target.id,
                result="success",
                user=user,
                request=request,
                new_state={
                    "target_user_id": target.id,
                    "target_username": target.username,
                    "module": module_key,
                    "feature": feature_key,
                    "action": action_key,
                    "change": "add",
                },
            )
        for module_key, feature_key, action_key in removals:
            append_audit(
                db,
                action="feature_permission.remove",
                resource="user_feature_permission",
                resource_id=target.id,
                result="success",
                user=user,
                request=request,
                old_state={
                    "target_user_id": target.id,
                    "target_username": target.username,
                    "module": module_key,
                    "feature": feature_key,
                    "action": action_key,
                    "change": "remove",
                },
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _feature_permissions_response(target, db)


@router.post("/admin-system-login", response_model=TokenOut)
def admin_system_login(payload: AdminSystemLoginIn, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    _enforce_login_rate(ip)
    user = ensure_admin_system_user(db, payload.password, payload.username)
    # Sans identifiant explicite, plusieurs comptes système historiques peuvent
    # coexister. Sélectionner celui dont le secret propre correspond, sans jamais
    # réappliquer un secret de configuration.
    if not payload.username:
        for candidate_name in admin_system_username_candidates():
            candidate = find_user_by_identifier(db, candidate_name)
            if candidate and candidate.is_active and is_admin_role(candidate.role) and is_admin_system_username(candidate.username):
                try:
                    _, authenticated = authenticate(db, candidate.username, payload.password)
                    user = authenticated
                    break
                except HTTPException:
                    continue
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Compte admin introuvable ou inactif")
    try:
        _, authenticated = authenticate(db, user.username, payload.password)
        password_ok = authenticated.id == user.id and is_admin_role(authenticated.role)
    except HTTPException:
        password_ok = False
    if not password_ok:
        rate_limit.record_failure(f"login:{ip}", settings.login_window_seconds)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Mot de passe administration système incorrect")
    rate_limit.clear(f"login:{ip}")
    token = create_access_token(str(user.id), {"role": user.role, "username": user.username, "admin_system": True})
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.post("/admin-system-recovery")
def admin_system_recovery(payload: AdminRecoveryIn, request: Request, db: Session = Depends(get_db)):
    """Récupération exceptionnelle, désactivée par défaut et jamais appelée au démarrage."""
    ip = _client_ip(request)
    _enforce_login_rate(ip)
    user = find_user_by_identifier(db, payload.username)
    allowed = admin_system_recovery_password_ok(payload.recovery_secret)
    if not allowed or user is None or not is_admin_system_username(user.username):
        append_audit(db, action="admin.recovery", resource="user", resource_id=payload.username,
                     result="refused", request=request)
        rate_limit.record_failure(f"login:{ip}", settings.login_window_seconds)
        db.commit()
        raise HTTPException(status_code=403, detail="Récupération administrateur indisponible ou refusée")
    user.password_hash = hash_password(payload.new_password)
    user.role = "admin"
    user.access_level = "H5"
    user.authorized_structures = ["admin"]
    user.global_society_access = True
    user.is_active = True
    append_audit(db, action="admin.recovery", resource="user", resource_id=user.id,
                 result="success", user=user, request=request, new_state={"credentials_rotated": True})
    rate_limit.clear(f"login:{ip}")
    db.commit()
    return {"ok": True}


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    _enforce_login_rate(ip)
    try:
        token, user = authenticate(db, payload.username, payload.password)
        enforce_subdomain_login_scope(request, user)
    except HTTPException:
        rate_limit.record_failure(f"login:{ip}", settings.login_window_seconds)
        raise
    rate_limit.clear(f"login:{ip}")
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.get("/me", response_model=UserOut)
def me(user=Depends(current_user)):
    # Expose the existing server policy; the browser must not reconstruct grants
    # from cached profiles or interpret an empty list as unrestricted access.
    from app.modules.auth.dependencies import _legacy_module_keys, _normalized_module_keys
    from app.modules.drh.routes import _ensure_recruitment_access

    result = UserOut.model_validate(user).model_dump()
    result["module_access_global"] = is_admin_role(user.role)
    result["effective_modules"] = sorted(
        _legacy_module_keys(user) if user.authorized_modules is None
        else _normalized_module_keys(user.authorized_modules)
    )
    try:
        _ensure_recruitment_access(user)
        result["recruitment_access"] = True
    except HTTPException:
        result["recruitment_access"] = False
    result["has_validation_password"] = bool(user.validation_password_hash)
    return result
