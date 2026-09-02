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
    # Gardé : sur une base neuve, migration 0001 (create_all) a déjà créé la
    # colonne d'après le modèle -> un op.add_column nu échouerait.
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "authorized_sites" not in columns:
        op.add_column("users", sa.Column("authorized_sites", sa.JSON(), nullable=True))


def downgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "authorized_sites" in columns:
        op.drop_column("users", "authorized_sites")
