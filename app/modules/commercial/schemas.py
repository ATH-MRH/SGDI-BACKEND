from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


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
    ai: str | None = None
    nis: str | None = None
    rc: str | None = None
    services: str | None = None
    contract_start: date | None = None
    contract_duration: str | None = None
    contract_end: date | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None
    portal_slug: str | None = None
    portal_enabled: bool = True


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
    ai: str | None = None
    nis: str | None = None
    rc: str | None = None
    services: str | None = None
    contract_start: date | None = None
    contract_duration: str | None = None
    contract_end: date | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None
    portal_slug: str | None = None
    portal_enabled: bool | None = None


class ClientOut(ClientBase):
    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class DcContractSiteIn(BaseModel):
    key: str
    name: str
    address: str | None = None
    first_shift_time: str = "06:00"
    rotation_start_date: date
    requirements: dict[str, int] = Field(default_factory=dict)

    @field_validator("requirements")
    @classmethod
    def validate_requirements(cls, value: dict[str, int]) -> dict[str, int]:
        cleaned = {str(name).strip().upper(): int(count) for name, count in value.items() if str(name).strip() and int(count) > 0}
        if not cleaned:
            raise ValueError("Au moins une fonction avec un effectif positif est obligatoire")
        return cleaned


class DcContractUpdate(BaseModel):
    status: str = "brouillon"
    sites: list[DcContractSiteIn] = Field(default_factory=list)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        if value not in {"brouillon", "valide"}:
            raise ValueError("Statut contractuel invalide")
        return value


# Rôles de base utilisés pour les droits d'accès au module (mêmes 4 catégories que le
# tableau "Droits d'accès" d'Administration système : agent / dispatch / cadre / directeur).
DC_ACCESS_BASE_ROLES = ["agent", "dispatch", "ops", "ADM"]
DC_ACCESS_ROLE_LABELS = {"agent": "Agent", "dispatch": "Maîtrise", "ops": "Cadre", "ADM": "Directeur"}


class CommercialDcSettingsOut(BaseModel):
    default_tva: float
    devis_prefix: str
    commande_prefix: str
    bl_prefix: str
    active_societies: list[str]
    my_access: bool

    model_config = {"from_attributes": True}


class CommercialDcSettingsUpdate(BaseModel):
    default_tva: float | None = None
    devis_prefix: str | None = None
    commande_prefix: str | None = None
    bl_prefix: str | None = None
    active_societies: list[str] | None = None


class CommercialDcAccessRuleOut(BaseModel):
    role: str
    label: str
    allowed: bool
    is_default: bool


class CommercialDcAccessRuleIn(BaseModel):
    role: str
    allowed: bool
