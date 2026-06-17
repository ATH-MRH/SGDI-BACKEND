"""Suppression définitive des codes employés OKBA

Revision ID: 20260612_0009
Revises: 20260612_0008
Create Date: 2026-06-12
"""
from __future__ import annotations

import unicodedata
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "20260612_0009"
down_revision = "20260612_0008"
branch_labels = None
depends_on = None


SERIE_LIMIT = 200


employees = sa.table(
    "employees",
    sa.column("id", sa.Integer),
    sa.column("code", sa.String),
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


def _sort_key(row: dict[str, Any]) -> tuple[str, int, int]:
    code = str(row.get("code") or "").strip().upper()
    suffix = code[1:]
    number = int(suffix) if suffix.isdigit() else 999999
    return (code[:1], number, int(row["id"]))


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
    raise RuntimeError(f"Série employé saturée ({', '.join(prefixes)} 01-{SERIE_LIMIT})")


def _extra(extra: Any, old_code: str, new_code: str) -> Any:
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
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row.get("society") or "").strip(), []).append(row)

    changes: dict[int, tuple[str, str, Any]] = {}
    used: set[str] = set()
    for society in sorted(grouped):
        group = sorted(grouped[society], key=_sort_key)
        for row, new_code in zip(group, _codes(_prefixes(society), len(group), used)):
            old_code = str(row.get("code") or "").strip()
            used.add(new_code)
            changes[int(row["id"])] = (old_code, new_code, _extra(row.get("extra"), old_code, new_code))

    for employee_id in changes:
        bind.execute(employees.update().where(employees.c.id == employee_id).values(code=f"TMP-{employee_id}"))
    for employee_id, (_old_code, new_code, extra) in changes.items():
        bind.execute(employees.update().where(employees.c.id == employee_id).values(code=new_code, extra=extra))


def downgrade() -> None:
    pass
