"""Temps réel / temps comptabilisé du travail posté (lot 1) : fenêtre d'arrivée T-30, bornage
de la vacation officielle, plafond 480 min, aucun OVERTIME sur la présence physique brute."""
import json
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.attendance import core, counted, live, official
from app.modules.attendance.models import AttendanceAnomaly, AttendanceEvent
from app.modules.auth.models import AuditEvent
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site, SiteRotation
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

TZ = ZoneInfo("Africa/Algiers")
SOC = "Iron Global Securite"
ANCHOR = date(2026, 10, 1)                       # J1 du groupe A : B = Après-midi, C = Nuit, D = OFF
NEXT = ANCHOR + timedelta(days=1)
ACTOR = SimpleNamespace(id=None, username="PTG")


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _ts(day, hms):
    return datetime.combine(day, datetime.strptime(hms if len(hms) == 8 else f"{hms}:00", "%H:%M:%S").time(), TZ)


def _iso(day, hms):
    return _ts(day, hms).isoformat()


def _setup(db, *, regime=official.REGIME_POSTE_CONTINU, group="B", linked=True, rotation_system=None):
    site = Site(name=f"Site compté {_tag()}", active=1, equipment_plan={"societe": SOC}, rotation_system=rotation_system)
    db.add(site); db.flush()
    model = official.ensure_official_model(db)
    if linked:
        db.add(SiteRotation(site_id=site.id, rotation_id=model.id, start_date=ANCHOR, active=1))
    emp = Employee(code=f"CT{_tag()}", first_name="Test", last_name="Compté", society=SOC, status="actif")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=date(2026, 1, 1), active=1, work_regime=regime,
                      rotation_id=model.id if regime == official.REGIME_POSTE_CONTINU else None))
    db.commit()
    return emp, site


def _scan(db, emp, day, hms):
    return core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=f"k-{_tag()}", now=_ts(day, hms))


def _events(db, emp):
    return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id).order_by(AttendanceEvent.id)).scalars().all()


def _anomalies(db, emp):
    return [a.anomaly_type for a in db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == emp.id)
                                               .order_by(AttendanceAnomaly.id)).scalars()]


# ── Règles pures ─────────────────────────────────────────────────────────────────────────
PLAN = {"regime": "POSTE_CONTINU", "group": "B", "shift": "APRES_MIDI", "work_date": ANCHOR, "cycle_day": 3, "model": {"version": 1},
        "scheduled_start": _ts(ANCHOR, "14:00"), "scheduled_end": _ts(ANCHOR, "22:00"), "normal_minutes": 480}


@pytest.mark.parametrize("entry, status, start", [
    ("13:29:59", "EARLY_OUTSIDE_WINDOW", None),
    ("13:30:00", "IN_WINDOW", "14:00:00"),
    ("13:42:00", "IN_WINDOW", "14:00:00"),
    ("14:00:00", "IN_WINDOW", "14:00:00"),
    ("14:07:00", "AFTER_START", "14:07:00"),
])
def test_entry_rule(entry, status, start):
    out = counted.classify_entry(PLAN, _ts(ANCHOR, entry))
    assert out["entry_status"] == status
    assert out["actual_entry"] == _iso(ANCHOR, entry)                 # l'heure réelle n'est jamais remplacée
    assert out["counted_start"] == (_iso(ANCHOR, start) if start else None)
    assert out["window_opens_at"] == _iso(ANCHOR, "13:30") and out["counted_minutes"] is None


@pytest.mark.parametrize("entry, exit_, end, minutes", [
    ("13:30", "22:18", "22:00", 480),                                 # exemple complet 1
    ("14:17", "22:10", "22:00", 463),                                 # exemple complet 2
    ("13:45", "21:40", "21:40", 460),                                 # sortie avant la fin : rien n'est crédité
    ("13:35", "13:50", "13:50", 0),                                   # sortie avant T : jamais de durée négative
])
def test_exit_rule(entry, exit_, end, minutes):
    out = counted.close(counted.classify_entry(PLAN, _ts(ANCHOR, entry)), _ts(ANCHOR, exit_))
    assert (out["actual_entry"], out["actual_exit"]) == (_iso(ANCHOR, entry), _iso(ANCHOR, exit_))
    assert (out["counted_end"], out["counted_minutes"]) == (_iso(ANCHOR, end), minutes)


