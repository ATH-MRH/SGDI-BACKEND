"""Lot 0.4 : les modules coches sont aussi imposes sur les routes API."""

from app.core.security import create_access_token, hash_password
from app.modules.auth.models import AuditEvent, User


def _user(db, username: str, modules: list[str] | None, role: str = "ops") -> User:
    existing = db.query(User).filter(User.username == username).one_or_none()
    if existing:
        db.delete(existing)
        db.commit()
    row = User(
        username=username,
        full_name=username,
        role=role,
        access_level="H3",
        authorized_societies=["Iron Global Securite"],
        authorized_structures=[],
        authorized_sites=[],
        authorized_modules=modules,
        password_hash=hash_password("testpass123"),
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _headers(user: User) -> dict[str, str]:
    token = create_access_token(str(user.id), {"username": user.username})
    return {"Authorization": f"Bearer {token}"}


def test_authorized_module_api_is_allowed(client, db):
    user = _user(db, "lot04_ops_allowed", ["ops"])

    response = client.get("/api/ops/dashboard", headers=_headers(user))

    assert response.status_code == 200, response.text


def test_direct_call_to_unselected_module_is_refused_and_audited(client, db):
    user = _user(db, "lot04_ops_blocked", ["ops"])

    response = client.get("/api/drh/dashboard", headers=_headers(user))

    assert response.status_code == 403
    assert response.json()["detail"] == "Module non autorise pour ce compte"
    event = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.username == user.username,
            AuditEvent.action == "authorization.module",
        )
        .order_by(AuditEvent.id.desc())
        .first()
    )
    assert event is not None
    assert event.resource_id == "/api/drh/dashboard"
    assert event.result == "refused"


def test_empty_module_list_refuses_dedicated_module_api(client, db):
    user = _user(db, "lot04_empty", [])

    response = client.get("/api/materiel/inventory", headers=_headers(user))

    assert response.status_code == 403


def test_shared_backend_accepts_its_module_but_refuses_neighbor_routes(client, db):
    recruiter = _user(db, "REC04", ["recrute"])
    recruiter.authorized_structures = ["recrutement"]
    db.commit()

    assert client.get("/api/drh/candidates", headers=_headers(recruiter)).status_code == 200
    assert client.get("/api/drh/dashboard", headers=_headers(recruiter)).status_code == 403

    pointeur = _user(db, "PTG04", ["pointeur"])
    assert client.get("/api/ops/pointage/daily", headers=_headers(pointeur)).status_code == 200
    assert client.get("/api/ops/dashboard", headers=_headers(pointeur)).status_code == 403


def test_legacy_null_uses_historical_prefix_without_becoming_global(client, db):
    user = _user(db, "OPS04", None)

    assert client.get("/api/ops/dashboard", headers=_headers(user)).status_code == 200
    assert client.get("/api/drh/dashboard", headers=_headers(user)).status_code == 403


def test_module_aliases_and_case_are_normalized(client, db):
    commercial = _user(db, "lot04_commercial_alias", ["  CoMmErCiAl  "])
    finance = _user(db, "lot04_finance_alias", [" FiNaNcE "])

    assert client.get("/api/commercial/clients", headers=_headers(commercial)).status_code == 200
    assert client.get("/api/finance/entries", headers=_headers(finance)).status_code == 200


def test_public_and_technical_endpoints_are_not_subject_to_module_guard(client, db):
    user = _user(db, "lot04_no_modules", [])
    headers = _headers(user)

    assert client.get("/api/version", headers=headers).status_code == 200
    public_response = client.get("/api/public/candidates/status", headers=headers)
    assert public_response.status_code != 403


def test_admin_role_keeps_transversal_module_access(client, db):
    user = _user(db, "lot04_admin", [], role="admin")

    assert client.get("/api/drh/dashboard", headers=_headers(user)).status_code == 200
    assert client.get("/api/ops/dashboard", headers=_headers(user)).status_code == 200


