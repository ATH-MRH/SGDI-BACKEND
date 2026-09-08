"""Ajoute le stockage inerte des permissions par fonctionnalité.

Revision ID: 20260908_0034
Revises: 20260907_0033
"""

from alembic import op
import sqlalchemy as sa
import re


revision = "20260908_0034"
down_revision = "20260907_0033"
branch_labels = None
depends_on = None


ACTIONS = (
    "read", "create", "update", "validate", "delete", "export", "unlock",
    "admin", "sign", "pay", "recruit", "execute",
)

# Instantané immuable du catalogue au moment de la migration. Les libellés restent
# applicatifs ; seules les clés et actions contractuelles appartiennent au schéma.
FEATURE_ACTIONS = {
    "administration": {"users": ("read", "create", "update", "delete", "unlock", "admin"), "access_rules": ("read", "update", "admin"), "security": ("read", "update", "unlock", "admin")},
    "drh": {"dashboard": ("read", "export"), "employees": ("read", "create", "update", "delete", "export"), "positions": ("read", "create", "update", "delete", "admin"), "position_files": ("read", "export"), "contracts": ("read", "create", "update", "delete", "export", "sign"), "sanctions": ("read", "create", "validate"), "documents": ("read", "create", "delete", "export"), "contract_templates": ("read", "create", "update", "delete", "export", "admin")},
    "recruitment": {"candidates": ("read", "create", "update", "validate", "delete", "recruit"), "contact_duplicates": ("read",), "convocations": ("create", "execute"), "contractualization": ("update", "validate", "recruit")},
    "leaves": {"requests": ("read", "create", "validate")},
    "ops": {"dashboard": ("read", "export"), "rotations": ("read", "create", "update", "delete"), "sites": ("read", "create", "update", "delete"), "site_posts": ("read", "create"), "assignments": ("read", "create", "update"), "events": ("read", "create", "validate"), "movements": ("read", "create", "execute")},
    "attendance": {"daily_sheets": ("read", "create", "update", "validate"), "generation": ("validate", "execute"), "qr_scanning": ("read", "create", "execute"), "manual_entry": ("read", "create"), "staffing": ("read", "export"), "statistics": ("read", "export")},
    "material": {"dashboard": ("read",), "stores": ("read", "create", "update", "delete"), "suppliers": ("read", "create", "update", "delete"), "articles": ("read", "create", "update", "delete"), "inventory": ("read", "export"), "movements": ("read", "create", "delete"), "allocations": ("read", "create", "update", "execute"), "initialization": ("admin", "execute")},
    "commercial": {"clients": ("read", "create", "update", "delete"), "settings": ("read", "update", "admin"), "access_rules": ("read", "update", "admin"), "client_contracts": ("read", "update", "sign")},
    "sales": {"quotes": ("read", "create", "update", "validate", "delete", "export"), "orders": ("read", "create", "update", "delete", "export"), "deliveries": ("read", "create", "update", "delete", "execute")},
    "purchases": {"suppliers": ("read", "create", "update", "delete", "export"), "orders": ("read", "create", "update", "validate", "delete", "export"), "receipts": ("read", "create", "update", "validate", "delete", "execute"), "invoices": ("read", "create", "update", "pay", "export")},
    "accounting": {"accounts": ("read", "create", "update", "delete"), "entries": ("read", "create", "update", "validate", "delete"), "entry_lines": ("create", "update", "delete"), "balance": ("read", "export")},
    "finance": {"entries": ("read", "export"), "payroll": ("read", "export")},
    "reporting": {"dashboard": ("read", "export"), "sales": ("read", "export"), "purchases": ("read", "export"), "treasury": ("read", "export"), "rankings": ("read", "export")},
    "loans": {"employee_requests": ("read", "create", "update", "delete"), "review": ("read", "update", "validate"), "decisions": ("read", "validate", "sign", "export"), "contracts": ("read", "sign", "export"), "secretariat": ("read", "validate"), "disbursements": ("pay",), "repayments": ("read", "create", "pay"), "settings": ("read", "update", "admin")},
    "secretariat": {"mail": ("read", "create", "update", "validate", "export"), "signature_book": ("read", "validate", "sign"), "missions": ("read", "create", "update", "validate", "sign", "export"), "agenda": ("read", "create", "update", "delete"), "minutes": ("read", "create", "update", "sign", "export"), "decisions": ("read", "create", "validate", "sign", "export"), "documents": ("read", "create", "update", "delete", "export"), "messaging": ("read", "create"), "archives": ("read", "export", "admin")},
    "cash": {"transactions": ("read", "create", "update", "pay", "export"), "loan_disbursements": ("read", "pay"), "loan_repayments": ("read", "create", "pay")},
    "employee_portal": {"accounts": ("read", "create", "update", "delete", "unlock", "admin"), "requests": ("read", "create"), "attendance": ("read", "create"), "passwords": ("update", "unlock"), "notifications": ("read", "create", "delete", "execute")},
    "client_portal": {"employees": ("read", "update"), "sites": ("read", "create", "update", "delete"), "equipment": ("read", "create"), "observations": ("read", "create", "validate"), "accounts": ("read", "create", "update", "delete", "unlock", "admin")},
    "rounds": {"circuits": ("read", "create", "update", "delete"), "checkpoints": ("create", "update", "delete"), "executions": ("read", "execute")},
    "assistant": {"chat": ("create", "execute"), "agent": ("execute",), "speech": ("read",)},
    "erp_cockpit": {"operational_preparation": ("read", "export")},
    "legacy": {"database": ("read", "create", "update", "admin"), "collections": ("read", "create", "update", "delete"), "positions": ("read", "create", "delete"), "generic_actions": ("validate", "execute")},
    "ui": {"sidebar_stats": ("read",), "app_launcher": ("execute",)},
}


