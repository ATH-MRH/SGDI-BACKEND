"""Attendance Core — tests de garde (seul point d'écriture de la présence)."""
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.modules.attendance import core
from app.modules.attendance.models import AttendanceAnomaly, AttendanceEvent
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, RotationTemplate, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

TZ = ZoneInfo("Africa/Algiers")
SOC = "Iron Global Securite"
ACTOR = SimpleNamespace(id=None, username="TESTEUR")


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db, *, society=SOC, rotation_system=None):
    site = Site(name=f"Site {_tag()}", active=1, equipment_plan={"societe": society}, rotation_system=rotation_system)
    db.add(site); db.flush()
    return site


def _employee(db, site=None, *, rotation=None, start=date(2026, 1, 1)):
    emp = Employee(code=f"AC{_tag()}", first_name="Test", last_name="Core", society=SOC, status="actif")
    db.add(emp); db.flush()
    if site is not None:
        db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=start, active=1,
                          rotation_id=rotation.id if rotation else None))
        db.flush()
    db.commit()
    return emp


def _rotation(db, day):
    rot = RotationTemplate(code=f"R{_tag()}", name="Test", cycle_length=1, cycle_days=[day], group_offsets={}, active=1)
    db.add(rot); db.flush()
    return rot


def _at(day, hhmm):
    return datetime.combine(day, datetime.strptime(hhmm, "%H:%M").time(), TZ)


def _events(db, emp):
    return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id).order_by(AttendanceEvent.id)).scalars().all()


def _anomalies(db, emp):
    return {a.anomaly_type for a in db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == emp.id)).scalars()}


# ── Idempotence / anti-rebond / bascule ─────────────────────────────────────────────────
def test_same_source_key_never_produces_two_effects(db):
    emp = _employee(db, _site(db))
    first = core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key="nonce-1")
    again = core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key="nonce-1",
                             now=datetime.now(TZ) + timedelta(hours=3))
    assert first["duplicate"] is False and again["duplicate"] is True
    assert again["event_id"] == first["event_id"]
    assert len(_events(db, emp)) == 1


def test_debounce_then_real_departure_then_new_arrival_delay(db):
    emp = _employee(db, _site(db))
    day = date.today()
    arrival = core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(day, "07:00"))
    bounce = core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(day, "07:01"))
    departure = core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(day, "12:00"))
    assert arrival["action"] == "arrivee"
    assert bounce["duplicate"] is True
    assert departure["action"] == "depart" and departure["duration_minutes"] == 300
    with pytest.raises(HTTPException) as exc:  # nouvelle arrivée < 8 h après l'arrivée : refus explicite
        core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(day, "12:10"))
    assert exc.value.status_code == 409
    assert [e.event_type for e in _events(db, emp)] == ["ARRIVAL", "DEPARTURE"]
    row = db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalar_one()
    assert row.status == "present" and row.departure_time == "12:00:00"


def test_scan_refused_on_closed_day(db):
    site = _site(db)
    emp = _employee(db, site)
    day = date.today()
    db.add(DailyPresence(presence_date=day, employee_id=emp.id, site_id=site.id, status="present", closed_at=datetime.utcnow()))
    db.commit()
    with pytest.raises(HTTPException) as exc:
        core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(day, "08:00"))
    assert exc.value.status_code == 409
    assert _events(db, emp) == []


def test_blocked_employee_cannot_be_pointed(db):
    emp = _employee(db, _site(db))
    emp.status = "suspendu"; db.commit()
    with pytest.raises(HTTPException) as exc:
        core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None)
    assert exc.value.status_code == 403


# ── Anomalies ───────────────────────────────────────────────────────────────────────────
def test_manual_pointage_and_lateness_against_real_planning(db):
    rotation = _rotation(db, {"status": "travail", "start_time": "08:00", "end_time": "16:00"})
    emp = _employee(db, _site(db), rotation=rotation)
    core.record_scan(db, employee=emp, source="MANUAL", actor=ACTOR, idempotency_key=None, now=_at(date.today(), "08:40"))
    kinds = _anomalies(db, emp)
    assert "MANUAL_POINTAGE" in kinds and "LATE" in kinds


