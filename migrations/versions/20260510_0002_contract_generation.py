"""contract generation tables

Revision ID: 20260510_0002
Revises: 20260503_0001
Create Date: 2026-05-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260510_0002"
down_revision: Union[str, None] = "20260503_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "contract_templates",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("code", sa.String(length=80), nullable=False, unique=True, index=True),
        sa.Column("title", sa.String(length=180), nullable=False, index=True),
        sa.Column("contract_type", sa.String(length=80), nullable=False, index=True),
        sa.Column("position", sa.String(length=150), nullable=True, index=True),
        sa.Column("function", sa.String(length=150), nullable=True, index=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False),
        sa.Column("docx_content", sa.LargeBinary(), nullable=False),
        sa.Column("placeholders", sa.JSON(), nullable=True),
        sa.Column("active", sa.Integer(), nullable=False, server_default="1", index=True),
        sa.Column("uploaded_by", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "contract_conditional_clauses",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("contract_templates.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("condition_field", sa.String(length=100), nullable=False, server_default="function"),
        sa.Column("condition_operator", sa.String(length=40), nullable=False, server_default="equals"),
        sa.Column("condition_value", sa.String(length=180), nullable=False, index=True),
        sa.Column("placeholder", sa.String(length=100), nullable=False, server_default="CLAUSES_CONDITIONNELLES"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("active", sa.Integer(), nullable=False, server_default="1", index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "generated_contracts",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("contract_templates.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("contract_id", sa.Integer(), sa.ForeignKey("contracts.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("reference", sa.String(length=120), nullable=False, unique=True, index=True),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("contract_type", sa.String(length=80), nullable=False, index=True),
        sa.Column("position", sa.String(length=150), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("output_format", sa.String(length=20), nullable=False, server_default="docx"),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False),
        sa.Column("file_content", sa.LargeBinary(), nullable=False),
        sa.Column("values", sa.JSON(), nullable=True),
        sa.Column("generated_by", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="genere", index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("generated_contracts")
    op.drop_table("contract_conditional_clauses")
    op.drop_table("contract_templates")