def _quoted(values) -> str:
    return ", ".join(repr(value) for value in values)


def _feature_check() -> str:
    return " OR ".join(
        f"(module_key = {module!r} AND feature_key IN ({_quoted(features)}))"
        for module, features in FEATURE_ACTIONS.items()
    )


def _applicable_check() -> str:
    return " OR ".join(
        f"(module_key = {module!r} AND feature_key = {feature!r} AND action_key IN ({_quoted(actions)}))"
        for module, features in FEATURE_ACTIONS.items()
        for feature, actions in features.items()
    )


def _without_casts(sqltext: str) -> str:
    expression = (sqltext or "").lower().replace('"', "")
    expression = re.sub(
        r"::\s*(?:character varying|varchar|text)(?:\s*\[\s*\])?",
        "",
        expression,
    )
    expression = re.sub(r"\bcheck\b", "", expression)
    expression = re.sub(r"\barray\s*\[", "(", expression)
    expression = expression.replace("]", ")")
    return "".join(expression.split())


def _strip_outer_parentheses(expression: str) -> str:
    value = expression
    while value.startswith("(") and value.endswith(")"):
        depth = 0
        quoted = False
        encloses_all = True
        index = 0
        while index < len(value):
            char = value[index]
            if char == "'":
                if quoted and index + 1 < len(value) and value[index + 1] == "'":
                    index += 2
                    continue
                quoted = not quoted
            elif not quoted:
                if char == "(":
                    depth += 1
                elif char == ")":
                    depth -= 1
                    if depth == 0 and index != len(value) - 1:
                        encloses_all = False
                        break
            index += 1
        if not encloses_all or depth != 0 or quoted:
            break
        value = value[1:-1]
    return value


def _split_boolean(expression: str, operator: str) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    quoted = False
    index = 0
    while index < len(expression):
        char = expression[index]
        if char == "'":
            if quoted and index + 1 < len(expression) and expression[index + 1] == "'":
                index += 2
                continue
            quoted = not quoted
        elif not quoted:
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            elif depth == 0 and expression.startswith(operator, index):
                parts.append(expression[start:index])
                index += len(operator)
                start = index
                continue
        index += 1
    parts.append(expression[start:])
    return parts


