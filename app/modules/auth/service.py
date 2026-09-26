from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.modules.auth.models import User
from app.modules.auth.schemas import UserCreate, UserUpdate


def normalize_username(value: str) -> str:
    return (value or "").strip().upper()


def normalize_login(value: str) -> str:
    return (value or "").strip()


def get_user_by_login(db: Session, login: str) -> User | None:
    lookup = normalize_login(login)
    if not lookup:
        return None
    lowered = lookup.lower()
    stmt = select(User).where(
        or_(
            User.username == lookup,
            User.email == lookup,
            func.lower(User.username) == lowered,
            func.lower(User.email) == lowered,
        )
    )
    return db.execute(stmt).scalar_one_or_none()


def get_user(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def _validate_beo_scope(db: Session, *, role, modules, societies, sites, global_society_access) -> None:
    # Import paresseux : site_workforce.security importe auth.dependencies.
    from app.modules.site_workforce.security import validate_beo_account_scope
    validate_beo_account_scope(db, role=role, modules=modules, societies=societies, sites=sites,
                               global_society_access=global_society_access)


def create_user(db: Session, payload: UserCreate) -> User:
    username = normalize_username(payload.username)
    email = normalize_login(str(payload.email)) if payload.email else None
    if get_user_by_login(db, username) or (email and get_user_by_login(db, email)):
        raise HTTPException(status_code=409, detail="Utilisateur déjà existant")
    _validate_beo_scope(db, role=payload.role, modules=payload.authorized_modules,
                        societies=payload.authorized_societies, sites=payload.authorized_sites,
                        global_society_access=payload.global_society_access)
    user = User(
        username=username,
        email=email,
        full_name=payload.full_name or username,
        role=payload.role,
        access_level=payload.access_level,
        authorized_societies=payload.authorized_societies or [],
        authorized_structures=payload.authorized_structures or [],
        authorized_sites=payload.authorized_sites or [],
        authorized_actions=payload.authorized_actions or [],
        authorized_modules=payload.authorized_modules or [],
        supervisor_read_only=payload.supervisor_read_only,
        global_society_access=payload.global_society_access,
        password_hash=hash_password(payload.password),
        validation_password_hash=hash_password(payload.validation_password) if payload.validation_password else None,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    user.has_validation_password = bool(user.validation_password_hash)
    return user


def authenticate(db: Session, username: str, password: str) -> tuple[str, User]:
    user = get_user_by_login(db, normalize_login(username))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants incorrects")
    password_ok = verify_password(password, user.password_hash)
    if not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants incorrects")
    token = create_access_token(str(user.id), {"role": user.role, "username": user.username})
    return token, user


def update_user(db: Session, user: User, payload: UserUpdate) -> User:
    if payload.email is not None:
        email = normalize_login(str(payload.email)) if payload.email else None
        if email:
            conflict = db.execute(select(User).where(func.lower(User.email) == email.lower(), User.id != user.id)).scalar_one_or_none()
            if conflict:
                raise HTTPException(status_code=409, detail="Cette adresse email est déjà attribuée à un autre utilisateur")
        user.email = email
    if payload.full_name is not None:
        user.full_name = payload.full_name or user.username
    if payload.role is not None:
        user.role = payload.role
    if payload.access_level is not None:
        user.access_level = payload.access_level
    if payload.authorized_societies is not None:
        user.authorized_societies = payload.authorized_societies or []
    if payload.authorized_structures is not None:
        user.authorized_structures = payload.authorized_structures or []
    if payload.authorized_sites is not None:
        user.authorized_sites = payload.authorized_sites or []
    if payload.authorized_actions is not None:
        user.authorized_actions = payload.authorized_actions or []
    if payload.authorized_modules is not None:
        user.authorized_modules = payload.authorized_modules or []
    if payload.supervisor_read_only is not None:
        user.supervisor_read_only = payload.supervisor_read_only
    if payload.global_society_access is not None:
        user.global_society_access = payload.global_society_access
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.validation_password:
        user.validation_password_hash = hash_password(payload.validation_password)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    # Valide l'état FINAL fusionné (existant + PATCH partiel) : un PATCH ne peut jamais
    # laisser un compte BEO ACTIF dans un état que le portail refuserait. Un compte
    # désactivé ne se connecte pas : le suspendre ne doit jamais être bloqué par un
    # périmètre incomplet, et sa réactivation repasse par cette validation.
    try:
        if user.is_active:
            _validate_beo_scope(db, role=user.role, modules=user.authorized_modules,
                                societies=user.authorized_societies, sites=user.authorized_sites,
                                global_society_access=user.global_society_access)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(user)
    user.has_validation_password = bool(user.validation_password_hash)
    return user
