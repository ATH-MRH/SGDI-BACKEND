from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
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


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    return service.drh_dashboard(db)


@router.get("/employees", response_model=list[EmployeeOut])
def employees(status: str | None = None, society: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Employee, {"status": status, "society": society})


@router.post("/employees", response_model=EmployeeOut)
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Employee, payload)


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: int, db: Session = Depends(get_db)):
    return service.get_or_404(db, Employee, employee_id)


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
def update_employee(employee_id: int, payload: EmployeeUpdate, db: Session = Depends(get_db)):
    return service.update_row(db, Employee, employee_id, payload)


@router.delete("/employees/{employee_id}")
def delete_employee(employee_id: int, db: Session = Depends(get_db)):
    return service.delete_row(db, Employee, employee_id)


@router.get("/employees/{employee_id}/fiche-position")
def get_fiche_position(employee_id: int, db: Session = Depends(get_db)):
    return service.fiche_position(db, employee_id)


@router.get("/candidates", response_model=list[CandidateOut])
def candidates(status: str | None = None, society: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Candidate, {"status": status, "society": society})


@router.post("/candidates", response_model=CandidateOut)
def create_candidate(payload: CandidateCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Candidate, payload)


@router.put("/candidates/{candidate_id}", response_model=CandidateOut)
def update_candidate(candidate_id: int, payload: CandidateUpdate, db: Session = Depends(get_db)):
    return service.update_row(db, Candidate, candidate_id, payload)


@router.post("/candidates/{candidate_id}/recruit", response_model=EmployeeOut)
def recruit(candidate_id: int, db: Session = Depends(get_db)):
    return service.recruit_candidate(db, candidate_id)


@router.get("/contracts", response_model=list[ContractOut])
def contracts(employee_id: int | None = None, status: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Contract, {"employee_id": employee_id, "status": status})


@router.post("/contracts", response_model=ContractOut)
def create_contract(payload: ContractCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Contract, payload)


@router.put("/contracts/{contract_id}", response_model=ContractOut)
def update_contract(contract_id: int, payload: ContractUpdate, db: Session = Depends(get_db)):
    return service.update_row(db, Contract, contract_id, payload)


@router.get("/leaves", response_model=list[LeaveOut])
def leaves(employee_id: int | None = None, status: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Leave, {"employee_id": employee_id, "status": status})


@router.post("/leaves", response_model=LeaveOut)
def create_leave(payload: LeaveCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Leave, payload)


@router.post("/leaves/{leave_id}/approve", response_model=LeaveOut)
def approve_leave(leave_id: int, db: Session = Depends(get_db)):
    return service.approve_leave(db, leave_id)


@router.post("/leaves/{leave_id}/refuse", response_model=LeaveOut)
def refuse_leave(leave_id: int, db: Session = Depends(get_db)):
    return service.refuse_leave(db, leave_id)


@router.get("/sanctions", response_model=list[SanctionOut])
def sanctions(employee_id: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Sanction, {"employee_id": employee_id})


@router.post("/sanctions", response_model=SanctionOut)
def create_sanction(payload: SanctionCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Sanction, payload)


@router.get("/documents", response_model=list[DocumentOut])
def documents(owner_type: str | None = None, owner_id: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Document, {"owner_type": owner_type, "owner_id": owner_id})


@router.post("/documents", response_model=DocumentOut)
def create_document(payload: DocumentCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Document, payload)

