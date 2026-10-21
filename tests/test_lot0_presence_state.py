"""Lot 0 — une présence générée par une rotation n'est jamais un travail effectué.

Journée générée (OPS) = PLANIFIÉ ; pointage = POINTÉ ; saisie ou correction tracée = JUSTIFIÉ ;
journée prouvée puis clôturée = VALIDÉ (seule base de la paie) ; générée avec des heures mais sans
événement = À VÉRIFIER. Aucune ligne n'est réécrite : l'état se déduit des preuves."""
from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.modules.attendance import core, presence_state
from app.modules.attendance.models import SOURCE_MANUAL, SOURCE_SYSTEM
from app.modules.auth.models import User
from app.modules.brq import service as brq
from app.modules.ops import service as ops_service
from app.modules.ops.models import Assignment, DailyPresence
from app.modules.ops.schemas import RotationGenerateRequest
from app.modules.payroll import service as payroll
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_attendance_counted_time import ANCHOR, NEXT, _scan, _setup, _ts

ACTOR = SimpleNamespace(id=None, username="POINTEUR", role="pointeur")
PERIOD = ANCHOR.strftime("%Y-%m")


def _row(db, emp, day=ANCHOR):
    return db.scalar(select(DailyPresence).where(DailyPresence.employee_id == emp.id, DailyPresence.presence_date == day))


def _state(db, row):
    return presence_state.states_for(db, [row])[row.id]


def _generate(db, site, day=ANCHOR, rotation=False):
    if rotation:
        ops_service.generate_rotation_daily_presence(db, RotationGenerateRequest(presence_date=day, site_id=site.id), site_ids=[site.id])
    else:
        ops_service.generate_daily_presence(db, day, site_ids=[site.id])
    db.commit()


def _close(db, site, day=ANCHOR):
    result = core.close_day(db, day=day, site_ids=[site.id], actor=ACTOR, source=SOURCE_SYSTEM)
    db.commit()
    return result


def _admin(db):
    return db.scalar(select(User).where(User.username == "testadmin"))


@pytest.mark.parametrize("rotation", [False, True])
def test_generated_day_is_planned_never_worked_and_blocks_the_slip(db, rotation):
    emp, site = _setup(db, group="B")
    _generate(db, site, rotation=rotation)
    row = _row(db, emp)
    assert (row.generated, row.status) == (1, "present")               # statut historique conservé (écran legacy)
    assert _state(db, row) == presence_state.PLANIFIE
    closed = _close(db, site)
    assert closed["planned_unconfirmed"] == 1 and closed["to_verify"] == 0
    assert _state(db, row) == presence_state.PLANIFIE                   # la clôture ne valide pas une prévision
    variables = payroll.compute_presence_variables(db, employee_id=emp.id, period=PERIOD)
    assert variables["worked_days"] == 0 and variables["absence_days"] == 0
    assert variables["planned_unconfirmed_days"] == 1 and variables["closed_presence_rows"] == 1
    blockers = payroll.slip_validation_blockers(SimpleNamespace(inputs=variables, rules_used={}))
    assert blockers and "planifiée" in blockers[0]
    db.refresh(row)
    assert (row.generated, row.status) == (1, "present"), "aucun historique réécrit"


def test_real_scan_on_a_planned_day_makes_it_pointed_then_validated(db):
    emp, site = _setup(db, group="B")
    _generate(db, site)
    _scan(db, emp, ANCHOR, "13:45")
    _scan(db, emp, ANCHOR, "22:02")
    row = _row(db, emp)
    assert _state(db, row) == presence_state.POINTE
    _close(db, site)
    assert _state(db, row) == presence_state.VALIDE
    variables = payroll.compute_presence_variables(db, employee_id=emp.id, period=PERIOD)
    assert (variables["worked_days"], variables["planned_unconfirmed_days"]) == (1, 0)
    assert payroll.slip_validation_blockers(SimpleNamespace(inputs=variables, rules_used={})) == []


