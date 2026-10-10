"""Migration 20261011_0001 : colonnes de suivi SMSGate — rejouable, réversible, sans perte."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REVISION, PREVIOUS = "20261011_0001", "20261008_sms"
NEW_COLUMNS = {"gateway_message_id", "delivery_status", "delivery_error", "next_attempt_at", "status_checked_at",
               "accepted_at", "sent_at", "delivered_at"}
# Table telle que créée par 20261008_sms avant l'ajout du suivi.
OLD_TABLE = """CREATE TABLE recruitment_sms_challenges (id VARCHAR(64) NOT NULL PRIMARY KEY, phone VARCHAR(20) NOT NULL,
    first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL, code_digest VARCHAR(64) NOT NULL, sms_ciphertext TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL, status VARCHAR(20) NOT NULL,
    lease_digest VARCHAR(64), lease_until INTEGER NOT NULL, send_attempts INTEGER NOT NULL, token_digest VARCHAR(64) UNIQUE,
    token_expires_at INTEGER, submitted_reference VARCHAR(40))"""


def _alembic(database_url: str, *args: str) -> str:
    env = os.environ.copy()
    env.update({"APP_ENV": "test", "DATABASE_URL": database_url, "JWT_SECRET": "recruitment-sms-migration-test-secret"})
    result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=REPO, env=env, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    return result.stdout


def _columns(database) -> set[str]:
    with sqlite3.connect(database) as con:
        return {row[1] for row in con.execute("PRAGMA table_info(recruitment_sms_challenges)")}


def test_single_alembic_head():
    # Une seule tête, quelle qu'elle soit : d'autres migrations peuvent suivre celle-ci.
    heads = _alembic("sqlite://", "heads").split()
    assert len(heads) == 2 and heads[1] == "(head)"


def test_upgrade_adds_tracking_to_an_existing_table_and_is_reversible(tmp_path):
    database = tmp_path / "sms.sqlite"
    url = f"sqlite:///{database}"
    _alembic(url, "upgrade", PREVIOUS)
    con = sqlite3.connect(database)
    con.execute("DROP TABLE recruitment_sms_challenges")
    con.execute(OLD_TABLE)
    con.execute("INSERT INTO recruitment_sms_challenges VALUES ('c' || hex(randomblob(12)), '+213550001122', 'Nadia', 'Portail', 'd', '', 1, 2, 0, "
                "'verified', NULL, 0, 1, 'token-digest', 3, NULL)")
    con.commit(); con.close()
    assert not NEW_COLUMNS & _columns(database)

    _alembic(url, "upgrade", "head")
    assert NEW_COLUMNS <= _columns(database)
    with sqlite3.connect(database) as con:
        assert con.execute("SELECT status, delivery_status, next_attempt_at, gateway_message_id FROM recruitment_sms_challenges").fetchall() == [
            ("verified", "queued", 0, None)]
        indexes = {row[1]: row[2] for row in con.execute("PRAGMA index_list(recruitment_sms_challenges)")}
        assert indexes["uq_recruitment_sms_challenges_gateway_message_id"] == 1
    _alembic(url, "upgrade", "head")                    # rejouable

    _alembic(url, "downgrade", PREVIOUS)
    assert not NEW_COLUMNS & _columns(database)
    with sqlite3.connect(database) as con:
        assert con.execute("SELECT phone, status, token_digest FROM recruitment_sms_challenges").fetchall() == [("+213550001122", "verified", "token-digest")]
    _alembic(url, "upgrade", "head")
    assert NEW_COLUMNS <= _columns(database)


def test_fresh_database_reaches_head_with_the_model_schema(tmp_path):
    database = tmp_path / "fresh.sqlite"
    _alembic(f"sqlite:///{database}", "upgrade", "head")
    assert NEW_COLUMNS <= _columns(database)
    _alembic(f"sqlite:///{database}", "downgrade", "20261010_0001")     # traverse aussi 20261008_sms
    with sqlite3.connect(database) as con:
        assert not con.execute("SELECT name FROM sqlite_master WHERE name LIKE 'recruitment_sms_%'").fetchall()
