from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel


class BudgetLineCreate(BaseModel):
    society: str
    period: str
    compte: str | None = None
    centre_cout: str | None = None
    contrat: str | None = None
    client: str | None = None
    site: str | None = None
    montant_budgete: Decimal


class BudgetReviseRequest(BaseModel):
    montant_budgete: Decimal
