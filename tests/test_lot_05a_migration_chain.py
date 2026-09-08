import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import create_engine, inspect

from app.core.permission_catalog import CANONICAL_ACTIONS, CANONICAL_MODULES


def _run_alembic(repo: Path, database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "test",
            "DATABASE_URL": database_url,
            "JWT_SECRET": "lot-05a-disposable-migration-test-secret",
        }
    )
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


EXPECTED_COLUMNS = {
    "id": ("INTEGER", False),
    "user_id": ("INTEGER", False),
    "module_key": ("VARCHAR(80)", False),
    "action_key": ("VARCHAR(40)", False),
    "created_at": ("DATETIME", False),
    "created_by_user_id": ("INTEGER", True),
}


def _assert_complete_schema(database_url: str) -> None:
    inspector = inspect(create_engine(database_url))
    columns = {
        column["name"]: (str(column["type"]), bool(column["nullable"]))
        for column in inspector.get_columns("user_module_permissions")
    }
    assert columns == EXPECTED_COLUMNS
    assert inspector.get_pk_constraint("user_module_permissions")["constrained_columns"] == ["id"]

    foreign_keys = {
        tuple(foreign_key["constrained_columns"]): (
            foreign_key["referred_table"],
            tuple(foreign_key["referred_columns"]),
            (foreign_key.get("options") or {}).get("ondelete"),
        )
        for foreign_key in inspector.get_foreign_keys("user_module_permissions")
    }
    assert foreign_keys == {
        ("user_id",): ("users", ("id",), "CASCADE"),
        ("created_by_user_id",): ("users", ("id",), "SET NULL"),
    }
    uniques = {
        constraint["name"]: tuple(constraint["column_names"])
        for constraint in inspector.get_unique_constraints("user_module_permissions")
    }
    assert uniques == {
        "uq_user_module_permission": ("user_id", "module_key", "action_key")
    }
    checks = {
        constraint["name"]: constraint["sqltext"]
        for constraint in inspector.get_check_constraints("user_module_permissions")
    }
    assert set(checks) == {"ck_user_module_permission_action", "ck_user_module_permission_module"}
    assert all(f"'{value}'" in checks["ck_user_module_permission_module"] for value in CANONICAL_MODULES)
    assert all(f"'{value}'" in checks["ck_user_module_permission_action"] for value in CANONICAL_ACTIONS)
    indexes = {
        index["name"]: (tuple(index["column_names"]), bool(index["unique"]))
        for index in inspector.get_indexes("user_module_permissions")
    }
    assert indexes == {
        "ix_user_module_permissions_user_module": (("user_id", "module_key"), False),
        "ix_user_module_permissions_module_action": (("module_key", "action_key"), False),
    }


def _assert_empty_and_at_revision(database: Path, revision: str) -> None:
    with sqlite3.connect(database) as connection:
        current = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        count = connection.execute("SELECT count(*) FROM user_module_permissions").fetchone()
    assert current == (revision,)
    assert count == (0,)


def test_full_alembic_chain_on_disposable_database(tmp_path):
    repo = Path(__file__).resolve().parents[1]
    database = tmp_path / "lot_05a_chain.sqlite"
    database_url = f"sqlite:///{database}"

    upgraded = _run_alembic(repo, database_url, "upgrade", "20260907_0033")
    assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr

    _assert_complete_schema(database_url)
    _assert_empty_and_at_revision(database, "20260907_0033")

    downgraded = _run_alembic(repo, database_url, "downgrade", "20260907_0032")
    assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr
    reapplied = _run_alembic(repo, database_url, "upgrade", "20260907_0033")
    assert reapplied.returncode == 0, reapplied.stdout + reapplied.stderr
    _assert_complete_schema(database_url)
    _assert_empty_and_at_revision(database, "20260907_0033")


def test_preexisting_conforming_table_is_strictly_accepted(tmp_path):
    repo = Path(__file__).resolve().parents[1]
    database = tmp_path / "lot_05a_conforming.sqlite"
    database_url = f"sqlite:///{database}"

    before = _run_alembic(repo, database_url, "upgrade", "20260907_0032")
    assert before.returncode == 0, before.stdout + before.stderr
    _assert_complete_schema(database_url)
    upgraded = _run_alembic(repo, database_url, "upgrade", "20260907_0033")
    assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
    _assert_complete_schema(database_url)
    _assert_empty_and_at_revision(database, "20260907_0033")


