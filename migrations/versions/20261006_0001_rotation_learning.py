"""Planning intelligent — apprentissage des groupes et cycles de rotation (lot 2).

Additive : six tables neuves, aucune colonne modifiée, aucune ligne créée. Le moteur reste
inactif tant que ROTATION_LEARNING_ENABLED n'est pas posé ET qu'un site n'est pas passé
explicitement en mode LEARNING / ACTIVE.

Revision ID: 20261006_0001
Revises: 20261005_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261006_0001"
down_revision = "20261005_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table("rotation_site_models"):
        op.create_table(
            "rotation_site_models",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("mode", sa.String(12), nullable=False, server_default="OFF"),
            sa.Column("state", sa.String(20), nullable=False, server_default="LEARNING"),
            sa.Column("reasons", sa.JSON(), nullable=True),
            sa.Column("params", sa.JSON(), nullable=True),
            sa.Column("sheets_observed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("days_observed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("groups_detected", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("mean_confidence", sa.Float(), nullable=True),
            sa.Column("cycle", sa.JSON(), nullable=True),
            sa.Column("model_version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("fingerprint", sa.String(64), nullable=True),
            sa.Column("engine_version", sa.String(20), nullable=True),
            sa.Column("computed_at", sa.DateTime(), nullable=True),
            sa.Column("updated_by", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("site_id", name="uq_rotation_site_models_site"),
        )

    if not inspector.has_table("rotation_sheet_observations"):
        op.create_table(
            "rotation_sheet_observations",
            sa.Column("sheet_id", sa.Integer(), sa.ForeignKey("attendance_sheets.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("members_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("group_label", sa.String(12), nullable=True),
            sa.Column("engine_version", sa.String(20), nullable=False),
            sa.Column("processed_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_rotation_sheet_observations_site_id", "rotation_sheet_observations", ["site_id"])

    if not inspector.has_table("rotation_groups"):
        op.create_table(
            "rotation_groups",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("label", sa.String(12), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="LEARNING"),
            sa.Column("sheets_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("members_probable", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("members_learning", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("usual_start", sa.String(5), nullable=True),
            sa.Column("usual_end", sa.String(5), nullable=True),
            sa.Column("usual_share", sa.Float(), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=True),
            sa.Column("last_observed_at", sa.DateTime(), nullable=True),
            sa.Column("explanation", sa.JSON(), nullable=True),
            sa.Column("model_version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("site_id", "label", name="uq_rotation_groups_site_label"),
        )
        op.create_index("ix_rotation_groups_site_id", "rotation_groups", ["site_id"])

    if not inspector.has_table("rotation_memberships"):
        op.create_table(
            "rotation_memberships",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("declared_group", sa.String(12), nullable=True),
            sa.Column("learned_group", sa.String(12), nullable=True),
            sa.Column("confirmed_group", sa.String(12), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="LEARNING"),
            sa.Column("source", sa.String(20), nullable=False, server_default="LEARNED"),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
            sa.Column("observations", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("with_group", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("first_observed_at", sa.DateTime(), nullable=True),
            sa.Column("last_observed_at", sa.DateTime(), nullable=True),
            sa.Column("explanation", sa.JSON(), nullable=True),
            sa.Column("model_version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("site_id", "employee_id", name="uq_rotation_memberships_site_employee"),
        )
        op.create_index("ix_rotation_memberships_site_id", "rotation_memberships", ["site_id"])
        op.create_index("ix_rotation_memberships_employee_id", "rotation_memberships", ["employee_id"])

    if not inspector.has_table("rotation_membership_history"):
        op.create_table(
            "rotation_membership_history",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("old_group", sa.String(12), nullable=True),
            sa.Column("new_group", sa.String(12), nullable=True),
            sa.Column("old_status", sa.String(20), nullable=True),
            sa.Column("new_status", sa.String(20), nullable=True),
            sa.Column("old_confidence", sa.Float(), nullable=True),
            sa.Column("new_confidence", sa.Float(), nullable=True),
            sa.Column("source", sa.String(20), nullable=False, server_default="LEARNED"),
            sa.Column("source_sheet_id", sa.Integer(), nullable=True),
            sa.Column("actor", sa.String(120), nullable=True),
            sa.Column("engine_version", sa.String(20), nullable=True),
            sa.Column("model_version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("changed_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_rotation_membership_history_site_id", "rotation_membership_history", ["site_id"])
        op.create_index("ix_rotation_membership_history_employee", "rotation_membership_history", ["employee_id", "changed_at"])

    if not inspector.has_table("rotation_model_versions"):
        op.create_table(
            "rotation_model_versions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("effective_at", sa.DateTime(), nullable=False),
            sa.Column("state", sa.String(20), nullable=False),
            sa.Column("previous_state", sa.String(20), nullable=True),
            sa.Column("params", sa.JSON(), nullable=True),
            sa.Column("groups", sa.JSON(), nullable=True),
            sa.Column("cycle", sa.JSON(), nullable=True),
            sa.Column("reasons", sa.JSON(), nullable=True),
            sa.Column("sheets_observed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("mean_confidence", sa.Float(), nullable=True),
            sa.Column("fingerprint", sa.String(64), nullable=False),
            sa.Column("engine_version", sa.String(20), nullable=False),
            sa.Column("source", sa.String(20), nullable=False, server_default="LEARNED"),
            sa.Column("source_sheet_id", sa.Integer(), nullable=True),
            sa.Column("actor", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("site_id", "version", name="uq_rotation_model_versions_site_version"),
        )
        op.create_index("ix_rotation_model_versions_site_id", "rotation_model_versions", ["site_id"])


def downgrade() -> None:
    for table in ("rotation_model_versions", "rotation_membership_history", "rotation_memberships", "rotation_groups",
                  "rotation_sheet_observations", "rotation_site_models"):
        op.drop_table(table)
