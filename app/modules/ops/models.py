from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Site(Base, TimestampMixin):
    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    indicatif: Mapped[str | None] = mapped_column(String(50), index=True)
    client_name: Mapped[str | None] = mapped_column(String(180))
    # Lien fiable vers commercial.Client (client_name ci-dessus reste un texte libre non
    # fiabilisé, jamais recoupé — ne pas s'y fier pour dériver la visibilité du portail
    # client). Nullable : un site sans client_id reste simplement invisible depuis tout
    # portail client, sans backfill forcé.
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    address: Mapped[str | None] = mapped_column(Text)
    commune: Mapped[str | None] = mapped_column(String(120))
    wilaya: Mapped[str | None] = mapped_column(String(120))
    site_type: Mapped[str | None] = mapped_column(String(120))
    rotation_system: Mapped[str | None] = mapped_column(String(40))
    contractual_staff: Mapped[int] = mapped_column(Integer, default=0)
    day_staff: Mapped[int] = mapped_column(Integer, default=0)
    night_staff: Mapped[int] = mapped_column(Integer, default=0)
    weekend_staff: Mapped[int] = mapped_column(Integer, default=0)
    holiday_staff: Mapped[int] = mapped_column(Integer, default=0)
    groups_count: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[int] = mapped_column(Integer, default=1)
    equipment_plan: Mapped[dict | None] = mapped_column(JSON)


class SitePost(Base, TimestampMixin):
    __tablename__ = "site_posts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    day_count: Mapped[int] = mapped_column(Integer, default=0)
    night_count: Mapped[int] = mapped_column(Integer, default=0)
    rotation_system: Mapped[str | None] = mapped_column(String(40))
    total_count: Mapped[int] = mapped_column(Integer, default=0)


class RotationTemplate(Base, TimestampMixin):
    __tablename__ = "rotation_templates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    cycle_length: Mapped[int] = mapped_column(Integer, default=7)
    cycle_days: Mapped[list | None] = mapped_column(JSON)
    group_offsets: Mapped[dict | None] = mapped_column(JSON)
    active: Mapped[int] = mapped_column(Integer, default=1)
    # Modèle OFFICIEL du travail posté (app/modules/attendance/official.py) : cycle ancré par site
    # (SiteRotation.start_date), jamais par date d'affectation ; non modifiable par l'écran OPS.
    official: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)


class SiteRotation(Base, TimestampMixin):
    __tablename__ = "site_rotations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    rotation_id: Mapped[int] = mapped_column(ForeignKey("rotation_templates.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date] = mapped_column(Date, index=True)
    end_date: Mapped[date | None] = mapped_column(Date, index=True)
    active: Mapped[int] = mapped_column(Integer, default=1)


class Assignment(Base, TimestampMixin):
    __tablename__ = "assignments"
    __table_args__ = (
        CheckConstraint("work_regime IS NULL OR work_regime IN ('NORMAL', 'POSTE_CONTINU')", name="ck_assignments_work_regime"),
        # Travail posté : groupe et modèle officiel toujours explicites (jamais un « A » par défaut).
        CheckConstraint("work_regime IS NULL OR work_regime <> 'POSTE_CONTINU' "
                        "OR (group_code IN ('A', 'B', 'C', 'D') AND rotation_id IS NOT NULL)",
                        name="ck_assignments_posted_explicit"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    rotation_id: Mapped[int | None] = mapped_column(ForeignKey("rotation_templates.id", ondelete="SET NULL"), index=True)
    group_code: Mapped[str] = mapped_column(String(20), default="A", index=True)
    position: Mapped[str | None] = mapped_column(String(150))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    change_reason: Mapped[str | None] = mapped_column(Text)
    active: Mapped[int] = mapped_column(Integer, default=1)
    # Régime de travail EXPLICITE (NORMAL / POSTE_CONTINU). NULL = affectation historique :
    # comportement inchangé, jamais déduit de group_code ni de Site.rotation_system.
    work_regime: Mapped[str | None] = mapped_column(String(20), index=True)


class DailyPresence(Base, TimestampMixin):
    __tablename__ = "daily_presence"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    presence_date: Mapped[date] = mapped_column(Date, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), index=True)
    group_code: Mapped[str | None] = mapped_column(String(20))
    arrival_time: Mapped[str | None] = mapped_column(String(10))
    departure_time: Mapped[str | None] = mapped_column(String(10))
    relief_time: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(30), default="present")
    generated: Mapped[int] = mapped_column(Integer, default=0)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    notes: Mapped[str | None] = mapped_column(Text)
    rotation_system: Mapped[str | None] = mapped_column(String(40))
    rotation_group: Mapped[str | None] = mapped_column(String(20), index=True)
    rotation_period: Mapped[str | None] = mapped_column(String(20), index=True)
    faction: Mapped[str | None] = mapped_column(String(40), index=True)
    recovery: Mapped[int] = mapped_column(Integer, default=0)
    standby: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[dict | None] = mapped_column(JSON)


class Event(Base, TimestampMixin):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    event_type: Mapped[str] = mapped_column(String(80), default="autre")
    level: Mapped[str] = mapped_column(String(40), default="normal")
    title: Mapped[str] = mapped_column(String(180))
    message: Mapped[str] = mapped_column(Text)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(40), default="ouvert", index=True)
    action_taken: Mapped[str | None] = mapped_column(Text)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)


class OpsMovement(Base, TimestampMixin):
    __tablename__ = "ops_movements"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(80), index=True)
    movement_number: Mapped[str | None] = mapped_column(String(60), index=True)
    movement_date: Mapped[date | None] = mapped_column(Date, index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), index=True)
    group_code: Mapped[str | None] = mapped_column(String(20))
    movement_type: Mapped[str | None] = mapped_column(String(120))
    movement_reason: Mapped[str | None] = mapped_column(Text)
    society: Mapped[str | None] = mapped_column(String(120), index=True)
    data: Mapped[dict | None] = mapped_column(JSON)


class Incident(Base, TimestampMixin):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(80), index=True)
    incident_date: Mapped[date | None] = mapped_column(Date, index=True)
    incident_time: Mapped[str | None] = mapped_column(String(10))
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    event_type: Mapped[str | None] = mapped_column(String(80), index=True)
    category: Mapped[str | None] = mapped_column(String(120))
    severity: Mapped[str | None] = mapped_column(String(40))
    subject: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="ouvert", index=True)
    society: Mapped[str | None] = mapped_column(String(120), index=True)
    data: Mapped[dict | None] = mapped_column(JSON)
