"""Add indexes on updated_at/created_at for tables scanned by _events_signature()

_events_signature() (app/main.py) calcule un COUNT(*) + MAX(updated_at) +
MAX(created_at) sur 23 tables à chaque fois que le cache (snapshot /api/irongs/db
et /api/ui/sidebar-stats, les deux endpoints les plus lents en production) doit
être revalidé (au plus toutes les 2s, mais en continu tant que l'appli est
utilisée). Sans index sur updated_at/created_at, ces agrégats forcent un scan
complet de chaque table. On indexe ici les tables les plus grosses/actives :
sgdi_records (fourre-tout des collections JSON héritées — la plus volumineuse),
employees, assignments et daily_presence (pointage quotidien, une ligne par
employé par jour).

Revision ID: 20260726_0018
Revises: 20260725_0017
Create Date: 2026-07-26
"""
from alembic import op

revision = "20260726_0018"
down_revision = "20260725_0017"
branch_labels = None
depends_on = None

_TABLES = ["sgdi_records", "employees", "assignments", "daily_presence"]


def upgrade() -> None:
    for table in _TABLES:
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_updated_at ON {table} (updated_at)")
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_created_at ON {table} (created_at)")


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_updated_at")
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_created_at")
