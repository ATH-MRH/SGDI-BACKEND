"""Revue d'intégrité financière — item 10 (multi-société) + item 11 (RBAC backend réelle).

testops (fixture `restricted_headers`) est seedé avec authorized_societies=["Iron Global
Securite"] — un utilisateur RÉEL restreint à UNE société, pas un mock. Tous les objets testés
ici sont créés pour "Sword Corporation" (société B) via auth_headers (admin, non restreint) ;
testops (société A) doit systématiquement recevoir 403/404, jamais les données de B. Le module
"finances" est accordé temporairement à testops (mutation partagée du compte, voir
tests/test_reconciliation.py pour le patron déjà établi de remise à un état neutre)."""
import io
from datetime import date

SOC_A = "Iron Global Securite"  # société de testops (restricted_headers)
SOC_B = "Sword Corporation"     # société "étrangère", jamais accessible à testops ici


def _grant_finances(db):
    from app.modules.auth.models import User
    user = db.query(User).filter(User.username == "testops").one()
    user.authorized_modules = ["ops", "dc", "finances"]
    db.commit()


def test_financial_obligation_cross_society_denied(client, auth_headers, restricted_headers, db):
    _grant_finances(db)
    obl = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC_B, "direction": "receivable", "source_type": "manual", "source_id": "MS-OBL-1",
        "amount_total": "500.00", "counterparty_name": "Client B", "idempotency_key": "ms:obl:1",
    }).json()
    r = client.get(f"/api/finance-core/obligations/{obl['id']}", headers=restricted_headers)
    assert r.status_code == 403


def test_settlement_reverse_cross_society_denied(client, auth_headers, restricted_headers, db):
    _grant_finances(db)
    obl = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC_B, "direction": "receivable", "source_type": "manual", "source_id": "MS-OBL-2",
        "amount_total": "300.00", "counterparty_name": "Client B", "idempotency_key": "ms:obl:2",
    }).json()
    settle = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "300.00", "idempotency_key": "ms:stl:2",
    }).json()
    r = client.post(f"/api/finance-core/settlements/{settle['id']}/reverse", headers=restricted_headers, json={
        "reason": "tentative cross-société", "idempotency_key": "ms:rev:2",
    })
    assert r.status_code == 403


def test_payment_intent_cannot_be_hijacked_across_obligations(client, auth_headers):
    """Item 10 (revue d'intégrité) — TROUVÉ PENDANT L'AUDIT : settle_obligation ne vérifiait
    pas que payment_intent_id référençait bien l'obligation réglée. Un PaymentIntent créé pour
    une obligation de société B ne doit jamais pouvoir être détourné pour "confirmer" le
    règlement d'une obligation de société A (ni marquer par effet de bord ce PaymentIntent
    étranger comme "settled")."""
    obl_a = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC_A, "direction": "payable", "source_type": "manual", "source_id": "MS-HIJACK-A",
        "amount_total": "200.00", "counterparty_name": "Fournisseur A", "idempotency_key": "ms:obl:hijack-a",
    }).json()
    obl_b = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC_B, "direction": "payable", "source_type": "manual", "source_id": "MS-HIJACK-B",
        "amount_total": "200.00", "counterparty_name": "Fournisseur B", "idempotency_key": "ms:obl:hijack-b",
    }).json()
    intent_b = client.post("/api/finance-core/payment-intents", headers=auth_headers, json={
        "society": SOC_B, "direction": "payable", "amount": "200.00", "obligation_id": obl_b["id"],
        "idempotency_key": "ms:intent:hijack-b",
    }).json()

    hijack = client.post(f"/api/finance-core/obligations/{obl_a['id']}/settle", headers=auth_headers, json={
        "amount": "200.00", "payment_intent_id": intent_b["id"], "idempotency_key": "ms:stl:hijack-a",
    })
    assert hijack.status_code == 400, "un PaymentIntent d'une AUTRE obligation ne doit jamais être accepté silencieusement"

    obl_a_after = client.get(f"/api/finance-core/obligations/{obl_a['id']}", headers=auth_headers).json()
    assert obl_a_after["status"] == "open", "le rejet doit être total : rien ne doit avoir été réglé"


