"""Lot 0.1 : scopes explicites, audit append-only et jetons portail.

Revision ID: 20260907_0032
Revises: 20260906_0031
"""
from alembic import op
import sqlalchemy as sa


revision = "20260907_0032"
down_revision = "20260906_0031"
branch_labels = None
depends_on = None


def _validate_existing_global_society_access(bind) -> None:
    """Refuse une colonne préexistante incompatible sans modifier ses valeurs."""
    column = next(
        (
            item
            for item in sa.inspect(bind).get_columns("users")
            if item["name"] == "global_society_access"
        ),
        None,
    )
    if column is None:
        return
    if not isinstance(column["type"], sa.Boolean) or bool(column.get("nullable")):
        raise RuntimeError(
            "Colonne users.global_society_access préexistante incompatible : "
            "BOOLEAN NOT NULL requis"
        )


def _require_columns(bind, table_name: str, required: set[str]) -> None:
    """Vérifie les colonnes nécessaires avant toute création d'index."""
    columns = {column["name"] for column in sa.inspect(bind).get_columns(table_name)}
    missing = sorted(required - columns)
    if missing:
        raise RuntimeError(
            f"Table {table_name} préexistante incompatible : colonnes manquantes={missing}"
        )


def _ensure_indexes(
    bind,
    table_name: str,
    expected: tuple[tuple[str, tuple[str, ...], bool], ...],
) -> None:
    """Valide les index homonymes avant de créer uniquement les index absents."""
    inspector = sa.inspect(bind)
    expected_by_name = {
        name: (columns, unique) for name, columns, unique in expected
    }
    found_on_target: dict[str, tuple[tuple[str, ...], bool]] = {}
    for inspected_table in inspector.get_table_names():
        for index in inspector.get_indexes(inspected_table):
            name = index.get("name")
            if name not in expected_by_name:
                continue
            if inspected_table != table_name:
                raise RuntimeError(
                    f"Index {name} incompatible : table={inspected_table}, "
                    f"attendu={table_name}"
                )
            definition = (
                tuple(index.get("column_names") or ()),
                bool(index.get("unique")),
            )
            if definition != expected_by_name[name]:
                raise RuntimeError(
                    f"Index {name} incompatible : définition={definition}, "
                    f"attendu={expected_by_name[name]}"
                )
            found_on_target[name] = definition

    for name, columns, unique in expected:
        if name not in found_on_target:
            op.create_index(name, table_name, list(columns), unique=unique)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "global_society_access" not in user_columns:
        op.add_column("users", sa.Column("global_society_access", sa.Boolean(), nullable=False, server_default=sa.false()))
    else:
        _validate_existing_global_society_access(bind)
    tables = set(inspector.get_table_names())
    if "audit_events" not in tables:
        op.create_table(
            "audit_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("username", sa.String(80), nullable=True),
        sa.Column("action", sa.String(120), nullable=False),
        sa.Column("resource", sa.String(120), nullable=False),
        sa.Column("resource_id", sa.String(180), nullable=True),
        sa.Column("society", sa.String(150), nullable=True),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column("old_state", sa.Text(), nullable=True),
        sa.Column("new_state", sa.Text(), nullable=True),
        sa.Column("correlation_id", sa.String(64), nullable=False),
        )
    else:
        _require_columns(bind, "audit_events", {
            "id", "created_at", "user_id", "username", "action", "resource",
            "resource_id", "society", "result", "ip_address", "user_agent",
            "old_state", "new_state", "correlation_id",
        })
    _ensure_indexes(bind, "audit_events", (
        ("ix_audit_events_created_at", ("created_at",), False),
        ("ix_audit_events_user_id", ("user_id",), False),
        ("ix_audit_events_username", ("username",), False),
        ("ix_audit_events_action", ("action",), False),
        ("ix_audit_events_resource", ("resource",), False),
        ("ix_audit_events_society", ("society",), False),
        ("ix_audit_events_result", ("result",), False),
        ("ix_audit_events_correlation_id", ("correlation_id",), False),
        ("ix_audit_events_user_created", ("username", "created_at"), False),
        ("ix_audit_events_society_created", ("society", "created_at"), False),
        ("ix_audit_events_action_resource", ("action", "resource"), False),
    ))
    tables = set(sa.inspect(bind).get_table_names())
    if "portal_password_reset_tokens" not in tables:
        op.create_table(
            "portal_password_reset_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.String(160), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("delivery_channel", sa.String(20), nullable=True),
        sa.Column("delivery_target_masked", sa.String(180), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        )
    else:
        _require_columns(bind, "portal_password_reset_tokens", {
            "id", "account_id", "token_hash", "delivery_channel",
            "delivery_target_masked", "expires_at", "used_at", "created_at",
        })
    _ensure_indexes(bind, "portal_password_reset_tokens", (
        ("ix_portal_reset_account", ("account_id",), False),
        ("ix_portal_reset_expires", ("expires_at",), False),
        ("ix_portal_reset_token_hash", ("token_hash",), True),
    ))


def downgrade() -> None:
    # Cette révision accepte des objets préexistants sans enregistrer leur
    # propriété. Il est donc impossible de reconstruire exactement le schéma 0031
    # sans risquer de supprimer des droits, des audits ou des jetons antérieurs.
    # Lever avant le retour de downgrade() empêche Alembic d'abaisser
    # alembic_version et évite un faux état « version 0031 / schéma 0032 ».
    raise RuntimeError(
        "Downgrade 20260907_0032 refusé : propriété des structures de sécurité "
        "indéterminable; aucune structure ni donnée n'a été supprimée"
    )
