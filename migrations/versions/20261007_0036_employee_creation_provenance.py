"""Trace employee creation to its recruiter, source candidate, and original user.

Revision ID: 20261007_0036
Revises: 20261007_0035
"""

from alembic import op
import sqlalchemy as sa


revision = "20261007_0036"
down_revision = "20261007_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {item["name"] for item in inspector.get_columns("employees")}
    foreign_keys = inspector.get_foreign_keys("employees")
    indexes = {item["name"]: item for item in inspector.get_indexes("employees")}

    expected_foreign_keys = (
        ("recruitment_candidate_id", "candidates", "RESTRICT"),
        ("created_by_user_id", "users", "SET NULL"),
    )
    missing_foreign_keys = []
    for column, table, ondelete in expected_foreign_keys:
        matching = [
            item for item in foreign_keys
            if item.get("constrained_columns") == [column]
        ]
        if matching:
            if not any(
                item.get("referred_table") == table
                and (item.get("options") or {}).get("ondelete", "").upper() == ondelete
                for item in matching
            ):
                raise RuntimeError(f"Clé étrangère employees.{column} non conforme")
        else:
            missing_foreign_keys.append((column, table, ondelete))

    expected_indexes = {
        "ix_employees_recruitment_candidate_id": (("recruitment_candidate_id",), True),
        "ix_employees_created_by_user_id": (("created_by_user_id",), False),
    }
    missing_indexes = []
    for name, expected in expected_indexes.items():
        existing = indexes.get(name)
        if existing:
            actual = (tuple(existing.get("column_names") or ()), bool(existing.get("unique")))
            if actual != expected:
                raise RuntimeError(f"Index {name} non conforme : {actual!r}")
        else:
            missing_indexes.append((name, expected))

    with op.batch_alter_table("employees") as batch:
        if "recruitment_candidate_id" not in columns:
            batch.add_column(sa.Column("recruitment_candidate_id", sa.Integer(), nullable=True))
        if "creation_source" not in columns:
            batch.add_column(sa.Column("creation_source", sa.String(length=30), nullable=True))
        if "created_by_user_id" not in columns:
            batch.add_column(sa.Column("created_by_user_id", sa.Integer(), nullable=True))
        for column, table, ondelete in missing_foreign_keys:
            batch.create_foreign_key(
                f"fk_employees_{column}",
                table,
                [column],
                ["id"],
                ondelete=ondelete,
            )
        for name, (column_names, unique) in missing_indexes:
            batch.create_index(name, list(column_names), unique=unique)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("employees"):
        return
    columns = {item["name"] for item in inspector.get_columns("employees")}
    if {"recruitment_candidate_id", "creation_source", "created_by_user_id"} <= columns:
        linked_rows = bind.execute(sa.text(
            "SELECT count(*) FROM employees "
            "WHERE recruitment_candidate_id IS NOT NULL "
            "OR creation_source IS NOT NULL "
            "OR created_by_user_id IS NOT NULL"
        )).scalar_one()
        if linked_rows:
            raise RuntimeError(
                "Downgrade 20261007_0036 refusé : des employés contiennent une provenance à préserver"
            )
    with op.batch_alter_table("employees") as batch:
        indexes = {item["name"] for item in inspector.get_indexes("employees")}
        for name in ("ix_employees_created_by_user_id", "ix_employees_recruitment_candidate_id"):
            if name in indexes:
                batch.drop_index(name)
        foreign_keys = inspector.get_foreign_keys("employees")
        for name, column in (
            ("fk_employees_created_by_user_id", "created_by_user_id"),
            ("fk_employees_recruitment_candidate_id", "recruitment_candidate_id"),
        ):
            if any(item.get("name") == name for item in foreign_keys):
                batch.drop_constraint(name, type_="foreignkey")
        for column in ("created_by_user_id", "creation_source", "recruitment_candidate_id"):
            if column in columns:
                batch.drop_column(column)
