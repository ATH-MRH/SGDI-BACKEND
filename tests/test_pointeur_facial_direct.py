"""Pointage facial automatique depuis le Pointeur : un seul moteur facial, un seul Attendance Core.
Le facial transmet l'identité ; ENTRÉE / SORTIE, fenêtres, temps comptabilisé et refus sont ceux
d'Attendance Core, identiques au QR et à la saisie manuelle. Anti-double pointage.

Moteur simulé déterministe (tests/biometric_fakes.py) ; capture serveur simulée."""
import json
from datetime import date, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.config import settings
from app.modules.attendance import core, official
from app.modules.attendance.models import AttendanceEvent
from app.modules.auth.models import AuditEvent
from app.modules.ops.models import Assignment, DailyPresence, SiteRotation
from tests.biometric_fakes import face
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics_facial_pilot import (  # noqa: F401 (pilot : fixture autouse du moteur simulé)
    _camera, _confirm, _consent, _employee, _photo, _preview, _recognize, _sees, _site, _tag, pilot,
)

TZ = ZoneInfo("Africa/Algiers")
ANCHOR = date(2026, 10, 1)                       # J1 du groupe A : le groupe B est d'Après-midi (14:00 → 22:00)


def _at(hms):
    return datetime.combine(ANCHOR, datetime.strptime(hms if len(hms) == 8 else f"{hms}:00", "%H:%M:%S").time(), TZ)


def _posted_site(client, h, db, people=1):
    """Site posté ancré, caméra de pointage facial activée, `people` salariés du groupe B enrôlés."""
    site = _site(db)
    model = official.ensure_official_model(db)
    db.add(SiteRotation(site_id=site.id, rotation_id=model.id, start_date=ANCHOR, active=1))
    cam = _camera(client, h, site)
    enrolled = []
    for _ in range(people):
        emp, who = _employee(db, site), f"W-{_tag()}"
        row = db.execute(select(Assignment).where(Assignment.employee_id == emp.id)).scalar_one()
        row.work_regime, row.group_code, row.rotation_id = official.REGIME_POSTE_CONTINU, "B", model.id
        db.commit()
        _photo(db, emp, face(who)); _consent(client, h, emp)
        _sees(face(who))
        preview = _preview(client, h, emp, {"camera_id": cam}).json()
        assert _confirm(client, h, emp, preview["token"]).status_code == 200
        enrolled.append((emp, who))
    assert client.patch(f"/api/biometrics/cameras/{cam}", headers=h, json={"facial_attendance_enabled": True}).status_code == 200
    return site, cam, enrolled


@pytest.fixture
def facial_on(monkeypatch):
    monkeypatch.setattr(settings, "biometric_enabled", True)
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 300)       # anti-rebond de production

    def at(hms):
        monkeypatch.setattr(core, "_now_local", lambda: _at(hms))
    return at


def _events(db, emp):
    return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id).order_by(AttendanceEvent.id)).scalars().all()


# ── Anti-double pointage ─────────────────────────────────────────────────────────────────
def test_ten_detections_of_the_same_face_record_a_single_movement(client, auth_headers, db, facial_on):
    _site_, cam, [(emp, who)] = _posted_site(client, auth_headers, db)
    facial_on("13:40")
    results = [_recognize(client, auth_headers, cam, who).json() for _ in range(10)]
    assert [r["state"] for r in results] == ["ATTENDANCE_RECORDED"] + ["ALREADY_RECORDED"] * 9
    assert [r["recorded"] for r in results] == [True] + [False] * 9
    events = _events(db, emp)
    assert [e.event_type for e in events] == ["ARRIVAL"] and events[0].source == "FACIAL"      # jamais entrée → sortie → entrée
    # Quelques secondes plus tard, toujours devant la caméra : rien de plus.
    facial_on("13:40:20")
    assert _recognize(client, auth_headers, cam, who).json()["state"] == "ALREADY_RECORDED" and len(_events(db, emp)) == 1


def test_two_different_people_in_a_row_both_clock_in(client, auth_headers, db, facial_on):
    _site_, cam, [(first, who1), (second, who2)] = _posted_site(client, auth_headers, db, people=2)
    facial_on("13:40")
    a = _recognize(client, auth_headers, cam, who1).json()
    b = _recognize(client, auth_headers, cam, who2).json()
    assert (a["state"], a["employee"]["matricule"], b["state"], b["employee"]["matricule"]) == (
        "ATTENDANCE_RECORDED", first.code, "ATTENDANCE_RECORDED", second.code)
    assert len(_events(db, first)) == len(_events(db, second)) == 1
    assert _recognize(client, auth_headers, cam, who1).json()["state"] == "ALREADY_RECORDED"


