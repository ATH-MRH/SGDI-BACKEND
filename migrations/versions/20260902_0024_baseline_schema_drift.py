"""Baseline: colonnes et index gérés jusqu'ici hors Alembic

Jusqu'à présent, plusieurs colonnes n'étaient créées que par
`Base.metadata.create_all()` (base neuve) ou par `ensure_schema_upgrades()`
dans app/main.py (base existante), sans aucune migration correspondante :

  - users.access_level, users.authorized_societies, users.authorized_structures
  - suppliers.society
  - daily_presence.rotation_system / rotation_group / rotation_period / faction
    / recovery / standby / data
  - assignments.rotation_id (+ FK -> rotation_templates.id)

De même, les index de _events_signature() et les index partiels de `assignments`
étaient créés à chaque démarrage par app/main.py.

Cette migration reprend tout ça, chaque opération étant GARDÉE (idempotente) :
  - sur une base déjà en service, tout existe déjà -> no-op complet ;
  - sur une base neuve, migration 0001 (create_all) a déjà tout créé -> no-op ;
  - sur une base ancienne qui n'aurait pas eu ensure_schema_upgrades -> rattrapage.

Objectif : la chaîne Alembic décrit enfin l'intégralité du schéma, ce qui est le
préalable pour retirer create_all()/ensure_schema_upgrades() du démarrage.

Revision ID: 20260902_0024
Revises: 20260820_0023
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "20260902_0024"
down_revision = "20260820_0023"
branch_labels = None
depends_on = None


# (table, colonne, type SQLAlchemy, server_default)
_COLUMNS = [
    ("users", "access_level", sa.String(length=40), None),
    ("users", "authorized_societies", sa.JSON(), None),
    ("users", "authorized_structures", sa.JSON(), None),
    ("suppliers", "society", sa.String(length=150), None),
    ("daily_presence", "rotation_system", sa.String(length=40), None),
    ("daily_presence", "rotation_group", sa.String(length=20), None),
    ("daily_presence", "rotation_period", sa.String(length=20), None),
    ("daily_presence", "faction", sa.String(length=40), None),
    ("daily_presence", "recovery", sa.Integer(), "0"),
    ("daily_presence", "standby", sa.Integer(), "0"),
    ("daily_presence", "data", sa.JSON(), None),
    ("assignments", "rotation_id", sa.Integer(), None),
]

_EVENTS_SIGNATURE_TABLES = [
    "candidates", "contracts", "generated_contracts", "sites", "events", "incidents",
    "stock_articles", "stock_movements", "stores", "suppliers", "employee_equipment",
    "material_assignments", "clients", "prospects", "invoices", "payments",
    "cash_entries", "ops_movements", "advances", "credit_notes",
]


def _has_table(inspector, name: str) -> bool:
    try:
        return inspector.has_table(name)
    except Exception:
        return name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column, type_, server_default in _COLUMNS:
        if not _has_table(inspector, table):
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column in existing:
            continue
        kwargs = {"nullable": True}
        if server_default is not None:
            kwargs["server_default"] = server_default
        op.add_column(table, sa.Column(column, type_, **kwargs))

    # FK assignments.rotation_id -> rotation_templates.id (PostgreSQL uniquement :
    # SQLite ne sait pas ajouter une FK par ALTER hors mode batch, et l'app ne
    # dépend que de la FK ORM).
    if bind.dialect.name == "postgresql" and _has_table(inspector, "assignments") \
            and _has_table(inspector, "rotation_templates"):
        inspector = sa.inspect(bind)
        fk_names = {fk.get("name") for fk in inspector.get_foreign_keys("assignments")}
        fk_cols = {tuple(fk.get("constrained_columns") or []) for fk in inspector.get_foreign_keys("assignments")}
        if "fk_assignments_rotation_id" not in fk_names and ("rotation_id",) not in fk_cols:
            op.create_foreign_key(
                "fk_assignments_rotation_id", "assignments", "rotation_templates",
                ["rotation_id"], ["id"], ondelete="SET NULL",
            )

    # Backfill des colonnes JSON de périmètre : NULL -> [] (même règle que
    # ensure_schema_upgrades()).
    for column in ("authorized_societies", "authorized_structures"):
        op.execute(f"UPDATE users SET {column} = '[]' WHERE {column} IS NULL")

    # Index partiels sur assignments (historique inactif volumineux).
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_assignments_active_emp "
        "ON assignments (employee_id) WHERE active = 1"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_assignments_emp_active "
        "ON assignments (employee_id, active)"
    )

    # Index updated_at/created_at pour _events_signature() (COUNT/MAX sur ~23
    # tables, revalidé toutes les 2s tant que l'appli est utilisée).
    for table in _EVENTS_SIGNATURE_TABLES:
        if not _has_table(inspector, table):
            continue
        for col in ("updated_at", "created_at"):
            op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_{col} ON {table} ({col})")


def downgrade() -> None:
    bind = op.get_bind()

    for table in _EVENTS_SIGNATURE_TABLES:
        for col in ("updated_at", "created_at"):
            op.execute(f"DROP INDEX IF EXISTS ix_{table}_{col}")
    op.execute("DROP INDEX IF EXISTS ix_assignments_active_emp")
    op.execute("DROP INDEX IF EXISTS ix_assignments_emp_active")

    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE assignments DROP CONSTRAINT IF EXISTS fk_assignments_rotation_id")

    inspector = sa.inspect(bind)
    for table, column, _type, _default in reversed(_COLUMNS):
        if not _has_table(inspector, table):
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column not in existing:
            continue
        # Best-effort : sur SQLite, DROP COLUMN d'une colonne encore référencée par
        # une FK du modèle rebâtit la table et peut échouer. La montée (upgrade)
        # reste, elle, garantie ; ce downgrade n'est qu'un filet.
        try:
            op.drop_column(table, column)
        except Exception:  # noqa: BLE001
            pass
