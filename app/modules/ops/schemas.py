from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class SiteBase(BaseModel):
    name: str
    indicatif: str | None = None
    client_name: str | None = None
    address: str | None = None
    commune: str | None = None
    wilaya: str | None = None
    site_type: str | None = None
    rotation_system: str | None = None
    contractual_staff: int = 0
    day_staff: int = 0
    night_staff: int = 0
    weekend_staff: int = 0
    holiday_staff: int = 0
    groups_count: int = 0
    active: int = 1
    equipment_plan: dict[str, Any] | None = None


class SiteCreate(SiteBase):
    pass


class SiteUpdate(BaseModel):
    name: str | None = None
    indicatif: str | None = None
    client_name: str | None = None
    address: str | None = None
    commune: str | None = None
    wilaya: str | None = None
    site_type: str | None = None
    rotation_system: str | None = None
    contractual_staff: int | None = None
    day_staff: int | None = None
    night_staff: int | None = None
    weekend_staff: int | None = None
    holiday_staff: int | None = None
    groups_count: int | None = None
    active: int | None = None
    equipment_plan: dict[str, Any] | None = None


class SiteOut(SiteBase):
    id: int

    model_config = {"from_attributes": True}


class SitePostCreate(BaseModel):
    site_id: int
    name: str
    day_count: int = 0
    night_count: int = 0
    rotation_system: str | None = None


class SitePostOut(SitePostCreate):
    id: int
    total_count: int

    model_config = {"from_attributes": True}


class AssignmentCreate(BaseModel):
    employee_id: int
    site_id: int
    group_code: str = "A"
    position: str | None = None
    start_date: date
    end_date: date | None = None
    change_reason: str | None = None
    active: int = 1


class AssignmentOut(AssignmentCreate):
    id: int

    model_config = {"from_attributes": True}


class DailyPresenceCreate(BaseModel):
    presence_date: date
    employee_id: int
    site_id: int | None = None
    group_code: str | None = None
    arrival_time: str | None = None
    departure_time: str | None = None
    relief_time: str | None = None
    status: str = "present"
    notes: str | None = None
    rotation_system: str | None = None
    rotation_group: str | None = None
    rotation_period: str | None = None
    faction: str | None = None
    recovery: int = 0
    standby: int = 0
    data: dict[str, Any] | None = None


class DailyPresenceUpdate(BaseModel):
    site_id: int | None = None
    group_code: str | None = None
    arrival_time: str | None = None
    departure_time: str | None = None
    relief_time: str | None = None
    status: str | None = None
    notes: str | None = None
    rotation_system: str | None = None
    rotation_group: str | None = None
    rotation_period: str | None = None
    faction: str | None = None
    recovery: int | None = None
    standby: int | None = None
    data: dict[str, Any] | None = None


class RotationGenerateRequest(BaseModel):
    presence_date: date | None = None
    society: str | None = None
    site_id: int | None = None
    overwrite_generated: bool = True


class DailyPresenceOut(DailyPresenceCreate):
    id: int
    generated: int = 0
    closed_at: datetime | None = None

    model_config = {"from_attributes": True}


class EventCreate(BaseModel):
    event_type: str = "autre"
    level: str = "normal"
    title: str
    message: str
    site_id: int | None = None
    employee_id: int | None = None
    status: str = "ouvert"
    action_taken: str | None = None


class EventOut(EventCreate):
    id: int
    event_date: datetime
    closed_at: datetime | None = None

    model_config = {"from_attributes": True}

