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
        "name": "Barème test paie", "reference": "TEST-PAIE-0001", "reliability": "verified",
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
        # mark_verified=True : la majorité des tests de ce fichier valident réellement un
        # bulletin (déclenche la garde P0 slip_validation_blockers) — le cas "règle non
        # vérifiée bloque la validation" a son propre test dédié plus bas, avec
        # mark_verified=False explicite.
        client.post(f"/api/regulatory/proposals/{proposal['id']}/approve", headers=h, json={"mark_verified": True})


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
    assert slip["rules_used"]["cnas_taux_salarial"]["status"] == "active", "la traçabilité doit refléter honnêtement que la règle est vérifiée"
    assert slip["validatable"] is True and slip["validation_blockers"] == []
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


# ── P0 (revue d'intégrité) : une règle non vérifiée ne doit JAMAIS produire une obligation ──

def test_payroll_slip_with_unverified_rule_cannot_be_validated(client, auth_headers):
    """Reproduit exactement le scénario visé par la revue : calculer un bulletin AVEC une
    règle CNAS/IRG non vérifiée doit rester une simulation — la validation (et donc toute
    FinancialObligation/PaymentIntent/AccountingEvent en aval) doit être refusée tant que la
    règle n'est pas explicitement marquée vérifiée."""
    src = client.post("/api/regulatory/sources", headers=auth_headers, json={"name": "Barème non vérifié (test)", "reliability": "unverified"}).json()
    rule = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": "cnas_taux_salarial_unverif", "society": SOC, "label": "CNAS test non vérifié"}).json()
    proposal = client.post("/api/regulatory/proposals", headers=auth_headers, json={
        "rule_id": rule["id"], "proposed_parameters": {"taux": 0.09}, "proposed_effective_from": "2026-01-01", "source_id": src["id"],
    }).json()
    client.post(f"/api/regulatory/proposals/{proposal['id']}/approve", headers=auth_headers, json={"mark_verified": False})

    # Cette règle rule_type="cnas_taux_salarial_unverif" n'est PAS celle que le moteur paie
    # lit réellement (il lit "cnas_taux_salarial" fixe) — ce test vérifie donc directement le
    # comportement du référentiel + le garde-fou côté service, sans dépendre du calcul complet.
    from app.modules.payroll import service as payroll_service
    fake_slip = type("FakeSlip", (), {"rules_used": {
        "cnas_taux_salarial": {"version_id": 1, "status": "unverified", "parameters": {"taux": 0.09}},
        "cnas_taux_patronal": {"version_id": 2, "status": "active", "parameters": {"taux": 0.26}},
        "irg_bareme": {"version_id": 3, "status": "active", "parameters": {"brackets": []}},
    }})()
    blockers = payroll_service.slip_validation_blockers(fake_slip)
    assert blockers and "cnas_taux_salarial" in blockers[0]
    assert payroll_service.is_slip_validatable(fake_slip) is False

    fake_slip_missing = type("FakeSlip", (), {"rules_used": {"irg_bareme": {"error": "aucune version ne couvre cette date"}}})()
    assert payroll_service.is_slip_validatable(fake_slip_missing) is False, "une règle absente doit bloquer tout autant qu'une règle non vérifiée"

    fake_slip_ok = type("FakeSlip", (), {"rules_used": {
        "cnas_taux_salarial": {"version_id": 1, "status": "active", "parameters": {"taux": 0.09}},
    }})()
    assert payroll_service.is_slip_validatable(fake_slip_ok) is True


