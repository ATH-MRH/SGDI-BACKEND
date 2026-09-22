from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class BankAccountCreate(BaseModel):
    society: str
    bank_name: str
    account_number: str
    iban: str | None = None
    currency: str = "DZD"
    label: str | None = None


class BankAccountOut(BaseModel):
    id: int
    society: str
    bank_name: str
    account_number: str
    iban: str | None
    currency: str
    label: str | None
    active: int

    model_config = {"from_attributes": True}


class BankTransactionOut(BaseModel):
    id: int
    society: str
    bank_account_id: int
    bank_statement_id: int
    stage: str
    value_date: date | None
    amount: Decimal
    label: str | None
    reference: str | None
    reconcile_status: str

    model_config = {"from_attributes": True}


class BankStatementOut(BaseModel):
    id: int
    society: str
    bank_account_id: int
    import_format: str
    file_name: str | None
    opening_balance: Decimal | None
    closing_balance: Decimal | None
    computed_balance_check: str | None
    transaction_count: int
    duplicate_count: int
    closed: int
    created_at: datetime

    model_config = {"from_attributes": True}
