"""Revue d'intégrité financière — item 12 (fiscalité) : la mission exige que chaque montant
expose sa provenance de façon non ambiguë. Ajoute fiscal_obligations.provenance
("manual" | "calculated_verified"), défaut "manual" (seul mode possible aujourd'hui — G50/
TVA/IBS n'ont AUCUN calcul automatique, exigence explicite de la mission, non implémentée
délibérément). Additive uniquement : toutes les lignes existantes reçoivent "manual" (server_
default), aucune n'est supprimée/modifiée en valeur.

Revision ID: 20260922_0046
Revises: 20260922_0045
"""
from alembic import op
import sqlalchemy as sa

revision = "20260922_0046"
down_revision = "20260922_0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("fiscal_obligations"):
        return
    columns = {c["name"] for c in inspector.get_columns("fiscal_obligations")}
    if "provenance" in columns:
        return
    with op.batch_alter_table("fiscal_obligations") as batch_op:
        batch_op.add_column(sa.Column("provenance", sa.String(30), nullable=False, server_default="manual"))


def downgrade() -> None:
    with op.batch_alter_table("fiscal_obligations") as batch_op:
        batch_op.drop_column("provenance")
