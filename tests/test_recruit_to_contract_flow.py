def test_full_contract_flow(client, auth_headers):
    r = client.post("/api/drh/candidates", headers=auth_headers, json={
        "first_name": "Amine", "last_name": "Boudiaf", "phone": "0550000000",
        "email": "a@b.com", "desired_position": "APS", "society": "Iron Global Securite",
        "expected_salary": 45000, "status": "nouvelle",
    })
    assert r.status_code in (200, 201), r.text
    cid = r.json()["data"]["id"]

    sections = ["identification","militaire","poste","avis","contact","habilitations","experience"]
    complete_data = {
        "nom": "Boudiaf", "prenom": "Amine", "dateNaissance": "1990-05-15",
        "lieuNaissance": "Alger", "sexe": "M", "nomPere": "Ahmed", "nomMere": "Fatima",
        "nin": "9876543210", "situation": "celibataire", "source": "spontanee",
        "posteSouhaite": "APS", "telephone": "0550000000", "avisDecision": "favorable",
        "avisDate": "2026-08-01", "avisRecruteur": "REC01", "avisCommentaire": "Favorable",
        "adresse": "Rue 1", "commune": "Alger Centre", "wilaya": "Alger",
        "contactUrgenceLien": "frere", "contactUrgenceNom": "Ali", "contactUrgenceTel": "0550000002",
        "typeContrat": "CDD", "contractStartDate": "2026-08-01", "dateFinContrat": "2027-08-01",
        "numeroCnas": "123456789", "modePaiement": "Virement bancaire", "banque": "BEA",
        "iban": "DZ001234567890",
    }
    r2 = client.put(f"/api/drh/candidates/{cid}", headers=auth_headers, json={
        "expected_salary": 48000,
        "data": complete_data,
    })
    assert r2.status_code == 200, r2.text
    validation_body = {
        "first_name": "Amine", "last_name": "Boudiaf", "phone": "0550000000",
        "email": "a@b.com", "desired_position": "APS", "society": "Iron Global Securite",
        "expected_salary": 48000, "status": "nouvelle", "data": complete_data,
    }
    for section in sections:
        checked = client.post(
            f"/api/drh/candidates/validate-section?section={section}&candidate_id={cid}",
            headers=auth_headers, json=validation_body,
        )
        assert checked.status_code == 200, checked.text
        validation_body["data"]["sectionValidations"] = checked.json()["data"]["sectionValidations"]

    reserve = client.post(f"/api/drh/candidates/{cid}/validate-final", headers=auth_headers, json={"validation_password": "test-validation-password"})
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


def test_contractualisation_accepts_incomplete_administrative_profile(client, auth_headers):
    created = client.post("/api/drh/candidates", headers=auth_headers, json={
        "first_name": "Profil",
        "last_name": "Incomplet",
        "desired_position": "APS",
        "society": "Iron Global Securite",
        "status": "nouvelle",
        "data": {
            "nom": "Incomplet",
            "prenom": "Profil",
            "avisDecision": "Favorable",
            "posteSouhaite": "APS",
            "typeContrat": "CDD",
            "contractStartDate": "2026-09-03",
        },
    })
    assert created.status_code == 200, created.text
    candidate_id = created.json()["data"]["id"]

    marked = client.post(
        f"/api/drh/candidates/{candidate_id}/marquer-contractualisation",
        headers=auth_headers,
    )
    assert marked.status_code == 200, marked.text

    recruited = client.post(
        f"/api/drh/candidates/{candidate_id}/recruit",
        headers=auth_headers,
    )
    assert recruited.status_code == 200, recruited.text
    employee = recruited.json()["data"]
    assert employee["first_name"].casefold() == "profil"
    assert employee["last_name"].casefold() == "incomplet"


def test_future_contract_start_is_preserved(client, auth_headers):
    data = {
        "nom": "Futur", "prenom": "Contrat", "dateNaissance": "1992-01-02", "lieuNaissance": "Oran",
        "sexe": "M", "nomPere": "Pere", "nomMere": "Mere", "nin": "2468013579",
        "situation": "celibataire", "source": "spontanee", "posteSouhaite": "APS",
        "telephone": "0550123456", "avisDecision": "favorable", "avisDate": "2026-08-11",
        "avisRecruteur": "REC01", "avisCommentaire": "OK", "adresse": "Rue 2",
        "commune": "Oran", "wilaya": "Oran", "contactUrgenceLien": "frere",
        "contactUrgenceNom": "Contact", "contactUrgenceTel": "0550654321",
        "typeContrat": "CDD", "contractStartDate": "2026-09-01", "dateFinContrat": "2027-08-31",
    }
    payload = {"first_name": "Contrat", "last_name": "Futur", "phone": "0550123456",
               "desired_position": "APS", "society": "Iron Global Securite", "expected_salary": 50000,
               "status": "nouvelle", "data": data}
    created = client.post("/api/drh/candidates", headers=auth_headers, json=payload)
    assert created.status_code == 200, created.text
    candidate_id = created.json()["data"]["id"]
    for section in ["identification", "militaire", "poste", "avis", "contact", "habilitations", "experience"]:
        checked = client.post(f"/api/drh/candidates/validate-section?section={section}&candidate_id={candidate_id}", headers=auth_headers, json=payload)
        assert checked.status_code == 200, checked.text
        payload["data"]["sectionValidations"] = checked.json()["data"]["sectionValidations"]
    assert client.post(f"/api/drh/candidates/{candidate_id}/validate-final", headers=auth_headers, json={"validation_password": "test-validation-password"}).status_code == 200
    assert client.post(f"/api/drh/candidates/{candidate_id}/marquer-contractualisation", headers=auth_headers).status_code == 200
    recruited = client.post(f"/api/drh/candidates/{candidate_id}/recruit", headers=auth_headers)
    assert recruited.status_code == 200, recruited.text
    employee = recruited.json()["data"]
    assert employee["recruit_date"] == "2026-09-01"
    assert employee["status"] == "a_venir"
    contracts = client.get(f"/api/drh/contracts?employee_id={employee['id']}", headers=auth_headers).json()
    assert contracts[0]["start_date"] == "2026-09-01"
