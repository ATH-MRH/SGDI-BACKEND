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
        "typeContrat": "CDD", "contractStartDate": "2999-09-01", "dateFinContrat": "3000-08-31",
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
    assert employee["recruit_date"] == "2999-09-01"
    assert employee["status"] == "a_venir"
    contracts = client.get(f"/api/drh/contracts?employee_id={employee['id']}", headers=auth_headers).json()
    assert contracts[0]["start_date"] == "2999-09-01"


def test_employee_creation_options_and_direct_creation_permission(client, auth_headers, restricted_headers, db):
    from app.core.security import hash_password
    from app.modules.auth.models import User, UserFeaturePermission, AuditEvent
    from app.modules.drh.models import Employee

    options = client.get("/api/drh/employees/creation-options", headers=auth_headers)
    assert options.status_code == 200
    assert options.json() == {"direct_creation_allowed": True, "recruitment_creation_allowed": True}

    restricted = User(
        username="employee_creator",
        email="employee_creator@test.com",
        full_name="Employee Creator",
        role="ops",
        access_level="H3",
        authorized_societies=["Iron Global Securite"],
        authorized_structures=[],
        authorized_modules=["ops", "dc", "drh"],
        password_hash=hash_password("secret123"),
        is_active=True,
    )
    db.add(restricted)
    db.commit()
    login = client.post("/api/auth/login", json={
        "username": "employee_creator",
        "password": "secret123",
    })
    assert login.status_code == 200, login.text
    employee_creator_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    restricted_options = client.get("/api/drh/employees/creation-options", headers=employee_creator_headers)
    assert restricted_options.status_code == 200, restricted_options.text
    assert restricted_options.json()["direct_creation_allowed"] is False
    denied = client.post("/api/drh/employees", headers=employee_creator_headers, json={
        "code": "DENIED01", "first_name": "Agent", "last_name": "SansDroit",
        "society": "Iron Global Securite",
    })
    assert denied.status_code == 403

    db.add(UserFeaturePermission(
        user_id=restricted.id, module_key="drh",
        feature_key="direct_employee_creation", action_key="create",
    ))
    db.commit()
    allowed = client.post("/api/drh/employees", headers=employee_creator_headers, json={
        "code": "SCOPE01", "first_name": "Agent", "last_name": "Perimetre",
        "society": "Iron Global Securite",
    })
    assert allowed.status_code == 200, allowed.text
    employee = allowed.json()
    assert employee["creation_source"] == "direct"
    assert employee["created_by_user_id"] == restricted.id
    assert db.query(Employee).filter_by(id=employee["id"]).one().society == "IRON GLOBAL SECURITE"
    assert db.query(AuditEvent).filter_by(
        action="employee.created_directly", resource_id=str(employee["id"]), user_id=restricted.id,
    ).count() == 1

    out_of_scope = client.post("/api/drh/employees", headers=employee_creator_headers, json={
        "code": "SCOPE02", "first_name": "Agent", "last_name": "HorsPerimetre",
        "society": "Sword Construction",
    })
    assert out_of_scope.status_code == 403


def test_employee_creation_from_recruitment_is_paginated_linked_and_audited(client, auth_headers, db):
    from app.modules.auth.models import AuditEvent, User
    from app.modules.drh.models import Candidate, Contract, Employee

    user = db.query(User).filter_by(username="testadmin").one()
    candidate = Candidate(
        first_name="UniqueRecruitmentSamira",
        last_name="Trace",
        phone="0550998877",
        email="samira@example.com",
        desired_position="AGENTE DE SÉCURITÉ",
        society="Iron Global Securite",
        expected_salary=52000,
        status="a_contractualiser",
        data={
            "avisDecision": "Favorable",
            "nomPere": "Ahmed",
            "nomMere": "Nadia",
            "dateNaissance": "1991-02-03",
            "lieuNaissance": "Alger",
            "nin": "9900022233",
            "situation": "mariée",
            "nombreEnfants": 2,
            "adresse": "Rue 1",
            "commune": "Alger Centre",
            "wilaya": "Alger",
            "typeContrat": "CDD",
            "contractStartDate": "2026-10-01",
            "dateFinContrat": "2027-09-30",
        },
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)

    page = client.get(
        "/api/drh/employees/recruitment-candidates/page",
        headers=auth_headers,
        params={"page": 1, "page_size": 10, "society": "Iron Global Securite", "q": "UniqueRecruitmentSamira"},
    )
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 1
    assert page.json()["items"][0]["id"] == candidate.id

    created = client.post("/api/drh/employees/from-recruitment", headers=auth_headers, json={
        "candidate_id": candidate.id,
        "society": candidate.society,
        "first_name": "Samira",
        "last_name": "Trace",
        "contract_type": "CDD",
        "recruit_date": "2026-10-01",
        "salary_net": None,
    })
    assert created.status_code == 200, created.text
    employee = created.json()
    assert employee["creation_source"] == "recruitment"
    assert employee["recruitment_candidate_id"] == candidate.id
    assert employee["created_by_user_id"] == user.id
    assert employee["father_name"] == "Ahmed"
    assert employee["children_count"] == 2
    assert employee["salary_net"] == 52000
    assert employee["contract_end_date"] == "2027-09-30"
    assert db.query(Contract).filter_by(employee_id=employee["id"]).count() == 1
    db.refresh(candidate)
    assert candidate.status == "embauche"
    assert candidate.data["convertedEmployeeId"] == employee["id"]
    assert db.query(AuditEvent).filter_by(
        action="employee.created_from_recruitment",
        resource_id=str(employee["id"]),
        user_id=user.id,
    ).count() == 1

    second = client.post("/api/drh/employees/from-recruitment", headers=auth_headers, json={
        "candidate_id": candidate.id, "society": candidate.society,
    })
    assert second.status_code == 409


def test_employee_creation_from_recruitment_rejects_invalid_and_ineligible_candidates(client, auth_headers, db):
    from app.modules.drh.models import Candidate

    missing = client.post("/api/drh/employees/from-recruitment", headers=auth_headers, json={
        "candidate_id": 999999, "society": "Iron Global Securite",
    })
    assert missing.status_code == 404

    candidate = Candidate(
        first_name="Non", last_name="Eligible", society="Iron Global Securite",
        status="nouvelle", data={"avisDecision": "Favorable"},
    )
    db.add(candidate)
    db.commit()
    response = client.post("/api/drh/employees/from-recruitment", headers=auth_headers, json={
        "candidate_id": candidate.id, "society": candidate.society,
    })
    assert response.status_code == 422


def test_employee_recruitment_conversion_rolls_back_when_audit_fails(client, auth_headers, db, monkeypatch):
    import pytest
    from app.modules.drh.models import Candidate, Contract, Employee

    candidate = Candidate(
        first_name="Rollback", last_name="Candidat", society="Iron Global Securite",
        status="a_contractualiser", data={"avisDecision": "Favorable", "typeContrat": "CDD"},
    )
    db.add(candidate)
    db.commit()
    candidate_id = candidate.id
    contract_count = db.query(Contract).count()

    def fail_audit(*_args, **_kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr("app.modules.drh.service.append_audit", fail_audit)
    with pytest.raises(RuntimeError, match="audit unavailable"):
        client.post("/api/drh/employees/from-recruitment", headers=auth_headers, json={
            "candidate_id": candidate_id, "society": candidate.society,
        })

    db.expire_all()
    assert db.query(Employee).filter_by(recruitment_candidate_id=candidate_id).count() == 0
    assert db.query(Contract).count() == contract_count
    assert db.get(Candidate, candidate_id).status == "a_contractualiser"
