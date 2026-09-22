"""Finance Core (P0-C) — obligations, intentions de paiement, règlements, idempotence,
outbox. Vrais endpoints, vraie base, sans mock."""
from decimal import Decimal

SOC = "Iron Global Securite"
SOC_OTHER = "Sword Corporation"


def _create_obligation(client, h, key, amount="1000.00", direction="receivable", society=SOC):
    r = client.post("/api/finance-core/obligations", headers=h, json={
        "society": society, "direction": direction, "source_type": "manual", "source_id": key,
        "amount_total": amount, "counterparty_name": "Client Test", "idempotency_key": f"test:{key}",
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_create_obligation_is_decimal_and_persisted(client, auth_headers):
    body = _create_obligation(client, auth_headers, "obl1", amount="1234.56")
    assert body["amount_total"] == "1234.56"  # Decimal sérialisé en chaîne, jamais un float arrondi
    assert body["status"] == "open"
    assert body["amount_settled"] == "0.00" or body["amount_settled"] == "0"


def test_create_obligation_idempotent(client, auth_headers):
    a = _create_obligation(client, auth_headers, "obl-idem")
    b = _create_obligation(client, auth_headers, "obl-idem")
    assert a["id"] == b["id"], "une même idempotency_key ne doit jamais créer un doublon"


def test_settle_obligation_partial_then_total(client, auth_headers):
    obl = _create_obligation(client, auth_headers, "obl-settle", amount="1000.00")
    r1 = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "400.00", "idempotency_key": "stl:1",
    })
    assert r1.status_code == 200, r1.text
    got = client.get(f"/api/finance-core/obligations/{obl['id']}", headers=auth_headers).json()
    assert got["status"] == "partially_settled"
    assert got["amount_settled"] == "400.00"

    r2 = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "600.00", "idempotency_key": "stl:2",
    })
    assert r2.status_code == 200, r2.text
    got2 = client.get(f"/api/finance-core/obligations/{obl['id']}", headers=auth_headers).json()
    assert got2["status"] == "settled"
    assert got2["amount_settled"] == "1000.00"


def test_settle_obligation_refuses_overpayment(client, auth_headers):
    obl = _create_obligation(client, auth_headers, "obl-over", amount="100.00")
    r = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "150.00", "idempotency_key": "stl:over",
    })
    assert r.status_code == 409, r.text


def test_settle_is_idempotent(client, auth_headers):
    obl = _create_obligation(client, auth_headers, "obl-settle-idem", amount="500.00")
    r1 = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "500.00", "idempotency_key": "stl:idem",
    })
    r2 = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "500.00", "idempotency_key": "stl:idem",
    })
    assert r1.json()["id"] == r2.json()["id"]
    got = client.get(f"/api/finance-core/obligations/{obl['id']}", headers=auth_headers).json()
    assert got["amount_settled"] == "500.00", "un règlement rejoué avec la même clé ne doit jamais régler deux fois"


def test_reverse_settlement_restores_obligation(client, auth_headers):
    obl = _create_obligation(client, auth_headers, "obl-reverse", amount="800.00")
    settle = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "800.00", "idempotency_key": "stl:rev",
    }).json()
    got = client.get(f"/api/finance-core/obligations/{obl['id']}", headers=auth_headers).json()
    assert got["status"] == "settled"

    r = client.post(f"/api/finance-core/settlements/{settle['id']}/reverse", headers=auth_headers, json={
        "reason": "erreur de saisie", "idempotency_key": "stl:rev:reversal",
    })
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "reversal"
    got2 = client.get(f"/api/finance-core/obligations/{obl['id']}", headers=auth_headers).json()
    assert got2["status"] == "open"
    assert got2["amount_settled"] == "0.00" or got2["amount_settled"] == "0"


def test_obligation_society_scope_enforced(client, auth_headers, restricted_headers, db):
    """restricted_headers (testops) n'a pas le module 'finances' -> 403 avant tout traitement.
    Remise à un état neutre explicite (voir test_reconciliation.py pour le détail) : d'autres
    suites accordent temporairement "finance" au compte partagé testops et committent, ce qui
    survit entre tests puisque testops n'est pas recréé par test."""
    from app.modules.auth.models import User
    user = db.query(User).filter(User.username == "testops").one()
    user.authorized_modules = ["ops", "dc"]
    db.commit()
    r = client.get("/api/finance-core/obligations", headers=restricted_headers)
    assert r.status_code == 403, r.text


def test_cancel_obligation(client, auth_headers):
    obl = _create_obligation(client, auth_headers, "obl-cancel", amount="300.00")
    r = client.post(f"/api/finance-core/obligations/{obl['id']}/cancel", headers=auth_headers, params={"reason": "annulé par le client"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    r2 = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "100.00", "idempotency_key": "stl:cancelled",
    })
    assert r2.status_code == 409, "une obligation annulée ne doit jamais pouvoir être réglée"
