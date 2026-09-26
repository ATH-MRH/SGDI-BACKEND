"""Attendance Core — journal d'événements (append-only) et registre d'anomalies.

Deux tables neuves, aucune colonne modifiée sur les tables existantes : `daily_presence`
reste l'unique journée de présence. Reprise de l'historique : chaque ligne de la collection
JSON `attendanceQrScans` (table sgdi_records) devient un événement, clé d'idempotence = son
nonce — la reprise est donc rejouable sans doublon. La collection d'origine n'est ni modifiée
ni supprimée (retour arrière possible).

Revision ID: 20260927_0001
Revises: 20260923_0001
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from alembic import op
import sqlalchemy as sa

revision = "20260927_0001"
down_revision = "20260923_0001"
branch_labels = None
depends_on = None

TZ = ZoneInfo("Africa/Algiers")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("attendance_events"):
        op.create_table(
            "attendance_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="SET NULL"), nullable=True),
            sa.Column("presence_id", sa.Integer(), sa.ForeignKey("daily_presence.id", ondelete="SET NULL"), nullable=True),
            sa.Column("presence_date", sa.Date(), nullable=False),
            sa.Column("occurred_at", sa.DateTime(), nullable=False),
            sa.Column("event_type", sa.String(20), nullable=False),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("idempotency_key", sa.String(160), nullable=True),
            sa.Column("cycle", sa.Integer(), nullable=True),
            sa.Column("device_id", sa.Integer(), nullable=True),
            sa.Column("actor_user_id", sa.Integer(), nullable=True),
            sa.Column("actor_label", sa.String(120), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=True),
            sa.Column("quality_result", sa.String(40), nullable=True),
            sa.Column("liveness_result", sa.String(40), nullable=True),
            sa.Column("observation", sa.Text(), nullable=True),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("source", "idempotency_key", name="uq_attendance_events_source_key"),
        )
        op.create_index("ix_attendance_events_employee_id", "attendance_events", ["employee_id"])
        op.create_index("ix_attendance_events_society", "attendance_events", ["society"])
        op.create_index("ix_attendance_events_presence_id", "attendance_events", ["presence_id"])
        op.create_index("ix_attendance_events_presence_date", "attendance_events", ["presence_date"])
        op.create_index("ix_attendance_events_event_type", "attendance_events", ["event_type"])
        op.create_index("ix_attendance_events_source", "attendance_events", ["source"])
        op.create_index("ix_attendance_events_device_id", "attendance_events", ["device_id"])
        op.create_index("ix_attendance_events_employee_occurred", "attendance_events", ["employee_id", "occurred_at"])
        op.create_index("ix_attendance_events_site_occurred", "attendance_events", ["site_id", "occurred_at"])

    if not inspector.has_table("attendance_anomalies"):
        op.create_table(
            "attendance_anomalies",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("anomaly_type", sa.String(40), nullable=False),
            sa.Column("severity", sa.String(20), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=True),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="SET NULL"), nullable=True),
            sa.Column("presence_date", sa.Date(), nullable=True),
            sa.Column("event_id", sa.Integer(), sa.ForeignKey("attendance_events.id", ondelete="SET NULL"), nullable=True),
            sa.Column("source", sa.String(20), nullable=True),
            sa.Column("message", sa.String(300), nullable=False),
            sa.Column("details", sa.JSON(), nullable=True),
            sa.Column("dedupe_key", sa.String(200), nullable=False),
            sa.Column("resolution", sa.Text(), nullable=True),
            sa.Column("resolved_by", sa.String(120), nullable=True),
            sa.Column("resolved_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("dedupe_key", name="uq_attendance_anomalies_dedupe"),
        )
        op.create_index("ix_attendance_anomalies_anomaly_type", "attendance_anomalies", ["anomaly_type"])
        op.create_index("ix_attendance_anomalies_status", "attendance_anomalies", ["status"])
        op.create_index("ix_attendance_anomalies_employee_id", "attendance_anomalies", ["employee_id"])
        op.create_index("ix_attendance_anomalies_society", "attendance_anomalies", ["society"])
        op.create_index("ix_attendance_anomalies_presence_date", "attendance_anomalies", ["presence_date"])
        op.create_index("ix_attendance_anomalies_site_date", "attendance_anomalies", ["site_id", "presence_date"])

    _backfill_scans(bind)


def _parse(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TZ)
    return parsed


def _backfill_scans(bind) -> None:
    inspector = sa.inspect(bind)
    if not inspector.has_table("sgdi_records"):
        return
    records = sa.table("sgdi_records", sa.column("collection", sa.String), sa.column("item_id", sa.String), sa.column("data", sa.JSON))
    events = sa.table(
        "attendance_events",
        sa.column("employee_id", sa.Integer), sa.column("society", sa.String), sa.column("site_id", sa.Integer),
        sa.column("presence_date", sa.Date), sa.column("occurred_at", sa.DateTime), sa.column("event_type", sa.String),
        sa.column("source", sa.String), sa.column("idempotency_key", sa.String), sa.column("cycle", sa.Integer),
        sa.column("actor_user_id", sa.Integer), sa.column("actor_label", sa.String), sa.column("observation", sa.Text),
        sa.column("data", sa.JSON), sa.column("created_at", sa.DateTime),
    )
    employees = {row[0]: row[1] for row in bind.execute(sa.text("SELECT id, society FROM employees"))}
    sites = {row[0] for row in bind.execute(sa.text("SELECT id FROM sites"))}
    existing_keys = {row[0] for row in bind.execute(sa.text("SELECT idempotency_key FROM attendance_events WHERE idempotency_key IS NOT NULL"))}
    rows = bind.execute(sa.select(records.c.item_id, records.c.data).where(records.c.collection == "attendanceQrScans")).all()
    batch = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for item_id, data in rows:
        if not isinstance(data, dict) or data.get("action") not in {"arrivee", "depart"}:
            continue
        try:
            employee_id = int(data.get("employeeId"))
        except (TypeError, ValueError):
            continue
        if employee_id not in employees:
            continue
        scanned = _parse(data.get("scannedAt"))
        if scanned is None:
            continue
        key = str(data.get("nonce") or item_id or "")[:160]
        if not key or key in existing_keys:
            continue
        existing_keys.add(key)
        try:
            site_id = int(data.get("siteId")) if data.get("siteId") not in (None, "") else None
        except (TypeError, ValueError):
            site_id = None
        extra = {k: data[k] for k in ("matricule", "agentName", "authorizedMinutes", "workedMinutes", "overtimeMinutes", "overtimeAlert") if k in data}
        extra["siteName"] = data.get("site") or ""
        extra["migrated_from"] = "attendanceQrScans"
        try:
            actor_id = int(data.get("scannedByUserId")) if data.get("scannedByUserId") not in (None, "") else None
        except (TypeError, ValueError):
            actor_id = None
        batch.append({
            "employee_id": employee_id, "society": employees[employee_id],
            "site_id": site_id if site_id in sites else None,
            "presence_date": scanned.astimezone(TZ).date(),
            "occurred_at": scanned.astimezone(timezone.utc).replace(tzinfo=None),
            "event_type": "ARRIVAL" if data["action"] == "arrivee" else "DEPARTURE",
            "source": "MANUAL" if key.startswith("manual-") else "QR",
            "idempotency_key": key, "cycle": data.get("cycle") if isinstance(data.get("cycle"), int) else None,
            "actor_user_id": actor_id, "actor_label": (str(data.get("scannedBy") or "")[:120] or None),
            "observation": data.get("observation") or None, "data": extra, "created_at": now,
        })
    if batch:
        op.bulk_insert(events, batch)


def downgrade() -> None:
    op.drop_table("attendance_anomalies")
    op.drop_table("attendance_events")
