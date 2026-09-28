"""Facturation — RBAC de la validation d'une facture et compte « Facturation seul ».

Validation (POST /api/irongs/factures/{id}/valider) : module Facturation + action « validate »
+ société autorisée, exactement comme les autres écritures de la collection « factures ».
Compte Facturation seul : lit ses factures et le référentiel client limité nécessaire à la
facturation, sans recevoir les modules DRH ni Commercial."""
import uuid

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.commercial.models import Client
from app.modules.finance_models import Invoice
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"


def _user(client, db, *, modules, societies, actions=None):
    name = f"facrbac{uuid.uuid4().hex[:6]}"
    db.add(User(username=name, full_name=name, role="ops", access_level="H3", authorized_societies=societies, authorized_sites=[],
                authorized_structures=[], authorized_modules=modules, authorized_actions=actions,
                password_hash=hash_password("facrbacpass1"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "facrbacpass1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _draft(client, headers, society=SOC):
    data = {"id": f"fc_rbac_{uuid.uuid4().hex[:8]}", "numero": "BROUILLON", "statut": "brouillon", "societe": society,
            "client": "CLIENT RBAC", "date": "2026-09-28",
            "lignes": [{"type": "article", "designation": "MAGASINIER", "unite": "Jour", "nbr": 30, "qte": 25,
                        "prixUnitHT": 3070.32, "tva": 19}]}
    r = client.post("/api/irongs/collections/factures/items", headers=headers, json={"data": data})
    assert r.status_code == 200, r.text
    return data["id"]


def _valider(client, headers, item_id):
    return client.post(f"/api/irongs/factures/{item_id}/valider", headers=headers)


def _status(db, item_id):
    db.expire_all()
    return db.query(Invoice).filter(Invoice.external_id == item_id).one().status


def test_validation_requires_the_facturation_module(client, auth_headers, db):
    item_id = _draft(client, auth_headers)
    for modules in (["site_workforce"], ["dc"], ["drh"], []):
        headers = _user(client, db, modules=modules, societies=[SOC], actions=["read", "create", "update", "validate"])
        r = _valider(client, headers, item_id)
        assert r.status_code == 403, (modules, r.status_code, r.text)
    assert _status(db, item_id) == "brouillon"


def test_validation_requires_the_validate_action(client, auth_headers, db):
    item_id = _draft(client, auth_headers)
    headers = _user(client, db, modules=["fac"], societies=[SOC], actions=["read", "create", "update"])
    assert _valider(client, headers, item_id).status_code == 403
    assert _status(db, item_id) == "brouillon"


def test_validation_requires_the_invoice_society(client, auth_headers, db):
    item_id = _draft(client, auth_headers)
    headers = _user(client, db, modules=["fac"], societies=[OTHER], actions=["read", "create", "update", "validate"])
    assert _valider(client, headers, item_id).status_code in (403, 404)
    assert _status(db, item_id) == "brouillon"


def test_facturation_account_validates_its_society_invoice(client, auth_headers, db):
    headers = _user(client, db, modules=["fac"], societies=[SOC], actions=["read", "create", "update", "validate"])
    item_id = _draft(client, headers)
    r = _valider(client, headers, item_id)
    assert r.status_code == 200, r.text
    assert r.json()["statut"] == "emise" and r.json()["totalHT"] == 2302740.0


# ── Compte Facturation seul ─────────────────────────────────────────────────────────────
def test_facturation_only_account_lists_its_drafts_without_drh_or_commercial(client, db):
    headers = _user(client, db, modules=["fac"], societies=[SOC], actions=["read", "create", "update", "validate"])
    item_id = _draft(client, headers)
    listed = client.get("/api/irongs/collections/factures/items", headers=headers)
    assert listed.status_code == 200, listed.text
    assert any(row.get("id") == item_id and row["lignes"][0]["nbr"] == 30 for row in listed.json())
    # Aucun module implicite : DRH et Commercial restent refusés.
    assert client.get("/api/drh/employees", headers=headers).status_code == 403
    assert client.get("/api/commercial/clients", headers=headers).status_code == 403


def _client_row(db, society, name, **data):
    row = Client(name=name, legal_name=f"{name} SPA", society=society, status="actif", address="Alger", nif="NIF1", rc="RC1",
                 ai="AI1", nis="NIS1", email="c@example.com", phone="0550", contact_name="Contact", notes="note interne",
                 data={"nom": name, "notes": "note interne", "dcContract": {"secret": 1}, **data})
    db.add(row)
    db.commit()
    return row


def test_billing_client_reference_is_limited_and_scoped(client, db):
    catalog = {"lignesFacturation": [{"designation": "MAGASINIER", "prixUnitaire": 3070.32}],
               "tech_sites": [{"id": "s1", "nom": "Site A", "adresse": "Oran", "totalEffectif": 30, "notes": "privé",
                               "lignesFacturation": [{"designation": "MAGASINIER", "qte": 30, "prixUnitaire": 3070.32}]}]}
    mine = _client_row(db, SOC, f"CLIENT-{uuid.uuid4().hex[:5]}", **catalog)
    other = _client_row(db, OTHER, f"AUTRE-{uuid.uuid4().hex[:5]}")
    fac = _user(client, db, modules=["fac"], societies=[SOC], actions=["read"])
    r = client.get("/api/irongs/facturation/clients", headers=fac)
    assert r.status_code == 200, r.text
    rows = {row["nom"]: row for row in r.json()}
    assert mine.name in rows and other.name not in rows
    ref = rows[mine.name]
    assert ref["backendId"] == mine.id and ref["societe"] == SOC and ref["nif"] == "NIF1" and ref["adresse"] == "Alger"
    assert ref["lignesFacturation"] == catalog["lignesFacturation"]
    assert ref["tech_sites"] == [{"id": "s1", "nom": "Site A", "adresse": "Oran",
                                  "lignesFacturation": catalog["tech_sites"][0]["lignesFacturation"]}]
    # Référentiel limité : aucune donnée commerciale interne.
    assert "notes" not in ref and "dcContract" not in ref and "portalSlug" not in ref
    # Sans module Facturation : refusé.
    for modules in (["drh"], ["site_workforce"]):
        denied = _user(client, db, modules=modules, societies=[SOC], actions=["read"])
        assert client.get("/api/irongs/facturation/clients", headers=denied).status_code == 403, modules
