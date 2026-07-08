"""Add authorized_sites column on users table

Revision ID: 20260708_0015
Revises: 20260707_0014
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa

revision = "20260708_0015"
down_revision = "20260707_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("authorized_sites", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "authorized_sites")
