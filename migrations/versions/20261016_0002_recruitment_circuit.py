"""Profils transmis par candidature et file persistante des notifications push.

Aucune donnée historique n'est réécrite. La descente conserve les données pour permettre
un retour au code précédent sans perdre les instantanés ni les reçus.
"""
from alembic import op
import sqlalchemy as sa
from app.modules.recruitment_engage_models import RecruitmentPushDelivery

revision = '20261016_0002'
down_revision = '20261014_0005'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if 'profile_snapshot' not in {c['name'] for c in sa.inspect(bind).get_columns('recruitment_applications')}:
        op.add_column('recruitment_applications', sa.Column('profile_snapshot', sa.JSON(), nullable=True))
    RecruitmentPushDelivery.__table__.create(bind=bind, checkfirst=True)


def downgrade():
    # Additions compatibles avec l'ancien code, conservées même si le studio précédent est repris.
    pass
