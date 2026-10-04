"""Lot 3 : refus tracés (toutes sources), anomalie VACATION_NON_CLOTUREE idempotente, alertes
dans le flux live du Pointeur, temps opérationnel unique (Africa/Algiers)."""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.modules.attendance import core, counted, live, official, recap
from app.modules.attendance.models import AttendanceAnomaly
from app.modules.auth.models import AuditEvent
from app.modules.ops.models import DailyPresence
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_attendance_counted_time import ANCHOR, NEXT, _events, _iso, _scan, _setup, _tag, _ts

ACTOR = SimpleNamespace(id=None, username="POSTE")


def _unclosed(db, emp):
    return db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == emp.id,
                                                      AttendanceAnomaly.anomaly_type == "VACATION_NON_CLOTUREE")).scalars().all()


# ── Refus : audités, sans mouvement, quelle que soit la source ───────────────────────────
@pytest.mark.parametrize("source, extra", [
    ("QR", None), ("FACIAL", {"camera": "Caméra entrée"}), ("MANUAL", None),
    ("QR", {"terminal": "trm-1", "terminal_name": "BORNE HALL"}),
])
def test_refusal_is_audited_for_every_source_without_any_presence(db, source, extra):
    emp, site = _setup(db, group="A")                                 # Matin 06:00 → 14:00
    _scan(db, emp, ANCHOR, "05:45")
    _scan(db, emp, ANCHOR, "14:04")
    presence_before = db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalar_one().data
    with pytest.raises(HTTPException) as refused:
        core.record_scan(db, employee=emp, source=source, actor=ACTOR, idempotency_key=f"k-{_tag()}", now=_ts(ANCHOR, "14:10"), extra=extra)
    assert refused.value.headers["X-Attendance-Code"] == "EXTRA_BEFORE_WINDOW"
    assert len(_events(db, emp)) == 2                                 # aucun mouvement de présence créé
    assert db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalar_one().data == presence_before
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.extra_before_window",
                                                AuditEvent.resource_id == str(emp.id)).order_by(AuditEvent.id.desc())).scalars().first()
    state = json.loads(audit.new_state)
    assert (audit.result, audit.username, audit.society) == ("refused", "POSTE", emp.society)
    assert (state["employee_id"], state["matricule"], state["society"], state["site_id"], state["source"]) == (
        emp.id, emp.code, emp.society, site.id, source)
    assert (state["actual_entry"], state["last_entry"], state["last_exit"]) == (_iso(ANCHOR, "14:10"), _iso(ANCHOR, "05:45"), _iso(ANCHOR, "14:04"))
    assert state["message"] == refused.value.detail and state["kind"] == "EXTRA_SHIFT" and state["previous"]["shift"] == "MATIN"
    assert state["terminal"] == ((extra or {}).get("terminal_name") or (extra or {}).get("camera"))


def test_refusal_reaches_the_live_feed_with_its_real_reason(db):
    emp, site = _setup(db)
    cursor = live.live(db, {site.id}, after_id=0, after_refusal_id=0, now=_ts(ANCHOR, "13:00"))["latest_refusal_id"]
    with pytest.raises(HTTPException) as refused:
        _scan(db, emp, ANCHOR, "13:29:59")
    feed = live.live(db, {site.id}, after_id=0, after_refusal_id=cursor, now=core._now_local())
    assert feed["latest_refusal_id"] > cursor
    row = feed["refusals"][-1]
    assert (row["code"], row["label"], row["message"], row["recorded"]) == (
        "EARLY_OUTSIDE_WINDOW", "Arrivée avant l'ouverture de la fenêtre", refused.value.detail, False)
    assert row["employee"]["matricule"] == emp.code and row["counted"]["window_opens_at"] == _iso(ANCHOR, "13:30")
    assert set(live.ALERT_LABELS) >= {"VACATION_NON_CLOTUREE", "EARLY_OUTSIDE_WINDOW", "EXTRA_BEFORE_WINDOW", "PREVIOUS_SHIFT_NOT_CLOSED",
                                      "MANUAL_ENTRY_REQUIRED", "EXTRA_SHIFT", "MANUAL_POINTAGE"}
    assert live.live(db, {site.id + 999}, after_id=0, after_refusal_id=cursor, now=core._now_local())["refusals"] == []