def test_counted_minutes_never_exceed_the_normal_shift():
    snapshot = {**counted.classify_entry(PLAN, _ts(ANCHOR, "14:00")), "scheduled_end": _iso(NEXT, "02:00")}
    assert counted.close(snapshot, _ts(NEXT, "03:00"))["counted_minutes"] == 480
    assert counted.close(None, _ts(ANCHOR, "22:00")) is None and counted.close({"counted_start": None}, _ts(ANCHOR, "22:00")) is None


# ── A : entrée 13:30, sortie 22:00 ⇒ 480 min ─────────────────────────────────────────────
def test_a_entry_at_t_minus_30_and_exit_at_end_counts_480(db):
    emp, _site = _setup(db)
    arrival = _scan(db, emp, ANCHOR, "13:30")
    assert arrival["action"] == "arrivee" and arrival["heure"] == "13:30:00"
    assert arrival["counted"]["counted_start"] == _iso(ANCHOR, "14:00") and arrival["counted"]["entry_status_label"]
    out = _scan(db, emp, ANCHOR, "22:00")
    assert out["action"] == "depart" and out["counted"]["counted_minutes"] == 480
    assert (out["counted"]["shift"], out["counted"]["shift_label"], out["counted"]["group"]) == ("APRES_MIDI", "Après-midi", "B")
    # Le temps réel reste celui du terminal : événements et journée ne sont pas réécrits.
    first, last = _events(db, emp)
    assert (core.to_local(first.occurred_at), core.to_local(last.occurred_at)) == (_ts(ANCHOR, "13:30"), _ts(ANCHOR, "22:00"))
    presence = db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalar_one()
    assert presence.departure_time == "22:00:00" and presence.data["_legacy"]["scanArrivee"] == "13:30:00"
    assert presence.data["_legacy"]["counted"] == last.data["counted"]


# ── B / C : la fenêtre s'ouvre exactement à T-30 ─────────────────────────────────────────
def test_b_entry_before_t_minus_30_is_refused_without_any_movement(db):
    emp, site = _setup(db)
    with pytest.raises(HTTPException) as refused:
        _scan(db, emp, ANCHOR, "13:29:59")
    assert refused.value.status_code == 409 and refused.value.headers["X-Attendance-Code"] == "EARLY_OUTSIDE_WINDOW"
    assert "13:30" in refused.value.detail and "14:00" in refused.value.detail
    assert _events(db, emp) == [] and _anomalies(db, emp) == []
    assert db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).first() is None
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.early_outside_window",
                                                AuditEvent.resource_id == str(emp.id))).scalar_one()
    state = json.loads(audit.new_state)
    assert audit.result == "refused" and state["recorded"] is False and state["actual_entry"] == _iso(ANCHOR, "13:29:59")
    assert state["window_opens_at"] == _iso(ANCHOR, "13:30")
    # La tentative n'a rien démarré : l'entrée à T-30 reste une première arrivée normale.
    out = _scan(db, emp, ANCHOR, "13:30:00")
    assert (out["action"], out["cycle"], out["counted"]["entry_status"]) == ("arrivee", 1, "IN_WINDOW")
    assert live.summary(db, {site.id}, _ts(ANCHOR, "13:31"))["present_now"] == 1


def test_c_entry_exactly_at_t_minus_30_is_accepted(db):
    emp, _site = _setup(db)
    out = _scan(db, emp, ANCHOR, "13:30:00")
    assert out["success"] and out["action"] == "arrivee" and out["counted"]["entry_status"] == "IN_WINDOW"
    assert out["counted"]["actual_entry"] == _iso(ANCHOR, "13:30")


# ── D / E : début comptabilisé ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("entry, start", [("13:45", "14:00"), ("14:00", "14:00"), ("14:07", "14:07")])
def test_d_e_counted_start(db, entry, start):
    emp, _site = _setup(db)
    snapshot = _scan(db, emp, ANCHOR, entry)["counted"]
    assert (snapshot["actual_entry"], snapshot["counted_start"]) == (_iso(ANCHOR, entry), _iso(ANCHOR, start))
    assert _events(db, emp)[0].data["counted"]["counted_start"] == _iso(ANCHOR, start)


# ── F / G : fin comptabilisée ────────────────────────────────────────────────────────────
@pytest.mark.parametrize("exit_, end, minutes", [("22:23", "22:00", 480), ("21:40", "21:40", 460)])
def test_f_g_counted_end(db, exit_, end, minutes):
    emp, _site = _setup(db)
    _scan(db, emp, ANCHOR, "14:00")
    out = _scan(db, emp, ANCHOR, exit_)
    assert out["departure_time"] == f"{exit_}:00"
    assert (out["counted"]["actual_exit"], out["counted"]["counted_end"], out["counted"]["counted_minutes"]) == (
        _iso(ANCHOR, exit_), _iso(ANCHOR, end), minutes)


