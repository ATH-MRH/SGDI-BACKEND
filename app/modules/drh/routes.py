from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.encoders import jsonable_encoder
from io import BytesIO
from typing import Annotated

from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh import service
from app.modules.drh.models import Candidate, Contract, ContractConditionalClause, ContractTemplate, Document, Employee, GeneratedContract, Leave, Sanction
from app.modules.drh.schemas import (
    CandidateCreate,
    CandidateOut,
    CandidatePage,
    CandidateUpdate,
    ContractCreate,
    ContractOut,
    ContractUpdate,
    ContractConditionalClauseCreate,
    ContractConditionalClauseOut,
    ContractConditionalClauseUpdate,
    ContractTemplateOut,
    DocumentCreate,
    DocumentOut,
    EmployeeCreate,
    EmployeeOut,
    EmployeePage,
    EmployeeUpdate,
    GenerateContractRequest,
    GeneratedContractOut,
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


@router.get("/employees/page", response_model=EmployeePage)
def employees_page(
    mode: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
    society: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    effective_society = _effective_society_filter(user, society)
    allowed = _allowed_societies(user)
    return service.list_employees_page(
        db,
        society=effective_society,
        allowed_societies=allowed if allowed and not effective_society else None,
        mode=mode,
        q=q,
        page=page,
        page_size=page_size,
    )


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
    return service.delete_employee_direct(db, employee_id)


@router.get("/employees/{employee_id}/fiche-position")
def get_fiche_position(employee_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, employee_id)
    return service.fiche_position(db, employee_id)


@router.get("/candidates/page", response_model=CandidatePage)
def candidates_page(
    mode: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
    society: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    effective_society = _effective_society_filter(user, society)
    allowed = _allowed_societies(user)
    return service.list_candidates_page(
        db,
        society=effective_society,
        allowed_societies=allowed if allowed and not effective_society else None,
        mode=mode,
        q=q,
        page=page,
        page_size=page_size,
    )


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


def _action_success(data):
    return {"status": "success", "data": jsonable_encoder(data)}


@router.post("/candidates")
def create_candidate(payload: CandidateCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return _action_success(service.create_candidate(db, payload))


@router.put("/candidates/{candidate_id}")
def update_candidate(candidate_id: int, payload: CandidateUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, existing.society)
    _ensure_society_allowed(user, payload.society or existing.society)
    return _action_success(service.update_candidate(db, candidate_id, payload))


@router.post("/candidates/validate-section")
def validate_candidate_section(
    payload: CandidateCreate,
    section: str,
    candidate_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    _ensure_society_allowed(user, payload.society)
    if candidate_id is not None:
        existing = service.get_or_404(db, Candidate, candidate_id)
        _ensure_society_allowed(user, existing.society)
    return service.validate_candidate_section(db, payload, section=section, existing_id=candidate_id, username=user.username)


@router.post("/candidates/{candidate_id}/validate-final")
def validate_candidate_final(candidate_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, existing.society)
    return _action_success(service.validate_candidate_final(db, candidate_id, username=user.username))


@router.delete("/candidates/{candidate_id}")
def delete_candidate(candidate_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, existing.society)
    return _action_success(service.delete_row(db, Candidate, candidate_id))


@router.post("/candidates/{candidate_id}/recruit")
def recruit(candidate_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    candidate = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, candidate.society)
    return _action_success(service.recruit_candidate(db, candidate_id))


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


@router.get("/contract-templates", response_model=list[ContractTemplateOut])
def contract_templates(
    contract_type: str | None = None,
    active: int | None = None,
    db: Session = Depends(get_db),
):
    return service.list_rows(db, ContractTemplate, {"contract_type": contract_type, "active": active})


@router.post("/contract-templates", response_model=ContractTemplateOut)
async def create_contract_template(
    code: Annotated[str, Form()],
    title: Annotated[str, Form()],
    contract_type: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    position: Annotated[str | None, Form()] = None,
    function: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    active: Annotated[int, Form()] = 1,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if not file.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=422, detail="Le modèle doit être un fichier Word .docx")
    if db.execute(select(ContractTemplate).where(ContractTemplate.code == code)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Code modèle déjà utilisé")
    content = await file.read()
    placeholders = {"items": service.extract_docx_placeholders(content)}
    row = ContractTemplate(
        code=code.strip().upper(),
        title=title.strip(),
        contract_type=contract_type.strip(),
        position=(position or "").strip() or None,
        function=(function or "").strip() or None,
        description=(description or "").strip() or None,
        file_name=file.filename,
        mime_type=file.content_type or service.DOCX_MIME,
        docx_content=content,
        placeholders=placeholders,
        active=active,
        uploaded_by=user.username,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/contract-templates/{template_id}", response_model=ContractTemplateOut)
async def update_contract_template(
    template_id: int,
    code: Annotated[str | None, Form()] = None,
    title: Annotated[str | None, Form()] = None,
    contract_type: Annotated[str | None, Form()] = None,
    file: UploadFile | None = File(default=None),
    position: Annotated[str | None, Form()] = None,
    function: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    active: Annotated[int | None, Form()] = None,
    db: Session = Depends(get_db),
):
    row = service.get_or_404(db, ContractTemplate, template_id)
    if code is not None:
        other = db.execute(select(ContractTemplate).where(ContractTemplate.code == code.strip().upper(), ContractTemplate.id != template_id)).scalar_one_or_none()
        if other:
            raise HTTPException(status_code=409, detail="Code modèle déjà utilisé")
        row.code = code.strip().upper()
    if title is not None:
        row.title = title.strip()
    if contract_type is not None:
        row.contract_type = contract_type.strip()
    if position is not None:
        row.position = position.strip() or None
    if function is not None:
        row.function = function.strip() or None
    if description is not None:
        row.description = description.strip() or None
    if active is not None:
        row.active = active
    if file is not None and file.filename:
        if not file.filename.lower().endswith(".docx"):
            raise HTTPException(status_code=422, detail="Le modèle doit être un fichier Word .docx")
        content = await file.read()
        row.file_name = file.filename
        row.mime_type = file.content_type or service.DOCX_MIME
        row.docx_content = content
        row.placeholders = {"items": service.extract_docx_placeholders(content)}
    db.commit()
    db.refresh(row)
    return row


@router.delete("/contract-templates/{template_id}")
def delete_contract_template(template_id: int, db: Session = Depends(get_db)):
    return service.delete_row(db, ContractTemplate, template_id)


@router.get("/contract-templates/{template_id}/download")
def download_contract_template(template_id: int, db: Session = Depends(get_db)):
    row = service.get_or_404(db, ContractTemplate, template_id)
    return StreamingResponse(
        BytesIO(row.docx_content),
        media_type=row.mime_type or service.DOCX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{row.file_name}"'},
    )


@router.get("/contract-clauses", response_model=list[ContractConditionalClauseOut])
def contract_clauses(template_id: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, ContractConditionalClause, {"template_id": template_id})


@router.post("/contract-clauses", response_model=ContractConditionalClauseOut)
def create_contract_clause(payload: ContractConditionalClauseCreate, db: Session = Depends(get_db)):
    if payload.template_id:
        service.get_or_404(db, ContractTemplate, payload.template_id)
    return service.create_row(db, ContractConditionalClause, payload)


@router.put("/contract-clauses/{clause_id}", response_model=ContractConditionalClauseOut)
def update_contract_clause(clause_id: int, payload: ContractConditionalClauseUpdate, db: Session = Depends(get_db)):
    if payload.template_id:
        service.get_or_404(db, ContractTemplate, payload.template_id)
    return service.update_row(db, ContractConditionalClause, clause_id, payload)


@router.delete("/contract-clauses/{clause_id}")
def delete_contract_clause(clause_id: int, db: Session = Depends(get_db)):
    return service.delete_row(db, ContractConditionalClause, clause_id)


@router.get("/generated-contracts", response_model=list[GeneratedContractOut])
def generated_contracts(employee_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if employee_id is not None:
        _ensure_employee_allowed(db, user, employee_id)
    rows = service.list_rows(db, GeneratedContract, {"employee_id": employee_id})
    return _filter_employee_owned_rows(db, user, rows)


@router.post("/generated-contracts", response_model=GeneratedContractOut)
def generate_contract(payload: GenerateContractRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, payload.employee_id)
    return service.generate_contract(db, payload, user)


@router.get("/generated-contracts/{generated_id}/download")
def download_generated_contract(generated_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = service.get_or_404(db, GeneratedContract, generated_id)
    _ensure_employee_allowed(db, user, row.employee_id)
    return StreamingResponse(
        BytesIO(row.file_content),
        media_type=row.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{row.file_name}"'},
    )
