"""Pointeur V6 : détail des compteurs (attendus, absents, présents par fonction) dans le flux du poste
de contrôle. Les listes reprennent exactement les ensembles des KPI ; une donnée indisponible reste
indisponible (None), jamais une liste vide ni un zéro."""
from collections import Counter
from types import SimpleNamespace

from app.modules.attendance import core, live
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_attendance_counted_time import ANCHOR, NEXT, _events, _scan, _setup, _ts
from tests.test_pointeur_control_post import _busy_site, _colleague, _post

ACTOR = SimpleNamespace(id=None, username="POINTEUR", role="pointeur")


def _states(post):
    return {row["employee"]["id"]: (row["state"], row["state_label"]) for row in post["expected"]}


def test_expected_detail_matches_the_counters(db):
    site, present, absent, on_leave, maintained = _busy_site(db)
    post = _post(db, site, ANCHOR, "14:40")
    kpi, rows = post["kpi"], post["expected"]
    assert len(rows) == kpi["expected"] == 3
    assert _states(post) == {present.id: ("PRESENT", "Présent"), absent.id: ("ABSENT", "Absent / non pointé"),
                             on_leave.id: ("EXCUSED", "Congé")}
    assert sum(r["state"] == "ABSENT" for r in rows) == kpi["absent"]
    assert sum(r["state"] == "EXCUSED" for r in rows) == kpi["excused"]
    assert maintained.id not in _states(post)                       # maintenu d'un autre groupe : présent, pas attendu
    assert [r["state"] for r in rows] == ["ABSENT", "EXCUSED", "PRESENT"]   # absents d'abord
    by_id = {r["employee"]["id"]: r for r in rows}
    assert by_id[present.id]["entry"] == "13:40" and by_id[absent.id]["entry"] is None
    assert by_id[absent.id]["employee"]["matricule"] == absent.code and by_id[on_leave.id]["excused_status"] == "conge"


def test_expected_detail_is_unavailable_without_a_vacation(db):
    emp, site = _setup(db, linked=False, rotation_system="3x8")
    _scan(db, emp, ANCHOR, "08:00")
    post = _post(db, site, ANCHOR, "09:00")
    assert post["kpi"]["expected"] is None and post["expected"] is None    # indisponible, pas « 0 attendu »
    assert post["kpi"]["present"] == len(post["present"]) == 1


def test_night_shift_expected_detail_survives_midnight(db):
    emp, site = _setup(db, group="C")
    other = _colleague(db, site, "C")
    _scan(db, emp, ANCHOR, "21:45")
    before, after = _post(db, site, ANCHOR, "23:59:30"), _post(db, site, NEXT, "00:00:30")
    assert _states(before) == _states(after) == {emp.id: ("PRESENT", "Présent"), other.id: ("ABSENT", "Absent / non pointé")}


def test_present_functions_add_up_to_the_present_counter(db):
    emp, site = _setup(db, group="B")
    emp.position = "Cariste"
    second, third = _colleague(db, site, "B"), _colleague(db, site, "B")
    second.position, third.position = "Cariste", None
    db.commit()
    for person in (emp, second, third):
        _scan(db, person, ANCHOR, "13:45")
    post = _post(db, site, ANCHOR, "15:00")
    functions = Counter(row["employee"]["fonction"] for row in post["present"])
    assert functions == {"Cariste": 2, "": 1}                       # fonction non renseignée : comptée, jamais exclue
    assert sum(functions.values()) == post["kpi"]["present"] == 3


def test_departure_and_site_change_update_present_and_expected(db):
    emp, site = _setup(db, group="B")
    _scan(db, emp, ANCHOR, "13:45")
    assert _states(_post(db, site, ANCHOR, "15:00"))[emp.id][0] == "PRESENT"
    _scan(db, emp, ANCHOR, "15:30")                                # sortie
    post = _post(db, site, ANCHOR, "15:31")
    assert post["kpi"]["present"] == 0 and post["present"] == []
    assert _states(post)[emp.id][0] == "ABSENT"
    _other, other_site = _setup(db, group="B")
    assert emp.id not in _states(_post(db, other_site, ANCHOR, "15:31"))  # un autre site ne voit pas cet attendu


def test_abandon_removes_the_employee_from_present_now(db):
    emp, site = _setup(db, group="B")
    _scan(db, emp, ANCHOR, "14:00")
    shift = _events(db, emp)[-1].id
    assert _post(db, site, ANCHOR, "18:00")["kpi"]["present"] == 1
    result = core.record_scan(db, employee=emp, source="MANUAL", actor=ACTOR, idempotency_key=None, abandon_shift_id=shift,
                              now=_ts(ANCHOR, "18:00"), observation="Départ anticipé constaté par le pointeur", manual_entry_allowed=True)
    assert result["message"] == "ABANDON DE POSTE ENREGISTRÉ"
    post = _post(db, site, ANCHOR, "18:01")
    assert post["kpi"]["present"] == 0 and post["present"] == []


def test_overview_merges_expected_detail_or_marks_it_unavailable(db):
    site, present, absent, on_leave, _maintained = _busy_site(db)
    _unconfigured_emp, unconfigured = _setup(db, linked=False, rotation_system="3x8")
    now = _ts(ANCHOR, "14:40")
    merged = live.overview_post(db, {site.id}, now, False)
    assert {r["employee"]["id"] for r in merged["expected"]} == {present.id, absent.id, on_leave.id}
    assert all(r["site"] == site.name for r in merged["expected"])
    assert len(merged["expected"]) == merged["kpi"]["expected"]
    mixed = live.overview_post(db, {site.id, unconfigured.id}, now, False)
    assert mixed["expected"] is None and mixed["kpi"]["expected"] is None
