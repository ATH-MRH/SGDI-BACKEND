from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Site(Base, TimestampMixin):
    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    indicatif: Mapped[str | None] = mapped_column(String(50), index=True)
    client_name: Mapped[str | None] = mapped_column(String(180))
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


class Assignment(Base, TimestampMixin):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    group_code: Mapped[str] = mapped_column(String(20), default="A", index=True)
    position: Mapped[str | None] = mapped_column(String(150))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    change_reason: Mapped[str | None] = mapped_column(Text)
    active: Mapped[int] = mapped_column(Integer, default=1)


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

