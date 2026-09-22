"""E2E — les trois chaînes explicitement demandées, de bout en bout, avec vérification
d'idempotence sur chaque chaîne. Fixtures déterministes (aucune dépendance à l'ordre
d'exécution : chaque test crée ses propres sociétés/comptes/références uniques)."""
import io
from datetime import date

SOC = "Iron Global Securite"
_seq = [0]


def _next_ref(prefix: str) -> str:
    _seq[0] += 1
    return f"{prefix}-{_seq[0]}"


def _account(client, h):
    ref = _next_ref("ACC")
    r = client.post("/api/banking/accounts", headers=h, json={"society": SOC, "bank_name": "BNA", "account_number": f"e2e{_seq[0]:08d}"})
    return r.json()


def _import_csv(client, h, account_id, rows_csv, key):
    files = {"file": ("r.csv", io.BytesIO(rows_csv.encode("utf-8")), "text/csv")}
    data = {"society": SOC, "bank_account_id": str(account_id), "import_format": "csv", "idempotency_key": key}
    r = client.post("/api/banking/statements/import", headers=h, data=data, files=files)
    assert r.status_code == 200, r.text
    return r.json()


def _reconcile_and_confirm(client, h, transaction_id):
    proposed = client.post(f"/api/reconciliation/transactions/{transaction_id}/propose", headers=h)
    assert proposed.status_code == 200, proposed.text
    case = proposed.json()
    assert case is not None, "aucune proposition — vérifier montant/référence exacts dans le CSV du test"
    confirmed = client.post(f"/api/reconciliation/cases/{case['id']}/confirm", headers=h)
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()


# ── VENTE : devis -> commande/conversion -> créance -> encaissement -> rapprochement ──────
# -> settlement -> comptabilité

def test_e2e_vente_devis_to_accounting(client, auth_headers):
    ref = _next_ref("FAC-VTE")
    devis = client.post("/api/ventes/devis", headers=auth_headers, json={
        "society": SOC, "client_name": f"Client {ref}", "date_devis": "2026-09-01", "objet": "E2E vente",
        "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 5000, "tva_pct": 19}],
    }).json()
    client.post(f"/api/ventes/devis/{devis['id']}/valider", headers=auth_headers)
    cmd = client.post(f"/api/ventes/devis/{devis['id']}/convertir", headers=auth_headers).json()
    total_ttc = cmd["total_ttc"]

    obligations = client.get("/api/finance-core/obligations", headers=auth_headers, params={"society": SOC, "direction": "receivable"}).json()["items"]
    matching = [o for o in obligations if o["counterparty_name"] == f"Client {ref}"]
    assert matching, "la conversion devis->commande doit ouvrir une créance Finance Core"
    obligation = matching[0]
    assert float(obligation["amount_total"]) == float(total_ttc)

    account = _account(client, auth_headers)
    statement = _import_csv(client, auth_headers, account["id"], (
        f"date,label,reference,credit\n2026-09-05,Encaissement client,{obligation['source_id']},{total_ttc}\n"
    ), key=f"{ref}-import")
    tx = client.get("/api/banking/transactions", headers=auth_headers, params={"bank_account_id": account["id"]}).json()["items"][0]

    case = _reconcile_and_confirm(client, auth_headers, tx["id"])
    assert case["kind"] == "1:1"

    obligation_after = client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=auth_headers).json()
    assert obligation_after["status"] == "settled"

    dispatch = client.post("/api/finance-core/outbox/dispatch", headers=auth_headers).json()
    assert dispatch["dispatched"] >= 1
    events = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC}).json()
    assert any(e["source_type"] == "settlement" and e["status"] == "posted" for e in events)

    # Idempotence : reproposer un rapprochement sur la même transaction (déjà "matched")
    # ne doit produire aucun nouveau cas.
    replay = client.post(f"/api/reconciliation/transactions/{tx['id']}/propose", headers=auth_headers)
    assert replay.status_code == 200 and replay.json() is None


# ── ACHAT : facture fournisseur -> dette -> paiement -> banque -> rapprochement ────────────
# -> comptabilité (chemin bancaire, DIFFÉRENT du paiement direct achats.payer_facture déjà
# testé ailleurs — prouve que Finance Core sert les deux chemins pour le même type d'obligation)

