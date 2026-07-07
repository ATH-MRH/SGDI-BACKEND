"""Add missing indexes on contract_end_date, ops_movements.society, incidents.society

Revision ID: 20260707_0014
Revises: 20260617_0013
Create Date: 2026-07-07
"""
from alembic import op

revision = "20260707_0014"
down_revision = "20260617_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_employees_contract_end_date", "employees", ["contract_end_date"])
    op.create_index("ix_ops_movements_society", "ops_movements", ["society"])
    op.create_index("ix_incidents_society", "incidents", ["society"])


def downgrade() -> None:
    op.drop_index("ix_employees_contract_end_date", table_name="employees")
    op.drop_index("ix_ops_movements_society", table_name="ops_movements")
    op.drop_index("ix_incidents_society", table_name="incidents")
