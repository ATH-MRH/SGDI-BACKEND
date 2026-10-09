"""OTP candidat et file SMS privée (désactivée par défaut).

Revision ID: 20261008_sms
Revises: 20261010_0001
"""
from alembic import op
from app.modules.recruitment_sms_models import RecruitmentSMSChallenge, RecruitmentSMSRate, RecruitmentSMSGateway
revision = '20261008_sms'
down_revision = '20261010_0001'
branch_labels = None
depends_on = None


def upgrade():
    for model in (RecruitmentSMSChallenge, RecruitmentSMSRate, RecruitmentSMSGateway):
        model.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    for model in (RecruitmentSMSGateway, RecruitmentSMSRate, RecruitmentSMSChallenge):
        model.__table__.drop(bind=op.get_bind(), checkfirst=True)
