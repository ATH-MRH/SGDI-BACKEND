"""Flux inter-modules : article_id + prix_unitaire sur lignes_reception

Revision ID: 20260529_0007
Revises: 20260529_0006
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "20260529_0007"
down_revision = "20260529_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("lignes_reception")}
    if "article_id" not in columns:
        op.add_column("lignes_reception", sa.Column("article_id", sa.Integer(), nullable=True))
    if "prix_unitaire" not in columns:
        op.add_column("lignes_reception", sa.Column("prix_unitaire", sa.Float(), nullable=False, server_default="0"))

    inspector = sa.inspect(op.get_bind())
    indexes = {index["name"] for index in inspector.get_indexes("lignes_reception")}
    if "ix_lignes_reception_article_id" not in indexes:
        op.create_index("ix_lignes_reception_article_id", "lignes_reception", ["article_id"])


def downgrade() -> None:
    op.drop_index("ix_lignes_reception_article_id", table_name="lignes_reception")
    op.drop_column("lignes_reception", "prix_unitaire")
    op.drop_column("lignes_reception", "article_id")
