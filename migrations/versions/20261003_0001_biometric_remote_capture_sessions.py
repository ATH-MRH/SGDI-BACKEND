"""Prise de photo distante supervisée (LOT C1) — sessions temporaires DRH → terminal.

Additive, aucune donnée modifiée : la table biometric_remote_capture_sessions porte une session
courte liée à un employé, un terminal et un opérateur. Une seule session active par terminal
et par employé (colonnes active_* uniques, NULL à la clôture — NULL distincts en PostgreSQL
comme en SQLite). La photo candidate n'y existe que chiffrée, le temps de la session.

Revision ID: 20261003_0001
Revises: 20261002_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261003_0001"
down_revision = "20261002_0001"
branch_labels = None
depends_on = None

TABLE = "biometric_remote_capture_sessions"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(64), nullable=False),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("terminal_id", sa.Integer(), sa.ForeignKey("biometric_terminals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=True),
        sa.Column("requested_by", sa.String(120), nullable=True),
        sa.Column("society", sa.String(150), nullable=True),
        sa.Column("site_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("reason_code", sa.String(40), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("nonce_hash", sa.String(64), nullable=True),
        sa.Column("photo_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("photo_sha256", sa.String(64), nullable=True),
        sa.Column("checks", sa.JSON(), nullable=True),
        sa.Column("active_terminal_id", sa.Integer(), nullable=True),
        sa.Column("active_employee_id", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("command_at", sa.DateTime(), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.Column("captured_at", sa.DateTime(), nullable=True),
        sa.Column("operator_seen_at", sa.DateTime(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_biometric_remote_capture_sessions_public_id", TABLE, ["public_id"], unique=True)
    op.create_index("ix_biometric_remote_capture_sessions_employee_id", TABLE, ["employee_id"])
    op.create_index("ix_biometric_remote_capture_sessions_terminal_id", TABLE, ["terminal_id"])
    op.create_index("ix_biometric_remote_capture_sessions_requested_by_user_id", TABLE, ["requested_by_user_id"])
    op.create_index("ix_biometric_remote_capture_sessions_status", TABLE, ["status"])
    op.create_index("ix_biometric_remote_capture_sessions_expires_at", TABLE, ["expires_at"])
    op.create_index("uq_biometric_remote_capture_active_terminal", TABLE, ["active_terminal_id"], unique=True)
    op.create_index("uq_biometric_remote_capture_active_employee", TABLE, ["active_employee_id"], unique=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE):
        op.drop_table(TABLE)
