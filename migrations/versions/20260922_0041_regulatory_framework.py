"""Référentiel réglementaire versionné (P1-A dépendance) — sources, règles, versions,
propositions de changement.

Revision ID: 20260922_0041
Revises: 20260922_0040
"""
from alembic import op
import sqlalchemy as sa

revision = "20260922_0041"
down_revision = "20260922_0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("regulatory_sources"):
        op.create_table(
            "regulatory_sources",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(220), nullable=False),
            sa.Column("reference", sa.String(255), nullable=True),
            sa.Column("reliability", sa.String(20), nullable=False, server_default="unverified"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_regulatory_sources_reliability", "regulatory_sources", ["reliability"])

    if not inspector.has_table("regulatory_rules"):
        op.create_table(
            "regulatory_rules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("rule_type", sa.String(60), nullable=False),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("label", sa.String(220), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_regulatory_rules_rule_type", "regulatory_rules", ["rule_type"])
        op.create_index("ix_regulatory_rules_society", "regulatory_rules", ["society"])

    if not inspector.has_table("regulatory_versions"):
        op.create_table(
            "regulatory_versions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("rule_id", sa.Integer(), sa.ForeignKey("regulatory_rules.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("parameters", sa.JSON(), nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), nullable=True),
            sa.Column("source_id", sa.Integer(), sa.ForeignKey("regulatory_sources.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="unverified"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_regulatory_versions_rule_id", "regulatory_versions", ["rule_id"])
        op.create_index("ix_regulatory_versions_effective_from", "regulatory_versions", ["effective_from"])
        op.create_index("ix_regulatory_versions_effective_to", "regulatory_versions", ["effective_to"])
        op.create_index("ix_regulatory_versions_status", "regulatory_versions", ["status"])
        op.create_index("ix_regulatory_versions_rule_window", "regulatory_versions", ["rule_id", "effective_from", "effective_to"])

    if not inspector.has_table("regulatory_change_proposals"):
        op.create_table(
            "regulatory_change_proposals",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("rule_id", sa.Integer(), sa.ForeignKey("regulatory_rules.id", ondelete="SET NULL"), nullable=True),
            sa.Column("proposed_parameters", sa.JSON(), nullable=False),
            sa.Column("proposed_effective_from", sa.Date(), nullable=False),
            sa.Column("diff_summary", sa.Text(), nullable=True),
            sa.Column("detected_from", sa.String(40), nullable=False, server_default="manual"),
            sa.Column("source_id", sa.Integer(), sa.ForeignKey("regulatory_sources.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="proposed"),
            sa.Column("reviewed_by", sa.String(120), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("resulting_version_id", sa.Integer(), sa.ForeignKey("regulatory_versions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_regulatory_change_proposals_status", "regulatory_change_proposals", ["status"])


def downgrade() -> None:
    op.drop_table("regulatory_change_proposals")
    op.drop_table("regulatory_versions")
    op.drop_table("regulatory_rules")
    op.drop_table("regulatory_sources")
