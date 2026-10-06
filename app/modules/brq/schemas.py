from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class BRQItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    employee_id: int | None = None
    matricule: str = ""
    nom: str = ""
    fonction: str = ""
    society: str = ""
    site_id: int | None = None
    site: str = ""
    wilaya: str = ""
    state: str = ""
    expected: bool = False
    date_sortie: date | None = None
    sortie_date_status: str | None = None
    planning: dict[str, Any] = Field(default_factory=dict)
    arrival: str = ""
    departure: str = ""
    abandon: dict[str, Any] | None = None


class BRQList(BaseModel):
    date: date
    total: int
    items: list[BRQItem]
    filters: dict[str, Any]


class BRQSituation(BaseModel):
    date: date
    timezone: str
    kpis: dict[str, int | float | None]
    filters: dict[str, Any]
    items: list[BRQItem]
    notes: list[str] = Field(default_factory=list)
