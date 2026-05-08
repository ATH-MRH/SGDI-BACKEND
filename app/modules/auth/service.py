from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.modules.auth.models import User
from app.modules.auth.schemas import UserCreate, UserUpdate


def get_user_by_login(db: Session, login: str) -> User | None:
    stmt = select(User).where(or_(User.username == login, User.email == login))
    return db.execute(stmt).scalar_one_or_none()


def get_user(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def create_user(db: Session, payload: UserCreate) -> User:
    if get_user_by_login(db, payload.username) or (payload.email and get_user_by_login(db, payload.email)):
        raise HTTPException(status_code=409, detail="Utilisateur déjà existant")
    user = User(
        username=payload.username,
        email=str(payload.email) if payload.email else None,
        full_name=payload.full_name or payload.username,
        role=payload.role,
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, username: str, password: str) -> tuple[str, User]:
    user = get_user_by_login(db, username)
    if not user or not user.is_active or not verify_password(password, user.password_hash):
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
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return user
