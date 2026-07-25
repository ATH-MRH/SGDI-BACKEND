"""Add expression indexes on sites.equipment_plan societe/society (JSON path)

Plusieurs endpoints parmi les plus fréquents (/drh/employees, /ui/sidebar-stats,
/erp/*) filtrent les sites par société en extrayant equipment_plan->>'societe'
(et ->>'society') SANS index — chaque appel force PostgreSQL à re-parser le JSON
de chaque ligne "sites" au lieu d'utiliser un index. Ces deux index accélèrent
ce filtrage, qui revenait systématiquement comme le point le plus lent en
production même après avoir augmenté le nombre de workers.

Revision ID: 20260725_0017
Revises: 20260725_0016
Create Date: 2026-07-25
"""
from alembic import op

revision = "20260725_0017"
down_revision = "20260725_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_sites_equipment_plan_societe "
        "ON sites ((equipment_plan ->> 'societe'))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_sites_equipment_plan_society "
        "ON sites ((equipment_plan ->> 'society'))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_sites_equipment_plan_societe")
    op.execute("DROP INDEX IF EXISTS ix_sites_equipment_plan_society")
