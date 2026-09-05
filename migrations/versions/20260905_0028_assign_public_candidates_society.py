"""Rattache les candidatures publiques sans société à la file recrutement.

Revision ID: 20260905_0028
Revises: 20260902_0027
"""
from alembic import op
import sqlalchemy as sa


revision = "20260905_0028"
down_revision = "20260902_0027"
branch_labels = None
depends_on = None


DEFAULT_SOCIETY = "IRON GLOBAL SÉCURITÉ"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("candidates"):
        return
    candidates = sa.table(
        "candidates",
        sa.column("id", sa.Integer),
        sa.column("society", sa.String),
        sa.column("data", sa.JSON),
    )
    rows = bind.execute(
        sa.select(candidates.c.id, candidates.c.data).where(candidates.c.society.is_(None))
    ).mappings()
    for row in rows:
        data = row["data"] if isinstance(row["data"], dict) else {}
        if data.get("moduleOrigine") == "fr.irongs.com" or data.get("sourceExterne") == "portail_candidat":
            bind.execute(
                candidates.update()
                .where(candidates.c.id == row["id"])
                .values(society=DEFAULT_SOCIETY)
            )


def downgrade() -> None:
    # Migration de données volontairement non destructive.
    pass
