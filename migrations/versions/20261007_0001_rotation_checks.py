"""Planning intelligent — comparaison prévu / réel et décisions OPS (lot 3).

Additive : deux tables neuves, aucune colonne modifiée, aucune ligne créée. Sans effet tant
qu'un site n'est pas passé explicitement en mode ACTIVE.

Revision ID: 20261007_0001
Revises: 20261006_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261007_0001"
down_revision = "20261006_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table("rotation_checks"):
        op.create_table(
            "rotation_checks",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sheet_id", sa.Integer(), sa.ForeignKey("attendance_sheets.id", ondelete="CASCADE"), nullable=False),
            sa.Column("line_id", sa.Integer(), nullable=True),
            sa.Column("event_id", sa.Integer(), nullable=True),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("occurred_at", sa.DateTime(), nullable=False),
            sa.Column("outcome", sa.String(40), nullable=False),
            sa.Column("severity", sa.String(20), nullable=True),
            sa.Column("expected_group", sa.String(12), nullable=True),
            sa.Column("expected_source", sa.String(20), nullable=True),
            sa.Column("expected_start", sa.String(5), nullable=True),
            sa.Column("expected_end", sa.String(5), nullable=True),
            sa.Column("observed_group", sa.String(12), nullable=True),
            sa.Column("observed_start", sa.String(5), nullable=True),
            sa.Column("observed_end", sa.String(5), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=True),
            sa.Column("model_version", sa.Integer(), nullable=True),
            sa.Column("engine_version", sa.String(20), nullable=True),
            sa.Column("explanation", sa.JSON(), nullable=True),
            sa.Column("status", sa.String(20), nullable=True),
            sa.Column("qualification", sa.String(20), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("decided_by", sa.String(120), nullable=True),
            sa.Column("decided_at", sa.DateTime(), nullable=True),
            sa.Column("decision_id", sa.Integer(), nullable=True),
            sa.Column("alert_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("sheet_id", "employee_id", name="uq_rotation_checks_sheet_employee"),
        )
        op.create_index("ix_rotation_checks_sheet_id", "rotation_checks", ["sheet_id"])
        op.create_index("ix_rotation_checks_event_id", "rotation_checks", ["event_id"])
        op.create_index("ix_rotation_checks_outcome", "rotation_checks", ["outcome"])
        op.create_index("ix_rotation_checks_status", "rotation_checks", ["status"])
        op.create_index("ix_rotation_checks_alert_id", "rotation_checks", ["alert_id"])
        op.create_index("ix_rotation_checks_site_occurred", "rotation_checks", ["site_id", "occurred_at"])
        op.create_index("ix_rotation_checks_employee_occurred", "rotation_checks", ["employee_id", "occurred_at"])

    if not inspector.has_table("rotation_decisions"):
        op.create_table(
            "rotation_decisions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(12), nullable=False),
            sa.Column("group_label", sa.String(12), nullable=False),
            sa.Column("previous_group", sa.String(12), nullable=True),
            sa.Column("effective_from", sa.DateTime(), nullable=False),
            sa.Column("effective_to", sa.DateTime(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("validator", sa.String(120), nullable=True),
            sa.Column("validator_user_id", sa.Integer(), nullable=True),
            sa.Column("check_id", sa.Integer(), nullable=True),
            sa.Column("alert_id", sa.Integer(), nullable=True),
            sa.Column("model_confidence", sa.Float(), nullable=True),
            sa.Column("model_version", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_rotation_decisions_employee_id", "rotation_decisions", ["employee_id"])
        op.create_index("ix_rotation_decisions_check_id", "rotation_decisions", ["check_id"])
        op.create_index("ix_rotation_decisions_site_employee", "rotation_decisions", ["site_id", "employee_id", "effective_from"])


def downgrade() -> None:
    for table in ("rotation_decisions", "rotation_checks"):
        op.drop_table(table)
