"""ATLAS Finance Core (P0-C/P0-E) — couche d'intégration commune : obligations, intentions
de paiement, règlements, journal d'événements financiers + outbox transactionnelle, et le
pont comptable (accounting_events). Toutes les colonnes monétaires en Numeric(18,2) — jamais
Float (P0-D) — c'est la première table financière NEUVE de ce dépôt à respecter cette règle.

Revision ID: 20260922_0038
Revises: 20260920_0037
"""
from alembic import op
import sqlalchemy as sa

revision = "20260922_0038"
down_revision = "20260920_0037"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("financial_obligations"):
        op.create_table(
            "financial_obligations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("direction", sa.String(20), nullable=False),
            sa.Column("source_type", sa.String(60), nullable=False),
            sa.Column("source_id", sa.String(120), nullable=False),
            sa.Column("counterparty_name", sa.String(180), nullable=True),
            sa.Column("amount_total", MONEY, nullable=False, server_default="0"),
            sa.Column("amount_settled", MONEY, nullable=False, server_default="0"),
            sa.Column("currency", sa.String(3), nullable=False, server_default="DZD"),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="open"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_financial_obligations_idempotency_key"),
        )
        for col in ("society", "direction", "source_type", "source_id", "status", "due_date", "idempotency_key"):
            op.create_index(f"ix_financial_obligations_{col}", "financial_obligations", [col])
        op.create_index("ix_financial_obligations_society_status", "financial_obligations", ["society", "status"])
        op.create_index("ix_financial_obligations_source", "financial_obligations", ["source_type", "source_id"])

    if not inspector.has_table("payment_intents"):
        op.create_table(
            "payment_intents",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("obligation_id", sa.Integer(), sa.ForeignKey("financial_obligations.id", ondelete="SET NULL"), nullable=True),
            sa.Column("direction", sa.String(20), nullable=False),
            sa.Column("amount", MONEY, nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="DZD"),
            sa.Column("method", sa.String(40), nullable=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
            sa.Column("planned_date", sa.Date(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_payment_intents_idempotency_key"),
        )
        for col in ("society", "obligation_id", "direction", "status", "idempotency_key"):
            op.create_index(f"ix_payment_intents_{col}", "payment_intents", [col])

    if not inspector.has_table("settlements"):
        op.create_table(
            "settlements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("obligation_id", sa.Integer(), sa.ForeignKey("financial_obligations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("payment_intent_id", sa.Integer(), sa.ForeignKey("payment_intents.id", ondelete="SET NULL"), nullable=True),
            sa.Column("bank_transaction_id", sa.Integer(), nullable=True),
            sa.Column("amount", MONEY, nullable=False),
            sa.Column("kind", sa.String(20), nullable=False, server_default="normal"),
            sa.Column("settled_at", sa.DateTime(), nullable=False),
            sa.Column("reversed_settlement_id", sa.Integer(), sa.ForeignKey("settlements.id", ondelete="SET NULL"), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_settlements_idempotency_key"),
        )
        for col in ("society", "obligation_id", "payment_intent_id", "bank_transaction_id", "kind", "idempotency_key"):
            op.create_index(f"ix_settlements_{col}", "settlements", [col])

    if not inspector.has_table("financial_events"):
        op.create_table(
            "financial_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("event_type", sa.String(60), nullable=False),
            sa.Column("aggregate_type", sa.String(60), nullable=False),
            sa.Column("aggregate_id", sa.Integer(), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_financial_events_idempotency_key"),
        )
        for col in ("society", "event_type", "aggregate_type", "aggregate_id", "idempotency_key"):
            op.create_index(f"ix_financial_events_{col}", "financial_events", [col])

    if not inspector.has_table("finance_outbox_events"):
        op.create_table(
            "finance_outbox_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("financial_event_id", sa.Integer(), sa.ForeignKey("financial_events.id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("dispatched_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("financial_event_id", name="uq_finance_outbox_events_financial_event_id"),
        )
        op.create_index("ix_finance_outbox_events_status", "finance_outbox_events", ["status"])
        op.create_index("ix_finance_outbox_events_financial_event_id", "finance_outbox_events", ["financial_event_id"])

    if not inspector.has_table("accounting_events"):
        op.create_table(
            "accounting_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("source_type", sa.String(60), nullable=False),
            sa.Column("source_id", sa.Integer(), nullable=False),
            sa.Column("ecriture_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_accounting_events_idempotency_key"),
        )
        for col in ("society", "source_type", "source_id", "ecriture_id", "status", "idempotency_key"):
            op.create_index(f"ix_accounting_events_{col}", "accounting_events", [col])


def downgrade() -> None:
    op.drop_table("accounting_events")
    op.drop_table("finance_outbox_events")
    op.drop_table("financial_events")
    op.drop_table("settlements")
    op.drop_table("payment_intents")
    op.drop_table("financial_obligations")
