"""Add missing indexes on contract_end_date, ops_movements.society, incidents.society

Revision ID: 20260707_0014
Revises: 20260617_0013
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = "20260707_0014"
down_revision = "20260617_0013"
branch_labels = None
depends_on = None


# (index name, table, columns). Gardé : sur une base neuve, migration 0001
# (Base.metadata.create_all) a déjà créé ces index via `index=True` sur les
# colonnes du modèle -> un op.create_index nu échouerait ("already exists").
_INDEXES = [
    ("ix_employees_contract_end_date", "employees", ["contract_end_date"]),
    ("ix_ops_movements_society", "ops_movements", ["society"]),
    ("ix_incidents_society", "incidents", ["society"]),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for name, table, columns in _INDEXES:
        existing = {ix["name"] for ix in inspector.get_indexes(table)}
        if name not in existing:
            op.create_index(name, table, columns)


def downgrade() -> None:
    for name, _table, _columns in _INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
