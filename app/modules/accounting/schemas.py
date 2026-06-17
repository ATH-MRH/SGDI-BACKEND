from datetime import date, datetime

from pydantic import BaseModel


class CompteComptableBase(BaseModel):
    society: str | None = None
    numero: str
    libelle: str
    type_compte: str | None = None
    parent_numero: str | None = None
    notes: str | None = None


class CompteComptableCreate(CompteComptableBase):
    pass


class CompteComptableUpdate(BaseModel):
    society: str | None = None
    numero: str | None = None
    libelle: str | None = None
    type_compte: str | None = None
    parent_numero: str | None = None
    notes: str | None = None


class CompteComptableOut(CompteComptableBase):
    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class LigneEcritureBase(BaseModel):
    compte_numero: str
    libelle: str | None = None
    debit: float = 0
    credit: float = 0


class LigneEcritureCreate(LigneEcritureBase):
    pass


class LigneEcritureUpdate(BaseModel):
    compte_numero: str | None = None
    libelle: str | None = None
    debit: float | None = None
    credit: float | None = None


class LigneEcritureOut(LigneEcritureBase):
    id: int
    ecriture_id: int
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class EcritureComptableBase(BaseModel):
    society: str | None = None
    date_ecriture: date | None = None
    libelle: str | None = None
    journal: str | None = None
    ref_externe: str | None = None
    notes: str | None = None


class EcritureComptableCreate(EcritureComptableBase):
    lignes: list[LigneEcritureCreate] = []


class EcritureComptableUpdate(BaseModel):
    society: str | None = None
    date_ecriture: date | None = None
    libelle: str | None = None
    journal: str | None = None
    ref_externe: str | None = None
    notes: str | None = None


class EcritureComptableOut(EcritureComptableBase):
    id: int
    numero_piece: str | None = None
    status: str
    total_debit: float
    total_credit: float
    created_at: datetime | None = None
    updated_at: datetime | None = None
    lignes: list[LigneEcritureOut] = []

    model_config = {"from_attributes": True}


class BalanceLigne(BaseModel):
    compte_numero: str
    libelle: str
    total_debit: float
    total_credit: float
    solde: float
