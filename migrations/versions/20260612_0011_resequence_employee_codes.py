"""Resequence employee codes by normalized company

Revision ID: 20260612_0011
Revises: 20260612_0010
Create Date: 2026-06-12
"""
from __future__ import annotations

import unicodedata
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "20260612_0011"
down_revision = "20260612_0010"
branch_labels = None
depends_on = None


SERIE_LIMIT = 200


employees = sa.table(
    "employees",
    sa.column("id", sa.Integer),
    sa.column("code", sa.String),
    sa.column("first_name", sa.String),
    sa.column("last_name", sa.String),
    sa.column("society", sa.String),
    sa.column("extra", sa.JSON),
)


def _key(value: Any) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "").strip())
    no_accents = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return " ".join(no_accents.upper().split())


def _prefixes(society: Any) -> list[str]:
    key = _key(society)
    if key == "IRON GLOBAL SECURITE":
        return ["A", "B", "C"]
    if key == "IRON GLOBAL SOLUTION":
        return ["K", "W"]
    if key == "SWORD CORPORATION":
        return ["S"]
    if key == "SWORD CONSTRUCTION":
        return ["T"]
    return list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def _society_priority(key: str) -> tuple[int, str]:
    known = {
        "IRON GLOBAL SECURITE": 0,
        "IRON GLOBAL SOLUTION": 1,
        "SWORD CORPORATION": 2,
        "SWORD CONSTRUCTION": 3,
    }
    return (known.get(key, 99), key)


def _sort_key(row: dict[str, Any]) -> tuple[str, str, int]:
    return (
        str(row.get("last_name") or "").strip().upper(),
        str(row.get("first_name") or "").strip().upper(),
        int(row["id"]),
    )


def _codes(prefixes: list[str], count: int, used: set[str]) -> list[str]:
    result: list[str] = []
    for prefix in prefixes:
        for number in range(1, SERIE_LIMIT + 1):
            code = f"{prefix}{number:02d}"
            if code in used:
                continue
            result.append(code)
            if len(result) == count:
                return result
    raise RuntimeError(f"Serie employe saturee ({', '.join(prefixes)} 01-{SERIE_LIMIT})")


def _extra(extra: Any, new_code: str) -> Any:
    if not isinstance(extra, dict):
        return extra
    data = dict(extra)
    data["matricule"] = new_code
    data["code"] = new_code
    legacy = data.get("_legacy")
    if isinstance(legacy, dict):
        legacy = dict(legacy)
        legacy["matricule"] = new_code
        legacy["code"] = new_code
        data["_legacy"] = legacy
    return data


def upgrade() -> None:
    bind = op.get_bind()
    rows = [dict(row) for row in bind.execute(sa.select(employees).order_by(employees.c.id)).mappings().all()]
    grouped: dict[str, tuple[str, list[dict[str, Any]]]] = {}
    for row in rows:
        society = str(row.get("society") or "").strip()
        key = _key(society)
        if key not in grouped:
            grouped[key] = (society, [])
        grouped[key][1].append(row)

    changes: dict[int, tuple[str, Any]] = {}
    used: set[str] = set()
    for key in sorted(grouped, key=_society_priority):
        society, group_rows = grouped[key]
        group = sorted(group_rows, key=_sort_key)
        for row, new_code in zip(group, _codes(_prefixes(society), len(group), used)):
            used.add(new_code)
            changes[int(row["id"])] = (new_code, _extra(row.get("extra"), new_code))

    for employee_id in changes:
        bind.execute(employees.update().where(employees.c.id == employee_id).values(code=f"TMP-{employee_id}"))
    for employee_id, (new_code, extra) in changes.items():
        bind.execute(employees.update().where(employees.c.id == employee_id).values(code=new_code, extra=extra))

    bind.execute(sa.text("DROP INDEX IF EXISTS ix_employees_code"))
    bind.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_employees_code ON employees (code)"))

def downgrade() -> None:
    pass
