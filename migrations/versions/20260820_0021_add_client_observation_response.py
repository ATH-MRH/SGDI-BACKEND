"""Ajoute une réponse visible par le client aux signalements.

Revision ID: 20260820_0021
Revises: 20260819_0020
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa


revision = "20260820_0021"
down_revision = "20260819_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("client_observations"):
        columns = {column["name"] for column in inspector.get_columns("client_observations")}
        if "client_response" not in columns:
            op.add_column("client_observations", sa.Column("client_response", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("client_observations"):
        columns = {column["name"] for column in inspector.get_columns("client_observations")}
        if "client_response" in columns:
            op.drop_column("client_observations", "client_response")