def test_complete_example_2_late_entry(db):
    emp, _site = _setup(db)
    _scan(db, emp, ANCHOR, "14:17")
    out = _scan(db, emp, ANCHOR, "22:10")
    assert (out["counted"]["counted_start"], out["counted"]["counted_end"], out["counted"]["counted_minutes"]) == (
        _iso(ANCHOR, "14:17"), _iso(ANCHOR, "22:00"), 463)
    assert out["overtime_minutes"] == 0 and _anomalies(db, emp) == ["LATE"]     # le retard reste constaté comme avant


# ── H : la Nuit traverse minuit ──────────────────────────────────────────────────────────
def test_h_night_shift_is_counted_across_midnight_as_one_shift(db):
    emp, _site = _setup(db, group="C")
    with pytest.raises(HTTPException):
        _scan(db, emp, ANCHOR, "21:29")
    arrival = _scan(db, emp, ANCHOR, "21:42")
    out = _scan(db, emp, NEXT, "06:11")
    assert (arrival["action"], out["action"], out["cycle"]) == ("arrivee", "depart", 1)
    snapshot = out["counted"]
    assert (snapshot["actual_entry"], snapshot["actual_exit"]) == (_iso(ANCHOR, "21:42"), _iso(NEXT, "06:11"))
    assert (snapshot["counted_start"], snapshot["counted_end"], snapshot["counted_minutes"]) == (_iso(ANCHOR, "22:00"), _iso(NEXT, "06:00"), 480)
    assert (snapshot["shift"], snapshot["work_date"]) == ("NUIT", ANCHOR.isoformat())
    assert [e.presence_date for e in _events(db, emp)] == [ANCHOR, ANCHOR]
    assert len(db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalars().all()) == 1
    assert out["overtime_alert"] is False and _anomalies(db, emp) == []


def test_late_entry_after_midnight_belongs_to_the_night_shift_in_progress(db):
    emp, _site = _setup(db, group="C")
    snapshot = _scan(db, emp, NEXT, "00:20")["counted"]
    assert (snapshot["shift"], snapshot["work_date"], snapshot["entry_status"]) == ("NUIT", ANCHOR.isoformat(), "AFTER_START")
    assert snapshot["counted_start"] == _iso(NEXT, "00:20")
    assert _scan(db, emp, NEXT, "06:00")["counted"]["counted_minutes"] == 340


# ── I : présence physique > 8 h à cause des marges ⇒ aucun OVERTIME ──────────────────────
def test_i_margins_never_create_overtime(db):
    emp, _site = _setup(db)
    _scan(db, emp, ANCHOR, "13:30")
    out = _scan(db, emp, ANCHOR, "22:18")
    assert out["duration_minutes"] == 528                             # présence physique réelle, inchangée
    assert out["counted"]["counted_minutes"] == 480 and out["authorized_minutes"] == 480
    assert out["overtime_minutes"] == 0 and out["overtime_alert"] is False
    assert _anomalies(db, emp) == []
    departure = _events(db, emp)[-1]
    assert departure.data["workedMinutes"] == 528 and "overtimeMinutes" not in departure.data and "overtimeAlert" not in departure.data
    row = core.event_to_scan_row(departure)
    assert row["scannedAt"] == _iso(ANCHOR, "22:18") and row["counted"]["counted_end"] == _iso(ANCHOR, "22:00")


def test_frozen_snapshot_survives_a_planning_change(db):
    """La sortie se calcule sur la vacation figée à l'entrée : changer le groupe entre-temps ne
    réécrit ni l'entrée ni la base de calcul."""
    emp, _site = _setup(db)
    _scan(db, emp, ANCHOR, "13:40")
    db.execute(select(Assignment).where(Assignment.employee_id == emp.id)).scalar_one().group_code = "A"
    db.commit()
    out = _scan(db, emp, ANCHOR, "22:05")
    assert (out["counted"]["group"], out["counted"]["shift"], out["counted"]["counted_minutes"]) == ("B", "APRES_MIDI", 480)
    assert _events(db, emp)[0].data["counted"]["counted_end"] is None  # l'événement d'entrée n'est pas modifié


