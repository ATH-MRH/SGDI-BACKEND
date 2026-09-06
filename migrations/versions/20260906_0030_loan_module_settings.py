"""Ajoute le panneau de configuration des prêts et avances.

Revision ID: 20260906_0030
Revises: 20260906_0029
"""
from alembic import op
import sqlalchemy as sa


revision = "20260906_0030"
down_revision = "20260906_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("loan_module_settings"):
        return
    op.create_table(
        "loan_module_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("module_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("advance_min_seniority_months", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("loan_min_seniority_months", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("debt_ratio_limit", sa.Float(), nullable=False, server_default="30"),
        sa.Column("advance_salary_multiple", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("loan_salary_multiple", sa.Float(), nullable=False, server_default="3"),
        sa.Column("advance_max_installments", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("loan_max_installments", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("merit_threshold", sa.Float(), nullable=False, server_default="50"),
        sa.Column("default_interest_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("maximum_interest_rate", sa.Float(), nullable=False, server_default="10"),
        sa.Column("require_active_employee", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("enforce_contract_end", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_eligibility_override", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("require_dg_signature", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("require_secretariat_validation", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("require_beneficiary_signature", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("require_cash_validation", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("manager_roles", sa.JSON(), nullable=True),
        sa.Column("secretariat_roles", sa.JSON(), nullable=True),
        sa.Column("cash_roles", sa.JSON(), nullable=True),
        sa.Column("secretariat_notification_email", sa.String(180), nullable=True),
        sa.Column("cash_notification_email", sa.String(180), nullable=True),
        sa.Column("decision_prefix", sa.String(20), nullable=False, server_default="DEC-"),
        sa.Column("contract_prefix", sa.String(20), nullable=False, server_default="CONV-"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("loan_module_settings")
