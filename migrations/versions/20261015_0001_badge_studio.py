"""Studio Badges DRH : modèles, badges émis (instantané), historique et paramètres.

Additive : quatre nouvelles tables, aucune table existante modifiée. Le retour arrière conserve
ces tables dès qu'elles contiennent des données (voir downgrade).

Revision ID: 20261015_0001
Revises: 20261014_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261015_0001"
down_revision = "20261014_0001"
branch_labels = None
depends_on = None


def _timestamps() -> list[sa.Column]:
    return [sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=True)]


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "badge_templates" not in tables:
        op.create_table(
            "badge_templates",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("width_mm", sa.Float(), nullable=False),
            sa.Column("height_mm", sa.Float(), nullable=False),
            sa.Column("design", sa.JSON(), nullable=False),
            sa.Column("is_default", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_system", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("system_key", sa.String(40), nullable=True, unique=True),
            sa.Column("active", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_by", sa.String(80), nullable=True),
            sa.Column("updated_by", sa.String(80), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_badge_templates_society", "badge_templates", ["society"])
        op.create_index("ix_badge_templates_active", "badge_templates", ["active"])

    if "employee_badges" not in tables:
        op.create_table(
            "employee_badges",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("number", sa.String(40), nullable=True, unique=True),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
            sa.Column("template_id", sa.Integer(), sa.ForeignKey("badge_templates.id", ondelete="SET NULL"), nullable=True),
            sa.Column("template_name", sa.String(150), nullable=True),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="ACTIF"),
            sa.Column("snapshot", sa.JSON(), nullable=False),
            sa.Column("design", sa.JSON(), nullable=False),
            sa.Column("width_mm", sa.Float(), nullable=False),
            sa.Column("height_mm", sa.Float(), nullable=False),
            sa.Column("photo", sa.LargeBinary(), nullable=True),
            sa.Column("issued_at", sa.DateTime(), nullable=False),
            sa.Column("issued_by", sa.String(80), nullable=True),
            sa.Column("valid_until", sa.Date(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_by", sa.String(80), nullable=True),
            sa.Column("revoke_reason", sa.Text(), nullable=True),
            sa.Column("print_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_printed_at", sa.DateTime(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_employee_badges_employee_id", "employee_badges", ["employee_id"])
        op.create_index("ix_employee_badges_employee_status", "employee_badges", ["employee_id", "status"])
        op.create_index("ix_employee_badges_society_status", "employee_badges", ["society", "status"])

    if "badge_events" not in tables:
        op.create_table(
            "badge_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("action", sa.String(40), nullable=False),
            sa.Column("badge_id", sa.Integer(), sa.ForeignKey("employee_badges.id", ondelete="SET NULL"), nullable=True),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
            sa.Column("template_id", sa.Integer(), sa.ForeignKey("badge_templates.id", ondelete="SET NULL"), nullable=True),
            sa.Column("society", sa.String(150), nullable=True),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("username", sa.String(80), nullable=True),
            sa.Column("label", sa.String(300), nullable=True),
            sa.Column("details", sa.JSON(), nullable=True),
        )
        op.create_index("ix_badge_events_created_at", "badge_events", ["created_at"])
        op.create_index("ix_badge_events_action", "badge_events", ["action"])
        op.create_index("ix_badge_events_badge_id", "badge_events", ["badge_id"])
        op.create_index("ix_badge_events_employee_id", "badge_events", ["employee_id"])
        op.create_index("ix_badge_events_society_created", "badge_events", ["society", "created_at"])

    if "badge_settings" not in tables:
        op.create_table(
            "badge_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("scope", sa.String(150), nullable=False, unique=True),
            sa.Column("data", sa.JSON(), nullable=False),
            sa.Column("updated_by", sa.String(80), nullable=True),
            *_timestamps(),
        )


def downgrade() -> None:
    """Non destructif : dès qu'un badge, un événement, un réglage ou un modèle personnalisé
    existe, les tables sont CONSERVÉES (seule la révision recule) ; upgrade() les retrouve
    telles quelles. Elles ne sont supprimées que si le studio n'a jamais servi."""
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    used = False
    for table, where in (("employee_badges", ""), ("badge_events", ""), ("badge_settings", ""), ("badge_templates", " WHERE is_system = 0")):
        if table in tables and bind.execute(sa.text(f"SELECT 1 FROM {table}{where} LIMIT 1")).first():
            used = True
    if used:
        print("Studio Badges : données présentes, tables conservées (retour arrière non destructif).")
        return
    for table in ("badge_settings", "badge_events", "employee_badges", "badge_templates"):
        if table in tables:
            op.drop_table(table)
