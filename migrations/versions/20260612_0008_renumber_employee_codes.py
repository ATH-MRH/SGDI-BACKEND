"""Renumérotation des codes employés par société

Revision ID: 20260612_0008
Revises: 20260529_0007
Create Date: 2026-06-12
"""
from __future__ import annotations

import unicodedata
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "20260612_0008"
down_revision = "20260529_0007"
branch_labels = None
depends_on = None


EMPLOYEE_CODE_SERIE_LIMIT = 200


employees = sa.table(
    "employees",
    sa.column("id", sa.Integer),
    sa.column("code", sa.String),
    sa.column("first_name", sa.String),
    sa.column("last_name", sa.String),
    sa.column("society", sa.String),
    sa.column("extra", sa.JSON),
)


def _society_key(value: Any) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "").strip())
    without_accents = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return " ".join(without_accents.upper().split())


def _prefixes_for_society(society: Any) -> list[str]:
    key = _society_key(society)
    if key == "IRON GLOBAL SECURITE":
        return ["A", "B", "C"]
    if key == "IRON GLOBAL SOLUTION":
        return ["K", "W"]
    if key == "SWORD CORPORATION":
        return ["S"]
    if key == "SWORD CONSTRUCTION":
        return ["T"]
    return list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def _code_sort_key(row: dict[str, Any]) -> tuple[str, int, int]:
    code = str(row.get("code") or "").strip().upper()
    prefix = code[:1]
    suffix = code[1:]
    number = int(suffix) if suffix.isdigit() else 999999
    return (prefix, number, int(row["id"]))


def _generate_codes(prefixes: list[str], count: int, used: set[str]) -> list[str]:
    codes: list[str] = []
    for prefix in prefixes:
        for number in range(1, EMPLOYEE_CODE_SERIE_LIMIT + 1):
            code = f"{prefix}{number:02d}"
            if code in used:
                continue
            codes.append(code)
            if len(codes) == count:
                return codes
    raise RuntimeError(f"Série de codes employé saturée ({', '.join(prefixes)} 01-{EMPLOYEE_CODE_SERIE_LIMIT})")


def _updated_extra(extra: Any, old_code: str, new_code: str) -> Any:
    if not isinstance(extra, dict):
        return extra
    data = dict(extra)
    for key in ("matricule", "code"):
        if str(data.get(key) or "").strip().upper() == old_code.upper():
            data[key] = new_code
    legacy = data.get("_legacy")
    if isinstance(legacy, dict):
        legacy = dict(legacy)
        for key in ("matricule", "code"):
            if str(legacy.get(key) or "").strip().upper() == old_code.upper():
                legacy[key] = new_code
        data["_legacy"] = legacy
    return data


def upgrade() -> None:
    bind = op.get_bind()
    rows = [dict(row) for row in bind.execute(sa.select(employees).order_by(employees.c.id)).mappings().all()]
    if not rows:
        return

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row.get("society") or "").strip(), []).append(row)

    changes: dict[int, tuple[str, str, Any]] = {}
    used: set[str] = set()
    for society in sorted(grouped):
        group = sorted(grouped[society], key=_code_sort_key)
        codes = _generate_codes(_prefixes_for_society(society), len(group), used)
        for row, new_code in zip(group, codes):
            old_code = str(row.get("code") or "").strip()
            used.add(new_code)
            changes[int(row["id"])] = (old_code, new_code, _updated_extra(row.get("extra"), old_code, new_code))

    for employee_id in changes:
        bind.execute(
            employees.update().where(employees.c.id == employee_id).values(code=f"TMP-{employee_id}")
        )

    for employee_id, (_old_code, new_code, extra) in changes.items():
        bind.execute(
            employees.update().where(employees.c.id == employee_id).values(code=new_code, extra=extra)
        )


def downgrade() -> None:
    pass
