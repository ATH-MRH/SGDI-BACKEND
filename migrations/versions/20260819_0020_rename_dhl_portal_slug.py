"""Renomme le sous-domaine du portail client DHL en DFA.

Revision ID: 20260819_0020
Revises: 20260818_0019
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa


revision = "20260819_0020"
down_revision = "20260818_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("clients"):
        return
    columns = {column["name"] for column in inspector.get_columns("clients")}
    if "portal_slug" not in columns:
        return
    bind.execute(
        sa.text(
            "UPDATE clients SET portal_slug = 'dfa' "
            "WHERE portal_slug = 'dhl' "
            "AND NOT EXISTS (SELECT 1 FROM clients WHERE portal_slug = 'dfa')"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("clients"):
        return
    columns = {column["name"] for column in inspector.get_columns("clients")}
    if "portal_slug" not in columns:
        return
    bind.execute(
        sa.text(
            "UPDATE clients SET portal_slug = 'dhl' "
            "WHERE portal_slug = 'dfa' "
            "AND NOT EXISTS (SELECT 1 FROM clients WHERE portal_slug = 'dhl')"
        )
    )
