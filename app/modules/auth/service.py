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


def create_user(db: Session, payload: UserCreate) -> User:
    username = normalize_username(payload.username)
    email = normalize_login(str(payload.email)) if payload.email else None
    if get_user_by_login(db, username) or (email and get_user_by_login(db, email)):
        raise HTTPException(status_code=409, detail="Utilisateur déjà existant")
    user = User(
        username=username,
        email=email,
        full_name=payload.full_name or username,
        role=payload.role,
        access_level=payload.access_level,
        authorized_societies=payload.authorized_societies or [],
        authorized_structures=payload.authorized_structures or [],
        authorized_sites=payload.authorized_sites or [],
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
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
        user.email = str(payload.email) if payload.email else None
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
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return user
