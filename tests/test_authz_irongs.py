"""Autorisation serveur (rôle × niveau) sur le pont legacy irongs (collections/items).

La paie s'écrit via ces endpoints. Calibrage : écrire un item = H2 (saisie),
SAUF clôtures/grilles de paie (paieClotures/paieGrilles) = H3 (validation) ;
supprimer un item = H4. Le cloisonnement société existant reste appliqué EN PLUS.
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
def irongs_h1(client, db):
    _mk(db, "irongs_h1", "H1")
    return _hdr(client, "irongs_h1")


@pytest.fixture
def irongs_h2(client, db):
    _mk(db, "irongs_h2", "H2")
    return _hdr(client, "irongs_h2")


def _create(client, headers, name, data):
    return client.post(f"/api/irongs/collections/{name}/items", headers=headers, json={"data": data})


# ── Axe ÉCRITURE (H2) ────────────────────────────────────────────────────────

def test_h1_ne_peut_pas_creer_item(client, irongs_h1):
    r = _create(client, irongs_h1, "notifications", {"id": "authz_n1", "message": "x"})
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h2_cree_item_normal(client, irongs_h2):
    r = _create(client, irongs_h2, "notifications", {"id": "authz_n2", "message": "x"})
    assert r.status_code in (200, 201), r.text


# ── Élévation PAIE : clôture = validation (H3) ───────────────────────────────

def test_h2_ne_peut_pas_creer_cloture_paie(client, irongs_h2):
    """Un H2 (saisie) écrit des items normaux mais PAS une clôture de paie (validation)."""
    r = _create(client, irongs_h2, "paieClotures", {"id": "authz_clo1", "ym": "2026-03"})
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h3_peut_creer_cloture_paie(client, restricted_headers):
    r = _create(client, restricted_headers, "paieClotures", {"id": "authz_clo2", "ym": "2026-03"})
    assert r.status_code in (200, 201), r.text


# ── Axe SUPPRESSION (H4) ─────────────────────────────────────────────────────

def test_h3_ne_peut_pas_supprimer_item(client, auth_headers, restricted_headers):
    created = _create(client, auth_headers, "notifications", {"id": "authz_del1", "message": "x"})
    assert created.status_code in (200, 201), created.text
    r = client.delete("/api/irongs/collections/notifications/items/authz_del1", headers=restricted_headers)
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


# ── Admin (H5) : bypass ──────────────────────────────────────────────────────

def test_admin_cree_et_supprime_item(client, auth_headers):
    created = _create(client, auth_headers, "notifications", {"id": "authz_adm1", "message": "x"})
    assert created.status_code in (200, 201), created.text
    r = client.delete("/api/irongs/collections/notifications/items/authz_adm1", headers=auth_headers)
    assert r.status_code in (200, 204), r.text