def test_payroll_slip_cross_society_denied(client, auth_headers, restricted_headers, db):
    _grant_finances(db)
    emp = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "MS_PAIE1", "first_name": "MS", "last_name": "Paie", "society": SOC_B, "status": "actif", "contract_type": "CDI",
    }).json()
    emp_id = emp.get("id") or emp.get("backendId")
    run = client.post("/api/payroll/runs", headers=auth_headers, json={"society": SOC_B, "period": "2027-05", "idempotency_key": "ms:run:1"}).json()
    slip = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={
        "employee_id": int(emp_id), "idempotency_key": "ms:slip:1",
    }).json()

    r = client.get(f"/api/payroll/slips/{slip['id']}", headers=restricted_headers)
    assert r.status_code == 403

    validate_attempt = client.post(f"/api/payroll/slips/{slip['id']}/validate", headers=restricted_headers)
    assert validate_attempt.status_code == 403
    still_draft = client.get(f"/api/payroll/slips/{slip['id']}", headers=auth_headers).json()
    assert still_draft["status"] == "draft", "une tentative de validation refusée ne doit jamais avoir d'effet"


def test_bank_statement_close_cross_society_denied(client, auth_headers, restricted_headers, db):
    _grant_finances(db)
    account = client.post("/api/banking/accounts", headers=auth_headers, json={
        "society": SOC_B, "bank_name": "BNA", "account_number": "MS-BANK-0001",
    }).json()
    files = {"file": ("r.csv", io.BytesIO(b"date,label,reference,credit\n2026-09-01,Test,MS-REF,100.00\n"), "text/csv")}
    data = {"society": SOC_B, "bank_account_id": str(account["id"]), "import_format": "csv", "idempotency_key": "ms:import:1"}
    statement = client.post("/api/banking/statements/import", headers=auth_headers, data=data, files=files).json()

    r = client.post(f"/api/banking/statements/{statement['id']}/close", headers=restricted_headers)
    assert r.status_code == 403


def test_reconciliation_propose_cross_society_denied(client, auth_headers, restricted_headers, db):
    """Item 10/11 (revue d'intégrité) — TROUVÉ PENDANT L'AUDIT : POST .../propose n'appliquait
    AUCUN contrôle de société avant cette revue — corrigé, testé ici explicitement."""
    _grant_finances(db)
    account = client.post("/api/banking/accounts", headers=auth_headers, json={
        "society": SOC_B, "bank_name": "BNA", "account_number": "MS-BANK-0002",
    }).json()
    files = {"file": ("r.csv", io.BytesIO(b"date,label,reference,credit\n2026-09-02,Test,MS-REF-2,250.00\n"), "text/csv")}
    data = {"society": SOC_B, "bank_account_id": str(account["id"]), "import_format": "csv", "idempotency_key": "ms:import:2"}
    client.post("/api/banking/statements/import", headers=auth_headers, data=data, files=files)
    tx = client.get("/api/banking/transactions", headers=auth_headers, params={"bank_account_id": account["id"]}).json()["items"][0]

    r = client.post(f"/api/reconciliation/transactions/{tx['id']}/propose", headers=restricted_headers)
    assert r.status_code == 403


def test_budget_line_cross_society_denied(client, auth_headers, restricted_headers, db):
    _grant_finances(db)
    line = client.post("/api/budget/lines", headers=auth_headers, json={
        "society": SOC_B, "period": "2026-09", "compte": "607", "montant_budgete": "1000.00",
    }).json()
    r = client.post(f"/api/budget/lines/{line['id']}/submit", headers=restricted_headers)
    assert r.status_code == 403


def test_fiscal_obligation_mark_paid_cross_society_denied(client, auth_headers, restricted_headers, db):
    """Item 10/11 (revue d'intégrité) — TROUVÉ PENDANT L'AUDIT : mark-paid appelait
    service.mark_paid() (mutation + flush) AVANT le contrôle de société — corrigé (vérifié
    sur lecture seule d'abord), testé ici explicitement."""
    _grant_finances(db)
    declared = client.post("/api/fiscalite/declare", headers=auth_headers, json={
        "society": SOC_B, "obligation_type": "g50_tva", "period": "2026-09", "montant": "1000.00",
        "echeance": "2026-10-20", "idempotency_key": "ms:fisc:1",
    }).json()
    r = client.post(f"/api/fiscalite/{declared['id']}/mark-paid", headers=restricted_headers)
    assert r.status_code == 403
    still_declared = client.get("/api/fiscalite/calendar", headers=auth_headers, params={"society": SOC_B}).json()
    matching = [o for o in still_declared if o["id"] == declared["id"]]
    assert matching and matching[0]["status"] == "declared", "une tentative refusée ne doit jamais muter l'obligation fiscale"


