"""Migration 20260927_0001 : tables Attendance Core + reprise de attendanceQrScans."""
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def _alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update({"APP_ENV": "test", "DATABASE_URL": database_url, "JWT_SECRET": "attendance-migration-test-secret"})
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=REPO, env=env, capture_output=True, text=True, check=False)


def _scan(item_id, **data):
    return ("attendanceQrScans", item_id, 0, "item", json.dumps({"id": item_id, **data}))


def test_attendance_core_migration_backfills_history_once(tmp_path):
    database = tmp_path / "attendance.sqlite"
    url = f"sqlite:///{database}"
    before = _alembic(url, "upgrade", "20260923_0001")
    assert before.returncode == 0, before.stderr

    con = sqlite3.connect(database)
    con.execute("INSERT INTO employees (id, code, first_name, last_name, society, status, children_count, salary_net, locked, created_at) "
                "VALUES (7, 'MIG07', 'A', 'B', 'SOC', 'actif', 0, 0, 1, '2026-09-01')")
    con.execute("INSERT INTO sites (id, name, contractual_staff, day_staff, night_staff, weekend_staff, holiday_staff, groups_count, active, created_at) "
                "VALUES (3, 'Site MIG', 0, 0, 0, 0, 0, 0, 1, '2026-09-01')")
    rows = [
        _scan("n-1", nonce="n-1", employeeId=7, matricule="MIG07", action="arrivee", cycle=1,
              scannedAt="2026-09-20T07:02:00+01:00", site="Site MIG", siteId=3, scannedBy="PTG01"),
        _scan("manual-abc", nonce="manual-abc", employeeId=7, action="depart", cycle=1,
              scannedAt="2026-09-20T15:00:00+01:00", siteId=3, scannedBy="PTG01", workedMinutes=478),
        _scan("orphan", nonce="orphan", employeeId=999, action="arrivee", scannedAt="2026-09-20T07:00:00+01:00"),
        _scan("bad-date", nonce="bad-date", employeeId=7, action="arrivee", scannedAt="pas une date"),
    ]
    con.executemany("INSERT INTO sgdi_records (collection, item_id, position, kind, data, created_at) VALUES (?, ?, ?, ?, ?, '2026-09-20')", rows)
    con.commit()

    upgraded = _alembic(url, "upgrade", "head")
    assert upgraded.returncode == 0, upgraded.stderr
    events = con.execute("SELECT employee_id, site_id, presence_date, occurred_at, event_type, source, idempotency_key "
                         "FROM attendance_events ORDER BY occurred_at").fetchall()
    assert events == [
        (7, 3, "2026-09-20", "2026-09-20 06:02:00.000000", "ARRIVAL", "QR", "n-1"),
        (7, 3, "2026-09-20", "2026-09-20 14:00:00.000000", "DEPARTURE", "MANUAL", "manual-abc"),
    ]
    # La collection d'origine est intacte (retour arrière possible).
    assert con.execute("SELECT COUNT(*) FROM sgdi_records WHERE collection='attendanceQrScans'").fetchone()[0] == 4

    # Retour arrière puis réapplication : aucune perte, aucun doublon.
    assert _alembic(url, "downgrade", "20260923_0001").returncode == 0
    assert _alembic(url, "upgrade", "head").returncode == 0
    assert con.execute("SELECT COUNT(*) FROM attendance_events").fetchone()[0] == 2
    con.close()
