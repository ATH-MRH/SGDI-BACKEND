"""IRON Emploi : messages, entretiens, alertes, notifications, appareils et présentation des sociétés.

Révision additive, distincte de 20261014_0001 : onze nouvelles tables et des colonnes ajoutées à
trois tables IRON Emploi (traitement par candidature, présentation des sociétés, préférences). Rejouable (créations et ajouts conditionnels).

Revision ID: 20261014_0002
Revises: 20261014_0001
"""
import sqlalchemy as sa
from alembic import op

from app.modules.recruitment_engage_models import (
    RecruitmentApplicationContract, RecruitmentApplicationDocument, RecruitmentApplicationEvent, RecruitmentApplicationNote,
    RecruitmentDocumentRequest, RecruitmentInterview, RecruitmentJobAlert, RecruitmentMessage, RecruitmentNotification,
    RecruitmentPushDevice, RecruitmentTip,
)

revision = '20261014_0002'
down_revision = '20261014_0001'
branch_labels = None
depends_on = None

MODELS = (RecruitmentMessage, RecruitmentInterview, RecruitmentJobAlert, RecruitmentNotification, RecruitmentPushDevice,
          RecruitmentApplicationDocument, RecruitmentDocumentRequest, RecruitmentApplicationNote, RecruitmentApplicationEvent,
          RecruitmentApplicationContract, RecruitmentTip)
COLUMNS = {
    'recruitment_companies': lambda: [sa.Column('activities', sa.Text(), nullable=True), sa.Column('locations', sa.String(300), nullable=True),
                                      sa.Column('headcount', sa.String(60), nullable=True)],
    'recruitment_applications': lambda: [
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('stage', sa.String(20), nullable=False, server_default='received'),
        sa.Column('outcome', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('outcome_communicated_at', sa.DateTime(), nullable=True), sa.Column('assigned_to', sa.String(100), nullable=True),
        sa.Column('next_action', sa.String(200), nullable=True), sa.Column('next_action_due', sa.Date(), nullable=True),
        sa.Column('withdrawn_at', sa.DateTime(), nullable=True)],
    'recruitment_candidate_accounts': lambda: [sa.Column('settings', sa.JSON(), nullable=True)],
}


INDEXED = {'recruitment_applications': ('stage', 'outcome', 'assigned_to')}


def _existing(table: str) -> set[str]:
    return {column['name'] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {index['name'] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade():
    # 20261014_0001 crée ses tables depuis les modèles courants : sur une base neuve les colonnes
    # et leurs index existent déjà, d'où les ajouts conditionnels.
    for table, columns in COLUMNS.items():
        present = _existing(table)
        for column in columns():
            if column.name not in present:
                op.add_column(table, column)
        indexes = _indexes(table)
        for name in INDEXED.get(table, ()):
            if f'ix_{table}_{name}' not in indexes:
                op.create_index(f'ix_{table}_{name}', table, [name])
    for model in MODELS:
        model.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    for model in reversed(MODELS):
        model.__table__.drop(bind=op.get_bind(), checkfirst=True)
    for table, columns in COLUMNS.items():
        indexes = _indexes(table)
        for name in INDEXED.get(table, ()):
            if f'ix_{table}_{name}' in indexes:
                op.drop_index(f'ix_{table}_{name}', table_name=table)
        present = _existing(table)
        for column in columns():
            if column.name in present:
                op.drop_column(table, column.name)
