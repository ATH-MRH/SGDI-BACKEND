"""Synchronisation automatique photo DRH → référence faciale (LOT B) — état par employé.

Additive, aucune donnée modifiée : la table biometric_photo_syncs garde, pour chaque employé,
l'état de la dernière synchronisation demandée depuis la Fiche de position (empreinte SHA-256
de la photo, état, code de raison). Ni image, ni gabarit, ni score. Aucune ligne n'est créée
par la migration : les photos déjà présentes ne sont pas traitées.

Revision ID: 20261002_0001
Revises: 20260930_0002
"""
from alembic import op
import sqlalchemy as sa

revision = "20261002_0001"
down_revision = "20260930_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("biometric_photo_syncs"):
        op.create_table(
            "biometric_photo_syncs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("photo_fingerprint", sa.String(64), nullable=False),
            sa.Column("status", sa.String(30), nullable=False),
            sa.Column("reason_code", sa.String(40), nullable=True),
            sa.Column("reason_detail", sa.String(200), nullable=True),
            sa.Column("source", sa.String(30), nullable=False),
            sa.Column("requested_by", sa.String(120), nullable=True),
            sa.Column("requested_at", sa.DateTime(), nullable=False),
            sa.Column("analyzed_at", sa.DateTime(), nullable=True),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("template_id", sa.Integer(), nullable=True),
            sa.Column("previous_reference_kept", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_biometric_photo_syncs_employee_id", "biometric_photo_syncs", ["employee_id"], unique=True)
        op.create_index("ix_biometric_photo_syncs_status", "biometric_photo_syncs", ["status"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("biometric_photo_syncs"):
        op.drop_index("ix_biometric_photo_syncs_status", table_name="biometric_photo_syncs")
        op.drop_index("ix_biometric_photo_syncs_employee_id", table_name="biometric_photo_syncs")
        op.drop_table("biometric_photo_syncs")