# ── Vacation non clôturée : une anomalie par entrée, jamais dupliquée ────────────────────
def test_unclosed_shift_raises_one_anomaly_whatever_the_number_of_refreshes(db):
    emp, site = _setup(db)                                            # Après-midi 14:00 → 22:00
    _scan(db, emp, ANCHOR, "13:50")
    assert live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, "22:45"))["alerts"] == []
    assert _unclosed(db, emp) == []                                   # grâce de relève non dépassée
    for second in range(5):                                           # rafraîchissements successifs du poste
        feed = live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, f"22:45:0{second + 1}"))
    rows = _unclosed(db, emp)
    assert len(rows) == 1 and rows[0].status == "OPEN" and rows[0].event_id == _events(db, emp)[0].id
    assert (rows[0].presence_date, rows[0].details["shift"], rows[0].details["scheduled_end"]) == (ANCHOR, "APRES_MIDI", _iso(ANCHOR, "22:00"))
    alert = next(a for a in feed["alerts"] if a["code"] == "VACATION_NON_CLOTUREE")
    assert (alert["label"], alert["employee"]["matricule"], alert["id"]) == ("Vacation non clôturée", emp.code, rows[0].id)

    # La sortie clôt l'anomalie : résolue, conservée dans l'historique, jamais recréée.
    _scan(db, emp, ANCHOR, "22:50")
    live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, "22:51"))
    rows = _unclosed(db, emp)
    assert len(rows) == 1 and (rows[0].status, rows[0].resolved_by, rows[0].resolution) == ("RESOLVED", "system", "Sortie enregistrée à 22:50:00")
    assert not any(a["code"] == "VACATION_NON_CLOTUREE" for a in live.alerts(db, {site.id}, _ts(ANCHOR, "22:51")))


def test_resolved_unclosed_anomaly_stays_in_history_and_is_not_recreated(client, db, auth_headers):
    emp, site = _setup(db)
    _scan(db, emp, ANCHOR, "13:50")
    live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, "22:46"))
    anomaly = _unclosed(db, emp)[0]
    done = client.patch(f"/api/attendance/anomalies/{anomaly.id}", headers=auth_headers,
                        json={"status": "RESOLVED", "resolution": "Sortie non pointée, départ confirmé par le chef de poste"})
    assert done.status_code == 200, done.text
    for minute in (47, 48, 49):
        live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, f"22:{minute}"))
    rows = _unclosed(db, emp)
    assert len(rows) == 1 and rows[0].status == "RESOLVED" and rows[0].resolution.startswith("Sortie non pointée")


def test_relief_grace_of_45_minutes_before_the_unclosed_shift_anomaly(db):
    """Vacation 06:00 → 14:00 : aucune anomalie jusqu'à 14:45:00 inclus, une seule à partir de
    14:45:01, résolue automatiquement par la sortie et conservée dans l'historique."""
    assert settings.attendance_unclosed_shift_grace_minutes == 45
    emp, site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "05:50")
    for hms in ("14:00:01", "14:29:59", "14:30:00", "14:45:00"):
        live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, hms))
        assert _unclosed(db, emp) == [], hms
    for hms in ("14:45:01", "14:45:03", "14:46:00", "14:49:00"):       # plusieurs rafraîchissements
        feed = live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, hms))
        assert len(_unclosed(db, emp)) == 1, hms
    assert [a["code"] for a in feed["alerts"]] == ["VACATION_NON_CLOTUREE"] and _unclosed(db, emp)[0].status == "OPEN"
    out = _scan(db, emp, ANCHOR, "14:50")                             # sortie valide : résolution automatique
    assert (out["action"], out["counted"]["counted_end"], out["counted"]["counted_minutes"]) == ("depart", _iso(ANCHOR, "14:00"), 480)
    live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, "14:55"))
    rows = _unclosed(db, emp)
    assert len(rows) == 1 and (rows[0].status, rows[0].resolved_by, rows[0].resolution) == ("RESOLVED", "system", "Sortie enregistrée à 14:50:00")
    summary = recap.monthly(db, emp, "2026-10")
    assert (summary["summary"]["relief_anomalies"], summary["summary"]["relief_anomalies_resolved"], summary["summary"]["anomalies_open"]) == (1, 1, 0)
    assert [(a["type"], a["status"]) for a in summary["anomalies"]] == [("VACATION_NON_CLOTUREE", "RESOLVED")]
    assert summary["summary"]["refused_attempts"] == 0


def test_unclosed_grace_is_a_setting(db, monkeypatch):
    monkeypatch.setattr(settings, "attendance_unclosed_shift_grace_minutes", 0)
    emp, site = _setup(db)
    _scan(db, emp, ANCHOR, "13:50")
    assert counted.detect_unclosed(db, {site.id}, _ts(ANCHOR, "22:00")) == 0
    assert counted.detect_unclosed(db, {site.id}, _ts(ANCHOR, "22:00:01")) == 1
    assert counted.detect_unclosed(db, {site.id}, _ts(ANCHOR, "22:50")) == 0


