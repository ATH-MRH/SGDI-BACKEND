"""Matricules officiels : jamais modifiés silencieusement.

- Un matricule validé comme officiel (fourni par un import Excel, ou changé explicitement avec
  un motif) est marqué dans `extra.matriculeOfficiel`. La marque ne vaut que pour la valeur
  enregistrée : si le matricule ne correspond plus, la marque est ignorée.
- `repair-codes` devient une procédure en deux temps : aperçu en lecture seule, puis
  confirmation de cet aperçu précis (empreinte), refusée si la base a changé. Les matricules
  protégés en sont exclus ; chaque changement est audité.
- Le changement explicite d'un matricule exige un motif, contrôle l'unicité et audite
  ancien → nouveau. C'est la seule action qui modifie un matricule protégé.
Aucune migration : la marque vit dans la colonne JSON `extra` existante."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.modules.auth.models import AuditEvent
from app.modules.drh import service
from app.modules.drh.models import Employee

PROTECTION_KEY = "matriculeOfficiel"
HISTORY_KEY = "matriculeHistorique"
CODE_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9._/-]{0,29}$")
_REPAIR_LOCK = 20260612                                   # même verrou que l'ancienne réparation
_CODE_LOCK = 20260610                                     # même verrou que next_employee_code
REPAIR_AUDIT = "drh.employees.code_repair"


def canonical_code(value: Any) -> str:
    """Forme proposée par la convention ATLAS (même règle que l'écran) : lettre + au moins deux
    chiffres, sans zéros superflus. `A001` → `A01`, `A1` → `A01`, `Z900` → `Z900`."""
    raw = re.sub(r"\s+", "", str(value or "").strip().upper())
    match = re.fullmatch(r"([A-Z])0*(\d+)", raw)
    if not match or int(match.group(2)) <= 0:
        return raw
    return f"{match.group(1)}{int(match.group(2)):02d}"


def protection_of(employee: Employee) -> dict[str, Any] | None:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    mark = extra.get(PROTECTION_KEY)
    if isinstance(mark, dict) and mark.get("fige") is True and str(mark.get("valeur") or "") == str(employee.code or ""):
        return mark
    return None


def is_protected(employee: Employee) -> bool:
    return protection_of(employee) is not None


def protection_record(code: str, *, source: str, by: str | None, **details: Any) -> dict[str, Any]:
    return {"fige": True, "valeur": code, "source": source, "par": by, "le": datetime.utcnow().isoformat(),
            **{key: value for key, value in details.items() if value not in (None, "")}}


def _lock(db: Session, key: int) -> None:
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


# ── Changement explicite d'un matricule ─────────────────────────────────────────────────────
def change_code(db: Session, employee: Employee, new_code: str, reason: str, *, actor: Any, request: Any = None) -> Employee:
    new = str(new_code or "").strip().upper()
    motive = " ".join(str(reason or "").split())
    if not CODE_PATTERN.fullmatch(new):
        raise HTTPException(status_code=422, detail="Matricule invalide (lettres, chiffres, . _ / -, 30 caractères maximum)")
    if len(motive) < 5:
        raise HTTPException(status_code=422, detail="Motif obligatoire (5 caractères minimum)")
    old = str(employee.code or "")
    if new == old:
        raise HTTPException(status_code=422, detail="Le nouveau matricule est identique au matricule actuel")
    _lock(db, _CODE_LOCK)
    if db.scalar(select(Employee.id).where(func.upper(Employee.code) == new, Employee.id != employee.id).limit(1)) is not None:
        raise service._business_error(409, service.EMPLOYEE_CODE_TAKEN, f"Matricule {new} déjà utilisé")
    now = datetime.utcnow().isoformat()
    was_protected = is_protected(employee)
    extra = service._employee_code_extra(dict(employee.extra) if isinstance(employee.extra, dict) else {}, new)
    history = list(extra.get(HISTORY_KEY) or []) if isinstance(extra.get(HISTORY_KEY), list) else []
    history.append({"ancien": old, "nouveau": new, "motif": motive, "par": getattr(actor, "username", None), "le": now})
    extra[HISTORY_KEY] = history[-50:]
    extra[PROTECTION_KEY] = protection_record(new, source="modification_explicite", by=getattr(actor, "username", None),
                                              motif=motive, ancien=old)
    employee.code, employee.extra = new, extra
    append_audit(db, action="drh.employee.code_changed", resource="employee", resource_id=employee.id, result="success", user=actor,
                 request=request, society=employee.society, old_state={"code": old},
                 new_state={"code": new, "reason": motive, "protected_before": was_protected})
    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        if service._is_employee_code_conflict(exc):
            raise service._business_error(409, service.EMPLOYEE_CODE_TAKEN, f"Matricule {new} déjà utilisé") from exc
        raise HTTPException(status_code=400, detail=f"Enregistrement refusé : {service._postgres_error_detail(exc)}") from exc
    db.refresh(employee)
    return employee


# ── repair-codes en deux temps ──────────────────────────────────────────────────────────────
def repair_plan(db: Session) -> dict[str, Any]:
    """Aperçu en lecture seule : renumérotation par société et ordre alphabétique, comme
    l'ancienne réparation, mais les matricules protégés sont exclus et gardent leur code (aucun
    autre employé ne peut le prendre). L'empreinte couvre l'état de tous les employés."""
    employees = db.execute(select(Employee).order_by(Employee.id.asc())).scalars().all()
    protected = [row for row in employees if is_protected(row)]
    used = {str(row.code or "").upper() for row in protected}
    grouped: dict[str, tuple[str, list[Employee]]] = {}
    for row in employees:
        if row in protected:
            continue
        society = str(row.society or "").strip()
        grouped.setdefault(service._society_code_key(society), (society, []))[1].append(row)
    desired: dict[int, str] = {}
    for key in sorted(grouped, key=service._employee_code_society_priority):
        society, rows = grouped[key]
        ordered = sorted(rows, key=service._employee_code_sort_key)
        for row, code in zip(ordered, service._employee_code_sequence(service.employee_code_prefixes_for_society(society), len(ordered), used)):
            used.add(code)
            desired[row.id] = code
    current_counts: dict[str, int] = {}
    for row in employees:
        current_counts[str(row.code or "").upper()] = current_counts.get(str(row.code or "").upper(), 0) + 1
    planned = {row.id for row in employees if row.id in desired and (str(row.code or "") != desired[row.id]
                                                                      or not service._employee_code_extra_matches(row.extra, desired[row.id]))}
    keeping = {str(row.code or "").upper(): row.id for row in employees if row.id not in planned}
    changes = []
    for row in employees:
        if row.id not in planned:
            continue
        current, proposed = str(row.code or ""), desired[row.id]
        prefixes = service.employee_code_prefixes_for_society(row.society)
        if current == proposed:
            reason = "Synchronisation des champs matricule de la fiche (matricule inchangé)"
        elif current_counts.get(current.upper(), 0) > 1:
            reason = "Matricule en double"
        elif current[:1].upper() not in prefixes:
            reason = "Matricule hors de la série de la société"
        else:
            reason = "Renumérotation alphabétique de la série de la société"
        holder = keeping.get(proposed.upper())
        changes.append({"employee_id": row.id, "name": f"{row.last_name or ''} {row.first_name or ''}".strip(), "society": row.society,
                        "current": current, "proposed": proposed, "reason": reason, "protected": False,
                        "conflict": f"Matricule {proposed} conservé par l'employé #{holder}" if holder and holder != row.id else None})
    skipped = [{"employee_id": row.id, "name": f"{row.last_name or ''} {row.first_name or ''}".strip(), "society": row.society,
                "current": row.code, "proposed": row.code, "reason": "Matricule officiel protégé : exclu de la renumérotation",
                "protected": True, "conflict": None, "source": (protection_of(row) or {}).get("source")} for row in protected]
    state = [[row.id, row.code, row.society, row.last_name, row.first_name, row in protected,
              service._employee_code_extra_matches(row.extra, str(row.code or ""))] for row in employees]
    plan_id = hashlib.sha256(json.dumps({"state": state, "changes": changes}, sort_keys=True, default=str).encode()).hexdigest()[:40]
    return {"plan_id": plan_id, "changes": changes, "protected": skipped,
            "counts": {"employees": len(employees), "changes": len(changes), "code_changes": sum(c["current"] != c["proposed"] for c in changes),
                       "protected": len(skipped), "conflicts": sum(bool(c["conflict"]) for c in changes)}}


def apply_repair(db: Session, plan_id: str, *, actor: Any, request: Any = None) -> dict[str, Any]:
    """Confirmation d'un aperçu précis : refusée si la base a changé ou en cas de collision ;
    seuls les changements de l'aperçu sont appliqués. Idempotente : une seconde confirmation du
    même aperçu renvoie le bilan déjà enregistré sans rien modifier."""
    _lock(db, _REPAIR_LOCK)
    previous = db.scalar(select(AuditEvent.new_state).where(AuditEvent.action == REPAIR_AUDIT, AuditEvent.resource_id == str(plan_id)[:180],
                                                            AuditEvent.result == "success").order_by(AuditEvent.id.desc()).limit(1))
    if previous:
        return {**json.loads(previous), "already_processed": True}
    plan = repair_plan(db)
    if plan["plan_id"] != plan_id:
        raise HTTPException(status_code=409, detail="La base a changé depuis l'aperçu : relancez l'aperçu avant de confirmer.")
    if plan["counts"]["conflicts"]:
        raise HTTPException(status_code=409, detail="Collision de matricules dans l'aperçu : aucune modification.")
    rows = {row.id: row for row in db.execute(select(Employee).where(Employee.id.in_([c["employee_id"] for c in plan["changes"]]))).scalars()}
    if any(is_protected(rows[c["employee_id"]]) for c in plan["changes"]):
        raise HTTPException(status_code=409, detail="Un matricule protégé figure dans l'aperçu : aucune modification.")
    try:
        for change in plan["changes"]:                    # codes temporaires : permutations sans collision
            if change["current"] != change["proposed"]:
                rows[change["employee_id"]].code = f"TMP-RESET-{change['employee_id']}"
        db.flush()
        for change in plan["changes"]:
            row = rows[change["employee_id"]]
            row.code = change["proposed"]
            row.extra = service._employee_code_extra(row.extra, change["proposed"])
            if change["current"] != change["proposed"]:
                append_audit(db, action="drh.employee.code_repaired", resource="employee", resource_id=row.id, result="success",
                             user=actor, request=request, society=row.society, old_state={"code": change["current"]},
                             new_state={"code": change["proposed"], "reason": change["reason"], "plan_id": plan_id})
        summary = {"plan_id": plan_id, "counts": {"changed": plan["counts"]["code_changes"], "synchronized": len(plan["changes"]) - plan["counts"]["code_changes"],
                                                  "protected_skipped": plan["counts"]["protected"], "employees": plan["counts"]["employees"]}}
        append_audit(db, action=REPAIR_AUDIT, resource="employee", resource_id=plan_id, result="success", user=actor, request=request,
                     new_state=summary)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Renumérotation refusée : {service._postgres_error_detail(exc)}") from exc
    return {**summary, "changes": plan["changes"], "already_processed": False}
