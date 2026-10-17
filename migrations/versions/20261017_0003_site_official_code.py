"""Sites : code officiel du site (badges du personnel, documents).

`sites.indicatif` porte l'indicatif radio du site (ex. « RACHID (HAROUN-HICHEM) ») : ce n'est pas le
code officiel imprimé sur les badges (ex. « ETP/DF/H01 »), que rien ne stockait. Révision additive et
rejouable : une colonne facultative et son index, aucune ligne réécrite, aucune valeur déduite. Les codes
sont saisis dans la fiche du site (Gestion des sites).

Descente : la colonne n'est pas supprimée (le code précédent l'ignore et les codes saisis sont conservés).

Revision ID: 20261017_0003
Revises: 20261017_0002
"""
import sqlalchemy as sa
from alembic import op

revision = '20261017_0003'
down_revision = '20261017_0002'
branch_labels = None
depends_on = None

TABLE = 'sites'
COLUMN = 'official_code'
INDEX = 'ix_sites_official_code'


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if COLUMN not in {column['name'] for column in inspector.get_columns(TABLE)}:
        with op.batch_alter_table(TABLE) as batch:
            batch.add_column(sa.Column(COLUMN, sa.String(50), nullable=True))
    if INDEX not in {index['name'] for index in sa.inspect(bind).get_indexes(TABLE)}:
        op.create_index(INDEX, TABLE, [COLUMN])


def downgrade():
    # Conservée : le code précédent ignore la colonne ; la retirer effacerait les codes saisis.
    pass
