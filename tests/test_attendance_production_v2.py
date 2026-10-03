"""Pointage réel V2 — poste de sécurité (pointeur.irongs.com) et règles d'Attendance Core.

Attendance Core reste l'unique autorité (ENTRÉE / SORTIE / doublon / présence) ; la biométrie
dit seulement QUI. Ces tests fixent la règle déterministe existante et la lecture temps réel :
visage resté devant la tablette, changement de terminal, poste de nuit, employé suspendu,
passages acceptés et refus affichés au PC, compteurs canoniques, périmètre."""
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.modules.attendance import core, live
from app.modules.attendance.models import SOURCE_FACIAL, SOURCE_QR, AttendanceEvent
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site
from tests.biometric_fakes import face
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics_terminals import _enrolled, _terminal, burst, facial_on  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"
TZ = core.TZ


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db, rotation=None):
    site = Site(name=f"V2 {_tag()}", active=1, equipment_plan={"societe": SOC}, rotation_system=rotation)
    db.add(site); db.flush()
    return site


def _employee(db, site, status="actif"):
    emp = Employee(code=f"V2{_tag()}", first_name="Adda", last_name=f"Agent{_tag()}", society=SOC, status=status, position="MAGASINIER")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


def _at(day, hh, mm=0, ss=0):
    return datetime(day.year, day.month, day.day, hh, mm, ss, tzinfo=TZ)


def _scan(db, emp, when, key, *, source=SOURCE_FACIAL, device=None):
    return core.record_scan(db, employee=emp, source=source, actor=None, idempotency_key=key, device_id=device, now=when)


def _events(db, emp):
    db.expire_all()
    return [(e.event_type, e.source, e.device_id) for e in db.execute(select(AttendanceEvent).where(
        AttendanceEvent.employee_id == emp.id).order_by(AttendanceEvent.id)).scalars()]


def _pointer(client, db, site_ids):
    name = f"PTG{uuid.uuid4().int % 10**6:06d}"
    db.add(User(username=name, full_name=name, role="ops", access_level="H2", authorized_societies=[], authorized_sites=list(site_ids),
                authorized_structures=["pointage"], authorized_modules=["pointeur"], password_hash=hash_password("pointerpass"), is_active=True))
    db.commit()
    return {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": name, "password": "pointerpass"}).json()["access_token"]}


@pytest.fixture(autouse=True)
def gap(monkeypatch):
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 300)          # valeur de production


# ── § 15–16 : visage resté devant la tablette ─────────────────────────────────────────────
def test_face_held_in_front_of_the_tablet_records_one_entry_only(db):
    site = _site(db); emp = _employee(db, site)
    day = date(2026, 9, 14)
    results = [_scan(db, emp, _at(day, 8, 0, s), f"ch-{s}", device=1) for s in range(0, 4)]           # t = 0, 1, 2, 3 s
    assert [r["duplicate"] for r in results] == [False, True, True, True]
    assert [r["action"] for r in results] == ["arrivee"] * 4
    assert _events(db, emp) == [("ARRIVAL", "FACIAL", 1)]
    # Toujours devant la tablette pendant 4 min 59 s : rien de nouveau.
    for k, seconds in enumerate((30, 120, 299)):
        assert _scan(db, emp, _at(day, 8, 0) + timedelta(seconds=seconds), f"later-{k}", device=1)["duplicate"] is True
    assert len(_events(db, emp)) == 1


