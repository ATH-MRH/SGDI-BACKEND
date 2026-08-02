"""Pointage QR employé + saisie manuelle (pointeur) — vrais endpoints, vraie base.

Couvre /api/portal/attendance-qr/scan (via le refactor _register_attendance) et les
nouveaux endpoints /api/portal/attendance-manual/search + /attendance-manual/scan,
ajoutés pour les employés sans smartphone (le pointeur tape le code/nom, puis confirme).
"""
from datetime import datetime, timedelta, timezone

from app.modules.irongs import service as irongs_service

SOCIETY = "Iron Global Securite"


def _emp(client, h, code, fn="Karim", ln="Belmiloud", society=SOCIETY):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": fn, "last_name": ln,
        "society": society, "status": "actif", "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_manual_search_finds_by_code(client, auth_headers):
    emp_id = _emp(client, auth_headers, "PTM01", fn="Yacine", ln="Belkacem")
    r = client.get("/api/portal/attendance-manual/search?q=PTM01", headers=auth_headers)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert any(row["id"] == emp_id for row in rows)


def test_manual_search_finds_by_name(client, auth_headers):
    emp_id = _emp(client, auth_headers, "PTM02", fn="Sofiane", ln="Rachedi")
    r = client.get("/api/portal/attendance-manual/search?q=Rachedi", headers=auth_headers)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert any(row["id"] == emp_id for row in rows)
    row = next(row for row in rows if row["id"] == emp_id)
    assert row["matricule"] == "PTM02"
    assert row["nom"] == "RACHEDI" and row["prenom"] == "SOFIANE"


def test_light_attendance_employees_returns_active_employee_and_assignment(client, auth_headers, db):
    site_id = _site(client, auth_headers, "Site Referentiel Leger")
    emp_id = _emp(client, auth_headers, "PTL01", fn="Lina", ln="Legere")
    _assign(client, auth_headers, emp_id, site_id)
    response = client.get(f"/api/portal/attendance-employees?society={SOCIETY}", headers=auth_headers)
    assert response.status_code == 200, response.text
    matches = [item for item in response.json() if item["id"] == emp_id]
    assert matches, response.json()
    row = matches[0]
    assert row["matricule"] == "PTL01"
    assert row["assignment"]["site_id"] == site_id
    assert row["assignment"]["site_name"] == "SITE REFERENTIEL LEGER"


