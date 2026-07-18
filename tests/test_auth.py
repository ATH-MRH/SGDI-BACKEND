"""Tests d'authentification."""
import pytest

from app.core.security import decode_token, hash_password
from app.modules.auth.models import User


def test_login_valid(client):
    resp = client.post("/api/auth/login", json={"username": "testadmin", "password": "testpass123"})
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
    db.add(User(
        username="DRH01",
        email=None,
        full_name="Admin DRH",
        role="admin",
        access_level="H5",
        authorized_societies=[],
        authorized_structures=["admin", "drh"],
        authorized_sites=[],
        password_hash=hash_password("DRH01"),
        is_active=True,
    ))
    db.commit()

    resp = client.post("/api/auth/admin-system-login", json={"username": "DRH01", "password": "DRH01"})

    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    payload = decode_token(token)
    assert payload["username"] == "DRH01"
    assert payload["admin_system"] is True


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
