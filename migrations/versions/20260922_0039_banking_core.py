"""ATLAS Banking Core (P1-D) — comptes bancaires, relevés importés, transactions (pipeline
RAW/NORMALIZED/ENRICHED via BankTransaction.stage).

Revision ID: 20260922_0039
Revises: 20260922_0038
"""
from alembic import op
import sqlalchemy as sa

revision = "20260922_0039"
down_revision = "20260922_0038"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("bank_accounts"):
        op.create_table(
            "bank_accounts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("bank_name", sa.String(150), nullable=False),
            sa.Column("account_number", sa.String(80), nullable=False),
            sa.Column("iban", sa.String(40), nullable=True),
            sa.Column("currency", sa.String(3), nullable=False, server_default="DZD"),
            sa.Column("label", sa.String(180), nullable=True),
            sa.Column("active", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("society", "account_number", name="uq_bank_accounts_society_number"),
        )
        op.create_index("ix_bank_accounts_society", "bank_accounts", ["society"])
        op.create_index("ix_bank_accounts_account_number", "bank_accounts", ["account_number"])

    if not inspector.has_table("bank_statements"):
        op.create_table(
            "bank_statements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("bank_account_id", sa.Integer(), sa.ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("import_format", sa.String(20), nullable=False),
            sa.Column("file_name", sa.String(255), nullable=True),
            sa.Column("period_start", sa.Date(), nullable=True),
            sa.Column("period_end", sa.Date(), nullable=True),
            sa.Column("opening_balance", MONEY, nullable=True),
            sa.Column("closing_balance", MONEY, nullable=True),
            sa.Column("computed_balance_check", sa.String(20), nullable=True),
            sa.Column("transaction_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("duplicate_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("closed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_bank_statements_idempotency_key"),
        )
        for col in ("society", "bank_account_id", "import_format", "closed", "idempotency_key"):
            op.create_index(f"ix_bank_statements_{col}", "bank_statements", [col])

    if not inspector.has_table("bank_statement_pages"):
        op.create_table(
            "bank_statement_pages",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("bank_statement_id", sa.Integer(), sa.ForeignKey("bank_statements.id", ondelete="CASCADE"), nullable=False),
            sa.Column("page_number", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("raw_text", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_bank_statement_pages_bank_statement_id", "bank_statement_pages", ["bank_statement_id"])

    if not inspector.has_table("bank_transactions"):
        op.create_table(
            "bank_transactions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("bank_account_id", sa.Integer(), sa.ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("bank_statement_id", sa.Integer(), sa.ForeignKey("bank_statements.id", ondelete="CASCADE"), nullable=False),
            sa.Column("stage", sa.String(20), nullable=False, server_default="raw"),
            sa.Column("value_date", sa.Date(), nullable=True),
            sa.Column("booking_date", sa.Date(), nullable=True),
            sa.Column("amount", MONEY, nullable=False),
            sa.Column("label", sa.String(255), nullable=True),
            sa.Column("reference", sa.String(160), nullable=True),
            sa.Column("raw_payload", sa.JSON(), nullable=False),
            sa.Column("dedup_hash", sa.String(64), nullable=False),
            sa.Column("reconcile_status", sa.String(20), nullable=False, server_default="unmatched"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("bank_account_id", "dedup_hash", name="uq_bank_transactions_account_dedup"),
        )
        for col in ("society", "bank_account_id", "bank_statement_id", "stage", "value_date", "reference", "dedup_hash", "reconcile_status"):
            op.create_index(f"ix_bank_transactions_{col}", "bank_transactions", [col])


def downgrade() -> None:
    op.drop_table("bank_transactions")
    op.drop_table("bank_statement_pages")
    op.drop_table("bank_statements")
    op.drop_table("bank_accounts")
