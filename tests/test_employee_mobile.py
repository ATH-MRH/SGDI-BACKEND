"""Accès mobile employé : famille de jetons `employee_mobile`, libre-service strict."""
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app.core.security import create_access_token, decode_token, hash_password
from app.modules.drh.models import Document, Employee, Leave
from app.modules.employee_mobile.security import EMPLOYEE_MOBILE_TOKEN_USE, password_version
from app.modules.irongs import service
from app.modules.ops.models import Assignment, DailyPresence, Site

PASSWORD = "motdepasse-employe-1"
SELF_ROUTES = ("/me", "/me/attendance", "/me/absences", "/me/leaves", "/me/planning", "/me/documents", "/me/payslips")
BASE = "/api/employee-mobile"


def _employee(db, tag: str, **overrides) -> Employee:
    code = f"EM{tag}{uuid.uuid4().hex[:6].upper()}"
    row = Employee(code=code, first_name=f"Prénom{tag}", last_name=f"NOM{tag}", society="Iron Global Securite", status="actif",
                   position="Agent", **overrides)
    db.add(row)
    db.flush()
    return row


def _account(db, employee: Employee, **overrides) -> dict:
    item = {"id": f"acc-{employee.code}", "username": employee.code.lower(), "matricule": employee.code, "active": True,
            "passwordHash": hash_password(PASSWORD), "passwordChangedAt": "2026-01-01T00:00:00", **overrides}
    service.create_item(db, "portalAccounts", item)
    return item


@pytest.fixture
def people(db):
    """Deux employés avec compte, chacun ses données : toute fuite de l'un vers l'autre se voit."""
    site = Site(name=f"Site EM {uuid.uuid4().hex[:5]}", active=1, equipment_plan={"societe": "Iron Global Securite"})
    db.add(site)
    db.flush()
    out = {}
    for tag in ("A", "B"):
        emp = _employee(db, tag)
        db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
        today = date.today()
        db.add(DailyPresence(presence_date=today, employee_id=emp.id, site_id=site.id, status="present", arrival_time="07:0" + ("1" if tag == "A" else "9")))
        db.add(DailyPresence(presence_date=today - timedelta(days=1), employee_id=emp.id, site_id=site.id, status="absent"))
        db.add(Leave(employee_id=emp.id, leave_type="conge", start_date=date(2026, 11, 1), end_date=date(2026, 11, 5), reason=f"Motif {tag}", status="instance"))
        db.add(Document(owner_type="employee", owner_id=emp.id, label=f"Contrat {tag}", file_name="c.pdf", file_path=f"/uploads/photos/docs/secret-{tag}.pdf", mime_type="application/pdf"))
        db.flush()
        out[tag] = (emp, _account(db, emp))
    db.commit()
    yield out
    for emp, account in out.values():
        db.query(Document).filter(Document.owner_id == emp.id, Document.owner_type == "employee").delete()
        db.query(Leave).filter(Leave.employee_id == emp.id).delete()
        db.query(DailyPresence).filter(DailyPresence.employee_id == emp.id).delete()
        db.query(Assignment).filter(Assignment.employee_id == emp.id).delete()
        try:
            service.delete_item(db, "portalAccounts", account["id"])
        except Exception:
            db.rollback()
        db.delete(emp)
    db.delete(site)
    db.commit()


def _login(client, employee: Employee, password: str = PASSWORD):
    return client.post(f"{BASE}/login", json={"username": employee.code.lower(), "password": password})


def _headers(client, employee: Employee) -> dict:
    response = _login(client, employee)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_login_issues_a_dedicated_token_family(client, people):
    emp, _ = people["A"]
    body = _login(client, emp).json()
    payload = decode_token(body["access_token"])
    assert payload["token_use"] == EMPLOYEE_MOBILE_TOKEN_USE == "employee_mobile"
    assert payload["sub"] == str(emp.id)
    assert "portal" not in payload and "role" not in payload and "username" not in payload
    assert body["employee"]["matricule"] == emp.code and body["expires_in"] == 480 * 60
    assert "password" not in str(body).lower()


