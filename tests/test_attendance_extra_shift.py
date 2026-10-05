"""Vacation supplémentaire / maintien du travail posté (lot 2) : deux vacations distinctes,
fenêtre de nouvelle entrée TFIN+30 → TFIN+45 comptée depuis la fin THÉORIQUE, saisie manuelle
sous permission après TFIN+45."""
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.attendance import core, counted, official
from app.modules.auth.models import AuditEvent
from app.modules.ops.models import DailyPresence
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_attendance_counted_time import ANCHOR, NEXT, PLAN, _anomalies, _events, _iso, _scan, _setup, _tag, _ts

POINTER = SimpleNamespace(id=None, username="POINTEUR")


def _manual(db, emp, day, hms, *, allowed, observation="Maintien demandé par le chef de poste", intent=None):
    return core.record_scan(db, employee=emp, source="MANUAL", actor=POINTER, idempotency_key=f"manual-{_tag()}", now=_ts(day, hms),
                            observation=observation, manual_entry_allowed=allowed, intent=intent)


def _refusal(db, emp, call):
    before = len(_events(db, emp))
    with pytest.raises(HTTPException) as refused:
        call()
    assert len(_events(db, emp)) == before                            # aucun mouvement de présence
    return refused.value


def _morning_done(db, exit_="14:04"):
    emp, site = _setup(db, group="A")                                 # Matin 06:00 → 14:00
    _scan(db, emp, ANCHOR, "05:45")
    assert _scan(db, emp, ANCHOR, exit_)["action"] == "depart"
    return emp, site


# ── Règle pure : bornes comptées depuis TFIN ─────────────────────────────────────────────
CLOSED = counted.close(counted.classify_entry(PLAN, _ts(ANCHOR, "14:00")), _ts(ANCHOR, "22:04"))


@pytest.mark.parametrize("at, status", [
    ("22:00:00", "EXTRA_BEFORE_WINDOW"), ("22:29:59", "EXTRA_BEFORE_WINDOW"),
    ("22:30:00", "EXTRA_IN_WINDOW"), ("22:45:00", "EXTRA_IN_WINDOW"),
    ("22:45:01", "MANUAL_ENTRY_REQUIRED"),
])
def test_extra_entry_boundaries(at, status):
    out = counted.extra_entry(CLOSED, _ts(ANCHOR, at))
    assert (out["kind"], out["entry_status"]) == ("EXTRA_SHIFT", status)
    # Fenêtre depuis TFIN (22:00), jamais depuis la sortie réelle (22:04).
    assert (out["window_opens_at"], out["window_closes_at"]) == (_iso(ANCHOR, "22:30"), _iso(ANCHOR, "22:45"))
    assert (out["shift"], out["scheduled_start"], out["scheduled_end"], out["normal_minutes"]) == (
        "NUIT", _iso(ANCHOR, "22:00"), _iso(NEXT, "06:00"), 480)
    assert out["counted_start"] == (_iso(ANCHOR, at) if status == "EXTRA_IN_WINDOW" else None)


def test_extra_entry_requires_a_closed_previous_shift_and_permission_for_manual():
    opened = counted.classify_entry(PLAN, _ts(ANCHOR, "14:00"))
    assert counted.extra_entry(opened, _ts(ANCHOR, "22:35"))["entry_status"] == "PREVIOUS_SHIFT_NOT_CLOSED"
    assert counted.extra_entry(CLOSED, _ts(ANCHOR, "23:10"), manual_allowed=True)["entry_status"] == "EXTRA_MANUAL"
    assert counted.in_extra_slot(CLOSED, _ts(ANCHOR, "22:00")) and not counted.in_extra_slot(CLOSED, _ts(NEXT, "06:00"))
    assert not counted.in_extra_slot(CLOSED, _ts(ANCHOR, "21:59"))


# ── Bornes à travers Attendance Core ─────────────────────────────────────────────────────
def test_new_entry_before_t_plus_30_is_refused(db):
    emp, _site = _morning_done(db)
    refused = _refusal(db, emp, lambda: _scan(db, emp, ANCHOR, "14:29:59"))
    assert refused.status_code == 409 and refused.headers["X-Attendance-Code"] == "EXTRA_BEFORE_WINDOW"
    assert "14:30" in refused.detail and "14:45" in refused.detail
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.extra_before_window",
                                                AuditEvent.resource_id == str(emp.id)).order_by(AuditEvent.id.desc())).scalars().first()
    state = json.loads(audit.new_state)
    assert audit.result == "refused" and state["recorded"] is False and state["previous"]["actual_exit"] == _iso(ANCHOR, "14:04")


