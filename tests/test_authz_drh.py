"""Autorisation serveur (rôle × niveau) appliquée au DRH (le module central).

Niveaux : créer/éditer employé, contrat, sanction, document, modèle = H2 ;
valider (validate-section/final, recruit, marquer-contractualisation, congé approve/refuse) = H3 ;
supprimer un document (employé, candidat, modèle, clause) = H4. repair-codes reste admin_system.
"""
from datetime import date, timedelta

import pytest

from app.core.security import hash_password
from app.modules.auth.models import User

SOC = "Iron Global Securite"


def _mk(db, username, level):
    if not db.query(User).filter(User.username == username).first():
        db.add(User(
            username=username, email=f"{username}@t.com", full_name=username,
            role="rh", access_level=level, authorized_societies=[SOC],
            authorized_structures=["drh"], password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()


def _hdr(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def drh_h1(client, db):
    _mk(db, "drh_h1", "H1")
    return _hdr(client, "drh_h1")


@pytest.fixture
def drh_h3(client, db):
    _mk(db, "drh_h3", "H3")
    return _hdr(client, "drh_h3")


def _emp_payload(code):
    return {"code": code, "first_name": "A", "last_name": "B", "society": SOC, "status": "actif"}


def _create_emp(client, h, code):
    r = client.post("/api/drh/employees", headers=h, json=_emp_payload(code))
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _create_leave(client, h, emp_id):
    r = client.post("/api/drh/leaves", headers=h, json={
        "employee_id": emp_id, "leave_type": "conge",
        "start_date": str(date.today()), "end_date": str(date.today() + timedelta(days=3)), "reason": "Test",
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ── Axe ÉCRITURE (H2) ────────────────────────────────────────────────────────

def test_h1_ne_peut_pas_creer_employe(client, drh_h1):
    r = client.post("/api/drh/employees", headers=drh_h1, json=_emp_payload("AUTHZ-DRH-1"))
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h3_cree_employe(client, drh_h3):
    r = client.post("/api/drh/employees", headers=drh_h3, json=_emp_payload("AUTHZ-DRH-2"))
    assert r.status_code in (200, 201), r.text


# ── Axe VALIDATION (H3) — approbation de congé ───────────────────────────────

def test_h1_ne_peut_pas_approuver_conge(client, auth_headers, drh_h1):
    eid = _create_emp(client, auth_headers, "AUTHZ-DRH-4")
    lid = _create_leave(client, auth_headers, eid)
    r = client.post(f"/api/drh/leaves/{lid}/approve", headers=drh_h1)
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h3_peut_approuver_conge(client, auth_headers, drh_h3):
    eid = _create_emp(client, auth_headers, "AUTHZ-DRH-5")
    lid = _create_leave(client, auth_headers, eid)
    r = client.post(f"/api/drh/leaves/{lid}/approve", headers=drh_h3)
    assert r.status_code == 200, r.text


# ── Axe SUPPRESSION (H4) ─────────────────────────────────────────────────────

def test_h3_ne_peut_pas_supprimer_employe(client, auth_headers, drh_h3):
    eid = _create_emp(client, auth_headers, "AUTHZ-DRH-3")
    r = client.delete(f"/api/drh/employees/{eid}", headers=drh_h3)
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


# ── Admin (H5) : bypass ──────────────────────────────────────────────────────

def test_admin_cree_et_supprime_employe(client, auth_headers):
    eid = _create_emp(client, auth_headers, "AUTHZ-DRH-6")
    assert client.delete(f"/api/drh/employees/{eid}", headers=auth_headers).status_code == 200