CONFORMING_COLUMNS = """
    id INTEGER NOT NULL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    module_key VARCHAR(80) NOT NULL,
    action_key VARCHAR(40) NOT NULL,
    created_at DATETIME NOT NULL,
    created_by_user_id INTEGER,
    CONSTRAINT uq_user_module_permission UNIQUE (user_id, module_key, action_key),
    CONSTRAINT ck_user_module_permission_module CHECK (module_key IN ({modules})),
    CONSTRAINT ck_user_module_permission_action CHECK (action_key IN ({actions})),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
"""


def _quoted(values):
    return ", ".join(f"'{value}'" for value in values)


def _replace_table(database: Path, columns: str, *, indexes: tuple[str, ...] = ()) -> str:
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("DROP TABLE user_module_permissions")
        connection.execute(f"CREATE TABLE user_module_permissions ({columns})")
        for statement in indexes:
            connection.execute(statement)
        connection.commit()
        definition = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_module_permissions'"
        ).fetchone()[0]
    return definition


GOOD_COLUMNS = CONFORMING_COLUMNS.format(
    modules=_quoted(CANONICAL_MODULES), actions=_quoted(CANONICAL_ACTIONS)
)
GOOD_INDEXES = (
    "CREATE INDEX ix_user_module_permissions_user_module ON user_module_permissions(user_id, module_key)",
    "CREATE INDEX ix_user_module_permissions_module_action ON user_module_permissions(module_key, action_key)",
)


NONCONFORMING_SCHEMAS = (
    ("colonnes", "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL", ()),
    ("type", GOOD_COLUMNS.replace("user_id INTEGER NOT NULL", "user_id BIGINT NOT NULL", 1), GOOD_INDEXES),
    ("nullabilite", GOOD_COLUMNS.replace("module_key VARCHAR(80) NOT NULL", "module_key VARCHAR(80)", 1), GOOD_INDEXES),
    ("cle_primaire", GOOD_COLUMNS.replace("id INTEGER NOT NULL PRIMARY KEY", "id INTEGER NOT NULL", 1), GOOD_INDEXES),
    ("cle_etrangere", GOOD_COLUMNS.replace("ON DELETE CASCADE", "ON DELETE RESTRICT", 1), GOOD_INDEXES),
    ("unicite", GOOD_COLUMNS.replace("CONSTRAINT uq_user_module_permission UNIQUE (user_id, module_key, action_key),", ""), GOOD_INDEXES),
    ("unicite_ordre", GOOD_COLUMNS.replace("UNIQUE (user_id, module_key, action_key)", "UNIQUE (module_key, user_id, action_key)", 1), GOOD_INDEXES),
    ("check", GOOD_COLUMNS.replace("CHECK (action_key IN (", "CHECK (1 = 1 OR action_key IN (", 1), GOOD_INDEXES),
    ("index_absent", GOOD_COLUMNS, GOOD_INDEXES[:1]),
    ("index_supplementaire", GOOD_COLUMNS, GOOD_INDEXES + ("CREATE INDEX ix_unexpected ON user_module_permissions(created_at)",)),
)


@pytest.mark.parametrize(("category", "columns", "indexes"), NONCONFORMING_SCHEMAS)
def test_preexisting_nonconforming_table_fails_without_advancing_revision(
    tmp_path, category, columns, indexes
):
    repo = Path(__file__).resolve().parents[1]
    database = tmp_path / "lot_05a_nonconforming.sqlite"
    database_url = f"sqlite:///{database}"

    before = _run_alembic(repo, database_url, "upgrade", "20260907_0032")
    assert before.returncode == 0, before.stdout + before.stderr
    definition_before = _replace_table(database, columns, indexes=indexes)

    upgraded = _run_alembic(repo, database_url, "upgrade", "20260907_0033")

    assert upgraded.returncode != 0
    assert "Schéma existant user_module_permissions non conforme" in upgraded.stderr
    with sqlite3.connect(database) as connection:
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        definition_after = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_module_permissions'"
        ).fetchone()[0]
        count = connection.execute("SELECT count(*) FROM user_module_permissions").fetchone()
    assert revision == ("20260907_0032",)
    assert definition_after == definition_before, category
    assert count == (0,)
