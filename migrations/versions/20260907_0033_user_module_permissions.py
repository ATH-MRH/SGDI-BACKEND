"""Ajoute le stockage inerte des permissions granulaires du lot 0.5-A.

Revision ID: 20260907_0033
Revises: 20260907_0032
"""

from alembic import op
import sqlalchemy as sa
import re


revision = "20260907_0033"
down_revision = "20260907_0032"
branch_labels = None
depends_on = None


MODULES = (
    "administration", "drh", "recruitment", "leaves", "ops", "attendance",
    "material", "commercial", "sales", "purchases", "accounting", "finance",
    "reporting", "loans", "secretariat", "cash", "employee_portal",
    "client_portal", "rounds", "assistant", "erp_cockpit", "legacy", "ui",
)
ACTIONS = (
    "read", "create", "update", "validate", "delete", "export", "unlock",
    "admin", "sign", "pay", "recruit", "execute",
)


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def _fail_schema(errors: list[str]) -> None:
    details = "; ".join(errors)
    raise RuntimeError(
        "Schéma existant user_module_permissions non conforme à la migration "
        f"20260907_0033 : {details}"
    )


def _string_literals(sqltext: str) -> tuple[str, ...]:
    return tuple(
        value.replace("''", "'")
        for value in re.findall(r"'((?:''|[^'])*)'", sqltext or "")
    )


def _compiled_type(type_, dialect) -> str:
    return " ".join(str(type_.compile(dialect=dialect)).upper().split())


def _check_signature(sqltext: str, column: str) -> tuple[str, tuple[str, ...]]:
    """Normalise uniquement IN(...) et la réflexion PG = ANY(ARRAY[...])."""
    literals = _string_literals(sqltext)
    expression = re.sub(r"'((?:''|[^'])*)'", "?", (sqltext or "").lower())
    expression = re.sub(r"::\s*(?:character varying|varchar|text)(?:\s*\[\s*\])?", "", expression)
    expression = re.sub(r"\barray\b", "", expression)
    expression = re.sub(r"\bcheck\b", "", expression)
    expression = expression.replace('"', "")
    expression = re.sub(r"[\s\(\)\[\]]+", "", expression)
    markers = ",".join("?" for _ in literals)
    if expression == f"{column}in{markers}":
        return "in", literals
    if expression == f"{column}=any{markers}":
        return "any", literals
    return expression, literals


def _normalized_schema(schema: str | None, default_schema: str | None) -> str | None:
    """None et le schéma courant explicite représentent la même cible SQL."""
    return None if schema in {None, default_schema} else schema


