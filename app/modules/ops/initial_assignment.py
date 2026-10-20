"""Affectation d'un employé sans affectation par ordre de mouvement (OPS).

L'ordre de mouvement reste le seul chemin : la ligne de présence et l'ordre sont écrits par
l'enregistrement de mouvement existant (save-presence-movement), puis l'affectation est créée
dans la MÊME transaction et reliée à l'ordre. Rien n'est conservé si une étape échoue, et un
employé qui a déjà une affectation active (aujourd'hui ou planifiée) est refusé en 409.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import or_, select, text as sql_text
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.modules.drh.models import Employee
from app.modules.ops import service
from app.modules.ops.models import Assignment, OpsMovement, Site

ALREADY_ASSIGNED = "Cet employé possède déjà une affectation active. Actualisez la liste."
# Mêmes statuts que la disponibilité affichée dans l'éditeur d'ordre de mouvement
# (opsMovementAgentAvailability) et que les statuts d'ancien employé (EMPLOYEE_FORMER_STATUS_KEYS).
UNAVAILABLE_STATUSES = frozenset({
    "conge", "maladie", "absent", "suspendu", "blacklist", "blackliste", "abandon",
    "sortant", "demissionne", "licencie", "archive", "archivee", "ancien", "fin_contrat",
    "fin_de_contrat", "fin_relation", "fin_de_relation",
})
GROUPS = frozenset({"A", "B", "C", "D"})
MAX_PLANNING_DAYS = 366
_NUMBER = re.compile(r"^OD/OPS/(\d{4})/(\d+)$")


def status_key(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or "").strip().lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"[\s-]+", "_", text)


def supervisor_read_only(user: Any) -> bool:
    """Compte superviseur terrain en lecture seule (même règle que isOpsSupervisorReadOnlySession)."""
    role = str(getattr(user, "role", "") or "").strip().lower()
    supervisor = role in {"dispatch", "superviseur", "supervisor"} or role.startswith("sup")
    return supervisor and getattr(user, "supervisor_read_only", True) is not False


def blocking_assignment(db: Session, employee_id: int, today: date) -> Assignment | None:
    """Affectation active en cours ou planifiée : une seconde affectation serait un doublon."""
    return db.execute(select(Assignment).where(
        Assignment.employee_id == employee_id, Assignment.active == 1,
        or_(Assignment.end_date.is_(None), Assignment.end_date >= today),
    ).order_by(Assignment.id.desc())).scalars().first()


def _legacy_ids(employee: Employee) -> set[str]:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    return {str(v) for v in (employee.code, employee.id, legacy.get("id"), extra.get("id")) if v not in (None, "")}


def _number_owner(db: Session, number: str) -> OpsMovement | None:
    return db.execute(select(OpsMovement).where(OpsMovement.movement_number == number)).scalars().first()


def allocate_movement_number(db: Session, requested: str | None, external_id: str, today: date) -> str:
    """Numéro OD/OPS/AAAA/NNNN de l'écran s'il est libre, sinon le suivant de l'année.

    Le numéro proposé par l'écran est calculé sur ses seules données locales : deux postes
    peuvent proposer le même. Ici, sous verrou, un numéro déjà porté par un AUTRE ordre n'est
    jamais réutilisé (l'enregistrement de mouvement l'écraserait)."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(sql_text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": "ops_movement_number"})
    wanted = str(requested or "").strip()
    owner = _number_owner(db, wanted) if _NUMBER.match(wanted) else None
    if _NUMBER.match(wanted) and (owner is None or owner.external_id == external_id):
        return wanted
    year = today.year
    prefix = f"OD/OPS/{year}/"
    numbers = db.execute(select(OpsMovement.movement_number).where(OpsMovement.movement_number.like(prefix + "%"))).scalars()
    last = max((int(m.group(2)) for m in (_NUMBER.match(n or "") for n in numbers) if m), default=0)
    return f"{prefix}{last + 1:04d}"


