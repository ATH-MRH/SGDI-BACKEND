from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class ObligationCreate(BaseModel):
    society: str
    direction: str = Field(pattern="^(receivable|payable)$")
    source_type: str
    source_id: str
    amount_total: Decimal
    counterparty_name: str | None = None
    due_date: date | None = None
    currency: str = "DZD"
    notes: str | None = None
    idempotency_key: str


class ObligationOut(BaseModel):
    id: int
    society: str
    direction: str
    source_type: str
    source_id: str
    counterparty_name: str | None
    amount_total: Decimal
    amount_settled: Decimal
    currency: str
    due_date: date | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class PaymentIntentCreate(BaseModel):
    society: str
    direction: str = Field(pattern="^(receivable|payable)$")
    amount: Decimal
    obligation_id: int | None = None
    method: str | None = None
    planned_date: date | None = None
    currency: str = "DZD"
    notes: str | None = None
    idempotency_key: str


class SettleRequest(BaseModel):
    amount: Decimal
    payment_intent_id: int | None = None
    bank_transaction_id: int | None = None
    idempotency_key: str
    notes: str | None = None


class ReversalRequest(BaseModel):
    reason: str
    idempotency_key: str


class SettlementOut(BaseModel):
    id: int
    society: str
    obligation_id: int
    payment_intent_id: int | None
    bank_transaction_id: int | None
    amount: Decimal
    kind: str
    settled_at: datetime
    reversed_settlement_id: int | None

    model_config = {"from_attributes": True}
