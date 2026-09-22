"""Paie typée (P1-A) — chaîne complète : pointage clôturé -> variables -> grille -> calcul
-> validation (immuable) -> obligations Finance Core (net à payer/CNAS/IRG), avec
traçabilité des règles réglementaires utilisées."""
from datetime import date

SOC = "Iron Global Securite"


def _emp(client, h, code):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "Paie", "society": SOC, "status": "actif", "contract_type": "CDI",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _site(client, h, name):
    from tests.site_fixtures import historical_site
    r = historical_site(client, headers=h, json={
        "name": name, "indicatif": name[:3].upper(), "rotation_system": "24/48",
        "contractual_staff": 0, "active": 1, "equipment_plan": {"societe": SOC, "dateOuverture": "2020-01-01"},
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _assign(client, h, emp_id, site_id):
    r = client.post("/api/ops/assignments", headers=h, json={
        "employee_id": int(emp_id), "site_id": int(site_id), "group_code": "A", "start_date": "2026-08-01", "active": 1,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _seed_cnas_irg_rules(client, h, *, taux_salarial=0.09, taux_patronal=0.26):
    src = client.post("/api/regulatory/sources", headers=h, json={
        "name": "Barème test paie", "reference": "TEST-PAIE-0001", "reliability": "unverified",
    }).json()
    for rule_type, params in (
        ("cnas_taux_salarial", {"taux": taux_salarial}),
        ("cnas_taux_patronal", {"taux": taux_patronal}),
        ("irg_bareme", {"brackets": [{"up_to": 30000, "rate": 0.0}, {"up_to": 60000, "rate": 0.1}, {"up_to": None, "rate": 0.2}]}),
    ):
        rule = client.post("/api/regulatory/rules", headers=h, json={"rule_type": rule_type, "society": SOC, "label": rule_type}).json()
        proposal = client.post("/api/regulatory/proposals", headers=h, json={
            "rule_id": rule["id"], "proposed_parameters": params, "proposed_effective_from": "2026-01-01", "source_id": src["id"],
        }).json()
        client.post(f"/api/regulatory/proposals/{proposal['id']}/approve", headers=h, json={"mark_verified": False})


def _close_presence(client, h, day: str, emp_id, site_id):
    client.post(f"/api/ops/pointage/daily/generate?presence_date={day}", headers=h)
    client.post(f"/api/ops/pointage/daily/close?presence_date={day}", headers=h)


def test_payroll_full_chain_pointage_to_accounting(client, auth_headers):
    _seed_cnas_irg_rules(client, auth_headers)
    emp = _emp(client, auth_headers, "PAIE_E1")
    site = _site(client, auth_headers, "SitePaieE1")
    _assign(client, auth_headers, emp, site)
    _close_presence(client, auth_headers, "2026-09-05", emp, site)

    grid = client.post("/api/payroll/salary-grids", headers=auth_headers, json={
        "society": SOC, "poste": "Agent de sécurité", "salaire_base": "50000.00",
        "primes_fixes": [{"label": "Prime de zone", "montant": 2000}], "effective_from": "2026-01-01",
    }).json()
    assert grid["status"] == "active"

    run = client.post("/api/payroll/runs", headers=auth_headers, json={"society": SOC, "period": "2026-09", "idempotency_key": "run:test1"}).json()

    slip = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={
        "employee_id": int(emp), "salary_grid_id": grid["id"], "idempotency_key": "slip:test1",
    })
    assert slip.status_code == 200, slip.text
    slip = slip.json()
    assert slip["status"] == "draft"
    assert float(slip["base"]) == 50000.0
    assert float(slip["brut"]) == 52000.0  # base + prime fixe
    assert float(slip["cotisation_salariale"]) == round(52000 * 0.09, 2)
    assert slip["rules_used"]["cnas_taux_salarial"]["status"] == "unverified", "la traçabilité doit refléter honnêtement que la règle n'est pas vérifiée"
    assert slip["inputs"]["closed_presence_rows"] >= 1, "le calcul doit refléter le pointage réellement clôturé"

    validated = client.post(f"/api/payroll/slips/{slip['id']}/validate", headers=auth_headers)
    assert validated.status_code == 200, validated.text
    validated = validated.json()
    assert validated["status"] == "validated"
    assert validated["obligation_id"] is not None
    assert validated["cnas_obligation_id"] is not None
    assert validated["irg_obligation_id"] is not None

    # Immuabilité : revalider ne recrée pas de nouvelle obligation (idempotent).
    revalidated = client.post(f"/api/payroll/slips/{slip['id']}/validate", headers=auth_headers).json()
    assert revalidated["obligation_id"] == validated["obligation_id"]

    # Le net à payer est une obligation Finance Core comme les autres — réglée par le MÊME
    # moteur que factures/achats, jamais une seconde implémentation.
    net_obligation = client.get(f"/api/finance-core/obligations/{validated['obligation_id']}", headers=auth_headers).json()
    assert net_obligation["source_type"] == "payroll_slip"
    settle = client.post(f"/api/finance-core/obligations/{validated['obligation_id']}/settle", headers=auth_headers, json={
        "amount": net_obligation["amount_total"], "idempotency_key": "stl:payroll:test1",
    })
    assert settle.status_code == 200, settle.text

    # Le pont comptable (déjà générique) absorbe aussi ce règlement sans code spécifique paie.
    dispatch = client.post("/api/finance-core/outbox/dispatch", headers=auth_headers).json()
    assert dispatch["dispatched"] >= 1
    events = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC}).json()
    assert any(e["source_type"] == "settlement" and e["status"] == "posted" for e in events)


def test_payroll_run_cannot_validate_with_draft_slips(client, auth_headers):
    _seed_cnas_irg_rules(client, auth_headers, taux_salarial=0.09, taux_patronal=0.26)
    emp = _emp(client, auth_headers, "PAIE_E2")
    run = client.post("/api/payroll/runs", headers=auth_headers, json={"society": SOC, "period": "2026-10", "idempotency_key": "run:test2"}).json()
    client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={"employee_id": int(emp), "idempotency_key": "slip:test2"})
    r = client.post(f"/api/payroll/runs/{run['id']}/validate", headers=auth_headers)
    assert r.status_code == 409, "un cycle ne doit jamais se valider avec des bulletins encore en brouillon"