def test_explicit_recruitment_modules_allow_non_rh_profile_and_preserve_restrictions(client, db):
    from fastapi import HTTPException
    from app.modules.drh.routes import _ensure_recruitment_access
    import pytest

    for module in ("drh", "recrute"):
        user = _user(db, "BUSINESS_" + module, [module], role="dispatch")
        headers = _headers(user)
        response = client.get("/api/drh/candidates", headers=headers)
        assert response.status_code == 200, response.text
        assert client.get("/api/auth/me", headers=headers).json()["recruitment_access"] is True
        with pytest.raises(HTTPException) as denied:
            _ensure_recruitment_access(user, destructive=True)
        assert denied.value.status_code == 403
        assert denied.value.detail == "Suppression réservée à la DRH"
        assert client.get("/api/ops/dashboard", headers=headers).status_code == 403
        user.authorized_modules = []
        db.commit()
        assert client.get("/api/drh/candidates", headers=headers).status_code == 403
        assert client.get("/api/auth/me", headers=headers).json()["recruitment_access"] is False


def test_explicit_unrelated_module_does_not_inherit_legacy_recruitment_grant(client, db):
    user = _user(db, "REC_EXPLICIT_OTHER", ["ops"], role="dispatch")
    user.authorized_structures = ["drh"]
    db.commit()
    headers = _headers(user)
    assert client.get("/api/drh/candidates", headers=headers).status_code == 403
    assert client.get("/api/auth/me", headers=headers).json()["recruitment_access"] is False


def test_ops_employee_read_is_scoped_and_excludes_private_hr_data(client, db):
    from app.modules.drh.models import Employee
    user = _user(db, "OPS_READ", ["ops"])
    own = Employee(code="OPS_READ_OWN", first_name="Agent", last_name="Test",
                   society="IRON GLOBAL SÉCURITÉ", salary_net=123456, nin="OPS_PRIVATE_NIN",
                   extra={"bank": "PRIVATE_BANK", "_legacy": {"id": "legacy_ops", "rib": "PRIVATE_RIB"}})
    other = Employee(code="OPS_READ_OTHER", first_name="Other", last_name="Test", society="Sword Corporation")
    db.add_all([own, other]); db.commit()
    headers = _headers(user)
    response = client.get("/api/ops/employees", headers=headers)
    assert response.status_code == 200, response.text
    rows = response.json()
    assert own.id in {row["id"] for row in rows}
    assert other.id not in {row["id"] for row in rows}
    row = next(row for row in rows if row["id"] == own.id)
    assert row["extra"]["_legacy"]["id"] == "legacy_ops"
    assert "salary_net" not in row and "nin" not in row
    assert "PRIVATE" not in response.text
    page = client.get("/api/ops/employees/page?q=OPS_READ_OWN&mode=all", headers=headers)
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 1
    assert page.json()["items"][0] == row
    assert client.get("/api/ops/employees?society=Sword%20Corporation", headers=headers).status_code == 403
    for path in ("/api/drh/employees", "/api/drh/employees/page", "/api/drh/dashboard", "/api/drh/candidates"):
        assert client.get(path, headers=headers).status_code == 403
    assert client.put(f"/api/drh/employees/{own.id}", json={"salary_net": 1}, headers=headers).status_code == 403
    db.refresh(user)
    assert user.authorized_modules == ["ops"]


def test_ops_employee_read_respects_assigned_site_and_module(client, db):
    from datetime import date, timedelta
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Site, Assignment
    user = _user(db, "OPS_READ_SITE", ["ops"])
    site = Site(name="OPS read allowed", equipment_plan={"societe": "Iron Global Securite"})
    db.add(site); db.flush()
    employees = [Employee(code=f"OPS_SITE_{i}", first_name="Agent", last_name=str(i), society="Iron Global Securite") for i in range(3)]
    db.add_all(employees); db.flush()
    db.add_all([Assignment(employee_id=employees[0].id, site_id=site.id, start_date=date.today(), active=1),
                Assignment(employee_id=employees[1].id, site_id=site.id, start_date=date.today()+timedelta(days=1), active=1)])
    user.authorized_sites = [site.id]
    db.commit()
    result = client.get("/api/ops/employees", headers=_headers(user))
    assert result.status_code == 200, result.text
    assert [row["id"] for row in result.json()] == [employees[0].id]
    assert result.json()[0]["extra"]["_legacy"]["affectationCourante"]["siteBackendId"] == site.id
    user.authorized_modules = ["commercial"]
    db.commit()
    assert client.get("/api/ops/employees", headers=_headers(user)).status_code == 403
