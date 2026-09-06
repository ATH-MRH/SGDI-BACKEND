from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class LoanSimulationIn(BaseModel):
    request_type: Literal["advance", "loan"]
    amount: float = Field(gt=0, le=100_000_000)
    installments: int = Field(ge=1, le=36)


class LoanRequestCreate(LoanSimulationIn):
    reason: str = Field(min_length=5, max_length=1000)
    payroll_deduction_consent: bool

    @model_validator(mode="after")
    def require_consent(self):
        if not self.payroll_deduction_consent:
            raise ValueError("L’autorisation de retenue sur salaire est obligatoire")
        return self


class LoanDecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    amount_approved: float | None = Field(default=None, gt=0, le=100_000_000)
    installments_approved: int | None = Field(default=None, ge=1, le=36)
    interest_rate: float = Field(default=0, ge=0, le=100)
    first_due_date: date | None = None
    note: str = Field(default="", max_length=2000)
    override_eligibility: bool = False


class LoanReviewIn(BaseModel):
    recommendation: Literal["favorable", "unfavorable", "reserved"]
    note: str = Field(min_length=5, max_length=2000)


class SignatureConfirmationIn(BaseModel):
    confirmation: bool

    @model_validator(mode="after")
    def require_confirmation(self):
        if not self.confirmation:
            raise ValueError("La confirmation de signature est obligatoire")
        return self


class LoanRepaymentCreate(BaseModel):
    payment_date: date
    amount: float = Field(gt=0, le=100_000_000)
    method: Literal["payroll", "cash", "transfer", "other"] = "payroll"
    payroll_period: str | None = Field(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    reference: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=1000)
