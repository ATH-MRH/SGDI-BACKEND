"""Banking — clôture de relevé (P1-H) : une période gelée n'accepte plus de nouveau
rapprochement, et clôturer un relevé avec des transactions non rapprochées est refusé."""
import io

SOC = "Iron Global Securite"
_seq = [0]


def _account(client, h):
    _seq[0] += 1
    r = client.post("/api/banking/accounts", headers=h, json={
        "society": SOC, "bank_name": "BNA", "account_number": f"0088{_seq[0]:07d}",
    })
    return r.json()


def test_close_statement_with_unmatched_transaction_refused(client, auth_headers):
    account = _account(client, auth_headers)
    files = {"file": ("r.csv", io.BytesIO(
        b"date,label,reference,credit\n2026-09-15,Virement inconnu,XYZ,100.00\n"
    ), "text/csv")}
    data = {"society": SOC, "bank_account_id": str(account["id"]), "import_format": "csv", "idempotency_key": "close-1"}
    statement = client.post("/api/banking/statements/import", headers=auth_headers, data=data, files=files).json()

    r = client.post(f"/api/banking/statements/{statement['id']}/close", headers=auth_headers)
    assert r.status_code == 409, r.text


def test_close_statement_fully_reconciled_succeeds_and_freezes_period(client, auth_headers):
    account = _account(client, auth_headers)
    obl = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "receivable", "source_type": "invoice", "source_id": "FAC-CLOSE-1",
        "amount_total": "100.00", "counterparty_name": "Client Clôture", "idempotency_key": "close:obl:1",
    }).json()
    files = {"file": ("r.csv", io.BytesIO(
        b"date,label,reference,credit\n2026-09-16,Virement,FAC-CLOSE-1,100.00\n"
    ), "text/csv")}
    data = {"society": SOC, "bank_account_id": str(account["id"]), "import_format": "csv", "idempotency_key": "close-2"}
    statement = client.post("/api/banking/statements/import", headers=auth_headers, data=data, files=files).json()

    tx = client.get("/api/banking/transactions", headers=auth_headers, params={"bank_account_id": account["id"]}).json()["items"][0]
    case = client.post(f"/api/reconciliation/transactions/{tx['id']}/propose", headers=auth_headers).json()
    client.post(f"/api/reconciliation/cases/{case['id']}/confirm", headers=auth_headers)

    r = client.post(f"/api/banking/statements/{statement['id']}/close", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["closed"] == 1

    reopened = client.post(f"/api/banking/statements/{statement['id']}/reopen", headers=auth_headers)
    assert reopened.status_code == 200
    assert reopened.json()["closed"] == 0
