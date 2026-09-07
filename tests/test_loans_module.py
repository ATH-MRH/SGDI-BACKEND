from datetime import date
from uuid import uuid4

from app.core.security import create_access_token, hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Employee


def _employee(db):
    key = uuid4().hex[:8].upper()
    row = Employee(
        code=f"L{key}", first_name="AMINE", last_name="TEST PRET",
        society="IRON GLOBAL SÉCURITÉ", status="actif", position="AGENT",
        salary_net=100_000, recruit_date=date(2023, 1, 1), contract_end_date=date(2028, 12, 31),
        locked=1, extra={"noteMerite": 8},
    )
    db.add(row); db.commit(); db.refresh(row)
    return row


def _portal_headers(employee):
    token = create_access_token(subject=employee.code, claims={"portal": True})
    return {"Authorization": f"Bearer {token}"}


def _dg_headers(db):
    key = uuid4().hex[:8]
    user = User(
        username=f"DG{key}", email=f"dg-{key}@example.com", full_name="DIRECTEUR GENERAL",
        role="dg", access_level="H5", authorized_societies=[], authorized_structures=["direction_generale"],
        authorized_actions=[], authorized_modules=["pret"], global_society_access=True,
        password_hash=hash_password("Secret123!"), is_active=True,
    )
    db.add(user); db.commit(); db.refresh(user)
    token = create_access_token(subject=str(user.id), claims={"role": user.role, "username": user.username})
    return {"Authorization": f"Bearer {token}"}


def _staff_headers(db, role, structure, prefix):
    key = uuid4().hex[:8]
    user = User(
        username=f"{prefix}{key}", email=f"{role}-{key}@example.com", full_name=role.upper(),
        role=role, access_level="H3", authorized_societies=[], authorized_structures=[structure],
        authorized_actions=[], authorized_modules=[role], global_society_access=True,
        password_hash=hash_password("Secret123!"), is_active=True,
    )
    db.add(user); db.commit(); db.refresh(user)
    token = create_access_token(subject=str(user.id), claims={"role": user.role, "username": user.username})
    return {"Authorization": f"Bearer {token}"}


def test_pret_subdomain_serves_autonomous_responsive_module(client):
    response = client.get("/", headers={"host": "pret.irongs.com"})
    assert response.status_code == 200
    assert "PRÊTS & AVANCES" in response.text
    assert "Espace salarié" in response.text
    assert "Espace gestionnaire" in response.text
    assert "/static/responsive-baseline.css" in response.text
    cash = client.get("/", headers={"host": "caisse.irongs.com"})
    assert cash.status_code == 200
    assert "ORDRES DE PAIEMENT" in cash.text