def _validate_existing_table(bind) -> None:
    """Refuse toute table préexistante qui ne correspond pas au contrat 0033."""
    inspector = sa.inspect(bind)
    errors: list[str] = []
    columns = {column["name"]: column for column in inspector.get_columns("user_module_permissions")}
    expected_columns = {
        "id": (sa.Integer(), False),
        "user_id": (sa.Integer(), False),
        "module_key": (sa.String(80), False),
        "action_key": (sa.String(40), False),
        "created_at": (sa.DateTime(), False),
        "created_by_user_id": (sa.Integer(), True),
    }
    if set(columns) != set(expected_columns):
        errors.append(
            f"colonnes attendues={sorted(expected_columns)}, trouvées={sorted(columns)}"
        )
    for name, (expected_type, nullable) in expected_columns.items():
        column = columns.get(name)
        if column is None:
            continue
        actual_type = _compiled_type(column["type"], bind.dialect)
        required_type = _compiled_type(expected_type, bind.dialect)
        if actual_type != required_type:
            errors.append(f"type invalide pour {name}: {actual_type}, attendu={required_type}")
        if bool(column.get("nullable")) is not nullable:
            errors.append(f"nullabilité invalide pour {name}: {column.get('nullable')}")
        if column.get("identity") is not None:
            errors.append(f"identité serveur inattendue pour {name}")
        server_default = column.get("default")
        postgres_sequence = re.fullmatch(
            r"nextval\('(?:[^']*\.)?user_module_permissions_id_seq'::regclass\)",
            str(server_default or ""),
        )
        if server_default is not None and not (name == "id" and postgres_sequence):
            errors.append(f"valeur par défaut serveur inattendue pour {name}")

    primary_key = inspector.get_pk_constraint("user_module_permissions")
    if set(primary_key.get("constrained_columns") or []) != {"id"}:
        errors.append(f"clé primaire invalide: {primary_key.get('constrained_columns')}")

    expected_foreign_keys = [
        (("created_by_user_id",), None, "users", ("id",), "SET NULL"),
        (("user_id",), None, "users", ("id",), "CASCADE"),
    ]
    foreign_keys = inspector.get_foreign_keys("user_module_permissions")
    found_foreign_keys = []
    for foreign_key in foreign_keys:
        constrained = foreign_key.get("constrained_columns") or []
        options = foreign_key.get("options") or {}
        found_foreign_keys.append((
            tuple(constrained),
            _normalized_schema(foreign_key.get("referred_schema"), inspector.default_schema_name),
            foreign_key.get("referred_table"),
            tuple(foreign_key.get("referred_columns") or []),
            str(options.get("ondelete") or "").upper() or None,
        ))
    found_foreign_keys.sort(key=repr)
    if found_foreign_keys != expected_foreign_keys:
        errors.append(f"clés étrangères invalides: {found_foreign_keys}")

    unique_constraints = {
        constraint.get("name"): tuple(constraint.get("column_names") or [])
        for constraint in inspector.get_unique_constraints("user_module_permissions")
    }
    expected_unique = ("user_id", "module_key", "action_key")
    if unique_constraints != {"uq_user_module_permission": expected_unique}:
        errors.append(f"contraintes d'unicité invalides: {unique_constraints}")

    checks = {
        constraint.get("name"): constraint.get("sqltext") or ""
        for constraint in inspector.get_check_constraints("user_module_permissions")
    }
    expected_check_names = {
        "ck_user_module_permission_module",
        "ck_user_module_permission_action",
    }
    if set(checks) != expected_check_names:
        errors.append(f"ensemble de contraintes check invalide: {sorted(checks)}")
    for name, column, values in (
        ("ck_user_module_permission_module", "module_key", MODULES),
        ("ck_user_module_permission_action", "action_key", ACTIONS),
    ):
        sqltext = checks.get(name)
        if not sqltext:
            errors.append(f"contrainte {name} absente")
            continue
        form, literals = _check_signature(sqltext, column)
        if form not in {"in", "any"} or literals != values:
            errors.append(f"expression complète invalide pour {name}: {sqltext}")

    reflected_indexes = inspector.get_indexes("user_module_permissions")
    indexes = {}
    for index in reflected_indexes:
        # PostgreSQL peut refléter l'index physique d'une contrainte UNIQUE en
        # plus de get_unique_constraints(). Ce n'est pas un index additionnel.
        if index.get("duplicates_constraint") == "uq_user_module_permission":
            continue
        indexes[index.get("name")] = (
            tuple(index.get("column_names") or []),
            bool(index.get("unique")),
        )
    expected_indexes = {
        "ix_user_module_permissions_user_module": (("user_id", "module_key"), False),
        "ix_user_module_permissions_module_action": (("module_key", "action_key"), False),
    }
    if indexes != expected_indexes:
        errors.append(f"ensemble d'index invalide: {indexes}")

    if errors:
        _fail_schema(errors)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_module_permissions"):
        op.create_table(
            "user_module_permissions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("module_key", sa.String(80), nullable=False),
            sa.Column("action_key", sa.String(40), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column(
                "created_by_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.CheckConstraint(
                f"module_key IN ({_quoted(MODULES)})",
                name="ck_user_module_permission_module",
            ),
            sa.CheckConstraint(
                f"action_key IN ({_quoted(ACTIONS)})",
                name="ck_user_module_permission_action",
            ),
            sa.UniqueConstraint("user_id", "module_key", "action_key", name="uq_user_module_permission"),
        )

        op.create_index(
            "ix_user_module_permissions_user_module",
            "user_module_permissions",
            ["user_id", "module_key"],
        )
        op.create_index(
            "ix_user_module_permissions_module_action",
            "user_module_permissions",
            ["module_key", "action_key"],
        )
    else:
        _validate_existing_table(bind)


def downgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("user_module_permissions"):
        op.drop_table("user_module_permissions")
