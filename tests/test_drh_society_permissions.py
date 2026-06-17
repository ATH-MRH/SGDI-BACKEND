from app.core.security import hash_password
from app.modules.auth.models import User


def _limited_headers(client, db, username="rh_limited", societies=None):
    user = User(
        username=username,
        email=f"{username}@test.com",
        full_name="RH Limited",
        role="rh",
        access_level="H2",
        authorized_societies=societies or ["IRON GLOBAL SÉCURITÉ"],
        authorized_structures=["drh"],
        password_hash=hash_password("secret123"),
        is_active=True,
    )
    db.add(user)
    db.commit()
    resp = client.post("/api/auth/login", json={"username": username, "password": "secret123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_drh_accepts_society_without_accents_for_limited_user(client, db):
    headers = _limited_headers(client, db, "rh_limited_accents")

    resp = client.post(
        "/api/drh/employees",
        json={
            "code": "EMP-ACCENTS",
            "first_name": "Amine",
            "last_name": "Test",
            "society": "iron global securite",
            "status": "actif",
        },
        headers=headers,
    )

    assert resp.status_code == 200, resp.text


def test_drh_rejects_unrelated_society_for_limited_user(client, db):
    headers = _limited_headers(client, db, "rh_limited_denied")

    resp = client.post(
        "/api/drh/employees",
        json={
            "code": "EMP-DENIED",
            "first_name": "Samir",
            "last_name": "Refus",
            "society": "SWORD CORPORATION",
            "status": "actif",
        },
        headers=headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Société non autorisée"
