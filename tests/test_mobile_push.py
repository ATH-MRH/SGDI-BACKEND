"""Service d'envoi push : abstraction de fournisseur, Expo simulé, aucun envoi réel."""
import json

import pytest

from app.core.config import get_settings
from app.modules.auth.models import AuthSession
from app.modules.mobile import push
from app.modules.mobile.models import MobileDevice

TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"
TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"


class FakeHttp:
    def __init__(self, tickets=None, status=200, error=None):
        self.calls, self.tickets, self.status, self.error = [], tickets, status, error

    def __call__(self, url, headers, body):
        self.calls.append((url, headers, json.loads(body)))
        if self.error:
            raise self.error
        tickets = self.tickets if self.tickets is not None else [{"status": "ok", "id": "t"} for _ in json.loads(body)]
        return self.status, json.dumps({"data": tickets}).encode()


@pytest.fixture
def registered(client, db):
    """Un compte avec deux appareils actifs en production."""
    headers = {"Authorization": "Bearer " + client.post("/api/auth/mobile/login", json={"username": "testadmin", "password": "test-admin-password"}).json()["access_token"]}
    for token in (TOKEN_A, TOKEN_B):
        assert client.post("/api/mobile/devices", headers=headers, json={"push_token": token, "provider": "expo", "platform": "ios", "environment": "production"}).status_code == 200
    user_id = db.query(MobileDevice).first().user_id
    yield user_id, headers
    db.query(MobileDevice).delete()
    db.commit()


def test_nothing_is_sent_by_default(db, registered):
    user_id, _ = registered
    assert get_settings().push_provider == "disabled"
    assert isinstance(push.get_provider(), push.DisabledProvider)
    # Le fournisseur désactivé ne correspond à aucun appareil : aucun appel, aucun décompte.
    assert push.notify_user(db, user_id, "critical", "/alerts/4") == {}


def test_expo_provider_sends_generic_text_and_internal_route_only(db, registered):
    user_id, _ = registered
    http = FakeHttp()
    counts = push.notify_user(db, user_id, "critical", "/alerts/4", provider=push.ExpoPushProvider(http_post=http))
    assert counts == {"sent": 2}
    (url, headers, payload), = http.calls
    assert url == "https://exp.host/--/api/v2/push/send" and "Authorization" not in headers
    assert sorted(message["to"] for message in payload) == [TOKEN_A, TOKEN_B]
    for message in payload:
        assert (message["title"], message["body"]) == push.CATEGORIES["critical"]
        assert message["data"] == {"category": "critical", "route": "/alerts/4"}
        assert message["priority"] == "high"


def test_access_token_comes_from_configuration_and_is_never_logged(db, registered, caplog):
    user_id, _ = registered
    http = FakeHttp(error=TimeoutError("réseau"))
    with caplog.at_level("WARNING"):
        counts = push.notify_user(db, user_id, "system", provider=push.ExpoPushProvider("jeton-expo-secret", http_post=http))
    assert counts == {"error": 2}
    assert http.calls[0][1]["Authorization"] == "Bearer jeton-expo-secret"
    assert "jeton-expo-secret" not in caplog.text and TOKEN_A not in caplog.text


def test_unregistered_device_is_revoked_other_errors_are_not(db, registered):
    user_id, _ = registered
    tickets = [{"status": "error", "details": {"error": "DeviceNotRegistered"}}, {"status": "error", "details": {"error": "MessageRateExceeded"}}]
    counts = push.notify_user(db, user_id, "incident", "/incidents", provider=push.ExpoPushProvider(http_post=FakeHttp(tickets)))
    assert counts == {"invalid_token": 1, "error": 1}
    db.expire_all()
    assert db.query(MobileDevice).filter(MobileDevice.revoked_at.isnot(None)).count() == 1
    # L'appareil révoqué n'est plus sollicité.
    http = FakeHttp()
    assert push.notify_user(db, user_id, "incident", provider=push.ExpoPushProvider(http_post=http)) == {"sent": 1}
    assert len(http.calls[0][2]) == 1


@pytest.mark.parametrize("status,tickets", [(500, None), (200, []), (200, "texte")])
def test_malformed_provider_answers_are_errors_not_crashes(db, registered, status, tickets):
    user_id, _ = registered
    http = FakeHttp(tickets=tickets if tickets is not None else [], status=status)
    assert push.notify_user(db, user_id, "hr", provider=push.ExpoPushProvider(http_post=http)) == {"error": 2}
    assert db.query(MobileDevice).filter(MobileDevice.revoked_at.isnot(None)).count() == 0


def test_only_known_categories_and_internal_routes(db, registered):
    user_id, _ = registered
    provider = push.ExpoPushProvider(http_post=FakeHttp())
    with pytest.raises(ValueError):
        push.notify_user(db, user_id, "marketing", provider=provider)
    for route in ("https://exemple.test", "/login", "/alerts/abc", "/alerts/4?x=1", "atlas://alerts/4", ""):
        with pytest.raises(ValueError):
            push.notify_user(db, user_id, "system", route, provider=provider)
    assert all(push.valid_route(route) for route in ("/alerts/4", "/ops/sites/12", "/drh/leaves", "/(tabs)/tasks", "/incidents"))


def test_logged_out_or_other_environment_devices_receive_nothing(client, db, registered, monkeypatch):
    user_id, headers = registered
    http = FakeHttp()
    monkeypatch.setattr(get_settings(), "push_environment", "staging")
    assert push.notify_user(db, user_id, "system", provider=push.ExpoPushProvider(http_post=http)) == {}
    monkeypatch.setattr(get_settings(), "push_environment", "production")
    client.post("/api/auth/logout", headers=headers)
    db.expire_all()
    assert push.notify_user(db, user_id, "system", provider=push.ExpoPushProvider(http_post=http)) == {}
    assert http.calls == []


def test_batches_are_capped_at_one_hundred():
    http = FakeHttp()
    messages = [push.OutboundPush(f"ExponentPushToken[{i:022d}]", "t", "b", "system", None) for i in range(230)]
    results = push.ExpoPushProvider(http_post=http).send(messages)
    assert [len(call[2]) for call in http.calls] == [100, 100, 30]
    assert len(results) == 230 and all(result.status == "sent" for result in results)


def test_provider_selection_follows_configuration(monkeypatch):
    monkeypatch.setattr(get_settings(), "push_provider", "expo")
    assert isinstance(push.get_provider(), push.ExpoPushProvider)
