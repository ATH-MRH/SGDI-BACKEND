"""Lot 5 : données du poste de contrôle Pointeur — vacation active du site et prochaine relève
(planning officiel), KPI personnes, présents uniques, à traiter, derniers mouvements, contexte et
intention explicite de maintien."""
import json
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.attendance import core, counted, live, official
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_attendance_counted_time import ANCHOR, NEXT, SOC, _iso, _scan, _setup, _tag, _ts

POINTER = SimpleNamespace(id=None, username="POINTEUR")


def _colleague(db, site, group):
    emp = Employee(code=f"CP{_tag()}", first_name="Agent", last_name=f"Groupe{group}", society=SOC, status="actif", position="Agent")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=date(2026, 1, 1), active=1,
                      work_regime=official.REGIME_POSTE_CONTINU, rotation_id=official.ensure_official_model(db).id))
    db.commit()
    return emp


def _post(db, site, day, hms, **options):
    return live.control_post(db, site.id, _ts(day, hms), **options)


# ── Vacation active du site : relèves et minuit ──────────────────────────────────────────
@pytest.mark.parametrize("day, hms, shift, group, start, end, next_group", [
    (ANCHOR, "13:59:59", "MATIN", "A", "06:00", "14:00", "B"),
    (ANCHOR, "14:00:00", "APRES_MIDI", "B", "14:00", "22:00", "C"),
    (ANCHOR, "21:59:59", "APRES_MIDI", "B", "14:00", "22:00", "C"),
    (ANCHOR, "22:00:00", "NUIT", "C", "22:00", "06:00", "A"),
    (ANCHOR, "23:59:59", "NUIT", "C", "22:00", "06:00", "A"),
    (NEXT, "00:00:00", "NUIT", "C", "22:00", "06:00", "A"),          # minuit : même vacation, même groupe
    (NEXT, "05:59:59", "NUIT", "C", "22:00", "06:00", "A"),
    (NEXT, "06:00:00", "MATIN", "A", "06:00", "14:00", "B"),
])
def test_site_shift_follows_the_official_cycle_across_reliefs_and_midnight(db, day, hms, shift, group, start, end, next_group):
    _emp, site = _setup(db)
    post = _post(db, site, day, hms)
    current = post["current"]
    assert post["status"] == "OFFICIAL"
    assert (current["shift"], current["group"], current["start"], current["end"]) == (shift, group, start, end)
    assert post["next"]["group"] == next_group and post["next"]["scheduled_start"] == current["scheduled_end"]
    if shift == "NUIT":
        assert current["work_date"] == ANCHOR.isoformat()             # la Nuit reste rattachée à son jour de début
    plan = official.site_shift(db, site_id=site.id, at=_ts(day, hms))
    if (day, shift) == (ANCHOR, "MATIN"):
        assert plan["previous"] is None                               # rien avant la date d'ancrage : aucune vacation inventée
    else:
        assert plan["previous"]["scheduled_end"] == plan["current"]["scheduled_start"]


def test_unanchored_site_shows_rotation_not_configured_and_invents_nothing(db):
    emp, site = _setup(db, linked=False, rotation_system="3x8")
    _scan(db, emp, ANCHOR, "08:00")
    post = _post(db, site, ANCHOR, "09:00")
    assert post["status"] == "ROTATION_NOT_CONFIGURED" and "non configurée" in post["reason"]
    assert post["current"] is None and post["next"] is None and post["maintien"] is None
    assert (post["kpi"]["expected"], post["kpi"]["absent"], post["kpi"]["present"]) == (None, None, 1)
    assert post["present"][0]["shift_start"] is None and post["present"][0]["badge"] == "EN_POSTE"


def test_site_without_posted_regime_is_not_reported_as_a_rotation(db):
    _emp, site = _setup(db, regime=None, linked=False)
    post = _post(db, site, ANCHOR, "09:00")
    assert (post["status"], post["current"], post["kpi"]["expected"]) == ("NORMAL", None, None)


# ── KPI personnes : attendus, présents uniques, absents, maintien, anomalies ─────────────
def _busy_site(db):
    """Vacation Après-midi (groupe B) : un présent, un absent, un en congé ; un agent du groupe A
    maintenu après son Matin ; une tentative refusée."""
    present, site = _setup(db, group="B")
    absent, on_leave, maintained = _colleague(db, site, "B"), _colleague(db, site, "B"), _colleague(db, site, "A")
    db.add(DailyPresence(presence_date=ANCHOR, employee_id=on_leave.id, site_id=site.id, status="conge", generated=0))
    db.commit()
    _scan(db, maintained, ANCHOR, "05:50")
    _scan(db, maintained, ANCHOR, "14:04")
    with pytest.raises(HTTPException):
        _scan(db, maintained, ANCHOR, "14:10")                        # avant TFIN+30 : refusé
    _scan(db, present, ANCHOR, "13:40")
    _scan(db, maintained, ANCHOR, "14:35")
    return site, present, absent, on_leave, maintained


