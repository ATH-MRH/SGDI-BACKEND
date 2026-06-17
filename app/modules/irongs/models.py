from sqlalchemy import Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Position(Base):
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, index=True)


class SgdiRecord(Base, TimestampMixin):
    __tablename__ = "sgdi_records"
    __table_args__ = (UniqueConstraint("collection", "item_id", name="uq_sgdi_records_collection_item"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    collection: Mapped[str] = mapped_column(String(80), index=True)
    item_id: Mapped[str] = mapped_column(String(160), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(20), default="item", index=True)
    data: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)
    label: Mapped[str | None] = mapped_column(Text)
