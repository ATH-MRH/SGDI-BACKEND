from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.schemas import LoginIn, TokenOut, UserCreate, UserOut
from app.modules.auth.models import User
from app.modules.auth.service import authenticate, create_user


router = APIRouter()


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
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès administrateur requis")
    return create_user(db, payload)


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    token, user = authenticate(db, payload.username, payload.password)
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.get("/me", response_model=UserOut)
def me(user=Depends(current_user)):
    return user
