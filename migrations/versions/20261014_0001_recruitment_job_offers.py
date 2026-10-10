"""IRON Emploi : sociétés, annonces, espaces candidats et candidatures liées aux annonces.

Migration purement additive : cinq nouvelles tables, aucune table existante modifiée.
Les candidatures historiques et spontanées restent dans `candidates`, inchangées.

Revision ID: 20261014_0001
Revises: 20261013_0002
"""
from alembic import op

from app.modules.recruitment_jobs_models import (
    RecruitmentApplication, RecruitmentCandidateAccount, RecruitmentCandidateSession, RecruitmentCompany, RecruitmentJobOffer,
)

revision = '20261014_0001'
down_revision = '20261013_0002'
branch_labels = None
depends_on = None

# Ordre des dépendances (clés étrangères).
MODELS = (RecruitmentCompany, RecruitmentJobOffer, RecruitmentCandidateAccount, RecruitmentCandidateSession, RecruitmentApplication)


def upgrade():
    for model in MODELS:
        model.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    for model in reversed(MODELS):
        model.__table__.drop(bind=op.get_bind(), checkfirst=True)
