from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class EmployeeLoanRequest(Base, TimestampMixin):
    __tablename__ = "employee_loan_requests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    reference: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    employee_code: Mapped[str] = mapped_column(String(30), index=True)
    employee_name: Mapped[str] = mapped_column(String(220), index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    request_type: Mapped[str] = mapped_column(String(20), index=True)  # advance | loan
    amount_requested: Mapped[float] = mapped_column(Float)
    installments_requested: Mapped[int] = mapped_column(Integer, default=1)
    reason: Mapped[str] = mapped_column(Text)
    payroll_deduction_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(30), default="submitted", index=True)
    eligibility_snapshot: Mapped[dict | None] = mapped_column(JSON)
    amount_approved: Mapped[float | None] = mapped_column(Float)
    installments_approved: Mapped[int | None] = mapped_column(Integer)
    monthly_installment: Mapped[float | None] = mapped_column(Float)
    interest_rate: Mapped[float] = mapped_column(Float, default=0)
    total_due: Mapped[float | None] = mapped_column(Float)
    balance_due: Mapped[float | None] = mapped_column(Float)
    first_due_date: Mapped[date | None] = mapped_column(Date)
    decision_note: Mapped[str | None] = mapped_column(Text)
    recommendation: Mapped[str | None] = mapped_column(String(20))
    reviewed_by: Mapped[str | None] = mapped_column(String(120))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_by: Mapped[str | None] = mapped_column(String(120))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decision_reference: Mapped[str | None] = mapped_column(String(50), unique=True, index=True)
    decision_signed_by: Mapped[str | None] = mapped_column(String(120))
    decision_signed_at: Mapped[datetime | None] = mapped_column(DateTime)
    contract_reference: Mapped[str | None] = mapped_column(String(50), unique=True, index=True)
    beneficiary_signed_at: Mapped[datetime | None] = mapped_column(DateTime)
    beneficiary_signature_confirmed_by: Mapped[str | None] = mapped_column(String(120))
    secretariat_received_at: Mapped[datetime | None] = mapped_column(DateTime)
    cash_notified_at: Mapped[datetime | None] = mapped_column(DateTime)
    disbursed_by: Mapped[str | None] = mapped_column(String(120))
    disbursed_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class EmployeeLoanRepayment(Base, TimestampMixin):
    __tablename__ = "employee_loan_repayments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    loan_request_id: Mapped[int] = mapped_column(ForeignKey("employee_loan_requests.id", ondelete="CASCADE"), index=True)
    payment_date: Mapped[date] = mapped_column(Date, index=True)
    amount: Mapped[float] = mapped_column(Float)
    method: Mapped[str] = mapped_column(String(30), default="payroll")
    payroll_period: Mapped[str | None] = mapped_column(String(7), index=True)
    reference: Mapped[str | None] = mapped_column(String(100))
    note: Mapped[str | None] = mapped_column(Text)
    recorded_by: Mapped[str | None] = mapped_column(String(120))


class LoanWorkflowNotification(Base, TimestampMixin):
    __tablename__ = "loan_workflow_notifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    loan_request_id: Mapped[int] = mapped_column(ForeignKey("employee_loan_requests.id", ondelete="CASCADE"), index=True)
    recipient_role: Mapped[str] = mapped_column(String(30), index=True)  # secretariat | cash
    recipient_host: Mapped[str] = mapped_column(String(120))
    event_type: Mapped[str] = mapped_column(String(50), index=True)
    title: Mapped[str] = mapped_column(String(180))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="unread", index=True)
    read_by: Mapped[str | None] = mapped_column(String(120))
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    processed_by: Mapped[str | None] = mapped_column(String(120))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime)
