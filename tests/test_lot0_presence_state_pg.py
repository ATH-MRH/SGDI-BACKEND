"""Lot 0 sur PostgreSQL réel : journée générée = PLANIFIÉ, jamais payée ; pointage (nuit comprise),
saisie et correction tracées = journée réelle ; condition SQL d'exclusion identique au calcul Python.
Exécuté uniquement si ATTENDANCE_PG_URL pointe vers une base PostgreSQL JETABLE."""
import os
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
ANCHOR = date(2026, 10, 1)                      # groupe B = Après-midi, groupe C = Nuit
ACTOR = SimpleNamespace(id=None, username="PG-LOT0", role="pointeur")
SOC = "PGLOT0"


@pytest.fixture(scope="module")
def Session():
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(PG_URL)
    assert engine.dialect.name == "postgresql"
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


def _ts(day, hm):
    return datetime.combine(day, datetime.strptime(hm, "%H:%M").time(), TZ)


def _site(db):
    from app.modules.attendance import official
    from app.modules.ops.models import Site, SiteRotation

    site = Site(name=f"PG lot0 {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    db.add(SiteRotation(site_id=site.id, rotation_id=official.ensure_official_model(db).id, start_date=ANCHOR, active=1))
    db.flush()
    return site


def _employee(db, site, group):
    from app.modules.attendance import official
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment

    emp = Employee(code=f"PL0{uuid.uuid4().hex[:8]}", first_name="Agent", last_name="PG", society=SOC, status="actif")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=date(2026, 1, 1), active=1,
                      work_regime=official.REGIME_POSTE_CONTINU, rotation_id=official.ensure_official_model(db).id))
    db.flush()
    return emp


def _scan(db, emp, at):
    from app.modules.attendance import core
    return core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=f"pl0-{uuid.uuid4().hex}", now=at)


def test_planned_pointed_justified_and_night_days_on_postgresql(Session):
    from app.modules.attendance import core, presence_state
    from app.modules.attendance.models import SOURCE_MANUAL, SOURCE_SYSTEM
    from app.modules.ops import service as ops_service
    from app.modules.ops.models import DailyPresence
    from app.modules.payroll import service as payroll

    with Session() as db:
        site = _site(db)
        planned, pointed, declared = (_employee(db, site, "B") for _ in range(3))
        night = _employee(db, site, "C")
        db.commit()
        ops_service.generate_daily_presence(db, ANCHOR, site_ids=[site.id])
        _scan(db, pointed, _ts(ANCHOR, "13:45"))
        _scan(db, night, _ts(ANCHOR, "21:45"))
        _scan(db, night, _ts(ANCHOR + timedelta(days=1), "06:05"))
        core.record_day_status(db, employee=declared, site_id=site.id, day=ANCHOR, status="present", source=SOURCE_MANUAL, actor=ACTOR)
        db.commit()
        rows = {r.employee_id: r for r in db.scalars(select(DailyPresence).where(DailyPresence.site_id == site.id)).all()}
        assert len(rows) == 4                                              # la nuit reste UNE journée (J)
        states = presence_state.states_for(db, rows.values())
        assert {e.id: states[rows[e.id].id] for e in (planned, pointed, declared, night)} == {
            planned.id: presence_state.PLANIFIE, pointed.id: presence_state.POINTE,
            declared.id: presence_state.JUSTIFIE, night.id: presence_state.POINTE}
        by_sql = set(db.scalars(select(DailyPresence.employee_id).where(DailyPresence.site_id == site.id, presence_state.real_clause())))
        assert by_sql == {pointed.id, declared.id, night.id}
        closed = core.close_day(db, day=ANCHOR, site_ids=[site.id], actor=ACTOR, source=SOURCE_SYSTEM)
        db.commit()
        assert (closed["closed"], closed["planned_unconfirmed"]) == (4, 1)
        period = ANCHOR.strftime("%Y-%m")
        worked = {e.id: payroll.compute_presence_variables(db, employee_id=e.id, period=period) for e in (planned, pointed, declared, night)}
        assert [worked[e.id]["worked_days"] for e in (planned, pointed, declared, night)] == [0, 1, 1, 1]
        assert worked[planned.id]["planned_unconfirmed_days"] == 1
        # Régularisation tracée après clôture : la journée devient payable, une seule fois.
        core.correct_presence(db, row=rows[planned.id], reason="Pointage oublié, confirmé par le chef de poste", source=SOURCE_MANUAL,
                              actor=ACTOR, allow_closed=True, status="present")
        db.commit()
        again = payroll.compute_presence_variables(db, employee_id=planned.id, period=period)
        assert (again["worked_days"], again["planned_unconfirmed_days"]) == (1, 0)
        db.refresh(rows[planned.id])
        assert rows[planned.id].generated == 1, "aucun historique réécrit"


def test_multi_site_planned_then_scanned_elsewhere_counts_once_on_postgresql(Session):
    from app.modules.attendance import core, official, presence_state
    from app.modules.attendance.models import SOURCE_SYSTEM
    from app.modules.ops import service as ops_service
    from app.modules.ops.models import Assignment, DailyPresence
    from app.modules.payroll import service as payroll

    with Session() as db:
        site_a, site_b = _site(db), _site(db)
        emp = _employee(db, site_a, "B")
        db.add(Assignment(employee_id=emp.id, site_id=site_b.id, group_code="B", start_date=date(2026, 1, 1), active=1,
                          work_regime=official.REGIME_POSTE_CONTINU, rotation_id=official.ensure_official_model(db).id))
        db.commit()
        ops_service.generate_daily_presence(db, ANCHOR, site_ids=[site_a.id, site_b.id])
        _scan(db, emp, _ts(ANCHOR, "13:50"))
        db.commit()
        rows = db.scalars(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).all()
        assert len(rows) == 1 and presence_state.states_for(db, rows)[rows[0].id] == presence_state.POINTE
        core.close_day(db, day=ANCHOR, site_ids=[site_a.id, site_b.id], actor=ACTOR, source=SOURCE_SYSTEM)
        db.commit()
        assert payroll.compute_presence_variables(db, employee_id=emp.id, period=ANCHOR.strftime("%Y-%m"))["worked_days"] == 1
