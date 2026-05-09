from datetime import datetime
from typing import Any, Type

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.drh.models import Candidate, Contract, Document, Employee, Leave, Sanction


def list_rows(db: Session, model: Type, filters: dict[str, Any] | None = None):
    stmt = select(model)
    for key, value in (filters or {}).items():
        if value not in (None, "") and hasattr(model, key):
            stmt = stmt.where(getattr(model, key) == value)
    return db.execute(stmt.order_by(model.id.desc())).scalars().all()


def get_or_404(db: Session, model: Type, row_id: int):
    row = db.get(model, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    return row




def _candidate_text(value: Any) -> str:
    return str(value or "").strip()

def _candidate_values(payload: Any, existing: Candidate | None = None, partial: bool = False) -> dict[str, Any]:
    values = payload.model_dump(exclude_unset=True)
    data = values.get("data")
    if isinstance(data, dict):
        raw_id = str(data.get("id") or "").strip()
        if raw_id.startswith("tmp_cd_"):
            raise HTTPException(status_code=422, detail="Candidature temporaire refusée. Enregistrez uniquement une fiche complète.")
        data.pop("isNew", None)
    first_name = _candidate_text(values.get("first_name", existing.first_name if existing else ""))
    last_name = _candidate_text(values.get("last_name", existing.last_name if existing else ""))
    if len(first_name) < 2 or len(last_name) < 2:
        raise HTTPException(status_code=422, detail="Nom et prénom obligatoires pour créer une candidature.")
    if not partial or "first_name" in values:
        values["first_name"] = first_name
    if not partial or "last_name" in values:
        values["last_name"] = last_name
    return values

def create_candidate(db: Session, payload: Any):
    row = Candidate(**_candidate_values(payload))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

def update_candidate(db: Session, candidate_id: int, payload: Any):
    row = get_or_404(db, Candidate, candidate_id)
    for key, value in _candidate_values(payload, existing=row, partial=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row

def create_row(db: Session, model: Type, payload: Any):
    row = model(**payload.model_dump(exclude_unset=True))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_row(db: Session, model: Type, row_id: int, payload: Any):
    row = get_or_404(db, model, row_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def delete_row(db: Session, model: Type, row_id: int):
    row = get_or_404(db, model, row_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": row_id}


def drh_dashboard(db: Session):
    total = db.scalar(select(func.count(Employee.id))) or 0
    by_status = dict(
        db.execute(select(Employee.status, func.count(Employee.id)).group_by(Employee.status)).all()
    )
    candidates = dict(
        db.execute(select(Candidate.status, func.count(Candidate.id)).group_by(Candidate.status)).all()
    )
    leaves_pending = db.scalar(select(func.count(Leave.id)).where(Leave.status == "instance")) or 0
    trial_alerts = db.execute(
        select(Employee).where(Employee.trial_end_date.is_not(None), Employee.status == "actif")
    ).scalars().all()
    return {
        "employees_total": total,
        "employees_by_status": by_status,
        "candidates_by_status": candidates,
        "leaves_pending": leaves_pending,
        "trial_periods": [
            {"id": e.id, "code": e.code, "name": f"{e.last_name} {e.first_name}", "trial_end_date": e.trial_end_date}
            for e in trial_alerts
        ],
    }


def recruit_candidate(db: Session, candidate_id: int):
    candidate = get_or_404(db, Candidate, candidate_id)
    next_code = f"A{(db.scalar(select(func.count(Employee.id))) or 0) + 1:02d}"
    employee = Employee(
        code=next_code,
        first_name=candidate.first_name,
        last_name=candidate.last_name,
        phone=candidate.phone,
        email=candidate.email,
        position=candidate.desired_position,
        society=candidate.society,
        salary_net=candidate.expected_salary or 0,
        status="actif",
        extra=candidate.data or {},
    )
    candidate.status = "embauche"
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


def approve_leave(db: Session, leave_id: int):
    leave = get_or_404(db, Leave, leave_id)
    leave.status = "approuve"
    leave.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(leave)
    return leave


def refuse_leave(db: Session, leave_id: int):
    leave = get_or_404(db, Leave, leave_id)
    leave.status = "refuse"
    leave.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(leave)
    return leave


def fiche_position(db: Session, employee_id: int):
    from app.modules.materiel.models import EmployeeEquipment
    from app.modules.ops.models import Assignment, DailyPresence, Event

    employee = get_or_404(db, Employee, employee_id)
    contracts = list_rows(db, Contract, {"employee_id": employee_id})
    leaves = list_rows(db, Leave, {"employee_id": employee_id})
    sanctions = list_rows(db, Sanction, {"employee_id": employee_id})
    documents = list_rows(db, Document, {"owner_type": "employee", "owner_id": employee_id})
    assignments = list_rows(db, Assignment, {"employee_id": employee_id})
    pointage = list_rows(db, DailyPresence, {"employee_id": employee_id})
    events = list_rows(db, Event, {"employee_id": employee_id})
    equipment = list_rows(db, EmployeeEquipment, {"employee_id": employee_id, "status": "attribue"})
    return {
        "employee": employee,
        "contracts": contracts,
        "leaves": leaves,
        "sanctions": sanctions,
        "documents": documents,
        "assignments": assignments,
        "pointage": pointage,
        "events": events,
        "equipment": equipment,
    }