# ── § 19–21 : sortie, changement de terminal, jamais ENTRÉE/SORTIE/ENTRÉE/SORTIE ──────────
def test_terminal_change_and_no_entry_exit_loop(db):
    site = _site(db); emp = _employee(db, site)
    day = date(2026, 9, 15)
    assert _scan(db, emp, _at(day, 8, 0), "tab-1", device=1)["action"] == "arrivee"
    # Le smartphone reconnaît la même personne 1 min plus tard : doublon, pas une sortie.
    second = _scan(db, emp, _at(day, 8, 1), "phone-1", device=2)
    assert second["duplicate"] is True and second["action"] == "arrivee"
    # QR de la même personne 2 min plus tard : doublon aussi (règle commune à toutes les sources).
    assert _scan(db, emp, _at(day, 8, 2), "qr-1", source=SOURCE_QR)["duplicate"] is True
    # Personne restée plus de 300 s : cycle ouvert ⇒ SORTIE (règle déterministe actuelle, documentée).
    exit_ = _scan(db, emp, _at(day, 8, 6), "phone-2", device=2)
    assert (exit_["duplicate"], exit_["action"], exit_["duration_minutes"]) == (False, "depart", 6)
    # Re-reconnaissance juste après la sortie : doublon ; puis nouvelle ENTRÉE refusée moins de 8 h
    # après la DERNIÈRE ENTRÉE — la boucle ENTRÉE / SORTIE / ENTRÉE / SORTIE est impossible.
    assert _scan(db, emp, _at(day, 8, 8), "tab-2", device=1)["duplicate"] is True
    for k, when in enumerate((_at(day, 8, 15), _at(day, 12, 0), _at(day, 15, 59))):
        with pytest.raises(HTTPException) as refused:
            _scan(db, emp, when, f"tab-retry-{k}", device=1)
        assert refused.value.status_code == 409 and "Nouvelle arrivée disponible" in refused.value.detail
    assert [t for t, *_ in _events(db, emp)] == ["ARRIVAL", "DEPARTURE"]
    # 8 h après la dernière entrée : nouveau poste possible (nouvelle ENTRÉE).
    assert _scan(db, emp, _at(day, 16, 1), "next-shift", device=1)["action"] == "arrivee"


def test_idempotent_retry_produces_one_event(db):
    site = _site(db); emp = _employee(db, site)
    day = date(2026, 9, 16)
    first = _scan(db, emp, _at(day, 9, 0), "same-key", device=1)
    retry = _scan(db, emp, _at(day, 9, 0, 3), "same-key", device=1)                                   # double POST / retry réseau
    assert first["event_id"] == retry["event_id"] and retry["duplicate"] is True
    assert len(_events(db, emp)) == 1


# ── § 27–28 : poste de nuit et compteurs « aujourd'hui » ──────────────────────────────────
def test_night_shift_crosses_midnight_and_counters_follow(db):
    site = _site(db); emp = _employee(db, site)
    day1, day2 = date(2026, 9, 17), date(2026, 9, 18)
    _scan(db, emp, _at(day1, 22, 0), "night-in", device=1)
    snap = live.summary(db, {site.id}, now=_at(day2, 1, 0))
    assert snap["present_now"] == 1, "présent après minuit"
    assert snap["entries_today"] == 0 and snap["exits_today"] == 0, "l'entrée appartient à la veille"
    out = _scan(db, emp, _at(day2, 6, 0), "night-out", device=1)
    assert out["action"] == "depart" and out["duration_minutes"] == 480
    db.expire_all()
    departure = db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id, AttendanceEvent.event_type == "DEPARTURE")).scalar_one()
    assert departure.presence_date == day1, "aucune sortie automatique à minuit : la sortie ferme la journée de l'entrée"
    snap = live.summary(db, {site.id}, now=_at(day2, 7, 0))
    assert (snap["present_now"], snap["exits_today"], snap["entries_today"]) == (0, 1, 0)
    # 24 h : la fenêtre de cycle ouvert est plus large (30 h).
    site24 = _site(db, rotation="24h/48h"); emp24 = _employee(db, site24)
    _scan(db, emp24, _at(day1, 7, 0), "24-in", device=1)
    assert live.summary(db, {site24.id}, now=_at(day2, 6, 0))["present_now"] == 1
    assert live.summary(db, {site.id}, now=_at(day1, 22, 0) + timedelta(hours=17))["present_now"] == 0


# ── § 30–31 : suspendu / non actif — reconnu ≠ autorisé ───────────────────────────────────
@pytest.mark.parametrize("status", ["suspendu", "sortant", "inactif"])
def test_blocked_employee_never_records(db, status):
    site = _site(db); emp = _employee(db, site, status=status)
    with pytest.raises(HTTPException) as refused:
        _scan(db, emp, _at(date(2026, 9, 19), 8, 0), f"blocked-{status}", device=1)
    assert refused.value.status_code == 403
    assert _events(db, emp) == []