def test_normal_and_legacy_assignments_never_get_an_unclosed_shift_anomaly(db):
    emp, site = _setup(db, regime=None, rotation_system="3x8")
    _scan(db, emp, ANCHOR, "13:50")
    assert counted.detect_unclosed(db, {site.id}, _ts(NEXT, "08:00")) == 0 and _unclosed(db, emp) == []


# ── Alertes live : maintien et pointage manuel ───────────────────────────────────────────
def test_extra_shift_and_manual_entry_are_live_alerts(db):
    emp, site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "05:45")
    _scan(db, emp, ANCHOR, "14:04")
    core.record_scan(db, employee=emp, source="MANUAL", actor=ACTOR, idempotency_key=f"manual-{_tag()}", now=_ts(ANCHOR, "15:10"),
                     observation="Maintien demandé", manual_entry_allowed=True)
    codes = [a["code"] for a in live.alerts(db, {site.id}, core._now_local())]
    assert sorted(codes) == ["EXTRA_SHIFT", "MANUAL_POINTAGE"]
    extra = db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == emp.id,
                                                       AttendanceAnomaly.anomaly_type == "EXTRA_SHIFT")).scalar_one()
    assert (extra.severity, extra.details["entry_status"], extra.details["previous"]["shift"]) == ("info", "EXTRA_MANUAL", "MATIN")
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.event", AuditEvent.resource_id == str(extra.event_id)).order_by(AuditEvent.id.desc())).scalars().first()
    assert json.loads(audit.new_state)["shift_kind"] == "EXTRA_SHIFT"


# ── Temps opérationnel : Africa/Algiers, jamais UTC ni le fuseau du poste ────────────────
@pytest.mark.parametrize("utc, local_date, local_time", [
    (datetime(2026, 10, 4, 22, 59, tzinfo=timezone.utc), "2026-10-04", "23:59:00"),
    (datetime(2026, 10, 4, 23, 0, tzinfo=timezone.utc), "2026-10-05", "00:00:00"),
    (datetime(2026, 10, 5, 4, 59, tzinfo=timezone.utc), "2026-10-05", "05:59:00"),
    (datetime(2026, 10, 5, 5, 0, tzinfo=timezone.utc), "2026-10-05", "06:00:00"),
])
def test_operational_clock_is_africa_algiers(utc, local_date, local_time):
    clock = core.operational_clock(utc)
    assert (clock["timezone"], clock["operational_date"], clock["server_time"], clock["utc_offset_minutes"]) == (
        "Africa/Algiers", local_date, local_time, 60)
    assert clock["server_now"] == f"{local_date}T{local_time}+01:00"
    assert datetime.fromisoformat(clock["server_now"]) == utc


def test_live_feed_carries_the_operational_clock(db):
    emp, site = _setup(db)
    _scan(db, emp, ANCHOR, "14:00")
    feed = live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=datetime(2026, 10, 1, 13, 5, tzinfo=timezone.utc))
    assert (feed["timezone"], feed["operational_date"], feed["server_time"]) == ("Africa/Algiers", ANCHOR.isoformat(), "14:05:00")
    # Mouvements et horloge partagent la même source : jamais un passage « dans le futur ».
    assert feed["events"][-1]["heure"] == "14:00:00" <= feed["server_time"] and feed["events"][-1]["date"] == feed["operational_date"]


# ── Nuit 22:00 → 06:00 : une seule vacation à travers minuit ─────────────────────────────
def test_night_shift_state_does_not_reset_at_midnight(db):
    emp, site = _setup(db, group="C")
    _scan(db, emp, ANCHOR, "21:40")
    plan = official.official_shift(db, employee_id=emp.id, site_id=site.id, at=_ts(NEXT, "01:00"))
    assert (plan["shift"], plan["work_date"], plan["in_progress"], plan["scheduled_start"]) == ("NUIT", ANCHOR, True, _ts(ANCHOR, "22:00"))
    for day, hhmm in ((ANCHOR, "23:59"), (NEXT, "00:00"), (NEXT, "01:00"), (NEXT, "05:59")):
        feed = live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(day, hhmm))
        assert feed["summary"]["present_now"] == 1 and feed["alerts"] == [], (day, hhmm)
    feed = live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(NEXT, "06:45:01"))
    alert = feed["alerts"][0]
    assert (alert["code"], alert["presence_date"], feed["operational_date"]) == ("VACATION_NON_CLOTUREE", ANCHOR.isoformat(), NEXT.isoformat())
    out = _scan(db, emp, NEXT, "06:11")
    assert (out["action"], out["counted"]["counted_minutes"], out["counted"]["work_date"]) == ("depart", 480, ANCHOR.isoformat())
