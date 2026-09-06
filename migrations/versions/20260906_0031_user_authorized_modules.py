"""Ajoute les modules autorisés à l'identité utilisateur centrale.

Revision ID: 20260906_0031
Revises: 20260906_0030
"""
from alembic import op
import sqlalchemy as sa


revision = "20260906_0031"
down_revision = "20260906_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "authorized_modules" not in columns:
        op.add_column("users", sa.Column("authorized_modules", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "authorized_modules")
