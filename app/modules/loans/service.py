from calendar import monthrange
from datetime import date, datetime
from math import ceil
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.drh.models import Employee
from app.modules.loans.models import EmployeeLoanRepayment, EmployeeLoanRequest, LoanModuleSettings


OPEN_STATUSES = {"submitted", "under_review", "decision_pending_signature", "secretariat_pending", "cash_pending", "disbursed"}

DEFAULT_MANAGER_ROLES = ["drh", "rh", "finance", "finances", "paie"]
DEFAULT_SECRETARIAT_ROLES = ["secretariat", "secrétariat", "secretariat general", "secrétariat général"]
DEFAULT_CASH_ROLES = ["caisse", "caissier", "tresorerie", "trésorerie"]


def get_or_create_settings(db: Session) -> LoanModuleSettings:
    row = db.get(LoanModuleSettings, 1)
    if row is None:
        row = LoanModuleSettings(
            id=1, manager_roles=DEFAULT_MANAGER_ROLES,
            secretariat_roles=DEFAULT_SECRETARIAT_ROLES, cash_roles=DEFAULT_CASH_ROLES,
        )
        db.add(row); db.commit(); db.refresh(row)
    return row


def settings_dict(row: LoanModuleSettings) -> dict[str, Any]:
    return {column.name: getattr(row, column.name) for column in row.__table__.columns if column.name not in {"id", "created_at", "updated_at"}}


def _months_between(start: date | None, end: date) -> int:
    if not start or start > end:
        return 0
    return max(0, (end.year - start.year) * 12 + end.month - start.month - (1 if end.day < start.day else 0))


def _merit(employee: Employee) -> tuple[float | None, str]:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    for key in ("meritScore", "noteMerite", "evaluationScore", "performanceScore"):
        try:
            value = float(extra.get(key))
        except (TypeError, ValueError):
            continue
        if value <= 10:
            value *= 10
        return min(max(value, 0), 100), key
    return None, "non_renseigne"


def employee_eligibility(db: Session, employee: Employee, request_type: str, amount: float, installments: int) -> dict[str, Any]:
    config = get_or_create_settings(db)
    today = date.today()
    salary = max(float(employee.salary_net or 0), 0)
    seniority_months = _months_between(employee.recruit_date, today)
    remaining_contract_months = None
    if employee.contract_end_date:
        remaining_contract_months = max(0, ceil((employee.contract_end_date - today).days / 30.44))
    merit_score, merit_source = _merit(employee)
    open_rows = db.execute(
        select(EmployeeLoanRequest).where(
            EmployeeLoanRequest.employee_id == employee.id,
            EmployeeLoanRequest.status.in_(OPEN_STATUSES),
            EmployeeLoanRequest.balance_due > 0,
        )
    ).scalars().all()
    existing_monthly = round(sum(float(row.monthly_installment or 0) for row in open_rows), 2)
    existing_balance = round(sum(float(row.balance_due or 0) for row in open_rows), 2)
    capacity_limit = round(salary * config.debt_ratio_limit / 100, 2)
    available_monthly = max(round(capacity_limit - existing_monthly, 2), 0)
    policy_term = config.advance_max_installments if request_type == "advance" else config.loan_max_installments
    contract_term = remaining_contract_months if config.enforce_contract_end and remaining_contract_months is not None else policy_term
    maximum_term = max(0, min(policy_term, contract_term))
    salary_multiple = config.advance_salary_multiple if request_type == "advance" else config.loan_salary_multiple
    maximum_amount = round(min(salary * salary_multiple, available_monthly * maximum_term), 2)
    projected_monthly = round(float(amount or 0) / max(int(installments or 1), 1), 2)
    reasons: list[str] = []
    minimum_seniority = config.advance_min_seniority_months if request_type == "advance" else config.loan_min_seniority_months
    status_key = str(employee.status or "").strip().lower()
    if config.require_active_employee and status_key not in {"actif", "active", "operationnel", "opérationnel"}:
        reasons.append("Situation administrative non active")
    if salary <= 0:
        reasons.append("Salaire net non renseigné")
    if seniority_months < minimum_seniority:
        reasons.append(f"Ancienneté inférieure au minimum de {minimum_seniority} mois")
    if maximum_term < 1 or installments > maximum_term:
        reasons.append("Durée de remboursement incompatible avec la fin du contrat")
    if projected_monthly > available_monthly:
        reasons.append(f"Mensualité supérieure à la capacité disponible de {config.debt_ratio_limit:g} % du salaire net")
    if amount > maximum_amount:
        reasons.append("Montant supérieur au plafond indicatif calculé")
    if request_type == "loan" and merit_score is not None and merit_score < config.merit_threshold:
        reasons.append(f"Évaluation de mérite inférieure au seuil indicatif de {config.merit_threshold:g} %")
    return {
        "eligible": not reasons,
        "reasons": reasons,
        "salary_net": salary,
        "seniority_months": seniority_months,
        "contract_end_date": employee.contract_end_date.isoformat() if employee.contract_end_date else None,
        "remaining_contract_months": remaining_contract_months,
        "merit_score": merit_score,
        "merit_source": merit_source,
        "existing_monthly_commitments": existing_monthly,
        "existing_balance": existing_balance,
        "debt_ratio_limit": config.debt_ratio_limit,
        "available_monthly_capacity": available_monthly,
        "maximum_term": maximum_term,
        "maximum_amount": maximum_amount,
        "projected_monthly_installment": projected_monthly,
    }


