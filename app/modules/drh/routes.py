from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from app.core.authz import require_level
from fastapi.encoders import jsonable_encoder
from io import BytesIO
import unicodedata
from typing import Annotated

import orjson
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_token_payload, current_user
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
    DirectContractRequest,
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


def _society_key(value: str | None) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "").strip())
    without_accents = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return " ".join(without_accents.upper().split())


def _canonical_allowed_society(user: User, society: str | None) -> str | None:
    key = _society_key(society)
    if not key:
        return None
    for allowed in _allowed_societies(user):
        if _society_key(allowed) == key:
            return allowed
    return None


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and not _canonical_allowed_society(user, society):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _is_admin_system_user(user: User, token_payload: dict) -> bool:
    role = str(user.role or "").strip().upper()
    return role in {"ADMIN", "ADM", "ADM1", "ADM2"} and token_payload.get("admin_system") is True


def _effective_society_filter(user: User, requested: str | None) -> str | None:
    allowed = _allowed_societies(user)
    if requested:
        _ensure_society_allowed(user, requested)
        return _canonical_allowed_society(user, requested) or requested
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
    scope = service.employee_society_scope_condition(allowed)
    stmt = select(Employee.id)
    if scope is not None:
        stmt = stmt.where(scope)
    rows = db.execute(stmt).scalars().all()
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
    allowed = _allowed_societies(user)
    employees_rows = service.list_employees(
        db,
        society=effective_society,
        allowed_societies=allowed if allowed and not effective_society else None,
    )
    candidates_rows = service.list_rows(db, Candidate, {"society": effective_society})
    if allowed and not effective_society:
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
    allowed = _allowed_societies(user)
    rows = service.list_employees(
        db,
        status=status,
        society=effective_society,
        allowed_societies=allowed if allowed and not effective_society else None,
    )
    # Injecter l'affectation ACTIVE réelle (table SQL assignments) dans chaque employé, pour que
    # le front affiche la vérité sans dépendre d'un appariement local fragile. Un employé sans
    # affectation active repart sans site (cohérent avec la base).
    from app.modules.irongs.sql_bridge import _live_assignment_map
    live = _live_assignment_map(db)
    # Un seul passage de sérialisation : model_dump(mode="json") produit un dict JSON-safe,
    # qu'on renvoie tel quel via JSONResponse. On évite ainsi la re-validation intégrale que
    # FastAPI ferait sur ~12 Mo si on retournait des objets EmployeeOut avec response_model.
    # (_live_assignment_map ne fournit que des chaînes/entiers : le dict reste JSON-safe.)
    payload: list[dict] = []
    for row in rows:
        data = EmployeeOut.model_validate(row).model_dump(mode="json")
        extra = data.get("extra") if isinstance(data.get("extra"), dict) else {}
        legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
        aff = live.get(row.id)
        if aff:
            cur = legacy.get("affectationCourante") if isinstance(legacy.get("affectationCourante"), dict) else {}
            legacy["affectationCourante"] = {**cur, **aff}
        elif isinstance(legacy.get("affectationCourante"), dict):
            legacy["affectationCourante"] = {}
        extra["_legacy"] = legacy
        data["extra"] = extra
        payload.append(data)
    # orjson (C) : bien plus rapide que le json.dumps par défaut sur ~12 Mo. payload est déjà
    # JSON-safe (model_dump(mode="json") + valeurs str/int) ; default=str en filet de sécurité.
    raw = orjson.dumps(payload, default=str, option=orjson.OPT_NON_STR_KEYS)
    return Response(content=raw, media_type="application/json")


@router.post("/employees/repair-codes")
def repair_employee_codes(db: Session = Depends(get_db), user: User = Depends(current_user), token_payload: dict = Depends(current_token_payload)):
    if not _is_admin_system_user(user, token_payload):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Réservé à l'administrateur système")
    updated = service.repair_employee_codes_if_needed(db)
    return {"updated": updated}


