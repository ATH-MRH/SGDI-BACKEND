"""Autorisation serveur (rôle × niveau) — PORTAIL (staff) et RONDE (admin).

Garde UNIQUEMENT les endpoints staff (accounts CRUD, push/send, circuits/checkpoints).
Les endpoints EMPLOYÉ/PUBLIC (login, self-register, pointage, portal_token) restent LIBRES.
"""
import pytest

from app.core.security import hash_password
from app.modules.auth.models import User

SOC = "Iron Global Securite"


def _mk(db, username, level):
    if not db.query(User).filter(User.username == username).first():
        db.add(User(
            username=username, email=f"{username}@t.com", full_name=username,
            role="ops", access_level=level, authorized_societies=[SOC],
            authorized_structures=[], password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()


def _hdr(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def h1_headers(client, db):
    _mk(db, "pr_h1", "H1")
    return _hdr(client, "pr_h1")


# ── RONDE (staff : circuits) ─────────────────────────────────────────────────

def test_h1_ne_peut_pas_creer_circuit(client, h1_headers):
    r = client.post("/api/ronde/circuits", headers=h1_headers, json={"name": "Circuit H1"})
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h3_cree_circuit_mais_ne_supprime_pas(client, restricted_headers):
    created = client.post("/api/ronde/circuits", headers=restricted_headers, json={"name": "Circuit AuthZ"})
    assert created.status_code in (200, 201), created.text
    cid = created.json()["id"]
    r = client.delete(f"/api/ronde/circuits/{cid}", headers=restricted_headers)
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_admin_cree_et_supprime_circuit(client, auth_headers):
    created = client.post("/api/ronde/circuits", headers=auth_headers, json={"name": "Circuit Admin"})
    assert created.status_code in (200, 201), created.text
    cid = created.json()["id"]
    assert client.delete(f"/api/ronde/circuits/{cid}", headers=auth_headers).status_code in (200, 204)


# ── PORTAIL (staff : gestion de comptes) ─────────────────────────────────────

def test_h1_ne_peut_pas_creer_compte_portail(client, h1_headers):
    # require_level s'exécute AVANT la recherche de l'employé -> 403 niveau, pas 404.
    r = client.post("/api/portal/accounts", headers=h1_headers, json={"matricule": "X001", "password": "secret6"})
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


# ── SANITY : les endpoints PUBLICS ne sont PAS gardés par un niveau ──────────

def test_endpoint_public_login_non_garde(client):
    """POST /portal/login (public) ne doit PAS être gardé par un niveau : son 403 éventuel
    vient des identifiants, jamais de require_level. On vérifie l'absence du message de niveau."""
    r = client.post("/api/portal/login", json={"username": "inconnu", "password": "faux"})
    detail = str(r.json().get("detail", "")).lower()
    assert "niveau" not in detail, r.text  # ce n'est PAS un refus de niveau (login reste libre)
