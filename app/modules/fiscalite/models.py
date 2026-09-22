"""Fiscalité Algérie (P2) — un moteur de CALENDRIER et de suivi d'obligations, PAS un
moteur qui invente le droit fiscal (mission explicite) : le montant dû est saisi par
l'utilisateur (issu de son propre calcul/déclaration vérifiée), jamais calculé ici à partir
d'un barème non prouvé. regulatory_version_id est optionnel — renseigné seulement quand une
RegulatoryVersion vérifiée existe réellement pour cette obligation (traçabilité de la règle
appliquée quand elle est connue)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

MONEY = Numeric(18, 2)
OBLIGATION_TYPES = ("g50_tva", "g50_irg_retenue", "ibs", "cnas_echeance", "autre")
STATUSES = ("pending", "declared", "paid", "late")


class FiscalObligation(Base, TimestampMixin):
    __tablename__ = "fiscal_obligations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    obligation_type: Mapped[str] = mapped_column(String(30), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM"
    base_calcul: Mapped[Decimal | None] = mapped_column(MONEY)
    montant: Mapped[Decimal] = mapped_column(MONEY)
    echeance: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    regulatory_version_id: Mapped[int | None] = mapped_column(ForeignKey("regulatory_versions.id", ondelete="SET NULL"))
    financial_obligation_id: Mapped[int | None] = mapped_column(Integer)  # FK logique -> financial_obligations
    proof_reference: Mapped[str | None] = mapped_column(Text)  # référence de déclaration / preuve
    declared_by: Mapped[str | None] = mapped_column(String(120))
    declared_at: Mapped[datetime | None] = mapped_column(DateTime)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)
