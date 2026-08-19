from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


# Catégories standard proposées au client lors d'un signalement de problème. Codées ici
# (plutôt qu'en base) pour rester simples à faire évoluer sans migration ; exposées via
# GET /api/client-portal/reference/categories pour que le front n'ait pas à les dupliquer.
OBSERVATION_CATEGORIES: dict[str, str] = {
    "retard": "Retard",
    "absence_injustifiee": "Absence non justifiée",
    "tenue_non_conforme": "Tenue non conforme",
    "comportement_inapproprie": "Comportement inapproprié",
    "sommeil_vigilance": "Sommeil / vigilance au poste",
    "telephone_distraction": "Téléphone / distraction au poste",
    "abandon_poste": "Abandon de poste",
    "autre": "Autre",
}

# Ces catégories, quand cochées sur un signalement de problème, marquent automatiquement
# le signalement comme urgent (alerte prioritaire côté OPS).
URGENT_CATEGORIES = {"abandon_poste", "absence_injustifiee"}

OBSERVATION_STATUSES = ("nouveau", "en_cours", "traite")
OBSERVATION_KINDS = ("observation", "probleme")


class ClientLoginRequest(BaseModel):
    username: str
    password: str


class ClientMeOut(BaseModel):
    must_change_password: bool
    client_id: int
    client_name: str
    full_name: str
    permissions: dict[str, bool]


class ClientPortalTokenOut(ClientMeOut):
    access_token: str
    token_type: str = "bearer"


class ClientChangePasswordIn(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _min_length(cls, value: str) -> str:
        if len(value.strip()) < 6:
            raise ValueError("Le nouveau mot de passe doit contenir au moins 6 caractères")
        return value


class EmployeeVisibleOut(BaseModel):
    id: int
    code: str
    first_name: str
    last_name: str
    position: str | None = None
    site_id: int | None = None
    site_name: str | None = None

    model_config = {"from_attributes": True}


class ObservationCreate(BaseModel):
    employee_id: int
    kind: str
    categories: list[str] = []
    description: str
    incident_date: date

    @field_validator("kind")
    @classmethod
    def _valid_kind(cls, value: str) -> str:
        if value not in OBSERVATION_KINDS:
            raise ValueError("Type de signalement invalide")
        return value

    @field_validator("categories")
    @classmethod
    def _valid_categories(cls, value: list[str]) -> list[str]:
        unknown = [c for c in value if c not in OBSERVATION_CATEGORIES]
        if unknown:
            raise ValueError(f"Catégorie(s) inconnue(s) : {', '.join(unknown)}")
        return value

    @field_validator("description")
    @classmethod
    def _non_empty_description(cls, value: str) -> str:
        if len(value.strip()) < 3:
            raise ValueError("Description trop courte")
        return value.strip()


class ObservationOut(BaseModel):
    """Vue client : jamais de note de résolution interne ni d'identité du résolveur."""

    id: int
    employee_id: int
    employee_name: str
    site_name: str | None = None
    kind: str
    categories: list[str] = []
    severity: str
    description: str
    incident_date: date
    status: str
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ObservationOpsOut(ObservationOut):
    """Vue interne OPS : ajoute le client, le site/l'employé complets et la résolution."""

    client_id: int
    client_name: str
    site_id: int | None = None
    resolution_note: str | None = None
    resolved_by_name: str | None = None
    resolved_at: datetime | None = None


class ObservationResolveIn(BaseModel):
    status: str
    resolution_note: str | None = None

    @field_validator("status")
    @classmethod
    def _valid_status(cls, value: str) -> str:
        if value not in OBSERVATION_STATUSES:
            raise ValueError("Statut invalide")
        return value


class ClientPortalUserCreate(BaseModel):
    client_id: int
    full_name: str
    username: str
    password: str | None = Field(default=None, min_length=6)
    is_active: bool = True
    must_change_password: bool = True


class ClientPortalUserUpdate(BaseModel):
    client_id: int | None = None
    full_name: str | None = None
    username: str | None = None
    password: str | None = Field(default=None, min_length=6)
    is_active: bool | None = None
    must_change_password: bool | None = None


class ClientPortalUserOut(BaseModel):
    id: int
    client_id: int
    full_name: str
    username: str
    is_active: bool
    must_change_password: bool
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ClientPortalUserCreatedOut(ClientPortalUserOut):
    temporary_password: str
