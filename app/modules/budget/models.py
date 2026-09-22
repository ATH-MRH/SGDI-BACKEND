"""Budget versionné (P2). Workflow draft -> submitted -> approved -> locked : une fois
"locked", plus aucune modification (une révision crée une NOUVELLE ligne liée par
`revises_id`, jamais un écrasement)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

MONEY = Numeric(18, 2)
STATUSES = ("draft", "submitted", "approved", "locked", "rejected")


class BudgetLine(Base, TimestampMixin):
    __tablename__ = "budget_lines"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM"
    centre_cout: Mapped[str | None] = mapped_column(String(120), index=True)
    contrat: Mapped[str | None] = mapped_column(String(120), index=True)
    client: Mapped[str | None] = mapped_column(String(180), index=True)
    site: Mapped[str | None] = mapped_column(String(150), index=True)
    compte: Mapped[str | None] = mapped_column(String(20), index=True)  # n° compte PCN (traçabilité vers accounting)
    montant_budgete: Mapped[Decimal] = mapped_column(MONEY)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    revises_id: Mapped[int | None] = mapped_column(ForeignKey("budget_lines.id", ondelete="SET NULL"))
    created_by: Mapped[str | None] = mapped_column(String(120))
    approved_by: Mapped[str | None] = mapped_column(String(120))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
