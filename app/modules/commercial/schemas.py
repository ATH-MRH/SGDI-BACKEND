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


class DcRequirementIn(BaseModel):
    """Une ligne de besoin contractuel DC : identité métier = position_id
    (référentiel canonique Administration système → Postes/Fonctions), jamais
    le libellé — voir LOT ERP : bascule contractuelle DC (finalisation)."""
    position_id: int
    quantity: int

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Quantité invalide : doit être strictement positive")
        return value


class DcContractSiteIn(BaseModel):
    key: str
    name: str
    address: str | None = None
    first_shift_time: str = "06:00"
    rotation_start_date: date
    requirements: list[DcRequirementIn] = Field(default_factory=list)

    @field_validator("requirements")
    @classmethod
    def validate_requirements(cls, value: list[DcRequirementIn]) -> list[DcRequirementIn]:
        if not value:
            raise ValueError("Au moins une fonction avec un effectif positif est obligatoire")
        ids = [item.position_id for item in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Doublon : un même poste ne peut apparaître qu'une seule fois par site")
        return value


class DcContractUpdate(BaseModel):
    status: str = "brouillon"
    sites: list[DcContractSiteIn] = Field(default_factory=list)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        if value not in {"brouillon", "valide"}:
            raise ValueError("Statut contractuel invalide")
        return value

    @field_validator("sites")
    @classmethod
    def validate_sites_unique_keys(cls, value: list["DcContractSiteIn"]) -> list["DcContractSiteIn"]:
        keys = [item.key.strip() for item in value if item.key and item.key.strip()]
        if len(keys) != len(set(keys)):
            raise ValueError("Mapping ambigu : plusieurs sites du contrat partagent la même clé de liaison")
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