def test_bad_credentials_and_unlinked_accounts_are_refused(client, db, people):
    emp, _ = people["A"]
    assert _login(client, emp, "faux").status_code == 403
    assert client.post(f"{BASE}/login", json={"username": "inconnu", "password": PASSWORD}).status_code == 403
    assert client.post(f"{BASE}/login", json={}).status_code == 400
    # Compte valide mais matricule sans fiche employé : aucun rattachement par nom ou e-mail.
    orphan = {"id": "acc-orphelin", "username": "orphelin-em", "matricule": "MATRICULE-SANS-FICHE", "active": True,
              "passwordHash": hash_password(PASSWORD), "nom": emp.last_name, "prenom": emp.first_name}
    service.create_item(db, "portalAccounts", orphan)
    try:
        assert client.post(f"{BASE}/login", json={"username": "orphelin-em", "password": PASSWORD}).status_code == 403
    finally:
        service.delete_item(db, "portalAccounts", "acc-orphelin")


def test_numeric_matricule_never_resolves_to_another_employee_id(client, db, people):
    """Un matricule « 12 » ne doit pas ouvrir la fiche dont l'identifiant interne est 12."""
    victim, _ = people["A"]
    account = {"id": "acc-numerique", "username": "numerique-em", "matricule": str(victim.id), "active": True, "passwordHash": hash_password(PASSWORD)}
    service.create_item(db, "portalAccounts", account)
    try:
        assert client.post(f"{BASE}/login", json={"username": "numerique-em", "password": PASSWORD}).status_code == 403
    finally:
        service.delete_item(db, "portalAccounts", "acc-numerique")


def test_self_service_returns_only_own_data(client, people):
    emp_a, _ = people["A"]
    emp_b, _ = people["B"]
    a, b = _headers(client, emp_a), _headers(client, emp_b)

    assert client.get(f"{BASE}/me", headers=a).json()["matricule"] == emp_a.code
    assert client.get(f"{BASE}/me", headers=b).json()["matricule"] == emp_b.code
    attendance = client.get(f"{BASE}/me/attendance", headers=a).json()["days"]
    assert [day["status"] for day in attendance] == ["present", "absent"] and attendance[0]["arrival"] == "07:01"
    assert [day["status"] for day in client.get(f"{BASE}/me/absences", headers=a).json()["days"]] == ["absent"]
    assert [leave["reason"] for leave in client.get(f"{BASE}/me/leaves", headers=a).json()["items"]] == ["Motif A"]
    documents = client.get(f"{BASE}/me/documents", headers=a).json()["items"]
    assert [doc["label"] for doc in documents] == ["Contrat A"]
    # Ni chemin de fichier ni nom interne : la liste ne permet pas d'aller chercher le fichier.
    assert "secret-" not in str(documents) and "file_path" not in documents[0]
    planning = client.get(f"{BASE}/me/planning", headers=a)
    assert planning.status_code == 200 and "expected" not in planning.text
    assert client.get(f"{BASE}/me/payslips", headers=a).json() == {"items": []}

    everything_a = "".join(client.get(f"{BASE}{route}", headers=a).text for route in SELF_ROUTES)
    assert emp_b.code not in everything_a and "Motif B" not in everything_a and "Contrat B" not in everything_a


def test_no_route_takes_an_employee_identifier(client, people):
    emp_a, _ = people["A"]
    emp_b, _ = people["B"]
    a = _headers(client, emp_a)
    for path in (f"/employees/{emp_b.id}", f"/me/{emp_b.id}", f"/{emp_b.id}/attendance", f"/me/documents/{emp_b.id}/content"):
        assert client.get(f"{BASE}{path}", headers=a).status_code in (404, 405)
    # Un paramètre glissé dans la requête est ignoré : la fiche vient du jeton.
    assert client.get(f"{BASE}/me?employee_id={emp_b.id}&matricule={emp_b.code}", headers=a).json()["matricule"] == emp_a.code
    assert client.get(f"{BASE}/me/leaves?employee_id={emp_b.id}", headers=a).json()["items"][0]["reason"] == "Motif A"


