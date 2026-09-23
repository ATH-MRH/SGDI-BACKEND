"""ATLAS Site Workforce — trois tables neuves (reclamations, transmissions,
site_notifications) + colonnes additives sur documents (workflow de vérification d'un
justificatif, §B9/§B10 : validity_status/verified_by/verified_at/comment SÉPARÉS du
statut de la décision d'absence elle-même — celle-ci vit dans daily_presence.data (JSON
déjà existant), aucune colonne nouvelle nécessaire sur daily_presence).

Revision ID: 20260923_0001
Revises: 20260922_0046
"""
from alembic import op
import sqlalchemy as sa

revision = "20260923_0001"
down_revision = "20260922_0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("reclamations"):
        op.create_table(
            "reclamations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("category", sa.String(80), nullable=True),
            sa.Column("subject", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("priority", sa.String(20), nullable=False, server_default="normale"),
            sa.Column("status", sa.String(30), nullable=False, server_default="nouvelle"),
            sa.Column("response", sa.Text(), nullable=True),
            sa.Column("responded_by", sa.String(120), nullable=True),
            sa.Column("responded_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        for col in ("employee_id", "site_id", "status"):
            op.create_index(f"ix_reclamations_{col}", "reclamations", [col])

    if not inspector.has_table("transmissions"):
        op.create_table(
            "transmissions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("resource_type", sa.String(40), nullable=False),
            sa.Column("resource_id", sa.Integer(), nullable=False),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("destinataire", sa.String(30), nullable=False),
            sa.Column("objet", sa.String(200), nullable=False),
            sa.Column("commentaire", sa.Text(), nullable=True),
            sa.Column("priority", sa.String(20), nullable=False, server_default="normale"),
            sa.Column("source", sa.String(60), nullable=False),
            sa.Column("created_by", sa.String(120), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="envoyee"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        for col in ("resource_type", "resource_id", "site_id", "destinataire", "status"):
            op.create_index(f"ix_transmissions_{col}", "transmissions", [col])

    if not inspector.has_table("site_notifications"):
        op.create_table(
            "site_notifications",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
            sa.Column("notif_type", sa.String(40), nullable=False),
            sa.Column("message", sa.String(300), nullable=False),
            sa.Column("level", sa.String(20), nullable=False, server_default="info"),
            sa.Column("status", sa.String(20), nullable=False, server_default="nouvelle"),
            sa.Column("read_at", sa.DateTime(), nullable=True),
            sa.Column("read_by", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        for col in ("site_id", "employee_id", "notif_type", "status"):
            op.create_index(f"ix_site_notifications_{col}", "site_notifications", [col])

    if inspector.has_table("documents"):
        columns = {c["name"] for c in inspector.get_columns("documents")}
        with op.batch_alter_table("documents") as batch_op:
            if "validity_status" not in columns:
                # "en_attente" | "conforme" | "non_conforme" — jamais fusionné avec le statut
                # de la décision d'absence (daily_presence.data), voir §B9.
                batch_op.add_column(sa.Column("validity_status", sa.String(20), nullable=False, server_default="en_attente"))
            if "verified_by" not in columns:
                batch_op.add_column(sa.Column("verified_by", sa.String(120), nullable=True))
            if "verified_at" not in columns:
                batch_op.add_column(sa.Column("verified_at", sa.DateTime(), nullable=True))
            if "comment" not in columns:
                batch_op.add_column(sa.Column("comment", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("documents") as batch_op:
        batch_op.drop_column("comment")
        batch_op.drop_column("verified_at")
        batch_op.drop_column("verified_by")
        batch_op.drop_column("validity_status")
    op.drop_table("site_notifications")
    op.drop_table("transmissions")
    op.drop_table("reclamations")
