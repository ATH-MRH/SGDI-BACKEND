"""Pointeur V6 sur PostgreSQL réel : détail nominatif des attendus (`post.expected`).

Vacation de nuit à cheval sur minuit (présent, absent, congé), changement de site d'un employé,
employé affecté sur deux sites et vue multi-sites. Exécuté uniquement si ATTENDANCE_PG_URL pointe
vers une base PostgreSQL JETABLE (même convention que tests/test_pointeur_audit_pg.py)."""
import os
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")

TZ = ZoneInfo("Africa/Algiers")
ANCHOR = date(2026, 10, 1)                     # groupe C = Nuit le jour d'ancrage
ACTOR = SimpleNamespace(id=None, username="PG-V6")
SOC = "PGV6"


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

    site = Site(name=f"PG V6 {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    db.add(SiteRotation(site_id=site.id, rotation_id=official.ensure_official_model(db).id, start_date=ANCHOR, active=1))
    db.flush()
    return site


def _employee(db, site, group="C", position="Cariste", name="Agent"):
    from app.modules.attendance import official
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment

    emp = Employee(code=f"PG6{uuid.uuid4().hex[:8]}", first_name=name, last_name="PG", society=SOC, status="actif", position=position)
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=date(2026, 1, 1), active=1,
                      work_regime=official.REGIME_POSTE_CONTINU, rotation_id=official.ensure_official_model(db).id))
    db.flush()
    return emp


def _scan(db, emp, at):
    from app.modules.attendance import core
    return core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=f"pg6-{uuid.uuid4().hex}", now=at)


def _states(post):
    return {r["employee"]["id"]: (r["state"], r["state_label"], r["entry"]) for r in post["expected"]}


def test_night_shift_expected_detail_on_postgresql(Session):
    from app.modules.attendance import live
    from app.modules.ops.models import DailyPresence

    with Session() as db:
        site = _site(db)
        present, absent, on_leave = (_employee(db, site, name=n) for n in ("Present", "Absent", "Conge"))
        db.add(DailyPresence(presence_date=ANCHOR, employee_id=on_leave.id, site_id=site.id, status="maladie", generated=0))
        db.commit()
        _scan(db, present, _ts(ANCHOR, "21:45"))
        before = live.control_post(db, site.id, _ts(ANCHOR, "23:59"))
        after = live.control_post(db, site.id, _ts(ANCHOR + timedelta(days=1), "00:30"))
        expected = {present.id: ("PRESENT", "Présent", "21:45"), absent.id: ("ABSENT", "Absent / non pointé", None),
                    on_leave.id: ("EXCUSED", "Maladie", None)}
        assert _states(before) == _states(after) == expected                 # minuit : même vacation, même détail
        for post in (before, after):
            assert post["current"]["shift"] == "NUIT" and post["current"]["work_date"] == ANCHOR.isoformat()
            assert len(post["expected"]) == post["kpi"]["expected"] == 3
            assert sum(r["state"] == "ABSENT" for r in post["expected"]) == post["kpi"]["absent"] == 1
            assert post["kpi"]["excused"] == 1 and post["kpi"]["present"] == len(post["present"]) == 1
            assert [r["state"] for r in post["expected"]] == ["ABSENT", "EXCUSED", "PRESENT"]


def test_site_change_moves_the_employee_between_expected_lists_on_postgresql(Session):
    from app.modules.attendance import live
    from app.modules.ops.models import Assignment

    with Session() as db:
        site_a, site_b = _site(db), _site(db)
        mover = _employee(db, site_a, name="Mutation")
        db.commit()
        at = _ts(ANCHOR, "23:00")
        assert mover.id in _states(live.control_post(db, site_a.id, at))
        assert mover.id not in _states(live.control_post(db, site_b.id, at))
        assignment = db.query(Assignment).filter(Assignment.employee_id == mover.id).one()
        assignment.site_id = site_b.id                                      # changement de site
        db.commit()
        assert mover.id not in _states(live.control_post(db, site_a.id, at))
        assert _states(live.control_post(db, site_b.id, at))[mover.id][0] == "ABSENT"


def test_multi_site_assignments_and_overview_on_postgresql(Session):
    from app.modules.attendance import live, official
    from app.modules.ops.models import Assignment

    with Session() as db:
        site_a, site_b = _site(db), _site(db)
        local_a, local_b = _employee(db, site_a, name="LocalA"), _employee(db, site_b, name="LocalB", position=None)
        both = _employee(db, site_a, name="DeuxSites")
        db.add(Assignment(employee_id=both.id, site_id=site_b.id, group_code="C", start_date=date(2026, 1, 1), active=1,
                          work_regime=official.REGIME_POSTE_CONTINU, rotation_id=official.ensure_official_model(db).id))
        db.commit()
        _scan(db, local_a, _ts(ANCHOR, "21:50"))
        at = _ts(ANCHOR, "23:00")
        post_a, post_b = live.control_post(db, site_a.id, at), live.control_post(db, site_b.id, at)
        assert set(_states(post_a)) == {local_a.id, both.id} and set(_states(post_b)) == {local_b.id, both.id}
        overview = live.overview_post(db, {site_a.id, site_b.id}, at, False)
        # Même règle que les KPI existants (somme par site) : la liste a autant de lignes que le compteur.
        assert len(overview["expected"]) == overview["kpi"]["expected"] == post_a["kpi"]["expected"] + post_b["kpi"]["expected"]
        assert {(r["employee"]["id"], r["site"]) for r in overview["expected"]} == {
            (local_a.id, site_a.name), (both.id, site_a.name), (local_b.id, site_b.name), (both.id, site_b.name)}
        assert overview["kpi"]["present"] == len(overview["present"]) == 1
        row_b = next(r for r in post_b["expected"] if r["employee"]["id"] == local_b.id)
        assert row_b["state"] == "ABSENT" and row_b["employee"]["fonction"] == ""      # fonction non renseignée
