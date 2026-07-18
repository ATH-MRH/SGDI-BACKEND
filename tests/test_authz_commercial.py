"""Autorisation serveur (rôle × niveau) appliquée au COMMERCIAL (Client CRUD SQL).

Client create/update = H2 (write), suppression = H4 (delete). Société inchangée.
"""
import pytest

from app.core.security import hash_password
from app.modules.auth.models import User

SOC = "Iron Global Securite"


def _mk(db, username, level):
    if not db.query(User).filter(User.username == username).first():
        db.add(User(
            username=username, email=f"{username}@t.com", full_name=username,
            role="rh", access_level=level, authorized_societies=[SOC],
            authorized_structures=[], password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()


def _hdr(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def com_h1(client, db):
    _mk(db, "com_h1", "H1")
    return _hdr(client, "com_h1")


def _client_payload(name):
    return {"name": name, "society": SOC}


def test_h1_ne_peut_pas_creer_client(client, com_h1):
    r = client.post("/api/commercial/clients", headers=com_h1, json=_client_payload("Client AuthZ H1"))
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h3_cree_client_mais_ne_supprime_pas(client, restricted_headers):
    created = client.post("/api/commercial/clients", headers=restricted_headers, json=_client_payload("Client AuthZ H3"))
    assert created.status_code in (200, 201), created.text
    cid = created.json()["id"]
    r = client.delete(f"/api/commercial/clients/{cid}", headers=restricted_headers)
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_admin_cree_et_supprime_client(client, auth_headers):
    created = client.post("/api/commercial/clients", headers=auth_headers, json=_client_payload("Client AuthZ Admin"))
    assert created.status_code in (200, 201), created.text
    cid = created.json()["id"]
    assert client.delete(f"/api/commercial/clients/{cid}", headers=auth_headers).status_code == 200
