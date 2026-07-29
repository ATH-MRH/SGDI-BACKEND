"""Pointage QR employé + saisie manuelle (pointeur) — vrais endpoints, vraie base.

Couvre /api/portal/attendance-qr/scan (via le refactor _register_attendance) et les
nouveaux endpoints /api/portal/attendance-manual/search + /attendance-manual/scan,
ajoutés pour les employés sans smartphone (le pointeur tape le code/nom, puis confirme).
"""
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


def test_manual_search_too_short_returns_empty(client, auth_headers):
    r = client.get("/api/portal/attendance-manual/search?q=a", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


def test_manual_scan_toggles_arrival_then_departure(client, auth_headers):
    emp_id = _emp(client, auth_headers, "PTM03", fn="Amine", ln="Ouali")
    r1 = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": emp_id})
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    assert body1["success"] is True
    assert body1["action"] == "arrivee"
    assert body1["employee"]["matricule"] == "PTM03"
    assert body1["employee"]["nom"] == "OUALI"

    r2 = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": emp_id})
    assert r2.status_code == 201, r2.text
    assert r2.json()["action"] == "depart"


def test_manual_scan_unknown_employee_404(client, auth_headers):
    r = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": 99999999})
    assert r.status_code == 404, r.text


def test_manual_scan_requires_auth(client):
    r = client.post("/api/portal/attendance-manual/scan", json={"employee_id": 1})
    assert r.status_code == 401
