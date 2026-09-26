"""Attendance Core — journal d'événements de pointage et registre d'anomalies.

`DailyPresence` (app/modules/ops/models.py) reste l'UNIQUE journée de présence, seule lue par
la paie. Ces tables ne sont jamais une seconde présence : `attendance_events` est l'historique
append-only des événements qui ont produit/modifié une journée (il remplace la collection
JSON `attendanceQrScans`, non indexée et relue intégralement à chaque scan), et
`attendance_anomalies` le registre des écarts à traiter. Voir docs/attendance-core-baseline.md.
"""
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Sources d'événements : la méthode d'identification n'est jamais un second moteur.
SOURCE_QR = "QR"
SOURCE_MANUAL = "MANUAL"
SOURCE_FACIAL = "FACIAL"
SOURCE_SITE_WORKFORCE = "SITE_WORKFORCE"
SOURCE_PORTAL_GPS = "PORTAL_GPS"
SOURCE_IMPORT = "IMPORT"
SOURCE_SYSTEM = "SYSTEM"
SOURCES = frozenset({SOURCE_QR, SOURCE_MANUAL, SOURCE_FACIAL, SOURCE_SITE_WORKFORCE, SOURCE_PORTAL_GPS, SOURCE_IMPORT, SOURCE_SYSTEM})

EVENT_ARRIVAL = "ARRIVAL"
EVENT_DEPARTURE = "DEPARTURE"
EVENT_STATUS = "STATUS"          # statut de journée saisi (absent, congé, maladie, repos...)
EVENT_CORRECTION = "CORRECTION"  # correction tracée (avant/après, motif)
EVENT_CLOSE = "CLOSE"
EVENT_REOPEN = "REOPEN"
EVENT_TYPES = frozenset({EVENT_ARRIVAL, EVENT_DEPARTURE, EVENT_STATUS, EVENT_CORRECTION, EVENT_CLOSE, EVENT_REOPEN})


class AttendanceEvent(Base):
    """Événement de pointage — append-only : jamais modifié ni supprimé par l'application."""
    __tablename__ = "attendance_events"
    __table_args__ = (
        # Idempotence en base : un même événement source (nonce QR, id d'événement caméra,
        # clé de requête client) ne produit jamais deux effets, même en parallèle.
        UniqueConstraint("source", "idempotency_key", name="uq_attendance_events_source_key"),
        Index("ix_attendance_events_employee_occurred", "employee_id", "occurred_at"),
        Index("ix_attendance_events_site_occurred", "site_id", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"))
    presence_id: Mapped[int | None] = mapped_column(ForeignKey("daily_presence.id", ondelete="SET NULL"), index=True)
    presence_date: Mapped[date] = mapped_column(Date, index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime)  # UTC naïf, comme le reste du schéma
    event_type: Mapped[str] = mapped_column(String(20), index=True)
    source: Mapped[str] = mapped_column(String(20), index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(160))
    cycle: Mapped[int | None] = mapped_column(Integer)
    device_id: Mapped[int | None] = mapped_column(Integer, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(Integer)
    actor_label: Mapped[str | None] = mapped_column(String(120))
    confidence: Mapped[float | None] = mapped_column(Float)
    quality_result: Mapped[str | None] = mapped_column(String(40))
    liveness_result: Mapped[str | None] = mapped_column(String(40))
    observation: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


ANOMALY_OPEN = "OPEN"
ANOMALY_RESOLVED = "RESOLVED"
ANOMALY_DISMISSED = "DISMISSED"


class AttendanceAnomaly(Base):
    __tablename__ = "attendance_anomalies"
    __table_args__ = (
        # Une même anomalie (même type, même employé, même journée...) n'est jamais dupliquée.
        UniqueConstraint("dedupe_key", name="uq_attendance_anomalies_dedupe"),
        Index("ix_attendance_anomalies_site_date", "site_id", "presence_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    anomaly_type: Mapped[str] = mapped_column(String(40), index=True)
    severity: Mapped[str] = mapped_column(String(20), default="warning")  # info | warning | critical
    status: Mapped[str] = mapped_column(String(20), default=ANOMALY_OPEN, index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"))
    presence_date: Mapped[date | None] = mapped_column(Date, index=True)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("attendance_events.id", ondelete="SET NULL"))
    source: Mapped[str | None] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(String(300))
    details: Mapped[dict | None] = mapped_column(JSON)
    dedupe_key: Mapped[str] = mapped_column(String(200))
    resolution: Mapped[str | None] = mapped_column(Text)
    resolved_by: Mapped[str | None] = mapped_column(String(120))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
