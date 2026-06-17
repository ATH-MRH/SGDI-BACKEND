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
    op.execute("ALTER TABLE positions ADD COLUMN IF NOT EXISTS society VARCHAR(150)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_positions_society ON positions(society)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_positions_society")
    op.execute("ALTER TABLE positions DROP COLUMN IF EXISTS society")
