from datetime import date

from sqlalchemy import Date, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class CompteComptable(Base, TimestampMixin):
    __tablename__ = "comptes_comptables"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    numero: Mapped[str] = mapped_column(String(20), index=True)
    libelle: Mapped[str] = mapped_column(String(220))
    type_compte: Mapped[str | None] = mapped_column(String(60), index=True)
    parent_numero: Mapped[str | None] = mapped_column(String(20), index=True)
    notes: Mapped[str | None] = mapped_column(Text)


class EcritureComptable(Base, TimestampMixin):
    __tablename__ = "ecritures_comptables"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    numero_piece: Mapped[str | None] = mapped_column(String(60), unique=True, index=True)
    date_ecriture: Mapped[date | None] = mapped_column(Date, index=True)
    libelle: Mapped[str | None] = mapped_column(String(220))
    journal: Mapped[str | None] = mapped_column(String(20), index=True)
    ref_externe: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(40), default="brouillon", index=True)
    total_debit: Mapped[float] = mapped_column(Float, default=0)
    total_credit: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class LigneEcriture(Base, TimestampMixin):
    __tablename__ = "lignes_ecriture"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    ecriture_id: Mapped[int] = mapped_column(Integer, index=True)
    compte_numero: Mapped[str] = mapped_column(String(20))
    libelle: Mapped[str | None] = mapped_column(String(220))
    debit: Mapped[float] = mapped_column(Float, default=0)
    credit: Mapped[float] = mapped_column(Float, default=0)
