"""Add supervisor_read_only column on users table

Revision ID: 20260725_0016
Revises: 20260708_0015
Create Date: 2026-07-25
"""
from alembic import op
import sqlalchemy as sa

revision = "20260725_0016"
down_revision = "20260708_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Gardé : sur une base neuve, migration 0001 (create_all) a déjà créé la
    # colonne d'après le modèle -> un op.add_column nu échouerait.
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "supervisor_read_only" not in columns:
        op.add_column(
            "users",
            sa.Column("supervisor_read_only", sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "supervisor_read_only" in columns:
        op.drop_column("users", "supervisor_read_only")
