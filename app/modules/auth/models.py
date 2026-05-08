from sqlalchemy import Boolean, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(150), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(150))
    role: Mapped[str] = mapped_column(String(40), default="admin", index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)



class AccessRule(Base, TimestampMixin):
    __tablename__ = "access_rules"
    __table_args__ = (UniqueConstraint("module_key", "role", name="uq_access_rules_module_role"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    module_key: Mapped[str] = mapped_column(String(80), index=True)
    role: Mapped[str] = mapped_column(String(40), index=True)
    allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
