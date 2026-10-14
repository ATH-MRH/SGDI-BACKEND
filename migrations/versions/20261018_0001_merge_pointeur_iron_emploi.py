"""Join the unchanged IRON Emploi and facial authorization histories.

Revision ID: 20261018_0001
Revises: 20261016_0001, 20261017_0001

No schema or data operation. Alembic applies only the missing parent branch and
then records this common head. Neither existing revision is renamed or reparented.
"""
revision = "20261018_0001"
down_revision = ("20261016_0001", "20261017_0001")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
