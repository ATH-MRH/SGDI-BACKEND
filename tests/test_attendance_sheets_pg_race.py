"""Feuilles de présence par rotation — courses réelles sur PostgreSQL.

SQLite sérialise les écritures : ce test ne s'exécute que si ATTENDANCE_PG_URL pointe vers une
base PostgreSQL JETABLE (même convention que tests/test_attendance_core_pg_race.py).
Garanties vérifiées : une seule feuille par (site, rotation) quand plusieurs employés pointent
au même instant, une seule ligne par employé, une clôture effectuée une seule fois."""
import os
import threading
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")

PARALLEL = 12


@pytest.fixture(scope="module")
def pg_sessionmaker():
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(PG_URL, pool_size=PARALLEL + 2, max_overflow=0)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


def _world(Session, employees):
    from app.modules.attendance.models import RotationSetting
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment, Site

    with Session() as db:
        site = Site(name=f"Sheet race {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": "RACE"})
        db.add(site); db.flush()
        db.add(RotationSetting(site_id=site.id, first_shift_time="06:00", shift_minutes=480, groups_count=4,
                               early_margin_minutes=60, active=1, version=1))
        ids = []
        for _ in range(employees):
            emp = Employee(code=f"SR{uuid.uuid4().hex[:8]}", first_name="R", last_name="C", society="RACE", status="actif")
            db.add(emp); db.flush()
            db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
            ids.append(emp.id)
        db.commit()
        return site.id, ids


def _parallel(count, job):
    barrier = threading.Barrier(count)
    results, errors = [], []

    def worker(i):
        barrier.wait()
        try:
            results.append(job(i))
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results, errors


def _state(Session, site_id):
    from app.modules.attendance.models import AttendanceSheet, AttendanceSheetEvent, AttendanceSheetLine

    with Session() as db:
        sheets_rows = db.execute(select(AttendanceSheet).where(AttendanceSheet.site_id == site_id)).scalars().all()
        ids = [s.id for s in sheets_rows] or [0]
        lines = db.execute(select(AttendanceSheetLine).where(AttendanceSheetLine.sheet_id.in_(ids))).scalars().all()
        links = db.execute(select(func.count(AttendanceSheetEvent.event_id)).where(AttendanceSheetEvent.sheet_id.in_(ids))).scalar_one()
        return sheets_rows, lines, links


def test_simultaneous_arrivals_create_one_sheet_and_one_line_each(pg_sessionmaker):
    from app.modules.attendance import core
    from app.modules.drh.models import Employee

    site_id, employee_ids = _world(pg_sessionmaker, PARALLEL)
    when = datetime(2026, 10, 6, 6, 1, tzinfo=core.TZ)

    def job(i):
        with pg_sessionmaker() as db:
            return core.record_scan(db, employee=db.get(Employee, employee_ids[i]), source="QR",
                                    actor=SimpleNamespace(id=None, username=f"T{i}"), idempotency_key=f"sheet-race-{uuid.uuid4().hex}", now=when)

    results, errors = _parallel(PARALLEL, job)
    assert errors == []
    assert [r["action"] for r in results] == ["arrivee"] * PARALLEL
    sheets_rows, lines, links = _state(pg_sessionmaker, site_id)
    assert len(sheets_rows) == 1 and sheets_rows[0].status == "OPEN"
    assert sorted(line.employee_id for line in lines) == sorted(employee_ids)
    assert {line.events_count for line in lines} == {1} and links == PARALLEL


def test_same_employee_scanned_in_parallel_gets_one_line_and_one_event(pg_sessionmaker):
    from app.modules.attendance import core
    from app.modules.attendance.models import AttendanceEvent
    from app.modules.drh.models import Employee

    site_id, (employee_id,) = _world(pg_sessionmaker, 1)
    when = datetime(2026, 10, 6, 14, 5, tzinfo=core.TZ)

    def job(i):
        with pg_sessionmaker() as db:
            return core.record_scan(db, employee=db.get(Employee, employee_id), source="FACIAL",
                                    actor=SimpleNamespace(id=None, username=f"T{i}"), idempotency_key=f"same-{i}-{uuid.uuid4().hex}", now=when)

    results, errors = _parallel(PARALLEL, job)
    assert errors == []
    assert sum(1 for r in results if not r["duplicate"]) == 1
    sheets_rows, lines, links = _state(pg_sessionmaker, site_id)
    assert len(sheets_rows) == 1 and len(lines) == 1 and links == 1
    assert (lines[0].state, lines[0].events_count) == ("PRESENT", 1)
    with pg_sessionmaker() as db:
        assert db.execute(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.employee_id == employee_id)).scalar_one() == 1


def test_concurrent_maintenance_closes_each_sheet_once_and_opens_one_successor(pg_sessionmaker):
    from app.modules.attendance import core, sheets
    from app.modules.drh.models import Employee

    site_id, (employee_id,) = _world(pg_sessionmaker, 1)
    with pg_sessionmaker() as db:
        core.record_scan(db, employee=db.get(Employee, employee_id), source="QR", actor=None,
                         idempotency_key=f"close-{uuid.uuid4().hex}", now=datetime(2026, 10, 6, 6, 5, tzinfo=core.TZ))
    later = datetime(2026, 10, 6, 15, 0, tzinfo=core.TZ)

    def job(_i):
        with pg_sessionmaker() as db:
            outcome = sheets.maintain(db, later, [site_id])
            db.commit()
            return outcome

    results, errors = _parallel(PARALLEL, job)
    assert errors == []
    assert sum(r["closed"] for r in results) == 1, results           # clôturée une seule fois
    sheets_rows, _lines, _links = _state(pg_sessionmaker, site_id)
    by_status = sorted((core.to_local(s.window_start).strftime("%H:%M"), s.status) for s in sheets_rows)
    assert by_status == [("06:00", "CLOSED"), ("14:00", "OPEN")]      # une seule feuille suivante


def test_parallel_access_to_the_active_view_creates_a_single_sheet(pg_sessionmaker):
    from app.modules.attendance import core, sheets

    site_id, _ids = _world(pg_sessionmaker, 1)
    now = datetime(2026, 10, 6, 22, 30, tzinfo=core.TZ)

    def job(_i):
        with pg_sessionmaker() as db:
            view = sheets.active_view(db, site_id, now)
            db.commit()
            return view["sheet"]["id"]

    results, errors = _parallel(PARALLEL, job)
    assert errors == []
    assert len(set(results)) == 1
    sheets_rows, _lines, _links = _state(pg_sessionmaker, site_id)
    assert len(sheets_rows) == 1 and sheets_rows[0].local_date == date(2026, 10, 6) and sheets_rows[0].slot_index == 2
    assert sheets_rows[0].window_end - sheets_rows[0].window_start == timedelta(hours=8)
