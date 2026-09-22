from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from pydantic import BaseModel


class SalaryGridCreate(BaseModel):
    society: str
    poste: str
    categorie: str | None = None
    niveau: str | None = None
    salaire_base: Decimal
    primes_fixes: list[dict[str, Any]] = []
    effective_from: date


class PayrollRunCreate(BaseModel):
    society: str
    period: str
    idempotency_key: str


class SlipComputeRequest(BaseModel):
    employee_id: int
    salary_grid_id: int | None = None
    primes_variables: Decimal | None = None
    autres_retenues: Decimal | None = None
    idempotency_key: str
    allow_unverified_rules: bool = True
