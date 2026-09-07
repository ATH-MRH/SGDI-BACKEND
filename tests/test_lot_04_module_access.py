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
