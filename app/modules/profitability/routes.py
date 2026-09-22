from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.profitability import service

router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str) -> None:
    allowed = _allowed_societies(user)
    if allowed and society not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


@router.get("/margin")
def margin(society: str, period: str, client: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, society)
    return service.margin(db, society=society, period=period, client=client)


@router.get("/margin-by-client")
def margin_by_client(society: str, period: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, society)
    return service.margin_by_client(db, society=society, period=period)
