import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url


REVISION = "20260908_0034"
PREVIOUS = "20260907_0033"


def _alembic(repo: Path, database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update({
        "APP_ENV": "test",
        "DATABASE_URL": database_url,
        "JWT_SECRET": "feature-permission-disposable-migration-secret",
    })
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _revision(database: Path) -> str:
    with sqlite3.connect(database) as connection:
        return connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]


def _assert_schema(database_url: str) -> None:
    inspector = inspect(create_engine(database_url))
    columns = {
        column["name"]: (str(column["type"]), bool(column["nullable"]))
        for column in inspector.get_columns("user_feature_permissions")
    }
    assert columns == {
        "id": ("INTEGER", False),
        "user_id": ("INTEGER", False),
        "module_key": ("VARCHAR(80)", False),
        "feature_key": ("VARCHAR(100)", False),
        "action_key": ("VARCHAR(40)", False),
        "created_at": ("DATETIME", False),
        "created_by_user_id": ("INTEGER", True),
    }
    unique = inspector.get_unique_constraints("user_feature_permissions")
    assert [(item["name"], item["column_names"]) for item in unique] == [
        ("uq_user_feature_permission", ["user_id", "module_key", "feature_key", "action_key"])
    ]
    indexes = {
        item["name"]: (item["column_names"], bool(item["unique"]))
        for item in inspector.get_indexes("user_feature_permissions")
    }
    assert indexes == {
        "ix_user_feature_permissions_user_module": (["user_id", "module_key"], False),
        "ix_user_feature_permissions_module_feature": (["module_key", "feature_key"], False),
    }
    assert {item["name"] for item in inspector.get_check_constraints("user_feature_permissions")} == {
        "ck_user_feature_permission_module",
        "ck_user_feature_permission_feature",
        "ck_user_feature_permission_action",
        "ck_user_feature_permission_applicable",
    }


def test_upgrade_refused_downgrade_preserves_schema_data_and_revision_sqlite(tmp_path):
    repo = Path(__file__).resolve().parents[1]
    database = tmp_path / "feature_permissions.sqlite"
    database_url = f"sqlite:///{database}"
    before = _alembic(repo, database_url, "upgrade", PREVIOUS)
    assert before.returncode == 0, before.stdout + before.stderr
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO users (username, full_name, role, password_hash, is_active, supervisor_read_only, global_society_access, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            ("feature-migration-user", "Feature Migration", "admin", "not-a-real-hash"),
        )
        user_id = connection.execute("SELECT id FROM users WHERE username = ?", ("feature-migration-user",)).fetchone()[0]
        connection.execute(
            "INSERT INTO user_module_permissions (user_id, module_key, action_key, created_at) VALUES (?, 'drh', 'read', CURRENT_TIMESTAMP)",
            (user_id,),
        )
        connection.commit()

    # upgrade 0033 -> 0034
    upgraded = _alembic(repo, database_url, "upgrade", REVISION)
    assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
    assert _revision(database) == REVISION
    _assert_schema(database_url)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT count(*) FROM user_feature_permissions").fetchone() == (0,)
        assert connection.execute("SELECT count(*) FROM user_module_permissions").fetchone() == (1,)
        connection.execute(
            "INSERT INTO user_feature_permissions "
            "(user_id, module_key, feature_key, action_key, created_at) "
            "VALUES (?, 'drh', 'employees', 'read', CURRENT_TIMESTAMP)",
            (user_id,),
        )
        connection.commit()

    # La propriété de la table est indémontrable : le downgrade est refusé avant DDL.
    schema_before = _sqlite_table_snapshot(database)
    refused = _alembic(repo, database_url, "downgrade", PREVIOUS)
    assert refused.returncode != 0
    assert "Downgrade 20260908_0034 refusé" in refused.stderr
    assert _revision(database) == REVISION
    assert _sqlite_table_snapshot(database) == schema_before
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='user_feature_permissions'").fetchone() == (1,)
        assert connection.execute(
            "SELECT user_id, module_key, feature_key, action_key "
            "FROM user_feature_permissions"
        ).fetchall() == [(user_id, "drh", "employees", "read")]
        assert connection.execute("SELECT count(*) FROM user_module_permissions").fetchone() == (1,)

    # Upgrade après tentative refusée : cohérent et sans effet, car la révision est 0034.
    reapplied = _alembic(repo, database_url, "upgrade", REVISION)
    assert reapplied.returncode == 0, reapplied.stdout + reapplied.stderr
    assert _revision(database) == REVISION
    _assert_schema(database_url)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT count(*) FROM user_feature_permissions").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM user_module_permissions").fetchone() == (1,)