# ── Poste de sécurité : passages acceptés, refus, compteurs, périmètre ────────────────────
def test_live_route_shows_accepted_passages_refusals_and_counters(client, db, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 0)
    site = _site(db)
    worker, who = _enrolled(db, site)
    suspended, who_s = _enrolled(db, site)
    other_site = _site(db); stranger = _employee(db, other_site)
    terminal_id, device = _terminal(client, auth_headers, site, activate=True)
    h = _pointer(client, db, [site.id])
    first = client.get(f"/api/portal/attendance-live?site_id={site.id}", headers=h)
    assert first.status_code == 200, first.text
    start = first.json()
    cursor, refusal_cursor = start["latest_event_id"], start["latest_refusal_id"]
    # Passage facial accepté par Attendance Core.
    assert device.recognize(client, burst(face(who))).json()["state"] == "ATTENDANCE_RECORDED"
    # Passage sur un AUTRE site : invisible pour ce poste.
    core.record_scan(db, employee=stranger, source=SOURCE_QR, actor=None, idempotency_key=f"other-{_tag()}")
    # Employé suspendu reconnu : refus, aucun mouvement.
    db.get(Employee, suspended.id).status = "suspendu"; db.commit()
    assert device.recognize(client, burst(face(who_s))).json()["state"] == "REFUSED"
    body = client.get(f"/api/portal/attendance-live?site_id={site.id}&after_id={cursor}&after_refusal_id={refusal_cursor}", headers=h).json()
    assert [e["employee"]["matricule"] for e in body["events"]] == [worker.code]
    event = body["events"][0]
    assert (event["type"], event["state"], event["source"], event["source_label"]) == ("ENTREE", "PRESENT", "FACIAL", "Reconnaissance faciale")
    assert event["terminal"] and event["site"] == site.name and len(event["heure"]) == 8
    assert {"nom", "prenom", "matricule", "fonction", "societe", "site", "photo"} <= set(event["employee"])
    assert [(r["employee"]["matricule"], r["label"]) for r in body["refusals"]] == [(suspended.code, "EMPLOYÉ SUSPENDU")]
    assert "photo" in body["refusals"][0]["employee"] and "image" not in str(body["refusals"]).lower()
    assert body["summary"] == {"entries_today": 1, "exits_today": 0, "present_now": 1, "absent_today": 0}
    assert db.execute(select(func.count()).select_from(AttendanceEvent).where(AttendanceEvent.employee_id == suspended.id)).scalar_one() == 0
    # Sortie (plus tard : au-delà de la non-répétition faciale de 60 s) : l'état affiché passe à SORTI.
    cursor = body["latest_event_id"]
    first_event = db.get(AttendanceEvent, cursor)
    first_event.occurred_at -= timedelta(minutes=10); db.commit()
    assert device.recognize(client, burst(face(who))).json()["action"] == "SORTIE"
    after = client.get(f"/api/portal/attendance-live?site_id={site.id}&after_id={cursor}", headers=h).json()
    assert [(e["type"], e["state"]) for e in after["events"]] == [("SORTIE", "SORTI")]
    assert after["summary"]["present_now"] == 0 and after["summary"]["exits_today"] == 1
    # Sans curseur : uniquement le dernier passage (écran au démarrage).
    assert [e["type"] for e in client.get(f"/api/portal/attendance-live?site_id={site.id}", headers=h).json()["events"]] == ["SORTIE"]


def test_live_and_portrait_routes_are_scoped(client, db):
    site, other = _site(db), _site(db)
    emp, foreign = _employee(db, site), _employee(db, other)
    h = _pointer(client, db, [site.id])
    assert client.get(f"/api/portal/attendance-live?site_id={other.id}", headers=h).status_code == 403
    assert client.get(f"/api/portal/attendance-live?site_id={site.id}").status_code == 401
    assert client.get(f"/api/portal/attendance-employee/{foreign.id}/portrait?site_id={site.id}", headers=h).status_code == 404
    assert client.get(f"/api/portal/attendance-employee/{emp.id}/portrait?site_id={site.id}", headers=h).status_code == 404   # pas de photo
    assert client.get(f"/api/portal/attendance-employee/{emp.id}/portrait").status_code == 401


def test_absences_counted_from_canonical_day_rows(db):
    site = _site(db); emp = _employee(db, site)
    today = core._now_local().date()
    core.record_day_status(db, employee=emp, site_id=site.id, day=today, status="absent", source="MANUAL", actor=None, notes="test")
    assert live.summary(db, {site.id})["absent_today"] == 1
    assert db.execute(select(func.count()).select_from(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalar_one() == 1