def test_on_time_within_tolerance_is_not_late(db):
    rotation = _rotation(db, {"status": "travail", "start_time": "08:00", "end_time": "16:00"})
    emp = _employee(db, _site(db), rotation=rotation)
    core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(date.today(), "08:10"))
    assert "LATE" not in _anomalies(db, emp)


def test_no_planning_means_no_invented_lateness(db):
    emp = _employee(db, _site(db))  # ni rotation configurée, ni régime de site
    core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(date.today(), "13:00"))
    assert "LATE" not in _anomalies(db, emp) and "OFF_SCHEDULE" not in _anomalies(db, emp)


def test_arrival_on_rest_day_is_flagged_off_schedule(db):
    rotation = _rotation(db, {"status": "repos"})
    emp = _employee(db, _site(db), rotation=rotation)
    core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(date.today(), "09:00"))
    assert "OFF_SCHEDULE" in _anomalies(db, emp)


# ── Statut, correction, clôture ─────────────────────────────────────────────────────────
def test_day_status_correction_and_closure_trail(db):
    site = _site(db)
    emp = _employee(db, site)
    day = date(2027, 3, 3)
    row = core.record_day_status(db, employee=emp, site_id=site.id, day=day, status="absent", source="SITE_WORKFORCE", actor=ACTOR)
    assert "ABSENT" in _anomalies(db, emp)
    result = core.close_day(db, day=day, site_ids=[site.id], actor=ACTOR, source="SYSTEM")
    assert result["closed"] == 1 and result["open_anomalies"] >= 1  # jamais masquées
    with pytest.raises(HTTPException) as exc:
        core.record_day_status(db, employee=emp, site_id=site.id, day=day, status="present", source="MANUAL", actor=ACTOR)
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException):
        core.correct_presence(db, row=row, reason="erreur", source="MANUAL", actor=ACTOR, allow_closed=False, status="present")
    with pytest.raises(HTTPException):
        core.correct_presence(db, row=row, reason="  ", source="MANUAL", actor=ACTOR, allow_closed=True, status="present")
    core.correct_presence(db, row=row, reason="Justificatif reçu", source="MANUAL", actor=ACTOR, allow_closed=True, status="maladie")
    db.commit()
    correction = [e for e in _events(db, emp) if e.event_type == "CORRECTION"][0]
    assert correction.data["changes"]["status"] == {"avant": "absent", "apres": "maladie"}
    assert correction.data["post_closure"] is True
    assert [e.event_type for e in _events(db, emp)] == ["STATUS", "CLOSE", "CORRECTION"]


def test_close_day_is_scoped_to_given_sites(db):
    site_a, site_b = _site(db), _site(db)
    emp_a, emp_b = _employee(db, site_a), _employee(db, site_b)
    day = date(2027, 3, 4)
    for emp, site in ((emp_a, site_a), (emp_b, site_b)):
        core.record_day_status(db, employee=emp, site_id=site.id, day=day, status="present", source="MANUAL", actor=ACTOR)
    core.close_day(db, day=day, site_ids=[site_a.id], actor=ACTOR, source="SYSTEM")
    db.commit()
    closed = {r.employee_id: r.closed_at for r in db.execute(select(DailyPresence).where(DailyPresence.presence_date == day)).scalars()}
    assert closed[emp_a.id] is not None and closed[emp_b.id] is None


# ── Circuits : écran legacy, OPS, BEO ───────────────────────────────────────────────────
def test_legacy_sheet_cannot_modify_or_delete_a_closed_day(client, auth_headers, db):
    site = _site(db)
    emp = _employee(db, site)
    row = DailyPresence(presence_date=date(2027, 3, 5), employee_id=emp.id, site_id=site.id, status="present",
                        closed_at=datetime.utcnow())
    db.add(row); db.commit()
    r = client.post("/api/irongs/collections/feuillePresence/items", headers=auth_headers,
                    json={"data": {"backendId": row.id, "employee_id": emp.id, "date": "2027-03-05", "statut": "absent"}})
    assert r.status_code == 409, r.text
    r = client.delete(f"/api/irongs/collections/feuillePresence/items/{row.id}", headers=auth_headers)
    assert r.status_code == 409, r.text
    db.expire_all()
    assert db.get(DailyPresence, row.id).status == "present"


