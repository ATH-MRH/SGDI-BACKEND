def test_full_contract_flow(client, auth_headers):
    r = client.post("/api/drh/candidates", headers=auth_headers, json={
        "first_name": "Amine", "last_name": "Boudiaf", "phone": "0550000000",
        "email": "a@b.com", "desired_position": "APS", "society": "Iron Global Securite",
        "expected_salary": 45000, "status": "nouvelle",
    })
    assert r.status_code in (200, 201), r.text
    cid = r.json()["data"]["id"]

    sections = ["identification","militaire","poste","avis","contact","habilitations","experience"]
    stamp = {"by": "recruteur", "at": "2026-08-01T10:00:00"}
    r2 = client.put(f"/api/drh/candidates/{cid}", headers=auth_headers, json={
        "expected_salary": 48000,
        "data": {
            "sectionValidations": {k: stamp for k in sections},
            "fichePositionValidee": True,
            "typeContrat": "CDD",
            "dateFinContrat": "2027-08-01",
            "numeroCnas": "123456789",
            "modePaiement": "Virement bancaire",
            "banque": "BEA",
            "iban": "DZ001234567890",
        },
    })
    assert r2.status_code == 200, r2.text

    reserve = client.post(f"/api/drh/candidates/{cid}/validate-final", headers=auth_headers)
    assert reserve.status_code == 200, reserve.text
    mark = client.post(f"/api/drh/candidates/{cid}/marquer-contractualisation", headers=auth_headers)
    assert mark.status_code == 200, mark.text

    r3 = client.post(f"/api/drh/candidates/{cid}/recruit", headers=auth_headers)
    assert r3.status_code == 200, r3.text
    employee = r3.json()["data"]
    emp_id = employee["id"]
    assert employee["code"]

    r4 = client.get("/api/drh/contracts", headers=auth_headers)
    assert r4.status_code == 200, r4.text
    contracts = r4.json()
    contract = next(c for c in contracts if c["employee_id"] == emp_id)
    assert contract["contract_type"] == "CDD"
    assert contract["end_date"] == "2027-08-01"
    assert contract["salary_net"] == 48000

    r5 = client.get("/api/drh/employees", headers=auth_headers)
    assert r5.status_code == 200, r5.text
    emp_ids = [e["id"] for e in r5.json()]
    assert emp_id in emp_ids
    print("OK full flow", contract)