def test_preexisting_table_is_refused_without_advancing_or_altering_data(tmp_path):
    repo = Path(__file__).resolve().parents[1]
    database = tmp_path / "feature_permissions_preexisting.sqlite"
    database_url = f"sqlite:///{database}"
    before = _alembic(repo, database_url, "upgrade", PREVIOUS)
    assert before.returncode == 0, before.stdout + before.stderr
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TABLE user_feature_permissions")
        connection.execute("CREATE TABLE user_feature_permissions (id INTEGER PRIMARY KEY, marker TEXT)")
        connection.execute("INSERT INTO user_feature_permissions (marker) VALUES ('preserve-me')")
        connection.commit()

    refused = _alembic(repo, database_url, "upgrade", REVISION)

    assert refused.returncode != 0
    assert "Schéma préexistant user_feature_permissions non conforme" in refused.stderr
    assert _revision(database) == PREVIOUS
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT marker FROM user_feature_permissions").fetchall() == [("preserve-me",)]


@pytest.fixture
def postgres_database_url():
    """Base PostgreSQL neuve créée uniquement si un serveur jetable est fourni."""
    raw_url = os.environ.get("TEST_POSTGRES_ADMIN_URL")
    if not raw_url:
        pytest.skip("TEST_POSTGRES_ADMIN_URL non défini")
    admin_url = make_url(raw_url)
    database_name = f"sgdi_feature_{uuid.uuid4().hex}"
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{database_name}"'))
    database_url = admin_url.set(database=database_name).render_as_string(hide_password=False)
    try:
        yield database_url
    finally:
        with engine.connect() as connection:
            connection.execute(
                text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :name"),
                {"name": database_name},
            )
            connection.execute(text(f'DROP DATABASE "{database_name}"'))
        engine.dispose()


def _postgres_revision(database_url: str) -> str:
    with create_engine(database_url).connect() as connection:
        return connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()


def _postgres_prepare_0033(database_url: str) -> Path:
    repo = Path(__file__).resolve().parents[1]
    result = _alembic(repo, database_url, "upgrade", PREVIOUS)
    assert result.returncode == 0, result.stdout + result.stderr
    assert _postgres_revision(database_url) == PREVIOUS
    return repo


def _postgres_table_snapshot(database_url: str) -> tuple:
    inspector = inspect(create_engine(database_url))
    return (
        tuple((column["name"], str(column["type"]), bool(column["nullable"])) for column in inspector.get_columns("user_feature_permissions")),
        tuple(inspector.get_pk_constraint("user_feature_permissions").get("constrained_columns") or ()),
        tuple(sorted((item["name"], tuple(item.get("column_names") or ())) for item in inspector.get_unique_constraints("user_feature_permissions"))),
        tuple(sorted(
            (
                tuple(item.get("constrained_columns") or ()),
                item.get("referred_schema"),
                item.get("referred_table"),
                tuple(item.get("referred_columns") or ()),
                (item.get("options") or {}).get("ondelete"),
            )
            for item in inspector.get_foreign_keys("user_feature_permissions")
        )),
        tuple(sorted((item["name"], tuple(item.get("column_names") or ()), bool(item.get("unique"))) for item in inspector.get_indexes("user_feature_permissions"))),
        tuple(sorted((item["name"], item.get("sqltext") or "") for item in inspector.get_check_constraints("user_feature_permissions"))),
    )


def _sqlite_table_snapshot(database: Path) -> tuple:
    with sqlite3.connect(database) as connection:
        return (
            tuple(connection.execute("PRAGMA table_info(user_feature_permissions)").fetchall()),
            tuple(connection.execute("PRAGMA foreign_key_list(user_feature_permissions)").fetchall()),
            tuple(connection.execute("PRAGMA index_list(user_feature_permissions)").fetchall()),
            tuple(connection.execute(
                "SELECT name, sql FROM sqlite_master "
                "WHERE tbl_name='user_feature_permissions' AND type IN ('table', 'index') "
                "ORDER BY type, name"
            ).fetchall()),
        )


