from __future__ import annotations

import argparse
import calendar
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.modules.drh.models import Contract, Employee
from app.modules.irongs.models import SgdiRecord


CONTRACT_TYPE = "CDD"
CONTRACT_DURATION_VALUE = "12m"
CONTRACT_DURATION_LABEL = "12 mois"


@dataclass
class ContractTermsUpdateResult:
    employees_seen: int = 0
    employees_updated: int = 0
    employees_without_start_date: int = 0
    legacy_records_seen: int = 0
    legacy_records_updated: int = 0
    contracts_seen: int = 0
    contracts_updated: int = 0


def add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _iso(value: date | None) -> str:
    return value.isoformat() if value else ""


def _update_legacy_payload(data: Any, start_date: date | None, end_date: date | None) -> bool:
    if not isinstance(data, dict):
        return False
    changed = False
    updates = {
        "typeContrat": CONTRACT_TYPE,
        "contract_type": CONTRACT_TYPE,
        "dureeContrat": CONTRACT_DURATION_VALUE,
        "contract_duration": CONTRACT_DURATION_VALUE,
    }
    if start_date:
        updates["dateRecrutement"] = _iso(start_date)
        updates["recruit_date"] = _iso(start_date)
    if end_date:
        updates["dateFinContrat"] = _iso(end_date)
        updates["contract_end_date"] = _iso(end_date)
    for key, value in updates.items():
        if data.get(key) != value:
            data[key] = value
            changed = True
    return changed


def update_all_employee_contract_terms(db: Session, commit: bool = True) -> ContractTermsUpdateResult:
    result = ContractTermsUpdateResult()
    employees = db.execute(select(Employee).order_by(Employee.id)).scalars().all()
    employee_terms: dict[int, tuple[date | None, date | None]] = {}

    for employee in employees:
        result.employees_seen += 1
        start_date = employee.recruit_date
        end_date = add_months(start_date, 12) if start_date else None
        employee_terms[employee.id] = (start_date, end_date)
        if not start_date:
            result.employees_without_start_date += 1

        extra = dict(employee.extra or {})
        legacy = dict(extra.get("_legacy") or {})
        changed = False
        if employee.contract_type != CONTRACT_TYPE:
            employee.contract_type = CONTRACT_TYPE
            changed = True
        if start_date and employee.contract_end_date != end_date:
            employee.contract_end_date = end_date
            changed = True
        for key, value in {
            "typeContrat": CONTRACT_TYPE,
            "dureeContrat": CONTRACT_DURATION_VALUE,
            "dureeContratLabel": CONTRACT_DURATION_LABEL,
        }.items():
            if extra.get(key) != value:
                extra[key] = value
                changed = True
        if _update_legacy_payload(legacy, start_date, end_date):
            extra["_legacy"] = legacy
            changed = True
        if changed:
            employee.extra = extra
            flag_modified(employee, "extra")
            result.employees_updated += 1

    contracts = db.execute(select(Contract).order_by(Contract.id)).scalars().all()
    for contract in contracts:
        result.contracts_seen += 1
        start_date = contract.start_date
        employee_start, employee_end = employee_terms.get(contract.employee_id, (None, None))
        effective_start = start_date or employee_start
        end_date = add_months(effective_start, 12) if effective_start else employee_end
        changed = False
        if contract.contract_type != CONTRACT_TYPE:
            contract.contract_type = CONTRACT_TYPE
            changed = True
        if effective_start and not contract.start_date:
            contract.start_date = effective_start
            changed = True
        if end_date and contract.end_date != end_date:
            contract.end_date = end_date
            changed = True
        if changed:
            result.contracts_updated += 1

    records = db.execute(select(SgdiRecord).where(SgdiRecord.collection == "agents")).scalars().all()
    for record in records:
        result.legacy_records_seen += 1
        data = record.data
        start_date = None
        end_date = None
        if isinstance(data, dict):
            backend_id = data.get("backendId")
            try:
                backend_id = int(backend_id) if backend_id not in (None, "") else None
            except (TypeError, ValueError):
                backend_id = None
            if backend_id in employee_terms:
                start_date, end_date = employee_terms[backend_id]
            elif data.get("dateRecrutement"):
                try:
                    start_date = date.fromisoformat(str(data.get("dateRecrutement"))[:10])
                    end_date = add_months(start_date, 12)
                except ValueError:
                    start_date = None
                    end_date = None
        if _update_legacy_payload(data, start_date, end_date):
            record.data = data
            flag_modified(record, "data")
            result.legacy_records_updated += 1

    if commit:
        db.commit()
    else:
        db.rollback()
    return result


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Met a jour les conditions contrat des fiches employes.")
    parser.add_argument("--apply", action="store_true", help="Appliquer les changements. Sans cette option, simulation seulement.")
    return parser
