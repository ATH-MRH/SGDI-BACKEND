"""Planning intelligent, lot 2 — apprentissage sous concurrence réelle (PostgreSQL).

SQLite sérialise les écritures : ces tests ne s'exécutent que si ATTENDANCE_PG_URL pointe vers
une base PostgreSQL JETABLE (même convention que tests/test_attendance_sheets_pg_race.py).
Garanties vérifiées : une feuille clôturée = UNE observation, un seul groupe par (site, nom),
des versions de modèle sans doublon ni trou, aucun historique d'appartenance doublé — que
plusieurs workers clôturent en même temps, apprennent en même temps, ou qu'une reconstruction
croise une nouvelle clôture."""
import os
import threading
import uuid
from collections import Counter
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")

PARALLEL = 10
PARAMS = {"min_site_sheets": 8, "min_group_sheets": 2, "min_observations": 3, "min_cycle_comparisons": 8, "window_sheets": 60}
START = datetime(2026, 10, 5, 5, 0)          # 06:00 Africa/Algiers, en UTC naïf


@pytest.fixture(scope="module")
def pg_sessionmaker():
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(PG_URL, pool_size=PARALLEL + 2, max_overflow=0)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


@pytest.fixture(autouse=True)
def learning_enabled(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "rotation_learning_enabled", True)


def _world(Session):
    """Site 3 × 8 en apprentissage, 4 équipes de 3 salariés."""
    from app.modules.attendance.models import RotationSetting, RotationSiteModel
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment, Site

    with Session() as db:
        site = Site(name=f"Learn race {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": "RACE"})
        db.add(site); db.flush()
        db.add(RotationSetting(site_id=site.id, first_shift_time="06:00", shift_minutes=480, groups_count=4,
                               early_margin_minutes=60, active=1, version=1))
        db.add(RotationSiteModel(site_id=site.id, mode="LEARNING", params=PARAMS))
        teams = []
        for group in "ABCD":
            team = []
            for _ in range(3):
                emp = Employee(code=f"LR{uuid.uuid4().hex[:8]}", first_name="R", last_name="C", society="RACE", status="actif")
                db.add(emp); db.flush()
                db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=date(2026, 1, 1), active=1))
                team.append(emp.id)
            teams.append(team)
        db.commit()
        return site.id, teams


def _sheets(Session, site_id, teams, indexes, status="OPEN"):
    """Feuilles de rotation (une ligne par salarié présent), encore OPEN : c'est la clôture
    concurrente qui les rend observables."""
    from app.modules.attendance.models import AttendanceSheet, AttendanceSheetLine

    with Session() as db:
        for index in indexes:
            start = START + timedelta(hours=8 * index)
            sheet = AttendanceSheet(society="RACE", site_id=site_id, window_start=start, window_end=start + timedelta(hours=8),
                                    local_date=(start + timedelta(hours=1)).date(), slot_index=index % 3, status=status, source="EVENT",
                                    planning_version=1)
            db.add(sheet); db.flush()
            for employee_id in teams[index % 4]:
                db.add(AttendanceSheetLine(sheet_id=sheet.id, employee_id=employee_id, declared_group="ABCD"[index % 4],
                                           first_entry_at=start + timedelta(minutes=2), last_exit_at=start + timedelta(hours=7, minutes=50),
                                           state="SORTI", events_count=2))
        db.commit()


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


def _local(index):
    from app.modules.attendance import core
    return core.to_local(START + timedelta(hours=8 * index, minutes=1))


def _state(Session, site_id):
    from app.modules.attendance.models import (
        AttendanceSheet,
        RotationGroup,
        RotationMembership,
        RotationMembershipHistory,
        RotationModelVersion,
        RotationSheetObservation,
        RotationSiteModel,
    )

    with Session() as db:
        model = db.execute(select(RotationSiteModel).where(RotationSiteModel.site_id == site_id)).scalar_one()
        return {
            "model": (model.state, model.model_version, model.sheets_observed, model.groups_detected, model.fingerprint),
            "closed": db.execute(select(func.count(AttendanceSheet.id)).where(AttendanceSheet.site_id == site_id, AttendanceSheet.status != "OPEN")).scalar_one(),
            "observations": db.execute(select(RotationSheetObservation.sheet_id, RotationSheetObservation.group_label)
                                       .where(RotationSheetObservation.site_id == site_id).order_by(RotationSheetObservation.sheet_id)).all(),
            "groups": sorted(db.execute(select(RotationGroup.label, RotationGroup.sheets_count).where(RotationGroup.site_id == site_id)).all()),
            "members": sorted(db.execute(select(RotationMembership.employee_id, RotationMembership.learned_group, RotationMembership.status,
                                                RotationMembership.observations).where(RotationMembership.site_id == site_id)).all()),
            "versions": db.execute(select(RotationModelVersion.version).where(RotationModelVersion.site_id == site_id).order_by(RotationModelVersion.version)).scalars().all(),
            "history": db.execute(select(RotationMembershipHistory.employee_id, RotationMembershipHistory.old_group, RotationMembershipHistory.new_group,
                                         RotationMembershipHistory.new_status, RotationMembershipHistory.model_version)
                                  .where(RotationMembershipHistory.site_id == site_id)).all(),
        }


