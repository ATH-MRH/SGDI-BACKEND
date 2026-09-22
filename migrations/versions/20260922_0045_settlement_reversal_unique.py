"""Revue d'intégrité financière — P0 : un règlement (Settlement) ne doit jamais pouvoir être
annulé deux fois. Rien n'empêchait auparavant de créer deux Settlement kind="reversal" avec
le même reversed_settlement_id (idempotency_key différentes à chaque tentative) — chaque
annulation décrémente amount_settled, une double annulation aurait pu artificiellement
rouvrir une obligation déjà soldée et permettre un second règlement réel derrière (vecteur de
double paiement). Index UNIQUE ajouté en DÉFENSE EN PROFONDEUR (le garde applicatif,
finance_core.service.reverse_settlement, est la première ligne ; voir aussi le patron déjà
établi par la migration 20260922_0044 pour cette même philosophie). NULL autorisé en
répétition (un règlement normal n'a pas de reversed_settlement_id) — seule une valeur non
NULL doit être unique, ce que garantit un index UNIQUE standard (NULLs non comparés entre eux
en SQL). Additive uniquement : aucune ligne existante supprimée/modifiée (aucun doublon de
reversed_settlement_id n'existe à ce stade du dépôt — vérifié par les tests).

Revision ID: 20260922_0045
Revises: 20260922_0044
"""
from alembic import op
import sqlalchemy as sa

revision = "20260922_0045"
down_revision = "20260922_0044"
branch_labels = None
depends_on = None

INDEX_NAME = "ix_settlements_reversed_settlement_id_unique"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("settlements"):
        return
    existing = {ix["name"] for ix in inspector.get_indexes("settlements")}
    if INDEX_NAME in existing:
        return
    op.create_index(INDEX_NAME, "settlements", ["reversed_settlement_id"], unique=True)


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="settlements")
