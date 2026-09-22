from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.fiscalite import service
from app.modules.fiscalite.schemas import FiscalDeclareRequest

router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _out(o) -> dict:
    return {
        "id": o.id, "society": o.society, "obligation_type": o.obligation_type, "period": o.period,
        "base_calcul": str(o.base_calcul) if o.base_calcul is not None else None, "montant": str(o.montant),
        "echeance": str(o.echeance), "status": o.status, "financial_obligation_id": o.financial_obligation_id,
        "proof_reference": o.proof_reference,
    }


@router.post("/declare")
def declare(payload: FiscalDeclareRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    obligation = service.declare(
        db, society=payload.society, obligation_type=payload.obligation_type, period=payload.period,
        base_calcul=payload.base_calcul, montant=payload.montant, echeance=payload.echeance,
        proof_reference=payload.proof_reference, declared_by=user.username,
        regulatory_version_id=payload.regulatory_version_id, idempotency_key=payload.idempotency_key,
    )
    db.commit()
    db.refresh(obligation)
    return _out(obligation)


@router.get("/calendar")
def calendar(society: str | None = None, upcoming_only: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    if society:
        _ensure_society_allowed(user, society)
    rows = service.calendar(db, society=society, allowed=allowed if allowed and not society else None, upcoming_only=upcoming_only)
    return [_out(o) for o in rows]


@router.post("/{obligation_id}/mark-paid")
def mark_paid(obligation_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    # P0 (revue d'intégrité, item 10/11 — multi-société/RBAC) — TROUVÉ PENDANT L'AUDIT : le
    # contrôle de société était fait APRÈS l'appel à service.mark_paid() (qui mute déjà
    # obligation.status et flush()) — un utilisateur non autorisé pouvait déclencher l'effet
    # de bord avant d'être refusé. L'autorisation DOIT toujours précéder toute mutation,
    # jamais la suivre — corrigé en vérifiant sur une lecture seule d'abord.
    from app.modules.fiscalite.models import FiscalObligation
    existing = db.get(FiscalObligation, obligation_id)
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Obligation fiscale introuvable")
    _ensure_society_allowed(user, existing.society)
    obligation = service.mark_paid(db, obligation_id)
    db.commit()
    db.refresh(obligation)
    return _out(obligation)
