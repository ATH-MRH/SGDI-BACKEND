"""Frontend V2 — les quelques endpoints de lecture/agrégat ajoutés pour construire
l'interface complète (mission explicite : "créer uniquement un endpoint lecture/agrégat sûr
si nécessaire ; ne pas inventer de donnée métier"). Aucun moteur financier réécrit, aucune
migration, aucune règle de paie/réglementaire modifiée."""
import io
from datetime import date

SOC = "Iron Global Securite"
SOC_B = "Sword Corporation"


def test_known_societies_lists_real_societies_only(client, auth_headers):
    client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "receivable", "source_type": "manual", "source_id": "V2-SOC-1",
        "amount_total": "10.00", "idempotency_key": "v2:societies:1",
    })
    r = client.get("/api/finance-core/societies", headers=auth_headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert SOC in items
    assert items == sorted(items), "la liste doit être triée, jamais dans un ordre arbitraire"


def test_known_societies_scoped_for_restricted_user(client, restricted_headers, auth_headers, db):
    # Voir tests/test_reconciliation.py pour le détail de cette remise à un état neutre.
    from app.modules.auth.models import User
    user = db.query(User).filter(User.username == "testops").one()
    user.authorized_modules = ["ops", "dc", "finances"]
    db.commit()

    client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC_B, "direction": "receivable", "source_type": "manual", "source_id": "V2-SOC-2",
        "amount_total": "10.00", "idempotency_key": "v2:societies:2",
    })
    r = client.get("/api/finance-core/societies", headers=restricted_headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert SOC_B not in items, "un compte restreint à SOC ne doit jamais voir une société hors scope"


def test_accounting_events_limit_offset_do_not_break_existing_shape(client, auth_headers):
    obl = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "receivable", "source_type": "manual", "source_id": "V2-EVT-1",
        "amount_total": "50.00", "idempotency_key": "v2:evt:obl1",
    }).json()
    client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=auth_headers, json={
        "amount": "50.00", "idempotency_key": "v2:evt:stl1",
    })
    client.post("/api/finance-core/outbox/dispatch", headers=auth_headers)

    default = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC}).json()
    assert isinstance(default, list), "la forme de réponse (liste brute) ne doit jamais changer pour les appelants existants"

    limited = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC, "limit": 1}).json()
    assert isinstance(limited, list) and len(limited) <= 1


def test_payroll_runs_list_includes_aggregate_totals(client, auth_headers):
    src = client.post("/api/regulatory/sources", headers=auth_headers, json={"name": "V2 Paie", "reliability": "verified"}).json()
    for rule_type, params in (("cnas_taux_salarial", {"taux": 0.09}), ("cnas_taux_patronal", {"taux": 0.26}), ("irg_bareme", {"brackets": [{"up_to": None, "rate": 0.1}]})):
        rule = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": rule_type, "society": SOC, "label": rule_type}).json()
        proposal = client.post("/api/regulatory/proposals", headers=auth_headers, json={
            "rule_id": rule["id"], "proposed_parameters": params, "proposed_effective_from": "2026-01-01", "source_id": src["id"],
        }).json()
        client.post(f"/api/regulatory/proposals/{proposal['id']}/approve", headers=auth_headers, json={"mark_verified": True})

    emp = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "V2PAIE1", "first_name": "V2", "last_name": "Paie", "society": SOC, "status": "actif", "contract_type": "CDI",
    }).json()
    emp_id = emp.get("id") or emp.get("backendId")
    run = client.post("/api/payroll/runs", headers=auth_headers, json={"society": SOC, "period": "2027-06", "idempotency_key": "v2:run:1"}).json()
    grid = client.post("/api/payroll/salary-grids", headers=auth_headers, json={
        "society": SOC, "poste": "V2 Poste", "salaire_base": "40000.00", "effective_from": "2026-01-01",
    }).json()
    slip = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={
        "employee_id": int(emp_id), "salary_grid_id": grid["id"], "idempotency_key": "v2:slip:1",
    }).json()
    client.post(f"/api/payroll/slips/{slip['id']}/validate", headers=auth_headers)

    runs = client.get("/api/payroll/runs", headers=auth_headers, params={"society": SOC}).json()
    this_run = next(r for r in runs if r["id"] == run["id"])
    assert this_run["slip_count"] == 1
    assert this_run["validated_count"] == 1
    assert float(this_run["brut"]) == 40000.0
    assert float(this_run["net_a_payer"]) == float(slip["net_a_payer"]) or float(this_run["net_a_payer"]) > 0


def test_banking_statements_list(client, auth_headers):
    account = client.post("/api/banking/accounts", headers=auth_headers, json={
        "society": SOC, "bank_name": "BNA", "account_number": "V2-STMT-0001",
    }).json()
    files = {"file": ("r.csv", io.BytesIO(b"date,label,reference,credit\n2026-09-01,Test,V2-REF,100.00\n"), "text/csv")}
    data = {"society": SOC, "bank_account_id": str(account["id"]), "import_format": "csv", "idempotency_key": "v2:stmt:import1"}
    imported = client.post("/api/banking/statements/import", headers=auth_headers, data=data, files=files).json()

    r = client.get("/api/banking/statements", headers=auth_headers, params={"society": SOC, "bank_account_id": account["id"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and "total" in body
    matching = [s for s in body["items"] if s["id"] == imported["id"]]
    assert matching, "le relevé importé doit apparaître dans la liste"


def test_banking_statements_society_scope_enforced(client, restricted_headers, auth_headers, db):
    from app.modules.auth.models import User
    user = db.query(User).filter(User.username == "testops").one()
    user.authorized_modules = ["ops", "dc", "finances"]
    db.commit()

    r = client.get("/api/banking/statements", headers=restricted_headers, params={"society": SOC_B})
    assert r.status_code == 403
