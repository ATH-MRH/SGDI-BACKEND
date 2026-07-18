"""Autorisation serveur (rôle × niveau) appliquée au MATÉRIEL.

Le module était « société seulement » (sauf 3 endpoints déjà admin_system). On ajoute
l'axe niveau : créer/éditer/dotation/mouvement = H2, suppression (fournisseur/mouvement) = H4.
Les suppressions de stores/articles et la dotation initiale en masse restent admin_system.
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
def mat_h1(client, db):
    _mk(db, "mat_h1", "H1")
    return _hdr(client, "mat_h1")


def _supplier():
    return {"name": "Fournisseur AuthZ", "society": SOC, "phone": "0550000000"}


def _store(code):
    return {"name": "Magasin AuthZ", "code": code, "society": SOC}


# ── H1 (consultation) refusé sur toute écriture ──────────────────────────────

def test_h1_ne_peut_pas_creer_store(client, mat_h1):
    r = client.post("/api/materiel/stores", headers=mat_h1, json=_store("MGAUTHZ1"))
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h1_ne_peut_pas_creer_fournisseur(client, mat_h1):
    r = client.post("/api/materiel/suppliers", headers=mat_h1, json=_supplier())
    assert r.status_code == 403, r.text


# ── H3 : crée (H2) mais ne supprime pas un fournisseur (H4) ──────────────────

def test_h3_cree_fournisseur_mais_ne_supprime_pas(client, restricted_headers):
    created = client.post("/api/materiel/suppliers", headers=restricted_headers, json=_supplier())
    assert created.status_code in (200, 201), created.text
    sid = created.json()["id"]
    r = client.delete(f"/api/materiel/suppliers/{sid}", headers=restricted_headers)
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


# ── Admin (H5) : bypass ──────────────────────────────────────────────────────

def test_admin_cree_et_supprime_fournisseur(client, auth_headers):
    created = client.post("/api/materiel/suppliers", headers=auth_headers, json=_supplier())
    assert created.status_code in (200, 201), created.text
    sid = created.json()["id"]
    assert client.delete(f"/api/materiel/suppliers/{sid}", headers=auth_headers).status_code == 200
