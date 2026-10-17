"""Join the Pointeur delivery history and the contract one-off import journal.

Revision ID: 20261020_0001
Revises: 20261019_0001, 20261014_0005

No schema or data operation. All existing revision IDs and parents are preserved;
20261014_0005 is already applied in production.
"""
revision = "20261020_0001"
down_revision = ("20261019_0001", "20261014_0005")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
