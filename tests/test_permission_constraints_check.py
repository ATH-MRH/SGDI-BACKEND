"""Contrôle indépendant des contraintes CHECK des tables de permissions
(scripts/check_permission_constraints.py).

Couvre notamment le cas que le contrôle défensif de la migration 20260908_0034 laisse passer :
une contrainte élargie par une clause toujours vraie. Exécuté uniquement si
TEST_POSTGRES_ADMIN_URL désigne un serveur PostgreSQL JETABLE."""
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from scripts import check_permission_constraints as checker
from tests.test_feature_permissions_migration import _alembic, postgres_database_url  # noqa: F401 (fixture)

REPO = Path(__file__).resolve().parents[1]


def _differences(database_url):
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                return checker.differences(connection)
            finally:
                transaction.rollback()
    finally:
        engine.dispose()


def _execute(database_url, *statements):
    engine = create_engine(database_url)
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
    engine.dispose()


# ── Comparaison (sans base) ──────────────────────────────────────────────────────────────
A = "((action_key)::text = ANY ((ARRAY['read'::character varying, 'create'::character varying])::text[]))"
A_REORDERED = "((action_key)::text = ANY ((ARRAY['create'::character varying, 'read'::character varying])::text[]))"
PAIRS = "((((m)::text = 'drh'::text) AND ((f)::text = 'x'::text)) OR (((m)::text = 'ops'::text) AND ((f)::text = 'y'::text)))"
PAIRS_REORDERED = "((((f)::text = 'y'::text) AND ((m)::text = 'ops'::text)) OR (((m)::text = 'drh'::text) AND ((f)::text = 'x'::text)))"


def test_only_the_order_of_terms_and_values_is_ignored():
    assert checker.canonical(A) == checker.canonical(A_REORDERED)
    assert checker.canonical(PAIRS) == checker.canonical(PAIRS_REORDERED)


def test_form_reloaded_from_a_dump_is_the_same_constraint():
    """Après un pg_dump / pg_restore, PostgreSQL réécrit la liste avec une conversion par valeur."""
    reloaded = "((action_key)::text = ANY (ARRAY[('read'::character varying)::text, ('create'::character varying)::text]))"
    assert checker.canonical(reloaded) == checker.canonical(A)
    assert checker.canonical(reloaded.replace("('create'::character varying)::text", "('pay'::character varying)::text")) != checker.canonical(A)
    assert checker.canonical(f"({reloaded} OR (1 = 1))") != checker.canonical(A)


@pytest.mark.parametrize("altered", (
    f"({A} OR (1 = 1))",
    f"({A} OR true)",
    A.replace("'create'::character varying", "'create'::character varying, 'pay'::character varying"),
    A.replace(", 'create'::character varying", ""),
    A.replace("= ANY", "<> ALL"),
    PAIRS.replace(" AND ", " OR "),
    PAIRS.replace("'ops'", "'drh'"),
    "true",
), ids=("or-true", "or-true-literal", "value-added", "value-removed", "operator", "and-to-or", "pair-changed", "true"))
def test_any_other_difference_is_a_difference(altered):
    assert checker.canonical(altered) not in (checker.canonical(A), checker.canonical(PAIRS))


@pytest.fixture
def migrated(postgres_database_url):  # noqa: F811
    result = _alembic(REPO, postgres_database_url, "upgrade", "head")
    assert result.returncode == 0, result.stdout + result.stderr
    return postgres_database_url


def test_schema_built_by_the_whole_migration_chain_matches_the_models(migrated):
    assert _differences(migrated) == []