def test_manual_search_too_short_returns_empty(client, auth_headers):
    r = client.get("/api/portal/attendance-manual/search?q=a", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


def test_manual_scan_toggles_arrival_then_departure(client, auth_headers):
    emp_id = _emp(client, auth_headers, "PTM03", fn="Amine", ln="Ouali")
    r1 = client.post(
        "/api/portal/attendance-manual/scan",
        headers=auth_headers,
        json={"employee_id": emp_id, "observation": "Retard signalé au pointeur"},
    )
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    assert body1["success"] is True
    assert body1["action"] == "arrivee"
    assert body1["employee"]["matricule"] == "PTM03"
    assert body1["employee"]["nom"] == "OUALI"
    assert body1["observation"] == "Retard signalé au pointeur"

    presence = client.get("/api/irongs/collections/feuillePresence", headers=auth_headers)
    assert presence.status_code == 200, presence.text
    payload = presence.json()
    rows = payload if isinstance(payload, list) else payload.get("data", [])
    row = next(item for item in rows if str(item.get("employee_id")) == str(emp_id))
    assert "Retard signalé au pointeur" in row["observations"]
    assert "ARRIVÉE" in row["observations"]

    r2 = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": emp_id})
    assert r2.status_code == 201, r2.text
    body2 = r2.json()
    assert body2["action"] == "depart"
    assert body2["arrival_time"] == body1["heure"]
    assert body2["departure_time"] == body2["heure"]
    assert body2["duration_minutes"] >= 0
    assert " h " in body2["duration_label"]


def test_manual_scan_unknown_employee_404(client, auth_headers):
    r = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": 99999999})
    assert r.status_code == 404, r.text


def test_manual_scan_requires_auth(client):
    r = client.post("/api/portal/attendance-manual/scan", json={"employee_id": 1})
    assert r.status_code == 401


def _site(client, h, name):
    r = client.post("/api/ops/sites", headers=h, json={
        "name": name, "indicatif": name[:3].upper(), "rotation_system": "24/48",
        "contractual_staff": 0, "active": 1, "equipment_plan": {"societe": SOCIETY},
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _assign(client, h, emp_id, site_id):
    r = client.post("/api/ops/assignments", headers=h, json={
        "employee_id": int(emp_id), "site_id": int(site_id),
        "group_code": "A", "start_date": "2026-01-01", "active": 1,
    })
    assert r.status_code in (200, 201), r.text


def test_attendance_feed_returns_recent_scan(client, auth_headers):
    emp_id = _emp(client, auth_headers, "PTF01", fn="Nadir", ln="Cherif")
    r = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": emp_id})
    assert r.status_code == 201, r.text
    feed = client.get("/api/portal/attendance-feed", headers=auth_headers)
    assert feed.status_code == 200, feed.text
    rows = feed.json()
    row = next(item for item in rows if str(item["employee_id"]) == str(emp_id))
    assert row["action"] == "arrivee"
    assert row["matricule"] == "PTF01"


def test_attendance_feed_since_filters_older_events(client, auth_headers):
    emp_id = _emp(client, auth_headers, "PTF02", fn="Yasmine", ln="Aitali")
    r = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": emp_id})
    assert r.status_code == 201, r.text
    feed_future = client.get("/api/portal/attendance-feed?since=9999-01-01T00:00:00", headers=auth_headers).json()
    assert not any(str(item["employee_id"]) == str(emp_id) for item in feed_future)
    feed_past = client.get("/api/portal/attendance-feed?since=2000-01-01T00:00:00", headers=auth_headers).json()
    assert any(str(item["employee_id"]) == str(emp_id) for item in feed_past)


def test_attendance_feed_keeps_only_last_48_hours(client, auth_headers, db):
    old_id = "attendance-old-49h"
    irongs_service.create_item(db, "attendanceQrScans", {
        "id": old_id, "nonce": old_id, "employeeId": 999999,
        "matricule": "OLD49", "agentName": "Ancien Passage",
        "action": "arrivee", "cycle": 1,
        "scannedAt": (datetime.now(timezone.utc) - timedelta(hours=49)).isoformat(),
        "site": "Ancien site", "siteId": None, "scannedBy": "test",
    })
    rows = client.get("/api/portal/attendance-feed?limit=200", headers=auth_headers).json()
    assert not any(row["id"] == old_id for row in rows)


def test_attendance_feed_requires_auth(client):
    r = client.get("/api/portal/attendance-feed")
    assert r.status_code == 401


def test_supervision_route_serves_html(client):
    r = client.get("/supervision")
    assert r.status_code == 200
    assert "SUPERVISION POINTAGE" in r.text


def test_recrute_route_serves_html(client):
    r = client.get("/recrute")
    assert r.status_code == 200
    assert "RECRUTEMENT" in r.text
    assert 'id="ctSalary" type="text" inputmode="decimal"' in r.text
    assert 'placeholder="30 000,00 DZD"' in r.text
    assert "parseSalaryDzd" in r.text
    assert "validateContractRequiredFields" in r.text
    assert "/marquer-contractualisation" in r.text


def test_attendance_feed_site_restricted_supervisor_only_sees_own_site(client, auth_headers, db):
    from app.core.security import hash_password
    from app.modules.auth.models import User

    mine = _site(client, auth_headers, "Site Supervise Pointage")
    other = _site(client, auth_headers, "Site Hors Perimetre Pointage")
    emp_mine = _emp(client, auth_headers, "PTF03", fn="Karima", ln="Boudaoud")
    emp_other = _emp(client, auth_headers, "PTF04", fn="Lyes", ln="Ferhat")
    _assign(client, auth_headers, emp_mine, mine)
    _assign(client, auth_headers, emp_other, other)

    r1 = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": emp_mine})
    assert r1.status_code == 201, r1.text
    r2 = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": emp_other})
    assert r2.status_code == 201, r2.text

    user = User(
        username="attendance-supervisor",
        email=None,
        full_name="Attendance Supervisor",
        role="ops",
        access_level="H2",
        authorized_societies=[],
        authorized_sites=[mine],
        authorized_structures=[],
        password_hash=hash_password("supervisorpass"),
        is_active=True,
    )
    db.add(user)
    db.commit()

    login = client.post("/api/auth/login", json={"username": "attendance-supervisor", "password": "supervisorpass"})
    assert login.status_code == 200, login.text
    sup_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    feed = client.get("/api/portal/attendance-feed", headers=sup_headers)
    assert feed.status_code == 200, feed.text
    rows = feed.json()
    assert any(str(item["employee_id"]) == str(emp_mine) for item in rows)
    assert not any(str(item["employee_id"]) == str(emp_other) for item in rows)


def test_manual_search_and_scan_respect_pointer_site_scope(client, auth_headers, db):
    from app.core.security import hash_password
    from app.modules.auth.models import User

    mine = _site(client, auth_headers, "Site Pointeur Autorise")
    other = _site(client, auth_headers, "Site Pointeur Interdit")
    emp_mine = _emp(client, auth_headers, "PTS01", fn="Samir", ln="Autorise")
    emp_other = _emp(client, auth_headers, "PTS02", fn="Samir", ln="Interdit")
    _assign(client, auth_headers, emp_mine, mine)
    _assign(client, auth_headers, emp_other, other)
    pointer = User(
        username="pointer-site-scope", full_name="Pointeur site", role="ops", access_level="H2",
        authorized_societies=[], authorized_sites=[mine], authorized_structures=["pointage"],
        password_hash=hash_password("pointerpass"), is_active=True,
    )
    db.add(pointer); db.commit()
    login = client.post("/api/auth/login", json={"username": "pointer-site-scope", "password": "pointerpass"})
    pointer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    allowed = client.get("/api/portal/attendance-manual/search?q=PTS01", headers=pointer_headers)
    forbidden = client.get("/api/portal/attendance-manual/search?q=PTS02", headers=pointer_headers)
    assert any(row["id"] == emp_mine for row in allowed.json())
    assert forbidden.json() == []
    direct_scan = client.post("/api/portal/attendance-manual/scan", headers=pointer_headers, json={"employee_id": emp_other})
    assert direct_scan.status_code == 403
