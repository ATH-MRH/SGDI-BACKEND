"""Champs autorisés par utilisateur (Fiche de position BEO en lecture seule).

Revision ID: 20261024_0001
Revises: 20261023_0001

Additif : une table `user_field_permissions` (une ligne = un champ lisible ; absence = refusé).
Aucune donnée RH n'est copiée : seule l'habilitation est stockée.

Compatibilité des comptes BEO existants (decision documentée dans
docs/beo-position-file-readonly.md) : chaque compte qui possède DÉJÀ le module
`site_workforce` reçoit explicitement le profil « BEO Standard » figé ci-dessous — jamais
un champ sensible. Un compte créé après cette migration ne reçoit rien (deny by default)
tant qu'un administrateur ne coche pas ses champs.

Downgrade : suppression de la table (les seules données perdues sont ces habilitations).
"""
from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision = "20261024_0001"
down_revision = "20261023_0001"
branch_labels = None
depends_on = None


# Instantané IMMUABLE du preset BEO Standard au moment de la migration (les libellés et le
# catalogue vivent dans app/modules/site_workforce/position_file.py et peuvent évoluer).
BEO_STANDARD_FIELDS = (
    "identity.last_name", "identity.first_name", "identity.employee_code", "identity.photo", "identity.status",
    "assignment.society", "assignment.site", "assignment.position", "assignment.function", "assignment.start_date",
    "assignment.vacation", "assignment.rotation", "assignment.work_regime", "assignment.group",
    "contract.type", "contract.start_date", "contract.end_date", "contract.status",
    "history.assignments",
)


def upgrade() -> None:
    bind = op.get_bind()
    # La migration initiale historique (Base.metadata.create_all) matérialise déjà cette table
    # sur une base VIERGE : on ne la recrée pas (même garde que 20260908_0034). En production
    # elle n'existe pas encore et elle est créée ici.
    if not sa.inspect(bind).has_table("user_field_permissions"):
        _create_table()
    _seed_existing_beo_accounts(bind)


def _create_table() -> None:
    op.create_table(
        "user_field_permissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_key", sa.String(length=80), nullable=False),
        sa.Column("resource_key", sa.String(length=80), nullable=False),
        sa.Column("field_key", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("user_id", "module_key", "resource_key", "field_key", name="uq_user_field_permission"),
    )
    op.create_index("ix_user_field_permissions_user_resource", "user_field_permissions",
                    ["user_id", "module_key", "resource_key"])


def _seed_existing_beo_accounts(bind) -> None:
    """Profil BEO Standard pour chaque compte qui a déjà site_workforce et AUCUNE ligne
    (idempotent : jamais de doublon, jamais d'écrasement d'une sélection existante)."""
    users = sa.table("users", sa.column("id", sa.Integer()), sa.column("authorized_modules", sa.JSON()))
    grants = sa.table(
        "user_field_permissions",
        sa.column("user_id", sa.Integer()), sa.column("module_key", sa.String()),
        sa.column("resource_key", sa.String()), sa.column("field_key", sa.String()),
        sa.column("created_at", sa.DateTime()),
    )
    configured = set(bind.execute(sa.select(grants.c.user_id).where(
        grants.c.module_key == "site_workforce", grants.c.resource_key == "position_file")).scalars())
    beo_ids = [
        row.id for row in bind.execute(sa.select(users.c.id, users.c.authorized_modules))
        if isinstance(row.authorized_modules, list) and row.id not in configured
        and "site_workforce" in {str(v or "").strip().lower() for v in row.authorized_modules}
    ]
    if beo_ids:
        now = datetime.utcnow()
        op.bulk_insert(grants, [
            {"user_id": uid, "module_key": "site_workforce", "resource_key": "position_file",
             "field_key": key, "created_at": now}
            for uid in beo_ids for key in BEO_STANDARD_FIELDS
        ])


def downgrade() -> None:
    op.drop_index("ix_user_field_permissions_user_resource", table_name="user_field_permissions")
    op.drop_table("user_field_permissions")
