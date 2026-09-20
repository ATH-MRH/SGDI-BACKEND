"""Ajoute employee_blacklist_entries (P1 finalisation DRH Next : blacklist auditée et
réversible, remplace la valeur libre non tracée précédemment portée par Employee.status).

Revision ID: 20260920_0037
Revises: 20260914_0036
"""
from alembic import op
import sqlalchemy as sa


revision = "20260920_0037"
down_revision = "20260914_0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("employee_blacklist_entries"):
        op.create_table(
            "employee_blacklist_entries",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("created_by", sa.String(120), nullable=True),
            sa.Column("lifted_at", sa.DateTime(), nullable=True),
            sa.Column("lifted_by", sa.String(120), nullable=True),
            sa.Column("lift_reason", sa.Text(), nullable=True),
            sa.Column("previous_status", sa.String(30), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        for column in ("employee_id", "society", "status"):
            op.create_index(f"ix_employee_blacklist_entries_{column}", "employee_blacklist_entries", [column])


def downgrade() -> None:
    op.drop_table("employee_blacklist_entries")
