from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh import service
from app.modules.drh.models import Candidate, Contract, Document, Employee, Leave, Sanction
from app.modules.drh.schemas import (
    CandidateCreate,
    CandidateOut,
    CandidateUpdate,
    ContractCreate,
    ContractOut,
    ContractUpdate,
    DocumentCreate,
    DocumentOut,
    EmployeeCreate,
    EmployeeOut,
    EmployeeUpdate,
    LeaveCreate,
    LeaveOut,
    SanctionCreate,
    SanctionOut,
)


router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _effective_society_filter(user: User, requested: str | None) -> str | None:
    allowed = _allowed_societies(user)
    if requested:
        _ensure_society_allowed(user, requested)
        return requested
    if len(allowed) == 1:
        return allowed[0]
    return None


def _ensure_employee_allowed(db: Session, user: User, employee_id: int) -> Employee:
    employee = service.get_or_404(db, Employee, employee_id)
    _ensure_society_allowed(user, employee.society)
    return employee


def _authorized_employee_ids(db: Session, user: User) -> set[int] | None:
    allowed = _allowed_societies(user)
    if not allowed:
        return None
    rows = db.execute(select(Employee.id).where(Employee.society.in_(allowed))).scalars().all()
    return set(rows)


def _filter_employee_owned_rows(db: Session, user: User, rows):
    allowed_ids = _authorized_employee_ids(db, user)
    if allowed_ids is None:
        return rows
    return [row for row in rows if getattr(row, "employee_id", None) in allowed_ids]


def _ensure_document_allowed(db: Session, user: User, owner_type: str | None, owner_id: int | None) -> None:
    if owner_type == "employee" and owner_id:
        _ensure_employee_allowed(db, user, owner_id)


def _filter_documents(db: Session, user: User, rows):
    allowed_ids = _authorized_employee_ids(db, user)
    if allowed_ids is None:
        return rows
    return [
        row
        for row in rows
        if row.owner_type != "employee" or row.owner_id in allowed_ids
    ]


