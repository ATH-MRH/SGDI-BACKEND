"""Feuilles de présence par rotation (Pointage & Planning intelligent V3 — lot 1).

Additive : quatre tables neuves, AUCUNE colonne modifiée sur les tables existantes.
`attendance_events` reste le journal append-only des faits ; une feuille ne fait que
référencer ces événements (`attendance_sheet_events`). Aucune ligne n'est créée par la
migration : un site n'a de feuilles qu'après configuration de ses paramètres de rotation.

Revision ID: 20261005_0001
Revises: 20261004_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261005_0001"
down_revision = "20261004_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table("attendance_rotation_settings"):
        op.create_table(
            "attendance_rotation_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("first_shift_time", sa.String(5), nullable=False),
            sa.Column("shift_minutes", sa.Integer(), nullable=False),
            sa.Column("groups_count", sa.Integer(), nullable=False),
            sa.Column("early_margin_minutes", sa.Integer(), nullable=False),
            sa.Column("active", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("updated_by", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("site_id", name="uq_attendance_rotation_settings_site"),
        )

    if not inspector.has_table("attendance_sheets"):
        op.create_table(
            "attendance_sheets",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("window_start", sa.DateTime(), nullable=False),
            sa.Column("window_end", sa.DateTime(), nullable=False),
            sa.Column("local_date", sa.Date(), nullable=False),
            sa.Column("slot_index", sa.Integer(), nullable=False),
            sa.Column("expected_group", sa.String(8), nullable=True),
            sa.Column("status", sa.String(12), nullable=False, server_default="OPEN"),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("planning_version", sa.Integer(), nullable=True),
            sa.Column("closed_at", sa.DateTime(), nullable=True),
            sa.Column("closed_by", sa.String(120), nullable=True),
            sa.Column("archived_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("site_id", "window_start", name="uq_attendance_sheets_site_window"),
        )
        op.create_index("ix_attendance_sheets_society", "attendance_sheets", ["society"])
        op.create_index("ix_attendance_sheets_status_end", "attendance_sheets", ["status", "window_end"])
        op.create_index("ix_attendance_sheets_site_date", "attendance_sheets", ["site_id", "local_date"])

    if not inspector.has_table("attendance_sheet_lines"):
        op.create_table(
            "attendance_sheet_lines",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("sheet_id", sa.Integer(), sa.ForeignKey("attendance_sheets.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("declared_group", sa.String(8), nullable=True),
            sa.Column("first_entry_at", sa.DateTime(), nullable=True),
            sa.Column("last_exit_at", sa.DateTime(), nullable=True),
            sa.Column("state", sa.String(12), nullable=False, server_default="PRESENT"),
            sa.Column("events_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("anomaly", sa.String(40), nullable=True),
            sa.Column("last_event_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("sheet_id", "employee_id", name="uq_attendance_sheet_lines_sheet_employee"),
        )
        op.create_index("ix_attendance_sheet_lines_sheet_id", "attendance_sheet_lines", ["sheet_id"])
        op.create_index("ix_attendance_sheet_lines_employee_state", "attendance_sheet_lines", ["employee_id", "state"])

    if not inspector.has_table("attendance_sheet_events"):
        op.create_table(
            "attendance_sheet_events",
            sa.Column("event_id", sa.Integer(), sa.ForeignKey("attendance_events.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("sheet_id", sa.Integer(), sa.ForeignKey("attendance_sheets.id", ondelete="CASCADE"), nullable=False),
            sa.Column("line_id", sa.Integer(), sa.ForeignKey("attendance_sheet_lines.id", ondelete="CASCADE"), nullable=False),
        )
        op.create_index("ix_attendance_sheet_events_sheet_id", "attendance_sheet_events", ["sheet_id"])
        op.create_index("ix_attendance_sheet_events_line_id", "attendance_sheet_events", ["line_id"])


def downgrade() -> None:
    for table in ("attendance_sheet_events", "attendance_sheet_lines", "attendance_sheets", "attendance_rotation_settings"):
        op.drop_table(table)
