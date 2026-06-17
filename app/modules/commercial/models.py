from datetime import date

from sqlalchemy import Date, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Client(Base, TimestampMixin):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    legal_name: Mapped[str | None] = mapped_column(String(220), index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    structure: Mapped[str | None] = mapped_column(String(120), index=True)
    status: Mapped[str] = mapped_column(String(60), default="actif", index=True)
    contact_name: Mapped[str | None] = mapped_column(String(180))
    contact_position: Mapped[str | None] = mapped_column(String(140))
    phone: Mapped[str | None] = mapped_column(String(60))
    email: Mapped[str | None] = mapped_column(String(180))
    address: Mapped[str | None] = mapped_column(Text)
    nif: Mapped[str | None] = mapped_column(String(100))
    rc: Mapped[str | None] = mapped_column(String(100))
    services: Mapped[str | None] = mapped_column(Text)
    contract_start: Mapped[date | None] = mapped_column(Date)
    contract_duration: Mapped[str | None] = mapped_column(String(80))
    contract_end: Mapped[date | None] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)
