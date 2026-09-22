"""Paie typée (P1-A). Ne duplique PAS Finance Core : un bulletin validé crée des
FinancialObligation (payable) — paiement/rapprochement/comptabilité passent ENSUITE par les
mécanismes Finance Core déjà existants (settle_obligation, accounting_bridge,
reconciliation), jamais une seconde implémentation.

Aucun taux/barème en dur ici — payroll.service lit exclusivement
app.modules.regulatory.service.get_applicable_version()."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

MONEY = Numeric(18, 2)


class SalaryGrid(Base, TimestampMixin):
    """Versionnée comme le référentiel réglementaire : une grille passée reste consultable
    et n'est jamais modifiée après coup — une évolution de salaire de base pour un poste crée
    une NOUVELLE version (effective_from), l'ancienne se ferme (effective_to)."""

    __tablename__ = "salary_grids"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    poste: Mapped[str] = mapped_column(String(150), index=True)
    categorie: Mapped[str | None] = mapped_column(String(60))
    niveau: Mapped[str | None] = mapped_column(String(60))
    salaire_base: Mapped[Decimal] = mapped_column(MONEY)
    primes_fixes: Mapped[list] = mapped_column(JSON, default=list)  # [{"label":.., "montant":..}]
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    effective_from: Mapped[date] = mapped_column(Date, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)


class PayrollRun(Base, TimestampMixin):
    """Un cycle de paie pour une société+période (ex. "2026-09"). Regroupe les bulletins ;
    valider le run ne fait QUE marquer son statut — chaque bulletin est validé
    individuellement (validate_slip), le run "validated" signifie "tous ses bulletins le
    sont"."""

    __tablename__ = "payroll_runs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM"
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)  # draft|validated|paid|cancelled
    created_by: Mapped[str | None] = mapped_column(String(120))
    validated_by: Mapped[str | None] = mapped_column(String(120))
    validated_at: Mapped[datetime | None] = mapped_column(DateTime)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)

    __table_args__ = (Index("ix_payroll_runs_society_period", "society", "period", unique=True),)


class PayrollSlip(Base, TimestampMixin):
    """IMMUABLE après validation (status="validated") : payroll.service::validate_slip est
    le SEUL chemin qui fige un bulletin, et aucune fonction de service n'autorise plus une
    modification de ses montants une fois validé — recalculer signifierait créer un NOUVEAU
    bulletin (avenant/rectificatif), jamais écraser l'original (intégrité P0-A)."""

    __tablename__ = "payroll_slips"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    payroll_run_id: Mapped[int] = mapped_column(ForeignKey("payroll_runs.id", ondelete="CASCADE"), index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"), index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    salary_grid_id: Mapped[int | None] = mapped_column(ForeignKey("salary_grids.id", ondelete="SET NULL"))

    inputs: Mapped[dict] = mapped_column(JSON)  # jours travaillés/absences/heures sup/primes variables (traçabilité)
    rules_used: Mapped[dict] = mapped_column(JSON)  # {"cnas_taux_salarial": {"version_id":.., "status":..}, "irg_bareme": {...}}

    base: Mapped[Decimal] = mapped_column(MONEY)
    brut: Mapped[Decimal] = mapped_column(MONEY)
    cotisation_salariale: Mapped[Decimal] = mapped_column(MONEY, default=0)
    cotisation_patronale: Mapped[Decimal] = mapped_column(MONEY, default=0)
    imposable: Mapped[Decimal] = mapped_column(MONEY, default=0)
    irg: Mapped[Decimal] = mapped_column(MONEY, default=0)
    autres_retenues: Mapped[Decimal] = mapped_column(MONEY, default=0)
    net: Mapped[Decimal] = mapped_column(MONEY, default=0)
    net_a_payer: Mapped[Decimal] = mapped_column(MONEY, default=0)

    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)  # draft|validated|cancelled
    obligation_id: Mapped[int | None] = mapped_column(Integer)  # FK logique -> financial_obligations (net à payer)
    cnas_obligation_id: Mapped[int | None] = mapped_column(Integer)  # FK logique -> financial_obligations (charges sociales)
    irg_obligation_id: Mapped[int | None] = mapped_column(Integer)  # FK logique -> financial_obligations (retenue IRG)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)

    __table_args__ = (Index("ix_payroll_slips_run_employee", "payroll_run_id", "employee_id", unique=True),)
