"""Attendus canoniques d'une vacation publiée : moteur = API = Pointeur (= BEO, voir
test_beo_coverage). Défaut corrigé : le Pointeur affichait 0 attendu au lieu de 2 lorsque les
affectations du site central n'étaient pas en régime POSTE_CONTINU ou lorsque la nuit
traversait minuit avec une affectation datée."""
from datetime import date, timedelta

import pytest
from sqlalchemy import delete, select

from app.modules.attendance import core, live
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site
from app.modules.rotations import service
from app.modules.rotations.engine import occurrences
from app.modules.rotations.models import OfficialRotation, RotationDraft
from tests.test_attendance_counted_time import ACTOR, ANCHOR, SOC, _setup, _tag, _ts
from tests.test_central_rotation_engine import config
from tests.test_central_rotation_integration import adopt

NIGHT_DAY = ANCHOR                                 # 1/3 : Nuit B du 01/10 17:00 au 02/10 08:00
AT_NIGHT = _ts(ANCHOR + timedelta(days=1), "02:00")


@pytest.fixture(autouse=True)
def clean(db):
    yield
    db.rollback()
    db.execute(delete(OfficialRotation)); db.execute(delete(RotationDraft)); db.commit()


def staff(db, site, group, *, regime=None, start=date(2026, 1, 1), end=None, status="actif"):
    employee = Employee(code=f"EX{_tag()}", first_name="Attendu", last_name=f"{group}{_tag()}", society=SOC, status=status)
    db.add(employee); db.flush()
    db.add(Assignment(employee_id=employee.id, site_id=site.id, group_code=group, start_date=start, end_date=end, active=1,
                      work_regime=regime))
    db.flush()
    return employee


@pytest.fixture
def central_site(db):
    """Site 1/3 publié ; deux agents B (régimes NORMAL et sans régime), plus A, C, D."""
    anchor_employee, site = _setup(db, group="A", regime="NORMAL")
    b1, b2 = staff(db, site, "B", regime="NORMAL"), staff(db, site, "B")
    others = {g: staff(db, site, g) for g in "CD"}
    db.commit()
    published = adopt(db, anchor_employee, site, config("1/3", anchor=str(ANCHOR)))
    return {"site": site, "B": [b1, b2], "A": anchor_employee, **others, "published": published}


def engine_slot(published, at):
    for day in (at.date() - timedelta(days=1), at.date()):
        for slot in occurrences(published.config, day, 1)["slots"]:
            if slot["start"] <= at.isoformat() < slot["end"]:
                return {**slot, "configuration_id": published.id}
    raise AssertionError("aucune vacation active")


def test_night_crossing_midnight_engine_api_and_pointeur_agree_on_two(db, client, auth_headers, central_site, monkeypatch):
    site, published = central_site["site"], central_site["published"]
    slot = engine_slot(published, AT_NIGHT)
    assert (slot["shift"], slot["group"], slot["work_date"]) == ("NUIT", "B", NIGHT_DAY.isoformat())
    engine_ids = service.expected_population(db, site.id, slot)
    assert engine_ids == {e.id for e in central_site["B"]}

    post = live.control_post(db, site.id, AT_NIGHT)
    assert post["kpi"]["expected"] == 2 and {r["employee"]["id"] for r in post["expected"]} == engine_ids
    assert post["current"]["occurrence_id"] == service.occurrence_key(site.id, slot)
    assert (post["current"]["configuration_version"], post["current"]["regime"], post["current"]["group"]) == (1, "1/3", "B")

    monkeypatch.setattr(core, "_now_local", lambda: AT_NIGHT)
    api = client.get("/api/portal/attendance-live", params={"site_id": site.id}, headers=auth_headers)
    assert api.status_code == 200, api.text
    assert api.json()["post"]["kpi"]["expected"] == 2
    assert api.json()["post"]["current"]["occurrence_id"] == post["current"]["occurrence_id"]