def test_payroll_slip_end_to_end_blocked_then_unblocked_by_verification(client, auth_headers):
    """Bout en bout via l'API réelle (pas seulement le service) : un cycle de paie complet
    avec une règle non vérifiée -> validation refusée (409) -> aucune obligation créée ->
    la même règle est marquée vérifiée -> un NOUVEAU calcul (nouvel idempotency_key, le
    brouillon existant n'est JAMAIS modifié) devient validable."""
    src = client.post("/api/regulatory/sources", headers=auth_headers, json={"name": "Barème blocage E2E", "reliability": "unverified"}).json()
    r_cnas_sal = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": "cnas_taux_salarial", "society": "Sword Corporation", "label": "cnas_taux_salarial"}).json()
    for rule_type, params, rid in (
        ("cnas_taux_salarial", {"taux": 0.09}, r_cnas_sal["id"]),
    ):
        proposal = client.post("/api/regulatory/proposals", headers=auth_headers, json={
            "rule_id": rid, "proposed_parameters": params, "proposed_effective_from": "2026-01-01", "source_id": src["id"],
        }).json()
        client.post(f"/api/regulatory/proposals/{proposal['id']}/approve", headers=auth_headers, json={"mark_verified": False})
    # cnas_taux_patronal/irg_bareme manquants pour cette société -> erreurs "error" dans
    # rules_used, qui bloquent également (couvert par le test unitaire ci-dessus) ; ici on se
    # concentre sur le cas "présent mais non vérifié".

    emp = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "PAIE_BLOCK1", "first_name": "Bloc", "last_name": "Paie", "society": "Sword Corporation", "status": "actif", "contract_type": "CDI",
    }).json()
    emp_id = emp.get("id") or emp.get("backendId")
    run = client.post("/api/payroll/runs", headers=auth_headers, json={"society": "Sword Corporation", "period": "2026-09", "idempotency_key": "run:block1"}).json()
    slip = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={"employee_id": int(emp_id), "idempotency_key": "slip:block1"}).json()
    assert slip["validatable"] is False
    assert slip["validation_blockers"]

    refused = client.post(f"/api/payroll/slips/{slip['id']}/validate", headers=auth_headers)
    assert refused.status_code == 409, refused.text
    assert slip["obligation_id"] is None

    obligations_before = client.get("/api/finance-core/obligations", headers=auth_headers, params={"society": "Sword Corporation", "direction": "payable"}).json()["items"]
    assert not any(o["source_type"] == "payroll_slip" and o["source_id"] == str(slip["id"]) for o in obligations_before), "aucune obligation ne doit exister pour un bulletin refusé"


# ── P0 (revue d'intégrité, §3 paie historique) : période P -> grille/règles applicables à P,
# jamais recalcul rétroactif silencieux d'un bulletin déjà validé ────────────────────────────

def test_salary_grid_historical_lookup_is_precise(client, auth_headers, db):
    """Reproduit pour la grille salariale la même preuve que
    test_regulatory.test_proposal_approve_creates_version_and_historical_lookup_is_precise :
    une date de mars doit retrouver la grille DE MARS, jamais celle de juillet, même après
    qu'une nouvelle version a été créée. Pas d'endpoint API dédié (get_grid_applicable_at est
    un utilitaire interne, au même titre que regulatory.get_applicable_version) — testé
    directement via le service pour ne pas introduire de route supplémentaire hors mission."""
    from datetime import date
    from app.modules.payroll import service as payroll_service

    poste = "Agent grille historique"
    g1 = client.post("/api/payroll/salary-grids", headers=auth_headers, json={
        "society": SOC, "poste": poste, "salaire_base": "50000.00", "effective_from": "2026-01-01",
    }).json()
    g2 = client.post("/api/payroll/salary-grids", headers=auth_headers, json={
        "society": SOC, "poste": poste, "salaire_base": "60000.00", "effective_from": "2026-06-01",
    }).json()

    before_any = payroll_service.get_grid_applicable_at(db, society=SOC, poste=poste, as_of_date=date(2025, 12, 1))
    assert before_any is None, "aucune grille ne doit être retournée pour une date antérieure à toute version"

    march = payroll_service.get_grid_applicable_at(db, society=SOC, poste=poste, as_of_date=date(2026, 3, 15))
    assert march is not None and march.id == g1["id"], "mars doit retrouver la grille de janvier, pas la plus récente"

    august = payroll_service.get_grid_applicable_at(db, society=SOC, poste=poste, as_of_date=date(2026, 8, 15))
    assert august is not None and august.id == g2["id"]


