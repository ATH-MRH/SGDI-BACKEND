from datetime import date

from sqlalchemy import Date, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Devis(Base, TimestampMixin):
    __tablename__ = "devis"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    client_id: Mapped[int | None] = mapped_column(Integer, index=True)
    client_name: Mapped[str | None] = mapped_column(String(180), index=True)
    numero: Mapped[str | None] = mapped_column(String(60), unique=True, index=True)
    date_devis: Mapped[date | None] = mapped_column(Date, index=True)
    date_validite: Mapped[date | None] = mapped_column(Date)
    objet: Mapped[str | None] = mapped_column(String(220))
    status: Mapped[str] = mapped_column(String(60), default="brouillon", index=True)
    total_ht: Mapped[float] = mapped_column(Float, default=0)
    tva: Mapped[float] = mapped_column(Float, default=0)
    total_ttc: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)


class LigneDevis(Base, TimestampMixin):
    __tablename__ = "lignes_devis"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    devis_id: Mapped[int] = mapped_column(Integer, index=True)
    designation: Mapped[str] = mapped_column(String(220))
    reference: Mapped[str | None] = mapped_column(String(120))
    quantite: Mapped[float] = mapped_column(Float, default=1)
    unite: Mapped[str | None] = mapped_column(String(40))
    prix_unitaire_ht: Mapped[float] = mapped_column(Float, default=0)
    tva_pct: Mapped[float] = mapped_column(Float, default=0)
    total_ht: Mapped[float] = mapped_column(Float, default=0)
    total_ttc: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class CommandeClient(Base, TimestampMixin):
    __tablename__ = "commandes_client"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    client_id: Mapped[int | None] = mapped_column(Integer, index=True)
    client_name: Mapped[str | None] = mapped_column(String(180), index=True)
    devis_id: Mapped[int | None] = mapped_column(Integer, index=True)
    numero: Mapped[str | None] = mapped_column(String(60), unique=True, index=True)
    date_commande: Mapped[date | None] = mapped_column(Date, index=True)
    date_livraison_prevue: Mapped[date | None] = mapped_column(Date)
    objet: Mapped[str | None] = mapped_column(String(220))
    status: Mapped[str] = mapped_column(String(60), default="brouillon", index=True)
    total_ht: Mapped[float] = mapped_column(Float, default=0)
    tva: Mapped[float] = mapped_column(Float, default=0)
    total_ttc: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)


class LigneCommandeClient(Base, TimestampMixin):
    __tablename__ = "lignes_commande_client"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    commande_id: Mapped[int] = mapped_column(Integer, index=True)
    designation: Mapped[str] = mapped_column(String(220))
    reference: Mapped[str | None] = mapped_column(String(120))
    quantite: Mapped[float] = mapped_column(Float, default=1)
    unite: Mapped[str | None] = mapped_column(String(40))
    prix_unitaire_ht: Mapped[float] = mapped_column(Float, default=0)
    tva_pct: Mapped[float] = mapped_column(Float, default=0)
    total_ht: Mapped[float] = mapped_column(Float, default=0)
    total_ttc: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class BonDeLivraison(Base, TimestampMixin):
    __tablename__ = "bons_livraison"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    commande_id: Mapped[int | None] = mapped_column(Integer, index=True)
    client_id: Mapped[int | None] = mapped_column(Integer, index=True)
    client_name: Mapped[str | None] = mapped_column(String(180), index=True)
    numero: Mapped[str | None] = mapped_column(String(60), unique=True, index=True)
    date_livraison: Mapped[date | None] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(60), default="brouillon", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)


class LigneBonDeLivraison(Base, TimestampMixin):
    __tablename__ = "lignes_bon_livraison"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    bl_id: Mapped[int] = mapped_column(Integer, index=True)
    designation: Mapped[str] = mapped_column(String(220))
    reference: Mapped[str | None] = mapped_column(String(120))
    quantite_commandee: Mapped[float] = mapped_column(Float, default=0)
    quantite_livree: Mapped[float] = mapped_column(Float, default=0)
    unite: Mapped[str | None] = mapped_column(String(40))
    notes: Mapped[str | None] = mapped_column(Text)
