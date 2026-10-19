"""Facturation — intégrité financière (Lot 0).

Règlements, avoirs, avances et caisse enregistrés par l'API (et non plus seulement dans le
navigateur), montants contrôlés et arrondis au centime côté serveur, reste à encaisser
respecté, écritures de caisse liées créées et supprimées avec leur pièce, numéros d'avoir
attribués par le serveur, TVA à 0 % et taux personnalisés conservés, statut et numéro d'une
facture réservés à la validation, factures émises conservées, périmètre société et module.
"""
import uuid

import pytest

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.finance_models import Advance, CashEntry, CreditNote, Invoice, Payment
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"
BASE = "/api/irongs/collections"


def _uid(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _user(client, db, *, modules, societies, actions=None):
    name = f"facint{uuid.uuid4().hex[:6]}"
    db.add(User(username=name, full_name=name, role="ops", access_level="H3", authorized_societies=societies,
                authorized_sites=[], authorized_structures=[], authorized_modules=modules,
                authorized_actions=actions, password_hash=hash_password("facintpass1"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "facintpass1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _line(**over):
    return {"type": "article", "designation": "AGENT", "unite": "Jour", "nbr": 1, "qte": 1, "prixUnitHT": 1000, **over}


def _draft(client, headers, *, society=SOC, lines=None, **extra):
    data = {"id": _uid("fc_int"), "numero": "BROUILLON", "statut": "brouillon", "societe": society,
            "client": "CLIENT INTEGRITE", "date": "2026-10-01", "lignes": lines if lines is not None else [_line()], **extra}
    r = client.post(f"{BASE}/factures/items", headers=headers, json={"data": data})
    assert r.status_code == 200, r.text
    return r.json()


def _issued(client, headers, **kwargs):
    draft = _draft(client, headers, **kwargs)
    r = client.post(f"/api/irongs/factures/{draft['id']}/valider", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _rows(client, headers, name):
    r = client.get(f"{BASE}/{name}/items", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _find(client, headers, name, item_id):
    return next((row for row in _rows(client, headers, name) if str(row.get("id")) == str(item_id)), None)


def _pay(http, headers, invoice_id, montant, **extra):
    data = {"id": _uid("pa"), "factureId": invoice_id, "date": "2026-10-10", "montant": montant,
            "mode": "Chèque", "reference": "CHQ-1", **extra}
    return http.post(f"{BASE}/paiements/items", headers=headers, json={"data": data})


def _credit(http, headers, invoice_id, montant, **extra):
    data = {"id": _uid("avo"), "factureId": invoice_id, "date": "2026-10-12", "montant": montant, "motif": "Correction", **extra}
    return http.post(f"{BASE}/avoirs/items", headers=headers, json={"data": data})


# ── Règlements ────────────────────────────────────────────────────────────────────────────

def test_payment_is_stored_on_the_invoice_society_with_its_cash_entry(client, auth_headers, db):
    invoice = _issued(client, auth_headers)
    assert invoice["ttc"] == 1190.0
    r = _pay(client, auth_headers, invoice["id"], "500,004", societe=OTHER, client="AUTRE")
    assert r.status_code == 200, r.text
    payment = r.json()
    assert payment["montant"] == 500.0 and payment["societe"] == SOC and payment["client"] == "CLIENT INTEGRITE"
    db.expire_all()
    row = db.query(Payment).filter(Payment.external_id == payment["id"]).one()
    assert row.amount == 500.0 and row.invoice_external_id == invoice["id"] and row.society == SOC
    cash = db.query(CashEntry).filter(CashEntry.external_id == f"cs_{payment['id']}").one()
    assert (cash.amount, cash.entry_type, cash.category, cash.society) == (500.0, "entree", "Encaissement facture", SOC)
    assert cash.data["_legacy"]["paiementId"] == payment["id"]


def test_partial_then_full_payment_and_overpayment_refused(client, auth_headers):
    invoice = _issued(client, auth_headers)
    assert _pay(client, auth_headers, invoice["id"], 400).status_code == 200
    over = _pay(client, auth_headers, invoice["id"], 790.01)
    assert over.status_code == 409, over.text
    assert _pay(client, auth_headers, invoice["id"], 790).status_code == 200
    assert _pay(client, auth_headers, invoice["id"], 0.01).status_code == 409


def test_credit_note_reduces_the_amount_still_due(client, auth_headers):
    invoice = _issued(client, auth_headers)
    assert _credit(client, auth_headers, invoice["id"], 190).status_code == 200
    assert _pay(client, auth_headers, invoice["id"], 1000.01).status_code == 409
    assert _pay(client, auth_headers, invoice["id"], 1000).status_code == 200


@pytest.mark.parametrize("montant", [0, -5, "abc", None, "1e400"])
def test_payment_amount_must_be_a_positive_decimal(client, auth_headers, montant):
    invoice = _issued(client, auth_headers)
    assert _pay(client, auth_headers, invoice["id"], montant).status_code == 422


def test_payment_requires_an_issued_invoice(client, auth_headers):
    draft = _draft(client, auth_headers)
    assert _pay(client, auth_headers, draft["id"], 10).status_code == 409
    assert _pay(client, auth_headers, "fc_inexistante", 10).status_code == 404
    assert _pay(client, auth_headers, "", 10).status_code == 422


def test_payment_replay_is_idempotent_and_recorded_payment_is_not_rewritten(client, auth_headers, db):
    invoice = _issued(client, auth_headers)
    data = {"id": _uid("pa"), "factureId": invoice["id"], "date": "2026-10-10", "montant": 300, "mode": "Espèces"}
    first = client.post(f"{BASE}/paiements/items", headers=auth_headers, json={"data": data})
    replay = client.post(f"{BASE}/paiements/items", headers=auth_headers, json={"data": data})
    assert first.status_code == replay.status_code == 200
    db.expire_all()
    assert db.query(Payment).filter(Payment.external_id == data["id"]).count() == 1
    assert db.query(CashEntry).filter(CashEntry.external_id == f"cs_{data['id']}").count() == 1
    changed = client.put(f"{BASE}/paiements/items/{data['id']}", headers=auth_headers,
                         json={"data": {**data, "montant": 900}})
    assert changed.status_code == 409, changed.text
    assert _find(client, auth_headers, "paiements", data["id"])["montant"] == 300.0


def test_deleting_a_payment_removes_its_cash_entry_which_cannot_be_deleted_alone(client, auth_headers, db):
    invoice = _issued(client, auth_headers)
    payment = _pay(client, auth_headers, invoice["id"], 250).json()
    linked = client.delete(f"{BASE}/caisse/items/cs_{payment['id']}", headers=auth_headers)
    assert linked.status_code == 409, linked.text
    assert client.delete(f"{BASE}/paiements/items/{payment['id']}", headers=auth_headers).status_code == 200
    db.expire_all()
    assert db.query(Payment).filter(Payment.external_id == payment["id"]).count() == 0
    assert db.query(CashEntry).filter(CashEntry.external_id == f"cs_{payment['id']}").count() == 0


# ── Avoirs ────────────────────────────────────────────────────────────────────────────────

def test_credit_note_number_is_assigned_by_the_server(client, auth_headers, db):
    invoice = _issued(client, auth_headers)
    first = _credit(client, auth_headers, invoice["id"], 10, numero="AV-2026-9999").json()
    second = _credit(client, auth_headers, invoice["id"], 10, numero="AV-2026-9999").json()
    assert first["numero"].startswith("AV-2026-") and first["numero"] != "AV-2026-9999"
    assert int(second["numero"].rsplit("-", 1)[1]) == int(first["numero"].rsplit("-", 1)[1]) + 1
    assert first["societe"] == SOC
    db.expire_all()
    assert db.query(CreditNote).filter(CreditNote.external_id == first["id"]).one().amount == 10.0


def test_credit_notes_cannot_exceed_the_invoice_total(client, auth_headers):
    invoice = _issued(client, auth_headers)
    assert _credit(client, auth_headers, invoice["id"], 1190.01).status_code == 409
    assert _credit(client, auth_headers, invoice["id"], 1000).status_code == 200
    assert _credit(client, auth_headers, invoice["id"], 190.01).status_code == 409
    draft = _draft(client, auth_headers)
    assert _credit(client, auth_headers, draft["id"], 1).status_code == 409


# ── Avances et caisse ─────────────────────────────────────────────────────────────────────

def test_advance_is_stored_with_its_cash_entry(client, auth_headers, db):
    data = {"id": _uid("av"), "date": "2026-10-05", "societe": SOC, "client": "CLIENT AVANCE", "montant": "1 500,50",
            "mode": "Espèces", "statut": "disponible"}
    r = client.post(f"{BASE}/avances/items", headers=auth_headers, json={"data": data})
    assert r.status_code == 200, r.text
    assert r.json()["montant"] == 1500.5
    db.expire_all()
    assert db.query(Advance).filter(Advance.external_id == data["id"]).one().amount == 1500.5
    cash = db.query(CashEntry).filter(CashEntry.external_id == f"cs_{data['id']}").one()
    assert (cash.amount, cash.category, cash.entry_type) == (1500.5, "Avance client", "entree")
    assert client.delete(f"{BASE}/avances/items/{data['id']}", headers=auth_headers).status_code == 200
    db.expire_all()
    assert db.query(CashEntry).filter(CashEntry.external_id == f"cs_{data['id']}").count() == 0


@pytest.mark.parametrize("payload", [
    {"montant": 0, "type": "entree"},
    {"montant": 10, "type": "virement"},
    {"montant": 10, "type": "sortie", "societe": ""},
])
def test_cash_entry_rules(client, auth_headers, payload):
    data = {"id": _uid("cs"), "date": "2026-10-06", "societe": SOC, "categorie": "Autre", "libelle": "Test", **payload}
    assert client.post(f"{BASE}/caisse/items", headers=auth_headers, json={"data": data}).status_code == 422


def test_manual_cash_entry_round_trip(client, auth_headers):
    data = {"id": _uid("cs"), "date": "2026-10-06", "societe": SOC, "type": "sortie", "categorie": "Carburant",
            "libelle": "Plein", "montant": 2500, "mode": "Espèces", "paiementId": "pa_inventé"}
    r = client.post(f"{BASE}/caisse/items", headers=auth_headers, json={"data": data})
    assert r.status_code == 200, r.text
    saved = _find(client, auth_headers, "caisse", data["id"])
    assert saved["montant"] == 2500.0 and saved["type"] == "sortie" and "paiementId" not in saved
    assert client.delete(f"{BASE}/caisse/items/{data['id']}", headers=auth_headers).status_code == 200


# ── TVA ───────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("rate,tva,ttc", [(0, 0.0, 1000.0), ("9", 90.0, 1090.0), (19, 190.0, 1190.0), (None, 190.0, 1190.0)])
def test_vat_rate_zero_and_custom_rates_are_kept(client, auth_headers, rate, tva, ttc):
    extra = {} if rate is None else {"tvaPct": rate}
    lines = [_line(tva=rate if rate is not None else 19)]
    draft = _draft(client, auth_headers, lines=lines, **extra)
    assert (draft["tvaAmt"], draft["ttc"]) == (tva, ttc)
    reopened = _find(client, auth_headers, "factures", draft["id"])
    assert reopened["tvaPct"] == (19.0 if rate is None else float(rate))
    issued = client.post(f"/api/irongs/factures/{draft['id']}/valider", headers=auth_headers).json()
    assert (issued["tvaAmt"], issued["ttc"], issued["tvaPct"]) == (tva, ttc, reopened["tvaPct"])


def test_invoice_level_vat_rate_wins_over_line_rates(client, auth_headers):
    draft = _draft(client, auth_headers, lines=[_line(tva=19)], tvaPct=0)
    assert draft["tvaAmt"] == 0.0


@pytest.mark.parametrize("rate", [-1, 100.01, "abc"])
def test_invalid_vat_rate_is_refused(client, auth_headers, rate):
    data = {"id": _uid("fc_int"), "statut": "brouillon", "societe": SOC, "client": "X", "lignes": [_line()], "tvaPct": rate}
    assert client.post(f"{BASE}/factures/items", headers=auth_headers, json={"data": data}).status_code == 422


# ── Statut et numéro réservés à la validation ─────────────────────────────────────────────

def test_saving_a_draft_never_issues_or_numbers_it(client, auth_headers, db):
    draft = _draft(client, auth_headers, numero="FAC9999/10/26", statut="emise", validatedAt="2026-10-01")
    assert (draft["statut"], draft["numero"]) == ("brouillon", "BROUILLON")
    updated = client.put(f"{BASE}/factures/items/{draft['id']}", headers=auth_headers,
                         json={"data": {**draft, "statut": "payee", "numero": "FAC9998/10/26"}}).json()
    assert (updated["statut"], updated["numero"]) == ("brouillon", "BROUILLON")
    db.expire_all()
    row = db.query(Invoice).filter(Invoice.external_id == draft["id"]).one()
    assert (row.status, row.number) == ("brouillon", None)


def test_issued_invoice_status_is_kept_on_save(client, auth_headers):
    invoice = _issued(client, auth_headers)
    after = client.put(f"{BASE}/factures/items/{invoice['id']}", headers=auth_headers,
                       json={"data": {**invoice, "statut": "payee"}}).json()
    assert (after["statut"], after["numero"]) == ("emise", invoice["numero"])


def test_excel_import_keeps_the_historical_number_of_a_header_only_invoice(client, auth_headers):
    number = f"HIST-{uuid.uuid4().hex[:6]}"
    data = {"id": _uid("fc_import"), "numero": number, "statut": "emise", "societe": SOC, "client": "HISTORIQUE",
            "date": "2025-12-31", "totalHT": 100, "ttc": 119, "sourceImport": "excel", "lignes": []}
    saved = client.post(f"{BASE}/factures/items", headers=auth_headers, json={"data": data}).json()
    assert (saved["numero"], saved["statut"], saved["ttc"]) == (number, "emise", 119)
    with_lines = {**data, "id": _uid("fc_import"), "numero": f"{number}-L", "lignes": [_line()]}
    saved = client.post(f"{BASE}/factures/items", headers=auth_headers, json={"data": with_lines}).json()
    assert (saved["numero"], saved["statut"]) == ("BROUILLON", "brouillon")


# ── Suppression ───────────────────────────────────────────────────────────────────────────

def test_issued_invoice_cannot_be_deleted_but_a_draft_can(client, auth_headers, db):
    invoice = _issued(client, auth_headers)
    r = client.delete(f"{BASE}/factures/items/{invoice['id']}", headers=auth_headers)
    assert r.status_code == 409, r.text
    db.expire_all()
    assert db.query(Invoice).filter(Invoice.external_id == invoice["id"]).count() == 1
    draft = _draft(client, auth_headers)
    assert client.delete(f"{BASE}/factures/items/{draft['id']}", headers=auth_headers).status_code == 200


def test_imported_invoice_can_be_deleted_only_without_settlements(client, auth_headers):
    def imported():
        data = {"id": _uid("fc_import"), "numero": f"HIST-{uuid.uuid4().hex[:6]}", "statut": "emise", "societe": SOC,
                "client": "HISTORIQUE", "date": "2025-12-31", "ttc": 119, "totalHT": 100, "sourceImport": "excel", "lignes": []}
        return client.post(f"{BASE}/factures/items", headers=auth_headers, json={"data": data}).json()
    free, paid = imported(), imported()
    assert _pay(client, auth_headers, paid["id"], 19).status_code == 200
    assert client.delete(f"{BASE}/factures/items/{free['id']}", headers=auth_headers).status_code == 200
    assert client.delete(f"{BASE}/factures/items/{paid['id']}", headers=auth_headers).status_code == 409


# ── Validation et numérotation ────────────────────────────────────────────────────────────

def test_second_validation_returns_the_same_number(client, auth_headers):
    draft = _draft(client, auth_headers)
    first = client.post(f"/api/irongs/factures/{draft['id']}/valider", headers=auth_headers).json()
    second = client.post(f"/api/irongs/factures/{draft['id']}/valider", headers=auth_headers).json()
    assert first["numero"] == second["numero"] and first["numero"].startswith("FAC")


def test_consecutive_validations_get_distinct_increasing_numbers(client, auth_headers):
    numbers = [_issued(client, auth_headers)["numero"] for _ in range(3)]
    seqs = [int(n[3:7]) for n in numbers]
    assert seqs == sorted(seqs) and len(set(seqs)) == 3 and seqs[2] - seqs[0] == 2


# ── Périmètre société et module ───────────────────────────────────────────────────────────

def test_restricted_user_cannot_settle_another_society_invoice(client, auth_headers, db):
    invoice = _issued(client, auth_headers, society=OTHER)
    headers = _user(client, db, modules=["fac"], societies=[SOC], actions=["read", "create", "update", "delete"])
    for r in (_pay(client, headers, invoice["id"], 10, societe=SOC), _credit(client, headers, invoice["id"], 10, societe=SOC)):
        assert r.status_code == 403, r.text
    db.expire_all()
    assert db.query(Payment).filter(Payment.invoice_external_id == invoice["id"]).count() == 0


def test_restricted_user_documents_get_their_single_society(client, auth_headers, db):
    headers = _user(client, db, modules=["fac"], societies=[SOC], actions=["read", "create", "update", "delete"])
    draft = _draft(client, headers, society="")
    assert draft["societe"] == SOC
    data = {"id": _uid("cs"), "date": "2026-10-06", "type": "entree", "categorie": "Apport", "libelle": "x", "montant": 5}
    assert client.post(f"{BASE}/caisse/items", headers=headers, json={"data": data}).json()["societe"] == SOC
    two = _user(client, db, modules=["fac"], societies=[SOC, OTHER], actions=["read", "create", "update", "delete"])
    data = {"id": _uid("fc_int"), "statut": "brouillon", "societe": "", "client": "X", "lignes": [_line()]}
    assert client.post(f"{BASE}/factures/items", headers=two, json={"data": data}).status_code == 422


def test_settlements_require_the_facturation_module_and_action(client, auth_headers, db):
    invoice = _issued(client, auth_headers)
    for modules, actions in ((["drh"], ["read", "create"]), (["fac"], ["read"])):
        headers = _user(client, db, modules=modules, societies=[SOC], actions=actions)
        assert _pay(client, headers, invoice["id"], 10).status_code == 403
    headers = _user(client, db, modules=["fac"], societies=[SOC], actions=["read", "create"])
    assert _pay(client, headers, invoice["id"], 10).status_code == 200


def test_facturation_account_no_longer_reaches_payroll_collections(client, db):
    fac = _user(client, db, modules=["fac"], societies=[SOC], actions=["read", "create", "update"])
    finances = _user(client, db, modules=["finances"], societies=[SOC], actions=["read", "create", "update"])
    for name in ("paieBulletins", "paieElements", "paieClotures", "paieGrilles", "paieConfig", "paieRubriques"):
        assert client.get(f"{BASE}/{name}/items", headers=fac).status_code == 403, name
        assert client.get(f"{BASE}/{name}/items", headers=finances).status_code != 403, name
    for name in ("factures", "paiements", "avances", "avoirs", "caisse", "missionBillables"):
        assert client.get(f"{BASE}/{name}/items", headers=fac).status_code == 200, name
