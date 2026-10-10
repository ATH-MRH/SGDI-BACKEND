"""Migration 20261014_0002 : messages, entretiens, traitement par candidature — additive, rejouable, réversible."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REVISION, PREVIOUS = "20261014_0002", "20261014_0001"
TABLES = {"recruitment_messages", "recruitment_interviews", "recruitment_job_alerts", "recruitment_notifications", "recruitment_push_devices",
          "recruitment_application_documents", "recruitment_document_requests", "recruitment_application_notes",
          "recruitment_application_events", "recruitment_application_contracts", "recruitment_tips"}
COLUMNS = {"recruitment_applications": {"message", "stage", "outcome", "outcome_communicated_at", "assigned_to", "next_action", "next_action_due", "withdrawn_at"},
           "recruitment_companies": {"activities", "locations", "headcount"}, "recruitment_candidate_accounts": {"settings"}}


def _alembic(database_url: str, *args: str) -> str:
    env = os.environ.copy()
    env.update({"APP_ENV": "test", "DATABASE_URL": database_url, "JWT_SECRET": "recruitment-engage-migration-test-secret"})
    result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=REPO, env=env, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    return result.stdout


def _tables(con) -> set[str]:
    return {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _columns(con, table) -> set[str]:
    return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}


def test_single_alembic_head_is_the_engagement_revision():
    assert _alembic("sqlite://", "heads").split() == [REVISION, "(head)"]


def test_upgrade_extends_an_existing_iron_emploi_database_without_losing_data(tmp_path):
    database = tmp_path / "engage.sqlite"
    url = f"sqlite:///{database}"
    _alembic(url, "upgrade", PREVIOUS)
    # Base telle qu'après 20261014_0001 seule : sans les nouvelles tables ni les nouvelles colonnes.
    with sqlite3.connect(database) as con:
        for table in TABLES:
            con.execute(f"DROP TABLE IF EXISTS {table}")
        for table, columns in COLUMNS.items():
            for column in columns:
                for index in [row[1] for row in con.execute(f"PRAGMA index_list({table})") if column in row[1]]:
                    con.execute(f"DROP INDEX {index}")
                con.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
        con.execute("INSERT INTO candidates (first_name, last_name, status, created_at) VALUES ('Nadia', 'Existante', 'nouvelle', '2026-10-01')")
        con.execute("INSERT INTO recruitment_companies (name, society, society_key, created_at) VALUES ('Soc', 'Soc', 'SOC', '2026-10-01')")
        con.execute("INSERT INTO recruitment_job_offers (company_id, title, created_at) VALUES (1, 'Agent', '2026-10-01')")
        con.execute("INSERT INTO recruitment_applications (candidate_id, offer_id, request_id, status, created_at) VALUES (1, 1, 'r1', 'shortlisted', '2026-10-02')")
        assert not TABLES & _tables(con) and not COLUMNS["recruitment_applications"] & _columns(con, "recruitment_applications")

    _alembic(url, "upgrade", "head")
    with sqlite3.connect(database) as con:
        assert TABLES <= _tables(con)
        for table, columns in COLUMNS.items():
            assert columns <= _columns(con, table), table
        # La candidature existante garde son état et reçoit les valeurs par défaut du traitement.
        assert con.execute("SELECT status, stage, outcome, message FROM recruitment_applications").fetchone() == ('shortlisted', 'received', 'pending', None)
        assert con.execute("SELECT count(*) FROM candidates").fetchone() == (1,)
    _alembic(url, "upgrade", "head")                                     # rejouable

    _alembic(url, "downgrade", PREVIOUS)
    with sqlite3.connect(database) as con:
        assert not TABLES & _tables(con) and not COLUMNS["recruitment_applications"] & _columns(con, "recruitment_applications")
        assert con.execute("SELECT status FROM recruitment_applications").fetchone() == ('shortlisted',)
    _alembic(url, "upgrade", "head")
