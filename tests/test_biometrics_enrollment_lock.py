"""Verrou d'enrôlement (BIOMETRIC_ENROLLMENT_LOCKED) et Mode Test coupé : plus aucun nouvel
enrôlement ni essai, sans interrompre le pointage facial d'un terminal déjà en service."""
import pytest

from app.core import rate_limit
from app.core.config import settings
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics import photo_sync, remote_capture, service
from tests.biometric_fakes import face
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics import TEST_KEY   # même clé : base de test partagée
from tests.test_biometrics_terminals import API, _employee, _enrolled, _events, _site, _terminal, burst
from tests.test_biometrics_test_mode import FakePngEngine


@pytest.fixture(autouse=True)
def production_like(monkeypatch):
    """Réglages de production : pointage facial actif, enrôlement et Mode Test ouverts."""
    monkeypatch.setattr(settings, "biometric_enabled", True)
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)
    monkeypatch.setattr(settings, "biometric_test_mode_enabled", True)
    monkeypatch.setattr(settings, "drh_facial_reference_auto_sync_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 0)
    engine_module.set_engine(FakePngEngine())
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()
    yield
    engine_module.set_engine(None)


def _close(monkeypatch):
    monkeypatch.setattr(settings, "biometric_enrollment_locked", True)
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", False)
    monkeypatch.setattr(settings, "biometric_test_mode_enabled", False)


def test_without_the_lock_nothing_changes():
    assert service.enrollment_enabled() and photo_sync.auto_sync_enabled() and remote_capture.analysis_available()


def test_enrollment_flag_alone_does_not_close_enrollment_while_facial_attendance_is_on(monkeypatch):
    """Raison d'être du verrou : BIOMETRIC_ENABLED autorise l'enrôlement à lui seul."""
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", False)
    assert service.enrollment_enabled()


def test_lock_closes_every_enrollment_path(client, auth_headers, db, monkeypatch):
    site = _site(db)
    emp = _employee(db, site)
    db.commit()
    _close(monkeypatch)

    assert not service.enrollment_enabled()
    assert not photo_sync.auto_sync_enabled() and not remote_capture.analysis_available()
    for step, body in (("preview", {}), ("confirm", {"token": "jeton-fictif-" * 3, "confirm": True})):
        refused = client.post(f"{API}/employees/{emp.id}/enrollment/{step}", headers=auth_headers, json=body)
        assert refused.status_code == 503 and "verrouillé" in refused.json()["detail"]
    status = client.get(f"{API}/status", headers=auth_headers).json()
    assert status["enabled"] is True and status["enrollment_enabled"] is False
    test_mode = client.post(f"{API}/test-mode/recognize", headers=auth_headers, json={"site_id": site.id, "frames": []})
    assert test_mode.status_code == 503 and test_mode.json()["detail"]["code"] == "TEST_MODE_DISABLED"


def test_terminal_already_in_service_keeps_recording_attendance(client, auth_headers, db, monkeypatch):
    site = _site(db)
    emp, who = _enrolled(db, site)
    _, device = _terminal(client, auth_headers, site)
    _close(monkeypatch)

    arrival = device.recognize(client, burst(face(who))).json()

    assert (arrival["state"], arrival["recorded"], arrival["action"]) == ("ATTENDANCE_RECORDED", True, "ENTRÉE")
    assert arrival["employee"]["matricule"] == emp.code
    assert len(_events(db, emp)) == 1
