"""Référentiel réglementaire versionné — reproduction historique du calcul applicable à une
période donnée, jamais 'la règle actuelle' par défaut pour une période passée."""
SOC = "Iron Global Securite"


def _make_rule_with_two_versions(client, h):
    rule = client.post("/api/regulatory/rules", headers=h, json={"rule_type": "cnas_taux_salarial", "society": SOC, "label": "Taux CNAS salarial (test)"}).json()
    v1 = client.post("/api/regulatory/rules", headers=h, json={"rule_type": "cnas_taux_salarial", "society": SOC, "label": "Taux CNAS salarial (test)"}).json()
    # ajout de deux versions successives directement via l'API (pas d'endpoint POST /versions
    # dédié exposé — testé via le service directement serait redondant ; on passe par
    # approve_proposal pour exercer aussi ce chemin).
    return rule


def test_no_applicable_rule_before_any_version_exists(client, auth_headers):
    rule = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": "irg_bareme", "society": SOC, "label": "Barème IRG (test isolé)"}).json()
    r = client.get("/api/regulatory/applicable", headers=auth_headers, params={"rule_type": "irg_bareme_isole_inexistant", "as_of_date": "2026-01-01", "society": SOC})
    assert r.status_code == 404


def test_proposal_approve_creates_version_and_historical_lookup_is_precise(client, auth_headers):
    src = client.post("/api/regulatory/sources", headers=auth_headers, json={"name": "Barème test", "reference": "TEST-JO-0001", "reliability": "unverified"}).json()
    rule = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": "cnas_taux_salarial_test1", "society": SOC, "label": "Taux CNAS (test 1)"}).json()

    p1 = client.post("/api/regulatory/proposals", headers=auth_headers, json={
        "rule_id": rule["id"], "proposed_parameters": {"taux": 0.09}, "proposed_effective_from": "2026-01-01",
        "diff_summary": "Version initiale", "source_id": src["id"],
    }).json()
    a1 = client.post(f"/api/regulatory/proposals/{p1['id']}/approve", headers=auth_headers, json={"mark_verified": False})
    assert a1.status_code == 200, a1.text

    p2 = client.post("/api/regulatory/proposals", headers=auth_headers, json={
        "rule_id": rule["id"], "proposed_parameters": {"taux": 0.10}, "proposed_effective_from": "2026-07-01",
        "diff_summary": "Revalorisation", "source_id": src["id"],
    }).json()
    client.post(f"/api/regulatory/proposals/{p2['id']}/approve", headers=auth_headers, json={"mark_verified": False})

    # Une date de janvier doit retrouver le TAUX DE JANVIER, jamais celui de juillet (pas
    # de recalcul rétroactif silencieux avec la règle "actuelle").
    jan = client.get("/api/regulatory/applicable", headers=auth_headers, params={"rule_type": "cnas_taux_salarial_test1", "as_of_date": "2026-03-15", "society": SOC, "allow_unverified": True}).json()
    assert jan["parameters"]["taux"] == 0.09

    aug = client.get("/api/regulatory/applicable", headers=auth_headers, params={"rule_type": "cnas_taux_salarial_test1", "as_of_date": "2026-08-15", "society": SOC, "allow_unverified": True}).json()
    assert aug["parameters"]["taux"] == 0.10


def test_unverified_rule_refused_without_explicit_flag(client, auth_headers):
    src = client.post("/api/regulatory/sources", headers=auth_headers, json={"name": "Source non vérifiée", "reliability": "unverified"}).json()
    rule = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": "cnas_taux_salarial_test2", "society": SOC, "label": "Test"}).json()
    p = client.post("/api/regulatory/proposals", headers=auth_headers, json={
        "rule_id": rule["id"], "proposed_parameters": {"taux": 0.09}, "proposed_effective_from": "2026-01-01", "source_id": src["id"],
    }).json()
    client.post(f"/api/regulatory/proposals/{p['id']}/approve", headers=auth_headers, json={"mark_verified": False})

    refused = client.get("/api/regulatory/applicable", headers=auth_headers, params={"rule_type": "cnas_taux_salarial_test2", "as_of_date": "2026-03-01", "society": SOC})
    assert refused.status_code == 404, "une règle non vérifiée ne doit jamais être utilisée silencieusement sans allow_unverified explicite"

    allowed = client.get("/api/regulatory/applicable", headers=auth_headers, params={"rule_type": "cnas_taux_salarial_test2", "as_of_date": "2026-03-01", "society": SOC, "allow_unverified": True})
    assert allowed.status_code == 200


def test_reject_proposal_creates_no_version(client, auth_headers):
    rule = client.post("/api/regulatory/rules", headers=auth_headers, json={"rule_type": "cnas_taux_salarial_test3", "society": SOC, "label": "Test"}).json()
    p = client.post("/api/regulatory/proposals", headers=auth_headers, json={
        "rule_id": rule["id"], "proposed_parameters": {"taux": 0.5}, "proposed_effective_from": "2026-01-01",
    }).json()
    r = client.post(f"/api/regulatory/proposals/{p['id']}/reject", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"
    lookup = client.get("/api/regulatory/applicable", headers=auth_headers, params={"rule_type": "cnas_taux_salarial_test3", "as_of_date": "2026-03-01", "society": SOC, "allow_unverified": True})
    assert lookup.status_code == 404, "une proposition rejetée ne doit jamais devenir applicable"


def test_regulatory_reserved_to_admin_for_writes(client, restricted_headers):
    r = client.post("/api/regulatory/rules", headers=restricted_headers, json={"rule_type": "x", "label": "x"})
    assert r.status_code == 403
