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


class LoanSettingsUpdate(BaseModel):
    module_enabled: bool = True
    advance_min_seniority_months: int = Field(ge=0, le=120)
    loan_min_seniority_months: int = Field(ge=0, le=120)
    debt_ratio_limit: float = Field(gt=0, le=100)
    advance_salary_multiple: float = Field(gt=0, le=20)
    loan_salary_multiple: float = Field(gt=0, le=50)
    advance_max_installments: int = Field(ge=1, le=36)
    loan_max_installments: int = Field(ge=1, le=120)
    merit_threshold: float = Field(ge=0, le=100)
    default_interest_rate: float = Field(ge=0, le=100)
    maximum_interest_rate: float = Field(ge=0, le=100)
    require_active_employee: bool = True
    enforce_contract_end: bool = True
    allow_eligibility_override: bool = True
    require_dg_signature: bool = True
    require_secretariat_validation: bool = True
    require_beneficiary_signature: bool = True
    require_cash_validation: bool = True
    manager_roles: list[str] = []
    secretariat_roles: list[str] = []
    cash_roles: list[str] = []
    secretariat_notification_email: str | None = Field(default=None, max_length=180)
    cash_notification_email: str | None = Field(default=None, max_length=180)
    decision_prefix: str = Field(min_length=1, max_length=20)
    contract_prefix: str = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_rates(self):
        if self.default_interest_rate > self.maximum_interest_rate:
            raise ValueError("Le taux par défaut ne peut pas dépasser le taux maximal")
        return self