def test_new_entry_at_t_plus_30_opens_a_distinct_extra_shift(db):
    emp, _site = _morning_done(db)
    out = _scan(db, emp, ANCHOR, "14:30:00")
    extra = out["counted"]
    assert (out["action"], out["cycle"]) == ("arrivee", 2)
    assert (extra["kind"], extra["kind_label"], extra["entry_status"]) == ("EXTRA_SHIFT", "Vacation supplémentaire (maintien)", "EXTRA_IN_WINDOW")
    assert (extra["shift"], extra["scheduled_start"], extra["scheduled_end"], extra["normal_minutes"]) == (
        "APRES_MIDI", _iso(ANCHOR, "14:00"), _iso(ANCHOR, "22:00"), 480)
    # La sortie réelle (14:04) ne décale pas la fenêtre : 14:30 → 14:45, pas 14:34 → 14:49.
    assert (extra["window_opens_at"], extra["window_closes_at"]) == (_iso(ANCHOR, "14:30"), _iso(ANCHOR, "14:45"))
    assert (extra["previous"]["shift"], extra["previous"]["actual_exit"], extra["previous"]["counted_minutes"]) == ("MATIN", _iso(ANCHOR, "14:04"), 480)
    closing = _scan(db, emp, ANCHOR, "22:10")
    assert (closing["action"], closing["counted"]["counted_end"], closing["counted"]["counted_minutes"]) == ("depart", _iso(ANCHOR, "22:00"), 450)
    assert closing["overtime_minutes"] == 0 and _anomalies(db, emp) == ["EXTRA_SHIFT"]   # maintien signalé ; ni retard ni dépassement inventé
    # Deux vacations distinctes : quatre mouvements, jamais une présence de 16 h.
    events = _events(db, emp)
    assert [(e.event_type, e.cycle, e.data["counted"]["kind"]) for e in events] == [
        ("ARRIVAL", 1, "NORMAL"), ("DEPARTURE", 1, "NORMAL"), ("ARRIVAL", 2, "EXTRA_SHIFT"), ("DEPARTURE", 2, "EXTRA_SHIFT")]
    assert events[2].data["counted"]["previous"]["event_id"] == events[1].id
    legacy = db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalar_one().data["_legacy"]
    assert (legacy["counted"]["counted_minutes"], legacy["countedExtra"]["counted_minutes"]) == (480, 450)


def test_t_plus_45_is_accepted_and_one_second_later_requires_manual_entry(db):
    emp, _site = _morning_done(db)
    refused = _refusal(db, emp, lambda: _scan(db, emp, ANCHOR, "14:45:01"))
    assert refused.status_code == 409 and refused.headers["X-Attendance-Code"] == "MANUAL_ENTRY_REQUIRED" and "14:45" in refused.detail
    other, _site = _morning_done(db)
    assert _scan(db, other, ANCHOR, "14:45:00")["counted"]["entry_status"] == "EXTRA_IN_WINDOW"


def test_window_ignores_the_actual_exit_time(db):
    emp, _site = _morning_done(db, exit_="14:20")
    assert _refusal(db, emp, lambda: _scan(db, emp, ANCHOR, "14:29")).headers["X-Attendance-Code"] == "EXTRA_BEFORE_WINDOW"
    assert _scan(db, emp, ANCHOR, "14:31")["counted"]["window_closes_at"] == _iso(ANCHOR, "14:45")


def test_late_first_shift_is_not_blocked_by_the_historical_arrival_delay(db):
    emp, _site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "06:50")
    _scan(db, emp, ANCHOR, "14:01")
    assert _scan(db, emp, ANCHOR, "14:30")["counted"]["kind"] == "EXTRA_SHIFT"     # 7 h 40 après l'arrivée


# ── Vacation précédente non clôturée ─────────────────────────────────────────────────────
def test_previous_shift_not_closed_refuses_an_explicit_new_entry(db):
    emp, _site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "05:45")
    refused = _refusal(db, emp, lambda: _manual(db, emp, ANCHOR, "14:35", allowed=True, intent=counted.INTENT_EXTRA_ENTRY))
    assert refused.status_code == 409 and refused.headers["X-Attendance-Code"] == "PREVIOUS_SHIFT_NOT_CLOSED"
    # Sans entrée explicite, le pointage suivant EST la sortie de la première vacation…
    exit_ = _scan(db, emp, ANCHOR, "14:36")
    assert (exit_["action"], exit_["counted"]["kind"], exit_["counted"]["counted_end"]) == ("depart", "NORMAL", _iso(ANCHOR, "14:00"))
    # …puis la nouvelle entrée, dans la fenêtre, ouvre la vacation supplémentaire.
    assert _scan(db, emp, ANCHOR, "14:42")["counted"]["entry_status"] == "EXTRA_IN_WINDOW"


# ── Nuit et minuit ───────────────────────────────────────────────────────────────────────
def test_extra_shift_after_a_night_shift(db):
    emp, _site = _setup(db, group="C")                                # Nuit 22:00 → 06:00
    _scan(db, emp, ANCHOR, "21:40")
    _scan(db, emp, NEXT, "06:02")
    assert _refusal(db, emp, lambda: _scan(db, emp, NEXT, "06:29:59")).headers["X-Attendance-Code"] == "EXTRA_BEFORE_WINDOW"
    extra = _scan(db, emp, NEXT, "06:30")["counted"]
    assert (extra["shift"], extra["scheduled_start"], extra["scheduled_end"]) == ("MATIN", _iso(NEXT, "06:00"), _iso(NEXT, "14:00"))
    assert _scan(db, emp, NEXT, "14:00")["counted"]["counted_minutes"] == 450


