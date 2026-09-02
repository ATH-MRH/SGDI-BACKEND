"""Tests d'authentification."""
import pytest

from app.core.security import decode_token, hash_password, verify_password
from app.modules.auth.models import User


def _add_test_user(db, username, password, role="ops", access_level="H3", structures=None):
    existing = db.query(User).filter(User.username == username).one_or_none()
    if existing:
        db.delete(existing)
        db.commit()
    db.add(User(
        username=username,
        email=None,
        full_name=username,
        role=role,
        access_level=access_level,
        authorized_societies=[],
        authorized_structures=structures or [],
        authorized_sites=[],
        password_hash=hash_password(password),
        is_active=True,
    ))
    db.commit()


def test_login_valid(client):
    resp = client.post("/api/auth/login", json={"username": "testadmin", "password": "test-admin-password"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_wrong_password(client):
    resp = client.post("/api/auth/login", json={"username": "testadmin", "password": "wrong"})
    assert resp.status_code == 401


def test_login_unknown_user(client):
    resp = client.post("/api/auth/login", json={"username": "nobody", "password": "anything"})
    assert resp.status_code == 401


def test_admin_system_login_accepts_named_h5_admin(client, db):
    _add_test_user(db, "ADM01", "ADM01", role="admin", access_level="H5", structures=["admin"])

    resp = client.post("/api/auth/admin-system-login", json={"username": "ADM01", "password": "ADM01"})

    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    payload = decode_token(token)
    assert payload["username"] == "ADM01"
    assert payload["admin_system"] is True


def test_admin_system_login_recovers_named_admin_password(client, db):
    _add_test_user(db, "ADG01", "forgotten", role="admin", access_level="H5", structures=["admin"])

    resp = client.post("/api/auth/admin-system-login", json={"username": "ADG01", "password": "test-admin-password"})

    assert resp.status_code == 200, resp.text
    user = db.query(User).filter(User.username == "ADG01").one()
    assert verify_password("test-admin-password", user.password_hash)


def test_admin_system_login_rejects_structure_prefix(client, db):
    _add_test_user(db, "DRH01", "DRH01", role="admin", access_level="H5", structures=["admin", "drh"])

    resp = client.post("/api/auth/admin-system-login", json={"username": "DRH01", "password": "DRH01"})

    assert resp.status_code == 401


def test_ops_subdomain_accepts_ops_prefix(client, db):
    _add_test_user(db, "OPS01", "OPS01", role="ops", access_level="H3", structures=["ops"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "OPS01", "password": "OPS01"},
        headers={"host": "ops.irongs.com"},
    )

    assert resp.status_code == 200, resp.text


def test_ops_subdomain_rejects_drh_prefix(client, db):
    _add_test_user(db, "DRH02", "DRH02", role="ops", access_level="H3", structures=["drh"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "DRH02", "password": "DRH02"},
        headers={"host": "ops.irongs.com"},
    )

    assert resp.status_code == 403


def test_dc_subdomain_serves_full_atlas_commercial_module(client, db):
    _add_test_user(db, "COM01", "COM01", role="rh", access_level="H3", structures=["commercial"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "COM01", "password": "COM01"},
        headers={"host": "dc.irongs.com"},
    )
    assert resp.status_code == 200, resp.text

    root = client.get("/", headers={"host": "dc.irongs.com"})
    assert root.status_code == 200
    assert 'id="app"' in root.text
    assert "/static/sgdi-app.js?v=" in root.text
    assert "Clients, devis, commandes et livraisons" not in root.text


def test_dc_subdomain_accepts_existing_account_authorized_for_commercial(client, db):
    _add_test_user(db, "ATL42", "ATL42", role="rh", access_level="H3", structures=["commercial"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "ATL42", "password": "ATL42"},
        headers={"host": "dc.irongs.com"},
    )
    assert resp.status_code == 200, resp.text


def test_dc_subdomain_rejects_non_commercial_prefix(client, db):
    _add_test_user(db, "OPS97", "OPS97", role="ops", access_level="H3", structures=["ops"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "OPS97", "password": "OPS97"},
        headers={"host": "dc.irongs.com"},
    )
    assert resp.status_code == 403


def test_old_commercial_subdomain_redirects_to_dc(client):
    root = client.get("/", headers={"host": "commercial.irongs.com"}, follow_redirects=False)
    assert root.status_code == 301
    assert root.headers["location"] == "https://dc.irongs.com/"


def test_old_facturation_subdomain_is_retired(client, db):
    _add_test_user(db, "FAC98", "FAC98", role="ops", access_level="H3", structures=["facturation"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "FAC98", "password": "FAC98"},
        headers={"host": "facturation.irongs.com"},
    )

    assert resp.status_code == 404
    assert resp.text == "Not Found"

    root = client.get("/", headers={"host": "facturation.irongs.com"})
    assert root.status_code == 404
    assert root.text == "Not Found"


def test_fac_subdomain_remains_active(client, db):
    _add_test_user(db, "FAC99", "FAC99", role="ops", access_level="H3", structures=["facturation"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "FAC99", "password": "FAC99"},
        headers={"host": "fac.irongs.com"},
    )

    assert resp.status_code == 200, resp.text

    root = client.get("/", headers={"host": "fac.irongs.com"})
    assert root.status_code == 200
    assert "FACTURATION — IRON GROUP" in root.text
    assert "facturation-manifest.webmanifest" in root.text


def test_recrute_subdomain_accepts_rec_prefix(client, db):
    _add_test_user(db, "REC01", "REC01", role="rh", access_level="H3", structures=["drh"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "REC01", "password": "REC01"},
        headers={"host": "recrute.irongs.com"},
    )

    assert resp.status_code == 200, resp.text


def test_recrute_subdomain_rejects_other_prefix(client, db):
    _add_test_user(db, "OPS03", "OPS03", role="ops", access_level="H3", structures=["ops"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "OPS03", "password": "OPS03"},
        headers={"host": "recrute.irongs.com"},
    )

    assert resp.status_code == 403


def test_paie_subdomain_serves_autonomous_module_and_accepts_paie_user(client, db):
    _add_test_user(db, "PAIE01", "PAIE01", role="paie", access_level="H3", structures=["paie"])

    resp = client.post(
        "/api/auth/login",
        json={"username": "PAIE01", "password": "PAIE01"},
        headers={"host": "paie.irongs.com"},
    )

    assert resp.status_code == 200, resp.text
    root = client.get("/", headers={"host": "paie.irongs.com"})
    assert root.status_code == 200
    assert "PAIE — IRON GROUP" in root.text
    assert "paie-manifest.webmanifest" in root.text


def test_protected_endpoint_without_token(client):
    resp = client.get("/api/accounting/comptes")
    assert resp.status_code == 401


def test_protected_endpoint_with_token(client, auth_headers):
    resp = client.get("/api/accounting/comptes", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_invalid_token_rejected(client):
    resp = client.get("/api/accounting/comptes", headers={"Authorization": "Bearer fake.token.here"})
    assert resp.status_code == 401


def test_health_endpoint_public(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["ok"] == "true"


def test_health_db_requires_auth(client):
    resp = client.get("/health/db")
    assert resp.status_code == 401


def test_health_db_with_auth(client, auth_headers):
    import os
    if "sqlite" in os.getenv("DATABASE_URL", ""):
        pytest.skip("health/db utilise des fonctions PostgreSQL uniquement")
    resp = client.get("/health/db", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── supervisor_read_only : lecture seule superviseur terrain, configurable par admin ────

def test_new_user_defaults_to_supervisor_read_only(client, auth_headers):
    """Comportement historique préservé : par défaut, lecture seule (True)."""
    r = client.post("/api/auth/users", headers=auth_headers, json={
        "username": "sup_default", "role": "ops", "access_level": "H3",
        "authorized_structures": ["superviseur"], "password": "testpass123",
        "email": "sup_default@test.com", "validation_password": "validation123",
    })
    assert r.status_code in (200, 201), r.text
    assert r.json()["supervisor_read_only"] is True


def test_admin_user_requires_unique_email_and_sends_both_passwords(client, auth_headers, monkeypatch):
    sent = {}

    def fake_send(recipient, username, password, validation_password):
        sent.update(recipient=recipient, username=username, password=password, validation_password=validation_password)

    monkeypatch.setattr("app.modules.auth.routes.send_user_credentials_email", fake_send)
    missing_email = client.post("/api/auth/users", headers=auth_headers, json={
        "username": "mail_missing", "password": "connection123", "validation_password": "validation123",
    })
    assert missing_email.status_code == 422

    created = client.post("/api/auth/users", headers=auth_headers, json={
        "username": "mail_user", "email": "mail_user@test.com", "password": "connection123",
        "validation_password": "validation123", "role": "drh", "authorized_structures": ["drh"],
    })
    assert created.status_code in (200, 201), created.text
    assert created.json()["credentials_email_sent"] is True
    assert created.json()["has_validation_password"] is True
    assert sent == {
        "recipient": "mail_user@test.com", "username": "MAIL_USER",
        "password": "connection123", "validation_password": "validation123",
    }

    duplicate = client.post("/api/auth/users", headers=auth_headers, json={
        "username": "mail_user_2", "email": "mail_user@test.com", "password": "connection123",
        "validation_password": "validation123",
    })
    assert duplicate.status_code == 409


def test_create_user_can_disable_supervisor_read_only(client, auth_headers):
    r = client.post("/api/auth/users", headers=auth_headers, json={
        "username": "sup_editor", "role": "ops", "access_level": "H3",
        "authorized_structures": ["superviseur"], "password": "testpass123",
        "email": "sup_editor@test.com", "validation_password": "validation123",
        "supervisor_read_only": False,
    })
    assert r.status_code in (200, 201), r.text
    assert r.json()["supervisor_read_only"] is False


def test_update_user_toggles_supervisor_read_only(client, auth_headers):
    r = client.post("/api/auth/users", headers=auth_headers, json={
        "username": "sup_toggle", "role": "ops", "access_level": "H3",
        "authorized_structures": ["superviseur"], "password": "testpass123",
        "email": "sup_toggle@test.com", "validation_password": "validation123",
    })
    assert r.status_code in (200, 201), r.text
    assert r.json()["supervisor_read_only"] is True

    r2 = client.patch("/api/auth/users/sup_toggle", headers=auth_headers, json={"supervisor_read_only": False})
    assert r2.status_code == 200, r2.text
    assert r2.json()["supervisor_read_only"] is False

    r3 = client.patch("/api/auth/users/sup_toggle", headers=auth_headers, json={"supervisor_read_only": True})
    assert r3.status_code == 200, r3.text
    assert r3.json()["supervisor_read_only"] is True


def test_login_response_includes_supervisor_read_only(client, auth_headers):
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "sup_login", "role": "ops", "access_level": "H3",
        "authorized_structures": ["superviseur"], "password": "testpass123",
        "email": "sup_login@test.com", "validation_password": "validation123",
        "supervisor_read_only": False,
    })
    r = client.post("/api/auth/login", json={"username": "sup_login", "password": "testpass123"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["supervisor_read_only"] is False


def test_individual_action_permissions_are_returned_and_enforced(client, db):
    db.add(User(
        username="READONLY01",
        email=None,
        full_name="Lecture seule",
        role="ops",
        access_level="H3",
        authorized_societies=[],
        authorized_structures=["ops"],
        authorized_sites=[],
        authorized_actions=["read"],
        password_hash=hash_password("testpass123"),
        is_active=True,
    ))
    db.commit()

    login = client.post("/api/auth/login", json={"username": "READONLY01", "password": "testpass123"})
    assert login.status_code == 200
    assert login.json()["user"]["authorized_actions"] == ["read"]
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.get("/api/ops/sites", headers=headers).status_code == 200
    denied = client.post("/api/ops/sites", headers=headers, json={})
    assert denied.status_code == 403
    assert "create" in denied.json()["detail"]
