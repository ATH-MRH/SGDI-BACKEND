"""Distinguish terminal revocation from operational deletion without erasing history.

Revision ID: 20261008_0001
Revises: 20261007_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261008_0001"
down_revision = "20261007_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Preserve existing revoked rows: their original intent cannot be inferred.
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("biometric_terminals")}
    constraints = {item["name"] for item in inspector.get_unique_constraints("biometric_terminals")}
    indexes = {item["name"] for item in inspector.get_indexes("biometric_terminals")}
    with op.batch_alter_table("biometric_terminals") as batch:
        for name, kind in (("deleted_at", sa.DateTime()), ("deleted_by", sa.String(120)), ("deleted_reason", sa.Text())):
            if name not in columns:
                batch.add_column(sa.Column(name, kind, nullable=True))
        if "uq_biometric_terminals_site_name" in constraints:
            batch.drop_constraint("uq_biometric_terminals_site_name", type_="unique")
    if "uq_biometric_terminals_live_site_name" not in indexes:
        op.create_index("uq_biometric_terminals_live_site_name", "biometric_terminals",
                        ["site_id", "name"], unique=True,
                        postgresql_where=sa.text("deleted_at IS NULL"),
                        sqlite_where=sa.text("deleted_at IS NULL"))


def downgrade() -> None:
    # A destructive downgrade would expose archived terminals or lose their state.
    if op.get_bind().execute(sa.text("SELECT 1 FROM biometric_terminals WHERE deleted_at IS NOT NULL LIMIT 1")).first():
        raise RuntimeError("Downgrade refusé : des terminaux supprimés doivent conserver leur historique et leur état.")
    op.drop_index("uq_biometric_terminals_live_site_name", table_name="biometric_terminals")
    with op.batch_alter_table("biometric_terminals") as batch:
        batch.create_unique_constraint("uq_biometric_terminals_site_name", ["site_id", "name"])
        batch.drop_column("deleted_reason")
        batch.drop_column("deleted_by")
        batch.drop_column("deleted_at")
