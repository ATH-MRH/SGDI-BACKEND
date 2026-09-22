"""Revue d'intégrité financière — P0 : une RegulatoryVersion "active" (vérifiée) doit
toujours être liée à une RegulatorySource identifiable (traçabilité obligatoire pour toute
règle utilisée à produire une obligation financière réelle). Contrainte CHECK ajoutée en
DÉFENSE EN PROFONDEUR — le garde applicatif (regulatory.service.add_version/
approve_proposal) est la première ligne, celle-ci protège contre toute écriture qui
contournerait ce chemin. Additive uniquement : aucune ligne existante supprimée/modifiée
(aucune version "active" sans source n'existe à ce stade du dépôt — vérifié par les tests).

Revision ID: 20260922_0044
Revises: 20260922_0043
"""
from alembic import op
import sqlalchemy as sa

revision = "20260922_0044"
down_revision = "20260922_0043"
branch_labels = None
depends_on = None

CONSTRAINT_NAME = "ck_regulatory_versions_active_requires_source"
CONSTRAINT_SQL = "status != 'active' OR source_id IS NOT NULL"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_checks = {c["name"] for c in inspector.get_check_constraints("regulatory_versions")} if inspector.has_table("regulatory_versions") else set()
    if CONSTRAINT_NAME in existing_checks:
        return
    with op.batch_alter_table("regulatory_versions") as batch_op:
        batch_op.create_check_constraint(CONSTRAINT_NAME, CONSTRAINT_SQL)


def downgrade() -> None:
    with op.batch_alter_table("regulatory_versions") as batch_op:
        batch_op.drop_constraint(CONSTRAINT_NAME, type_="check")
