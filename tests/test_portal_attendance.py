"""Pointage QR employé + saisie manuelle (pointeur) — vrais endpoints, vraie base.

Couvre /api/portal/attendance-qr/scan (via le refactor _register_attendance) et les
nouveaux endpoints /api/portal/attendance-manual/search + /attendance-manual/scan,
ajoutés pour les employés sans smartphone (le pointeur tape le code/nom, puis confirme).
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

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


def test_attendance_feed_restores_missing_employee_identity(client, auth_headers, db):
    emp_id = _emp(client, auth_headers, "PTF-ID", fn="Nora", ln="Identite")
    event_id = "attendance-missing-identity"
    irongs_service.create_item(db, "attendanceQrScans", {
        "id": event_id, "nonce": event_id, "employeeId": emp_id,
        "action": "arrivee", "cycle": 1,
        "scannedAt": datetime.now(timezone.utc).isoformat(),
        "site": "Site identité", "siteId": None, "scannedBy": "test",
    })
    rows = client.get("/api/portal/attendance-feed?limit=200", headers=auth_headers).json()
    row = next(item for item in rows if item["id"] == event_id)
    assert row["matricule"] == "PTF-ID"
    assert "IDENTITE" in row["nom"].upper()
    assert "NORA" in row["nom"].upper()


def test_attendance_feed_requires_auth(client):
    r = client.get("/api/portal/attendance-feed")
    assert r.status_code == 401


def _scan_event(db, *, event_id, emp_id, matricule, name, action, hours_ago, site="", site_id=None):
    irongs_service.create_item(db, "attendanceQrScans", {
        "id": event_id, "nonce": event_id, "employeeId": emp_id,
        "matricule": matricule, "agentName": name,
        "action": action, "cycle": 1,
        "scannedAt": (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat(),
        "site": site, "siteId": site_id, "scannedBy": "test",
    })


def test_attendance_alerts_flags_8h_12h_16h_thresholds(client, auth_headers, db):
    _scan_event(db, event_id="alert-8h", emp_id=910001, matricule="AL8H", name="Huit Heures", action="arrivee", hours_ago=9)
    _scan_event(db, event_id="alert-12h", emp_id=910002, matricule="AL12H", name="Douze Heures", action="arrivee", hours_ago=13)
    _scan_event(db, event_id="alert-16h", emp_id=910003, matricule="AL16H", name="Seize Heures", action="arrivee", hours_ago=18)
    _scan_event(db, event_id="alert-none", emp_id=910004, matricule="ALNONE", name="Cinq Heures", action="arrivee", hours_ago=5)

    r = client.get("/api/portal/attendance-alerts", headers=auth_headers)
    assert r.status_code == 200, r.text
    by_matricule = {a["matricule"]: a for a in r.json()["presence_alerts"]}
    assert by_matricule["AL8H"]["threshold_hours"] == 8
    assert by_matricule["AL12H"]["threshold_hours"] == 12
    assert by_matricule["AL16H"]["threshold_hours"] == 16
    assert "ALNONE" not in by_matricule


def test_attendance_alerts_ignores_completed_shift(client, auth_headers, db):
    _scan_event(db, event_id="done-arr", emp_id=910010, matricule="ALDONE", name="Parti", action="arrivee", hours_ago=20)
    _scan_event(db, event_id="done-dep", emp_id=910010, matricule="ALDONE", name="Parti", action="depart", hours_ago=1)
    r = client.get("/api/portal/attendance-alerts", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert not any(a["matricule"] == "ALDONE" for a in r.json()["presence_alerts"])


def test_attendance_alerts_thresholds_are_absolute_regardless_of_site_rotation(client, auth_headers, db):
    """Consigne produit : seuils absolus pour tout le monde, peu importe le régime de
    rotation du site (contrairement à overtime_alert, qui lui compare à la durée autorisée)."""
    site_std = _site(client, auth_headers, "Site Standard Alerte")
    site_24 = _site(client, auth_headers, "Site Rotation24 Alerte")
    r24 = client.put(f"/api/ops/sites/{site_24}", headers=auth_headers, json={"rotation_system": "24/48"})
    assert r24.status_code == 200, r24.text
    r_std = client.put(f"/api/ops/sites/{site_std}", headers=auth_headers, json={"rotation_system": "8h"})
    assert r_std.status_code == 200, r_std.text

    _scan_event(db, event_id="std-20h", emp_id=910020, matricule="ALSTD", name="Site Standard", action="arrivee", hours_ago=20, site_id=int(site_std))
    _scan_event(db, event_id="rot24-20h", emp_id=910021, matricule="ALROT24", name="Site Rotation24", action="arrivee", hours_ago=20, site_id=int(site_24))

    r = client.get("/api/portal/attendance-alerts", headers=auth_headers)
    assert r.status_code == 200, r.text
    by_matricule = {a["matricule"]: a for a in r.json()["presence_alerts"]}
    assert by_matricule["ALSTD"]["threshold_hours"] == 16
    assert by_matricule["ALROT24"]["threshold_hours"] == 16


def test_compute_attendance_alerts_weekly_total_counts_completed_shifts_only():
    """Logique pure testée avec un `now` maîtrisé (indépendant de l'heure réelle
    d'exécution des tests, contrairement à un test tout-HTTP proche d'un lundi minuit)."""
    from app.modules.portal.routes import _compute_attendance_alerts
    tz = ZoneInfo("Africa/Algiers")
    now = datetime(2026, 8, 7, 18, 0, tzinfo=tz)  # vendredi 18h
    monday_9am = datetime(2026, 8, 3, 9, 0, tzinfo=tz)
    rows = []
    for i in range(3):
        arr = monday_9am + timedelta(days=i)
        dep = arr + timedelta(hours=14)
        rows.append({"employeeId": 910030, "matricule": "ALWEEK", "agentName": "Semaine Chargee", "action": "arrivee", "scannedAt": arr.isoformat()})
        rows.append({"employeeId": 910030, "matricule": "ALWEEK", "agentName": "Semaine Chargee", "action": "depart", "scannedAt": dep.isoformat()})
    result = _compute_attendance_alerts(rows, now, tz)
    by_matricule = {a["matricule"]: a for a in result["weekly_alerts"]}
    assert "ALWEEK" in by_matricule
    assert by_matricule["ALWEEK"]["week_hours"] >= 40


def test_attendance_alerts_excludes_in_progress_shift_from_weekly_total(client, auth_headers, db):
    # Une seule arrivée sans départ : vacation en cours, ne doit pas compter dans le total
    # hebdomadaire, consigne explicite du produit — même si elle est déjà longue.
    _scan_event(db, event_id="week-open", emp_id=910040, matricule="ALOPEN", name="Encore Present", action="arrivee", hours_ago=2)
    r = client.get("/api/portal/attendance-alerts", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert not any(a["matricule"] == "ALOPEN" for a in r.json()["weekly_alerts"])


def test_attendance_alerts_requires_auth(client):
    r = client.get("/api/portal/attendance-alerts")
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


def test_paie_route_serves_autonomous_html(client):
    r = client.get("/paie")
    assert r.status_code == 200
    assert "PAIE — IRON GROUP" in r.text
    assert "__PAIE_AUTONOMOUS_APP__" in r.text


def test_cheque_route_serves_html(client):
    r = client.get("/cheque")
    assert r.status_code == 200
    assert "Impression Chèques" in r.text
    assert "BNA" in r.text


def test_cheque_host_serves_same_page(client):
    r = client.get("/", headers={"Host": "cheque.irongs.com"})
    assert r.status_code == 200
    assert "Impression Chèques" in r.text


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
