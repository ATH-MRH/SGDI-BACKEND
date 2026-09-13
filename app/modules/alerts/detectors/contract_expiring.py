"""Détecteur drh.employee_contract.expiring.

Source canonique : Employee.contract_end_date UNIQUEMENT (décision canonique
figée pour 0.6-A). La table Contract (historique) n'est ni lue ni pilotée ici.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.alerts.detectors import DetectorFinding
from app.modules.alerts.rules import CONTRACT_EXPIRING_THRESHOLDS_DAYS, CONTRACT_RELEVANT_EMPLOYEE_STATUSES, RULE_CONTRACT_EXPIRING
from app.modules.drh.models import Employee


def detect(
    db: Session,
    *,
    allowed_societies: list[str] | None,
    today: date | None = None,
    thresholds_days: tuple[int, ...] = CONTRACT_EXPIRING_THRESHOLDS_DAYS,
) -> list[DetectorFinding]:
    """``allowed_societies`` : None = accès global (pas de filtre société), liste
    vide ou peuplée = restriction stricte à ces sociétés. Jamais une lecture
    "brute" sans que l'appelant ait explicitement résolu son périmètre."""
    reference_day = today or date.today()
    max_threshold = max(thresholds_days)

    stmt = select(Employee).where(
        Employee.contract_end_date.is_not(None),
        Employee.status.in_(sorted(CONTRACT_RELEVANT_EMPLOYEE_STATUSES)),
    )
    if allowed_societies is not None:
        if not allowed_societies:
            return []
        stmt = stmt.where(Employee.society.in_(allowed_societies))

    findings: list[DetectorFinding] = []
    for employee in db.execute(stmt).scalars().all():
        days_remaining = (employee.contract_end_date - reference_day).days
        if days_remaining > max_threshold:
            continue
        society = employee.society or ""
        title = f"Contrat expirant — {employee.code}"
        if days_remaining < 0:
            summary = f"Contrat de {employee.code} expiré depuis {-days_remaining} jour(s) ({employee.contract_end_date.isoformat()})."
        elif days_remaining == 0:
            summary = f"Contrat de {employee.code} expire aujourd'hui ({employee.contract_end_date.isoformat()})."
        else:
            summary = f"Contrat de {employee.code} expire dans {days_remaining} jour(s) ({employee.contract_end_date.isoformat()})."
        findings.append(
            DetectorFinding(
                rule_key=RULE_CONTRACT_EXPIRING,
                source_type="employee",
                source_id=str(employee.id),
                society=society,
                site_id=None,
                title=title,
                summary=summary,
                evidence={
                    "employee_id": employee.id,
                    "employee_code": employee.code,
                    "contract_type": employee.contract_type,
                    "contract_end_date": employee.contract_end_date.isoformat(),
                    "days_remaining": days_remaining,
                    "status": employee.status,
                    "society": society,
                },
                score_context={"days_remaining": days_remaining, "employee_status": employee.status},
                dedup_dimensions={
                    "employee_id": employee.id,
                    "contract_end_date": employee.contract_end_date.isoformat(),
                },
            )
        )
    return findings
