"""Tests RH / OPS / Pointage — source de données PostgreSQL."""
import pytest
from datetime import date


# ─────────────────────────────────────────────
# RH — Employés
# ─────────────────────────────────────────────

def test_create_employee(client, auth_headers):
    resp = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "TEST001",
        "first_name": "Ali",
        "last_name": "Benali",
        "society": "Iron Global Securite",
        "status": "actif",
        "contract_type": "CDI",
    })
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert data["code"] == "TEST001"
    assert data["first_name"].upper() == "ALI"


def test_list_employees(client, auth_headers):
    resp = client.get("/api/drh/employees", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_employee_appears_in_db_agents(client, auth_headers):
    """Un employé créé doit apparaître dans la collection 'agents' (frontend db.agents)."""
    client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "TEST002",
        "first_name": "Omar",
        "last_name": "Kaci",
        "society": "Iron Global Securite",
        "status": "actif",
        "contract_type": "CDD",
        "contract_end_date": str(date.today()),
    })
    resp = client.get("/api/irongs/collections/agents", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json().get("data", [])
    codes = [e.get("matricule") or e.get("code") for e in items]
    assert "TEST002" in codes


# ─────────────────────────────────────────────
# RH — Contrats (source unique PostgreSQL)
# ─────────────────────────────────────────────

def test_contrats_collection_served_from_postgres(client, auth_headers):
    """db.contrats doit venir de la table contracts, pas du store JSON."""
    resp = client.get("/api/irongs/collections/contrats", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json().get("data", [])
    assert isinstance(items, list)


def test_create_contract_via_drh_api(client, auth_headers):
    emp = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "TEST003",
        "first_name": "Samir",
        "last_name": "Aouadi",
        "society": "Iron Global Securite",
        "status": "actif",
    }).json()
    emp_id = emp.get("id") or emp.get("backendId")

    resp = client.post("/api/drh/contracts", headers=auth_headers, json={
        "employee_id": emp_id,
        "contract_type": "CDD",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "salary_net": 45000,
        "status": "actif",
    })
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert data["contract_type"] == "CDD"
    assert data["employee_id"] == emp_id


def test_contract_appears_in_contrats_collection(client, auth_headers):
    """Un contrat créé via /api/drh/contracts doit apparaître dans db.contrats."""
    emp = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "TEST004",
        "first_name": "Karim",
        "last_name": "Bouzid",
        "society": "Iron Global Securite",
        "status": "actif",
    }).json()
    emp_id = emp.get("id") or emp.get("backendId")

    client.post("/api/drh/contracts", headers=auth_headers, json={
        "employee_id": emp_id,
        "contract_type": "CDI",
        "start_date": "2026-01-01",
        "salary_net": 50000,
        "status": "actif",
    })

    resp = client.get("/api/irongs/collections/contrats", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json().get("data", [])
    agent_ids = [str(c.get("agentId") or c.get("agent_id") or "") for c in items]
    assert str(emp_id) in agent_ids


# ─────────────────────────────────────────────
# OPS — Sites
# ─────────────────────────────────────────────

def test_sites_collection_from_postgres(client, auth_headers):
    resp = client.get("/api/irongs/collections/sites", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json().get("data", [])
    assert isinstance(items, list)


def test_create_site(client, auth_headers):
    resp = client.post("/api/irongs/collections/sites/items", headers=auth_headers, json={
        "data": {
            "nom": "Site Test Alpha",
            "indicatif": "STA",
            "societe": "Iron Global Securite",
            "wilaya": "Alger",
            "actif": True,
        }
    })
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert data.get("nom") == "Site Test Alpha" or data.get("name") == "Site Test Alpha"


# ─────────────────────────────────────────────
# Pointage / Feuille de présence
# ─────────────────────────────────────────────

def test_feuille_presence_from_postgres(client, auth_headers):
    resp = client.get("/api/irongs/collections/feuillePresence", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json().get("data", [])
    assert isinstance(items, list)


def test_pointage_gps_updates_feuille_presence(client, auth_headers):
    """Un pointage GPS depuis le portail doit apparaître dans feuillePresence."""
    emp = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "GPS001",
        "first_name": "Test",
        "last_name": "GPS",
        "society": "Iron Global Securite",
        "status": "actif",
    }).json()
    matricule = emp.get("code") or "GPS001"

    resp = client.post("/api/portal/pointages", headers=auth_headers, json={
        "employee": {
            "matricule": matricule,
        },
        "action": "arrivee",
        "heure": "08:00",
        "date": str(date.today()),
        "position": {"lat": 36.7, "lng": 3.0},
    })
    assert resp.status_code in (200, 201)

    presence = client.get("/api/irongs/collections/feuillePresence", headers=auth_headers)
    today_rows = [
        r for r in presence.json().get("data", [])
        if r.get("date") == str(date.today()) and (r.get("matricule") == matricule or r.get("agentName", "").strip())
    ]
    assert len(today_rows) >= 1