def test_kpis_count_people_and_never_events(db):
    site, present, absent, on_leave, maintained = _busy_site(db)
    post = _post(db, site, ANCHOR, "14:40")
    assert post["kpi"] == {"expected": 3, "present": 2, "absent": 1, "excused": 1, "maintien": 1, "anomalies": 1}
    rows = {row["employee"]["id"]: row for row in post["present"]}
    assert set(rows) == {present.id, maintained.id} and len(post["present"]) == 2          # une ligne par personne, pas par mouvement
    assert (rows[present.id]["badge_label"], rows[present.id]["entry"], rows[present.id]["shift_start"], rows[present.id]["shift_end"]) == (
        "EN POSTE", "13:40", "14:00", "22:00")
    assert (rows[maintained.id]["badge_label"], rows[maintained.id]["entry"], rows[maintained.id]["employee"]["group"]) == ("EN MAINTIEN", "14:35", "A")
    assert rows[present.id]["employee"]["matricule"] == present.code and rows[present.id]["employee"]["group"] == "B"
    todo = post["todo"][0]
    assert (todo["code"], todo["label"], todo["employee"]["matricule"], todo["action"]) == ("EXTRA_SHIFT", "Maintien à qualifier", maintained.code, None)
    # Mouvements : 4 passages + 1 refus, sans effet sur les présents.
    assert [m["type"] for m in post["movements"]] == ["MAINTIEN", "REFUS", "SORTIE", "ENTREE", "ENTREE"]
    refusal = next(m for m in post["movements"] if m["type"] == "REFUS")
    assert (refusal["heure"], refusal["matricule"], refusal["code"]) == ("14:10:00", maintained.code, "EXTRA_BEFORE_WINDOW") and "14:30" in refusal["detail"]
    assert post["activity"]["refused_today"] == 1
    summary = live.summary(db, {site.id}, _ts(ANCHOR, "14:40"))
    assert (summary["entries_today"], summary["exits_today"]) == (3, 1)                      # mouvements, pas des personnes


def test_night_shift_kpis_do_not_reset_at_midnight(db):
    emp, site = _setup(db, group="C")
    _colleague(db, site, "C")
    _scan(db, emp, ANCHOR, "21:45")
    before, after = _post(db, site, ANCHOR, "23:59:30"), _post(db, site, NEXT, "00:00:30")
    assert before["kpi"] == after["kpi"] == {"expected": 2, "present": 1, "absent": 1, "excused": 0, "maintien": 0, "anomalies": 0}
    assert before["current"] == after["current"] and after["present"][0]["entry"] == "21:45"


# ── Fenêtre de maintien et « à traiter » ─────────────────────────────────────────────────
def test_maintien_banner_follows_the_window_from_the_theoretical_end(db):
    _emp, site = _setup(db)
    upcoming, opened, closed = _post(db, site, ANCHOR, "14:10"), _post(db, site, ANCHOR, "14:35"), _post(db, site, ANCHOR, "14:45:01")
    assert (upcoming["maintien"]["state"], upcoming["maintien"]["opens"], upcoming["maintien"]["closes"]) == ("UPCOMING", "14:30", "14:45")
    assert (upcoming["maintien"]["previous"]["start"], upcoming["maintien"]["previous"]["end"]) == ("06:00", "14:00")
    assert opened["maintien"]["state"] == "OPEN" and opened["maintien"]["closes_at"] == _iso(ANCHOR, "14:45")
    assert closed["maintien"] is None and _post(db, site, ANCHOR, "13:59")["maintien"] is None


def test_todo_lists_unclosed_shift_and_manual_entry_required(db):
    emp, site = _setup(db, group="A")
    late = _colleague(db, site, "A")
    _scan(db, emp, ANCHOR, "05:50")                                   # jamais de sortie
    _scan(db, late, ANCHOR, "05:55")
    _scan(db, late, ANCHOR, "14:02")
    with pytest.raises(HTTPException):
        _scan(db, late, ANCHOR, "14:50")                              # fenêtre terminée
    live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, "14:52"))
    post = _post(db, site, ANCHOR, "14:52", manual_entry=True)
    by_code = {item["code"]: item for item in post["todo"]}
    assert set(by_code) == {"VACATION_NON_CLOTUREE", "MANUAL_ENTRY_REQUIRED"} and post["kpi"]["anomalies"] == 2
    unclosed = by_code["VACATION_NON_CLOTUREE"]
    assert (unclosed["employee"]["matricule"], unclosed["scheduled_end"], unclosed["overdue_since"], unclosed["action"]) == (emp.code, "14:00", "14:45", None)
    manual = by_code["MANUAL_ENTRY_REQUIRED"]
    assert (manual["label"], manual["employee"]["matricule"], manual["overdue_since"], manual["action"]) == (
        "Saisie manuelle requise", late.code, "14:45", "MANUAL_ENTRY")
    assert post["permissions"] == {"manual_entry": True}
    without = _post(db, site, ANCHOR, "14:52")                        # sans permission : aucune action proposée
    assert next(i for i in without["todo"] if i["code"] == "MANUAL_ENTRY_REQUIRED")["action"] is None and without["permissions"] == {"manual_entry": False}
    # Une fois l'entrée saisie par le pointeur, la demande disparaît.
    core.record_scan(db, employee=late, source="MANUAL", actor=POINTER, idempotency_key=f"manual-{_tag()}", now=_ts(ANCHOR, "14:55"),
                     observation="Maintien demandé", manual_entry_allowed=True)
    assert "MANUAL_ENTRY_REQUIRED" not in {item["code"] for item in _post(db, site, ANCHOR, "14:56", manual_entry=True)["todo"]}


