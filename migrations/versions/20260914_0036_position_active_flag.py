"""LOT ERP — bascule contractuelle DC : ajoute positions.active.

Purement additive : colonne booléenne, server_default true, nullable=False.
Aucune donnée existante modifiée (toutes les lignes existantes deviennent
active=true automatiquement via le server_default, sans passe de données).
Aucune suppression, aucune conversion de libellé, aucune donnée de
production touchée par cette migration en elle-même.

Revision ID: 20260914_0036
Revises: 20260913_0035
"""
from alembic import op
import sqlalchemy as sa


revision = "20260914_0036"
down_revision = "20260913_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("positions")} if inspector.has_table("positions") else set()
    if "active" not in columns:
        op.add_column(
            "positions",
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("positions")} if inspector.has_table("positions") else set()
    if "active" in columns:
        op.drop_column("positions", "active")