def test_cockpit_summary_cross_society_denied(client, auth_headers, restricted_headers, db):
    _grant_finances(db)
    r = client.get("/api/cockpit/summary", headers=restricted_headers, params={"society": SOC_B, "period": "2026-09"})
    assert r.status_code == 403


def test_accounting_events_cross_society_denied(client, auth_headers, restricted_headers, db):
    """Revue finale bloquante V2, item 2 — TROUVÉ PENDANT L'AUDIT : GET /finance-core/
    accounting-events n'appliquait aucun scope société. (a) un compte restreint qui omet
    `society` ne doit voir QUE les événements de ses propres sociétés autorisées — jamais
    ceux d'une autre société entièrement ; (b) passer explicitement une société hors scope
    doit être refusé (403), pas silencieusement servi."""
    _grant_finances(db)
    obl_b = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC_B, "direction": "receivable", "source_type": "manual", "source_id": "MS-EVT-B",
        "amount_total": "77.00", "idempotency_key": "ms:evt:obl-b",
    }).json()
    client.post(f"/api/finance-core/obligations/{obl_b['id']}/settle", headers=auth_headers, json={
        "amount": "77.00", "idempotency_key": "ms:evt:stl-b",
    })
    client.post("/api/finance-core/outbox/dispatch", headers=auth_headers)

    # (b) refus explicite d'une société hors scope
    denied = client.get("/api/finance-core/accounting-events", headers=restricted_headers, params={"society": SOC_B})
    assert denied.status_code == 403

    # (a) même en omettant `society`, aucun événement de SOC_B ne doit fuiter vers un
    # compte restreint à SOC_A — même si SOC_B a bien des événements réels à cet instant.
    omitted = client.get("/api/finance-core/accounting-events", headers=restricted_headers)
    assert omitted.status_code == 200, omitted.text
    leaked = [e for e in omitted.json() if e["society"] == SOC_B]
    assert not leaked, f"fuite cross-société détectée : {leaked}"


def test_regulatory_rules_and_proposals_cross_society_denied(client, auth_headers, restricted_headers, db):
    """Revue finale bloquante V2, item 2 — TROUVÉ PENDANT L'AUDIT : /api/regulatory ne
    filtrait aucune lecture (rules/proposals/versions) par société, alors qu'une
    RegulatoryRule PEUT être spécifique à une société. Un compte restreint à SOC_A ne doit
    jamais voir une règle/proposition/version propre à SOC_B — mais doit toujours voir les
    règles nationales (society=None)."""
    _grant_finances(db)
    rule_b = client.post("/api/regulatory/rules", headers=auth_headers, json={
        "rule_type": "ms_regulatory_test", "society": SOC_B, "label": "Règle SOC_B",
    }).json()
    src = client.post("/api/regulatory/sources", headers=auth_headers, json={"name": "Source test MS", "reliability": "verified"}).json()
    proposal_b = client.post("/api/regulatory/proposals", headers=auth_headers, json={
        "rule_id": rule_b["id"], "proposed_parameters": {"taux": 0.5}, "proposed_effective_from": "2026-01-01", "source_id": src["id"],
    }).json()
    client.post(f"/api/regulatory/proposals/{proposal_b['id']}/approve", headers=auth_headers, json={"mark_verified": True})

    rules = client.get("/api/regulatory/rules", headers=restricted_headers).json()
    assert not any(r["id"] == rule_b["id"] for r in rules), "une règle propre à une autre société ne doit jamais fuiter"

    proposals = client.get("/api/regulatory/proposals", headers=restricted_headers).json()
    assert not any(p["id"] == proposal_b["id"] for p in proposals), "une proposition propre à une autre société ne doit jamais fuiter"

    versions_denied = client.get(f"/api/regulatory/rules/{rule_b['id']}/versions", headers=restricted_headers)
    assert versions_denied.status_code == 403
