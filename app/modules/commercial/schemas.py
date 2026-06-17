from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class ClientBase(BaseModel):
    name: str
    legal_name: str | None = None
    society: str | None = None
    structure: str | None = None
    status: str = "actif"
    contact_name: str | None = None
    contact_position: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    nif: str | None = None
    rc: str | None = None
    services: str | None = None
    contract_start: date | None = None
    contract_duration: str | None = None
    contract_end: date | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: str | None = None
    legal_name: str | None = None
    society: str | None = None
    structure: str | None = None
    status: str | None = None
    contact_name: str | None = None
    contact_position: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    nif: str | None = None
    rc: str | None = None
    services: str | None = None
    contract_start: date | None = None
    contract_duration: str | None = None
    contract_end: date | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class ClientOut(ClientBase):
    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
