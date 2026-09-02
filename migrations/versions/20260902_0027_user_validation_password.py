"""Ajoute un mot de passe de validation distinct aux utilisateurs.

Revision ID: 20260902_0027
Revises: 20260902_0026
"""
from alembic import op
import sqlalchemy as sa


revision = "20260902_0027"
down_revision = "20260902_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("users"):
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "validation_password_hash" not in columns:
        op.add_column("users", sa.Column("validation_password_hash", sa.String(length=255), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("users") and "validation_password_hash" in {column["name"] for column in inspector.get_columns("users")}:
        op.drop_column("users", "validation_password_hash")
