"""Revue d'intégrité financière — item 5 (double paiement), concurrence RÉELLE (aucun mock) :
vrai serveur (TestClient), vraie base, vrais threads en parallèle, chaque requête ayant sa
propre session (fixture `live_client`, voir tests/conftest.py et tests/test_concurrency.py
pour le patron déjà établi). Deux scénarios distincts exigés par la mission :

1. Même obligation + MÊME idempotency_key + requêtes simultanées -> un SEUL effet
   économique (un seul Settlement réellement créé, jamais réglé deux fois).
2. Même obligation + idempotency_keys DIFFÉRENTES soumises en même temps, dont la somme
   dépasserait le montant dû -> le total réellement réglé ne doit JAMAIS dépasser le
   montant dû, même sous course (settle_obligation() compare au reste à régler à
   l'intérieur de la même transaction qui écrit le Settlement)."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal

SOC = "Concurrence Finance SA"


def _create_obligation(live_client, live_headers, *, amount, source_id, key):
    r = live_client.post("/api/finance-core/obligations", headers=live_headers, json={
        "society": SOC, "direction": "receivable", "source_type": "test_concurrency", "source_id": source_id,
        "amount_total": amount, "idempotency_key": key,
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_concurrent_settle_same_idempotency_key_single_economic_effect(live_client, live_headers):
    """10 requêtes SIMULTANÉES, même obligation, même idempotency_key, même montant -> une
    seule ligne de règlement doit réellement exister (les autres doivent recevoir CE MÊME
    règlement en retour, jamais en créer un second), et le reste à régler de l'obligation ne
    doit être diminué qu'UNE seule fois."""
    obligation = _create_obligation(live_client, live_headers, amount="500.00", source_id="conc-same-key-1", key="obl:conc:samekey:1")
    key = "stl:conc:samekey:1"

    def settle():
        return live_client.post(f"/api/finance-core/obligations/{obligation['id']}/settle", headers=live_headers, json={
            "amount": "500.00", "idempotency_key": key,
        })

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = [f.result() for f in as_completed([pool.submit(settle) for _ in range(10)])]

    # Sous verrouillage fichier SQLite, une minorité de requêtes peut légitimement échouer
    # transitoirement (verrou) plutôt que de renvoyer un doublon — l'exigence n'est PAS "10
    # succès", c'est "jamais deux règlements distincts". On vérifie donc l'invariant sur les
    # réponses qui ont abouti, puis l'état final en base.
    ok = [r for r in results if r.status_code == 200]
    assert ok, f"aucune requête n'a abouti : {[r.status_code for r in results]}"
    settlement_ids = {r.json()["id"] for r in ok}
    assert len(settlement_ids) == 1, f"plusieurs Settlement distincts créés pour la même idempotency_key : {settlement_ids}"

    final = live_client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=live_headers).json()
    assert final["amount_settled"] == "500.00", "un seul règlement doit avoir diminué le reste à régler, jamais dix"
    assert final["status"] == "settled"


def test_concurrent_settle_different_idempotency_keys_never_exceeds_amount_due(live_client, live_headers):
    """Une obligation de 100.00, 5 requêtes SIMULTANÉES de 30.00 chacune (idempotency_keys
    TOUTES DIFFÉRENTES, total potentiel 150.00 très supérieur au dû) -> le total réellement
    réglé ne doit JAMAIS dépasser 100.00, même sous course sur la vérification du reste à
    régler. Au plus 3 des 5 doivent réussir (3 x 30.00 = 90.00, un 4e de 30.00 dépasserait le
    reste de 10.00 -> refusé), jamais 4 ou 5."""
    obligation = _create_obligation(live_client, live_headers, amount="100.00", source_id="conc-diffkeys-1", key="obl:conc:diffkeys:1")

    def settle(i):
        return live_client.post(f"/api/finance-core/obligations/{obligation['id']}/settle", headers=live_headers, json={
            "amount": "30.00", "idempotency_key": f"stl:conc:diffkeys:1:{i}",
        })

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = [f.result() for f in as_completed([pool.submit(settle, i) for i in range(5)])]

    ok = [r for r in results if r.status_code == 200]
    refused = [r for r in results if r.status_code == 409]
    assert len(ok) + len(refused) == 5, f"une requête a échoué autrement qu'un refus métier propre : {[r.status_code for r in results]}"
    assert len(ok) <= 3, f"plus de 3 règlements de 30.00 ont été acceptés sur un dû de 100.00 : {len(ok)} acceptés — dépassement sous course"

    final = live_client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=live_headers).json()
    assert Decimal(final["amount_settled"]) == Decimal("30.00") * len(ok), "le montant réglé en base doit refléter exactement les requêtes acceptées"
    assert Decimal(final["amount_settled"]) <= Decimal("100.00"), "JAMAIS de dépassement du montant dû, même sous concurrence réelle"


def test_concurrent_reversal_of_same_settlement_applied_exactly_once(live_client, live_headers):
    """5 tentatives SIMULTANÉES d'annulation du MÊME règlement (idempotency_keys toutes
    différentes, comme un admin qui double-cliquerait) -> une seule annulation doit réellement
    être appliquée (amount_settled revient exactement à 0.00, jamais négatif/incohérent), les
    autres doivent être refusées (409), jamais silencieusement acceptées en double."""
    obligation = _create_obligation(live_client, live_headers, amount="200.00", source_id="conc-reverse-1", key="obl:conc:reverse:1")
    settle = live_client.post(f"/api/finance-core/obligations/{obligation['id']}/settle", headers=live_headers, json={
        "amount": "200.00", "idempotency_key": "stl:conc:reverse:1",
    })
    assert settle.status_code == 200, settle.text
    settlement_id = settle.json()["id"]

    def reverse(i):
        return live_client.post(f"/api/finance-core/settlements/{settlement_id}/reverse", headers=live_headers, json={
            "reason": "test concurrence", "idempotency_key": f"stl:conc:reverse:1:rev{i}",
        })

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = [f.result() for f in as_completed([pool.submit(reverse, i) for i in range(5)])]

    ok = [r for r in results if r.status_code == 200]
    refused = [r for r in results if r.status_code == 409]
    assert len(ok) + len(refused) == 5, f"une requête a échoué autrement qu'un refus métier propre : {[r.status_code for r in results]}"
    assert len(ok) == 1, f"une seule annulation doit réellement être appliquée, jamais {len(ok)}"

    final = live_client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=live_headers).json()
    assert final["amount_settled"] == "0.00" or final["amount_settled"] == "0"
    assert final["status"] == "open"
