"""IRON Emploi : salaire facultatif d'une annonce (montant et période, tous deux optionnels).

Révision additive et rejouable : deux colonnes ajoutées à `recruitment_job_offers` si elles manquent
(une base neuve les reçoit déjà de 20261014_0002, qui crée ses tables depuis les modèles courants).

Revision ID: 20261015_0001
Revises: 20261014_0003
"""
import sqlalchemy as sa
from alembic import op

revision = '20261015_0001'
down_revision = '20261014_0003'
branch_labels = None
depends_on = None

TABLE = 'recruitment_job_offers'
COLUMNS = lambda: [sa.Column('salary_amount', sa.Numeric(12, 2), nullable=True), sa.Column('salary_period', sa.String(20), nullable=True)]  # noqa: E731


def _existing() -> set[str]:
    return {column['name'] for column in sa.inspect(op.get_bind()).get_columns(TABLE)}


def upgrade():
    present = _existing()
    for column in COLUMNS():
        if column.name not in present:
            op.add_column(TABLE, column)


def downgrade():
    present = _existing()
    for column in COLUMNS():
        if column.name in present:
            op.drop_column(TABLE, column.name)
