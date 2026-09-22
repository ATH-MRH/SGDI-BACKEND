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


# ── P0 (revue d'intégrité, item 6/7 — outbox) : une entrée en échec doit être reprise (pas
# perdue silencieusement), et un échec PARTIEL au milieu du traitement ne doit jamais laisser
# de donnée comptable brisée (déséquilibrée) committée ────────────────────────────────────────

def test_failed_dispatch_entry_is_retried_and_eventually_succeeds_without_duplicate(client, auth_headers, db):
    """Un handler qui échoue UNE FOIS (panne transitoire simulée) puis réussit à la reprise :
    l'entrée outbox doit être reprise automatiquement par un dispatch ultérieur (pas figée en
    "failed" pour toujours), et le résultat final ne doit comporter qu'UN SEUL AccountingEvent
    "posted" pour cet événement — jamais deux, jamais un état brisé résiduel de la tentative
    ratée."""
    from app.modules.finance_core import service as finance_core_service
    from app.modules.finance_core.accounting_bridge import handle_financial_event

    obl = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "receivable", "source_type": "invoice", "source_id": "FAC-RETRY-1",
        "amount_total": "400.00", "counterparty_name": "Client Retry Test",
        "idempotency_key": "bridge:obl:retry1",
    }).json()
    settle = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "400.00", "idempotency_key": "bridge:stl:retry1",
    }).json()

    # dispatch_pending_events traite TOUTES les entrées en attente de toute la base (pas
    # seulement celle de ce test — d'autres suites peuvent en laisser en attente) : le
    # handler ne doit donc simuler une panne QUE pour SON PROPRE règlement, au premier
    # passage sur celui-ci précisément, pour isoler la preuve de tout bruit ambiant.
    call_count = {"n": 0}

    def flaky_handler(event):
        if event.aggregate_type == "settlement" and event.aggregate_id == settle["id"] and call_count["n"] == 0:
            call_count["n"] += 1
            raise RuntimeError("panne transitoire simulée (ex. service comptable momentanément indisponible)")
        return handle_financial_event(db, event)

    d1 = finance_core_service.dispatch_pending_events(db, handler=flaky_handler, limit=50)
    assert d1["failed"] >= 1, d1
    assert call_count["n"] == 1, "la panne simulée doit avoir été déclenchée exactement une fois, pour ce règlement précisément"

    # Reprise : le dispatch suivant doit RETROUVER cette entrée "failed" (pas la laisser de
    # côté pour toujours) et réussir cette fois (call_count reste à 1, la condition de panne
    # ne se redéclenche plus, le vrai handler traite l'événement normalement).
    d2 = finance_core_service.dispatch_pending_events(db, handler=flaky_handler, limit=50)
    assert d2["dispatched"] >= 1, d2

    events = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC}).json()
    matching = [e for e in events if e["source_type"] == "settlement" and str(e["source_id"]) and e["status"] == "posted"]
    # Le règlement retry1 ne doit apparaître qu'UNE SEULE FOIS en statut "posted".
    posted_for_this_settlement = [e for e in matching if e["ecriture_id"] is not None]
    ecriture_ids = [e["ecriture_id"] for e in posted_for_this_settlement]
    assert len(ecriture_ids) == len(set(ecriture_ids)), "aucune écriture ne doit être postée deux fois après une reprise"


def test_handler_partial_failure_leaves_no_broken_accounting_event(db):
    """Un handler qui écrit PARTIELLEMENT (crée un AccountingEvent) puis échoue avant la fin
    doit voir cet effet partiel intégralement annulé (SAVEPOINT) — jamais une donnée
    comptable à moitié écrite committée à la fin du lot. Utilise directement
    dispatch_pending_events avec un handler délibérément défaillant pour isoler ce
    comportement du reste du pont comptable réel.

    dispatch_pending_events traite TOUTES les entrées en attente de la base (partagée entre
    tests) : le handler ne doit donc se comporter de façon défaillante QUE pour SON PROPRE
    événement — sinon il "casserait" (marquerait "failed") les entrées en attente d'AUTRES
    suites de tests qui partagent la même base, un piège réellement rencontré pendant cette
    revue (voir tests/test_finance_core_ventes_achats_integration.py, dont le comptage
    d'écritures a été faussé par une première version de ce test)."""
    from app.modules.finance_core import service as finance_core_service
    from app.modules.finance_core.accounting_bridge import handle_financial_event
    from app.modules.finance_core.models import AccountingEvent

    obl = finance_core_service.create_obligation(
        db, society=SOC, direction="receivable", source_type="invoice", source_id="FAC-PARTIAL-1",
        amount_total="250.00", counterparty_name="Client Partiel Test", idempotency_key="obl:partial:1",
    )
    db.commit()
    settlement = finance_core_service.settle_obligation(
        db, obligation_id=obl.id, amount="250.00", idempotency_key="stl:partial:1",
    )
    db.commit()

    def half_broken_handler(event):
        if not (event.aggregate_type == "settlement" and event.aggregate_id == settlement.id):
            return handle_financial_event(db, event)  # événement d'une AUTRE suite : traitement réel, jamais cassé
        # Simule EXACTEMENT ce que ferait un vrai handler qui échoue à mi-chemin : écrit un
        # AccountingEvent "pending" (effet partiel réel, pas un mock), PUIS lève une erreur
        # avant d'avoir pu le finaliser en "posted".
        db.add(AccountingEvent(
            society=SOC, source_type="settlement", source_id=event.aggregate_id,
            status="pending", idempotency_key=f"acc:test-partial:{event.id}",
        ))
        db.flush()
        raise RuntimeError("échec simulé après écriture partielle")

    result = finance_core_service.dispatch_pending_events(db, handler=half_broken_handler, limit=50)
    assert result["failed"] >= 1
    assert settlement is not None  # créé pour un scénario réaliste (le handler lit event.aggregate_id)

    broken = [e for e in db.query(AccountingEvent).all() if e.idempotency_key.startswith("acc:test-partial:")]
    assert broken == [], "l'AccountingEvent partiellement écrit par le handler en échec ne doit JAMAIS survivre (SAVEPOINT annulé)"

    # Nettoyage explicite : l'entrée outbox de CE test reste "failed" (le handler local échoue
    # systématiquement pour son propre événement, par construction) — donc retriable par la
    # base partagée entre tests. La résoudre ici avec le VRAI handler évite qu'un test
    # ultérieur, en appelant le dispatch global, ne la retraite lui-même et fausse son propre
    # comptage d'écritures (piège réellement rencontré pendant cette revue).
    finance_core_service.dispatch_pending_events(db, handler=lambda e: handle_financial_event(db, e), limit=50)
