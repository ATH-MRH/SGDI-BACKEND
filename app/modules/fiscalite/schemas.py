from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class FiscalDeclareRequest(BaseModel):
    society: str
    obligation_type: str
    period: str
    base_calcul: Decimal | None = None
    montant: Decimal
    echeance: date
    proof_reference: str | None = None
    regulatory_version_id: int | None = None
    idempotency_key: str