@pytest.mark.parametrize(("table", "constraint", "expression"), (
    ("user_feature_permissions", "ck_user_feature_permission_action", "action_key IN ('read') OR 1 = 1"),
    ("user_feature_permissions", "ck_user_feature_permission_action", "true"),
    ("user_feature_permissions", "ck_user_feature_permission_module", "module_key IN ('drh') OR module_key IS NOT NULL"),
    ("user_feature_permissions", "ck_user_feature_permission_module", "module_key IN ('drh')"),
    ("user_feature_permissions", "ck_user_feature_permission_applicable", "length(action_key) > 0"),
    ("user_module_permissions", None, "true"),
), ids=("action-or-true", "action-true", "module-widened", "module-narrowed", "applicable-replaced", "module-table-true"))
def test_altered_constraint_is_reported_by_name(migrated, table, constraint, expression):
    if constraint is None:
        engine = create_engine(migrated)
        with engine.connect() as connection:
            constraint = connection.execute(text("SELECT conname FROM pg_constraint WHERE conrelid = to_regclass(:t) AND contype = 'c' "
                                                 "ORDER BY conname LIMIT 1"), {"t": table}).scalar_one()
        engine.dispose()
    _execute(migrated, f"ALTER TABLE {table} DROP CONSTRAINT {constraint}",
             f"ALTER TABLE {table} ADD CONSTRAINT {constraint} CHECK ({expression})")

    assert _differences(migrated) == [f"{table} : contrainte {constraint} différente du modèle"]


def test_database_reloaded_from_a_dump_is_still_conforming(migrated):
    """Recréer chaque contrainte à partir de sa définition relue (ce que fait une restauration)
    change son écriture, pas son sens : le contrôle ne doit pas crier au loup après une reprise."""
    engine = create_engine(migrated)
    with engine.begin() as connection:
        rows = connection.execute(text("SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) FROM pg_constraint "
                                       "WHERE contype = 'c' AND conrelid IN (to_regclass('user_feature_permissions'), to_regclass('user_module_permissions'))")).all()
        for table, name, definition in rows:
            connection.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT {name}"))
            connection.execute(text(f"ALTER TABLE {table} ADD CONSTRAINT {name} {definition}"))
        rewritten = sum(1 for table, name, definition in rows if definition != connection.execute(text(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = :n AND conrelid = to_regclass(:t)"), {"n": name, "t": table}).scalar())
    engine.dispose()
    assert rewritten > 0, "PostgreSQL n'a réécrit aucune contrainte : le scénario ne teste rien"
    assert _differences(migrated) == []


def test_missing_and_unexpected_constraints_are_reported(migrated):
    _execute(migrated, "ALTER TABLE user_feature_permissions DROP CONSTRAINT ck_user_feature_permission_action",
             "ALTER TABLE user_feature_permissions ADD CONSTRAINT ck_surprise CHECK (user_id > 0)")
    assert _differences(migrated) == ["user_feature_permissions : contrainte ck_surprise inattendue",
                                      "user_feature_permissions : contrainte ck_user_feature_permission_action absente"]


def test_check_leaves_no_table_and_changes_nothing(migrated):
    def snapshot():
        engine = create_engine(migrated)
        with engine.connect() as connection:
            tables = connection.execute(text("SELECT count(*) FROM pg_class WHERE relkind = 'r' AND relname LIKE 'expected_%'")).scalar_one()
            checks = connection.execute(text("SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE contype = 'c' ORDER BY 1, 2")).all()
        engine.dispose()
        return tables, checks

    before = snapshot()
    assert _differences(migrated) == [] and _differences(migrated) == []      # rejouable
    assert snapshot() == before and before[0] == 0


def test_script_exit_codes(migrated, monkeypatch, capsys):
    import app.db.session as db_session

    engine = create_engine(migrated)
    monkeypatch.setattr(db_session, "engine", engine)
    try:
        assert checker.main() == 0 and "CONFORME" in capsys.readouterr().out
        _execute(migrated, "ALTER TABLE user_feature_permissions DROP CONSTRAINT ck_user_feature_permission_action",
                 "ALTER TABLE user_feature_permissions ADD CONSTRAINT ck_user_feature_permission_action CHECK (action_key IN ('read') OR 1 = 1)")
        assert checker.main() == 1 and "ÉCART" in capsys.readouterr().out
        _execute(migrated, "DROP TABLE user_feature_permissions")
        assert checker.main() == 3
    finally:
        engine.dispose()