_LEGACY_COLUMNS = (
    "authorized_societies", "authorized_structures", "authorized_sites",
    "authorized_actions", "authorized_modules", "global_society_access",
)


def _legacy_state(database_url: str, user_id: int) -> tuple:
    with create_engine(database_url).connect() as connection:
        return connection.execute(
            text(f"SELECT {', '.join(_LEGACY_COLUMNS)} FROM users WHERE id = :user_id"),
            {"user_id": user_id},
        ).one()


def test_postgresql_reflected_unique_index_upgrade_refused_downgrade(postgres_database_url):
    repo = _postgres_prepare_0033(postgres_database_url)
    engine = create_engine(postgres_database_url)

    # PostgreSQL reflète l'index physique de la contrainte UNIQUE (Anomalie 1).
    inspector = inspect(engine)
    reflected = {item["name"]: item for item in inspector.get_indexes("user_feature_permissions")}
    assert reflected["uq_user_feature_permission"]["duplicates_constraint"] == "uq_user_feature_permission"

    with engine.begin() as connection:
        user_id = connection.execute(text(
            "INSERT INTO users (username, full_name, role, password_hash, is_active, "
            "supervisor_read_only, global_society_access, authorized_societies, "
            "authorized_structures, authorized_sites, authorized_actions, authorized_modules, "
            "created_at, updated_at) VALUES ('feature-pg-preserved', 'Feature PG Preserved', "
            "'admin', 'not-a-hash', true, true, false, "
            "'[\"Iron Global Securite\"]'::json, '[\"OPS\"]'::json, '[7]'::json, "
            "'[\"read\"]'::json, '[\"drh\"]'::json, now(), now()) RETURNING id"
        )).scalar_one()
        connection.execute(
            text("INSERT INTO user_module_permissions (user_id, module_key, action_key, created_at) "
                 "VALUES (:user_id, 'drh', 'read', now())"),
            {"user_id": user_id},
        )
    legacy_before = _legacy_state(postgres_database_url, user_id)

    # upgrade 0033 -> 0034 : la table réfléchie est acceptée telle quelle, aucune permission créée
    upgraded = _alembic(repo, postgres_database_url, "upgrade", REVISION)
    assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
    assert _postgres_revision(postgres_database_url) == REVISION
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM user_feature_permissions")).scalar_one() == 0
        assert connection.execute(text("SELECT count(*) FROM user_module_permissions")).scalar_one() == 1
    assert _legacy_state(postgres_database_url, user_id) == legacy_before
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO user_feature_permissions "
                 "(user_id, module_key, feature_key, action_key, created_at) "
                 "VALUES (:user_id, 'drh', 'employees', 'read', now())"),
            {"user_id": user_id},
        )

    # Refus avant DDL : version, schéma, contraintes, index et données restent intacts.
    schema_before = _postgres_table_snapshot(postgres_database_url)
    refused = _alembic(repo, postgres_database_url, "downgrade", PREVIOUS)
    assert refused.returncode != 0
    assert "Downgrade 20260908_0034 refusé" in refused.stderr
    assert _postgres_revision(postgres_database_url) == REVISION
    assert _postgres_table_snapshot(postgres_database_url) == schema_before
    with engine.connect() as connection:
        assert inspect(engine).has_table("user_feature_permissions")
        assert connection.execute(text(
            "SELECT user_id, module_key, feature_key, action_key "
            "FROM user_feature_permissions"
        )).one() == (user_id, "drh", "employees", "read")
        assert connection.execute(text("SELECT count(*) FROM user_module_permissions")).scalar_one() == 1
    assert _legacy_state(postgres_database_url, user_id) == legacy_before

    # Upgrade après tentative refusée : no-op cohérent, la base est toujours en 0034.
    reapplied = _alembic(repo, postgres_database_url, "upgrade", REVISION)
    assert reapplied.returncode == 0, reapplied.stdout + reapplied.stderr
    assert _postgres_revision(postgres_database_url) == REVISION
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM user_feature_permissions")).scalar_one() == 1
        assert connection.execute(text("SELECT count(*) FROM user_module_permissions")).scalar_one() == 1


