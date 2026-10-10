"""Sessions renouvelables ATLAS MOBILE — refresh token à rotation, révocation serveur.

Additive, aucune donnée modifiée : la table auth_sessions ne contient que des condensats
de refresh tokens. Les sessions web existantes ne sont pas concernées.

Revision ID: 20261013_0001
Revises: 20261011_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261013_0001"
down_revision = "20261011_0001"
branch_labels = None
depends_on = None

TABLE = "auth_sessions"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(40), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("refresh_hash", sa.String(64), nullable=False),
        sa.Column("previous_refresh_hash", sa.String(64), nullable=True),
        sa.Column("platform", sa.String(20), nullable=True),
        sa.Column("app_version", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_reason", sa.String(40), nullable=True),
        sa.UniqueConstraint("public_id", name="uq_auth_sessions_public_id"),
        sa.UniqueConstraint("refresh_hash", name="uq_auth_sessions_refresh_hash"),
    )
    op.create_index("ix_auth_sessions_previous_refresh_hash", TABLE, ["previous_refresh_hash"])
    op.create_index("ix_auth_sessions_user_active", TABLE, ["user_id", "revoked_at"])


def downgrade() -> None:
    # Ne détruit que des sessions : les utilisateurs mobiles se reconnectent.
    op.drop_index("ix_auth_sessions_user_active", table_name=TABLE)
    op.drop_index("ix_auth_sessions_previous_refresh_hash", table_name=TABLE)
    op.drop_table(TABLE)
