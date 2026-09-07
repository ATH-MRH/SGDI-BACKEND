import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import Boolean, create_engine, inspect


REPO = Path(__file__).resolve().parents[1]
ROLES = ("ADMIN", "ADM", "ADM1", "ADM2", "user")


def _run_alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update({
        "APP_ENV": "test",
        "DATABASE_URL": database_url,
        "JWT_SECRET": "security-foundations-disposable-migration-secret",
    })
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _upgrade(database_url: str, revision: str) -> None:
    result = _run_alembic(database_url, "upgrade", revision)
    assert result.returncode == 0, result.stdout + result.stderr


def _revision(database: Path) -> str:
    with sqlite3.connect(database) as connection:
        return connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]


def _insert_users(database: Path, values: tuple[tuple[str, bool], ...]) -> None:
    with sqlite3.connect(database) as connection:
        connection.executemany(
            """
            INSERT INTO users (
                username, full_name, role, password_hash, is_active,
                supervisor_read_only, global_society_access, created_at, updated_at
            ) VALUES (?, ?, ?, 'hash', 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ((role, role, role, int(global_access)) for role, global_access in values),
        )
        connection.commit()


def _drop_0032_objects(database: Path) -> None:
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TABLE audit_events")
        connection.execute("DROP TABLE portal_password_reset_tokens")
        connection.execute("ALTER TABLE users DROP COLUMN global_society_access")
        connection.commit()


def test_upgrade_from_0031_creates_objects_without_role_based_global_grant(tmp_path):
    database = tmp_path / "0032_absent.sqlite"
    database_url = f"sqlite:///{database}"
    _upgrade(database_url, "20260906_0031")
    _drop_0032_objects(database)

    # La colonne absente empêche l'aide commune; insertion minimale des cinq rôles.
    with sqlite3.connect(database) as connection:
        connection.executemany(
            """
            INSERT INTO users (
                username, full_name, role, password_hash, is_active,
                supervisor_read_only, created_at, updated_at
            ) VALUES (?, ?, ?, 'hash', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ((role, role, role) for role in ROLES),
        )
        connection.commit()

    _upgrade(database_url, "20260907_0032")
    assert _revision(database) == "20260907_0032"

    inspector = inspect(create_engine(database_url))
    assert inspector.has_table("audit_events")
    assert inspector.has_table("portal_password_reset_tokens")
    assert {index["name"] for index in inspector.get_indexes("audit_events")} == {
        "ix_audit_events_action",
        "ix_audit_events_action_resource",
        "ix_audit_events_correlation_id",
        "ix_audit_events_created_at",
        "ix_audit_events_resource",
        "ix_audit_events_result",
        "ix_audit_events_society",
        "ix_audit_events_society_created",
        "ix_audit_events_user_created",
        "ix_audit_events_user_id",
        "ix_audit_events_username",
    }
    assert {
        index["name"]: (tuple(index["column_names"]), bool(index["unique"]))
        for index in inspector.get_indexes("portal_password_reset_tokens")
    } == {
        "ix_portal_reset_account": (("account_id",), False),
        "ix_portal_reset_expires": (("expires_at",), False),
        "ix_portal_reset_token_hash": (("token_hash",), True),
    }
    column = next(c for c in inspector.get_columns("users") if c["name"] == "global_society_access")
    assert isinstance(column["type"], Boolean)
    assert column["nullable"] is False
    with sqlite3.connect(database) as connection:
        rows = connection.execute(
            "SELECT role, global_society_access FROM users WHERE username IN (?, ?, ?, ?, ?)",
            ROLES,
        ).fetchall()
    assert dict(rows) == {role: 0 for role in ROLES}


def test_preexisting_explicit_global_values_are_preserved(tmp_path):
    database = tmp_path / "0032_values.sqlite"
    database_url = f"sqlite:///{database}"
    _upgrade(database_url, "20260906_0031")
    _insert_users(database, (("ADMIN", False), ("ADM", True), ("ADM1", False), ("ADM2", True)))

    _upgrade(database_url, "20260907_0032")
    assert _revision(database) == "20260907_0032"

    with sqlite3.connect(database) as connection:
        rows = connection.execute(
            "SELECT role, global_society_access FROM users WHERE username IN ('ADMIN', 'ADM', 'ADM1', 'ADM2')"
        ).fetchall()
    assert dict(rows) == {"ADMIN": 0, "ADM": 1, "ADM1": 0, "ADM2": 1}


def test_preexisting_data_survive_explicitly_refused_downgrade_and_future_0033(tmp_path):
    database = tmp_path / "0032_preservation.sqlite"
    database_url = f"sqlite:///{database}"
    _upgrade(database_url, "20260906_0031")
    _insert_users(database, (("ADMIN", False),))
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            INSERT INTO audit_events (
                created_at, action, resource, result, correlation_id
            ) VALUES (CURRENT_TIMESTAMP, 'existing.audit', 'test', 'success', 'audit-before-0032')
            """
        )
        connection.execute(
            """
            INSERT INTO portal_password_reset_tokens (
                account_id, token_hash, expires_at, created_at
            ) VALUES ('existing-account', 'existing-token-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        )
        connection.commit()

    _upgrade(database_url, "20260907_0032")
    assert _revision(database) == "20260907_0032"
    downgraded = _run_alembic(database_url, "downgrade", "20260906_0031")
    assert downgraded.returncode != 0
    assert "Downgrade 20260907_0032 refusé" in downgraded.stderr
    assert _revision(database) == "20260907_0032"

    inspector = inspect(create_engine(database_url))
    assert inspector.has_table("audit_events")
    assert inspector.has_table("portal_password_reset_tokens")
    assert "global_society_access" in {c["name"] for c in inspector.get_columns("users")}
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT correlation_id FROM audit_events WHERE correlation_id='audit-before-0032'"
        ).fetchone() == ("audit-before-0032",)
        assert connection.execute(
            "SELECT token_hash FROM portal_password_reset_tokens WHERE token_hash='existing-token-hash'"
        ).fetchone() == ("existing-token-hash",)
        assert connection.execute(
            "SELECT global_society_access FROM users WHERE username='ADMIN'"
        ).fetchone() == (0,)

    # Une tentative répétée vers 0032 reste cohérente, puis 0033 demeure applicable.
    _upgrade(database_url, "20260907_0032")
    assert _revision(database) == "20260907_0032"
    _upgrade(database_url, "20260907_0033")
    assert _revision(database) == "20260907_0033"
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT count(*) FROM audit_events").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM portal_password_reset_tokens").fetchone() == (1,)
        assert connection.execute(
            "SELECT global_society_access FROM users WHERE username='ADMIN'"
        ).fetchone() == (0,)


