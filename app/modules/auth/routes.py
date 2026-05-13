from fastapi import APIRouter, Depends, HTTPException, status
from urllib.parse import unquote
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import AccessRule, User
from app.modules.auth.schemas import (
    AccessRuleIn,
    AccessRuleOut,
    AdminSystemLoginIn,
    LoginIn,
    TokenOut,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.core.security import create_access_token
from app.modules.auth.service import authenticate, create_user, update_user


router = APIRouter()


def is_admin_role(role: str | None) -> bool:
    value = (role or "").strip().upper()
    return value in {"ADMIN", "ADM", "ADM1", "ADM2"}


def require_admin(user: User) -> None:
    if not is_admin_role(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès administrateur requis")


@router.post("/register", response_model=UserOut)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if not settings.allow_public_registration:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inscription publique désactivée")
    return create_user(db, payload)


@router.post("/users", response_model=UserOut)
def create_user_as_admin(
    payload: UserCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require_admin(user)
    return create_user(db, payload)


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
    lookup = unquote(username).strip()
    candidates = [lookup]
    if "/" in lookup:
        candidates.append(lookup.replace("/", ""))
        candidates.append(lookup.replace("/", "-"))
        candidates.append(lookup.split("/")[-1])
    target = db.query(User).filter(User.username.in_(dict.fromkeys(candidates))).one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return update_user(db, target, payload)


@router.delete("/users/{username:path}")
def delete_user(username: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    if username == user.username:
        raise HTTPException(status_code=400, detail="Impossible de supprimer votre propre compte")
    lookup = unquote(username).strip()
    candidates = [lookup]
    if "/" in lookup:
        candidates.append(lookup.replace("/", ""))
        candidates.append(lookup.replace("/", "-"))
        candidates.append(lookup.split("/")[-1])
    target = db.query(User).filter(User.username.in_(dict.fromkeys(candidates))).one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    db.delete(target)
    db.commit()
    return {"deleted": username}


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


@router.post("/admin-system-login", response_model=TokenOut)
def admin_system_login(payload: AdminSystemLoginIn, db: Session = Depends(get_db)):
    if not settings.admin_system_password:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès administration système désactivé")
    if payload.password != settings.admin_system_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Mot de passe administration système incorrect")
    user = db.query(User).filter(User.username == "admin", User.is_active.is_(True)).one_or_none()
    if user is None or not is_admin_role(user.role):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Compte admin introuvable ou inactif")
    token = create_access_token(str(user.id), {"role": user.role, "username": user.username})
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    token, user = authenticate(db, payload.username, payload.password)
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.get("/me", response_model=UserOut)
def me(user=Depends(current_user)):
    return user
