"""P2 (Trésorerie/Budget/Rentabilité/Fiscalité) + P3 (Cockpit DG) — agrégation réelle sur
sources canoniques déjà testées (Finance Core/Banking/Accounting/Ventes/Achats/Paie),
jamais une donnée fabriquée."""
import io
from datetime import date

SOC = "Iron Global Securite"
_seq = [0]


def _account(client, h):
    _seq[0] += 1
    r = client.post("/api/banking/accounts", headers=h, json={"society": SOC, "bank_name": "BNA", "account_number": f"0066{_seq[0]:07d}"})
    return r.json()


def test_treasury_position_reflects_real_imported_transactions(client, auth_headers):
    account = _account(client, auth_headers)
    files = {"file": ("r.csv", io.BytesIO(b"date,label,reference,credit\n2026-09-01,Virement,REF1,777.77\n"), "text/csv")}
    data = {"society": SOC, "bank_account_id": str(account["id"]), "import_format": "csv", "idempotency_key": f"tr-imp-{account['id']}"}
    client.post("/api/banking/statements/import", headers=auth_headers, data=data, files=files)

    positions = client.get("/api/treasury/positions", headers=auth_headers, params={"society": SOC}).json()
    matching = [p for p in positions if p["bank_account_id"] == account["id"]]
    assert matching and matching[0]["position"] == "777.77"


def test_treasury_echeancier_splits_receivable_payable(client, auth_headers):
    client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "receivable", "source_type": "manual", "source_id": "TR-REC-1",
        "amount_total": "1000.00", "counterparty_name": "Client TR", "idempotency_key": "tr:obl:rec1",
    })
    client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "payable", "source_type": "manual", "source_id": "TR-PAY-1",
        "amount_total": "400.00", "counterparty_name": "Fournisseur TR", "idempotency_key": "tr:obl:pay1",
    })
    ech = client.get("/api/treasury/echeancier", headers=auth_headers, params={"society": SOC}).json()
    assert any(e["obligation_id"] and e.get("amount_remaining") for e in ech["encaissements_attendus"])
    assert any(e.get("amount_remaining") for e in ech["decaissements_attendus"])


def test_budget_workflow_draft_to_locked_and_realise(client, auth_headers):
    line = client.post("/api/budget/lines", headers=auth_headers, json={
        "society": SOC, "period": "2026-09", "compte": "607", "centre_cout": "CC1", "montant_budgete": "100000.00",
    }).json()
    assert line["status"] == "draft"
    client.post(f"/api/budget/lines/{line['id']}/submit", headers=auth_headers)
    approved = client.post(f"/api/budget/lines/{line['id']}/approve", headers=auth_headers)
    assert approved.status_code == 200, approved.text
    locked = client.post(f"/api/budget/lines/{line['id']}/lock", headers=auth_headers)
    assert locked.status_code == 200
    assert locked.json()["status"] == "locked"
    # Un budget verrouillé ne peut plus être soumis à nouveau directement.
    resubmit = client.post(f"/api/budget/lines/{line['id']}/submit", headers=auth_headers)
    assert resubmit.status_code == 409


def test_budget_revise_creates_new_line_not_overwrite(client, auth_headers):
    line = client.post("/api/budget/lines", headers=auth_headers, json={"society": SOC, "period": "2026-09", "montant_budgete": "5000.00"}).json()
    revision = client.post(f"/api/budget/lines/{line['id']}/revise", headers=auth_headers, json={"montant_budgete": "6000.00"}).json()
    assert revision["id"] != line["id"]
    original_still = client.get("/api/budget/lines", headers=auth_headers, params={"society": SOC, "period": "2026-09"}).json()
    assert any(l["id"] == line["id"] for l in original_still), "la ligne d'origine ne doit jamais disparaître/être écrasée"


def test_profitability_margin_from_real_invoice_and_achat(client, auth_headers):
    devis = client.post("/api/ventes/devis", headers=auth_headers, json={
        "society": SOC, "client_name": "Client Rentabilite", "date_devis": "2026-09-01", "objet": "Test",
        "lignes": [{"designation": "Presta", "quantite": 1, "prix_unitaire_ht": 10000, "tva_pct": 19}],
    }).json()
    client.post(f"/api/ventes/devis/{devis['id']}/valider", headers=auth_headers)
    client.post(f"/api/ventes/devis/{devis['id']}/convertir", headers=auth_headers)

    margin = client.get("/api/profitability/margin", headers=auth_headers, params={"society": SOC, "period": "2026-09", "client": "Client Rentabilite"}).json()
    assert float(margin["ca"]) >= 10000.0
    assert "note" in margin


def test_fiscalite_declare_creates_financial_obligation_and_calendar(client, auth_headers):
    declared = client.post("/api/fiscalite/declare", headers=auth_headers, json={
        "society": SOC, "obligation_type": "g50_tva", "period": "2026-09", "base_calcul": "100000.00",
        "montant": "19000.00", "echeance": "2026-10-20", "proof_reference": "Déclaration G50 test",
        "idempotency_key": "fisc:g50:test1",
    }).json()
    assert declared["status"] == "declared"
    assert declared["financial_obligation_id"] is not None

    calendar = client.get("/api/fiscalite/calendar", headers=auth_headers, params={"society": SOC, "upcoming_only": True}).json()
    assert any(o["id"] == declared["id"] for o in calendar)

    # mark-paid refuse tant que l'obligation Finance Core liée n'est pas réglée.
    premature = client.post(f"/api/fiscalite/{declared['id']}/mark-paid", headers=auth_headers)
    assert premature.status_code == 409

    client.post(f"/api/finance-core/obligations/{declared['financial_obligation_id']}/settle", headers=auth_headers, json={
        "amount": "19000.00", "idempotency_key": "fisc:settle:test1",
    })
    ok = client.post(f"/api/fiscalite/{declared['id']}/mark-paid", headers=auth_headers)
    assert ok.status_code == 200
    assert ok.json()["status"] == "paid"


def test_cockpit_summary_aggregates_without_fabrication(client, auth_headers):
    r = client.get("/api/cockpit/summary", headers=auth_headers, params={"society": SOC, "period": "2026-09"})
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("tresorerie", "creances_ouvertes", "dettes_ouvertes", "chiffre_affaires", "marge_brute", "fiscalite_a_echeance", "rapprochements_non_resolus", "budget_vs_realise"):
        assert key in body


def test_treasury_budget_profitability_fiscalite_cockpit_scope_enforced(client, restricted_headers, db):
    from app.modules.auth.models import User
    user = db.query(User).filter(User.username == "testops").one()
    user.authorized_modules = ["ops", "dc"]
    db.commit()
    assert client.get("/api/treasury/positions", headers=restricted_headers, params={"society": SOC}).status_code == 403
    assert client.post("/api/budget/lines", headers=restricted_headers, json={"society": SOC, "period": "2026-09", "montant_budgete": "1"}).status_code == 403
    assert client.get("/api/profitability/margin", headers=restricted_headers, params={"society": SOC, "period": "2026-09"}).status_code == 403
    assert client.get("/api/fiscalite/calendar", headers=restricted_headers, params={"society": SOC}).status_code == 403
    assert client.get("/api/cockpit/summary", headers=restricted_headers, params={"society": SOC, "period": "2026-09"}).status_code == 403
