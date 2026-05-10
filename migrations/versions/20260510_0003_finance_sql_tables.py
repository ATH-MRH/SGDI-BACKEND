"""Add finance SQL tables for API-first storage

Revision ID: 20260510_0003
Revises: 20260510_0002
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa

revision = "20260510_0003"
down_revision = "20260510_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "invoices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(120), unique=True, index=True),
        sa.Column("number", sa.String(120), unique=True, index=True),
        sa.Column("invoice_date", sa.Date(), index=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("client_name", sa.String(180), index=True),
        sa.Column("subject", sa.String(220)),
        sa.Column("status", sa.String(60), index=True),
        sa.Column("total_ht", sa.Float(), default=0),
        sa.Column("total_ttc", sa.Float(), default=0),
        sa.Column("data", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(120), unique=True, index=True),
        sa.Column("invoice_external_id", sa.String(120), index=True),
        sa.Column("payment_date", sa.Date(), index=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("client_name", sa.String(180), index=True),
        sa.Column("payment_mode", sa.String(80)),
        sa.Column("reference", sa.String(120)),
        sa.Column("amount", sa.Float(), default=0),
        sa.Column("notes", sa.Text()),
        sa.Column("data", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_table(
        "advances",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(120), unique=True, index=True),
        sa.Column("advance_date", sa.Date(), index=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("beneficiary", sa.String(180), index=True),
        sa.Column("amount", sa.Float(), default=0),
        sa.Column("status", sa.String(60), index=True),
        sa.Column("data", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_table(
        "credit_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(120), unique=True, index=True),
        sa.Column("invoice_external_id", sa.String(120), index=True),
        sa.Column("credit_date", sa.Date(), index=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("client_name", sa.String(180), index=True),
        sa.Column("amount", sa.Float(), default=0),
        sa.Column("reason", sa.Text()),
        sa.Column("data", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_table(
        "cash_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(120), unique=True, index=True),
        sa.Column("entry_date", sa.Date(), index=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("category", sa.String(120), index=True),
        sa.Column("label", sa.String(220)),
        sa.Column("amount", sa.Float(), default=0),
        sa.Column("entry_type", sa.String(60), index=True),
        sa.Column("data", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime()),
    )


def downgrade() -> None:
    op.drop_table("cash_entries")
    op.drop_table("credit_notes")
    op.drop_table("advances")
    op.drop_table("payments")
    op.drop_table("invoices")
