"""Banking Core (P1-D/P1-E) — comptes, import CSV réel, déduplication, contrôle
mathématique. Vrais endpoints, vraie base, sans mock."""
import io

SOC = "Iron Global Securite"

CSV_CONTENT = (
    "date,label,reference,debit,credit\n"
    "2026-09-01,Virement Client ACME,FAC-2026-001,,1000.00\n"
    "2026-09-02,Prelevement EDF,EDF-0912,250.50,\n"
    "2026-09-03,Virement Client BETA,FAC-2026-002,,500.00\n"
)


_account_seq = [0]


def _create_account(client, h):
    """Chaque appel utilise un numéro de compte distinct — create_account est idempotent par
    (société, numéro), donc un numéro réutilisé entre deux tests renverrait le MÊME compte
    (et ses transactions déjà importées) plutôt qu'un compte neuf, faussant l'isolation."""
    _account_seq[0] += 1
    r = client.post("/api/banking/accounts", headers=h, json={
        "society": SOC, "bank_name": "BNA", "account_number": f"0012345{_account_seq[0]:04d}", "iban": "DZ001234567890",
    })
    assert r.status_code == 200, r.text
    return r.json()


def _upload(client, h, account_id, content=CSV_CONTENT, key="import-1", opening=None, closing=None):
    files = {"file": ("releve.csv", io.BytesIO(content.encode("utf-8")), "text/csv")}
    data = {"society": SOC, "bank_account_id": str(account_id), "import_format": "csv", "idempotency_key": key}
    if opening is not None:
        data["opening_balance"] = opening
    if closing is not None:
        data["closing_balance"] = closing
    return client.post("/api/banking/statements/import", headers=h, data=data, files=files)


def test_create_account_idempotent_by_number(client, auth_headers):
    payload = {"society": SOC, "bank_name": "BNA", "account_number": "00199999999", "iban": "DZ001999999999"}
    a = client.post("/api/banking/accounts", headers=auth_headers, json=payload).json()
    r = client.post("/api/banking/accounts", headers=auth_headers, json=payload)
    assert r.status_code == 200
    assert r.json()["id"] == a["id"]


def test_csv_import_creates_transactions_signed_correctly(client, auth_headers):
    account = _create_account(client, auth_headers)
    r = _upload(client, auth_headers, account["id"], key="import-signed")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["transaction_count"] == 3
    assert body["duplicate_count"] == 0

    txs = client.get("/api/banking/transactions", headers=auth_headers, params={"bank_account_id": account["id"]}).json()
    amounts = sorted(float(t["amount"]) for t in txs["items"])
    assert amounts == [-250.50, 500.00, 1000.00], "crédit positif, débit négatif — signe correct"


def test_csv_import_is_idempotent_by_key(client, auth_headers):
    account = _create_account(client, auth_headers)
    r1 = _upload(client, auth_headers, account["id"], key="import-idem")
    r2 = _upload(client, auth_headers, account["id"], key="import-idem")
    assert r1.json()["id"] == r2.json()["id"], "réimporter avec la même clé ne doit jamais dupliquer le relevé"


def test_csv_reimport_same_content_different_key_deduplicates_transactions(client, auth_headers):
    """Deux imports SÉPARÉS (clés différentes, ex. l'utilisateur réimporte le même fichier par
    erreur) ne doivent jamais dupliquer les TRANSACTIONS elles-mêmes (dedup_hash)."""
    account = _create_account(client, auth_headers)
    r1 = _upload(client, auth_headers, account["id"], key="import-a")
    assert r1.json()["transaction_count"] == 3
    r2 = _upload(client, auth_headers, account["id"], key="import-b")
    assert r2.json()["transaction_count"] == 0
    assert r2.json()["duplicate_count"] == 3


def test_csv_import_balance_control_ok_and_mismatch(client, auth_headers):
    account = _create_account(client, auth_headers)
    ok = _upload(client, auth_headers, account["id"], key="import-balance-ok", opening="10000.00", closing="11249.50")
    assert ok.json()["computed_balance_check"] == "ok", ok.json()

    account2 = _create_account_alt(client, auth_headers)
    bad = _upload(client, auth_headers, account2["id"], key="import-balance-bad", opening="0.00", closing="999999.00")
    assert bad.json()["computed_balance_check"] == "mismatch"


def _create_account_alt(client, h):
    r = client.post("/api/banking/accounts", headers=h, json={
        "society": SOC, "bank_name": "BNA", "account_number": "00987654321", "iban": "DZ009876543210",
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_unimplemented_import_format_returns_501_not_a_fake_success(client, auth_headers):
    account = _create_account(client, auth_headers)
    files = {"file": ("releve.xlsx", io.BytesIO(b"fake"), "application/octet-stream")}
    data = {"society": SOC, "bank_account_id": str(account["id"]), "import_format": "xlsx", "idempotency_key": "import-xlsx"}
    r = client.post("/api/banking/statements/import", headers=auth_headers, data=data, files=files)
    assert r.status_code == 501, "XLSX n'est pas réellement implémenté — jamais un faux succès"


def test_banking_society_scope_enforced(client, auth_headers, restricted_headers, db):
    # Voir test_reconciliation.py::test_reconciliation_society_scope_enforced pour le détail
    # de cette remise à un état neutre (mutation partagée testops par d'autres suites).
    from app.modules.auth.models import User
    user = db.query(User).filter(User.username == "testops").one()
    user.authorized_modules = ["ops", "dc"]
    db.commit()
    r = client.get("/api/banking/accounts", headers=restricted_headers)
    assert r.status_code == 403
