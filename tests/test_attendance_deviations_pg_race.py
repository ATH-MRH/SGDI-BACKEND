"""Planning intelligent, lot 3 — écarts et qualifications sous concurrence réelle (PostgreSQL).

Ne s'exécute que si ATTENDANCE_PG_URL pointe vers une base PostgreSQL JETABLE. Garanties : un
écart logique = une ligne et une alerte, même quand le même salarié ou plusieurs salariés
pointent au même instant ; une qualification OPS simultanée ne produit qu'UNE décision ; une
clôture qui croise des pointages ne perd ni ne double rien."""
import threading
import uuid
from collections import Counter
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from tests.test_attendance_learning_pg_race import (  # noqa: F401 (fixtures réutilisées)
    PARALLEL,
    PG_URL,
    START,
    _local,
    _parallel,
    _sheets,
    _world,
    learning_enabled,
    pg_sessionmaker,
)

pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")


def _active(Session):
    """Site STABLE (16 rotations A → B → C → D) passé en mode ACTIVE."""
    from app.modules.attendance import sheets
    from app.modules.attendance.models import RotationSiteModel

    site_id, teams = _world(Session)
    _sheets(Session, site_id, teams, range(16))
    with Session() as db:
        sheets.maintain(db, _local(16), [site_id], ensure_current=False)
        model = db.execute(select(RotationSiteModel).where(RotationSiteModel.site_id == site_id)).scalar_one()
        assert model.state == "STABLE"
        model.mode = "ACTIVE"
        db.commit()
    return site_id, teams


def _scan(Session, employee_id, when, key=None):
    from app.modules.attendance import core
    from app.modules.drh.models import Employee

    with Session() as db:
        return core.record_scan(db, employee=db.get(Employee, employee_id), source="QR", actor=SimpleNamespace(id=None, username="T"),
                                idempotency_key=key or f"dev-{uuid.uuid4().hex}", now=when)


def _state(Session, site_id):
    from app.modules.alerts.models import Alert
    from app.modules.attendance.models import RotationCheck, RotationDecision, RotationMembershipHistory

    with Session() as db:
        return {
            "checks": db.execute(select(RotationCheck.employee_id, RotationCheck.sheet_id, RotationCheck.outcome, RotationCheck.status,
                                        RotationCheck.alert_id, RotationCheck.qualification).where(RotationCheck.site_id == site_id)).all(),
            "alerts": db.execute(select(Alert.id, Alert.status, Alert.dedup_key, Alert.occurrence_count)
                                 .where(Alert.site_id == site_id, Alert.rule_key == "attendance.rotation.deviation")).all(),
            "decisions": db.execute(select(RotationDecision.kind, RotationDecision.group_label, RotationDecision.check_id)
                                    .where(RotationDecision.site_id == site_id)).all(),
            "human": db.execute(select(func.count(RotationMembershipHistory.id)).where(
                RotationMembershipHistory.site_id == site_id, RotationMembershipHistory.source == "HUMAN")).scalar_one(),
        }


def test_same_employee_and_several_employees_deviating_at_once(pg_sessionmaker):
    """Le groupe A (3 salariés) pointe sur la rotation du groupe B, chaque salarié depuis
    plusieurs terminaux au même instant : 3 pointages, 3 écarts, 3 alertes — jamais plus."""
    site_id, teams = _active(pg_sessionmaker)
    when = _local(17)
    jobs = [emp for emp in teams[0] for _ in range(4)]

    results, errors = _parallel(len(jobs), lambda i: _scan(pg_sessionmaker, jobs[i], when))
    assert errors == []
    assert sum(1 for r in results if not r["duplicate"]) == 3
    assert {r["rotation_alert"]["observed"]["group"] for r in results if not r["duplicate"]} == {"B"}
    state = _state(pg_sessionmaker, site_id)
    assert sorted(c[0] for c in state["checks"]) == sorted(teams[0])
    assert {(c[2], c[3]) for c in state["checks"]} == {("UNEXPECTED_ROTATION", "OPEN")}
    assert len(state["alerts"]) == 3 == len({a[2] for a in state["alerts"]}) and {a[3] for a in state["alerts"]} == {1}
    assert sorted(c[4] for c in state["checks"]) == sorted(a[0] for a in state["alerts"])


