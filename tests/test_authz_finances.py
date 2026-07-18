"""Autorisation serveur (rôle × niveau) appliquée aux FINANCES (accounting/achats/ventes).

Ces modules étaient « société seulement » (aucun contrôle de niveau) : un H1 « Consultation »
pouvait créer/valider/supprimer écritures, commandes, devis. On vérifie le refus + non-régression.
Niveaux : créer/éditer/lignes=H2 · valider/convertir/annuler/payer=H3 · supprimer un document=H4.
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
def fin_h1(client, db):
    """Utilisateur Finances niveau H1 (consultation)."""
    _mk(db, "fin_h1", "H1")
    return _hdr(client, "fin_h1")


def _compte(numero):
    return {"numero": numero, "libelle": "Compte AuthZ", "type_compte": "charge", "society": SOC}


def _devis():
    return {
        "society": SOC, "client_name": "ACME", "date_devis": "2026-03-01", "objet": "Test",
        "lignes": [{"designation": "Agent", "quantite": 1, "prix_unitaire_ht": 1000, "tva_pct": 19}],
    }


# ── H1 (consultation) refusé sur toute écriture ──────────────────────────────

def test_h1_ne_peut_pas_creer_compte(client, fin_h1):
    r = client.post("/api/accounting/comptes", headers=fin_h1, json=_compte("690101"))
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_h1_ne_peut_pas_creer_fournisseur(client, fin_h1):
    r = client.post("/api/achats/fournisseurs", headers=fin_h1, json={"name": "F", "society": SOC, "phone": "0550000000"})
    assert r.status_code == 403, r.text


def test_h1_ne_peut_pas_creer_devis(client, fin_h1):
    r = client.post("/api/ventes/devis", headers=fin_h1, json=_devis())
    assert r.status_code == 403, r.text


# ── H3 : crée (H2) mais ne supprime pas un document (H4) ─────────────────────

def test_h3_cree_compte_mais_ne_supprime_pas(client, restricted_headers):
    created = client.post("/api/accounting/comptes", headers=restricted_headers, json=_compte("690201"))
    assert created.status_code in (200, 201), created.text
    cid = created.json()["id"]
    r = client.delete(f"/api/accounting/comptes/{cid}", headers=restricted_headers)
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


# ── Admin (H5) : bypass total ────────────────────────────────────────────────

def test_admin_cree_et_supprime_compte(client, auth_headers):
    created = client.post("/api/accounting/comptes", headers=auth_headers, json=_compte("690301"))
    assert created.status_code in (200, 201), created.text
    cid = created.json()["id"]
    assert client.delete(f"/api/accounting/comptes/{cid}", headers=auth_headers).status_code == 200
