from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.treasury import service

router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


@router.get("/positions")
def positions(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    if society:
        _ensure_society_allowed(user, society)
    return service.bank_positions(db, society=society, allowed=allowed if allowed and not society else None)


@router.get("/echeancier")
def echeancier(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    if society:
        _ensure_society_allowed(user, society)
    return service.echeancier(db, society=society, allowed=allowed if allowed and not society else None)


@router.get("/forecast")
def forecast(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    if society:
        _ensure_society_allowed(user, society)
    return service.cash_forecast(db, society=society, allowed=allowed if allowed and not society else None)


@router.get("/exposure")
def exposure_route(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    if society:
        _ensure_society_allowed(user, society)
    return service.exposure(db, society=society, allowed=allowed if allowed and not society else None)
