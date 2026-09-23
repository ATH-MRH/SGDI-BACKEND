from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class AttendanceUpsert(BaseModel):
    employee_id: int
    presence_date: date
    status: str
    arrival_time: str | None = None
    departure_time: str | None = None
    notes: str | None = None


class AttendanceCorrection(BaseModel):
    status: str
    notes: str | None = None
    reason: str


class AbsenceDecision(BaseModel):
    decision: str  # "justifiee" | "injustifiee"
    comment: str | None = None


class DocumentUpload(BaseModel):
    owner_type: str  # "leave" | "attendance" | "reclamation"
    owner_id: int
    label: str
    data_url: str


class DocumentVerify(BaseModel):
    validity_status: str  # "conforme" | "non_conforme"
    comment: str | None = None


class LeaveCreate(BaseModel):
    employee_id: int
    leave_type: str  # "conge" | "maladie"
    start_date: date
    end_date: date
    reason: str | None = None


class ReclamationCreate(BaseModel):
    employee_id: int
    category: str | None = None
    subject: str
    description: str
    priority: str = "normale"


class ReclamationRespond(BaseModel):
    response: str


class IncidentCreate(BaseModel):
    employee_id: int | None = None
    event_type: str
    category: str | None = None
    severity: str | None = None
    subject: str
    description: str | None = None
    incident_date: date | None = None


class TransmissionCreate(BaseModel):
    resource_type: str  # "incident" | "reclamation"
    resource_id: int
    destinataire: str  # "drh" | "ops" | "direction"
    objet: str
    commentaire: str | None = None
    priority: str = "normale"


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    notif_type: str
    message: str
    level: str
    status: str
    employee_id: int | None
    created_at: datetime
    read_at: datetime | None