def test_only_validated_payslips_of_the_employee_are_listed(client, db, people):
    from app.modules.payroll.models import PayrollRun, PayrollSlip

    emp_a, _ = people["A"]
    emp_b, _ = people["B"]
    run = PayrollRun(society="Iron Global Securite", period="2026-09", status="validated", idempotency_key=f"em-{uuid.uuid4().hex}")
    db.add(run)
    db.flush()
    run_id = run.id

    def slip(emp, status, net):
        values = dict(payroll_run_id=run.id, employee_id=emp.id, society="Iron Global Securite", status=status, rules_used={}, inputs={}, idempotency_key=f"em-{uuid.uuid4().hex}")
        money = dict(base=Decimal("50000"), brut=Decimal("60000"), cotisation_salariale=Decimal("5400"), cotisation_patronale=Decimal("15600"),
                     imposable=Decimal("54600"), irg=Decimal("6000"), net=Decimal(net), net_a_payer=Decimal(net))
        columns = {c.name for c in PayrollSlip.__table__.columns}
        row = PayrollSlip(**{k: v for k, v in {**values, **money}.items() if k in columns})
        db.add(row)
        return row

    slip(emp_a, "validated", "48600")
    slip(emp_b, "draft", "11111")
    db.commit()
    try:
        items = client.get(f"{BASE}/me/payslips", headers=_headers(client, emp_a)).json()["items"]
        assert [(item["period"], item["status"]) for item in items] == [("2026-09", "validated")]
        assert Decimal(items[0]["net_a_payer"]) == Decimal("48600")
        # Brouillon : jamais montré, même à son titulaire.
        assert client.get(f"{BASE}/me/payslips", headers=_headers(client, emp_b)).json() == {"items": []}
    finally:
        db.rollback()
        db.query(PayrollSlip).filter(PayrollSlip.payroll_run_id == run_id).delete()
        db.query(PayrollRun).filter(PayrollRun.id == run_id).delete()
        db.commit()


def test_employee_token_is_refused_everywhere_else(client, people):
    emp, _ = people["A"]
    headers = _headers(client, emp)
    for path in ("/api/auth/me", "/api/drh/employees/page", "/api/ops/sites/page", "/api/attendance/board", "/api/brq/situation",
                 f"/api/attendance/employees/{emp.id}", "/api/payroll/runs", "/api/irongs/collections/incidents/items", "/api/irongs/events/ticket"):
        assert client.get(path, headers=headers).status_code == 401, path
    assert client.post("/api/auth/logout", headers=headers).status_code == 401
    assert client.post("/api/mobile/devices", headers=headers, json={}).status_code == 401
    # Portail employé web, rondes et portail client : chacun exige SA famille.
    assert client.get(f"/api/portal/pointages/{emp.code}", headers=headers).status_code in (401, 403)
    assert client.get(f"/api/portal/demandes/{emp.code}", headers=headers).status_code in (401, 403)
    assert client.get(f"/api/ronde/portal/circuits?matricule={emp.code}", headers=headers).status_code in (401, 403)
    assert client.get("/api/client-portal/me", headers=headers).status_code in (401, 403, 404)
    assert client.post("/api/auth/refresh", json={"refresh_token": headers["Authorization"].split()[1][:190]}).status_code == 401