def test_extra_night_shift_crosses_midnight(db):
    emp, _site = _setup(db, group="B")                                # Après-midi 14:00 → 22:00
    _scan(db, emp, ANCHOR, "13:50")
    _scan(db, emp, ANCHOR, "22:05")
    extra = _scan(db, emp, ANCHOR, "22:40")["counted"]
    assert (extra["shift"], extra["scheduled_end"]) == ("NUIT", _iso(NEXT, "06:00"))
    closing = _scan(db, emp, NEXT, "06:10")
    assert (closing["counted"]["counted_end"], closing["counted"]["counted_minutes"]) == (_iso(NEXT, "06:00"), 440)
    assert {e.presence_date for e in _events(db, emp)} == {ANCHOR}
    late, _site = _setup(db, group="B")
    _scan(db, late, ANCHOR, "13:50")
    _scan(db, late, ANCHOR, "22:05")
    assert _refusal(db, late, lambda: _scan(db, late, ANCHOR, "22:46")).headers["X-Attendance-Code"] == "MANUAL_ENTRY_REQUIRED"


# ── Saisie manuelle après TFIN+45 ────────────────────────────────────────────────────────
def test_manual_entry_after_window_needs_the_permission_and_a_reason(db):
    emp, site = _morning_done(db)
    denied = _refusal(db, emp, lambda: _manual(db, emp, ANCHOR, "15:10", allowed=False))
    assert denied.status_code == 403 and denied.headers["X-Attendance-Code"] == "MANUAL_ENTRY_REQUIRED"
    assert _refusal(db, emp, lambda: _manual(db, emp, ANCHOR, "15:10", allowed=True, observation="")).status_code == 422
    out = _manual(db, emp, ANCHOR, "15:10", allowed=True)
    assert (out["counted"]["kind"], out["counted"]["entry_status"], out["counted"]["counted_start"]) == ("EXTRA_SHIFT", "EXTRA_MANUAL", _iso(ANCHOR, "15:10"))
    event = _events(db, emp)[-1]
    assert (event.source, event.actor_label, event.site_id, event.society, event.observation) == (
        "MANUAL", "POINTEUR", site.id, emp.society, "Maintien demandé par le chef de poste")
    assert core.to_local(event.occurred_at) == _ts(ANCHOR, "15:10")
    assert (event.data["counted"]["previous"]["shift"], event.data["counted"]["shift"]) == ("MATIN", "APRES_MIDI")


def test_manual_entry_does_not_bypass_the_forbidden_half_hour(db):
    emp, _site = _morning_done(db)
    assert _refusal(db, emp, lambda: _manual(db, emp, ANCHOR, "14:15", allowed=True)).headers["X-Attendance-Code"] == "EXTRA_BEFORE_WINDOW"


def test_manual_route_checks_the_manual_entry_permission(client, db, auth_headers, restricted_headers, monkeypatch):
    # Tester la permission fine APRÈS la barrière module, sans accès global.
    from app.modules.auth.models import User
    scanner = db.scalar(select(User).where(User.username == "testops"))
    previous_modules = scanner.authorized_modules
    scanner.authorized_modules = [*previous_modules, "pointage"]
    db.commit()
    emp, site = _morning_done(db)
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "15:10"))
    payload = {"employee_id": emp.id, "site_id": site.id, "action": "present", "observation": "Maintien demandé"}
    denied = client.post("/api/portal/attendance-manual/scan", headers=restricted_headers, json=payload)
    scanner.authorized_modules = previous_modules
    db.commit()
    assert denied.status_code == 403 and denied.headers["X-Attendance-Code"] == "MANUAL_ENTRY_REQUIRED", denied.text
    granted = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json=payload)
    assert granted.status_code == 201, granted.text
    assert granted.json()["counted"]["entry_status"] == "EXTRA_MANUAL"
    assert _events(db, emp)[-1].actor_user_id is not None


# ── Hors travail posté : rien ne change ──────────────────────────────────────────────────
@pytest.mark.parametrize("regime", [official.REGIME_NORMAL, None])
def test_normal_and_legacy_keep_the_historical_rules(db, regime):
    emp, _site = _setup(db, regime=regime, group="A", rotation_system="3x8")
    _scan(db, emp, ANCHOR, "06:50")
    _scan(db, emp, ANCHOR, "14:02")
    with pytest.raises(HTTPException) as refused:                     # délai historique entre deux arrivées
        _scan(db, emp, ANCHOR, "14:35")
    assert refused.value.status_code == 409 and not refused.value.headers and "Nouvelle arrivée disponible" in refused.value.detail
    out = _scan(db, emp, ANCHOR, "14:55")                             # 8 h 05 après l'arrivée : acceptée comme avant
    assert (out["action"], out["cycle"]) == ("arrivee", 2) and "counted" not in out
    assert all("counted" not in e.data for e in _events(db, emp))