@pytest.mark.parametrize(
    "mutation",
    (
        "CREATE INDEX ix_unexpected_feature_permission ON user_feature_permissions(created_at)",
        "DROP INDEX ix_user_feature_permissions_user_module; CREATE INDEX ix_user_feature_permissions_user_module ON user_feature_permissions(module_key, user_id)",
        "DROP INDEX ix_user_feature_permissions_user_module; CREATE UNIQUE INDEX ix_user_feature_permissions_user_module ON user_feature_permissions(user_id, module_key)",
    ),
    ids=("extra-index", "wrong-columns", "wrong-unique"),
)
def test_postgresql_rejects_nonconforming_indexes(postgres_database_url, mutation):
    repo = _postgres_prepare_0033(postgres_database_url)
    engine = create_engine(postgres_database_url)
    with engine.begin() as connection:
        for statement in mutation.split("; "):
            connection.execute(text(statement))
    before = _postgres_table_snapshot(postgres_database_url)

    refused = _alembic(repo, postgres_database_url, "upgrade", REVISION)
    assert refused.returncode != 0
    assert _postgres_revision(postgres_database_url) == PREVIOUS
    assert _postgres_table_snapshot(postgres_database_url) == before


@pytest.mark.parametrize(
    ("constraint_name", "expression"),
    (
        ("ck_user_feature_permission_module", "module_key IN ('drh')"),
        ("ck_user_feature_permission_module", "module_key IN ('drh', 'invented')"),
        ("ck_user_feature_permission_feature", "module_key = 'drh' AND feature_key IN ('employees', 'invented')"),
        ("ck_user_feature_permission_action", "action_key IN ('read')"),
        ("ck_user_feature_permission_action", "action_key IN ('read', 'invented')"),
        ("ck_user_feature_permission_applicable", "module_key = 'drh' AND feature_key = 'employees' AND action_key IN ('pay')"),
        ("ck_user_feature_permission_action", "action_key IN ('read') OR 1 = 1"),
    ),
    ids=("module-missing", "module-extra", "feature-invalid", "action-missing", "action-extra", "applicability-invalid", "or-true"),
)
def test_postgresql_rejects_nonconforming_checks(
    postgres_database_url, constraint_name, expression
):
    repo = _postgres_prepare_0033(postgres_database_url)
    engine = create_engine(postgres_database_url)
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE user_feature_permissions DROP CONSTRAINT {constraint_name}"))
        connection.execute(text(f"ALTER TABLE user_feature_permissions ADD CONSTRAINT {constraint_name} CHECK ({expression})"))
    before = _postgres_table_snapshot(postgres_database_url)

    refused = _alembic(repo, postgres_database_url, "upgrade", REVISION)
    assert refused.returncode != 0
    assert _postgres_revision(postgres_database_url) == PREVIOUS
    assert _postgres_table_snapshot(postgres_database_url) == before


def test_postgresql_absent_table_is_created_without_permissions(postgres_database_url):
    repo = _postgres_prepare_0033(postgres_database_url)
    engine = create_engine(postgres_database_url)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE user_feature_permissions"))

    upgraded = _alembic(repo, postgres_database_url, "upgrade", REVISION)
    assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
    assert _postgres_revision(postgres_database_url) == REVISION
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM user_feature_permissions")).scalar_one() == 0


def test_postgresql_nonempty_preexisting_table_is_refused(postgres_database_url):
    repo = _postgres_prepare_0033(postgres_database_url)
    engine = create_engine(postgres_database_url)
    with engine.begin() as connection:
        user_id = connection.execute(text(
            "INSERT INTO users (username, full_name, role, password_hash, is_active, "
            "supervisor_read_only, global_society_access, created_at, updated_at) "
            "VALUES ('feature-pg-user', 'Feature PG', 'admin', 'not-a-hash', true, true, false, now(), now()) RETURNING id"
        )).scalar_one()
        connection.execute(
            text("INSERT INTO user_feature_permissions (user_id, module_key, feature_key, action_key, created_at) VALUES (:user_id, 'drh', 'employees', 'read', now())"),
            {"user_id": user_id},
        )

    refused = _alembic(repo, postgres_database_url, "upgrade", REVISION)
    assert refused.returncode != 0
    assert _postgres_revision(postgres_database_url) == PREVIOUS
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM user_feature_permissions")).scalar_one() == 1