def test_other_token_families_are_refused_on_self_service(client, auth_headers, people):
    emp, account = people["A"]
    forged = {
        "staff web": auth_headers["Authorization"].split()[1],
        "staff mobile": client.post("/api/auth/mobile/login", json={"username": "testadmin", "password": "test-admin-password"}).json()["access_token"],
        "portail employé": create_access_token(emp.code, {"portal": True}),
        "portail employé (sujet numérique)": create_access_token(str(emp.id), {"portal": True}),
        "portail client": create_access_token(str(emp.id), {"client_portal": True, "client_id": 1}),
        "QR de pointage": create_access_token(str(emp.id), {"attendance_qr": True, "employee_id": emp.id, "nonce": "n"}),
        "ticket SSE": create_access_token(str(emp.id), {"sse_ticket": True}),
        "sans famille": create_access_token(str(emp.id)),
        "famille inconnue": create_access_token(str(emp.id), {"token_use": "employee"}),
        "staff déguisé": create_access_token(str(emp.id), {"token_use": "staff", "acc": account["id"], "pv": password_version(account)}),
        "claim en trop": create_access_token(str(emp.id), {"token_use": "employee_mobile", "acc": account["id"], "pv": password_version(account), "portal": True}),
        "sans compte": create_access_token(str(emp.id), {"token_use": "employee_mobile", "pv": password_version(account)}),
        "expiré": create_access_token(str(emp.id), {"token_use": "employee_mobile", "acc": account["id"], "pv": password_version(account)}, ttl_seconds=-5),
    }
    for label, token in forged.items():
        for route in SELF_ROUTES:
            assert client.get(f"{BASE}{route}", headers={"Authorization": f"Bearer {token}"}).status_code == 401, (label, route)
    for route in SELF_ROUTES:
        assert client.get(f"{BASE}{route}").status_code == 401


def test_token_cannot_be_retargeted_to_another_employee(client, people):
    """Jeton correctement signé visant la fiche B avec le compte de A : refusé (le matricule du compte fait foi)."""
    emp_a, account_a = people["A"]
    emp_b, _ = people["B"]
    token = create_access_token(str(emp_b.id), {"token_use": "employee_mobile", "acc": account_a["id"], "pv": password_version(account_a)})
    assert client.get(f"{BASE}/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def _patch_account(db, account_id: str, **changes) -> None:
    from sqlalchemy import select
    from app.modules.irongs.models import SgdiRecord

    row = db.execute(select(SgdiRecord).where(SgdiRecord.collection == "portalAccounts", SgdiRecord.item_id == account_id)).scalar_one()
    row.data = {**row.data, **changes}
    db.commit()


def test_password_change_deactivation_and_suspension_cut_access_immediately(client, db, people):
    emp, account = people["A"]
    headers = _headers(client, emp)
    assert client.get(f"{BASE}/me", headers=headers).status_code == 200

    _patch_account(db, account["id"], passwordHash=hash_password("nouveau-mot-de-passe"), passwordChangedAt=datetime.utcnow().isoformat())
    assert client.get(f"{BASE}/me", headers=headers).status_code == 401
    assert _login(client, emp).status_code == 403
    headers = {"Authorization": f"Bearer {_login(client, emp, 'nouveau-mot-de-passe').json()['access_token']}"}
    assert client.get(f"{BASE}/me", headers=headers).status_code == 200

    emp.status = "suspendu"
    db.commit()
    assert client.get(f"{BASE}/me/attendance", headers=headers).status_code == 403
    assert _login(client, emp, "nouveau-mot-de-passe").status_code == 403
    emp.status = "actif"
    db.commit()

    _patch_account(db, account["id"], mustChangePassword=True)
    assert client.get(f"{BASE}/me", headers=headers).status_code == 401
    assert _login(client, emp, "nouveau-mot-de-passe").status_code == 403
    _patch_account(db, account["id"], mustChangePassword=False, active=False)
    assert client.get(f"{BASE}/me", headers=headers).status_code == 401


def test_self_service_is_read_only(client, people):
    emp, _ = people["A"]
    headers = _headers(client, emp)
    for route in SELF_ROUTES:
        for method in (client.post, client.put, client.patch, client.delete):
            assert method(f"{BASE}{route}", headers=headers).status_code == 405, route


def test_portal_web_login_is_unchanged(client, people):
    emp, _ = people["A"]
    body = client.post("/api/portal/login", json={"username": emp.code.lower(), "password": PASSWORD}).json()
    assert set(body) == {"portal_token", "employee", "must_change_password"}
    payload = decode_token(body["portal_token"])
    assert payload["portal"] is True and payload["sub"] == emp.code and "token_use" not in payload