def _parse_literals(expression: str) -> tuple[str, ...] | None:
    value = _strip_outer_parentheses(expression)
    if not value:
        return ()
    literals: list[str] = []
    index = 0
    while index < len(value):
        match = re.match(r"'((?:''|[^'])*)'", value[index:])
        if not match:
            return None
        literals.append(match.group(1).replace("''", "'"))
        index += match.end()
        if index == len(value):
            break
        if value[index] != ",":
            return None
        index += 1
    return tuple(literals)


def _parse_term(expression: str) -> tuple[str, tuple[str, ...]] | None:
    """Réduit un terme à (colonne, valeurs triées).

    `col = 'x'` et `col IN ('x')` sont sémantiquement identiques : PostgreSQL
    effondre `IN` à un seul élément en `=`. On ne conserve donc QUE l'ensemble
    des valeurs, sans marqueur d'opérateur, pour rester équivalent des deux
    côtés. Toute autre forme (`1 = 1`, `col <> 'x'`, prédicat élargi) ne
    correspond à aucun des deux motifs et renvoie None -> refus.
    """
    value = _strip_outer_parentheses(expression)
    equality = re.fullmatch(r"([a-z_][a-z0-9_]*)='((?:''|[^'])*)'", value)
    if equality:
        return equality.group(1), (equality.group(2).replace("''", "'"),)
    membership = re.fullmatch(
        r"([a-z_][a-z0-9_]*)(?:in|=any)(\(.*\))",
        value,
    )
    if membership:
        literals = _parse_literals(membership.group(2))
        if literals is not None:
            return membership.group(1), tuple(sorted(literals))
    return None


def _check_clauses(sqltext: str) -> tuple[tuple[tuple[str, tuple[str, ...]], ...], ...] | None:
    expression = _strip_outer_parentheses(_without_casts(sqltext))
    clauses = []
    for raw_clause in _split_boolean(expression, "or"):
        clause = _strip_outer_parentheses(raw_clause)
        terms = []
        for raw_term in _split_boolean(clause, "and"):
            term = _parse_term(raw_term)
            if term is None:
                return None
            terms.append(term)
        clauses.append(tuple(sorted(terms)))
    return tuple(sorted(clauses))


def _expected_membership(column: str, values) -> tuple:
    return (((column, tuple(sorted(values))),),)


def _expected_feature_clauses() -> tuple:
    return tuple(sorted(
        tuple(sorted((
            ("module_key", (module,)),
            ("feature_key", tuple(sorted(features))),
        )))
        for module, features in FEATURE_ACTIONS.items()
    ))


def _expected_applicable_clauses() -> tuple:
    return tuple(sorted(
        tuple(sorted((
            ("module_key", (module,)),
            ("feature_key", (feature,)),
            ("action_key", tuple(sorted(actions))),
        )))
        for module, features in FEATURE_ACTIONS.items()
        for feature, actions in features.items()
    ))