def serialize_request(row: EmployeeLoanRequest, repayments: list[EmployeeLoanRepayment] | None = None) -> dict[str, Any]:
    return {
        "id": row.id, "reference": row.reference, "employee_id": row.employee_id,
        "employee_code": row.employee_code, "employee_name": row.employee_name,
        "society": row.society, "request_type": row.request_type,
        "amount_requested": row.amount_requested, "installments_requested": row.installments_requested,
        "reason": row.reason, "status": row.status, "eligibility": row.eligibility_snapshot or {},
        "amount_approved": row.amount_approved, "installments_approved": row.installments_approved,
        "monthly_installment": row.monthly_installment, "interest_rate": row.interest_rate,
        "total_due": row.total_due, "balance_due": row.balance_due,
        "first_due_date": row.first_due_date.isoformat() if row.first_due_date else None,
        "decision_note": row.decision_note, "recommendation": row.recommendation,
        "reviewed_by": row.reviewed_by, "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "decided_by": row.decided_by, "decision_reference": row.decision_reference,
        "decision_signed_by": row.decision_signed_by,
        "decision_signed_at": row.decision_signed_at.isoformat() if row.decision_signed_at else None,
        "contract_reference": row.contract_reference,
        "beneficiary_signed_at": row.beneficiary_signed_at.isoformat() if row.beneficiary_signed_at else None,
        "beneficiary_signature_confirmed_by": row.beneficiary_signature_confirmed_by,
        "secretariat_received_at": row.secretariat_received_at.isoformat() if row.secretariat_received_at else None,
        "cash_notified_at": row.cash_notified_at.isoformat() if row.cash_notified_at else None,
        "disbursed_by": row.disbursed_by,
        "created_at": row.created_at.isoformat(),
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        "disbursed_at": row.disbursed_at.isoformat() if row.disbursed_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "repayments": [{"id": p.id, "payment_date": p.payment_date.isoformat(), "amount": p.amount, "method": p.method, "payroll_period": p.payroll_period, "reference": p.reference, "note": p.note} for p in (repayments or [])],
    }


def next_month_start(value: date | None = None) -> date:
    current = value or date.today()
    if current.month == 12:
        return date(current.year + 1, 1, 1)
    return date(current.year, current.month + 1, 1)


def due_schedule(row: EmployeeLoanRequest) -> list[dict[str, Any]]:
    if not row.first_due_date or not row.installments_approved or not row.total_due:
        return []
    result = []
    year, month = row.first_due_date.year, row.first_due_date.month
    installment = round(float(row.total_due) / row.installments_approved, 2)
    remaining = round(float(row.total_due), 2)
    for number in range(1, row.installments_approved + 1):
        day = min(row.first_due_date.day, monthrange(year, month)[1])
        amount = remaining if number == row.installments_approved else installment
        result.append({"number": number, "due_date": date(year, month, day).isoformat(), "amount": round(amount, 2)})
        remaining = round(remaining - amount, 2)
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return result