def test_payroll_slip_compute_is_idempotent(client, auth_headers):
    _seed_cnas_irg_rules(client, auth_headers, taux_salarial=0.09, taux_patronal=0.26)
    emp = _emp(client, auth_headers, "PAIE_E3")
    run = client.post("/api/payroll/runs", headers=auth_headers, json={"society": SOC, "period": "2026-11", "idempotency_key": "run:test3"}).json()
    s1 = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={"employee_id": int(emp), "idempotency_key": "slip:test3"}).json()
    s2 = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={"employee_id": int(emp), "idempotency_key": "slip:test3"}).json()
    assert s1["id"] == s2["id"]


def test_payroll_run_duplicate_period_refused(client, auth_headers):
    client.post("/api/payroll/runs", headers=auth_headers, json={"society": SOC, "period": "2026-12", "idempotency_key": "run:test4a"})
    r = client.post("/api/payroll/runs", headers=auth_headers, json={"society": SOC, "period": "2026-12", "idempotency_key": "run:test4b"})
    assert r.status_code == 409


def test_payroll_society_scope_enforced(client, restricted_headers, db):
    # Voir tests/test_reconciliation.py pour le détail de cette remise à un état neutre
    # (mutation partagée du compte testops par d'autres suites, ex. test_paie.py).
    from app.modules.auth.models import User
    user = db.query(User).filter(User.username == "testops").one()
    user.authorized_modules = ["ops", "dc"]
    db.commit()
    r = client.get("/api/payroll/runs", headers=restricted_headers)
    assert r.status_code == 403
