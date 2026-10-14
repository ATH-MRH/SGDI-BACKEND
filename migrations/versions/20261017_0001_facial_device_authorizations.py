"""Explicit per-user authorizations on already registered facial devices.

Revision ID: 20261017_0001
Revises: 20261014_0001
"""
import re

from alembic import op
import sqlalchemy as sa

# Identifiant distinct de ceux déjà pris par main et par les branches en cours (20261014_000x,
# 20261015_0001, 20261016_0001). Renommée depuis 20261014_0001, pris entre-temps par une migration
# de main : l'ancienne révision n'a jamais été appliquée hors de bases jetables.
revision = "20261017_0001"
down_revision = "20261014_0001"
branch_labels = None
depends_on = None

TABLE = "facial_device_authorizations"


def _validate_existing(inspector) -> None:
    """Idempotence is permitted only for the complete expected schema.

    Never repair or discard existing authorizations implicitly. A mismatch leaves
    the Alembic revision unchanged and requires an explicit schema investigation.
    """
    errors = []
    columns = {c["name"]: c for c in inspector.get_columns(TABLE)}
    expected = {
        "id": (sa.Integer, False, None), "user_id": (sa.Integer, False, None),
        "terminal_id": (sa.Integer, True, None), "camera_id": (sa.Integer, True, None),
        "granted_by": (sa.String, True, 120), "created_at": (sa.DateTime, False, None),
    }
    if set(columns) != set(expected):
        errors.append("colonnes attendues")
    for name, (kind, nullable, length) in expected.items():
        column = columns.get(name)
        if column is None:
            continue
        if (not isinstance(column["type"], kind) or column["nullable"] != nullable
                or (kind is sa.Integer and isinstance(column["type"], (sa.SmallInteger, sa.BigInteger)))
                or (length is not None and getattr(column["type"], "length", None) != length)
                or (name == "created_at" and getattr(column["type"], "timezone", False))):
            errors.append("colonne " + name)
    default = str(columns.get("created_at", {}).get("default") or "").lower()
    if re.sub(r"[\s()]", "", default) not in {"now", "current_timestamp"}:
        errors.append("défaut created_at")
    if inspector.get_pk_constraint(TABLE).get("constrained_columns") != ["id"]:
        errors.append("clé primaire")
    foreign_keys = inspector.get_foreign_keys(TABLE)
    for column, target in (("user_id", "users"), ("terminal_id", "biometric_terminals"), ("camera_id", "cameras")):
        if not any(fk.get("constrained_columns") == [column] and fk.get("referred_table") == target
                   and fk.get("referred_columns") == ["id"]
                   and fk.get("referred_schema") in (None, inspector.default_schema_name)
                   and str(fk.get("options", {}).get("ondelete", "")).upper() == "CASCADE"
                   for fk in foreign_keys):
            errors.append("clé étrangère " + column)
    unique = {u.get("name"): u for u in inspector.get_unique_constraints(TABLE)}
    for suffix in ("terminal", "camera"):
        name = "uq_facial_device_auth_user_" + suffix
        if unique.get(name, {}).get("column_names") != ["user_id", suffix + "_id"]:
            errors.append("unicité " + suffix)
    checks = {c.get("name"): c for c in inspector.get_check_constraints(TABLE)}
    check = checks.get("ck_facial_device_auth_one_device", {}).get("sqltext", "")
    if re.sub(r'[\s()"]', '', check).lower() != "terminal_idisnull<>camera_idisnull":
        errors.append("contrainte exactement un équipement")
    indexes = {i.get("name"): i for i in inspector.get_indexes(TABLE)}
    for column in ("user_id", "terminal_id", "camera_id"):
        index = indexes.get("ix_facial_device_authorizations_" + column, {})
        if (index.get("column_names") != [column] or index.get("unique")
                or any(value is not None for key, value in index.get("dialect_options", {}).items()
                       if key.endswith("_where"))):
            errors.append("index " + column)
    if inspector.bind.dialect.name == "postgresql":
        # An invalid/not-yet-validated PostgreSQL constraint or index is not a
        # complete schema even when its reflected definition looks correct.
        bind = inspector.bind
        if not columns.get("id", {}).get("autoincrement") and not columns.get("id", {}).get("identity"):
            errors.append("génération automatique id")
        invalid_constraints = bind.execute(sa.text(
            "SELECT conname FROM pg_constraint WHERE conrelid = to_regclass(:table) AND NOT convalidated"
        ), {"table": TABLE}).scalars().all()
        invalid_indexes = bind.execute(sa.text(
            "SELECT indexrelid::regclass::text FROM pg_index WHERE indrelid = to_regclass(:table) "
            "AND (NOT indisvalid OR NOT indisready)"
        ), {"table": TABLE}).scalars().all()
        if invalid_constraints or invalid_indexes:
            errors.append("contraintes ou index PostgreSQL non validés")
    if errors:
        raise RuntimeError("Migration 20261017_0001 refusée : table facial_device_authorizations "
                           "préexistante incompatible (" + ", ".join(errors) + "). "
                           "Vérifier le schéma explicitement ; aucune réparation automatique.")


def upgrade() -> None:
    # Additive only: no existing row is touched; without a row, access is denied by default.
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE):
        _validate_existing(inspector)
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("terminal_id", sa.Integer(), sa.ForeignKey("biometric_terminals.id", ondelete="CASCADE"), nullable=True),
        sa.Column("camera_id", sa.Integer(), sa.ForeignKey("cameras.id", ondelete="CASCADE"), nullable=True),
        sa.Column("granted_by", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "terminal_id", name="uq_facial_device_auth_user_terminal"),
        sa.UniqueConstraint("user_id", "camera_id", name="uq_facial_device_auth_user_camera"),
        sa.CheckConstraint("(terminal_id IS NULL) <> (camera_id IS NULL)", name="ck_facial_device_auth_one_device"),
    )
    op.create_index("ix_facial_device_authorizations_user_id", TABLE, ["user_id"])
    op.create_index("ix_facial_device_authorizations_terminal_id", TABLE, ["terminal_id"])
    op.create_index("ix_facial_device_authorizations_camera_id", TABLE, ["camera_id"])


def downgrade() -> None:
    # Un retour arrière applicatif ne l'exige pas (l'ancienne version ignore cette table). Supprimer
    # la table effacerait des autorisations saisies : refusé tant qu'il en reste.
    bind = op.get_bind()
    if not sa.inspect(bind).has_table(TABLE):
        return
    if bind.execute(sa.text(f"SELECT 1 FROM {TABLE} LIMIT 1")).first():
        raise RuntimeError("Downgrade refusé : des autorisations d'équipements faciaux existent. "
                           "Les retirer explicitement avant de supprimer la table.")
    op.drop_table(TABLE)
