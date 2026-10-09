"""Migration 20261009_0001 : régime de travail explicite — réversible, sans effet sur l'existant."""
import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
REVISION, PREVIOUS = "20261009_0001", "20261008_0001"
HEAD = "20261011_0001"            # tête courante de la chaîne (suivi SMSGate des codes candidats)
PG_URL = os.getenv("ATTENDANCE_PG_URL")


def _alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update({"APP_ENV": "test", "DATABASE_URL": database_url, "JWT_SECRET": "official-shift-migration-test-secret"})
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=REPO, env=env, capture_output=True, text=True, check=False)


def _ok(result: subprocess.CompletedProcess[str]) -> str:
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_single_alembic_head():
    assert _ok(_alembic("sqlite://", "heads")).split() == [HEAD, "(head)"]


def test_upgrade_downgrade_upgrade_preserves_existing_assignments(tmp_path):
    database = tmp_path / "regime.sqlite"
    url = f"sqlite:///{database}"
    _ok(_alembic(url, "upgrade", PREVIOUS))
    con = sqlite3.connect(database)
    con.execute("INSERT INTO employees (id, code, first_name, last_name, society, status, children_count, salary_net, locked, created_at) "
                "VALUES (7, 'REG07', 'A', 'B', 'SOC', 'actif', 0, 0, 1, '2026-09-01')")
    con.execute("INSERT INTO sites (id, name, rotation_system, contractual_staff, day_staff, night_staff, weekend_staff, holiday_staff, groups_count, active, created_at) "
                "VALUES (3, 'Site REG', '3x8', 0, 0, 0, 0, 0, 4, 1, '2026-09-01')")
    con.executemany("INSERT INTO assignments (id, employee_id, site_id, group_code, start_date, active, created_at) VALUES (?, 7, 3, ?, '2026-09-01', ?, '2026-09-01')",
                    [(1, "A", 0), (2, "B", 0), (3, "C", 0), (4, "D", 1)])
    con.commit(); con.close()

    def rows():
        with sqlite3.connect(database) as c:
            return c.execute("SELECT id, employee_id, site_id, group_code, rotation_id, start_date, active FROM assignments ORDER BY id").fetchall()

    before = rows()
    _ok(_alembic(url, "upgrade", "head"))
    with sqlite3.connect(database) as c:
        # Aucune affectation existante ne devient postée, même groupe A/B/C/D sur un site « 3x8 ».
        assert c.execute("SELECT COUNT(*) FROM assignments WHERE work_regime IS NOT NULL").fetchone()[0] == 0
        assert c.execute("SELECT code, official, version, cycle_length FROM rotation_templates WHERE official = 1").fetchall() == [("3X8-CONTINU-2222", 1, 1, 8)]
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("UPDATE assignments SET work_regime = 'POSTE_CONTINU' WHERE id = 1")     # sans modèle : refusé en base
    assert rows() == before
    _ok(_alembic(url, "upgrade", "head"))                                                       # rejouable

    _ok(_alembic(url, "downgrade", PREVIOUS))
    with sqlite3.connect(database) as c:
        assert "work_regime" not in {r[1] for r in c.execute("PRAGMA table_info(assignments)")}
        assert "official" not in {r[1] for r in c.execute("PRAGMA table_info(rotation_templates)")}
        assert c.execute("SELECT COUNT(*) FROM rotation_templates").fetchone()[0] == 0
    assert rows() == before

    _ok(_alembic(url, "upgrade", "head"))
    assert rows() == before
    assert _ok(_alembic(url, "current")).split()[:1] == [HEAD]


def test_downgrade_refuses_to_destroy_posted_regime(tmp_path):
    database = tmp_path / "posted.sqlite"
    url = f"sqlite:///{database}"
    _ok(_alembic(url, "upgrade", "head"))
    con = sqlite3.connect(database)
    con.execute("INSERT INTO employees (id, code, first_name, last_name, society, status, children_count, salary_net, locked, created_at) "
                "VALUES (7, 'REG07', 'A', 'B', 'SOC', 'actif', 0, 0, 1, '2026-09-01')")
    con.execute("INSERT INTO sites (id, name, contractual_staff, day_staff, night_staff, weekend_staff, holiday_staff, groups_count, active, created_at) "
                "VALUES (3, 'Site REG', 0, 0, 0, 0, 0, 0, 1, '2026-09-01')")
    con.execute("INSERT INTO assignments (employee_id, site_id, group_code, rotation_id, work_regime, start_date, active, created_at) "
                "SELECT 7, 3, 'B', id, 'POSTE_CONTINU', '2026-10-01', 1, '2026-10-01' FROM rotation_templates WHERE official = 1")
    con.commit(); con.close()
    refused = _alembic(url, "downgrade", PREVIOUS)
    assert refused.returncode != 0 and "Downgrade refusé" in refused.stderr
    with sqlite3.connect(database) as c:
        assert c.execute("SELECT work_regime, group_code FROM assignments").fetchall() == [("POSTE_CONTINU", "B")]


@pytest.mark.skipif(not PG_URL, reason="Disposable PostgreSQL ATTENDANCE_PG_URL required")
def test_postgresql_upgrade_downgrade_upgrade():
    """Migration réelle sur une base PostgreSQL créée puis supprimée par le test."""
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    name = f"atlas_regime_{uuid.uuid4().hex[:10]}"
    admin = create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as con:
        con.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(PG_URL).set(database=name).render_as_string(hide_password=False)
    engine = create_engine(url)
    try:
        _ok(_alembic(url, "upgrade", "head"))
        with engine.connect() as con:
            assert con.execute(text("SELECT COUNT(*) FROM assignments WHERE work_regime IS NOT NULL")).scalar() == 0
            assert con.execute(text("SELECT code FROM rotation_templates WHERE official = 1")).scalars().all() == ["3X8-CONTINU-2222"]
            checks = set(con.execute(text("SELECT conname FROM pg_constraint WHERE conname LIKE 'ck_assignments%'")).scalars())
            assert checks == {"ck_assignments_work_regime", "ck_assignments_posted_explicit"}
        _ok(_alembic(url, "downgrade", PREVIOUS))
        with engine.connect() as con:
            assert con.execute(text("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'assignments' AND column_name = 'work_regime'")).scalar() == 0
        _ok(_alembic(url, "upgrade", "head"))
        assert _ok(_alembic(url, "current")).split()[:1] == [HEAD]
    finally:
        engine.dispose()
        with admin.connect() as con:
            con.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
