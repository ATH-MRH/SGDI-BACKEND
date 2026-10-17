"""IRON Emploi : convocations à un entretien (brouillon, versions envoyées, QR, arrivée, grille).

Révision additive et rejouable. Elle complète `recruitment_interviews` (colonnes facultatives, unicité de
l'identifiant de requête) et crée `recruitment_convocation_versions`. Les entretiens existants gardent leur
état ; ils restent en version 0 (sans QR) tant qu'aucune convocation n'est émise. Aucune ligne n'est réécrite.

Descente : seules les convocations en brouillon (jamais envoyées, jamais vues par un candidat) sont
supprimées, car le code précédent ne connaît pas cet état et les montrerait au candidat. Colonnes, versions
envoyées, arrivées et grilles sont conservées : le code précédent les ignore.

Revision ID: 20261017_0002
Revises: 20261016_0002
"""
import sqlalchemy as sa
from alembic import op

from app.modules.recruitment_engage_models import RecruitmentConvocationVersion

revision = '20261017_0002'
down_revision = '20261016_0002'
branch_labels = None
depends_on = None

TABLE = 'recruitment_interviews'
COLUMNS = (
    sa.Column('request_id', sa.String(64), nullable=True),
    sa.Column('society', sa.String(150), nullable=True),
    sa.Column('address', sa.String(400), nullable=True),
    sa.Column('map_url', sa.String(400), nullable=True),
    sa.Column('contact_details', sa.String(200), nullable=True),
    sa.Column('purpose', sa.String(200), nullable=True),
    sa.Column('documents_to_bring', sa.Text(), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False, server_default='0'),
    sa.Column('sent_at', sa.DateTime(), nullable=True),
    sa.Column('sent_by', sa.String(100), nullable=True),
    sa.Column('viewed_version', sa.Integer(), nullable=True),
    sa.Column('arrived_at', sa.DateTime(), nullable=True),
    sa.Column('arrived_by', sa.String(100), nullable=True),
    sa.Column('assessment', sa.JSON(), nullable=True),
)
UNIQUE = 'uq_recruitment_interviews_request'


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    present = {column['name'] for column in inspector.get_columns(TABLE)}
    missing = [column for column in COLUMNS if column.name not in present]
    if missing:
        # batch : SQLite ne sait ni ajouter une contrainte ni une colonne NOT NULL sans recréer la table.
        with op.batch_alter_table(TABLE) as batch:
            for column in missing:
                batch.add_column(column.copy())
    if UNIQUE not in {item['name'] for item in sa.inspect(bind).get_unique_constraints(TABLE)}:
        with op.batch_alter_table(TABLE) as batch:
            batch.create_unique_constraint(UNIQUE, ['application_id', 'request_id'])
    RecruitmentConvocationVersion.__table__.create(bind=bind, checkfirst=True)


def downgrade():
    # Le code précédent montrerait un brouillon au candidat : seuls les brouillons partent.
    op.execute(sa.text("DELETE FROM recruitment_interviews WHERE status = 'draft'"))