@router.get("/dashboard")
def dashboard(
    society: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    effective_society = _effective_society_filter(user, society)
    employees_rows = service.list_rows(db, Employee, {"society": effective_society})
    candidates_rows = service.list_rows(db, Candidate, {"society": effective_society})
    allowed = _allowed_societies(user)
    if allowed and not effective_society:
        employees_rows = [row for row in employees_rows if row.society in allowed]
        candidates_rows = [row for row in candidates_rows if row.society in allowed]

    employee_ids = {row.id for row in employees_rows}
    leaves_pending = db.scalar(
        select(func.count(Leave.id)).where(Leave.status == "instance", Leave.employee_id.in_(employee_ids))
    ) if employee_ids else 0
    return {
        "employees_total": len(employees_rows),
        "employees_by_status": {status_key or "non_defini": sum(1 for row in employees_rows if row.status == status_key) for status_key in {row.status for row in employees_rows}},
        "candidates_by_status": {status_key or "non_defini": sum(1 for row in candidates_rows if row.status == status_key) for status_key in {row.status for row in candidates_rows}},
        "leaves_pending": leaves_pending or 0,
        "trial_periods": [
            {"id": e.id, "code": e.code, "name": f"{e.last_name} {e.first_name}", "trial_end_date": e.trial_end_date}
            for e in employees_rows
            if e.trial_end_date is not None and e.status == "actif"
        ],
    }


@router.get("/employees", response_model=list[EmployeeOut])
def employees(
    status: str | None = None,
    society: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    effective_society = _effective_society_filter(user, society)
    rows = service.list_rows(db, Employee, {"status": status, "society": effective_society})
    allowed = _allowed_societies(user)
    if allowed and not effective_society:
        rows = [row for row in rows if row.society in allowed]
    return rows


@router.post("/employees", response_model=EmployeeOut)
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_row(db, Employee, payload)


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _ensure_employee_allowed(db, user, employee_id)


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
def update_employee(employee_id: int, payload: EmployeeUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = _ensure_employee_allowed(db, user, employee_id)
    _ensure_society_allowed(user, payload.society or existing.society)
    return service.update_row(db, Employee, employee_id, payload)


@router.delete("/employees/{employee_id}")
def delete_employee(employee_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, employee_id)
    return service.delete_row(db, Employee, employee_id)


@router.get("/employees/{employee_id}/fiche-position")
def get_fiche_position(employee_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, employee_id)
    return service.fiche_position(db, employee_id)


@router.get("/candidates", response_model=list[CandidateOut])
def candidates(
    status: str | None = None,
    society: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    effective_society = _effective_society_filter(user, society)
    rows = service.list_rows(db, Candidate, {"status": status, "society": effective_society})
    allowed = _allowed_societies(user)
    if allowed and not effective_society:
        rows = [row for row in rows if row.society in allowed]
    return rows


@router.post("/candidates", response_model=CandidateOut)
def create_candidate(payload: CandidateCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_candidate(db, payload)


@router.put("/candidates/{candidate_id}", response_model=CandidateOut)
def update_candidate(candidate_id: int, payload: CandidateUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, existing.society)
    _ensure_society_allowed(user, payload.society or existing.society)
    return service.update_candidate(db, candidate_id, payload)


@router.delete("/candidates/{candidate_id}")
def delete_candidate(candidate_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, existing.society)
    return service.delete_row(db, Candidate, candidate_id)


@router.post("/candidates/{candidate_id}/recruit", response_model=EmployeeOut)
def recruit(candidate_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    candidate = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, candidate.society)
    return service.recruit_candidate(db, candidate_id)


@router.get("/contracts", response_model=list[ContractOut])
def contracts(employee_id: int | None = None, status: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if employee_id is not None:
        _ensure_employee_allowed(db, user, employee_id)
    rows = service.list_rows(db, Contract, {"employee_id": employee_id, "status": status})
    return _filter_employee_owned_rows(db, user, rows)


@router.post("/contracts", response_model=ContractOut)
def create_contract(payload: ContractCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, payload.employee_id)
    return service.create_row(db, Contract, payload)


@router.put("/contracts/{contract_id}", response_model=ContractOut)
def update_contract(contract_id: int, payload: ContractUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_or_404(db, Contract, contract_id)
    _ensure_employee_allowed(db, user, existing.employee_id)
    return service.update_row(db, Contract, contract_id, payload)


@router.get("/leaves", response_model=list[LeaveOut])
def leaves(employee_id: int | None = None, status: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if employee_id is not None:
        _ensure_employee_allowed(db, user, employee_id)
    rows = service.list_rows(db, Leave, {"employee_id": employee_id, "status": status})
    return _filter_employee_owned_rows(db, user, rows)


@router.post("/leaves", response_model=LeaveOut)
def create_leave(payload: LeaveCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, payload.employee_id)
    return service.create_row(db, Leave, payload)


@router.post("/leaves/{leave_id}/approve", response_model=LeaveOut)
def approve_leave(leave_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    leave = service.get_or_404(db, Leave, leave_id)
    _ensure_employee_allowed(db, user, leave.employee_id)
    return service.approve_leave(db, leave_id)


@router.post("/leaves/{leave_id}/refuse", response_model=LeaveOut)
def refuse_leave(leave_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    leave = service.get_or_404(db, Leave, leave_id)
    _ensure_employee_allowed(db, user, leave.employee_id)
    return service.refuse_leave(db, leave_id)


@router.get("/sanctions", response_model=list[SanctionOut])
def sanctions(employee_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if employee_id is not None:
        _ensure_employee_allowed(db, user, employee_id)
    rows = service.list_rows(db, Sanction, {"employee_id": employee_id})
    return _filter_employee_owned_rows(db, user, rows)


@router.post("/sanctions", response_model=SanctionOut)
def create_sanction(payload: SanctionCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, payload.employee_id)
    return service.create_row(db, Sanction, payload)


@router.get("/documents", response_model=list[DocumentOut])
def documents(owner_type: str | None = None, owner_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_document_allowed(db, user, owner_type, owner_id)
    rows = service.list_rows(db, Document, {"owner_type": owner_type, "owner_id": owner_id})
    return _filter_documents(db, user, rows)


@router.post("/documents", response_model=DocumentOut)
def create_document(payload: DocumentCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_document_allowed(db, user, payload.owner_type, payload.owner_id)
    return service.create_row(db, Document, payload)
