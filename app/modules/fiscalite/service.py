from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.finance_core import service as finance_core_service
from app.modules.fiscalite.models import FiscalObligation

COUNTERPARTY_BY_TYPE = {
    "g50_tva": "Direction des Impôts (G50 — TVA)",
    "g50_irg_retenue": "Direction des Impôts (G50 — IRG retenue)",
    "ibs": "Direction des Impôts (IBS)",
    "cnas_echeance": "CNAS",
    "autre": "Administration fiscale",
}


def declare(
    db: Session, *, society: str, obligation_type: str, period: str, base_calcul: Any | None, montant: Any,
    echeance: date, proof_reference: str | None, declared_by: str, regulatory_version_id: int | None = None,
    idempotency_key: str,
) -> FiscalObligation:
    existing = db.scalar(select(FiscalObligation).where(FiscalObligation.idempotency_key == idempotency_key))
    if existing:
        return existing
    montant_q = Decimal(str(montant)).quantize(Decimal("0.01"))
    obligation = FiscalObligation(
        society=society, obligation_type=obligation_type, period=period,
        base_calcul=Decimal(str(base_calcul)).quantize(Decimal("0.01")) if base_calcul is not None else None,
        montant=montant_q, echeance=echeance, status="declared",
        regulatory_version_id=regulatory_version_id, proof_reference=proof_reference,
        declared_by=declared_by, declared_at=datetime.utcnow(), idempotency_key=idempotency_key,
    )
    db.add(obligation)
    db.flush()
    if montant_q > 0:
        fin_obl = finance_core_service.create_obligation(
            db, society=society, direction="payable", source_type="fiscal_obligation", source_id=str(obligation.id),
            amount_total=montant_q, counterparty_name=COUNTERPARTY_BY_TYPE.get(obligation_type, "Administration fiscale"),
            due_date=echeance, idempotency_key=f"obl:fiscal:{obligation.id}",
        )
        obligation.financial_obligation_id = fin_obl.id
    db.flush()
    return obligation


def mark_paid(db: Session, obligation_id: int) -> FiscalObligation:
    """Ne règle rien elle-même — se contente de refléter que l'obligation Finance Core liée
    est réglée (vérifié, pas déclaré à l'aveugle)."""
    from app.modules.finance_core.models import FinancialObligation
    obligation = db.get(FiscalObligation, obligation_id)
    if not obligation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Obligation fiscale introuvable")
    if obligation.financial_obligation_id:
        fin_obl = db.get(FinancialObligation, obligation.financial_obligation_id)
        if fin_obl and fin_obl.status != "settled":
            raise HTTPException(status.HTTP_409_CONFLICT, detail="L'obligation financière liée n'est pas encore réglée (settle_obligation via Finance Core d'abord)")
    obligation.status = "paid"
    db.flush()
    return obligation


def calendar(db: Session, *, society: str | None, allowed: list[str] | None, upcoming_only: bool = False) -> list[FiscalObligation]:
    stmt = select(FiscalObligation)
    if society:
        stmt = stmt.where(FiscalObligation.society == society)
    elif allowed:
        stmt = stmt.where(FiscalObligation.society.in_(allowed))
    if upcoming_only:
        stmt = stmt.where(FiscalObligation.status.in_(("pending", "declared", "late")))
    return list(db.scalars(stmt.order_by(FiscalObligation.echeance.asc())).all())
