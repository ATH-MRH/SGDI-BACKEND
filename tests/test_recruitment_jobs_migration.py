"""Migration 20261014_0001 : tables IRON Emploi — additive, rejouable, réversible, sans toucher aux candidatures."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REVISION, PREVIOUS = "20261014_0001", "20261013_0002"
TABLES = {"recruitment_companies", "recruitment_job_offers", "recruitment_candidate_accounts", "recruitment_candidate_sessions",
          "recruitment_applications"}


def _alembic(database_url: str, *args: str) -> str:
    env = os.environ.copy()
    env.update({"APP_ENV": "test", "DATABASE_URL": database_url, "JWT_SECRET": "recruitment-jobs-migration-test-secret"})
    result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=REPO, env=env, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    return result.stdout


def _tables(database) -> set[str]:
    with sqlite3.connect(database) as con:
        return {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _candidates(database) -> list[tuple]:
    with sqlite3.connect(database) as con:
        return con.execute("SELECT id, first_name, last_name, status, society FROM candidates ORDER BY id").fetchall()


def test_single_alembic_head():
    # La tête a avancé depuis (messages et entretiens) : seule l'unicité de la chaîne est contrôlée ici.
    assert _alembic("sqlite://", "heads").split()[1:] == ["(head)"]


def test_upgrade_is_additive_replayable_and_reversible(tmp_path):
    database = tmp_path / "jobs.sqlite"
    url = f"sqlite:///{database}"
    _alembic(url, "upgrade", PREVIOUS)
    # La première migration crée le schéma depuis les modèles courants : pour reproduire une
    # base existante (production), les nouvelles tables sont retirées avant la montée.
    with sqlite3.connect(database) as con:
        for table in ("recruitment_applications", "recruitment_candidate_sessions", "recruitment_candidate_accounts",
                      "recruitment_job_offers", "recruitment_companies"):
            con.execute(f"DROP TABLE IF EXISTS {table}")
    assert not TABLES & _tables(database)
    with sqlite3.connect(database) as con:
        con.execute("INSERT INTO candidates (first_name, last_name, status, society, created_at) VALUES "
                    "('Nadia', 'Historique', 'nouvelle', NULL, '2026-01-01 00:00:00'), ('Karim', 'Affecte', 'reserve', 'Iron Global Securite', '2026-02-01 00:00:00')")
    before, schema_before = _candidates(database), _tables(database)

    _alembic(url, "upgrade", REVISION)
    assert _tables(database) == schema_before | TABLES
    assert _candidates(database) == before                               # candidatures historiques et spontanées intactes
    with sqlite3.connect(database) as con:
        con.execute("INSERT INTO recruitment_companies (name, society, society_key, created_at) VALUES ('Soc', 'Soc', 'SOC', '2026-01-01')")
        con.execute("INSERT INTO recruitment_job_offers (company_id, title, created_at) VALUES (1, 'Agent', '2026-01-01')")
        assert con.execute("SELECT kind, is_active FROM recruitment_companies").fetchone() == ('group', 1)
        assert con.execute("SELECT status, positions FROM recruitment_job_offers").fetchone() == ('draft', 1)
        con.execute("INSERT INTO recruitment_applications (candidate_id, offer_id, request_id, created_at) VALUES (1, 1, 'r1', '2026-01-01')")
        assert con.execute("SELECT status, source, status_updated_at, stage, outcome FROM recruitment_applications").fetchone() == (
            'received', 'mobile', None, 'received', 'pending')

    _alembic(url, "downgrade", PREVIOUS)
    assert _tables(database) == schema_before and _candidates(database) == before
    _alembic(url, "upgrade", REVISION)
    _alembic(url, "upgrade", REVISION)                                   # rejouable
    assert TABLES <= _tables(database)