def _replace_index(database: Path, name: str, definition: str | None) -> None:
    with sqlite3.connect(database) as connection:
        connection.execute(f"DROP INDEX IF EXISTS {name}")
        if definition is not None:
            connection.execute(definition)
        connection.commit()


@pytest.mark.parametrize(
    ("name", "definition"),
    (
        (
            "ix_audit_events_user_created",
            "CREATE INDEX ix_audit_events_user_created ON audit_events(resource, created_at)",
        ),
        (
            "ix_audit_events_action_resource",
            "CREATE INDEX ix_audit_events_action_resource ON audit_events(resource, action)",
        ),
        (
            "ix_portal_reset_token_hash",
            "CREATE INDEX ix_portal_reset_token_hash ON portal_password_reset_tokens(token_hash)",
        ),
    ),
    ids=("mauvaises_colonnes", "ordre_incorrect", "unicite_incorrecte"),
)
def test_preexisting_index_with_wrong_definition_is_refused_without_data_change(
    tmp_path, name, definition
):
    database = tmp_path / f"0032_bad_{name}.sqlite"
    database_url = f"sqlite:///{database}"
    _upgrade(database_url, "20260906_0031")
    _insert_users(database, (("ADMIN", False),))
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            INSERT INTO audit_events (created_at, action, resource, result, correlation_id)
            VALUES (CURRENT_TIMESTAMP, 'kept', 'test', 'success', 'kept-audit')
            """
        )
        connection.execute(
            """
            INSERT INTO portal_password_reset_tokens
                (account_id, token_hash, expires_at, created_at)
            VALUES ('kept-account', 'kept-token', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        )
        connection.commit()
    _replace_index(database, name, definition)

    upgraded = _run_alembic(database_url, "upgrade", "20260907_0032")

    assert upgraded.returncode != 0
    assert f"Index {name} incompatible" in upgraded.stderr
    assert _revision(database) == "20260906_0031"
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT correlation_id FROM audit_events WHERE correlation_id='kept-audit'"
        ).fetchone() == ("kept-audit",)
        assert connection.execute(
            "SELECT token_hash FROM portal_password_reset_tokens WHERE token_hash='kept-token'"
        ).fetchone() == ("kept-token",)
        assert connection.execute(
            "SELECT global_society_access FROM users WHERE username='ADMIN'"
        ).fetchone() == (0,)


def test_missing_preexisting_index_is_created_and_conforming_indexes_are_accepted(tmp_path):
    database = tmp_path / "0032_missing_index.sqlite"
    database_url = f"sqlite:///{database}"
    _upgrade(database_url, "20260906_0031")
    _replace_index(database, "ix_audit_events_action_resource", None)

    _upgrade(database_url, "20260907_0032")

    assert _revision(database) == "20260907_0032"
    indexes = {
        index["name"]: (tuple(index["column_names"]), bool(index["unique"]))
        for index in inspect(create_engine(database_url)).get_indexes("audit_events")
    }
    assert indexes["ix_audit_events_action_resource"] == (("action", "resource"), False)