# ── API : flux live, contexte de saisie manuelle, intention explicite ────────────────────
def test_live_route_carries_the_post_for_one_site(client, db, auth_headers, restricted_headers, monkeypatch):
    emp, site = _setup(db)
    _scan(db, emp, ANCHOR, "13:40")
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "15:00"))
    body = client.get(f"/api/portal/attendance-live?site_id={site.id}", headers=auth_headers).json()
    post = body["post"]
    assert (post["current"]["shift_label"], post["current"]["group"], post["kpi"]["present"], post["permissions"]["manual_entry"]) == ("Après-midi", "B", 1, True)
    assert (body["timezone"], body["operational_date"], body["server_time"]) == ("Africa/Algiers", ANCHOR.isoformat(), "15:00:00")
    limited = client.get(f"/api/portal/attendance-live?site_id={site.id}", headers=restricted_headers).json()
    assert limited["post"]["permissions"] == {"manual_entry": False}


def test_manual_context_and_explicit_extra_shift_intent(client, db, auth_headers, monkeypatch):
    emp, site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "05:50")
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "14:36"))
    url = f"/api/portal/attendance-manual/context?employee_id={emp.id}&site_id={site.id}"
    opened = client.get(url, headers=auth_headers).json()
    assert opened["extra_shift"]["entry_status"] == "PREVIOUS_SHIFT_NOT_CLOSED" and opened["intent"] == "EXTRA_SHIFT_ENTRY" and opened["audited"] is True
    assert opened["extra_shift"]["previous"]["actual_exit"] is None

    # Entrée explicite alors que la première vacation est ouverte : refus motivé, jamais une sortie devinée.
    payload = {"employee_id": emp.id, "site_id": site.id, "action": "present", "observation": "Maintien", "intent": "EXTRA_SHIFT_ENTRY"}
    refused = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json=payload)
    assert refused.status_code == 409 and refused.headers["X-Attendance-Code"] == "PREVIOUS_SHIFT_NOT_CLOSED"
    detail = json.loads(refused.headers["X-Attendance-Refusal"])
    assert (detail["code"], detail["recorded"], detail["previous"]["scheduled_end"]) == ("PREVIOUS_SHIFT_NOT_CLOSED", False, _iso(ANCHOR, "14:00"))
    assert isinstance(refused.json()["detail"], str)                  # le texte historique reste une chaîne

    # Sans intention, le même pointage EST la sortie ; puis l'entrée explicite ouvre le maintien.
    closing = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={**payload, "intent": None})
    assert closing.status_code == 201 and closing.json()["action"] == "depart"
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "14:43"))
    ready = client.get(url, headers=auth_headers).json()
    extra = ready["extra_shift"]
    assert (extra["entry_status"], extra["shift_label"], extra["window_opens_at"], extra["window_closes_at"]) == (
        "EXTRA_IN_WINDOW", "Après-midi", _iso(ANCHOR, "14:30"), _iso(ANCHOR, "14:45"))
    assert (extra["previous"]["actual_exit"], ready["reason_required"], ready["manual_entry_allowed"]) == (_iso(ANCHOR, "14:36"), False, True)
    done = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json=payload)
    assert done.status_code == 201 and done.json()["counted"]["kind"] == "EXTRA_SHIFT"
    monkeypatch.setattr(core, "_now_local", lambda: _ts(NEXT, "09:00"))
    assert client.get(url, headers=auth_headers).json()["extra_shift"] is None        # hors créneau : aucun contexte inventé


def test_manual_context_after_the_window_requires_a_reason(client, db, auth_headers, restricted_headers, monkeypatch):
    # Le contexte teste la permission fine sur un compte autorisé au module.
    from app.modules.auth.models import User
    scanner = db.scalar(select(User).where(User.username == "testops"))
    previous_modules = scanner.authorized_modules
    scanner.authorized_modules = [*previous_modules, "pointage"]
    db.commit()
    emp, site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "05:50")
    _scan(db, emp, ANCHOR, "14:03")
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "15:10"))
    url = f"/api/portal/attendance-manual/context?employee_id={emp.id}&site_id={site.id}"
    allowed = client.get(url, headers=auth_headers).json()
    assert (allowed["extra_shift"]["entry_status"], allowed["reason_required"]) == ("EXTRA_MANUAL", True)
    denied = client.get(url, headers=restricted_headers).json()
    scanner.authorized_modules = previous_modules
    db.commit()
    assert (denied["extra_shift"]["entry_status"], denied["manual_entry_allowed"], denied["reason_required"]) == ("MANUAL_ENTRY_REQUIRED", False, False)
    assert client.get(url).status_code in (401, 403)
