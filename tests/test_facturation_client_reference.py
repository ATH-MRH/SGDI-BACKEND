"""Référentiel client limité de la Facturation (GET /api/irongs/facturation/clients).

Transmet ce dont la facture a besoin — activités (objet de facture), conditions de
paiement, catalogue tarifaire — et rien d'autre du client Commercial. Un compte
Facturation sans module Commercial le lit (200) sans jamais accéder à l'API Commercial."""
import uuid

import pytest
from sqlalchemy import delete, func, select

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.commercial.models import Client
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"
CATALOG = [{"designation": "Magasinier", "prixUnitaire": 3070.32, "unite": "Jour"},
           {"designation": "Cariste", "prixUnitaire": 3500, "unite": "Jour"},
           {"designation": "Team Leader", "prixUnitaire": 120000, "unite": "Mois"}]


@pytest.fixture(scope="module", autouse=True)
def _purge_clients_created_here():
    """Les clients créés ici (dont un au format liste) ne doivent pas rester dans la base de
    test partagée : module_cleanup ne purge pas la table clients."""
    from tests.conftest import TestSessionLocal

    with TestSessionLocal() as session:
        mark = session.scalar(select(func.max(Client.id))) or 0
    yield
    with TestSessionLocal() as session:
        session.execute(delete(Client).where(Client.id > mark))
        session.commit()


def _user(client, db, *, modules, societies):
    name = f"facref{uuid.uuid4().hex[:6]}"
    db.add(User(username=name, full_name=name, role="ops", access_level="H3", authorized_societies=societies, authorized_sites=[],
                authorized_structures=[], authorized_modules=modules, authorized_actions=["read", "create", "update", "validate"],
                password_hash=hash_password("facrefpass1"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "facrefpass1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _client(db, society, name, *, services=None, **data):
    row = Client(name=name, society=society, status="actif", services=services, notes="note commerciale interne",
                 portal_slug=f"p{uuid.uuid4().hex[:8]}", data={"nom": name, "societe": society, "notes": "note commerciale interne",
                                                              "opportunites": [{"titre": "secret"}], "historique": ["interne"],
                                                              "portalEnabled": True, "lignesFacturation": CATALOG, **data})
    db.add(row)
    db.commit()
    return row


def _reference(client, headers):
    r = client.get("/api/irongs/facturation/clients", headers=headers)
    assert r.status_code == 200, r.text
    return {row["nom"]: row for row in r.json()}


def test_activities_payment_conditions_and_catalog_are_transmitted(client, db):
    name = f"CLIENT LOGISTIQUE TEST {uuid.uuid4().hex[:4]}"
    _client(db, SOC, name, prestationsServices="Gestion logistique entrepôt", modePaiement="Virement bancaire",
            delaiPaiement="30 jours", delaiDepotFacture="3", remarqueFacture="Test conditions facture")
    ref = _reference(client, _user(client, db, modules=["fac"], societies=[SOC]))[name]
    assert ref["prestationsServices"] == "Gestion logistique entrepôt"
    assert (ref["modePaiement"], ref["delaiPaiement"], ref["delaiDepotFacture"], ref["remarqueFacture"]) == \
        ("Virement bancaire", "30 jours", "3", "Test conditions facture")
    assert [l["designation"] for l in ref["lignesFacturation"]] == ["Magasinier", "Cariste", "Team Leader"]
    # Minimum nécessaire : aucune donnée Commercial interne.
    for key in ("notes", "opportunites", "historique", "portalEnabled", "portalSlug", "portal_slug", "data"):
        assert key not in ref, key


def test_activity_formats_and_legacy_column_fallback(client, db):
    listed = f"LISTE {uuid.uuid4().hex[:4]}"
    legacy = f"COLONNE {uuid.uuid4().hex[:4]}"
    _client(db, SOC, listed, prestationsServices=["Gestion logistique entrepôt", "Transport", "Manutention"])
    _client(db, SOC, legacy, services="Gardiennage\nTélésurveillance")
    refs = _reference(client, _user(client, db, modules=["fac"], societies=[SOC]))
    assert refs[listed]["prestationsServices"] == ["Gestion logistique entrepôt", "Transport", "Manutention"]
    assert refs[legacy]["prestationsServices"] == "Gardiennage\nTélésurveillance"


def test_client_without_activity_gets_no_invented_activity(client, db):
    name = f"CLIENT SANS ACTIVITE {uuid.uuid4().hex[:4]}"
    _client(db, SOC, name)
    ref = _reference(client, _user(client, db, modules=["fac"], societies=[SOC]))[name]
    assert ref["prestationsServices"] == ""
    assert "modePaiement" not in ref and "remarqueFacture" not in ref        # jamais de valeur inventée
    assert len(ref["lignesFacturation"]) == 3


def test_rbac_and_society_scope(client, db):
    mine = f"SOC-A {uuid.uuid4().hex[:4]}"
    other = f"SOC-B {uuid.uuid4().hex[:4]}"
    _client(db, SOC, mine, prestationsServices="Activité A", modePaiement="Chèque")
    _client(db, OTHER, other, prestationsServices="Activité B confidentielle", modePaiement="Espèces", remarqueFacture="B")
    fac = _user(client, db, modules=["fac"], societies=[SOC])
    refs = _reference(client, fac)
    assert mine in refs and other not in refs
    assert "Activité B confidentielle" not in str(refs)
    # Aucune permission Commercial accordée : l'API Commercial complète reste refusée.
    assert client.get("/api/commercial/clients/page", headers=fac).status_code == 403
    assert client.get("/api/commercial/clients", headers=fac).status_code == 403
    # Sans module Facturation : référentiel refusé.
    assert client.get("/api/irongs/facturation/clients", headers=_user(client, db, modules=["drh"], societies=[SOC])).status_code == 403
