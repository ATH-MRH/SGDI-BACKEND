"""Lot 0.6-A : fondations du moteur d'alertes déterministes (alert_rules,
alerts, alert_evidence, alert_history, detection_runs).

Purement structurel : aucune alerte n'est créée ici, aucune permission,
aucun utilisateur modifié, aucune conversion legacy. Le catalogue de règles
canoniques (AlertRule) est seedé par le code applicatif de façon idempotente
(app.modules.alerts.repository.ensure_rule_catalog), jamais par cette
migration.

Revision ID: 20260913_0035
Revises: 20260908_0034
"""
from alembic import op
import sqlalchemy as sa


revision = "20260913_0035"
down_revision = "20260908_0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("alert_rules"):
        op.create_table(
            "alert_rules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("rule_key", sa.String(120), nullable=False),
            sa.Column("rule_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("label", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("module_key", sa.String(60), nullable=False),
            sa.Column("feature_key", sa.String(80), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("severity_base", sa.String(20), nullable=False, server_default="info"),
            sa.Column("configuration_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("rule_key", "rule_version", name="uq_alert_rules_key_version"),
        )
        op.create_index("ix_alert_rules_rule_key", "alert_rules", ["rule_key"])
        op.create_index("ix_alert_rules_module_key", "alert_rules", ["module_key"])
        op.create_index("ix_alert_rules_enabled", "alert_rules", ["enabled"])

    inspector = sa.inspect(bind)
    if not inspector.has_table("alerts"):
        op.create_table(
            "alerts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("rule_key", sa.String(120), nullable=False),
            sa.Column("rule_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("source_type", sa.String(60), nullable=False),
            sa.Column("source_id", sa.String(60), nullable=False),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="open"),
            sa.Column("severity", sa.String(20), nullable=False, server_default="info"),
            sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("confidence", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("title", sa.String(240), nullable=False),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("first_detected_at", sa.DateTime(), nullable=False),
            sa.Column("last_detected_at", sa.DateTime(), nullable=False),
            sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("assigned_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
            sa.Column("acknowledged_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("treated_at", sa.DateTime(), nullable=True),
            sa.Column("treated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("ignored_at", sa.DateTime(), nullable=True),
            sa.Column("ignored_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("ignore_reason", sa.Text(), nullable=True),
            sa.Column("deferred_until", sa.DateTime(), nullable=True),
            sa.Column("dedup_key", sa.String(300), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("dedup_key", name="uq_alerts_dedup_key"),
        )
        for column in ("rule_key", "source_type", "source_id", "society", "site_id", "status", "severity", "assigned_user_id", "dedup_key"):
            op.create_index(f"ix_alerts_{column}", "alerts", [column])

    inspector = sa.inspect(bind)
    if not inspector.has_table("alert_evidence"):
        op.create_table(
            "alert_evidence",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("alert_id", sa.Integer(), sa.ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("evidence_type", sa.String(60), nullable=False),
            sa.Column("evidence_key", sa.String(120), nullable=False),
            sa.Column("evidence_value_json", sa.JSON(), nullable=True),
            sa.Column("observed_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_alert_evidence_alert_id", "alert_evidence", ["alert_id"])

    inspector = sa.inspect(bind)
    if not inspector.has_table("alert_history"):
        op.create_table(
            "alert_history",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("alert_id", sa.Integer(), sa.ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("action", sa.String(40), nullable=False),
            sa.Column("previous_status", sa.String(30), nullable=True),
            sa.Column("new_status", sa.String(30), nullable=True),
            sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("correlation_id", sa.String(80), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_alert_history_alert_id", "alert_history", ["alert_id"])
        op.create_index("ix_alert_history_action", "alert_history", ["action"])
        op.create_index("ix_alert_history_correlation_id", "alert_history", ["correlation_id"])

    inspector = sa.inspect(bind)
    if not inspector.has_table("detection_runs"):
        op.create_table(
            "detection_runs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("detector_key", sa.String(120), nullable=False),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="running"),
            sa.Column("scanned_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("detected_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error_summary", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_detection_runs_detector_key", "detection_runs", ["detector_key"])
        op.create_index("ix_detection_runs_status", "detection_runs", ["status"])


def downgrade() -> None:
    op.drop_table("detection_runs")
    op.drop_table("alert_history")
    op.drop_table("alert_evidence")
    op.drop_table("alerts")
    op.drop_table("alert_rules")
