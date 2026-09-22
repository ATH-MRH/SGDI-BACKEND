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
# Revue d'intégrité, item 12 (fiscalité) : la mission exige que CHAQUE montant expose sa
# provenance de façon non ambiguë. regulatory_version_id (nullable) portait déjà cette
# information de façon IMPLICITE (présent = calculé depuis une règle vérifiée, absent =
# saisie manuelle) mais rien ne l'exposait explicitement, et rien ne validait que la version
# référencée était réellement "active" (vérifiée) — un appelant pouvait passer n'importe quel
# id sans contrôle. PROVENANCE_MANUAL : montant saisi par l'utilisateur (le seul mode
# actuellement possible pour G50/TVA/IBS — AUCUN calcul automatique n'existe, exigence
# explicite de la mission, non implémentée délibérément). PROVENANCE_CALCULATED_VERIFIED :
# montant dérivé d'une RegulatoryVersion "active" (vérifiée) — actuellement inatteignable
# depuis la simple saisie de `montant`, réservé à un futur moteur de calcul qui n'existe pas
# encore (dette documentée, item 15).
PROVENANCE_MANUAL = "manual"
PROVENANCE_CALCULATED_VERIFIED = "calculated_verified"
PROVENANCES = (PROVENANCE_MANUAL, PROVENANCE_CALCULATED_VERIFIED)


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
    provenance: Mapped[str] = mapped_column(String(30), default=PROVENANCE_MANUAL, server_default=PROVENANCE_MANUAL)
    financial_obligation_id: Mapped[int | None] = mapped_column(Integer)  # FK logique -> financial_obligations
    proof_reference: Mapped[str | None] = mapped_column(Text)  # référence de déclaration / preuve
    declared_by: Mapped[str | None] = mapped_column(String(120))
    declared_at: Mapped[datetime | None] = mapped_column(DateTime)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)
