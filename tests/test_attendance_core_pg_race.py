"""Attendance Core — courses réelles sur PostgreSQL (verrou de ligne + contrainte unique).

SQLite sérialise les écritures et ne peut pas reproduire la course ; ce test s'exécute
uniquement si ATTENDANCE_PG_URL pointe vers une base PostgreSQL JETABLE, par exemple :
    ATTENDANCE_PG_URL=postgresql+psycopg2://user@localhost/atlas_race pytest tests/test_attendance_core_pg_race.py
"""
import os
import threading
import uuid
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


def _employee(Session):
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment, Site
    from datetime import date

    with Session() as db:
        site = Site(name=f"Race {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": "RACE"})
        db.add(site); db.flush()
        emp = Employee(code=f"RACE{uuid.uuid4().hex[:8]}", first_name="R", last_name="C", society="RACE", status="actif")
        db.add(emp); db.flush()
        db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
        db.commit()
        return emp.id


def _fire(Session, employee_id, key_for):
    from app.modules.attendance import core
    from app.modules.drh.models import Employee

    barrier = threading.Barrier(PARALLEL)
    results, errors = [], []

    def worker(i):
        with Session() as db:
            employee = db.get(Employee, employee_id)
            barrier.wait()
            try:
                results.append(core.record_scan(db, employee=employee, source="QR",
                                                actor=SimpleNamespace(id=None, username=f"T{i}"),
                                                idempotency_key=key_for(i)))
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(PARALLEL)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results, errors


def _count(Session, employee_id):
    from app.modules.attendance.models import AttendanceEvent
    with Session() as db:
        return db.scalar(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.employee_id == employee_id))


def test_parallel_same_qr_nonce_produces_exactly_one_event(pg_sessionmaker):
    employee_id = _employee(pg_sessionmaker)
    nonce = f"same-nonce-{uuid.uuid4().hex}"
    results, errors = _fire(pg_sessionmaker, employee_id, lambda i: nonce)
    assert not errors, errors
    assert _count(pg_sessionmaker, employee_id) == 1
    assert sum(1 for r in results if not r["duplicate"]) == 1


def test_parallel_distinct_scans_never_produce_two_arrivals(pg_sessionmaker):
    """12 terminaux / retries simultanés, clés différentes : le verrou par employé sérialise,
    l'anti-rebond rend les suivants « déjà enregistré » — jamais arrivée + départ."""
    employee_id = _employee(pg_sessionmaker)
    run = uuid.uuid4().hex
    results, errors = _fire(pg_sessionmaker, employee_id, lambda i: f"k-{run}-{i}")
    assert not errors, errors
    assert _count(pg_sessionmaker, employee_id) == 1
    assert {r["action"] for r in results} == {"arrivee"}


def _fire_mixed(Session, employee_id, calls):
    """Exécute en parallèle des appels hétérogènes Attendance Core (callable(db, employee))."""
    from app.modules.drh.models import Employee

    barrier = threading.Barrier(len(calls))
    results, errors = [], []

    def worker(fn):
        with Session() as db:
            employee = db.get(Employee, employee_id)
            barrier.wait()
            try:
                results.append(fn(db, employee))
                db.commit()
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

    threads = [threading.Thread(target=worker, args=(fn,)) for fn in calls]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results, errors


def _presences(Session, employee_id):
    from app.modules.ops.models import DailyPresence
    with Session() as db:
        return db.execute(select(DailyPresence).where(DailyPresence.employee_id == employee_id)).scalars().all()


def test_parallel_qr_facial_manual_produce_one_arrival_and_one_presence(pg_sessionmaker):
    """QR + facial + saisie manuelle au même instant : un seul événement, une seule journée."""
    from app.modules.attendance import core
    employee_id = _employee(pg_sessionmaker)
    run = uuid.uuid4().hex
    sources = ["QR", "FACIAL", "MANUAL"] * 4

    def scan(source, i):
        return lambda db, emp: core.record_scan(db, employee=emp, source=source, actor=SimpleNamespace(id=None, username=f"S{i}"),
                                                idempotency_key=f"mix-{run}-{i}", confidence=0.9 if source == "FACIAL" else None)

    results, errors = _fire_mixed(pg_sessionmaker, employee_id, [scan(s, i) for i, s in enumerate(sources)])
    assert not errors, errors
    assert _count(pg_sessionmaker, employee_id) == 1
    assert {r["action"] for r in results} == {"arrivee"}
    assert len(_presences(pg_sessionmaker, employee_id)) == 1


def test_parallel_key_of_other_employee_never_leaks(pg_sessionmaker):
    """Même clé rejouée simultanément pour deux employés : un seul l'obtient, l'autre reçoit 409."""
    from fastapi import HTTPException

    from app.modules.attendance import core
    a, b = _employee(pg_sessionmaker), _employee(pg_sessionmaker)
    key = f"shared-{uuid.uuid4().hex}"
    from app.modules.drh.models import Employee

    barrier = threading.Barrier(2)
    outcomes = {}

    def worker(emp_id):
        with pg_sessionmaker() as db:
            emp = db.get(Employee, emp_id)
            barrier.wait()
            try:
                outcomes[emp_id] = core.record_scan(db, employee=emp, source="QR", actor=SimpleNamespace(id=None, username="K"), idempotency_key=key)
            except HTTPException as exc:
                outcomes[emp_id] = exc.status_code
            except Exception as exc:  # noqa: BLE001
                outcomes[emp_id] = exc

    threads = [threading.Thread(target=worker, args=(x,)) for x in (a, b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    winners = [e for e, o in outcomes.items() if isinstance(o, dict)]
    assert len(winners) == 1, outcomes
    loser = a if winners[0] == b else b
    assert outcomes[loser] == 409, outcomes
    assert _count(pg_sessionmaker, loser) == 0
    assert _count(pg_sessionmaker, winners[0]) == 1


def test_parallel_beo_status_and_terminal_scan_share_one_presence(pg_sessionmaker):
    """BEO (statut du jour) + terminal (scan) simultanés : aucune erreur, une seule journée,
    deux événements tracés, aucun interblocage."""
    from app.modules.attendance import core
    from app.modules.attendance.models import AttendanceEvent
    from app.modules.ops.models import Assignment
    employee_id = _employee(pg_sessionmaker)
    with pg_sessionmaker() as db:
        site_id = db.execute(select(Assignment.site_id).where(Assignment.employee_id == employee_id)).scalar_one()
    day = core._now_local().date()
    run = uuid.uuid4().hex
    calls = [
        lambda db, emp: core.record_day_status(db, employee=emp, site_id=site_id, day=day, status="present",
                                               source="SITE_WORKFORCE", actor=SimpleNamespace(id=None, username="BEO")),
        lambda db, emp: core.record_scan(db, employee=emp, source="QR", actor=SimpleNamespace(id=None, username="TERM"),
                                         idempotency_key=f"term-{run}"),
    ]
    results, errors = _fire_mixed(pg_sessionmaker, employee_id, calls)
    assert not errors, errors
    rows = _presences(pg_sessionmaker, employee_id)
    assert len(rows) == 1 and rows[0].status == "present"
    assert rows[0].arrival_time, "l'heure d'arrivée réelle du terminal ne doit jamais être effacée par le BEO"
    with pg_sessionmaker() as db:
        sources = set(db.execute(select(AttendanceEvent.source).where(AttendanceEvent.employee_id == employee_id)).scalars())
    assert sources == {"SITE_WORKFORCE", "QR"}
