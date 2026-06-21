"""Add site_id FK on sanctions table

Revision ID: 20260529_0006
Revises: 20260529_0005
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "20260529_0006"
down_revision = "20260529_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("sanctions")}
    if "site_id" not in columns:
        op.add_column("sanctions", sa.Column("site_id", sa.Integer(), nullable=True))

    inspector = sa.inspect(op.get_bind())
    indexes = {index["name"] for index in inspector.get_indexes("sanctions")}
    if "ix_sanctions_site_id" not in indexes:
        op.create_index("ix_sanctions_site_id", "sanctions", ["site_id"])

    foreign_keys = inspector.get_foreign_keys("sanctions")
    has_site_fk = any(foreign_key.get("constrained_columns") == ["site_id"] for foreign_key in foreign_keys)
    if not has_site_fk:
        op.create_foreign_key(
            "fk_sanctions_site_id",
            "sanctions", "sites",
            ["site_id"], ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    op.drop_constraint("fk_sanctions_site_id", "sanctions", type_="foreignkey")
    op.drop_index("ix_sanctions_site_id", table_name="sanctions")
    op.drop_column("sanctions", "site_id")
