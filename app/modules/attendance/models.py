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


# ── Feuilles de présence par rotation (Pointage & Planning intelligent V3 — lot 1) ─────────
# Trois notions distinctes, jamais confondues :
#   A. l'ÉVÉNEMENT (`attendance_events`)       : le fait, append-only, jamais réécrit ;
#   B. la FEUILLE (`attendance_sheets` + lignes) : regroupement opérationnel par rotation ;
#   C. le PLANNING (lots suivants)              : modèle appris / prévisionnel.
# Une feuille ne modifie jamais un événement : elle le référence (`attendance_sheet_events`).
SHEET_OPEN = "OPEN"
SHEET_CLOSED = "CLOSED"
SHEET_ARCHIVED = "ARCHIVED"
SHEET_STATUSES = (SHEET_OPEN, SHEET_CLOSED, SHEET_ARCHIVED)

LINE_PRESENT = "PRESENT"
LINE_OUT = "SORTI"


class RotationSetting(Base):
    """Paramètres métier de rotation d'un site (jamais codés en dur dans le moteur) : heure du
    premier poste, durée nominale, nombre de groupes attendu. Sans ligne active, le site n'a
    pas de feuille et garde le comportement historique."""
    __tablename__ = "attendance_rotation_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), unique=True)
    first_shift_time: Mapped[str] = mapped_column(String(5))          # "HH:MM", heure locale du site
    shift_minutes: Mapped[int] = mapped_column(Integer)               # durée nominale d'une rotation
    groups_count: Mapped[int] = mapped_column(Integer)                # nombre de groupes attendu
    early_margin_minutes: Mapped[int] = mapped_column(Integer)        # arrivée anticipée ⇒ rotation suivante
    active: Mapped[int] = mapped_column(Integer, default=1)
    version: Mapped[int] = mapped_column(Integer, default=1)          # +1 à chaque changement de fenêtre
    updated_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class AttendanceSheet(Base):
    """Feuille de présence d'UNE rotation d'UN site. Unicité (site, début de fenêtre) : deux
    pointages simultanés ne créent jamais deux feuilles pour la même rotation."""
    __tablename__ = "attendance_sheets"
    __table_args__ = (
        UniqueConstraint("site_id", "window_start", name="uq_attendance_sheets_site_window"),
        Index("ix_attendance_sheets_status_end", "status", "window_end"),
        Index("ix_attendance_sheets_site_date", "site_id", "local_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    window_start: Mapped[datetime] = mapped_column(DateTime)          # UTC naïf
    window_end: Mapped[datetime] = mapped_column(DateTime)            # UTC naïf
    local_date: Mapped[date] = mapped_column(Date)                    # jour local du début de rotation
    slot_index: Mapped[int] = mapped_column(Integer)                  # 0 = premier poste du jour
    expected_group: Mapped[str | None] = mapped_column(String(8))     # renseigné par le planning (lots suivants)
    status: Mapped[str] = mapped_column(String(12), default=SHEET_OPEN)
    source: Mapped[str] = mapped_column(String(20))                   # EVENT | ACCESS | SCHEDULER
    planning_version: Mapped[int | None] = mapped_column(Integer)     # version des paramètres appliqués
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    closed_by: Mapped[str | None] = mapped_column(String(120))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class AttendanceSheetLine(Base):
    """UN employé = UNE ligne logique par feuille : synthèse (première entrée, dernière sortie,
    état, nombre d'événements). Les événements bruts restent dans `attendance_events`."""
    __tablename__ = "attendance_sheet_lines"
    __table_args__ = (
        UniqueConstraint("sheet_id", "employee_id", name="uq_attendance_sheet_lines_sheet_employee"),
        Index("ix_attendance_sheet_lines_employee_state", "employee_id", "state"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("attendance_sheets.id", ondelete="CASCADE"), index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    declared_group: Mapped[str | None] = mapped_column(String(8))     # groupe de l'affectation AU MOMENT du pointage
    first_entry_at: Mapped[datetime | None] = mapped_column(DateTime) # UTC naïf
    last_exit_at: Mapped[datetime | None] = mapped_column(DateTime)   # UTC naïf
    state: Mapped[str] = mapped_column(String(12), default=LINE_PRESENT)
    events_count: Mapped[int] = mapped_column(Integer, default=0)
    anomaly: Mapped[str | None] = mapped_column(String(40))
    last_event_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class AttendanceSheetEvent(Base):
    """Rattachement d'un événement brut à sa feuille (un événement appartient à une seule
    feuille). L'événement lui-même n'est jamais modifié."""
    __tablename__ = "attendance_sheet_events"

    event_id: Mapped[int] = mapped_column(ForeignKey("attendance_events.id", ondelete="CASCADE"), primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("attendance_sheets.id", ondelete="CASCADE"), index=True)
    line_id: Mapped[int] = mapped_column(ForeignKey("attendance_sheet_lines.id", ondelete="CASCADE"), index=True)