def _assert_consistent(state, sheets_count):
    assert state["closed"] == sheets_count
    assert len(state["observations"]) == len({sheet_id for sheet_id, _label in state["observations"]}) == sheets_count
    assert len(state["groups"]) == len({label for label, _count in state["groups"]})            # un groupe par nom
    assert sum(count for _label, count in state["groups"]) == state["model"][2] == sheets_count  # aucun score doublé
    assert state["versions"] == list(range(1, state["model"][1] + 1))                            # ni doublon ni trou
    assert max(Counter(state["history"]).values()) == 1                                          # aucun historique doublé
    assert len(state["members"]) == len({employee for employee, *_rest in state["members"]})


def test_parallel_closures_learn_each_sheet_exactly_once(pg_sessionmaker):
    from app.modules.attendance import sheets

    site_id, teams = _world(pg_sessionmaker)
    _sheets(pg_sessionmaker, site_id, teams, range(16))
    later = _local(16)

    def job(_i):
        with pg_sessionmaker() as db:
            outcome = sheets.maintain(db, later, [site_id], ensure_current=False)
            db.commit()
            return outcome["closed"]

    results, errors = _parallel(PARALLEL, job)
    assert errors == []
    assert sum(results) == 16                                           # chaque feuille clôturée une seule fois
    state = _state(pg_sessionmaker, site_id)
    _assert_consistent(state, 16)
    assert state["model"][:4] == ("STABLE", state["model"][1], 16, 4)
    assert state["groups"] == [("A", 4), ("B", 4), ("C", 4), ("D", 4)]
    assert {(group, status, n) for _e, group, status, n in state["members"]} == {(g, "PROBABLE", 4) for g in "ABCD"}
    for team, name in zip(teams, "ABCD"):
        assert {group for emp, group, _s, _n in state["members"] if emp in team} == {name}


def test_two_sheets_closing_at_the_same_instant_on_two_workers(pg_sessionmaker):
    """Deux feuilles se clôturent pendant que deux workers passent : mêmes résultats qu'un
    passage séquentiel, aucun doublon."""
    from app.modules.attendance import learning, sheets

    site_id, teams = _world(pg_sessionmaker)
    _sheets(pg_sessionmaker, site_id, teams, range(12))
    with pg_sessionmaker() as db:
        sheets.maintain(db, _local(12), [site_id], ensure_current=False); db.commit()
    _sheets(pg_sessionmaker, site_id, teams, [12, 13])

    def job(i):
        with pg_sessionmaker() as db:
            if i % 2:
                sheets.maintain(db, _local(14), [site_id], ensure_current=False)
            else:                                                       # worker qui n'apprend que ce qui est déjà clôturé
                learning.learn_pending(db, [site_id])
            db.commit()
        with pg_sessionmaker() as db:
            sheets.maintain(db, _local(14), [site_id], ensure_current=False); db.commit()
        return True

    _results, errors = _parallel(PARALLEL, job)
    assert errors == []
    state = _state(pg_sessionmaker, site_id)
    _assert_consistent(state, 14)
    assert state["groups"] == [("A", 4), ("B", 4), ("C", 3), ("D", 3)] and state["model"][0] == "STABLE"


def test_rebuild_crossing_a_new_closure_keeps_one_consistent_model(pg_sessionmaker):
    from app.modules.attendance import learning, sheets

    site_id, teams = _world(pg_sessionmaker)
    _sheets(pg_sessionmaker, site_id, teams, range(16))
    with pg_sessionmaker() as db:
        sheets.maintain(db, _local(16), [site_id], ensure_current=False); db.commit()
    reference = _state(pg_sessionmaker, site_id)
    _sheets(pg_sessionmaker, site_id, teams, [16, 17])

    def job(i):
        with pg_sessionmaker() as db:
            if i % 3 == 0:
                learning.rebuild(db, site_id, dry_run=False)
            elif i % 3 == 1:
                learning.rebuild(db, site_id, dry_run=True)             # simulation : n'écrit rien
            else:
                sheets.maintain(db, _local(18), [site_id], ensure_current=False)
            db.commit()
        return True

    _results, errors = _parallel(PARALLEL, job)
    assert errors == []
    with pg_sessionmaker() as db:                                       # passage final (si une reconstruction a devancé la clôture)
        sheets.maintain(db, _local(18), [site_id], ensure_current=False); db.commit()
    state = _state(pg_sessionmaker, site_id)
    _assert_consistent(state, 18)
    assert state["groups"] == [("A", 5), ("B", 5), ("C", 4), ("D", 4)]
    assert state["model"][0] == "STABLE" and state["model"][4] == reference["model"][4]      # même modèle qu'avant
    assert [(e, g, s) for e, g, s, _n in state["members"]] == [(e, g, s) for e, g, s, _n in reference["members"]]
    # Rejouer la reconstruction ne change plus rien.
    with pg_sessionmaker() as db:
        again = learning.rebuild(db, site_id, dry_run=False); db.commit()
    assert again["model_changed"] is False and again["membership_changes"] == []
    assert _state(pg_sessionmaker, site_id)["versions"] == state["versions"]