def test_manual_status_and_post_closure_correction_are_justified(db):
    present, site = _setup(db, group="B")
    absent, _site = _setup(db, group="B")
    db.query(Assignment).filter(Assignment.employee_id == absent.id).update({"site_id": site.id}); db.commit()
    forgotten, _other = _setup(db, group="B")
    db.query(Assignment).filter(Assignment.employee_id == forgotten.id).update({"site_id": site.id}); db.commit()
    _generate(db, site)
    core.record_day_status(db, employee=present, site_id=site.id, day=ANCHOR, status="present", source=SOURCE_MANUAL, actor=ACTOR)
    core.record_day_status(db, employee=absent, site_id=site.id, day=ANCHOR, status="absent", source=SOURCE_MANUAL, actor=ACTOR,
                           notes="Absence constatée")
    db.commit()
    assert _state(db, _row(db, present)) == _state(db, _row(db, absent)) == presence_state.JUSTIFIE
    assert _state(db, _row(db, forgotten)) == presence_state.PLANIFIE
    _close(db, site)
    # Pointage oublié régularisé après clôture : correction tracée, motif obligatoire.
    core.correct_presence(db, row=_row(db, forgotten), reason="Pointage oublié, présence confirmée par le chef de poste",
                          source=SOURCE_MANUAL, actor=ACTOR, allow_closed=True, status="present")
    db.commit()
    assert _state(db, _row(db, forgotten)) == presence_state.VALIDE
    got = {e.id: payroll.compute_presence_variables(db, employee_id=e.id, period=PERIOD) for e in (present, absent, forgotten)}
    assert (got[present.id]["worked_days"], got[absent.id]["absence_days"], got[forgotten.id]["worked_days"]) == (1, 1, 1)
    assert all(v["planned_unconfirmed_days"] == 0 for v in got.values())


def test_historical_rows_keep_counting_and_uncertain_generated_rows_must_be_verified(db):
    legacy, site = _setup(db, group="B")
    uncertain, _site = _setup(db, group="B")
    db.add(DailyPresence(presence_date=ANCHOR, employee_id=legacy.id, site_id=site.id, status="present", generated=0,
                         data={"_legacy": {"statut": "present"}}))            # saisie historique (écran legacy)
    db.add(DailyPresence(presence_date=ANCHOR, employee_id=uncertain.id, site_id=site.id, status="present", generated=1,
                         arrival_time="07:58", departure_time="16:02"))       # générée puis complétée sans journal
    db.commit()
    assert _state(db, _row(db, legacy)) == presence_state.JUSTIFIE
    assert _state(db, _row(db, uncertain)) == presence_state.A_VERIFIER
    closed = core.close_day(db, day=ANCHOR, site_ids=[site.id, _site.id], actor=ACTOR, source=SOURCE_SYSTEM); db.commit()
    assert closed["to_verify"] == 1
    assert payroll.compute_presence_variables(db, employee_id=legacy.id, period=PERIOD)["worked_days"] == 1   # pas de régression
    doubtful = payroll.compute_presence_variables(db, employee_id=uncertain.id, period=PERIOD)
    assert (doubtful["worked_days"], doubtful["days_to_verify"]) == (0, 1)
    assert any("incertaine" in b for b in payroll.slip_validation_blockers(SimpleNamespace(inputs=doubtful, rules_used={})))


def test_night_shift_is_one_validated_day(db):
    emp, site = _setup(db, group="C")
    _generate(db, site)
    _scan(db, emp, ANCHOR, "21:45")
    _scan(db, emp, NEXT, "06:05")
    rows = db.scalars(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).all()
    assert len(rows) == 1 and rows[0].presence_date == ANCHOR
    _close(db, site)
    _close(db, site, NEXT)
    variables = payroll.compute_presence_variables(db, employee_id=emp.id, period=PERIOD)
    assert (variables["worked_days"], variables["planned_unconfirmed_days"]) == (1, 0)


def test_multi_site_agent_planned_on_one_site_scanned_on_another_counts_once(db):
    emp, site_a = _setup(db, group="B")
    _other, site_b = _setup(db, group="B")
    rotation_id = db.scalar(select(Assignment.rotation_id).where(Assignment.employee_id == emp.id))
    db.add(Assignment(employee_id=emp.id, site_id=site_b.id, group_code="B", start_date=date(2026, 1, 1), active=1,
                      work_regime="POSTE_CONTINU", rotation_id=rotation_id))
    db.commit()
    _generate(db, site_a)
    _scan(db, emp, ANCHOR, "13:50")                                     # affectation la plus récente : site B
    rows = db.scalars(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).all()
    assert len(rows) == 1 and rows[0].site_id == site_b.id
    assert _state(db, rows[0]) == presence_state.POINTE
    core.close_day(db, day=ANCHOR, site_ids=[site_a.id, site_b.id], actor=ACTOR, source=SOURCE_SYSTEM); db.commit()
    assert payroll.compute_presence_variables(db, employee_id=emp.id, period=PERIOD)["worked_days"] == 1


