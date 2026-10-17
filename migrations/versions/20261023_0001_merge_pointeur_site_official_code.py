"""Join the Pointeur delivery history and the official site code.

Revision ID: 20261023_0001
Revises: 20261022_0001, 20261017_0003

No schema or data operation. All existing revision IDs and parents are preserved;
20261017_0003 is already applied in production.
"""
revision = "20261023_0001"
down_revision = ("20261022_0001", "20261017_0003")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