def test_simultaneous_ops_qualification_produces_a_single_decision(pg_sessionmaker):
    from app.modules.attendance import deviations
    from app.modules.attendance.models import RotationCheck

    site_id, teams = _active(pg_sessionmaker)
    result = _scan(pg_sessionmaker, teams[0][0], _local(17))
    check_id = result["rotation_alert"]["id"]
    actions = ["GROUP_CHANGE", "PERMUTATION", "FALSE_POSITIVE", "GROUP_CHANGE", "REPLACEMENT"]

    def job(i):
        action = actions[i % len(actions)]
        with pg_sessionmaker() as db:
            try:
                check = deviations.qualify(db, check_id, action=action, user=SimpleNamespace(id=None, username=f"ops{i}"), reason="Décision OPS",
                                           end_at=START + timedelta(hours=8 * 30))
                db.commit()
                return check.qualification
            except deviations.AlreadyQualified:
                db.rollback()
                return "REFUSED"

    results, errors = _parallel(PARALLEL, job)
    assert errors == []
    with pg_sessionmaker() as db:
        final = db.get(RotationCheck, check_id)
        winner = final.qualification
        assert final.status in ("RESOLVED", "DISMISSED")
    assert set(results) <= {winner, "REFUSED"} and winner in results          # une seule décision l'emporte
    state = _state(pg_sessionmaker, site_id)
    expected_decisions = 1 if winner in ("GROUP_CHANGE", "REPLACEMENT") else 0
    assert len(state["decisions"]) == expected_decisions
    assert state["human"] == (1 if winner == "GROUP_CHANGE" else 0)
    assert [a[1] for a in state["alerts"]] == ["ignored" if winner == "FALSE_POSITIVE" else "treated"]


def test_closure_crossing_scans_loses_and_doubles_nothing(pg_sessionmaker):
    """La rotation 16 (groupe A) se clôture pendant que le groupe B prend la rotation 17 et qu'un
    salarié du groupe A s'y présente : feuilles, observation, écart et alerte restent uniques."""
    from app.modules.attendance import sheets
    from app.modules.attendance.models import AttendanceSheet, AttendanceSheetLine, RotationSheetObservation

    site_id, teams = _active(pg_sessionmaker)
    _sheets(pg_sessionmaker, site_id, teams, [16])
    when = _local(17)
    scanners = teams[1] + [teams[0][0]]

    def job(i):
        if i < len(scanners) * 2:
            return _scan(pg_sessionmaker, scanners[i % len(scanners)], when)["duplicate"]
        with pg_sessionmaker() as db:
            sheets.maintain(db, when, [site_id])
            db.commit()
        return None

    results, errors = _parallel(len(scanners) * 2 + 4, job)
    assert errors == []
    assert Counter(r for r in results if r is not None) == Counter({False: 4, True: 4})
    with pg_sessionmaker() as db:
        rows = db.execute(select(AttendanceSheet).where(AttendanceSheet.site_id == site_id, AttendanceSheet.window_start >= START + timedelta(hours=8 * 16))
                          .order_by(AttendanceSheet.window_start)).scalars().all()
        assert [(s.status, s.window_start) for s in rows] == [("CLOSED", START + timedelta(hours=8 * 16)), ("OPEN", START + timedelta(hours=8 * 17))]
        assert db.execute(select(func.count(AttendanceSheetLine.id)).where(AttendanceSheetLine.sheet_id == rows[1].id)).scalar_one() == 4
        assert db.execute(select(func.count(RotationSheetObservation.sheet_id)).where(RotationSheetObservation.site_id == site_id)).scalar_one() == 17
    state = _state(pg_sessionmaker, site_id)
    assert Counter(c[2] for c in state["checks"]) == Counter({"CONFORM": 3, "UNEXPECTED_ROTATION": 1})
    assert len(state["alerts"]) == 1
