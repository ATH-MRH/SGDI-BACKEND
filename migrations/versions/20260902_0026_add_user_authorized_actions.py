"""Ajoute les droits d'action individuels aux utilisateurs.

Revision ID: 20260902_0026
Revises: 20260902_0025
"""
from alembic import op
import sqlalchemy as sa


revision = "20260902_0026"
down_revision = "20260902_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("users"):
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "authorized_actions" not in columns:
        op.add_column("users", sa.Column("authorized_actions", sa.JSON(), nullable=True))
    op.execute("UPDATE users SET authorized_actions = '[]' WHERE authorized_actions IS NULL")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("users") and "authorized_actions" in {column["name"] for column in inspector.get_columns("users")}:
        op.drop_column("users", "authorized_actions")