def validate(db: Session, user: Any, employee: Employee, site: Site, payload: Any, today: date) -> tuple[str, str]:
    if supervisor_read_only(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Accès superviseur OPS : validation de mouvement non autorisée.")
    if status_key(employee.status) in UNAVAILABLE_STATUSES:
        raise HTTPException(status_code=422, detail=f"Employé non affectable (statut : {employee.status}).")
    if not site.active:
        raise HTTPException(status_code=422, detail="Site inactif : choisissez un site actif.")
    if payload.effective_date < today:
        raise HTTPException(status_code=422, detail="La date d'effet ne peut pas être antérieure à aujourd'hui.")
    if payload.effective_date > today + timedelta(days=MAX_PLANNING_DAYS):
        raise HTTPException(status_code=422, detail="Date d'effet trop éloignée (un an au plus).")
    group = str(payload.group_code or "").strip().upper() or "A"
    if group not in GROUPS:
        raise HTTPException(status_code=422, detail="Groupe invalide (A, B, C ou D).")
    agent_ref = str(payload.agent_ref or "").strip() or employee.code
    if agent_ref not in _legacy_ids(employee):
        raise HTTPException(status_code=422, detail="Référence employé incohérente.")
    return group, agent_ref


def assign(db: Session, user: Any, employee: Employee, site: Site, payload: Any, *, request=None) -> dict[str, Any]:
    """Ordre de mouvement + affectation, dans une seule transaction (validée ici)."""
    from app.modules.irongs.service import _presence_movement_write, _snapshot_cache_invalidate
    from app.modules.irongs.sql_bridge import ops_movement_to_item

    today = date.today()
    group, agent_ref = validate(db, user, employee, site, payload, today)
    try:
        service.lock_employee(db, employee.id)
        if blocking_assignment(db, employee.id, today):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=ALREADY_ASSIGNED)
        day = payload.effective_date.isoformat()
        external_id = f"fpq_{day}_{agent_ref}"
        number = allocate_movement_number(db, payload.movement_number, external_id, today)
        motif = str(payload.motif or "").strip() or "Affectation"
        position = employee.position or None
        now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
        actor = getattr(user, "username", None) or ""
        patch = {
            "employee_id": employee.id, "agentBackendId": employee.id, "matricule": employee.code,
            "ordreMouvementNumero": number, "mouvementNumero": number,
            "positionActuelle": "Sans affectation",
            "siteId": str(payload.site_ref or site.id), "siteBackendId": site.id, "siteName": site.name or "",
            "clientName": site.client_name or "", "societe": employee.society or "",
            "mouvementMotif": motif, "mouvementType": motif,
            "mouvementDuree": str(payload.duree or "").strip(), "groupe": group,
            "mouvementObs": str(payload.observation or "").strip(), "poste": position or "",
            "dateEffet": day, "affectationInitiale": True, "mouvementStatut": "OM validé",
            "validatedBy": actor, "validatedAt": now,
        }
        line, movement = _presence_movement_write(db, {
            "date": day, "agentId": agent_ref, "employee_id": employee.id, "agentBackendId": employee.id,
            "matricule": employee.code, "patch": patch,
        })
        assignment = service.create_assignment_no_commit(db, {
            "employee_id": employee.id, "site_id": site.id, "group_code": group, "position": position,
            "start_date": payload.effective_date, "end_date": None,
            "change_reason": f"{motif} · OM {number}", "active": 1,
        })
        row = db.get(OpsMovement, int(movement["backendId"]))
        data = dict(row.data or {})
        data["_legacy"] = {**(data.get("_legacy") or {}), "assignmentBackendId": assignment.id}
        data["assignment_id"] = assignment.id
        row.data = data
        db.flush()
        movement = {**movement, **ops_movement_to_item(row)}
        append_audit(db, action="ops.movement.initial_assignment", resource="assignment",
                     resource_id=assignment.id, result="success", user=user, request=request,
                     society=employee.society,
                     new_state={"movement_id": row.id, "movement_number": number, "employee_id": employee.id,
                                "site_id": site.id, "start_date": day, "group_code": group})
        db.commit()
    except Exception:
        db.rollback()
        raise
    _snapshot_cache_invalidate()
    db.refresh(assignment)
    return {"status": "success", "movement": movement, "line": line, "assignment": assignment,
            "effective_today": payload.effective_date <= today}
