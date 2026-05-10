from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class EmployeeBase(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    first_name: str
    last_name: str
    father_name: str | None = None
    mother_name: str | None = None
    nin: str | None = None
    birth_date: date | None = None
    birth_place: str | None = None
    family_status: str | None = None
    children_count: int = 0
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    commune: str | None = None
    wilaya: str | None = None
    position: str | None = None
    society: str | None = None
    status: str = "actif"
    contract_type: str | None = None
    salary_net: float = 0
    recruit_date: date | None = None
    trial_end_date: date | None = None
    contract_end_date: date | None = None
    locked: int = 1
    extra: dict[str, Any] | None = None


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    position: str | None = None
    society: str | None = None
    status: str | None = None
    contract_type: str | None = None
    salary_net: float | None = None
    recruit_date: date | None = None
    trial_end_date: date | None = None
    contract_end_date: date | None = None
    locked: int | None = None
    extra: dict[str, Any] | None = None


class EmployeeOut(EmployeeBase):
    id: int
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class CandidateBase(BaseModel):
    first_name: str
    last_name: str
    phone: str | None = None
    email: str | None = None
    desired_position: str | None = None
    society: str | None = None
    expected_salary: float | None = None
    recruiter_opinion: str | None = None
    status: str = "nouvelle"
    data: dict[str, Any] | None = None


class CandidateCreate(CandidateBase):
    pass


class CandidateUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: str | None = None
    desired_position: str | None = None
    society: str | None = None
    expected_salary: float | None = None
    recruiter_opinion: str | None = None
    status: str | None = None
    data: dict[str, Any] | None = None


class CandidateOut(CandidateBase):
    id: int
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ContractBase(BaseModel):
    employee_id: int
    contract_type: str = "CDI"
    position: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    trial_end_date: date | None = None
    salary_net: float = 0
    status: str = "actif"
    template_code: str | None = None
    content: str | None = None


class ContractCreate(ContractBase):
    pass


class ContractUpdate(BaseModel):
    contract_type: str | None = None
    position: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    trial_end_date: date | None = None
    salary_net: float | None = None
    status: str | None = None
    template_code: str | None = None
    content: str | None = None


class ContractOut(ContractBase):
    id: int
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class LeaveBase(BaseModel):
    employee_id: int
    leave_type: str = "conge"
    start_date: date
    end_date: date
    reason: str | None = None
    status: str = "instance"


class LeaveCreate(LeaveBase):
    pass


class LeaveOut(LeaveBase):
    id: int
    decided_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SanctionBase(BaseModel):
    employee_id: int
    infraction_date: date
    site_name: str | None = None
    fault: str
    sanction_type: str
    suspension_days: int = 0
    sanction_start: date | None = None
    next_return_date: date | None = None


class SanctionCreate(SanctionBase):
    pass


class SanctionOut(SanctionBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentCreate(BaseModel):
    owner_type: str
    owner_id: int
    label: str
    file_name: str | None = None
    file_path: str | None = None
    mime_type: str | None = None
    uploaded_by: str | None = None


class DocumentOut(DocumentCreate):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}



class ContractTemplateOut(BaseModel):
    id: int
    code: str
    title: str
    contract_type: str
    position: str | None = None
    function: str | None = None
    description: str | None = None
    file_name: str
    mime_type: str
    placeholders: dict[str, Any] | None = None
    active: int = 1
    uploaded_by: str | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ContractConditionalClauseBase(BaseModel):
    template_id: int | None = None
    title: str
    condition_field: str = "function"
    condition_operator: str = "equals"
    condition_value: str
    placeholder: str = "CLAUSES_CONDITIONNELLES"
    content: str
    active: int = 1


class ContractConditionalClauseCreate(ContractConditionalClauseBase):
    pass


class ContractConditionalClauseUpdate(BaseModel):
    template_id: int | None = None
    title: str | None = None
    condition_field: str | None = None
    condition_operator: str | None = None
    condition_value: str | None = None
    placeholder: str | None = None
    content: str | None = None
    active: int | None = None


class ContractConditionalClauseOut(ContractConditionalClauseBase):
    id: int
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class GenerateContractRequest(BaseModel):
    employee_id: int
    template_id: int | None = None
    contract_type: str | None = None
    position: str | None = None
    function: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    salary_net: float | None = None
    values: dict[str, Any] | None = None
    output_format: str = "docx"


class GeneratedContractOut(BaseModel):
    id: int
    employee_id: int
    template_id: int | None = None
    contract_id: int | None = None
    reference: str
    title: str
    contract_type: str
    position: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    output_format: str
    file_name: str
    mime_type: str
    values: dict[str, Any] | None = None
    generated_by: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
