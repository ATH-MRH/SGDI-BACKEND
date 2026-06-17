"""Add store configuration column

Revision ID: 20260517_0004
Revises: 20260510_0003
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa


revision = "20260517_0004"
down_revision = "20260510_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("stores")}
    if "config" not in columns:
        op.add_column("stores", sa.Column("config", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("stores")}
    if "config" in columns:
        op.drop_column("stores", "config")
