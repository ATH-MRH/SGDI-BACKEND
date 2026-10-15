"""Journal persistant de la dérogation de préparation du lot Excel de 75 dossiers confirmés."""
from alembic import op
import sqlalchemy as sa

revision = '20261014_0005'
down_revision = '20261015_0002'
branch_labels = None
depends_on = None


def upgrade():
    # Certaines bases neuves créent les modèles courants avant de parcourir la chaîne.
    if 'drh_contract_import_oneoff_grants' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table('drh_contract_import_oneoff_grants',
        sa.Column('batch_key', sa.String(120), primary_key=True),
        sa.Column('session_id', sa.String(64), nullable=False, unique=True),
        sa.Column('file_sha256', sa.String(64), nullable=False),
        sa.Column('authorized_by_user_id', sa.Integer(), nullable=False),
        sa.Column('authorized_by_username', sa.String(120), nullable=False),
        sa.Column('authorized_at', sa.DateTime(), nullable=False),
        sa.Column('candidate_ids', sa.JSON(), nullable=False),
        sa.Column('reason', sa.String(180), nullable=False),
        sa.Column('preparation', sa.JSON(), nullable=False))


def downgrade():
    op.drop_table('drh_contract_import_oneoff_grants')