@router.post("/employees", response_model=EmployeeOut, dependencies=[Depends(require_level("write"))])
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    code = (payload.code or "").strip().upper() or service.next_employee_code(db, payload.society)
    for attempt in range(200):
        values = payload.model_dump()
        values["code"] = code
        try:
            return service.create_row(db, Employee, EmployeeCreate(**values))
        except HTTPException as exc:
            if "ix_employees_code" not in str(exc.detail) or attempt >= 199:
                raise
            code = service.next_employee_code_after_conflict(db, payload.society, code)
    raise HTTPException(status_code=409, detail="Code employé indisponible")


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _ensure_employee_allowed(db, user, employee_id)


@router.put("/employees/{employee_id}", response_model=EmployeeOut, dependencies=[Depends(require_level("write"))])
def update_employee(employee_id: int, payload: EmployeeUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = _ensure_employee_allowed(db, user, employee_id)
    _ensure_society_allowed(user, payload.society or existing.society)
    if payload.code:
        new_code = payload.code.strip().upper()
        if new_code != existing.code:
            conflict = db.query(Employee).filter(Employee.code == new_code, Employee.id != employee_id).first()
            if conflict:
                raise HTTPException(status_code=409, detail=f"ix_employees_code: Code {new_code} déjà utilisé par l'employé #{conflict.id}")
        payload = payload.model_copy(update={"code": new_code})
    return service.update_row(db, Employee, employee_id, payload)


@router.delete("/employees/{employee_id}", dependencies=[Depends(require_level("delete"))])
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    token_payload: dict = Depends(current_token_payload),
):
    if _is_admin_system_user(user, token_payload):
        service.get_or_404(db, Employee, employee_id)
    else:
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


