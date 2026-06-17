from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


# ── Lignes ──────────────────────────────────────────────────────────────────

class LigneVenteBase(BaseModel):
    designation: str
    reference: str | None = None
    quantite: float = 1
    unite: str | None = None
    prix_unitaire_ht: float = 0
    tva_pct: float = 0
    notes: str | None = None


class LigneVenteCreate(LigneVenteBase):
    pass


class LigneVenteUpdate(BaseModel):
    designation: str | None = None
    reference: str | None = None
    quantite: float | None = None
    unite: str | None = None
    prix_unitaire_ht: float | None = None
    tva_pct: float | None = None
    notes: str | None = None


class LigneVenteOut(LigneVenteBase):
    id: int
    total_ht: float
    total_ttc: float
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Devis ────────────────────────────────────────────────────────────────────

class DevisBase(BaseModel):
    society: str | None = None
    client_id: int | None = None
    client_name: str | None = None
    date_devis: date | None = None
    date_validite: date | None = None
    objet: str | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class DevisCreate(DevisBase):
    lignes: list[LigneVenteCreate] = []


class DevisUpdate(BaseModel):
    client_id: int | None = None
    client_name: str | None = None
    date_devis: date | None = None
    date_validite: date | None = None
    objet: str | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class DevisOut(DevisBase):
    id: int
    numero: str | None = None
    status: str
    total_ht: float
    tva: float
    total_ttc: float
    lignes: list[LigneVenteOut] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Commande client ──────────────────────────────────────────────────────────

class CommandeClientBase(BaseModel):
    society: str | None = None
    client_id: int | None = None
    client_name: str | None = None
    devis_id: int | None = None
    date_commande: date | None = None
    date_livraison_prevue: date | None = None
    objet: str | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class CommandeClientCreate(CommandeClientBase):
    lignes: list[LigneVenteCreate] = []


class CommandeClientUpdate(BaseModel):
    client_id: int | None = None
    client_name: str | None = None
    date_commande: date | None = None
    date_livraison_prevue: date | None = None
    objet: str | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class CommandeClientOut(CommandeClientBase):
    id: int
    numero: str | None = None
    status: str
    total_ht: float
    tva: float
    total_ttc: float
    lignes: list[LigneVenteOut] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Bon de livraison ─────────────────────────────────────────────────────────

class LigneBLBase(BaseModel):
    designation: str
    reference: str | None = None
    quantite_commandee: float = 0
    quantite_livree: float = 0
    unite: str | None = None
    notes: str | None = None


class LigneBLCreate(LigneBLBase):
    pass


class LigneBLUpdate(BaseModel):
    designation: str | None = None
    reference: str | None = None
    quantite_commandee: float | None = None
    quantite_livree: float | None = None
    unite: str | None = None
    notes: str | None = None


class LigneBLOut(LigneBLBase):
    id: int
    bl_id: int
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class BonDeLivraisonBase(BaseModel):
    society: str | None = None
    commande_id: int | None = None
    client_id: int | None = None
    client_name: str | None = None
    date_livraison: date | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class BonDeLivraisonCreate(BonDeLivraisonBase):
    lignes: list[LigneBLCreate] = []


class BonDeLivraisonUpdate(BaseModel):
    client_id: int | None = None
    client_name: str | None = None
    date_livraison: date | None = None
    status: str | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class BonDeLivraisonOut(BonDeLivraisonBase):
    id: int
    numero: str | None = None
    status: str
    lignes: list[LigneBLOut] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