def _validate_existing_table(bind) -> None:
    inspector = sa.inspect(bind)
    errors = []
    type_name = lambda value: " ".join(str(value.compile(dialect=bind.dialect)).upper().split())
    columns = {
        item["name"]: (type_name(item["type"]), bool(item["nullable"]))
        for item in inspector.get_columns("user_feature_permissions")
    }
    expected_columns = {
        "id": (type_name(sa.Integer()), False), "user_id": (type_name(sa.Integer()), False),
        "module_key": (type_name(sa.String(80)), False), "feature_key": (type_name(sa.String(100)), False),
        "action_key": (type_name(sa.String(40)), False), "created_at": (type_name(sa.DateTime()), False),
        "created_by_user_id": (type_name(sa.Integer()), True),
    }
    if columns != expected_columns:
        errors.append(f"colonnes={columns!r}")
    if inspector.get_pk_constraint("user_feature_permissions").get("constrained_columns") != ["id"]:
        errors.append("clé primaire")
    uniques = {
        item["name"]: tuple(item.get("column_names") or ())
        for item in inspector.get_unique_constraints("user_feature_permissions")
    }
    if uniques != {"uq_user_feature_permission": ("user_id", "module_key", "feature_key", "action_key")}:
        errors.append(f"unicité={uniques!r}")
    indexes = {}
    for item in inspector.get_indexes("user_feature_permissions"):
        if item.get("duplicates_constraint") == "uq_user_feature_permission":
            continue
        indexes[item["name"]] = (
            tuple(item.get("column_names") or ()),
            bool(item.get("unique")),
        )
    expected_indexes = {
        "ix_user_feature_permissions_user_module": (("user_id", "module_key"), False),
        "ix_user_feature_permissions_module_feature": (("module_key", "feature_key"), False),
    }
    if indexes != expected_indexes:
        errors.append(f"index={indexes!r}")
    checks = {
        item["name"]: item.get("sqltext") or ""
        for item in inspector.get_check_constraints("user_feature_permissions")
    }
    expected_checks = {
        "ck_user_feature_permission_module": _expected_membership("module_key", FEATURE_ACTIONS),
        "ck_user_feature_permission_feature": _expected_feature_clauses(),
        "ck_user_feature_permission_action": _expected_membership("action_key", ACTIONS),
        "ck_user_feature_permission_applicable": _expected_applicable_clauses(),
    }
    if set(checks) != set(expected_checks):
        errors.append(f"contraintes CHECK={sorted(checks)!r}")
    for name, expected in expected_checks.items():
        sqltext = checks.get(name)
        if sqltext is None:
            continue
        actual = _check_clauses(sqltext)
        if actual != expected:
            errors.append(f"expression CHECK invalide pour {name}: {sqltext}")
    foreign_keys = {
        tuple(item.get("constrained_columns") or ()): (
            item.get("referred_table"), tuple(item.get("referred_columns") or ()),
            (item.get("options") or {}).get("ondelete"),
        )
        for item in inspector.get_foreign_keys("user_feature_permissions")
    }
    if foreign_keys != {
        ("user_id",): ("users", ("id",), "CASCADE"),
        ("created_by_user_id",): ("users", ("id",), "SET NULL"),
    }:
        errors.append(f"clés étrangères={foreign_keys!r}")
    count = bind.execute(sa.text("SELECT count(*) FROM user_feature_permissions")).scalar_one()
    if count:
        errors.append("table préexistante non vide")
    if errors:
        raise RuntimeError(
            "Schéma préexistant user_feature_permissions non conforme : " + "; ".join(errors)
        )


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("user_feature_permissions"):
        # La migration initiale historique utilise Base.metadata.create_all() et
        # peut donc matérialiser une table future sur une base vierge. On accepte
        # uniquement son schéma exact et vide, sans adopter ni convertir de donnée.
        _validate_existing_table(bind)
        return
    op.create_table(
        "user_feature_permissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_key", sa.String(80), nullable=False),
        sa.Column("feature_key", sa.String(100), nullable=False),
        sa.Column("action_key", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("user_id", "module_key", "feature_key", "action_key", name="uq_user_feature_permission"),
        sa.CheckConstraint(f"module_key IN ({_quoted(FEATURE_ACTIONS)})", name="ck_user_feature_permission_module"),
        sa.CheckConstraint(_feature_check(), name="ck_user_feature_permission_feature"),
        sa.CheckConstraint(f"action_key IN ({_quoted(ACTIONS)})", name="ck_user_feature_permission_action"),
        sa.CheckConstraint(_applicable_check(), name="ck_user_feature_permission_applicable"),
    )
    op.create_index("ix_user_feature_permissions_user_module", "user_feature_permissions", ["user_id", "module_key"])
    op.create_index("ix_user_feature_permissions_module_feature", "user_feature_permissions", ["module_key", "feature_key"])


def downgrade() -> None:
    # La migration initiale historique utilise Base.metadata.create_all() et peut
    # avoir matérialisé cette table avant 0034. Sa propriété est donc impossible à
    # établir de façon fiable : refuser avant toute DDL évite toute perte de données
    # et empêche Alembic d'abaisser artificiellement la révision à 0033.
    raise RuntimeError(
        "Downgrade 20260908_0034 refusé : "
        "propriété de user_feature_permissions indémontrable"
    )