@router.post("/candidates", dependencies=[Depends(require_level("write"))])
def create_candidate(payload: CandidateCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return _action_success(service.create_candidate(db, payload, username=user.username))


@router.put("/candidates/{candidate_id}", dependencies=[Depends(require_level("write"))])
def update_candidate(candidate_id: int, payload: CandidateUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, existing.society)
    _ensure_society_allowed(user, payload.society or existing.society)
    return _action_success(service.update_candidate(db, candidate_id, payload))


@router.post("/candidates/validate-section", dependencies=[Depends(require_level("validate"))])
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


@router.post("/candidates/{candidate_id}/validate-final", dependencies=[Depends(require_level("validate"))])
def validate_candidate_final(candidate_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, existing.society)
    return _action_success(service.validate_candidate_final(db, candidate_id, username=user.username))


@router.post("/candidates/{candidate_id}/marquer-contractualisation", dependencies=[Depends(require_level("validate"))])
def marquer_contractualisation(candidate_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Passe le candidat en 'a_contractualiser' — étape entre réserve et embauche."""
    existing = service.get_or_404(db, Candidate, candidate_id)
    _ensure_society_allowed(user, existing.society)
    return _action_success(service.marquer_a_contractualiser(db, candidate_id, username=user.username))


@router.delete("/candidates/{candidate_id}", dependencies=[Depends(require_level("delete"))])
def delete_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    token_payload: dict = Depends(current_token_payload),
):
    existing = service.get_or_404(db, Candidate, candidate_id)
    if not _is_admin_system_user(user, token_payload):
        _ensure_society_allowed(user, existing.society)
    return _action_success(service.delete_row(db, Candidate, candidate_id))


@router.post("/candidates/{candidate_id}/recruit", dependencies=[Depends(require_level("validate"))])
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


@router.post("/contracts", response_model=ContractOut, dependencies=[Depends(require_level("write"))])
def create_contract(payload: ContractCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, payload.employee_id)
    return service.create_row(db, Contract, payload)


@router.put("/contracts/{contract_id}", response_model=ContractOut, dependencies=[Depends(require_level("write"))])
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


@router.post("/leaves", response_model=LeaveOut, dependencies=[Depends(require_level("write"))])
def create_leave(payload: LeaveCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, payload.employee_id)
    return service.create_row(db, Leave, payload)


@router.post("/leaves/{leave_id}/approve", response_model=LeaveOut, dependencies=[Depends(require_level("validate"))])
def approve_leave(leave_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    leave = service.get_or_404(db, Leave, leave_id)
    _ensure_employee_allowed(db, user, leave.employee_id)
    return service.approve_leave(db, leave_id)


@router.post("/leaves/{leave_id}/refuse", response_model=LeaveOut, dependencies=[Depends(require_level("validate"))])
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


@router.post("/sanctions", response_model=SanctionOut, dependencies=[Depends(require_level("write"))])
def create_sanction(payload: SanctionCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, payload.employee_id)
    return service.create_row(db, Sanction, payload)


@router.get("/documents", response_model=list[DocumentOut])
def documents(owner_type: str | None = None, owner_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_document_allowed(db, user, owner_type, owner_id)
    rows = service.list_rows(db, Document, {"owner_type": owner_type, "owner_id": owner_id})
    return _filter_documents(db, user, rows)


@router.post("/documents", response_model=DocumentOut, dependencies=[Depends(require_level("write"))])
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


@router.post("/contract-templates", response_model=ContractTemplateOut, dependencies=[Depends(require_level("write"))])
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


@router.put("/contract-templates/{template_id}", response_model=ContractTemplateOut, dependencies=[Depends(require_level("write"))])
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


@router.delete("/contract-templates/{template_id}", dependencies=[Depends(require_level("delete"))])
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


@router.post("/contract-clauses", response_model=ContractConditionalClauseOut, dependencies=[Depends(require_level("write"))])
def create_contract_clause(payload: ContractConditionalClauseCreate, db: Session = Depends(get_db)):
    if payload.template_id:
        service.get_or_404(db, ContractTemplate, payload.template_id)
    return service.create_row(db, ContractConditionalClause, payload)


@router.put("/contract-clauses/{clause_id}", response_model=ContractConditionalClauseOut, dependencies=[Depends(require_level("write"))])
def update_contract_clause(clause_id: int, payload: ContractConditionalClauseUpdate, db: Session = Depends(get_db)):
    if payload.template_id:
        service.get_or_404(db, ContractTemplate, payload.template_id)
    return service.update_row(db, ContractConditionalClause, clause_id, payload)


@router.delete("/contract-clauses/{clause_id}", dependencies=[Depends(require_level("delete"))])
def delete_contract_clause(clause_id: int, db: Session = Depends(get_db)):
    return service.delete_row(db, ContractConditionalClause, clause_id)


@router.get("/generated-contracts", response_model=list[GeneratedContractOut])
def generated_contracts(employee_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if employee_id is not None:
        _ensure_employee_allowed(db, user, employee_id)
    rows = service.list_rows(db, GeneratedContract, {"employee_id": employee_id})
    return _filter_employee_owned_rows(db, user, rows)


@router.post("/generated-contracts", response_model=GeneratedContractOut, dependencies=[Depends(require_level("write"))])
def generate_contract(payload: GenerateContractRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_employee_allowed(db, user, payload.employee_id)
    return service.generate_contract(db, payload, user)


@router.post("/generated-contracts/from-form", response_model=GeneratedContractOut, dependencies=[Depends(require_level("write"))])
def generate_contract_from_form(payload: DirectContractRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.generate_contract_from_form(db, payload, user)


@router.get("/generated-contracts/{generated_id}/download")
def download_generated_contract(generated_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = service.get_or_404(db, GeneratedContract, generated_id)
    _ensure_employee_allowed(db, user, row.employee_id)
    return StreamingResponse(
        BytesIO(row.file_content),
        media_type=row.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{row.file_name}"'},
    )
