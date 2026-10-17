"""Audit pointeur.irongs.com — P1 sur PostgreSQL réel (verrous, dates, JSON).

Exécuté uniquement si ATTENDANCE_PG_URL pointe vers une base PostgreSQL JETABLE (même
convention que tests/test_attendance_core_pg_race.py)."""
import os
import threading
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")

TZ = ZoneInfo("Africa/Algiers")
ANCHOR = date(2026, 10, 1)
ACTOR = SimpleNamespace(id=None, username="PG-AUDIT")
PARALLEL = 8


@pytest.fixture(scope="module")
def Session():
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(PG_URL, pool_size=PARALLEL + 2, max_overflow=0)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


def _ts(day, hm):
    return datetime.combine(day, datetime.strptime(hm, "%H:%M").time(), TZ)


def _night_worker(Session):
    from app.modules.attendance import official
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment, Site, SiteRotation

    with Session() as db:
        site = Site(name=f"PG audit {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": "PGAUDIT"})
        db.add(site); db.flush()
        model = official.ensure_official_model(db)
        db.add(SiteRotation(site_id=site.id, rotation_id=model.id, start_date=ANCHOR, active=1))
        emp = Employee(code=f"PGA{uuid.uuid4().hex[:8]}", first_name="P", last_name="G", society="PGAUDIT", status="actif")
        db.add(emp); db.flush()
        db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="C", start_date=date(2026, 1, 1), active=1,
                          work_regime=official.REGIME_POSTE_CONTINU, rotation_id=model.id))
        db.commit()
        return emp.id, site.id


def _scan(Session, employee_id, at):
    from app.modules.attendance import core
    from app.modules.drh.models import Employee

    with Session() as db:
        return core.record_scan(db, employee=db.get(Employee, employee_id), source="QR", actor=ACTOR,
                                idempotency_key=f"pga-{uuid.uuid4().hex}", now=at)


def _events(db, employee_id):
    from app.modules.attendance.models import EVENT_ARRIVAL, EVENT_DEPARTURE, AttendanceEvent

    return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == employee_id,
                                                    AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)))
                      .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars().all()


def test_two_nights_with_a_late_arrival_give_two_presence_days_on_postgres(Session):
    from app.modules.ops.models import DailyPresence

    employee_id, _site_id = _night_worker(Session)
    _scan(Session, employee_id, _ts(ANCHOR + timedelta(days=1), "00:10"))        # nuit du 1er, en retard
    _scan(Session, employee_id, _ts(ANCHOR + timedelta(days=1), "06:02"))
    _scan(Session, employee_id, _ts(ANCHOR + timedelta(days=1), "21:45"))        # nuit du 2
    _scan(Session, employee_id, _ts(ANCHOR + timedelta(days=2), "06:00"))
    with Session() as db:
        days = sorted(row.presence_date for row in db.execute(select(DailyPresence).where(DailyPresence.employee_id == employee_id)).scalars())
        events = _events(db, employee_id)
    assert days == [ANCHOR, ANCHOR + timedelta(days=1)]
    assert [(e.presence_date, e.cycle) for e in events] == [(ANCHOR, 1), (ANCHOR, 1), (ANCHOR + timedelta(days=1), 1), (ANCHOR + timedelta(days=1), 1)]


def test_departure_after_closure_leaves_the_closed_row_untouched_on_postgres(Session):
    from app.modules.attendance import core
    from app.modules.attendance.models import AttendanceAnomaly
    from app.modules.ops.models import DailyPresence

    employee_id, site_id = _night_worker(Session)
    _scan(Session, employee_id, _ts(ANCHOR, "21:50"))
    with Session() as db:
        core.close_day(db, day=ANCHOR, site_ids=[site_id], actor=ACTOR, source="MANUAL")
        db.commit()
        row = db.execute(select(DailyPresence).where(DailyPresence.employee_id == employee_id)).scalar_one()
        before = (row.arrival_time, row.departure_time, row.status, row.closed_at, row.data)
    out = _scan(Session, employee_id, _ts(ANCHOR + timedelta(days=1), "06:00"))
    assert out["action"] == "depart" and out["counted"]["counted_minutes"] == 480
    with Session() as db:
        rows = db.execute(select(DailyPresence).where(DailyPresence.employee_id == employee_id)).scalars().all()
        assert len(rows) == 1
        assert (rows[0].arrival_time, rows[0].departure_time, rows[0].status, rows[0].closed_at, rows[0].data) == before
        kinds = [a.anomaly_type for a in db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == employee_id)).scalars()]
    assert "DEPARTURE_AFTER_CLOSURE" in kinds


def test_concurrent_exit_regularizations_create_exactly_one_departure(Session):
    from fastapi import HTTPException

    from app.modules.attendance import core
    from app.modules.attendance.models import EVENT_DEPARTURE

    employee_id, _site_id = _night_worker(Session)
    _scan(Session, employee_id, _ts(ANCHOR, "21:50"))
    with Session() as db:
        arrival_id = _events(db, employee_id)[0].id
    barrier = threading.Barrier(PARALLEL)
    done, refused, errors = [], [], []

    def worker():
        with Session() as db:
            barrier.wait()
            try:
                done.append(core.regularize_departure(db, arrival_event_id=arrival_id, exit_at=_ts(ANCHOR + timedelta(days=1), "06:00"),
                                                      reason="Oubli de sortie", actor=ACTOR))
                db.commit()
            except HTTPException as exc:
                db.rollback(); refused.append(exc.status_code)
            except Exception as exc:  # noqa: BLE001
                db.rollback(); errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(PARALLEL)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors, errors
    assert len(done) == 1 and refused == [409] * (PARALLEL - 1)
    with Session() as db:
        events = _events(db, employee_id)
    assert [e.event_type for e in events].count(EVENT_DEPARTURE) == 1 and events[-1].data["counted"]["counted_minutes"] == 480
