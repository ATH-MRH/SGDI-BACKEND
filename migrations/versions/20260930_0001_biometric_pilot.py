"""Pointage facial — pilote contrôlé : activation explicite par caméra, périmètre du gabarit.

Additive, aucune donnée modifiée :
- cameras.facial_attendance_enabled (faux par défaut) : une caméra ne pointe que si elle est
  explicitement activée, en plus de BIOMETRIC_ENABLED (coupure immédiate par caméra/site) ;
- biometric_templates.society / site_id : périmètre de l'employé au moment de l'enrôlement.

Revision ID: 20260930_0001
Revises: 20260927_0002
"""
from alembic import op
import sqlalchemy as sa

revision = "20260930_0001"
down_revision = "20260927_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("cameras") as batch:
        batch.add_column(sa.Column("facial_attendance_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("biometric_templates") as batch:
        batch.add_column(sa.Column("society", sa.String(length=150), nullable=True))
        batch.add_column(sa.Column("site_id", sa.Integer(), nullable=True))
        batch.create_index("ix_biometric_templates_society", ["society"])
        batch.create_index("ix_biometric_templates_site_id", ["site_id"])


def downgrade() -> None:
    with op.batch_alter_table("biometric_templates") as batch:
        batch.drop_index("ix_biometric_templates_site_id")
        batch.drop_index("ix_biometric_templates_society")
        batch.drop_column("site_id")
        batch.drop_column("society")
    with op.batch_alter_table("cameras") as batch:
        batch.drop_column("facial_attendance_enabled")