def test_off_group_other_vacation_and_other_site_are_never_expected(db, central_site):
    site = central_site["site"]
    other_site = Site(name=f"Autre site {_tag()}", active=1, equipment_plan={"societe": SOC}); db.add(other_site); db.flush()
    staff(db, other_site, "B"); db.commit()
    night = live.control_post(db, site.id, AT_NIGHT)
    expected = {r["employee"]["id"] for r in night["expected"]}
    assert expected == {e.id for e in central_site["B"]}                        # A, C, D : OFF ; autre site exclu
    day = live.control_post(db, site.id, _ts(ANCHOR, "10:00"))                  # autre vacation : Jour A
    assert day["current"]["group"] == "A" and {r["employee"]["id"] for r in day["expected"]} == {central_site["A"].id}


def test_date_change_switches_to_the_next_occurrence(db, central_site):
    site = central_site["site"]
    before = live.control_post(db, site.id, _ts(ANCHOR + timedelta(days=1), "07:59"))
    after = live.control_post(db, site.id, _ts(ANCHOR + timedelta(days=1), "08:00"))
    assert before["current"]["work_date"] == NIGHT_DAY.isoformat() and before["kpi"]["expected"] == 2
    assert after["current"]["work_date"] == (ANCHOR + timedelta(days=1)).isoformat()
    assert after["current"]["occurrence_id"] != before["current"]["occurrence_id"]
    assert {r["employee"]["id"] for r in after["expected"]} == {central_site["D"].id}   # remplacement de jour : D


def test_dated_assignments_follow_the_work_date_of_the_night(db, central_site):
    site = central_site["site"]
    ending = staff(db, site, "B", end=NIGHT_DAY)                    # finit le jour où la nuit commence : attendu
    starting = staff(db, site, "B", start=NIGHT_DAY + timedelta(days=1))   # commence le lendemain : pas pour cette nuit
    inactive = staff(db, site, "B", status="sorti")
    db.commit()
    expected = {r["employee"]["id"] for r in live.control_post(db, site.id, AT_NIGHT)["expected"]}
    assert ending.id in expected and starting.id not in expected and inactive.id not in expected
    assert len(expected) == 3


def test_absence_late_arrival_departure_and_maintien(db, central_site):
    site = central_site["site"]
    b1, b2 = central_site["B"]
    db.add(DailyPresence(employee_id=b2.id, site_id=site.id, presence_date=NIGHT_DAY, status="conge")); db.commit()
    late = core.record_scan(db, employee=b1, source="QR", actor=ACTOR, idempotency_key=None, now=_ts(NIGHT_DAY, "17:20"))
    assert late["counted"]["late_minutes"] == 20
    post = live.control_post(db, site.id, AT_NIGHT)
    assert (post["kpi"]["expected"], post["kpi"]["present"], post["kpi"]["excused"], post["kpi"]["absent"]) == (2, 1, 1, 0)
    # Maintien : toujours présent après la fin de la vacation.
    held = live.control_post(db, site.id, _ts(NIGHT_DAY + timedelta(days=1), "08:30"))
    assert held["kpi"]["maintien"] == 1
    # Sortie : plus présent ; les attendus de la nuit restent ceux de la nuit.
    core.record_scan(db, employee=b1, source="QR", actor=ACTOR, idempotency_key=None, now=_ts(NIGHT_DAY + timedelta(days=1), "08:00"))
    after_exit = live.control_post(db, site.id, _ts(NIGHT_DAY + timedelta(days=1), "07:59"))
    assert after_exit["kpi"]["expected"] == 2


def test_simulation_and_critical_points_use_the_same_population(db, central_site):
    site, published = central_site["site"], central_site["published"]
    slot = engine_slot(published, AT_NIGHT)
    draft = db.get(RotationDraft, published.draft_id)
    simulated = service.simulate(db, draft, 30)
    night = next(s for s in simulated["slots"] if s["start"] == slot["start"])
    assert set(night["employee_ids"]) == service.expected_population(db, site.id, slot)
