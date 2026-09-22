"""Budget versionné (P2) + Fiscalité — calendrier d'obligations fiscales (P2).

Revision ID: 20260922_0043
Revises: 20260922_0042
"""
from alembic import op
import sqlalchemy as sa

revision = "20260922_0043"
down_revision = "20260922_0042"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("budget_lines"):
        op.create_table(
            "budget_lines",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("period", sa.String(7), nullable=False),
            sa.Column("centre_cout", sa.String(120), nullable=True),
            sa.Column("contrat", sa.String(120), nullable=True),
            sa.Column("client", sa.String(180), nullable=True),
            sa.Column("site", sa.String(150), nullable=True),
            sa.Column("compte", sa.String(20), nullable=True),
            sa.Column("montant_budgete", MONEY, nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("revises_id", sa.Integer(), sa.ForeignKey("budget_lines.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_by", sa.String(120), nullable=True),
            sa.Column("approved_by", sa.String(120), nullable=True),
            sa.Column("approved_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        for col in ("society", "period", "centre_cout", "contrat", "client", "site", "compte", "status"):
            op.create_index(f"ix_budget_lines_{col}", "budget_lines", [col])

    if not inspector.has_table("fiscal_obligations"):
        op.create_table(
            "fiscal_obligations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("obligation_type", sa.String(30), nullable=False),
            sa.Column("period", sa.String(7), nullable=False),
            sa.Column("base_calcul", MONEY, nullable=True),
            sa.Column("montant", MONEY, nullable=False),
            sa.Column("echeance", sa.Date(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("regulatory_version_id", sa.Integer(), sa.ForeignKey("regulatory_versions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("financial_obligation_id", sa.Integer(), nullable=True),
            sa.Column("proof_reference", sa.Text(), nullable=True),
            sa.Column("declared_by", sa.String(120), nullable=True),
            sa.Column("declared_at", sa.DateTime(), nullable=True),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_fiscal_obligations_idempotency_key"),
        )
        for col in ("society", "obligation_type", "period", "echeance", "status"):
            op.create_index(f"ix_fiscal_obligations_{col}", "fiscal_obligations", [col])


def downgrade() -> None:
    op.drop_table("fiscal_obligations")
    op.drop_table("budget_lines")
