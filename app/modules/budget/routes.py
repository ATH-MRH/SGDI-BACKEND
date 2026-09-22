from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.budget import service
from app.modules.budget.models import BudgetLine
from app.modules.budget.schemas import BudgetLineCreate, BudgetReviseRequest

router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _require_admin(user: User) -> None:
    role = str(getattr(user, "role", "") or "").strip().lower()
    if role not in {"admin", "adm", "adm1", "adm2"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Approbation réservée à l'administration")


@router.post("/lines")
def create_line(payload: BudgetLineCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    line = service.create_line(
        db, society=payload.society, period=payload.period, compte=payload.compte, centre_cout=payload.centre_cout,
        contrat=payload.contrat, client=payload.client, site=payload.site, montant_budgete=payload.montant_budgete,
        created_by=user.username,
    )
    db.commit()
    db.refresh(line)
    return service.line_summary(db, line)


@router.get("/lines")
def list_lines(society: str | None = None, period: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    stmt = select(BudgetLine)
    if society:
        _ensure_society_allowed(user, society)
        stmt = stmt.where(BudgetLine.society == society)
    elif allowed:
        stmt = stmt.where(BudgetLine.society.in_(allowed))
    if period:
        stmt = stmt.where(BudgetLine.period == period)
    rows = db.scalars(stmt.order_by(BudgetLine.id.desc())).all()
    return [service.line_summary(db, r) for r in rows]


def _get_line_scoped(db: Session, user: User, line_id: int) -> BudgetLine:
    line = db.get(BudgetLine, line_id)
    if not line:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ligne budgétaire introuvable")
    _ensure_society_allowed(user, line.society)
    return line


@router.post("/lines/{line_id}/submit")
def submit_line(line_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _get_line_scoped(db, user, line_id)
    line = service.submit(db, line_id)
    db.commit()
    db.refresh(line)
    return service.line_summary(db, line)


@router.post("/lines/{line_id}/approve")
def approve_line(line_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _get_line_scoped(db, user, line_id)
    _require_admin(user)
    line = service.approve(db, line_id, approved_by=user.username)
    db.commit()
    db.refresh(line)
    return service.line_summary(db, line)


@router.post("/lines/{line_id}/lock")
def lock_line(line_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _get_line_scoped(db, user, line_id)
    _require_admin(user)
    line = service.lock(db, line_id)
    db.commit()
    db.refresh(line)
    return service.line_summary(db, line)


@router.post("/lines/{line_id}/reject")
def reject_line(line_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _get_line_scoped(db, user, line_id)
    _require_admin(user)
    line = service.reject(db, line_id)
    db.commit()
    db.refresh(line)
    return service.line_summary(db, line)


@router.post("/lines/{line_id}/revise")
def revise_line(line_id: int, payload: BudgetReviseRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _get_line_scoped(db, user, line_id)
    line = service.revise(db, line_id, montant_budgete=payload.montant_budgete, created_by=user.username)
    db.commit()
    db.refresh(line)
    return service.line_summary(db, line)
