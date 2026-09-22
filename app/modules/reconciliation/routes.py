from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.reconciliation import service
from app.modules.reconciliation.models import ReconciliationCase, ReconciliationMatch
from app.modules.reconciliation.schemas import ReconciliationCaseOut, RejectRequest

router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


@router.post("/transactions/{transaction_id}/propose", response_model=ReconciliationCaseOut | None)
def propose_for_transaction(transaction_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    # P0 (revue d'intégrité, item 10/11 — multi-société/RBAC) — TROUVÉ PENDANT L'AUDIT : cet
    # endpoint n'appliquait AUCUN contrôle de société avant cette correction. Un utilisateur
    # restreint à une société pouvait proposer (et donc lire, via la réponse) un rapprochement
    # sur une transaction bancaire — et les obligations qu'elle mettrait en correspondance —
    # d'une AUTRE société entièrement. Vérifié AVANT tout appel au service, comme partout
    # ailleurs dans ce module.
    from app.modules.banking.models import BankTransaction
    transaction = db.get(BankTransaction, transaction_id)
    if not transaction:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction introuvable")
    _ensure_society_allowed(user, transaction.society)
    case = service.propose_matches_for_transaction(db, transaction_id)
    db.commit()
    if case:
        db.refresh(case)
    return case


@router.get("/cases", response_model=list[ReconciliationCaseOut])
def list_cases(society: str | None = None, status_filter: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    if society:
        _ensure_society_allowed(user, society)
    stmt = select(ReconciliationCase)
    if society:
        stmt = stmt.where(ReconciliationCase.society == society)
    elif allowed:
        stmt = stmt.where(ReconciliationCase.society.in_(allowed))
    if status_filter:
        stmt = stmt.where(ReconciliationCase.status == status_filter)
    return list(db.scalars(stmt.order_by(ReconciliationCase.id.desc())).all())


@router.get("/cases/{case_id}/matches")
def get_case_matches(case_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    case = db.get(ReconciliationCase, case_id)
    if not case:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Cas introuvable")
    _ensure_society_allowed(user, case.society)
    matches = db.scalars(select(ReconciliationMatch).where(ReconciliationMatch.case_id == case_id)).all()
    return [
        {"id": m.id, "bank_transaction_id": m.bank_transaction_id, "obligation_id": m.obligation_id,
         "amount_imputed": str(m.amount_imputed), "settlement_id": m.settlement_id}
        for m in matches
    ]


@router.post("/cases/{case_id}/confirm", response_model=ReconciliationCaseOut)
def confirm_case(case_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = db.get(ReconciliationCase, case_id)
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Cas introuvable")
    _ensure_society_allowed(user, existing.society)
    case = service.confirm_case(db, case_id, confirmed_by=user.username)
    db.commit()
    db.refresh(case)
    return case


@router.post("/cases/{case_id}/reject", response_model=ReconciliationCaseOut)
def reject_case(case_id: int, payload: RejectRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = db.get(ReconciliationCase, case_id)
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Cas introuvable")
    _ensure_society_allowed(user, existing.society)
    case = service.reject_case(db, case_id, reason=payload.reason)
    db.commit()
    db.refresh(case)
    return case


@router.get("/exceptions")
def list_exceptions(society: str | None = None, resolved: bool | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    if society:
        _ensure_society_allowed(user, society)
    items = service.list_exceptions(db, society=society, allowed=allowed if allowed and not society else None, resolved=resolved)
    return [
        {"id": e.id, "society": e.society, "bank_transaction_id": e.bank_transaction_id, "reason": e.reason, "resolved": bool(e.resolved)}
        for e in items
    ]
