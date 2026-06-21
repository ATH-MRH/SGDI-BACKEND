"""Add society column to positions table

Revision ID: 20260617_0013
"""
from alembic import op
import sqlalchemy as sa

revision = "20260617_0013"
down_revision = "20260612_0012"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("positions")}
    if "society" not in columns:
        op.add_column("positions", sa.Column("society", sa.String(length=150), nullable=True))

    inspector = sa.inspect(op.get_bind())
    indexes = {index["name"] for index in inspector.get_indexes("positions")}
    if "idx_positions_society" not in indexes:
        op.create_index("idx_positions_society", "positions", ["society"])


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_positions_society")
    op.execute("ALTER TABLE positions DROP COLUMN IF EXISTS society")
