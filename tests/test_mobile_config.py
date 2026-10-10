"""GET /api/mobile/config : configuration publique lue par ATLAS MOBILE."""
import pytest

from app.core.config import get_settings

EMPTY = {
    "min_supported_version": {"ios": None, "android": None},
    "recommended_version": {"ios": None, "android": None},
    "maintenance": {"enabled": False, "message": None},
    "store_urls": {"ios": None, "android": None},
}
FIELDS = (
    "mobile_min_version_ios", "mobile_min_version_android", "mobile_recommended_version_ios",
    "mobile_recommended_version_android", "mobile_maintenance_enabled", "mobile_maintenance_message",
    "mobile_store_url_ios", "mobile_store_url_android",
)


@pytest.fixture
def mobile_settings(monkeypatch):
    settings = get_settings()

    def _set(**values):
        for name, value in values.items():
            assert name in FIELDS
            monkeypatch.setattr(settings, name, value)
    return _set


def test_default_config_imposes_nothing(client):
    response = client.get("/api/mobile/config")
    assert response.status_code == 200
    assert response.json() == EMPTY


def test_config_is_public_and_ignores_any_token(client, auth_headers):
    assert client.get("/api/mobile/config").status_code == 200
    assert client.get("/api/mobile/config", headers=auth_headers).json() == EMPTY
    assert client.get("/api/mobile/config", headers={"Authorization": "Bearer invalide"}).status_code == 200


def test_config_exposes_versions_maintenance_and_store_links(client, mobile_settings):
    mobile_settings(
        mobile_min_version_ios="1.2.0", mobile_min_version_android=" 1.1 ",
        mobile_recommended_version_ios="1.3.0", mobile_recommended_version_android="1.3.0",
        mobile_maintenance_enabled=True, mobile_maintenance_message="  Maintenance jusqu'à 14 h.  ",
        mobile_store_url_ios="https://apps.apple.com/app/id123456789",
        mobile_store_url_android="https://play.google.com/store/apps/details?id=com.irongs.atlas",
    )
    assert client.get("/api/mobile/config").json() == {
        "min_supported_version": {"ios": "1.2.0", "android": "1.1"},
        "recommended_version": {"ios": "1.3.0", "android": "1.3.0"},
        "maintenance": {"enabled": True, "message": "Maintenance jusqu'à 14 h."},
        "store_urls": {
            "ios": "https://apps.apple.com/app/id123456789",
            "android": "https://play.google.com/store/apps/details?id=com.irongs.atlas",
        },
    }


@pytest.mark.parametrize("value", ["v1.2", "1.2.3.4", "latest", "1.2-beta", "", "   ", "1..2", "12345.0"])
def test_malformed_version_is_never_enforced(client, mobile_settings, value):
    mobile_settings(mobile_min_version_ios=value, mobile_min_version_android=value)
    assert client.get("/api/mobile/config").json()["min_supported_version"] == {"ios": None, "android": None}


@pytest.mark.parametrize("value", [
    "http://apps.apple.com/app/id1", "https://evil.example/app", "javascript:alert(1)",
    "https://apps.apple.com.evil.example/app", "https://play.google.com/", "",
])
def test_only_official_store_links_are_exposed(client, mobile_settings, value):
    mobile_settings(mobile_store_url_ios=value, mobile_store_url_android=value)
    assert client.get("/api/mobile/config").json()["store_urls"] == {"ios": None, "android": None}


def test_maintenance_message_is_hidden_when_disabled_and_bounded(client, mobile_settings):
    mobile_settings(mobile_maintenance_enabled=False, mobile_maintenance_message="Texte résiduel")
    assert client.get("/api/mobile/config").json()["maintenance"] == {"enabled": False, "message": None}
    mobile_settings(mobile_maintenance_enabled=True, mobile_maintenance_message="x" * 1000)
    assert len(client.get("/api/mobile/config").json()["maintenance"]["message"]) == 300


def test_config_does_not_leak_server_settings(client):
    body = client.get("/api/mobile/config").text.lower()
    for forbidden in ("secret", "password", "database", "jwt", "token", "smtp"):
        assert forbidden not in body
