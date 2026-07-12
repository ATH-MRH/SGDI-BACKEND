"""Palier 7 — FINANCES (/api/finance) : lectures agrégées entrées/paie.

Les collections financières (factures, paiements, avances, avoirs, caisse) sont des
collections SQL irongs, déjà couvertes au palier 4 (round-trip). Ici on verrouille
les endpoints de lecture agrégée du module finance et leur pagination.
"""
SOC = "Iron Global Securite"


def _seed_finance(client, h):
    client.put("/api/irongs/db", headers=h, json={"data": {
        "factures": [{"id": "f_fin1", "numero": "FAC-001", "ttc": 119000, "societe": SOC}],
        "paiements": [{"id": "p_fin1", "montant": 50000, "societe": SOC}],
        "caisse": [{"id": "c_fin1", "montant": 3000, "societe": SOC}],
        "avances": [{"id": "a_fin1", "montant": 20000, "societe": SOC}],
        "avoirs": [{"id": "av_fin1", "montant": 8000, "societe": SOC}],
    }})


def test_finance_entries(client, auth_headers):
    _seed_finance(client, auth_headers)
    r = client.get("/api/finance/entries", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    for key in ("caisse", "factures", "paiements", "avances", "avoirs"):
        assert key in body and isinstance(body[key], list)
    assert any(f.get("id") == "f_fin1" for f in body["factures"])
    assert any(p.get("id") == "p_fin1" for p in body["paiements"])


def test_finance_payroll(client, auth_headers):
    r = client.get("/api/finance/payroll", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    for key in ("agents", "pointageMensuel", "contratsPersonnel"):
        assert key in body and isinstance(body[key], list)


def test_finance_entries_page(client, auth_headers):
    _seed_finance(client, auth_headers)
    r = client.get("/api/finance/entries/factures/page?page=1&page_size=10", headers=auth_headers)
    assert r.status_code == 200
    assert "items" in r.json() and "total" in r.json()


def test_finance_entries_page_unknown_collection_is_empty(client, auth_headers):
    r = client.get("/api/finance/entries/inconnue/page", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["items"] == [] and r.json()["total"] == 0


def test_finance_payroll_page(client, auth_headers):
    r = client.get("/api/finance/payroll/agents/page?page=1&page_size=5", headers=auth_headers)
    assert r.status_code == 200 and "items" in r.json()


def test_finance_requires_auth(client):
    assert client.get("/api/finance/entries").status_code in (401, 403)