# ── Le facial n'applique aucune règle : Attendance Core décide ───────────────────────────
def test_accepted_facial_entry_carries_the_counted_snapshot_of_attendance_core(client, auth_headers, db, facial_on):
    _site_, cam, [(emp, who)] = _posted_site(client, auth_headers, db)
    facial_on("13:37:24")
    out = _recognize(client, auth_headers, cam, who).json()
    assert (out["state"], out["action"], out["heure"]) == ("ATTENDANCE_RECORDED", "ENTRÉE", "13:37")
    counted = out["counted"]
    assert (counted["kind"], counted["group"], counted["entry_status"]) == ("NORMAL", "B", "IN_WINDOW")
    assert (counted["actual_entry"], counted["scheduled_start"], counted["counted_start"]) == (
        _at("13:37:24").isoformat(), _at("14:00").isoformat(), _at("14:00").isoformat())
    assert _events(db, emp)[0].data["counted"]["counted_start"] == _at("14:00").isoformat()


def test_attendance_refusal_through_facial_creates_no_movement_and_is_audited(client, auth_headers, db, facial_on):
    _site_, cam, [(emp, who)] = _posted_site(client, auth_headers, db)
    facial_on("13:21")
    mark = db.execute(select(func.max(AuditEvent.id))).scalar_one() or 0
    out = _recognize(client, auth_headers, cam, who).json()
    assert (out["state"], out["recorded"], out["code"]) == ("REFUSED", False, "EARLY_OUTSIDE_WINDOW")
    assert out["employee"]["matricule"] == emp.code and "13:30" in out["message"]
    assert (out["refusal"]["code"], out["refusal"]["scheduled_start"], out["refusal"]["window_opens_at"], out["refusal"]["recorded"]) == (
        "EARLY_OUTSIDE_WINDOW", _at("14:00").isoformat(), _at("13:30").isoformat(), False)
    assert _events(db, emp) == [] and db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).first() is None
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.early_outside_window", AuditEvent.id > mark)).scalar_one()
    state = json.loads(audit.new_state)
    assert (audit.result, state["source"], state["matricule"], state["recorded"]) == ("refused", "FACIAL", emp.code, False)
    # La tentative refusée n'a rien démarré : à T-30 l'entrée faciale est acceptée normalement.
    facial_on("13:30")
    assert _recognize(client, auth_headers, cam, who).json()["state"] == "ATTENDANCE_RECORDED"


def test_unknown_face_never_creates_a_movement_or_matches_the_closest_employee(client, auth_headers, db, facial_on):
    _site_, cam, [(emp, _who)] = _posted_site(client, auth_headers, db)
    facial_on("14:05")
    out = _recognize(client, auth_headers, cam, f"STRANGER-{_tag()}").json()
    assert (out["state"], out["recorded"]) == ("UNKNOWN_FACE", False) and "employee" not in out
    assert _events(db, emp) == []


# ── QR, facial et saisie manuelle : même moteur, même résultat métier ────────────────────
def test_qr_facial_and_manual_give_the_same_business_result(client, auth_headers, db, facial_on):
    _site_, cam, [(by_face, who), (by_manual, _w2), (by_qr, _w3)] = _posted_site(client, auth_headers, db, people=3)
    pointer = SimpleNamespace(id=None, username="PTG")

    def qr(emp):
        return core.record_scan(db, employee=emp, source="QR", actor=pointer, idempotency_key=f"k-{_tag()}")

    def manual(emp):
        return client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": emp.id, "action": "present"})

    # Avant T-30 : les trois sources reçoivent le même refus d'Attendance Core.
    facial_on("13:21")
    refused_face = _recognize(client, auth_headers, cam, who).json()
    refused_manual = manual(by_manual)
    with pytest.raises(HTTPException) as refused_qr:
        qr(by_qr)
    assert refused_face["code"] == refused_manual.headers["X-Attendance-Code"] == refused_qr.value.headers["X-Attendance-Code"] == "EARLY_OUTSIDE_WINDOW"
    assert refused_face["message"] == refused_manual.json()["detail"] == refused_qr.value.detail
    assert all(_events(db, emp) == [] for emp in (by_face, by_manual, by_qr))

    # Dans la fenêtre : même décision, même temps comptabilisé — seule la source diffère.
    facial_on("13:45")
    face_out, manual_out, qr_out = _recognize(client, auth_headers, cam, who).json(), manual(by_manual).json(), qr(by_qr)
    snapshots = [face_out["counted"], manual_out["counted"], qr_out["counted"]]
    assert {(s["kind"], s["entry_status"], s["actual_entry"], s["counted_start"], s["scheduled_end"]) for s in snapshots} == {
        ("NORMAL", "IN_WINDOW", _at("13:45").isoformat(), _at("14:00").isoformat(), _at("22:00").isoformat())}
    assert (face_out["action"], manual_out["action"], qr_out["action"]) == ("ENTRÉE", "arrivee", "arrivee")
    assert [_events(db, emp)[0].source for emp in (by_face, by_manual, by_qr)] == ["FACIAL", "MANUAL", "QR"]
    assert {_events(db, emp)[0].event_type for emp in (by_face, by_manual, by_qr)} == {"ARRIVAL"}
