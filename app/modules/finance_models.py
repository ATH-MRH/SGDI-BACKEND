from datetime import date

from sqlalchemy import Date, Float, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(120), unique=True, index=True)
    number: Mapped[str | None] = mapped_column(String(120), unique=True, index=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    client_name: Mapped[str | None] = mapped_column(String(180), index=True)
    subject: Mapped[str | None] = mapped_column(String(220))
    status: Mapped[str | None] = mapped_column(String(60), index=True)
    total_ht: Mapped[float] = mapped_column(Float, default=0)
    total_ttc: Mapped[float] = mapped_column(Float, default=0)
    data: Mapped[dict | None] = mapped_column(JSON)


class Payment(Base, TimestampMixin):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(120), unique=True, index=True)
    invoice_external_id: Mapped[str | None] = mapped_column(String(120), index=True)
    payment_date: Mapped[date | None] = mapped_column(Date, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    client_name: Mapped[str | None] = mapped_column(String(180), index=True)
    payment_mode: Mapped[str | None] = mapped_column(String(80))
    reference: Mapped[str | None] = mapped_column(String(120))
    amount: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)


class Advance(Base, TimestampMixin):
    __tablename__ = "advances"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(120), unique=True, index=True)
    advance_date: Mapped[date | None] = mapped_column(Date, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    beneficiary: Mapped[str | None] = mapped_column(String(180), index=True)
    amount: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str | None] = mapped_column(String(60), index=True)
    data: Mapped[dict | None] = mapped_column(JSON)


class CreditNote(Base, TimestampMixin):
    __tablename__ = "credit_notes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(120), unique=True, index=True)
    invoice_external_id: Mapped[str | None] = mapped_column(String(120), index=True)
    credit_date: Mapped[date | None] = mapped_column(Date, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    client_name: Mapped[str | None] = mapped_column(String(180), index=True)
    amount: Mapped[float] = mapped_column(Float, default=0)
    reason: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)


class CashEntry(Base, TimestampMixin):
    __tablename__ = "cash_entries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(120), unique=True, index=True)
    entry_date: Mapped[date | None] = mapped_column(Date, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    category: Mapped[str | None] = mapped_column(String(120), index=True)
    label: Mapped[str | None] = mapped_column(String(220))
    amount: Mapped[float] = mapped_column(Float, default=0)
    entry_type: Mapped[str | None] = mapped_column(String(60), index=True)
    data: Mapped[dict | None] = mapped_column(JSON)
