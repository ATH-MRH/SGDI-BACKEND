"""ATLAS Banking Core (P1-D) — comptes bancaires, relevés importés, transactions.

Pipeline RAW → NORMALIZED → ENRICHED explicite (BankTransaction.stage) : une transaction
importée existe d'abord telle que lue du fichier source (raw_payload, jamais modifié après
import — c'est la preuve d'audit de ce qui a réellement été livré par la banque), puis
normalisée (montant en Decimal signé, date ISO, libellé nettoyé) puis enrichie (rapprochée à
une obligation via le moteur de reconciliation — statut porté ici en miroir pour affichage
rapide, la source de vérité du rapprochement reste app.modules.reconciliation).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

MONEY = Numeric(18, 2)

IMPORT_FORMATS = ("csv", "xlsx", "camt053", "mt940", "pdf_ocr")
TRANSACTION_STAGES = ("raw", "normalized", "enriched")
RECONCILE_STATUSES = ("unmatched", "proposed", "matched", "ignored")


class BankAccount(Base, TimestampMixin):
    __tablename__ = "bank_accounts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    bank_name: Mapped[str] = mapped_column(String(150))
    account_number: Mapped[str] = mapped_column(String(80), index=True)
    iban: Mapped[str | None] = mapped_column(String(40))
    currency: Mapped[str] = mapped_column(String(3), default="DZD")
    label: Mapped[str | None] = mapped_column(String(180))
    active: Mapped[int] = mapped_column(Integer, default=1)

    __table_args__ = (Index("ix_bank_accounts_society_number", "society", "account_number", unique=True),)


class BankStatement(Base, TimestampMixin):
    """Un import = un relevé (ou un lot d'export banque). Conserve le fichier source encodé
    (raw_content_b64) — jamais recalculé après coup, seule façon de re-vérifier un import
    litigieux plus tard. closed=1 verrouille le relevé contre toute réimportation/suppression
    de ses transactions (P1-H clôture, appliquée ici à l'échelle du relevé)."""

    __tablename__ = "bank_statements"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    bank_account_id: Mapped[int] = mapped_column(ForeignKey("bank_accounts.id", ondelete="CASCADE"), index=True)
    import_format: Mapped[str] = mapped_column(String(20), index=True)
    file_name: Mapped[str | None] = mapped_column(String(255))
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    opening_balance: Mapped[Decimal | None] = mapped_column(MONEY)
    closing_balance: Mapped[Decimal | None] = mapped_column(MONEY)
    computed_balance_check: Mapped[str | None] = mapped_column(String(20))  # "ok" | "mismatch" | "n/a"
    transaction_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    closed: Mapped[int] = mapped_column(Integer, default=0, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)


class BankStatementPage(Base, TimestampMixin):
    """Une page/segment d'un relevé importé — utile pour les formats multi-pages (PDF OCR,
    exports paginés) ; pour un CSV/XLSX simple, un relevé n'a qu'une seule page."""

    __tablename__ = "bank_statement_pages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    bank_statement_id: Mapped[int] = mapped_column(ForeignKey("bank_statements.id", ondelete="CASCADE"), index=True)
    page_number: Mapped[int] = mapped_column(Integer, default=1)
    raw_text: Mapped[str | None] = mapped_column(Text)


class BankTransaction(Base, TimestampMixin):
    __tablename__ = "bank_transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    bank_account_id: Mapped[int] = mapped_column(ForeignKey("bank_accounts.id", ondelete="CASCADE"), index=True)
    bank_statement_id: Mapped[int] = mapped_column(ForeignKey("bank_statements.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(20), default="raw", index=True)
    value_date: Mapped[date | None] = mapped_column(Date, index=True)
    booking_date: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(MONEY)  # signé : positif = crédit, négatif = débit
    label: Mapped[str | None] = mapped_column(String(255))
    reference: Mapped[str | None] = mapped_column(String(160), index=True)
    raw_payload: Mapped[dict] = mapped_column(JSON)
    dedup_hash: Mapped[str] = mapped_column(String(64), index=True)
    reconcile_status: Mapped[str] = mapped_column(String(20), default="unmatched", index=True)

    __table_args__ = (
        Index("ix_bank_transactions_account_dedup", "bank_account_id", "dedup_hash", unique=True),
    )
