from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100), index=True)
    last_name: Mapped[str] = mapped_column(String(100), index=True)
    father_name: Mapped[str | None] = mapped_column(String(120))
    mother_name: Mapped[str | None] = mapped_column(String(120))
    nin: Mapped[str | None] = mapped_column(String(30), unique=True)
    birth_date: Mapped[date | None] = mapped_column(Date)
    birth_place: Mapped[str | None] = mapped_column(String(120))
    family_status: Mapped[str | None] = mapped_column(String(80))
    children_count: Mapped[int] = mapped_column(Integer, default=0)
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(150))
    address: Mapped[str | None] = mapped_column(Text)
    commune: Mapped[str | None] = mapped_column(String(120))
    wilaya: Mapped[str | None] = mapped_column(String(120))
    position: Mapped[str | None] = mapped_column(String(150), index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    status: Mapped[str] = mapped_column(String(40), default="actif", index=True)
    contract_type: Mapped[str | None] = mapped_column(String(80))
    salary_net: Mapped[float] = mapped_column(Float, default=0)
    recruit_date: Mapped[date | None] = mapped_column(Date)
    trial_end_date: Mapped[date | None] = mapped_column(Date)
    contract_end_date: Mapped[date | None] = mapped_column(Date)
    locked: Mapped[int] = mapped_column(Integer, default=1)
    extra: Mapped[dict | None] = mapped_column(JSON)


class Candidate(Base, TimestampMixin):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100), index=True)
    last_name: Mapped[str] = mapped_column(String(100), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(150))
    desired_position: Mapped[str | None] = mapped_column(String(150))
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    expected_salary: Mapped[float | None] = mapped_column(Float)
    recruiter_opinion: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="nouvelle", index=True)
    data: Mapped[dict | None] = mapped_column(JSON)


class Contract(Base, TimestampMixin):
    __tablename__ = "contracts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    contract_type: Mapped[str] = mapped_column(String(80), default="CDI")
    position: Mapped[str | None] = mapped_column(String(150))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    trial_end_date: Mapped[date | None] = mapped_column(Date)
    salary_net: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(40), default="actif", index=True)
    template_code: Mapped[str | None] = mapped_column(String(80))
    content: Mapped[str | None] = mapped_column(Text)


class Leave(Base, TimestampMixin):
    __tablename__ = "leaves"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    leave_type: Mapped[str] = mapped_column(String(80), default="conge")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="instance", index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)


class Sanction(Base, TimestampMixin):
    __tablename__ = "sanctions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    infraction_date: Mapped[date] = mapped_column(Date)
    site_name: Mapped[str | None] = mapped_column(String(180))
    fault: Mapped[str] = mapped_column(Text)
    sanction_type: Mapped[str] = mapped_column(String(100))
    suspension_days: Mapped[int] = mapped_column(Integer, default=0)
    sanction_start: Mapped[date | None] = mapped_column(Date)
    next_return_date: Mapped[date | None] = mapped_column(Date)


class Document(Base, TimestampMixin):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    owner_type: Mapped[str] = mapped_column(String(40), index=True)
    owner_id: Mapped[int] = mapped_column(Integer, index=True)
    label: Mapped[str] = mapped_column(String(150))
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_path: Mapped[str | None] = mapped_column(String(500))
    mime_type: Mapped[str | None] = mapped_column(String(120))
    uploaded_by: Mapped[str | None] = mapped_column(String(120))

