#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select, text

from app.db.session import SessionLocal, safe_database_url
from app.modules.drh.models import Employee
from app.modules.drh.service import EMPLOYEE_CODE_SERIE_LIMIT, _society_code_key, employee_code_prefixes_for_society


@dataclass(frozen=True)
class CodeChange:
    employee_id: int
    old_code: str
    new_code: str
    society: str
    name: str


def _employee_sort_key(employee: Employee) -> tuple[str, str, int]:
    return (
        str(employee.last_name or "").strip().upper(),
        str(employee.first_name or "").strip().upper(),
        employee.id,
    )


def _series_for_society(society: Any) -> list[str]:
    return employee_code_prefixes_for_society(society)


def _society_priority(key: str) -> tuple[int, str]:
    known = {
        "IRON GLOBAL SECURITE": 0,
        "IRON GLOBAL SOLUTION": 1,
        "SWORD CORPORATION": 2,
        "SWORD CONSTRUCTION": 3,
    }
    return (known.get(key, 99), key)


def _generate_codes(prefixes: list[str], count: int, used: set[str] | None = None) -> list[str]:
    used = used or set()
    capacity = len(prefixes) * EMPLOYEE_CODE_SERIE_LIMIT
    if count > capacity - len([code for code in used if code[:1] in prefixes]):
        raise RuntimeError(
            f"Capacité insuffisante: {count} employé(s) pour {', '.join(prefixes)} "
            f"01-{EMPLOYEE_CODE_SERIE_LIMIT} ({capacity} codes disponibles)."
        )
    codes: list[str] = []
    for prefix in prefixes:
        for number in range(1, EMPLOYEE_CODE_SERIE_LIMIT + 1):
            code = f"{prefix}{number:02d}"
            if code in used:
                continue
            codes.append(code)
            if len(codes) == count:
                return codes
    if len(codes) < count:
        raise RuntimeError(
            f"Capacité insuffisante après exclusions: {count} employé(s) pour {', '.join(prefixes)}."
        )
    return codes


def build_changes(employees: list[Employee]) -> list[CodeChange]:
    by_society: dict[str, tuple[str, list[Employee]]] = {}
    for employee in employees:
        society = str(employee.society or "").strip()
        key = _society_code_key(society)
        if key not in by_society:
            by_society[key] = (society, [])
        by_society[key][1].append(employee)

    changes: list[CodeChange] = []
    used: set[str] = set()
    for key in sorted(by_society, key=_society_priority):
        society, employees_for_society = by_society[key]
        rows = sorted(employees_for_society, key=_employee_sort_key)
        codes = _generate_codes(_series_for_society(society), len(rows), used)
        for employee, new_code in zip(rows, codes):
            if new_code in used:
                raise RuntimeError(f"Code généré en double: {new_code}")
            used.add(new_code)
            name = " ".join(part for part in (employee.last_name, employee.first_name) if part)
            changes.append(
                CodeChange(
                    employee_id=employee.id,
                    old_code=str(employee.code or "").strip(),
                    new_code=new_code,
                    society=society,
                    name=name,
                )
            )
    return changes


def _updated_extra(extra: Any, old_code: str, new_code: str) -> dict[str, Any] | None:
    if not isinstance(extra, dict):
        return extra
    data = dict(extra)
    for key in ("matricule", "code"):
        data[key] = new_code
    legacy = data.get("_legacy")
    if isinstance(legacy, dict):
        legacy = dict(legacy)
        for key in ("matricule", "code"):
            legacy[key] = new_code
        data["_legacy"] = legacy
    return data


def apply_changes(changes: list[CodeChange]) -> None:
    by_id = {change.employee_id: change for change in changes}
    with SessionLocal() as db:
        db.execute(text("SELECT pg_advisory_xact_lock(20260612)"))
        rows = db.execute(select(Employee).order_by(Employee.id)).scalars().all()
        for employee in rows:
            change = by_id.get(employee.id)
            if not change:
                continue
            employee.code = f"TMP-{employee.id}"
        db.flush()
        for employee in rows:
            change = by_id.get(employee.id)
            if not change:
                continue
            employee.code = change.new_code
            employee.extra = _updated_extra(employee.extra, change.old_code, change.new_code)
        db.commit()


def print_summary(changes: list[CodeChange]) -> None:
    changed = [change for change in changes if change.old_code != change.new_code]
    print(f"Base: {safe_database_url()}")
    print(f"Employés analysés: {len(changes)}")
    print(f"Codes modifiés: {len(changed)}")
    per_society: dict[str, int] = {}
    for change in changes:
        per_society[change.society or "SOCIETE NON RENSEIGNEE"] = per_society.get(change.society or "SOCIETE NON RENSEIGNEE", 0) + 1
    for society, count in sorted(per_society.items()):
        prefixes = ", ".join(_series_for_society(society))
        print(f"- {society}: {count} employé(s), séries {prefixes}")
    for change in changed[:30]:
        print(f"  {change.old_code or '-'} -> {change.new_code} | {change.society or '-'} | {change.name}")
    if len(changed) > 30:
        print(f"  ... {len(changed) - 30} autre(s) changement(s)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Renumérote les codes employés selon la société.")
    parser.add_argument("--apply", action="store_true", help="Appliquer les changements en base PostgreSQL.")
    args = parser.parse_args()

    with SessionLocal() as db:
        employees = db.execute(select(Employee).order_by(Employee.id)).scalars().all()
        changes = build_changes(employees)

    print_summary(changes)
    if not args.apply:
        print("Aperçu uniquement. Relancez avec --apply pour appliquer.")
        return 0
    apply_changes(changes)
    print("Renumérotation appliquée.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
