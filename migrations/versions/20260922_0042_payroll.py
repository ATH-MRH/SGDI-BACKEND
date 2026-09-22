"""Paie typée (P1-A) — grilles salariales versionnées, cycles de paie, bulletins immuables
après validation.

Revision ID: 20260922_0042
Revises: 20260922_0041
"""
from alembic import op
import sqlalchemy as sa

revision = "20260922_0042"
down_revision = "20260922_0041"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("salary_grids"):
        op.create_table(
            "salary_grids",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("poste", sa.String(150), nullable=False),
            sa.Column("categorie", sa.String(60), nullable=True),
            sa.Column("niveau", sa.String(60), nullable=True),
            sa.Column("salaire_base", MONEY, nullable=False),
            sa.Column("primes_fixes", sa.JSON(), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        for col in ("society", "poste", "effective_from", "effective_to", "status"):
            op.create_index(f"ix_salary_grids_{col}", "salary_grids", [col])

    if not inspector.has_table("payroll_runs"):
        op.create_table(
            "payroll_runs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("period", sa.String(7), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("created_by", sa.String(120), nullable=True),
            sa.Column("validated_by", sa.String(120), nullable=True),
            sa.Column("validated_at", sa.DateTime(), nullable=True),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_payroll_runs_idempotency_key"),
            sa.UniqueConstraint("society", "period", name="uq_payroll_runs_society_period"),
        )
        for col in ("society", "period", "status"):
            op.create_index(f"ix_payroll_runs_{col}", "payroll_runs", [col])

    if not inspector.has_table("payroll_slips"):
        op.create_table(
            "payroll_slips",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("payroll_run_id", sa.Integer(), sa.ForeignKey("payroll_runs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("salary_grid_id", sa.Integer(), sa.ForeignKey("salary_grids.id", ondelete="SET NULL"), nullable=True),
            sa.Column("inputs", sa.JSON(), nullable=False),
            sa.Column("rules_used", sa.JSON(), nullable=False),
            sa.Column("base", MONEY, nullable=False),
            sa.Column("brut", MONEY, nullable=False),
            sa.Column("cotisation_salariale", MONEY, nullable=False, server_default="0"),
            sa.Column("cotisation_patronale", MONEY, nullable=False, server_default="0"),
            sa.Column("imposable", MONEY, nullable=False, server_default="0"),
            sa.Column("irg", MONEY, nullable=False, server_default="0"),
            sa.Column("autres_retenues", MONEY, nullable=False, server_default="0"),
            sa.Column("net", MONEY, nullable=False, server_default="0"),
            sa.Column("net_a_payer", MONEY, nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("obligation_id", sa.Integer(), nullable=True),
            sa.Column("cnas_obligation_id", sa.Integer(), nullable=True),
            sa.Column("irg_obligation_id", sa.Integer(), nullable=True),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("idempotency_key", name="uq_payroll_slips_idempotency_key"),
            sa.UniqueConstraint("payroll_run_id", "employee_id", name="uq_payroll_slips_run_employee"),
        )
        for col in ("payroll_run_id", "employee_id", "society", "status"):
            op.create_index(f"ix_payroll_slips_{col}", "payroll_slips", [col])


def downgrade() -> None:
    op.drop_table("payroll_slips")
    op.drop_table("payroll_runs")
    op.drop_table("salary_grids")
