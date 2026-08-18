"""Portail client : nouvelles tables + colonnes de rattachement

Ajoute le module de signalement client (comptes nominatifs externes,
observations/signalements sur les agents) : deux nouvelles tables
(client_portal_users, client_observations), un lien fiable Site -> Client
(client_id, en remplacement du texte libre non fiabilisé Site.client_name
pour toute logique de sécurité/visibilité), et le sous-domaine dédié par
client (Client.portal_slug/portal_enabled).

Revision ID: 20260818_0019
Revises: 20260726_0018
Create Date: 2026-08-18
"""
from alembic import op
import sqlalchemy as sa

revision = "20260818_0019"
down_revision = "20260726_0018"
branch_labels = None
depends_on = None


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    # app/main.py appelle Base.metadata.create_all() à CHAQUE démarrage (voir
    # 20260529_0005_erp_modules.py pour le même souci) : au premier démarrage suivant ce
    # déploiement, les deux nouvelles tables ci-dessous auront déjà été créées par
    # create_all() avant même que cette migration ne tourne. On protège donc chaque
    # opération individuellement plutôt que de supposer un état "tout ou rien".
    if not _column_exists("clients", "portal_slug"):
        op.add_column("clients", sa.Column("portal_slug", sa.String(80), nullable=True))
        op.create_unique_constraint("uq_clients_portal_slug", "clients", ["portal_slug"])
        op.create_index("ix_clients_portal_slug", "clients", ["portal_slug"])
    if not _column_exists("clients", "portal_enabled"):
        op.add_column("clients", sa.Column("portal_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))

    if not _column_exists("sites", "client_id"):
        op.add_column("sites", sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id", ondelete="SET NULL"), nullable=True))
        op.create_index("ix_sites_client_id", "sites", ["client_id"])

    if _table_exists("client_portal_users") and _table_exists("client_observations"):
        return

    op.create_table(
        "client_portal_users",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("full_name", sa.String(150), nullable=False),
        sa.Column("username", sa.String(80), nullable=False, unique=True, index=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "client_observations",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("client_user_id", sa.Integer(), sa.ForeignKey("client_portal_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("kind", sa.String(20), nullable=False, server_default="observation", index=True),
        sa.Column("categories", sa.JSON(), nullable=True),
        sa.Column("severity", sa.String(20), nullable=False, server_default="normale", index=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("incident_date", sa.Date(), nullable=False, index=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="nouveau", index=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("resolved_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("client_observations")
    op.drop_table("client_portal_users")
    op.drop_index("ix_sites_client_id", table_name="sites")
    op.drop_column("sites", "client_id")
    op.drop_column("clients", "portal_enabled")
    op.drop_index("ix_clients_portal_slug", table_name="clients")
    op.drop_constraint("uq_clients_portal_slug", "clients", type_="unique")
    op.drop_column("clients", "portal_slug")