def test_legacy_sheet_write_on_open_day_is_traced(client, auth_headers, db):
    site = _site(db)
    emp = _employee(db, site)
    r = client.post("/api/irongs/collections/feuillePresence/items", headers=auth_headers,
                    json={"data": {"employee_id": emp.id, "date": "2027-03-06", "statut": "absent", "siteBackendId": site.id}})
    assert r.status_code in (200, 201), r.text
    assert [e.source for e in _events(db, emp)] == ["IMPORT"]


def _scoped_headers(client, db, site_ids, username):
    from app.core.security import hash_password
    from app.modules.auth.models import User
    db.add(User(username=username, full_name=username, role="ops", access_level="H3", authorized_societies=[SOC],
                authorized_sites=site_ids, authorized_structures=["ops"], authorized_modules=["ops"],
                password_hash=hash_password("scopedpass1"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": username, "password": "scopedpass1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_ops_close_only_closes_the_callers_sites(client, db):
    site_a, site_b = _site(db), _site(db)
    emp_a, emp_b = _employee(db, site_a), _employee(db, site_b)
    day = date(2027, 3, 7)
    for emp, site in ((emp_a, site_a), (emp_b, site_b)):
        db.add(DailyPresence(presence_date=day, employee_id=emp.id, site_id=site.id, status="present"))
    db.commit()
    headers = _scoped_headers(client, db, [site_a.id], f"opsA{_tag()}")
    r = client.post(f"/api/ops/pointage/daily/close?presence_date={day}", headers=headers)
    assert r.status_code == 200, r.text
    db.expire_all()
    closed = {r.employee_id: r.closed_at for r in db.execute(select(DailyPresence).where(DailyPresence.presence_date == day)).scalars()}
    assert closed[emp_a.id] is not None
    assert closed[emp_b.id] is None  # auparavant : toute la journée, toutes sociétés


def test_ops_patch_refuses_closed_day_and_other_site(client, auth_headers, db):
    site_a, site_b = _site(db), _site(db)
    emp_a, emp_b = _employee(db, site_a), _employee(db, site_b)
    closed = DailyPresence(presence_date=date(2027, 3, 8), employee_id=emp_a.id, site_id=site_a.id, status="present",
                           closed_at=datetime.utcnow())
    other = DailyPresence(presence_date=date(2027, 3, 8), employee_id=emp_b.id, site_id=site_b.id, status="present")
    db.add_all([closed, other]); db.commit()
    r = client.patch(f"/api/ops/pointage/daily/{closed.id}", headers=auth_headers, json={"status": "absent"})
    assert r.status_code == 409, r.text
    headers = _scoped_headers(client, db, [site_a.id], f"opsP{_tag()}")
    assert client.patch(f"/api/ops/pointage/daily/{other.id}", headers=headers, json={"status": "absent"}).status_code == 403
    ok = client.patch(f"/api/ops/pointage/daily/{other.id}", headers=auth_headers, json={"status": "absent"})
    assert ok.status_code == 200 and ok.json()["status"] == "absent"
    assert [e.event_type for e in _events(db, emp_b)] == ["CORRECTION"]


def test_ops_create_never_duplicates_a_day(client, auth_headers, db):
    site = _site(db)
    emp = _employee(db, site)
    body = {"presence_date": "2027-03-09", "employee_id": emp.id, "site_id": site.id, "status": "present"}
    assert client.post("/api/ops/pointage/daily", headers=auth_headers, json=body).status_code in (200, 201)
    assert client.post("/api/ops/pointage/daily", headers=auth_headers, json={**body, "status": "absent"}).status_code in (200, 201)
    rows = db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalars().all()
    assert len(rows) == 1 and rows[0].status == "absent"


def test_scan_rows_are_filtered_in_sql_by_site_and_period(db):
    site_a, site_b = _site(db), _site(db)
    emp_a, emp_b = _employee(db, site_a), _employee(db, site_b)
    day = date.today()
    core.record_scan(db, employee=emp_a, source="QR", actor=ACTOR, idempotency_key=None, now=_at(day, "07:00"))
    core.record_scan(db, employee=emp_b, source="QR", actor=ACTOR, idempotency_key=None, now=_at(day, "07:05"))
    rows = core.scan_rows(db, site_ids=[site_a.id], since=_at(day, "00:00"))
    assert {r["employeeId"] for r in rows} == {emp_a.id}
    assert core.scan_rows(db, site_ids=[]) == []
    assert rows[0]["action"] == "arrivee" and rows[0]["scannedAt"].startswith(day.isoformat())
    assert db.scalar(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.employee_id == emp_b.id)) == 1


def test_key_used_by_another_employee_is_refused_not_leaked(db):
    emp_a, emp_b = _employee(db, _site(db)), _employee(db, _site(db))
    core.record_scan(db, employee=emp_a, source="QR", actor=ACTOR, idempotency_key="shared-key")
    with pytest.raises(HTTPException) as exc:
        core.record_scan(db, employee=emp_b, source="QR", actor=ACTOR, idempotency_key="shared-key")
    assert exc.value.status_code == 409
    assert _events(db, emp_b) == []


# ── Revue de sécurité : lecture et génération OPS limitées au périmètre du compte ───────
def test_ops_presence_reads_and_generation_are_scoped(client, db):
    site_a, site_b = _site(db), _site(db)
    emp_a, emp_b = _employee(db, site_a), _employee(db, site_b)
    day = date(2027, 5, 5)
    db.add_all([DailyPresence(presence_date=day, employee_id=emp_a.id, site_id=site_a.id, status="present"),
                DailyPresence(presence_date=day, employee_id=emp_b.id, site_id=site_b.id, status="present")])
    db.commit()
    h = _scoped_headers(client, db, [site_a.id], f"opsR{_tag()}")
    listed = {r["employee_id"] for r in client.get(f"/api/ops/pointage/daily?presence_date={day}", headers=h).json()}
    paged = {r["employee_id"] for r in client.get(f"/api/ops/pointage/daily/page?presence_date={day}&page_size=100", headers=h).json()["items"]}
    assert emp_b.id not in listed and emp_b.id not in paged
    assert emp_a.id in listed and emp_a.id in paged
    gen_day = date(2027, 5, 6)
    assert client.post(f"/api/ops/pointage/daily/generate?presence_date={gen_day}", headers=h).status_code == 200
    generated = {r.employee_id for r in db.execute(select(DailyPresence).where(DailyPresence.presence_date == gen_day)).scalars()}
    assert emp_a.id in generated and emp_b.id not in generated
    assert client.post("/api/ops/pointage/daily/generate-rotation", headers=h,
                       json={"presence_date": str(gen_day), "site_id": site_b.id}).status_code == 403


# ── Revue finale : le planning ne réécrit jamais une journée réellement pointée ─────────
def test_rotation_generation_never_overwrites_a_real_presence(client, auth_headers, db):
    from datetime import timedelta
    overwritten = []
    for offset in range(4):  # un cycle 24/48 complet : au moins deux jours travaillés
        site = _site(db, rotation_system="24/48")
        emp = _employee(db, site, start=date.today() - timedelta(days=10))
        day = date.today() + timedelta(days=offset)
        core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(day, "07:00"))
        row = db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalar_one()
        assert client.post("/api/ops/pointage/daily/generate-rotation", headers=auth_headers,
                           json={"presence_date": str(day), "site_id": site.id}).status_code == 200
        db.expire_all()
        row = db.get(DailyPresence, row.id)
        if row.generated or "_legacy" not in (row.data or {}) or row.data["_legacy"].get("scanArrivee") != "07:00:00":
            overwritten.append(offset)
    assert overwritten == [], f"journée pointée réécrite par le planning aux jours +{overwritten}"


def test_day_status_after_real_scan_keeps_the_measured_times(db):
    """BEO confirme « présent » après un scan réel du terminal (ou en même temps, course perdue
    par le BEO) : les heures mesurées ne doivent pas être effacées."""
    site = _site(db)
    emp = _employee(db, site)
    day = date.today()
    core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=None, now=_at(day, "07:00"))
    db.commit()
    core.record_day_status(db, employee=emp, site_id=site.id, day=day, status="present", source="SITE_WORKFORCE", actor=ACTOR)
    db.commit()
    row = db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalar_one()
    assert row.status == "present"
    assert row.arrival_time, "heure d'arrivée mesurée effacée par la saisie de statut"