def test_brq_board_workspace_and_ops_list_do_not_show_a_plan_as_presence(db, client, auth_headers, monkeypatch):
    emp, site = _setup(db, group="B")
    _generate(db, site)
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "13:00"))
    item = next(i for i in brq.situation(brq.build_report(db, _admin(db), day=ANCHOR, site_id=site.id))["items"] if i["employee_id"] == emp.id)
    assert item["state"] == "non_pointe"
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "15:00"))
    report = brq.situation(brq.build_report(db, _admin(db), day=ANCHOR, site_id=site.id))
    assert next(i for i in report["items"] if i["employee_id"] == emp.id)["state"] == "absent"
    assert report["kpis"]["presents"] == 0
    board = client.get(f"/api/attendance/board?presence_date={ANCHOR}&site_id={site.id}", headers=auth_headers)
    assert board.status_code == 200, board.text
    line = next(r for r in board.json()["items"] if r["employee_id"] == emp.id)
    assert line["status"] != "present" and line["presence_state"] == presence_state.PLANIFIE
    assert board.json()["kpi"]["present"] == 0
    listed = client.get(f"/api/ops/pointage/daily?presence_date={ANCHOR}&site_id={site.id}", headers=auth_headers).json()
    assert [r["presence_state"] for r in listed if r["employee_id"] == emp.id] == [presence_state.PLANIFIE]
    from app.modules.attendance.workspace import read_workspace
    grid = read_workspace(db, site_ids=[site.id], month=PERIOD, q=None, employee_status=None, employee_id=emp.id, page=1, page_size=25)
    cell = next(c for r in grid["items"] for c in r["days"] if c["date"] == ANCHOR.isoformat())
    assert cell["status"] != "present" and cell["recorded"] is False and cell["presence_state"] == presence_state.PLANIFIE
    _scan(db, emp, ANCHOR, "13:55")
    line = next(r for r in client.get(f"/api/attendance/board?presence_date={ANCHOR}&site_id={site.id}", headers=auth_headers).json()["items"]
                if r["employee_id"] == emp.id)
    assert (line["status"], line["presence_state"]) == ("present", presence_state.POINTE)


def test_sql_clause_matches_the_python_states(db):
    emp, site = _setup(db, group="B")
    real, _site = _setup(db, group="B")
    db.query(Assignment).filter(Assignment.employee_id == real.id).update({"site_id": site.id}); db.commit()
    _generate(db, site)
    _scan(db, real, ANCHOR, "13:45")
    rows = db.scalars(select(DailyPresence).where(DailyPresence.site_id == site.id, DailyPresence.presence_date == ANCHOR)).all()
    by_python = {r.id for r in presence_state.real_rows(db, rows)}
    by_sql = set(db.scalars(select(DailyPresence.id).where(DailyPresence.site_id == site.id, DailyPresence.presence_date == ANCHOR,
                                                           presence_state.real_clause())))
    assert by_python == by_sql == {_row(db, real).id}
    assert db.scalar(select(func.count()).select_from(DailyPresence).where(
        DailyPresence.site_id == site.id, presence_state.unconfirmed_clause())) == 1


def test_portal_can_record_an_absence_on_a_planned_day(db, client, auth_headers, monkeypatch):
    emp, site = _setup(db, group="B")
    today = core._now_local().date()
    _generate(db, site, day=today)
    response = client.post("/api/portal/attendance-manual/scan", headers=auth_headers,
                           json={"employee_id": emp.id, "action": "absent", "site_id": site.id, "observation": "Absent au poste"})
    assert response.status_code in (200, 201), response.text
    row = _row(db, emp, today)
    db.refresh(row)
    assert row.status == "absent" and _state(db, row) == presence_state.JUSTIFIE
