"""Confidentialité inter-sociétés en LECTURE — cas MULTI-SOCIÉTÉS (fuites de l'audit).

Un utilisateur avec >=2 sociétés autorisées et sans paramètre `society` ne doit PAS
voir/agréger les données d'une société non autorisée (comptes, balance comptable).
Le patron est identique pour les exports xlsx achats/ventes (même correctif appliqué).
"""
import json

import pytest

from app.core.security import hash_password
from app.modules.auth.models import User

SOC = "Iron Global Securite"
SOC2 = "Iron Global Solution"
FOREIGN = "Sword Corporation"


@pytest.fixture
def multi_soc_headers(client, db):
    if not db.query(User).filter(User.username == "fin_multi").first():
        db.add(User(
            username="fin_multi", email="fm@t.com", full_name="Fin Multi",
            role="rh", access_level="H4", authorized_societies=[SOC, SOC2],
            authorized_structures=[], password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()
    r = client.post("/api/auth/login", json={"username": "fin_multi", "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _compte(client, h, numero, society):
    r = client.post("/api/accounting/comptes", headers=h, json={
        "numero": numero, "libelle": "C", "type_compte": "charge", "society": society,
    })
    assert r.status_code in (200, 201), r.text
    return numero


def _ecriture_validee(client, h, society, c1, c2):
    ec = client.post("/api/accounting/ecritures", headers=h, json={
        "society": society, "date_ecriture": "2026-05-01", "libelle": "E", "journal": "ACH",
        "lignes": [
            {"compte_numero": c1, "debit": 10000, "credit": 0},
            {"compte_numero": c2, "debit": 0, "credit": 10000},
        ],
    }).json()
    v = client.post(f"/api/accounting/ecritures/{ec['id']}/valider", headers=h)
    assert v.status_code == 200, v.text


def test_multi_societe_comptes_ne_fuit_pas(client, auth_headers, multi_soc_headers):
    _compte(client, auth_headers, "690901", SOC)
    _compte(client, auth_headers, "690902", FOREIGN)
    numeros = {c["numero"] for c in client.get("/api/accounting/comptes", headers=multi_soc_headers).json()}
    assert "690902" not in numeros, "compte d'une société non autorisée visible (liste)"
    page = {c["numero"] for c in client.get("/api/accounting/comptes/page?page_size=200", headers=multi_soc_headers).json()["items"]}
    assert "690902" not in page


def test_multi_societe_balance_ne_fuit_pas(client, auth_headers, multi_soc_headers):
    c1 = _compte(client, auth_headers, "690911", FOREIGN)
    c2 = _compte(client, auth_headers, "690912", FOREIGN)
    _ecriture_validee(client, auth_headers, FOREIGN, c1, c2)
    balance = client.get("/api/accounting/balance", headers=multi_soc_headers).json()
    blob = json.dumps(balance)
    assert "690911" not in blob and "690912" not in blob, "écriture d'une société non autorisée agrégée dans la balance"
    # Témoin : l'admin (non restreint) voit bien l'écriture étrangère.
    admin_blob = json.dumps(client.get("/api/accounting/balance", headers=auth_headers).json())
    assert "690911" in admin_blob
