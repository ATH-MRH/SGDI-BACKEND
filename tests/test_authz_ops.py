"""Couche d'autorisation serveur (rôle × niveau) — pilote OPS.

Vérifie que `access_level` (H1-H5) est DÉSORMAIS réellement appliqué côté serveur,
alors qu'il était ignoré (seul H5 comptait). Le trou fermé : un H1 « Consultation »
pouvait créer/modifier/supprimer. On teste refus ET non-régression.

Niveaux (app/core/authz.py) : écrire=H2, valider/générer=H3, supprimer=H4 ; admin/H5 = bypass.
Le cloisonnement société reste appliqué EN PLUS (inchangé).
"""
import pytest

from app.core import authz
from app.core.security import hash_password
from app.modules.auth.models import User

SOC = "Iron Global Securite"


def _mk_user(db, username, role, level, societies=None):
    if not db.query(User).filter(User.username == username).first():
        db.add(User(
            username=username, email=f"{username}@t.com", full_name=username,
            role=role, access_level=level,
            authorized_societies=[SOC] if societies is None else societies,
            authorized_structures=[], password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()


def _headers(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _site_payload(name):
    return {
        "name": name, "indicatif": name[:3].upper(), "rotation_system": "24/48",
        "contractual_staff": 3, "active": 1, "equipment_plan": {"societe": SOC},
    }


@pytest.fixture
def h1_headers(client, db):
    """Utilisateur H1 (Consultation) autorisé sur la société, mais pas au niveau écriture."""
    _mk_user(db, "authz_h1", "ops", "H1")
    return _headers(client, "authz_h1")


@pytest.fixture
def h4_headers(client, db):
    """Utilisateur H4 (Supervision) — peut supprimer."""
    _mk_user(db, "authz_h4", "ops", "H4")
    return _headers(client, "authz_h4")


# ── Unitaires purs (hiérarchie des niveaux) ──────────────────────────────────

def test_hierarchie_niveaux_ordonnee():
    w = authz.LEVEL_WEIGHTS
    assert w["H1"] < w["H2"] < w["H3"] < w["H4"] < w["H5"]


def test_is_unrestricted_admin_ou_h5():
    assert authz.is_unrestricted(User(role="admin", access_level=None))
    assert authz.is_unrestricted(User(role="ops", access_level="H5"))
    assert authz.is_unrestricted(User(role="ADM2", access_level="H1"))  # variante rôle
    assert not authz.is_unrestricted(User(role="ops", access_level="H3"))


def test_assert_can_bloque_h1_en_ecriture():
    h1 = User(role="ops", access_level="H1")
    authz.assert_can(h1, "read")  # ok
    with pytest.raises(Exception):
        authz.assert_can(h1, "write")


def test_assert_can_h3_ecrit_mais_ne_supprime_pas():
    h3 = User(role="ops", access_level="H3")
    authz.assert_can(h3, "write")     # ok
    authz.assert_can(h3, "validate")  # ok
    with pytest.raises(Exception):
        authz.assert_can(h3, "delete")  # delete = H4


# ── Bout-en-bout HTTP sur le module OPS ──────────────────────────────────────

def test_h1_ne_peut_pas_creer_de_site(client, h1_headers):
    """LE TROU FERMÉ : un H1 (consultation) ne peut plus écrire."""
    r = client.post("/api/ops/sites", headers=h1_headers, json=_site_payload("Site H1 Interdit"))
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h1_ne_peut_pas_creer_affectation(client, h1_headers):
    r = client.post("/api/ops/assignments", headers=h1_headers, json={
        "employee_id": 1, "site_id": 1, "group_code": "A", "start_date": "2026-01-01", "active": 1,
    })
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h3_restreint_peut_toujours_creer_dans_sa_societe(client, restricted_headers):
    """Non-régression : le niveau H3 (saisie/validation) écrit toujours dans SA société."""
    r = client.post("/api/ops/sites", headers=restricted_headers, json=_site_payload("Site H3 Autorise"))
    assert r.status_code in (200, 201), r.text


def test_h3_ne_peut_pas_supprimer_un_site(client, restricted_headers):
    """Nouvelle politique : la suppression exige la supervision (H4)."""
    created = client.post("/api/ops/sites", headers=restricted_headers, json=_site_payload("Site H3 NoDelete"))
    assert created.status_code in (200, 201), created.text
    site_id = created.json()["id"]
    r = client.delete(f"/api/ops/sites/{site_id}", headers=restricted_headers)
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h4_supervision_peut_supprimer(client, h4_headers):
    created = client.post("/api/ops/sites", headers=h4_headers, json=_site_payload("Site H4 Delete"))
    assert created.status_code in (200, 201), created.text
    site_id = created.json()["id"]
    r = client.delete(f"/api/ops/sites/{site_id}", headers=h4_headers)
    assert r.status_code == 200, r.text


def test_admin_h5_bypass_total(client, auth_headers):
    """L'admin (H5) crée ET supprime sans restriction de niveau."""
    created = client.post("/api/ops/sites", headers=auth_headers, json=_site_payload("Site Admin"))
    assert created.status_code in (200, 201), created.text
    site_id = created.json()["id"]
    assert client.delete(f"/api/ops/sites/{site_id}", headers=auth_headers).status_code == 200
