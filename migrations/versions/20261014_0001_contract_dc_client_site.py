"""Rattache un contrat DRH au client / site officiel de dc.irongs.com.

Additive : trois colonnes facultatives sur contracts. Les identifiants pointent vers les tables
du module Commercial (clients, sites) ; le libellé est une copie figée pour l'historique.

Revision ID: 20261014_0001
Revises: 20261013_0002
"""
from alembic import op
import sqlalchemy as sa

revision = "20261014_0001"
down_revision = "20261013_0002"
branch_labels = None
depends_on = None

TABLE = "contracts"
LINKS = (("dc_client_id", "clients"), ("dc_site_id", "sites"))


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {item["name"] for item in inspector.get_columns(TABLE)}
    indexes = {item["name"] for item in inspector.get_indexes(TABLE)}
    with op.batch_alter_table(TABLE) as batch:
        for column, target in LINKS:
            if column not in columns:
                batch.add_column(sa.Column(column, sa.Integer(), nullable=True))
                batch.create_foreign_key(f"fk_{TABLE}_{column}", target, [column], ["id"], ondelete="SET NULL")
            if f"ix_{TABLE}_{column}" not in indexes:
                batch.create_index(f"ix_{TABLE}_{column}", [column])
        if "dc_client_site_label" not in columns:
            batch.add_column(sa.Column("dc_client_site_label", sa.String(380), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {item["name"] for item in inspector.get_columns(TABLE)}
    indexes = {item["name"] for item in inspector.get_indexes(TABLE)}
    foreign_keys = {item.get("name") for item in inspector.get_foreign_keys(TABLE)}
    with op.batch_alter_table(TABLE) as batch:
        if "dc_client_site_label" in columns:
            batch.drop_column("dc_client_site_label")
        for column, _target in LINKS:
            if f"ix_{TABLE}_{column}" in indexes:
                batch.drop_index(f"ix_{TABLE}_{column}")
            # Une base créée par create_all porte la clé sans ce nom : elle part avec la colonne.
            if f"fk_{TABLE}_{column}" in foreign_keys:
                batch.drop_constraint(f"fk_{TABLE}_{column}", type_="foreignkey")
            if column in columns:
                batch.drop_column(column)