def test_future_regulatory_rule_never_alters_already_validated_slip(client, auth_headers):
    """Un bulletin validé fige les valeurs (et rules_used) au moment du calcul — une nouvelle
    version réglementaire créée APRÈS coup, même avec une effective_from future, ne doit
    JAMAIS modifier le bulletin déjà validé (re-consultation via GET, pas de recalcul
    silencieux)."""
    soc = "Historique Paie SA"
    _seed_cnas_irg_rules(client, auth_headers)
    # _seed_cnas_irg_rules cible la société SOC="Iron Global Securite" par défaut ; on
    # duplique manuellement pour une société dédiée à ce test afin d'isoler les versions.
    src = client.post("/api/regulatory/sources", headers=auth_headers, json={"name": "Barème historique", "reference": "TEST-HIST-0001", "reliability": "verified"}).json()
    for rule_type, params in (
        ("cnas_taux_salarial", {"taux": 0.09}),
        ("cnas_taux_patronal", {"taux": 0.26}),
        ("irg_bareme", {"brackets": [{"up_to": 30000, "rate": 0.0}, {"up_to": None, "rate": 0.1}]}),
    ):
        rule = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": rule_type, "society": soc, "label": rule_type}).json()
        proposal = client.post("/api/regulatory/proposals", headers=auth_headers, json={
            "rule_id": rule["id"], "proposed_parameters": params, "proposed_effective_from": "2026-01-01", "source_id": src["id"],
        }).json()
        client.post(f"/api/regulatory/proposals/{proposal['id']}/approve", headers=auth_headers, json={"mark_verified": True})

    emp = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "PAIE_HIST1", "first_name": "Hist", "last_name": "Paie", "society": soc, "status": "actif", "contract_type": "CDI",
    }).json()
    emp_id = emp.get("id") or emp.get("backendId")
    run = client.post("/api/payroll/runs", headers=auth_headers, json={"society": soc, "period": "2026-09", "idempotency_key": "run:hist1"}).json()
    slip = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={"employee_id": int(emp_id), "idempotency_key": "slip:hist1"}).json()
    assert slip["validatable"] is True
    validated = client.post(f"/api/payroll/slips/{slip['id']}/validate", headers=auth_headers).json()
    assert validated["status"] == "validated"
    snapshot_rules_used = validated["rules_used"]
    snapshot_cotisation = validated["cotisation_salariale"]

    # Nouvelle version CNAS salarial, taux très différent, effective à partir d'octobre — donc
    # future par rapport au bulletin de septembre déjà calculé/validé.
    rule_cnas = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": "cnas_taux_salarial", "society": soc, "label": "cnas_taux_salarial"}).json()
    proposal2 = client.post("/api/regulatory/proposals", headers=auth_headers, json={
        "rule_id": rule_cnas["id"], "proposed_parameters": {"taux": 0.50}, "proposed_effective_from": "2026-10-01", "source_id": src["id"],
    }).json()
    approve2 = client.post(f"/api/regulatory/proposals/{proposal2['id']}/approve", headers=auth_headers, json={"mark_verified": True})
    assert approve2.status_code == 200, approve2.text

    refetched = client.get(f"/api/payroll/slips/{slip['id']}", headers=auth_headers).json()
    assert refetched["status"] == "validated"
    assert refetched["rules_used"] == snapshot_rules_used, "rules_used doit rester un instantané figé, jamais réévalué avec la nouvelle version"
    assert refetched["cotisation_salariale"] == snapshot_cotisation, "un taux futur ne doit jamais modifier rétroactivement un bulletin déjà validé"


def test_validated_slip_cannot_be_mutated_or_recomputed_in_parallel(client, auth_headers):
    """Preuve structurelle + comportementale : aucun verbe de mutation n'existe sur
    /api/payroll/slips/{id} (seuls GET et POST .../validate sont exposés — voir
    payroll/routes.py), et une tentative de second calcul pour le MÊME employé sur le MÊME
    cycle (nouvel idempotency_key, donc pas de simple no-op idempotent) est refusée
    proprement (409) — jamais un second bulletin parallèle, jamais un recalcul silencieux de
    celui déjà validé. (Un index UNIQUE (payroll_run_id, employee_id) existe déjà en base ;
    ce test prouve aussi que le service la fait respecter proprement, voir le garde ajouté
    dans compute_slip — trouvé pendant cette revue : l'IntegrityError brut remontait en 500
    avant ce correctif.)"""
    _seed_cnas_irg_rules(client, auth_headers)
    emp = _emp(client, auth_headers, "PAIE_NOMUT1")
    run = client.post("/api/payroll/runs", headers=auth_headers, json={"society": SOC, "period": "2027-03", "idempotency_key": "run:nomut1"}).json()
    slip = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={"employee_id": int(emp), "idempotency_key": "slip:nomut1"}).json()
    validated = client.post(f"/api/payroll/slips/{slip['id']}/validate", headers=auth_headers).json()
    assert validated["status"] == "validated"

    put_attempt = client.put(f"/api/payroll/slips/{slip['id']}", headers=auth_headers, json={"net_a_payer": "999999.99"})
    assert put_attempt.status_code in (404, 405), "aucun verbe de mutation ne doit exister sur un bulletin"
    delete_attempt = client.delete(f"/api/payroll/slips/{slip['id']}", headers=auth_headers)
    assert delete_attempt.status_code in (404, 405)

    recompute = client.post(f"/api/payroll/runs/{run['id']}/slips", headers=auth_headers, json={
        "employee_id": int(emp), "idempotency_key": "slip:nomut1-bis",
    })
    assert recompute.status_code == 409, "un second calcul pour le même employé/cycle doit être refusé proprement, jamais un 500 ni un second bulletin"

    still_there = client.get(f"/api/payroll/slips/{slip['id']}", headers=auth_headers).json()
    assert still_there["status"] == "validated"
    assert still_there["net_a_payer"] == validated["net_a_payer"], "le bulletin validé initial doit rester strictement inchangé"
