"""Finance Core — Accounting Bridge (P1-B) : un règlement confirmé doit produire une
écriture comptable brouillon équilibrée, via le traitement de l'outbox (patron event
sourcing + outbox, P0-F)."""
SOC = "Iron Global Securite"


def test_settlement_dispatch_creates_balanced_draft_ecriture(client, auth_headers):
    obl = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "receivable", "source_type": "invoice", "source_id": "FAC-BRIDGE-1",
        "amount_total": "750.00", "counterparty_name": "Client Pont Comptable",
        "idempotency_key": "bridge:obl:1",
    }).json()
    settlement = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "750.00", "idempotency_key": "bridge:stl:1",
    }).json()

    dispatch = client.post("/api/finance-core/outbox/dispatch", headers=auth_headers)
    assert dispatch.status_code == 200, dispatch.text
    result = dispatch.json()
    assert result["dispatched"] >= 1, result

    events = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC}).json()
    matching = [e for e in events if e["source_type"] == "settlement" and e["source_id"] == settlement["id"]]
    assert matching, events
    assert matching[0]["status"] == "posted"
    ecriture_id = matching[0]["ecriture_id"]
    assert ecriture_id is not None

    ecriture = client.get(f"/api/accounting/ecritures/{ecriture_id}", headers=auth_headers).json()
    assert float(ecriture["total_debit"]) == float(ecriture["total_credit"]) == 750.0, ecriture
    comptes = {l["compte_numero"] for l in ecriture["lignes"]}
    assert comptes == {"512", "411"}, "receivable réglé -> Banque(512)/Client(411)"


def test_dispatch_is_idempotent_no_duplicate_ecriture(client, auth_headers):
    obl = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "payable", "source_type": "facture_fournisseur", "source_id": "FF-BRIDGE-1",
        "amount_total": "300.00", "counterparty_name": "Fournisseur Pont",
        "idempotency_key": "bridge:obl:2",
    }).json()
    client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "300.00", "idempotency_key": "bridge:stl:2",
    })
    d1 = client.post("/api/finance-core/outbox/dispatch", headers=auth_headers).json()
    d2 = client.post("/api/finance-core/outbox/dispatch", headers=auth_headers).json()
    assert d2["dispatched"] == 0, "un événement déjà dispatché ne doit jamais être retraité (plus rien en attente)"

    events = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC}).json()
    payable_events = [e for e in events if e["source_type"] == "settlement"]
    ecriture_ids = [e["ecriture_id"] for e in payable_events if e["ecriture_id"]]
    assert len(ecriture_ids) == len(set(ecriture_ids)), "aucune écriture ne doit être créée deux fois"


def test_dispatch_reserved_to_admin(client, restricted_headers):
    r = client.post("/api/finance-core/outbox/dispatch", headers=restricted_headers)
    assert r.status_code == 403
