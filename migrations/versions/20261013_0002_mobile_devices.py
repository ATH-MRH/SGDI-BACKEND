"""Registre des appareils ATLAS MOBILE pour les notifications push.

Additive, aucune donnée modifiée.

Revision ID: 20261013_0002
Revises: 20261013_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261013_0002"
down_revision = "20261013_0001"
branch_labels = None
depends_on = None

TABLE = "mobile_devices"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("push_token", sa.String(255), nullable=False),
        sa.Column("provider", sa.String(10), nullable=False),
        sa.Column("platform", sa.String(10), nullable=False),
        sa.Column("environment", sa.String(20), nullable=False),
        sa.Column("app_version", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("push_token", name="uq_mobile_devices_push_token"),
    )
    op.create_index("ix_mobile_devices_user_active", TABLE, ["user_id", "revoked_at"])
    op.create_index("ix_mobile_devices_session_id", TABLE, ["session_id"])


def downgrade() -> None:
    # Ne détruit que des enregistrements d'appareils : ils se réinscrivent à la prochaine ouverture.
    op.drop_index("ix_mobile_devices_session_id", table_name=TABLE)
    op.drop_index("ix_mobile_devices_user_active", table_name=TABLE)
    op.drop_table(TABLE)
