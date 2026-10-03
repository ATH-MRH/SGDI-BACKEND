"""Portrait de présentation DRH (Fiche de position) — cache dérivé de la photo de la fiche.

Additive, aucune donnée modifiée : une ligne par employé, liée à l'empreinte de la photo
source (recalculée quand la photo change). Aucune ligne créée par la migration ; la photo
source et les tables biométriques ne sont pas touchées.

Revision ID: 20261004_0001
Revises: 20261003_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261004_0001"
down_revision = "20261003_0001"
branch_labels = None
depends_on = None

TABLE = "employee_portraits"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("method", sa.String(20), nullable=False),
        sa.Column("image", sa.LargeBinary(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_employee_portraits_employee_id", TABLE, ["employee_id"], unique=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE):
        op.drop_table(TABLE)
