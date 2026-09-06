"""Ajoute la gestion des prêts et avances aux employés.

Revision ID: 20260906_0029
Revises: 20260905_0028
"""
from alembic import op
import sqlalchemy as sa


revision = "20260906_0029"
down_revision = "20260905_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("employee_loan_requests"):
        op.create_table(
            "employee_loan_requests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("reference", sa.String(40), unique=True, nullable=True),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_code", sa.String(30), nullable=False),
            sa.Column("employee_name", sa.String(220), nullable=False),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("request_type", sa.String(20), nullable=False),
            sa.Column("amount_requested", sa.Float(), nullable=False),
            sa.Column("installments_requested", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("payroll_deduction_consent", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("status", sa.String(30), nullable=False, server_default="submitted"),
            sa.Column("eligibility_snapshot", sa.JSON(), nullable=True),
            sa.Column("amount_approved", sa.Float(), nullable=True),
            sa.Column("installments_approved", sa.Integer(), nullable=True),
            sa.Column("monthly_installment", sa.Float(), nullable=True),
            sa.Column("interest_rate", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_due", sa.Float(), nullable=True),
            sa.Column("balance_due", sa.Float(), nullable=True),
            sa.Column("first_due_date", sa.Date(), nullable=True),
            sa.Column("decision_note", sa.Text(), nullable=True),
            sa.Column("recommendation", sa.String(20), nullable=True),
            sa.Column("reviewed_by", sa.String(120), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("decided_by", sa.String(120), nullable=True),
            sa.Column("decided_at", sa.DateTime(), nullable=True),
            sa.Column("decision_reference", sa.String(50), unique=True, nullable=True),
            sa.Column("decision_signed_by", sa.String(120), nullable=True),
            sa.Column("decision_signed_at", sa.DateTime(), nullable=True),
            sa.Column("contract_reference", sa.String(50), unique=True, nullable=True),
            sa.Column("beneficiary_signed_at", sa.DateTime(), nullable=True),
            sa.Column("beneficiary_signature_confirmed_by", sa.String(120), nullable=True),
            sa.Column("secretariat_received_at", sa.DateTime(), nullable=True),
            sa.Column("cash_notified_at", sa.DateTime(), nullable=True),
            sa.Column("disbursed_by", sa.String(120), nullable=True),
            sa.Column("disbursed_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        for column in ("reference", "employee_id", "employee_code", "employee_name", "society", "request_type", "status", "decision_reference", "contract_reference"):
            op.create_index(f"ix_employee_loan_requests_{column}", "employee_loan_requests", [column])
    inspector = sa.inspect(bind)
    if not inspector.has_table("employee_loan_repayments"):
        op.create_table(
            "employee_loan_repayments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("loan_request_id", sa.Integer(), sa.ForeignKey("employee_loan_requests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("payment_date", sa.Date(), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("method", sa.String(30), nullable=False, server_default="payroll"),
            sa.Column("payroll_period", sa.String(7), nullable=True),
            sa.Column("reference", sa.String(100), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("recorded_by", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        for column in ("loan_request_id", "payment_date", "payroll_period"):
            op.create_index(f"ix_employee_loan_repayments_{column}", "employee_loan_repayments", [column])
    inspector = sa.inspect(bind)
    if not inspector.has_table("loan_workflow_notifications"):
        op.create_table(
            "loan_workflow_notifications",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("loan_request_id", sa.Integer(), sa.ForeignKey("employee_loan_requests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("recipient_role", sa.String(30), nullable=False),
            sa.Column("recipient_host", sa.String(120), nullable=False),
            sa.Column("event_type", sa.String(50), nullable=False),
            sa.Column("title", sa.String(180), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="unread"),
            sa.Column("read_by", sa.String(120), nullable=True),
            sa.Column("read_at", sa.DateTime(), nullable=True),
            sa.Column("processed_by", sa.String(120), nullable=True),
            sa.Column("processed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        for column in ("loan_request_id", "recipient_role", "event_type", "status"):
            op.create_index(f"ix_loan_workflow_notifications_{column}", "loan_workflow_notifications", [column])


def downgrade() -> None:
    op.drop_table("loan_workflow_notifications")
    op.drop_table("employee_loan_repayments")
    op.drop_table("employee_loan_requests")
