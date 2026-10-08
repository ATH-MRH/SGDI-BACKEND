"""Suivi d'envoi SMSGate sur les codes candidats (accepté, envoyé, livré).

Revision ID: 20261011_0001
Revises: 20261008_sms
"""
import sqlalchemy as sa
from alembic import op

revision = '20261011_0001'
down_revision = '20261008_sms'
branch_labels = None
depends_on = None

TABLE = 'recruitment_sms_challenges'
UNIQUE = 'uq_recruitment_sms_challenges_gateway_message_id'
INDEX = 'ix_recruitment_sms_challenges_delivery_status'


def _columns():
    return [
        sa.Column('gateway_message_id', sa.String(36), nullable=True),
        sa.Column('delivery_status', sa.String(20), nullable=False, server_default='queued'),
        sa.Column('delivery_error', sa.String(120), nullable=True),
        sa.Column('next_attempt_at', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status_checked_at', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('accepted_at', sa.Integer(), nullable=True),
        sa.Column('sent_at', sa.Integer(), nullable=True),
        sa.Column('delivered_at', sa.Integer(), nullable=True),
    ]


def _state():
    inspector = sa.inspect(op.get_bind())
    return ({column['name'] for column in inspector.get_columns(TABLE)}, {index['name'] for index in inspector.get_indexes(TABLE)})


def upgrade():
    # 20261008_sms crée la table depuis le modèle courant : sur une base neuve les colonnes
    # existent déjà, d'où l'ajout conditionnel (migration rejouable).
    columns, indexes = _state()
    for column in _columns():
        if column.name not in columns:
            op.add_column(TABLE, column)
    if UNIQUE not in indexes:
        op.create_index(UNIQUE, TABLE, ['gateway_message_id'], unique=True)
    if INDEX not in indexes:
        op.create_index(INDEX, TABLE, ['delivery_status'])


def downgrade():
    columns, indexes = _state()
    for name in (UNIQUE, INDEX):
        if name in indexes:
            op.drop_index(name, table_name=TABLE)
    with op.batch_alter_table(TABLE) as batch:
        for column in reversed(_columns()):
            if column.name in columns:
                batch.drop_column(column.name)
