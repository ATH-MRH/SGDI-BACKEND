from datetime import date

from sqlalchemy import Date, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Fournisseur(Base, TimestampMixin):
    __tablename__ = "fournisseurs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    legal_name: Mapped[str | None] = mapped_column(String(220))
    contact_name: Mapped[str | None] = mapped_column(String(180))
    contact_position: Mapped[str | None] = mapped_column(String(140))
    phone: Mapped[str | None] = mapped_column(String(60))
    email: Mapped[str | None] = mapped_column(String(180))
    address: Mapped[str | None] = mapped_column(Text)
    nif: Mapped[str | None] = mapped_column(String(100))
    rc: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(60), default="actif", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)


class BonDeCommande(Base, TimestampMixin):
    __tablename__ = "bons_commande_achat"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    fournisseur_id: Mapped[int | None] = mapped_column(Integer, index=True)
    fournisseur_name: Mapped[str | None] = mapped_column(String(180), index=True)
    numero: Mapped[str | None] = mapped_column(String(60), unique=True, index=True)
    date_commande: Mapped[date | None] = mapped_column(Date, index=True)
    date_livraison_prevue: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(60), default="brouillon", index=True)
    total_ht: Mapped[float] = mapped_column(Float, default=0)
    tva: Mapped[float] = mapped_column(Float, default=0)
    total_ttc: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)


class LigneBonDeCommande(Base, TimestampMixin):
    __tablename__ = "lignes_bon_commande_achat"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    bon_commande_id: Mapped[int] = mapped_column(Integer, index=True)
    designation: Mapped[str] = mapped_column(String(220))
    reference: Mapped[str | None] = mapped_column(String(120))
    quantite: Mapped[float] = mapped_column(Float, default=1)
    unite: Mapped[str | None] = mapped_column(String(40))
    prix_unitaire_ht: Mapped[float] = mapped_column(Float, default=0)
    tva_pct: Mapped[float] = mapped_column(Float, default=0)
    total_ht: Mapped[float] = mapped_column(Float, default=0)
    total_ttc: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class ReceptionMarchandise(Base, TimestampMixin):
    __tablename__ = "receptions_marchandise"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    bon_commande_id: Mapped[int | None] = mapped_column(Integer, index=True)
    fournisseur_id: Mapped[int | None] = mapped_column(Integer, index=True)
    fournisseur_name: Mapped[str | None] = mapped_column(String(180), index=True)
    numero: Mapped[str | None] = mapped_column(String(60), unique=True, index=True)
    date_reception: Mapped[date | None] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(60), default="en_cours", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)


class LigneReception(Base, TimestampMixin):
    __tablename__ = "lignes_reception"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    reception_id: Mapped[int] = mapped_column(Integer, index=True)
    article_id: Mapped[int | None] = mapped_column(Integer, index=True)
    designation: Mapped[str] = mapped_column(String(220))
    reference: Mapped[str | None] = mapped_column(String(120))
    quantite_commandee: Mapped[float] = mapped_column(Float, default=0)
    quantite_recue: Mapped[float] = mapped_column(Float, default=0)
    unite: Mapped[str | None] = mapped_column(String(40))
    prix_unitaire: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class FactureFournisseur(Base, TimestampMixin):
    __tablename__ = "factures_fournisseur"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    fournisseur_id: Mapped[int | None] = mapped_column(Integer, index=True)
    fournisseur_name: Mapped[str | None] = mapped_column(String(180), index=True)
    bon_commande_id: Mapped[int | None] = mapped_column(Integer, index=True)
    reception_id: Mapped[int | None] = mapped_column(Integer, index=True)
    numero: Mapped[str | None] = mapped_column(String(60), unique=True, index=True)
    numero_fournisseur: Mapped[str | None] = mapped_column(String(120))
    date_facture: Mapped[date | None] = mapped_column(Date, index=True)
    date_echeance: Mapped[date | None] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(60), default="en_attente", index=True)
    total_ht: Mapped[float] = mapped_column(Float, default=0)
    tva: Mapped[float] = mapped_column(Float, default=0)
    total_ttc: Mapped[float] = mapped_column(Float, default=0)
    montant_paye: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)
