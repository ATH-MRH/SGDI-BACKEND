"""Clé de chiffrement biométrique : une clé, ou deux pendant une rotation.

Toutes les clés sont fictives, générées ici."""
import json
import struct
from datetime import datetime

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException

from app.core.config import settings
from app.modules.biometrics import crypto

OLD_KEY = Fernet.generate_key().decode()
NEW_KEY = Fernet.generate_key().decode()
OTHER_KEY = Fernet.generate_key().decode()
VECTOR = [0.25, -0.5, 0.125, 1.0]
SECRET = {"username": "cam-user", "password": "cam-secret-fictif"}
PHOTO = b"\xff\xd8photo-fictive\xff\xd9"


def _keys(monkeypatch, active, previous=None):
    monkeypatch.setattr(settings, "biometric_template_key", active)
    monkeypatch.setattr(settings, "biometric_template_key_previous", previous)


def test_single_key_configuration_behaves_as_before(monkeypatch):
    _keys(monkeypatch, OLD_KEY)
    token = crypto.encrypt_vector(VECTOR)
    assert crypto.decrypt_vector(token) == VECTOR
    assert struct.unpack("<4f", Fernet(OLD_KEY.encode()).decrypt(token)) == tuple(VECTOR)
    assert crypto.decrypt_secret(crypto.encrypt_secret(SECRET)) == SECRET
    assert crypto.decrypt_bytes(crypto.encrypt_bytes(PHOTO)) == PHOTO
    assert crypto.unseal(crypto.seal({"a": 1}), 300) == {"a": 1}
    assert not crypto.previous_key_configured()


def test_old_data_stays_readable_and_new_data_uses_the_new_key(monkeypatch):
    _keys(monkeypatch, OLD_KEY)
    old_vector, old_secret, old_photo = crypto.encrypt_vector(VECTOR), crypto.encrypt_secret(SECRET), crypto.encrypt_bytes(PHOTO)

    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    assert crypto.previous_key_configured()
    assert crypto.decrypt_vector(old_vector) == VECTOR
    assert crypto.decrypt_secret(old_secret) == SECRET
    assert crypto.decrypt_bytes(old_photo) == PHOTO
    assert not crypto.readable_with_active_key(old_vector)

    fresh = crypto.encrypt_vector(VECTOR)
    assert crypto.readable_with_active_key(fresh)
    Fernet(NEW_KEY.encode()).decrypt(fresh)                       # chiffré avec la nouvelle clé
    with pytest.raises(Exception):
        Fernet(OLD_KEY.encode()).decrypt(fresh)                   # et non avec l'ancienne


def test_reencrypted_data_is_readable_with_the_new_key_alone(monkeypatch):
    _keys(monkeypatch, OLD_KEY)
    old = crypto.encrypt_vector(VECTOR)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    renewed = crypto.reencrypt(old)
    _keys(monkeypatch, NEW_KEY)
    assert crypto.decrypt_vector(renewed) == VECTOR
    with pytest.raises(HTTPException) as refused:
        crypto.decrypt_vector(old)
    assert refused.value.status_code == 500


def test_enrollment_preview_sealed_before_the_switch_stays_valid_during_the_transition(monkeypatch):
    _keys(monkeypatch, OLD_KEY)
    token = crypto.seal({"employee_id": 7})
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    assert crypto.unseal(token, 300) == {"employee_id": 7}
    _keys(monkeypatch, NEW_KEY)
    with pytest.raises(HTTPException) as expired:
        crypto.unseal(token, 300)
    assert expired.value.status_code == 409


def test_sealed_token_still_expires_with_two_keys(monkeypatch):
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    stale = Fernet(OLD_KEY.encode()).encrypt_at_time(json.dumps({"a": 1}).encode(), int(datetime.now().timestamp()) - 3600)
    with pytest.raises(HTTPException) as expired:
        crypto.unseal(stale.decode(), 300)
    assert expired.value.status_code == 409


@pytest.mark.parametrize("active, previous, variable", [
    ("pas-une-cle", None, "BIOMETRIC_TEMPLATE_KEY"),
    (NEW_KEY, "pas-une-cle-non-plus", "BIOMETRIC_TEMPLATE_KEY_PREVIOUS"),
])
def test_invalid_key_is_a_controlled_error_that_never_echoes_the_key(monkeypatch, active, previous, variable):
    _keys(monkeypatch, active, previous)
    with pytest.raises(HTTPException) as refused:
        crypto.encrypt_vector(VECTOR)
    assert refused.value.status_code == 503
    assert variable in refused.value.detail
    assert "pas-une-cle" not in refused.value.detail and NEW_KEY not in refused.value.detail


def test_previous_key_alone_never_encrypts_or_decrypts(monkeypatch):
    _keys(monkeypatch, OLD_KEY)
    token = crypto.encrypt_vector(VECTOR)
    _keys(monkeypatch, "", OLD_KEY)
    for call in (lambda: crypto.encrypt_vector(VECTOR), lambda: crypto.decrypt_vector(token)):
        with pytest.raises(HTTPException) as refused:
            call()
        assert refused.value.status_code == 503


def test_wrong_key_is_refused_explicitly(monkeypatch):
    _keys(monkeypatch, OLD_KEY)
    token = crypto.encrypt_vector(VECTOR)
    _keys(monkeypatch, NEW_KEY, OTHER_KEY)
    with pytest.raises(HTTPException) as refused:
        crypto.decrypt_vector(token)
    assert refused.value.status_code == 500 and "illisible" in refused.value.detail


def test_same_key_on_both_sides_is_not_a_transition(monkeypatch):
    _keys(monkeypatch, OLD_KEY, OLD_KEY)
    assert not crypto.previous_key_configured()
    assert crypto.decrypt_vector(crypto.encrypt_vector(VECTOR)) == VECTOR


def test_key_id_identifies_a_key_without_revealing_it(monkeypatch):
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    active, previous = crypto.key_id("active"), crypto.key_id("previous")
    assert active != previous and len(active) == 8
    assert active not in NEW_KEY and NEW_KEY[:8] != active
    _keys(monkeypatch, NEW_KEY)
    assert crypto.key_id("active") == active and crypto.key_id("previous") is None