def test_e2e_achat_facture_fournisseur_to_accounting_via_bank_reconciliation(client, auth_headers):
    ref = _next_ref("FF-E2E")
    fournisseur = client.post("/api/achats/fournisseurs", headers=auth_headers, json={"society": SOC, "name": f"Fournisseur {ref}"}).json()
    facture = client.post("/api/achats/factures", headers=auth_headers, json={
        "society": SOC, "fournisseur_id": fournisseur["id"], "fournisseur_name": fournisseur["name"],
        "date_facture": "2026-09-01", "total_ht": 2000.0, "tva": 380.0, "total_ttc": 2380.0,
    }).json()

    obligations = client.get("/api/finance-core/obligations", headers=auth_headers, params={"society": SOC, "direction": "payable"}).json()["items"]
    matching = [o for o in obligations if o["source_type"] == "facture_fournisseur" and o["source_id"] == facture["numero"]]
    assert matching
    obligation = matching[0]

    account = _account(client, auth_headers)
    _import_csv(client, auth_headers, account["id"], (
        f"date,label,reference,debit\n2026-09-10,Virement fournisseur,{facture['numero']},2380.00\n"
    ), key=f"{ref}-import")
    tx = client.get("/api/banking/transactions", headers=auth_headers, params={"bank_account_id": account["id"]}).json()["items"][0]
    assert float(tx["amount"]) == -2380.0, "un débit doit être signé négativement"

    case = _reconcile_and_confirm(client, auth_headers, tx["id"])
    assert case["kind"] == "1:1"

    obligation_after = client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=auth_headers).json()
    assert obligation_after["status"] == "settled"

    dispatch = client.post("/api/finance-core/outbox/dispatch", headers=auth_headers).json()
    events = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC}).json()
    posted_for_this = [e for e in events if e["source_type"] == "settlement" and e["status"] == "posted"]
    assert posted_for_this, "le règlement via rapprochement bancaire doit lui aussi produire une écriture comptable"


# ── PAIE : pointage -> bulletin -> validation -> dette salarié/organismes -> virement ──────
# -> règlement -> comptabilité (avec ordre de virement explicite = PaymentIntent)

def test_e2e_paie_pointage_to_accounting_with_payment_intent(client, auth_headers):
    ref = _next_ref("PAIE-E2E")
    src = client.post("/api/regulatory/sources", headers=auth_headers, json={"name": f"Barème {ref}", "reliability": "unverified"}).json()
    # Le moteur payroll lit des rule_type FIXES (cnas_taux_salarial/cnas_taux_patronal/
    # irg_bareme). Toujours créées avec mark_verified=True : validate_slip() (garde P0
    # ajoutée en revue d'intégrité) refuse désormais explicitement toute validation basée
    # sur une règle non vérifiée — voir test_payroll.py pour le test dédié au cas refusé.
    # get_or_create_rule() est déjà idempotent par (rule_type, société) ; ajouter une
    # version supplémentaire si une autre suite en a déjà seedé une n'est pas un problème
    # (toutes actives, get_applicable_version en choisit une, peu importe laquelle).
    for rule_type, params in (("cnas_taux_salarial", {"taux": 0.09}), ("cnas_taux_patronal", {"taux": 0.26}), ("irg_bareme", {"brackets": [{"up_to": None, "rate": 0.1}]})):
        rule = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": rule_type, "society": SOC, "label": rule_type}).json()
        proposal = client.post("/api/regulatory/proposals", headers=auth_headers, json={
            "rule_id": rule["id"], "proposed_parameters": params, "proposed_effective_from": "2026-01-01", "source_id": src["id"],
        }).json()
        client.post(f"/api/regulatory/proposals/{proposal['id']}/approve", headers=auth_headers, json={"mark_verified": True})

    emp = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": ref, "first_name": "E2E", "last_name": "Paie", "society": SOC, "status": "actif", "contract_type": "CDI",
    }).json()
    emp_id = emp.get("id") or emp.get("backendId")
    grid = client.post("/api/payroll/salary-grids", headers=auth_headers, json={
        "society": SOC, "poste": f"Poste {ref}", "salaire_base": "60000.00", "primes_fixes": [], "effective_from": "2026-01-01",
    }).json()

    run = client.post("/api/payroll/runs", headers=auth_headers, json={"society": SOC, "period": "2027-01", "idempotency_key": f"{ref}-run"}).json()
    slip = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={
        "employee_id": int(emp_id), "salary_grid_id": grid["id"], "idempotency_key": f"{ref}-slip",
    }).json()
    validated = client.post(f"/api/payroll/slips/{slip['id']}/validate", headers=auth_headers).json()
    assert validated["status"] == "validated"
    assert validated["obligation_id"]

    # Ordre de virement explicite (PaymentIntent) AVANT le règlement — représente l'étape
    # "virement" distincte de la confirmation finale ("règlement").
    intent = client.post("/api/finance-core/payment-intents", headers=auth_headers, json={
        "society": SOC, "direction": "payable", "amount": validated["net_a_payer"], "obligation_id": validated["obligation_id"],
        "method": "bank_transfer", "idempotency_key": f"{ref}-intent",
    }).json()
    assert intent["status"] == "pending"

    settle = client.post(f"/api/finance-core/obligations/{validated['obligation_id']}/settle", headers=auth_headers, json={
        "amount": validated["net_a_payer"], "payment_intent_id": intent["id"], "idempotency_key": f"{ref}-settle",
    })
    assert settle.status_code == 200, settle.text

    dispatch = client.post("/api/finance-core/outbox/dispatch", headers=auth_headers).json()
    events = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC}).json()
    assert any(e["status"] == "posted" for e in events)

    # Idempotence : re-régler avec la MÊME clé ne crée pas un second règlement.
    settle_again = client.post(f"/api/finance-core/obligations/{validated['obligation_id']}/settle", headers=auth_headers, json={
        "amount": validated["net_a_payer"], "payment_intent_id": intent["id"], "idempotency_key": f"{ref}-settle",
    }).json()
    assert settle_again["id"] == settle.json()["id"]