def test_admin_can_configure_loan_policy_and_it_changes_eligibility(client, db, auth_headers):
    initial = client.get("/api/loans/settings", headers=auth_headers)
    assert initial.status_code == 200, initial.text
    payload = initial.json()
    payload.update({
        "loan_min_seniority_months": 60,
        "debt_ratio_limit": 20,
        "loan_salary_multiple": 2,
        "decision_prefix": "DG-PRT-",
        "contract_prefix": "SG-CONV-",
        "manager_roles": ["drh"],
        "secretariat_roles": ["secretariat"],
        "cash_roles": ["caisse"],
    })
    saved = client.put("/api/loans/settings", headers=auth_headers, json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["debt_ratio_limit"] == 20
    employee = _employee(db)
    simulation = client.post("/api/loans/employee/simulate", headers=_portal_headers(employee), json={"request_type": "loan", "amount": 20_000, "installments": 2})
    assert simulation.status_code == 200
    assert simulation.json()["eligible"] is False
    assert simulation.json()["debt_ratio_limit"] == 20
    assert any("Ancienneté" in reason for reason in simulation.json()["reasons"])
    restored = client.put("/api/loans/settings", headers=auth_headers, json=initial.json())
    assert restored.status_code == 200, restored.text


def test_complete_loan_workflow_requires_dg_and_beneficiary_signatures(client, db, auth_headers):
    employee = _employee(db); employee_headers = _portal_headers(employee); dg_headers = _dg_headers(db)
    secretariat_headers = _staff_headers(db, "secretariat", "secretariat general", "SEC")
    cash_headers = _staff_headers(db, "caisse", "caisse", "CAI")
    simulation = client.post("/api/loans/employee/simulate", headers=employee_headers, json={"request_type": "loan", "amount": 20_000, "installments": 2})
    assert simulation.status_code == 200, simulation.text
    assert simulation.json()["eligible"] is True
    assert simulation.json()["merit_score"] == 80

    created = client.post("/api/loans/employee/requests", headers=employee_headers, json={"request_type": "loan", "amount": 20_000, "installments": 2, "reason": "Dépense familiale importante", "payroll_deduction_consent": True})
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]

    review = client.post(f"/api/loans/management/requests/{request_id}/review", headers=auth_headers, json={"recommendation": "favorable", "note": "Capacité et ancienneté conformes"})
    assert review.status_code == 200, review.text
    forbidden = client.post(f"/api/loans/management/requests/{request_id}/decision", headers=auth_headers, json={"decision": "approve"})
    assert forbidden.status_code == 403

    decision = client.post(f"/api/loans/management/requests/{request_id}/decision", headers=dg_headers, json={"decision": "approve", "amount_approved": 20_000, "installments_approved": 2, "interest_rate": 0, "note": "Accord du Directeur Général"})
    assert decision.status_code == 200, decision.text
    assert decision.json()["status"] == "decision_pending_signature"
    assert decision.json()["decision_reference"].startswith("DEC-")

    document = client.get(f"/api/loans/management/requests/{request_id}/decision-document", headers=auth_headers)
    assert document.status_code == 200
    assert "DÉCISION D’ACCORD" in document.text
    assert "Le Directeur Général" in document.text

    signed_decision = client.post(f"/api/loans/management/requests/{request_id}/sign-decision", headers=dg_headers, json={"confirmation": True})
    assert signed_decision.status_code == 200, signed_decision.text
    assert signed_decision.json()["status"] == "secretariat_pending"

    premature_disbursement = client.post(f"/api/loans/management/requests/{request_id}/disburse", headers=dg_headers)
    assert premature_disbursement.status_code == 403
    secretariat_inbox = client.get("/api/loans/secretariat/inbox", headers=secretariat_headers)
    assert secretariat_inbox.status_code == 200, secretariat_inbox.text
    assert any(item["request_id"] == request_id for item in secretariat_inbox.json())
    contract = client.get(f"/api/loans/secretariat/requests/{request_id}/contract", headers=secretariat_headers)
    assert contract.status_code == 200
    assert "CONVENTION DE PRÊT" in contract.text
    assert "Le Bénéficiaire" in contract.text

    employee_cannot_validate = client.post(f"/api/loans/employee/requests/{request_id}/sign-contract", headers=employee_headers, json={"confirmation": True})
    assert employee_cannot_validate.status_code == 403
    signed_contract = client.post(f"/api/loans/secretariat/requests/{request_id}/confirm-beneficiary-signature", headers=secretariat_headers, json={"confirmation": True})
    assert signed_contract.status_code == 200, signed_contract.text
    assert signed_contract.json()["status"] == "cash_pending"
    cash_inbox = client.get("/api/loans/cash/inbox", headers=cash_headers)
    assert cash_inbox.status_code == 200, cash_inbox.text
    assert any(item["request_id"] == request_id for item in cash_inbox.json())
    disbursed = client.post(f"/api/loans/management/requests/{request_id}/disburse", headers=cash_headers)
    assert disbursed.status_code == 200, disbursed.text
    assert disbursed.json()["status"] == "disbursed"

    repayment = client.post(f"/api/loans/management/requests/{request_id}/repayments", headers=auth_headers, json={"payment_date": date.today().isoformat(), "amount": 10_000, "method": "payroll", "payroll_period": date.today().strftime("%Y-%m")})
    assert repayment.status_code == 201, repayment.text
    assert repayment.json()["balance_due"] == 10_000
