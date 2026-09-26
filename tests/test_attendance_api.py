"""API Attendance (/api/attendance) — centre de contrôle et Employé 360."""
import uuid
from datetime import date, datetime

from sqlalchemy import select

from app.core.security import hash_password
from app.modules.attendance import core
from app.modules.attendance.models import AttendanceAnomaly
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, RotationTemplate, Site

SOC = "Iron Global Securite"
DAY = date(2027, 4, 5)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db):
    site = Site(name=f"API {_tag()}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    return site


def _employee(db, site, *, rotation=None, name="Agent"):
    emp = Employee(code=f"AP{_tag()}", first_name=name, last_name="Api", society=SOC, status="actif", position="AGENT")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1,
                      rotation_id=rotation.id if rotation else None))
    db.commit()
    return emp


def _user(client, db, *, sites=None, modules=("pointage",), actions=None, societies=(SOC,)):
    username = f"u{_tag()}"
    db.add(User(username=username, full_name=username, role="ops", access_level="H3",
                authorized_societies=list(societies), authorized_sites=list(sites or []),
                authorized_modules=list(modules), authorized_actions=list(actions or []),
                password_hash=hash_password("apipassword1"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": username, "password": "apipassword1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _world(db):
    site_a, site_b = _site(db), _site(db)
    rest = RotationTemplate(code=f"R{_tag()}", name="Repos", cycle_length=1, cycle_days=[{"status": "repos"}], group_offsets={}, active=1)
    db.add(rest); db.flush()
    present = _employee(db, site_a, name="Present")
    absent = _employee(db, site_a, name="Absent")
    missing = _employee(db, site_a, name="Manquant")
    resting = _employee(db, site_a, rotation=rest, name="Repos")
    other = _employee(db, site_b, name="Autre")
    core.record_day_status(db, employee=present, site_id=site_a.id, day=DAY, status="present", source="MANUAL", actor=None, arrival_time="08:00")
    core.record_day_status(db, employee=absent, site_id=site_a.id, day=DAY, status="absent", source="MANUAL", actor=None)
    core.record_day_status(db, employee=other, site_id=site_b.id, day=DAY, status="present", source="MANUAL", actor=None)
    db.commit()
    return site_a, site_b, present, absent, missing, resting, other


def test_board_kpis_cover_whole_population_not_the_page(client, db):
    site_a, site_b, present, absent, missing, resting, other = _world(db)
    headers = _user(client, db, sites=[site_a.id])
    r = client.get(f"/api/attendance/board?presence_date={DAY}&page_size=1", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 4 and len(body["items"]) == 1 and body["pages"] == 4
    kpi = body["kpi"]
    assert kpi["present"] == 1 and kpi["absent"] == 1 and kpi["repos"] == 1
    assert kpi["not_pointed"] == 1 and kpi["expected"] == 3 and kpi["anomalies"] == 1  # ABSENT
    ids = {row["employee_id"] for page in range(1, 5) for row in client.get(
        f"/api/attendance/board?presence_date={DAY}&page_size=1&page={page}", headers=headers).json()["items"]}
    assert other.id not in ids and {present.id, absent.id, missing.id, resting.id} == ids


def test_board_filters_are_server_side(client, db):
    site_a, *_ = _world(db)
    headers = _user(client, db, sites=[site_a.id])
    only_absent = client.get(f"/api/attendance/board?presence_date={DAY}&status=absent", headers=headers).json()
    assert [r["status"] for r in only_absent["items"]] == ["absent"]
    with_anomaly = client.get(f"/api/attendance/board?presence_date={DAY}&anomaly=ABSENT", headers=headers).json()
    assert len(with_anomaly["items"]) == 1
    search = client.get(f"/api/attendance/board?presence_date={DAY}&q=manquant", headers=headers).json()
    assert [r["nom"] for r in search["items"]] == ["Api Manquant"]


def test_scope_and_module_guards(client, db):
    site_a, site_b, *_ = _world(db)
    headers = _user(client, db, sites=[site_a.id])
    assert client.get(f"/api/attendance/board?site_id={site_b.id}", headers=headers).status_code == 403
    for modules in (("site_workforce",), ("finances",), ("pointeur",)):
        h = _user(client, db, sites=[site_a.id], modules=modules)
        assert client.get("/api/attendance/board", headers=h).status_code == 403, modules
    assert client.get("/api/attendance/board", headers=_user(client, db, sites=[site_a.id], modules=("drh",))).status_code == 200
    sites = client.get("/api/attendance/sites", headers=headers).json()
    assert [s["id"] for s in sites] == [site_a.id]


def test_correction_requires_reason_and_validate_after_closure(client, db):
    site_a, site_b, present, *_ = _world(db)
    row = db.execute(select(DailyPresence).where(DailyPresence.employee_id == present.id)).scalar_one()
    editor = _user(client, db, sites=[site_a.id], actions=("read", "update"))
    assert client.patch(f"/api/attendance/presences/{row.id}", headers=editor, json={"reason": "", "status": "absent"}).status_code == 422
    ok = client.patch(f"/api/attendance/presences/{row.id}", headers=editor, json={"reason": "Erreur de saisie", "arrival_time": "08:15"})
    assert ok.status_code == 200 and ok.json()["arrival_time"] == "08:15"
    validator = _user(client, db, sites=[site_a.id], actions=("read", "update", "validate"))
    assert client.post("/api/attendance/close", headers=editor, json={"presence_date": str(DAY), "site_id": site_a.id}).status_code == 403
    closed = client.post("/api/attendance/close", headers=validator, json={"presence_date": str(DAY), "site_id": site_a.id})
    assert closed.status_code == 200 and closed.json()["open_anomalies"] >= 1
    after = client.patch(f"/api/attendance/presences/{row.id}", headers=editor, json={"reason": "Oubli", "status": "absent"})
    assert after.status_code == 403  # post-clôture : permission renforcée
    assert client.patch(f"/api/attendance/presences/{row.id}", headers=validator,
                       json={"reason": "Certificat reçu", "status": "maladie"}).status_code == 200
    # Réouverture : action unlock + motif
    assert client.post(f"/api/attendance/presences/{row.id}/unlock", headers=validator, json={"reason": "Litige"}).status_code == 403
    unlocker = _user(client, db, sites=[site_a.id], actions=("read", "unlock"))
    assert client.post(f"/api/attendance/presences/{row.id}/unlock", headers=unlocker, json={"reason": "Litige paie"}).status_code == 200
    db.expire_all()
    assert db.get(DailyPresence, row.id).closed_at is None


def test_other_site_presence_is_invisible(client, db):
    site_a, site_b, present, absent, missing, resting, other = _world(db)
    row = db.execute(select(DailyPresence).where(DailyPresence.employee_id == other.id)).scalar_one()
    headers = _user(client, db, sites=[site_a.id], actions=("read", "update", "validate", "unlock"))
    assert client.patch(f"/api/attendance/presences/{row.id}", headers=headers, json={"reason": "x" * 5, "status": "absent"}).status_code == 404
    assert client.get(f"/api/attendance/employees/{other.id}", headers=headers).status_code == 404


def test_resolve_anomaly_is_traced_and_scoped(client, db):
    site_a, site_b, present, absent, *_ = _world(db)
    anomaly = db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == absent.id)).scalar_one()
    editor_only = _user(client, db, sites=[site_a.id], actions=("read", "update"))
    assert client.patch(f"/api/attendance/anomalies/{anomaly.id}", headers=editor_only,
                        json={"status": "RESOLVED", "resolution": "Sans droit de validation"}).status_code == 403
    headers = _user(client, db, sites=[site_a.id], actions=("read", "update", "validate"))
    listed = client.get(f"/api/attendance/anomalies?site_id={site_a.id}", headers=headers).json()
    assert anomaly.id in {a["id"] for a in listed["items"]}
    r = client.patch(f"/api/attendance/anomalies/{anomaly.id}", headers=headers,
                    json={"status": "RESOLVED", "resolution": "Absence justifiée par certificat"})
    assert r.status_code == 200 and r.json()["resolved_by"]
    assert client.patch(f"/api/attendance/anomalies/{anomaly.id}", headers=headers,
                       json={"status": "RESOLVED", "resolution": "Encore"}).status_code == 409
    outsider = _user(client, db, sites=[site_b.id], actions=("read", "update", "validate"))
    assert client.patch(f"/api/attendance/anomalies/{anomaly.id}", headers=outsider,
                       json={"status": "DISMISSED", "resolution": "Pas mon site"}).status_code == 404


def test_employee_360_attendance_history(client, db):
    site_a, site_b, present, *_ = _world(db)
    headers = _user(client, db, sites=[site_a.id], modules=("drh",))
    r = client.get(f"/api/attendance/employees/{present.id}?days=366", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [d["status"] for d in body["days"] if d["date"] == str(DAY)] == ["present"]
    assert {e["type"] for e in body["events"]} == {"STATUS"}
    assert body["events"][0]["source"] == "MANUAL"
