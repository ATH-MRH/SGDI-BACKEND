"""ATLAS Reconciliation Engine (P1-F) — cas de rapprochement, imputations, règles, file
d'exceptions.

Revision ID: 20260922_0040
Revises: 20260922_0039
"""
from alembic import op
import sqlalchemy as sa

revision = "20260922_0040"
down_revision = "20260922_0039"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("reconciliation_cases"):
        op.create_table(
            "reconciliation_cases",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("kind", sa.String(20), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="proposed"),
            sa.Column("confidence_score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("explanation", sa.Text(), nullable=True),
            sa.Column("total_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("confirmed_by", sa.String(120), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(), nullable=True),
            sa.Column("rejected_reason", sa.Text(), nullable=True),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_reconciliation_cases_idempotency_key"),
        )
        op.create_index("ix_reconciliation_cases_society", "reconciliation_cases", ["society"])
        op.create_index("ix_reconciliation_cases_status", "reconciliation_cases", ["status"])
        op.create_index("ix_reconciliation_cases_society_status", "reconciliation_cases", ["society", "status"])

    if not inspector.has_table("reconciliation_matches"):
        op.create_table(
            "reconciliation_matches",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("case_id", sa.Integer(), sa.ForeignKey("reconciliation_cases.id", ondelete="CASCADE"), nullable=False),
            sa.Column("bank_transaction_id", sa.Integer(), nullable=False),
            sa.Column("obligation_id", sa.Integer(), nullable=False),
            sa.Column("amount_imputed", MONEY, nullable=False),
            sa.Column("settlement_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_reconciliation_matches_case_id", "reconciliation_matches", ["case_id"])
        op.create_index("ix_reconciliation_matches_bank_transaction_id", "reconciliation_matches", ["bank_transaction_id"])
        op.create_index("ix_reconciliation_matches_obligation_id", "reconciliation_matches", ["obligation_id"])

    if not inspector.has_table("reconciliation_rules"):
        op.create_table(
            "reconciliation_rules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("rule_type", sa.String(40), nullable=False),
            sa.Column("config", sa.JSON(), nullable=False),
            sa.Column("active", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_reconciliation_rules_society", "reconciliation_rules", ["society"])

    if not inspector.has_table("banking_exceptions"):
        op.create_table(
            "banking_exceptions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("bank_transaction_id", sa.Integer(), nullable=False),
            sa.Column("reason", sa.String(255), nullable=False),
            sa.Column("resolved", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("resolved_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("bank_transaction_id", name="uq_banking_exceptions_bank_transaction_id"),
        )
        op.create_index("ix_banking_exceptions_society", "banking_exceptions", ["society"])
        op.create_index("ix_banking_exceptions_resolved", "banking_exceptions", ["resolved"])


def downgrade() -> None:
    op.drop_table("banking_exceptions")
    op.drop_table("reconciliation_rules")
    op.drop_table("reconciliation_matches")
    op.drop_table("reconciliation_cases")
