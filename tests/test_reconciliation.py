"""Reconciliation Engine (P1-F) + Settlement Engine (P1-G) — E2E réel : obligation ->
import bancaire -> proposition -> confirmation -> règlement -> obligation soldée."""
import io

SOC = "Iron Global Securite"
_seq = [0]


def _account(client, h):
    _seq[0] += 1
    r = client.post("/api/banking/accounts", headers=h, json={
        "society": SOC, "bank_name": "BNA", "account_number": f"0099{_seq[0]:07d}", "iban": None,
    })
    assert r.status_code == 200, r.text
    return r.json()


def _obligation(client, h, key, amount, direction="receivable", source_id="FAC-RC-1"):
    r = client.post("/api/finance-core/obligations", headers=h, json={
        "society": SOC, "direction": direction, "source_type": "invoice", "source_id": source_id,
        "amount_total": amount, "counterparty_name": "ACME", "idempotency_key": key,
    })
    assert r.status_code == 200, r.text
    return r.json()


def _import_csv(client, h, account_id, content, key):
    files = {"file": ("r.csv", io.BytesIO(content.encode("utf-8")), "text/csv")}
    data = {"society": SOC, "bank_account_id": str(account_id), "import_format": "csv", "idempotency_key": key}
    r = client.post("/api/banking/statements/import", headers=h, data=data, files=files)
    assert r.status_code == 200, r.text
    return r.json()


def _transactions(client, h, account_id):
    return client.get("/api/banking/transactions", headers=h, params={"bank_account_id": account_id}).json()["items"]


def test_1to1_reconciliation_exact_amount_and_reference(client, auth_headers):
    account = _account(client, auth_headers)
    obligation = _obligation(client, auth_headers, "rc-1to1", "1000.00", source_id="FAC-2026-9001")
    _import_csv(
        client, auth_headers, account["id"],
        "date,label,reference,credit\n2026-09-10,Virement recu,FAC-2026-9001,1000.00\n",
        key="rc-1to1-import",
    )
    tx = _transactions(client, auth_headers, account["id"])[0]

    proposed = client.post(f"/api/reconciliation/transactions/{tx['id']}/propose", headers=auth_headers)
    assert proposed.status_code == 200, proposed.text
    case = proposed.json()
    assert case is not None, "un cas 1:1 à score élevé (montant exact + référence exacte) doit être proposé"
    assert case["kind"] == "1:1"
    assert case["confidence_score"] >= 70
    assert case["status"] == "proposed"

    confirmed = client.post(f"/api/reconciliation/cases/{case['id']}/confirm", headers=auth_headers)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"

    obl_after = client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=auth_headers).json()
    assert obl_after["status"] == "settled"
    assert obl_after["amount_settled"] == "1000.00"

    tx_after = _transactions(client, auth_headers, account["id"])[0]
    assert tx_after["reconcile_status"] == "matched"
    assert tx_after["stage"] == "enriched"


def test_1toN_reconciliation_transaction_covers_two_obligations(client, auth_headers):
    account = _account(client, auth_headers)
    obl_a = _obligation(client, auth_headers, "rc-1n-a", "300.00", source_id="FAC-A")
    obl_b = _obligation(client, auth_headers, "rc-1n-b", "700.00", source_id="FAC-B")
    _import_csv(
        client, auth_headers, account["id"],
        "date,label,reference,credit\n2026-09-11,Virement groupe,FAC-A+FAC-B,1000.00\n",
        key="rc-1n-import",
    )
    tx = _transactions(client, auth_headers, account["id"])[0]
    proposed = client.post(f"/api/reconciliation/transactions/{tx['id']}/propose", headers=auth_headers)
    case = proposed.json()
    assert case is not None and case["kind"] == "1:N", case

    client.post(f"/api/reconciliation/cases/{case['id']}/confirm", headers=auth_headers)
    a_after = client.get(f"/api/finance-core/obligations/{obl_a['id']}", headers=auth_headers).json()
    b_after = client.get(f"/api/finance-core/obligations/{obl_b['id']}", headers=auth_headers).json()
    assert a_after["status"] == "settled"
    assert b_after["status"] == "settled"


def test_no_confident_match_creates_exception(client, auth_headers):
    account = _account(client, auth_headers)
    _import_csv(
        client, auth_headers, account["id"],
        "date,label,reference,credit\n2026-09-12,Virement mysterieux,XYZ-INCONNU,4242.00\n",
        key="rc-exception-import",
    )
    tx = _transactions(client, auth_headers, account["id"])[0]
    proposed = client.post(f"/api/reconciliation/transactions/{tx['id']}/propose", headers=auth_headers)
    assert proposed.json() is None, "aucune obligation ouverte ne correspond -> pas de proposition fabriquée"

    exceptions = client.get("/api/reconciliation/exceptions", headers=auth_headers, params={"society": SOC}).json()
    assert any(e["bank_transaction_id"] == tx["id"] for e in exceptions)


def test_reject_case_does_not_settle(client, auth_headers):
    account = _account(client, auth_headers)
    obligation = _obligation(client, auth_headers, "rc-reject", "555.00", source_id="FAC-REJECT")
    _import_csv(
        client, auth_headers, account["id"],
        "date,label,reference,credit\n2026-09-13,Virement,FAC-REJECT,555.00\n",
        key="rc-reject-import",
    )
    tx = _transactions(client, auth_headers, account["id"])[0]
    case = client.post(f"/api/reconciliation/transactions/{tx['id']}/propose", headers=auth_headers).json()

    r = client.post(f"/api/reconciliation/cases/{case['id']}/reject", headers=auth_headers, json={"reason": "faux positif"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"

    obl_after = client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=auth_headers).json()
    assert obl_after["status"] == "open", "un cas rejeté ne doit jamais régler l'obligation"


def test_confirm_case_twice_is_rejected_not_double_settled(client, auth_headers):
    account = _account(client, auth_headers)
    obligation = _obligation(client, auth_headers, "rc-double", "200.00", source_id="FAC-DOUBLE")
    _import_csv(
        client, auth_headers, account["id"],
        "date,label,reference,credit\n2026-09-14,Virement,FAC-DOUBLE,200.00\n",
        key="rc-double-import",
    )
    tx = _transactions(client, auth_headers, account["id"])[0]
    case = client.post(f"/api/reconciliation/transactions/{tx['id']}/propose", headers=auth_headers).json()
    r1 = client.post(f"/api/reconciliation/cases/{case['id']}/confirm", headers=auth_headers)
    assert r1.status_code == 200
    r2 = client.post(f"/api/reconciliation/cases/{case['id']}/confirm", headers=auth_headers)
    assert r2.status_code == 409, "un cas déjà confirmé ne doit jamais pouvoir être reconfirmé (double règlement)"


def test_reconciliation_society_scope_enforced(client, auth_headers, restricted_headers, db):
    # D'autres suites (ex. test_paie.py) accordent temporairement "finance" au compte
    # partagé testops pour leurs propres scénarios et committent la mutation — celle-ci
    # survit entre tests puisque testops est un utilisateur de session, pas recréé par test.
    # Remis à un état neutre explicitement ici pour ne pas dépendre de l'ordre d'exécution.
    from app.modules.auth.models import User
    user = db.query(User).filter(User.username == "testops").one()
    user.authorized_modules = ["ops", "dc"]
    db.commit()
    r = client.get("/api/reconciliation/cases", headers=restricted_headers)
    assert r.status_code == 403
