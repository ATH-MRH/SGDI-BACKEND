"""Ajoute les identifiants administratifs AI et NIS aux clients.

Revision ID: 20260820_0023
Revises: 20260820_0022
"""

from alembic import op
import sqlalchemy as sa


revision = "20260820_0023"
down_revision = "20260820_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("clients"):
        return
    columns = {column["name"] for column in inspector.get_columns("clients")}
    if "ai" not in columns:
        op.add_column("clients", sa.Column("ai", sa.String(100), nullable=True))
    if "nis" not in columns:
        op.add_column("clients", sa.Column("nis", sa.String(100), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("clients"):
        return
    columns = {column["name"] for column in inspector.get_columns("clients")}
    if "nis" in columns:
        op.drop_column("clients", "nis")
    if "ai" in columns:
        op.drop_column("clients", "ai")
