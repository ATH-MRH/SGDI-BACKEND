from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class ReconciliationMatchOut(BaseModel):
    id: int
    bank_transaction_id: int
    obligation_id: int
    amount_imputed: Decimal
    settlement_id: int | None

    model_config = {"from_attributes": True}


class ReconciliationCaseOut(BaseModel):
    id: int
    society: str
    kind: str
    status: str
    confidence_score: int
    explanation: str | None
    total_amount: Decimal
    confirmed_by: str | None
    confirmed_at: datetime | None
    rejected_reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RejectRequest(BaseModel):
    reason: str
