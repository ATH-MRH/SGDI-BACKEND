"""Lot 0.1 : scopes explicites, audit append-only et jetons portail.

Revision ID: 20260907_0032
Revises: 20260906_0031
"""
from alembic import op
import sqlalchemy as sa


revision = "20260907_0032"
down_revision = "20260906_0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "global_society_access" not in user_columns:
        op.add_column("users", sa.Column("global_society_access", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Compatibilité explicite des administrateurs existants : leur accès global
    # historique devient un droit matérialisé, jamais déduit d'une liste vide.
    op.execute(sa.text("UPDATE users SET global_society_access = true WHERE upper(role) IN ('ADMIN','ADM','ADM1','ADM2')"))
    tables = set(inspector.get_table_names())
    if "audit_events" not in tables:
        op.create_table(
            "audit_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("username", sa.String(80), nullable=True),
        sa.Column("action", sa.String(120), nullable=False),
        sa.Column("resource", sa.String(120), nullable=False),
        sa.Column("resource_id", sa.String(180), nullable=True),
        sa.Column("society", sa.String(150), nullable=True),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column("old_state", sa.Text(), nullable=True),
        sa.Column("new_state", sa.Text(), nullable=True),
        sa.Column("correlation_id", sa.String(64), nullable=False),
        )
    inspector = sa.inspect(bind)
    audit_indexes = {index["name"] for index in inspector.get_indexes("audit_events")}
    for name, columns in (
        ("ix_audit_events_created_at", ["created_at"]), ("ix_audit_events_user_id", ["user_id"]),
        ("ix_audit_events_username", ["username"]), ("ix_audit_events_action", ["action"]),
        ("ix_audit_events_resource", ["resource"]), ("ix_audit_events_society", ["society"]),
        ("ix_audit_events_result", ["result"]), ("ix_audit_events_correlation_id", ["correlation_id"]),
        ("ix_audit_events_user_created", ["username", "created_at"]),
        ("ix_audit_events_society_created", ["society", "created_at"]),
        ("ix_audit_events_action_resource", ["action", "resource"]),
    ):
        if name not in audit_indexes:
            op.create_index(name, "audit_events", columns)
    tables = set(sa.inspect(bind).get_table_names())
    if "portal_password_reset_tokens" not in tables:
        op.create_table(
            "portal_password_reset_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.String(160), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("delivery_channel", sa.String(20), nullable=True),
        sa.Column("delivery_target_masked", sa.String(180), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        )
    reset_indexes = {index["name"] for index in sa.inspect(bind).get_indexes("portal_password_reset_tokens")}
    for name, columns, unique in (
        ("ix_portal_reset_account", ["account_id"], False),
        ("ix_portal_reset_expires", ["expires_at"], False),
        ("ix_portal_reset_token_hash", ["token_hash"], True),
    ):
        if name not in reset_indexes:
            op.create_index(name, "portal_password_reset_tokens", columns, unique=unique)


def downgrade() -> None:
    op.drop_table("portal_password_reset_tokens")
    op.drop_table("audit_events")
    op.drop_column("users", "global_society_access")
