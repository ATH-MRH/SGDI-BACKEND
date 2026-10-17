"""Join the Pointeur delivery history and the recruitment circuit.

Revision ID: 20261021_0001
Revises: 20261020_0001, 20261016_0002

No schema or data operation. All existing revision IDs and parents are preserved;
20261016_0002 is already applied in production.
"""
revision = "20261021_0001"
down_revision = ("20261020_0001", "20261016_0002")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
