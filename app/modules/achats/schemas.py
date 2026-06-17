from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class FournisseurBase(BaseModel):
    society: str | None = None
    name: str
    legal_name: str | None = None
    contact_name: str | None = None
    contact_position: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    nif: str | None = None
    rc: str | None = None
    status: str = "actif"
    notes: str | None = None
    data: dict[str, Any] | None = None


class FournisseurCreate(FournisseurBase):
    pass


class FournisseurUpdate(BaseModel):
    society: str | None = None
    name: str | None = None
    legal_name: str | None = None
    contact_name: str | None = None
    contact_position: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    nif: str | None = None
    rc: str | None = None
    status: str | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class FournisseurOut(FournisseurBase):
    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Lignes ──────────────────────────────────────────────────────────────────

class LigneBDCBase(BaseModel):
    designation: str
    reference: str | None = None
    quantite: float = 1
    unite: str | None = None
    prix_unitaire_ht: float = 0
    tva_pct: float = 0


class LigneBDCCreate(LigneBDCBase):
    pass


class LigneBDCUpdate(BaseModel):
    designation: str | None = None
    reference: str | None = None
    quantite: float | None = None
    unite: str | None = None
    prix_unitaire_ht: float | None = None
    tva_pct: float | None = None
    notes: str | None = None


class LigneBDCOut(LigneBDCBase):
    id: int
    bon_commande_id: int
    total_ht: float
    total_ttc: float
    notes: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Bon de commande ─────────────────────────────────────────────────────────

class BonDeCommandeBase(BaseModel):
    society: str | None = None
    fournisseur_id: int | None = None
    fournisseur_name: str | None = None
    date_commande: date | None = None
    date_livraison_prevue: date | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class BonDeCommandeCreate(BonDeCommandeBase):
    lignes: list[LigneBDCCreate] = []


class BonDeCommandeUpdate(BaseModel):
    fournisseur_id: int | None = None
    fournisseur_name: str | None = None
    date_commande: date | None = None
    date_livraison_prevue: date | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class BonDeCommandeOut(BonDeCommandeBase):
    id: int
    numero: str | None = None
    status: str
    total_ht: float
    tva: float
    total_ttc: float
    lignes: list[LigneBDCOut] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Réception ───────────────────────────────────────────────────────────────

class LigneReceptionBase(BaseModel):
    article_id: int | None = None
    designation: str
    reference: str | None = None
    quantite_commandee: float = 0
    quantite_recue: float = 0
    unite: str | None = None
    prix_unitaire: float = 0
    notes: str | None = None


class LigneReceptionCreate(LigneReceptionBase):
    pass


class LigneReceptionUpdate(BaseModel):
    designation: str | None = None
    reference: str | None = None
    quantite_commandee: float | None = None
    quantite_recue: float | None = None
    unite: str | None = None
    notes: str | None = None


class LigneReceptionOut(LigneReceptionBase):
    id: int
    reception_id: int
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ReceptionBase(BaseModel):
    society: str | None = None
    bon_commande_id: int | None = None
    fournisseur_id: int | None = None
    fournisseur_name: str | None = None
    date_reception: date | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class ReceptionCreate(ReceptionBase):
    lignes: list[LigneReceptionCreate] = []


class ReceptionUpdate(BaseModel):
    fournisseur_id: int | None = None
    fournisseur_name: str | None = None
    date_reception: date | None = None
    status: str | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class ReceptionOut(ReceptionBase):
    id: int
    numero: str | None = None
    status: str
    lignes: list[LigneReceptionOut] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Facture fournisseur ─────────────────────────────────────────────────────

class FactureFournisseurBase(BaseModel):
    society: str | None = None
    fournisseur_id: int | None = None
    fournisseur_name: str | None = None
    bon_commande_id: int | None = None
    reception_id: int | None = None
    numero_fournisseur: str | None = None
    date_facture: date | None = None
    date_echeance: date | None = None
    total_ht: float = 0
    tva: float = 0
    total_ttc: float = 0
    notes: str | None = None
    data: dict[str, Any] | None = None


class FactureFournisseurCreate(FactureFournisseurBase):
    pass


class FactureFournisseurUpdate(BaseModel):
    fournisseur_id: int | None = None
    fournisseur_name: str | None = None
    bon_commande_id: int | None = None
    reception_id: int | None = None
    numero_fournisseur: str | None = None
    date_facture: date | None = None
    date_echeance: date | None = None
    total_ht: float | None = None
    tva: float | None = None
    total_ttc: float | None = None
    notes: str | None = None
    data: dict[str, Any] | None = None


class FactureFournisseurOut(FactureFournisseurBase):
    id: int
    numero: str | None = None
    status: str
    montant_paye: float
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
