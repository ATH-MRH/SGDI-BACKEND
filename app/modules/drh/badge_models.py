"""Studio Badges DRH — modèles de badge, badges émis, historique et paramètres.

La fiche employé reste la seule source de vérité de l'identité : un badge émis en garde un
INSTANTANÉ (identité, site, fonction, photo, maquette) figé à l'émission, pour qu'une
réimpression reproduise exactement le badge remis, même si la fiche a changé depuis.
"""
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, JSON, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

STATUS_ACTIVE = "ACTIF"
STATUS_REVOKED = "REVOQUE"
STATUS_REPLACED = "REMPLACE"
BADGE_STATUSES = (STATUS_ACTIVE, STATUS_REVOKED, STATUS_REPLACED)


class BadgeTemplate(Base, TimestampMixin):
    __tablename__ = "badge_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # NULL = modèle commun à toutes les sociétés.
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    width_mm: Mapped[float] = mapped_column(Float, nullable=False)
    height_mm: Mapped[float] = mapped_column(Float, nullable=False)
    design: Mapped[dict] = mapped_column(JSON, nullable=False)
    is_default: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_system: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Renseignée uniquement pour un modèle système : l'unicité empêche deux créations simultanées.
    system_key: Mapped[str | None] = mapped_column(String(40), unique=True)
    active: Mapped[int] = mapped_column(Integer, default=1, nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(80))
    updated_by: Mapped[str | None] = mapped_column(String(80))


class EmployeeBadge(Base, TimestampMixin):
    __tablename__ = "employee_badges"
    __table_args__ = (
        Index("ix_employee_badges_employee_status", "employee_id", "status"),
        Index("ix_employee_badges_society_status", "society", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str | None] = mapped_column(String(40), unique=True)
    # SET NULL : supprimer une fiche ne détruit pas l'historique des badges remis.
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("badge_templates.id", ondelete="SET NULL"))
    template_name: Mapped[str | None] = mapped_column(String(150))
    society: Mapped[str | None] = mapped_column(String(150))
    status: Mapped[str] = mapped_column(String(20), default=STATUS_ACTIVE, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    design: Mapped[dict] = mapped_column(JSON, nullable=False)
    width_mm: Mapped[float] = mapped_column(Float, nullable=False)
    height_mm: Mapped[float] = mapped_column(Float, nullable=False)
    photo: Mapped[bytes | None] = mapped_column(LargeBinary)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    issued_by: Mapped[str | None] = mapped_column(String(80))
    valid_until: Mapped[date | None] = mapped_column(Date)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    revoked_by: Mapped[str | None] = mapped_column(String(80))
    revoke_reason: Mapped[str | None] = mapped_column(Text)
    print_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_printed_at: Mapped[datetime | None] = mapped_column(DateTime)


class BadgeEvent(Base):
    __tablename__ = "badge_events"
    __table_args__ = (Index("ix_badge_events_society_created", "society", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    badge_id: Mapped[int | None] = mapped_column(ForeignKey("employee_badges.id", ondelete="SET NULL"), index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("badge_templates.id", ondelete="SET NULL"))
    society: Mapped[str | None] = mapped_column(String(150))
    user_id: Mapped[int | None] = mapped_column(Integer)
    username: Mapped[str | None] = mapped_column(String(80))
    label: Mapped[str | None] = mapped_column(String(300))
    details: Mapped[dict | None] = mapped_column(JSON)


class BadgeSettings(Base, TimestampMixin):
    __tablename__ = "badge_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    # "*" = réglages communs ; sinon le nom de la société.
    scope: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, default="*")
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(80))