# ── J : POSTE_CONTINU sans ancrage ⇒ comportement lot 0 ──────────────────────────────────
def test_j_unanchored_posted_assignment_keeps_lot_0_behaviour(db):
    emp, _site = _setup(db, linked=False, rotation_system="3x8")
    arrival = _scan(db, emp, ANCHOR, "08:00")                         # aucune fenêtre : rien n'est refusé
    out = _scan(db, emp, ANCHOR, "17:00")
    assert "counted" not in arrival and "counted" not in out
    assert all("counted" not in e.data for e in _events(db, emp))
    assert (out["authorized_minutes"], out["overtime_minutes"]) == (480, 60)     # règle historique du site
    assert _anomalies(db, emp) == ["OVERTIME"]


# ── K / L : NORMAL et NULL legacy ⇒ comportement historique ──────────────────────────────
@pytest.mark.parametrize("regime", [official.REGIME_NORMAL, None])
def test_k_l_normal_and_legacy_are_unchanged(db, regime):
    emp, _site = _setup(db, regime=regime, rotation_system="3x8")
    arrival = _scan(db, emp, ANCHOR, "13:29:59")                      # aucune fenêtre T-30 hors travail posté
    out = _scan(db, emp, ANCHOR, "22:18")
    assert arrival["action"] == "arrivee" and "counted" not in arrival and "counted" not in out
    assert (out["duration_minutes"], out["authorized_minutes"], out["overtime_minutes"], out["overtime_alert"]) == (528, 480, 48, True)
    assert "OVERTIME" in _anomalies(db, emp)
    data = [e.data for e in _events(db, emp)]
    assert all("counted" not in d for d in data) and data[1]["overtimeMinutes"] == 48
    presence = db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalar_one()
    assert "counted" not in presence.data["_legacy"]


# ── OFF et hors vacation : règles existantes, aucune vacation inventée ───────────────────
def test_off_day_scan_keeps_existing_off_schedule_rules(db):
    emp, _site = _setup(db, group="D")
    out = _scan(db, emp, ANCHOR, "08:00")
    assert out["action"] == "arrivee" and "counted" not in out
    assert _anomalies(db, emp) == ["OFF_SCHEDULE"] and "counted" not in _events(db, emp)[0].data


def test_entry_after_the_shift_ended_invents_no_shift(db):
    emp, _site = _setup(db, group="A")                                # Matin 06:00–14:00
    out = _scan(db, emp, ANCHOR, "14:00")
    assert out["action"] == "arrivee" and "counted" not in out


# ── API : projections rétrocompatibles ───────────────────────────────────────────────────
def test_api_projections_expose_real_and_counted_time(client, db, auth_headers):
    emp, site = _setup(db)
    _scan(db, emp, ANCHOR, "13:30")
    _scan(db, emp, ANCHOR, "22:18")
    board = client.get(f"/api/attendance/board?presence_date={ANCHOR}&site_id={site.id}", headers=auth_headers).json()
    row = next(item for item in board["items"] if item["employee_id"] == emp.id)
    assert (row["arrival"], row["departure"]) == ("13:30", "22:18")   # contrat existant : heures réelles
    assert (row["counted"]["counted_start"], row["counted"]["counted_end"], row["counted"]["counted_minutes"]) == (
        _iso(ANCHOR, "14:00"), _iso(ANCHOR, "22:00"), 480)
    assert not any(a["type"] == "OVERTIME" for a in row["anomalies"])

    history = client.get(f"/api/attendance/employees/{emp.id}?days=366", headers=auth_headers).json()
    by_type = {e["type"]: e for e in history["events"] if e["counted"]}
    assert by_type["ARRIVAL"]["counted"]["counted_end"] is None and by_type["DEPARTURE"]["counted"]["counted_minutes"] == 480

    month = client.get(f"/api/attendance/workspace?month=2026-10&site_id={site.id}", headers=auth_headers).json()
    cell = next(item for item in month["items"] if item["employee_id"] == emp.id)["days"][0]
    assert (cell["arrival"], cell["departure"], cell["counted"]["counted_minutes"]) == ("P", "22:18:00", 480)
    assert next(item for item in month["items"] if item["employee_id"] == emp.id)["days"][1]["counted"] is None

    feed = live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, "22:19"))
    last = feed["events"][-1]
    assert (last["heure"], last["counted"]["counted_end"]) == ("22:18:00", _iso(ANCHOR, "22:00"))

    labels = client.get("/api/attendance/work-regimes", headers=auth_headers).json()["time_labels"]
    assert labels["early_window_minutes"] == 30 and labels["counted_start"] and labels["entry_status"]["EARLY_OUTSIDE_WINDOW"]
