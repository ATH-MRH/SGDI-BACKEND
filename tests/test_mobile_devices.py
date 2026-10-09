"""Registre des appareils ATLAS MOBILE : POST /api/mobile/devices, /devices/revoke."""
from datetime import datetime, timedelta

import pytest

from app.core.security import create_access_token, decode_token, hash_password
from app.modules.auth.models import AuditEvent, AuthSession, User
from app.modules.auth.sessions import SESSION_CLAIM
from app.modules.mobile.devices import active_devices
from app.modules.mobile.models import MobileDevice

EXPO = "ExponentPushToken[abcdefghijklmnopqrstuv]"
DEVICE = {"push_token": EXPO, "provider": "expo", "platform": "ios", "environment": "production", "app_version": "1.0.0"}


def _login(client, username="testadmin", password="test-admin-password"):
    response = client.post("/api/auth/mobile/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture(autouse=True)
def clean_devices(db):
    yield
    db.query(MobileDevice).delete()
    db.commit()


@pytest.fixture
def reader(db):
    user = User(
        username="mobile_device_reader", email="mobile.device@test.com", full_name="Lecteur", role="ops", access_level="H3",
        authorized_societies=["Iron Global Securite"], authorized_structures=[], authorized_modules=["ops"],
        authorized_actions=["read"], password_hash=hash_password("testpass123"), is_active=True,
    )
    db.add(user)
    db.commit()
    yield user
    db.query(MobileDevice).filter(MobileDevice.user_id == user.id).delete()
    db.query(AuthSession).filter(AuthSession.user_id == user.id).delete()
    db.delete(user)
    db.commit()


def test_registration_requires_a_staff_session(client):
    assert client.post("/api/mobile/devices", json=DEVICE).status_code == 401
    portal = create_access_token("EMP001", {"portal": True})
    assert client.post("/api/mobile/devices", json=DEVICE, headers={"Authorization": f"Bearer {portal}"}).status_code == 401


def test_register_links_the_device_to_user_and_session(client, db):
    headers = _login(client)
    response = client.post("/api/mobile/devices", json=DEVICE, headers=headers)
    assert response.status_code == 200, response.text
    assert EXPO not in response.text
    device = db.query(MobileDevice).one()
    sid = decode_token(headers["Authorization"].split()[1])[SESSION_CLAIM]
    assert device.session_id == db.query(AuthSession).filter(AuthSession.public_id == sid).one().id
    assert (device.provider, device.platform, device.environment, device.app_version) == ("expo", "ios", "production", "1.0.0")
    assert [d.id for d in active_devices(db, device.user_id, environment="production")] == [device.id]
    assert active_devices(db, device.user_id, environment="staging") == []
    event = db.query(AuditEvent).filter(AuditEvent.action == "mobile.device_register").order_by(AuditEvent.id.desc()).first()
    assert EXPO not in f"{event.new_state}{event.resource_id}"


def test_register_is_idempotent_and_refreshes_the_device(client, db):
    headers = _login(client)
    first = client.post("/api/mobile/devices", json=DEVICE, headers=headers).json()
    second = client.post("/api/mobile/devices", json={**DEVICE, "app_version": "1.1.0"}, headers=headers).json()
    assert first["id"] == second["id"]
    assert db.query(MobileDevice).count() == 1
    assert db.query(MobileDevice).one().app_version == "1.1.0"


def test_a_read_only_account_can_register_its_device(client, reader):
    headers = _login(client, reader.username, "testpass123")
    assert client.post("/api/mobile/devices", json=DEVICE, headers=headers).status_code == 200


def test_device_follows_the_last_signed_in_account(client, db, reader):
    admin = _login(client)
    client.post("/api/mobile/devices", json=DEVICE, headers=admin)
    admin_id = db.query(MobileDevice).one().user_id
    client.post("/api/mobile/devices", json=DEVICE, headers=_login(client, reader.username, "testpass123"))
    db.expire_all()
    assert db.query(MobileDevice).one().user_id == reader.id
    assert active_devices(db, admin_id, environment="production") == []


@pytest.mark.parametrize("payload", [
    {**DEVICE, "push_token": "pas-un-jeton"},
    {**DEVICE, "provider": "apns"},
    {**DEVICE, "provider": "autre"},
    {**DEVICE, "platform": "windows"},
    {**DEVICE, "environment": "prod"},
    {**DEVICE, "app_version": "<script>"},
    {**DEVICE, "push_token": "x" * 300},
    {"provider": "expo"},
])
def test_invalid_registrations_are_rejected(client, payload):
    assert client.post("/api/mobile/devices", json=payload, headers=_login(client)).status_code == 422


def test_native_tokens_are_accepted(client):
    headers = _login(client)
    assert client.post("/api/mobile/devices", json={**DEVICE, "provider": "apns", "push_token": "a1" * 32}, headers=headers).status_code == 200
    fcm = {**DEVICE, "provider": "fcm", "platform": "android", "push_token": "f" * 140 + ":APA91b-_"}
    assert client.post("/api/mobile/devices", json=fcm, headers=headers).status_code == 200


def test_revoke_only_touches_own_device(client, db, reader):
    admin = _login(client)
    client.post("/api/mobile/devices", json=DEVICE, headers=admin)
    other = _login(client, reader.username, "testpass123")
    assert client.post("/api/mobile/devices/revoke", json={"push_token": EXPO}, headers=other).json() == {"ok": True, "revoked": False}
    assert client.post("/api/mobile/devices/revoke", json={"push_token": EXPO}, headers=admin).json() == {"ok": True, "revoked": True}
    db.expire_all()
    device = db.query(MobileDevice).one()
    assert device.revoked_at is not None
    assert active_devices(db, device.user_id, environment="production") == []


def test_logout_or_expired_session_silences_the_device(client, db):
    headers = _login(client)
    client.post("/api/mobile/devices", json=DEVICE, headers=headers)
    user_id = db.query(MobileDevice).one().user_id
    assert len(active_devices(db, user_id, environment="production")) == 1
    client.post("/api/auth/logout", headers=headers)
    db.expire_all()
    assert active_devices(db, user_id, environment="production") == []
    assert client.post("/api/mobile/devices", json=DEVICE, headers=headers).status_code == 401

    headers = _login(client)
    client.post("/api/mobile/devices", json=DEVICE, headers=headers)
    session = db.query(AuthSession).order_by(AuthSession.id.desc()).first()
    session.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.commit()
    assert active_devices(db, user_id, environment="production") == []


def test_web_token_registers_a_device_that_is_never_notified(client, db, auth_headers):
    # Sans session serveur, rien ne permettrait de faire taire l'appareil à la déconnexion.
    assert client.post("/api/mobile/devices", json=DEVICE, headers=auth_headers).status_code == 200
    device = db.query(MobileDevice).one()
    assert device.session_id is None
    assert active_devices(db, device.user_id, environment="production") == []
