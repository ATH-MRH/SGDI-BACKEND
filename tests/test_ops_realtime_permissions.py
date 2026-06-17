from app.core.security import hash_password
from app.modules.auth.models import User


def test_event_stream_without_ticket_returns_401_not_422(client):
    resp = client.get("/api/irongs/events/stream")

    assert resp.status_code == 401
    assert "ticket" in resp.json()["detail"].lower()


def test_limited_user_can_update_legacy_site_with_allowed_society(client, db, auth_headers):
    created = client.post(
        "/api/ops/sites",
        json={"name": "Site legacy sans societe", "indicatif": "LEG"},
        headers=auth_headers,
    )
    assert created.status_code == 200, created.text
    site_id = created.json()["id"]

    user = User(
        username="limited-sites",
        email=None,
        full_name="Limited Sites",
        role="ops",
        access_level="H2",
        authorized_societies=["TEST_SOC"],
        authorized_structures=[],
        password_hash=hash_password("limitedpass"),
        is_active=True,
    )
    db.add(user)
    db.commit()

    login = client.post("/api/auth/login", json={"username": "limited-sites", "password": "limitedpass"})
    assert login.status_code == 200, login.text
    limited_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    updated = client.put(
        f"/api/ops/sites/{site_id}",
        json={
            "name": "Site legacy repare",
            "equipment_plan": {"societe": "TEST_SOC", "nom": "Site legacy repare"},
        },
        headers=limited_headers,
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["equipment_plan"]["societe"] == "TEST_SOC"
