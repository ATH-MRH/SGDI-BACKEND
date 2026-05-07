from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class IrongsCollection(Base, TimestampMixin):
    __tablename__ = "irongs_collections"

    name: Mapped[str] = mapped_column(String(80), primary_key=True, index=True)
    data: Mapped[list | dict] = mapped_column(JSON, default=list)

