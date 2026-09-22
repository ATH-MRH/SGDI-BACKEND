"""Référentiel réglementaire versionné (Paie + Fiscalité). AUCUN taux/barème en dur dans le
code de calcul (payroll/fiscalite) : tout passe par ici, avec source + version + période de
validité. reliability="unverified" est le défaut de TOUTE donnée saisie sans preuve
documentaire vérifiée — le moteur de calcul (payroll.service) REFUSE d'utiliser une règle
"unverified" sauf si l'appelant le demande explicitement (allow_unverified=True), pour
qu'un calcul de paie réel ne s'appuie jamais silencieusement sur un taux d'exemple."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

RELIABILITY = ("verified", "unverified")
RULE_STATUSES = ("draft", "active", "superseded", "unverified")
PROPOSAL_STATUSES = ("proposed", "approved", "rejected")


class RegulatorySource(Base, TimestampMixin):
    __tablename__ = "regulatory_sources"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(220))
    reference: Mapped[str | None] = mapped_column(String(255))  # n° JO, URL, référence texte
    reliability: Mapped[str] = mapped_column(String(20), default="unverified", index=True)
    notes: Mapped[str | None] = mapped_column(Text)


class RegulatoryRule(Base, TimestampMixin):
    """Une règle NOMMÉE (ex. "irg_bareme", "cnas_taux_salarial") — les valeurs réelles
    vivent dans RegulatoryVersion, jamais ici (une règle a plusieurs versions dans le
    temps)."""

    __tablename__ = "regulatory_rules"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    rule_type: Mapped[str] = mapped_column(String(60), index=True)  # irg_bareme|cnas_taux|ibs_taux|g50_declaration|...
    society: Mapped[str | None] = mapped_column(String(150), index=True)  # NULL = règle nationale
    label: Mapped[str] = mapped_column(String(220))
    notes: Mapped[str | None] = mapped_column(Text)


class RegulatoryVersion(Base, TimestampMixin):
    """Une version = les valeurs réellement applicables sur [effective_from, effective_to).
    effective_to NULL = toujours en vigueur. JAMAIS de recalcul rétroactif silencieux :
    payroll.service::get_applicable_version(as_of_date) cherche la version dont la fenêtre
    couvre CETTE date précise, pas "la plus récente"."""

    __tablename__ = "regulatory_versions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("regulatory_rules.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    parameters: Mapped[dict] = mapped_column(JSON)  # forme libre selon rule_type (barème, taux, plafond...)
    effective_from: Mapped[date] = mapped_column(Date, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, index=True)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("regulatory_sources.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="unverified", index=True)

    __table_args__ = (Index("ix_regulatory_versions_rule_window", "rule_id", "effective_from", "effective_to"),)


class RegulatoryChangeProposal(Base, TimestampMixin):
    """Une instruction détectée (veille manuelle ou future veille externe) devient une
    PROPOSITION — jamais une modification directe. Un humain approuve (-> crée la
    RegulatoryVersion réelle) ou rejette. C'est la SEULE porte d'entrée pour faire évoluer
    une règle — aucun chemin de code n'écrit directement dans RegulatoryVersion sans passer
    par une proposition approuvée (voir service.approve_proposal)."""

    __tablename__ = "regulatory_change_proposals"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("regulatory_rules.id", ondelete="SET NULL"))
    proposed_parameters: Mapped[dict] = mapped_column(JSON)
    proposed_effective_from: Mapped[date] = mapped_column(Date)
    diff_summary: Mapped[str | None] = mapped_column(Text)
    detected_from: Mapped[str] = mapped_column(String(40), default="manual")  # manual | external_watch (non implémenté)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("regulatory_sources.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="proposed", index=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(120))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    resulting_version_id: Mapped[int | None] = mapped_column(ForeignKey("regulatory_versions.id", ondelete="SET NULL"))
