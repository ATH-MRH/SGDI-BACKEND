"""ATLAS Reconciliation Engine (P1-F) — rapprochement transaction bancaire ↔ obligation
financière. Supporte 1↔1, 1↔N (une transaction règle plusieurs obligations) et N↔1
(plusieurs transactions règlent une obligation) via ReconciliationCase comme pivot : un cas
regroupe 1+ transactions et 1+ obligations, avec le détail exact des montants imputés porté
par ReconciliationMatch (une ligne par paire transaction×obligation).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

MONEY = Numeric(18, 2)

CASE_STATUSES = ("proposed", "confirmed", "rejected")


class ReconciliationCase(Base, TimestampMixin):
    """Un cas = une proposition de rapprochement (score de confiance + explication), qui
    reste "proposed" tant qu'un humain ne l'a pas confirmé (jamais de règlement automatique
    silencieux — voir service.py::confirm_case, qui est le SEUL chemin créant un Settlement).
    """

    __tablename__ = "reconciliation_cases"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # "1:1" | "1:N" | "N:1"
    status: Mapped[str] = mapped_column(String(20), default="proposed", index=True)
    confidence_score: Mapped[int] = mapped_column(Integer, default=0)  # 0-100
    explanation: Mapped[str | None] = mapped_column(Text)
    total_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    confirmed_by: Mapped[str | None] = mapped_column(String(120))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    rejected_reason: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)

    __table_args__ = (Index("ix_reconciliation_cases_society_status", "society", "status"),)


class ReconciliationMatch(Base, TimestampMixin):
    """Une ligne d'imputation : (transaction bancaire, obligation, montant imputé) au sein
    d'un ReconciliationCase. Le même transaction_id peut apparaître dans plusieurs lignes
    (cas 1:N), la même obligation_id peut apparaître dans plusieurs lignes (cas N:1)."""

    __tablename__ = "reconciliation_matches"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("reconciliation_cases.id", ondelete="CASCADE"), index=True)
    bank_transaction_id: Mapped[int] = mapped_column(Integer, index=True)
    obligation_id: Mapped[int] = mapped_column(Integer, index=True)
    amount_imputed: Mapped[Decimal] = mapped_column(MONEY)
    settlement_id: Mapped[int | None] = mapped_column(Integer)  # renseigné après confirmation


class ReconciliationRule(Base, TimestampMixin):
    """Règle automatique simple (P0/P1 : matching exact référence, ou tolérance montant+date)
    — appliquée par le moteur AVANT le scoring générique, pour les cas déterministes (ex. la
    référence de virement contient exactement le numéro de facture)."""

    __tablename__ = "reconciliation_rules"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    name: Mapped[str] = mapped_column(String(120))
    rule_type: Mapped[str] = mapped_column(String(40))  # "exact_reference" | "amount_date_tolerance"
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[int] = mapped_column(Integer, default=1)


class BankingException(Base, TimestampMixin):
    """File d'exception : transactions non rapprochées après passage du moteur (aucune
    proposition suffisamment fiable) — ce que l'audit appelle "exception inbox"."""

    __tablename__ = "banking_exceptions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    bank_transaction_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    reason: Mapped[str] = mapped_column(String(255))
    resolved: Mapped[int] = mapped_column(Integer, default=0, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
