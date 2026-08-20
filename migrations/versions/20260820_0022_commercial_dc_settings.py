"""Ajoute les réglages du module Commercial autonome (dc.irongs.com).

Revision ID: 20260820_0022
Revises: 20260820_0021
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa


revision = "20260820_0022"
down_revision = "20260820_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("commercial_dc_settings"):
        op.create_table(
            "commercial_dc_settings",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("default_tva", sa.Float(), nullable=False, server_default="19"),
            sa.Column("devis_prefix", sa.String(length=20), nullable=False, server_default="DEV-"),
            sa.Column("commande_prefix", sa.String(length=20), nullable=False, server_default="CMD-"),
            sa.Column("bl_prefix", sa.String(length=20), nullable=False, server_default="BL-"),
            sa.Column("active_societies", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("commercial_dc_settings"):
        op.drop_table("commercial_dc_settings")
