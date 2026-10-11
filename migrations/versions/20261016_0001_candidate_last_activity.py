"""IRON Emploi : dernière activité d'un espace candidat, pour faire courir sa durée de conservation.

Révision additive et rejouable : une colonne et son index ajoutés à `recruitment_candidate_accounts` s'ils
manquent (une base neuve les reçoit déjà de 20261014_0002, qui crée ses tables depuis les modèles courants).
Les espaces existants reçoivent leur dernière date connue (modification du profil, sinon création).
Aucune ligne n'est supprimée.

Revision ID: 20261016_0001
Revises: 20261015_0001
"""
import sqlalchemy as sa
from alembic import op

revision = '20261016_0001'
down_revision = '20261015_0001'
branch_labels = None
depends_on = None

TABLE, COLUMN = 'recruitment_candidate_accounts', 'last_activity_at'
INDEX = f'ix_{TABLE}_{COLUMN}'


def _columns() -> set[str]:
    return {column['name'] for column in sa.inspect(op.get_bind()).get_columns(TABLE)}


def _indexes() -> set[str]:
    return {index['name'] for index in sa.inspect(op.get_bind()).get_indexes(TABLE)}


def upgrade():
    if COLUMN not in _columns():
        op.add_column(TABLE, sa.Column(COLUMN, sa.DateTime(), nullable=True))
    if INDEX not in _indexes():
        op.create_index(INDEX, TABLE, [COLUMN])
    op.execute(f'UPDATE {TABLE} SET {COLUMN} = COALESCE(updated_at, created_at) WHERE {COLUMN} IS NULL')


def downgrade():
    if INDEX in _indexes():
        op.drop_index(INDEX, table_name=TABLE)
    if COLUMN in _columns():
        op.drop_column(TABLE, COLUMN)
