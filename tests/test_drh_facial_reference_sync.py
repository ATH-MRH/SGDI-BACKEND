"""LOT B — DRH → Fiche de position → Photo employé : synchronisation automatique et sécurisée de
la référence faciale. Réglage DRH_FACIAL_REFERENCE_AUTO_SYNC_ENABLED (faux par défaut), sources
déclenchantes DRH_CAMERA / DRH_UPLOAD, remplacement atomique, revue requise, blocage refus /
retrait, idempotence par empreinte, aucune photo historique traitée. Le pointage facial
(BIOMETRIC_ENABLED) reste désactivé pendant tous ces tests."""
import base64
import re
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core import rate_limit
from app.core.config import settings
from app.core.security import hash_password
from app.modules.attendance.models import AttendanceAnomaly, AttendanceEvent
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics import photo_sync, service
from app.modules.biometrics.engine import cosine
from app.modules.biometrics.models import BiometricConsent, BiometricPhotoSync, BiometricTemplate
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.biometric_fakes import _vector, face, frame
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics import TEST_KEY
from tests.test_biometrics_test_mode import FakePngEngine, png

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"


@pytest.fixture(autouse=True)
def lot_b(monkeypatch):
    monkeypatch.setattr(settings, "biometric_enabled", False)                       # pointage facial FERMÉ
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "drh_facial_reference_auto_sync_enabled", True)
    monkeypatch.setattr(settings, "facial_reference_consent_mode", "no_objection")
    engine_module.set_engine(FakePngEngine())
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()
    yield
    engine_module.set_engine(None)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _employee(db, *, society=SOC, status="actif"):
    emp = Employee(code=f"LB{_tag()}", first_name="Sync", last_name=f"Ref{_tag()}", society=society, status=status)
    db.add(emp); db.flush()
    site = Site(name=f"LB {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


@pytest.fixture
def drh(client, db):
    name = f"LBD{uuid.uuid4().int % 10**6:06d}"
    user = User(username=name, full_name=name, role="agent", access_level="H2", password_hash=hash_password("lot-b-pass-1"), is_active=True,
                authorized_modules=["drh"], authorized_societies=[SOC])
    db.add(user)
    db.flush()
    db.add(UserFeaturePermission(
        user_id=user.id,
        module_key="drh",
        feature_key="direct_employee_creation",
        action_key="create",
    ))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "lot-b-pass-1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _image(*faces, noise=None):
    return png(frame(*faces, noise=noise))


def _data_url(image):
    return "data:image/png;base64," + base64.b64encode(image).decode()


def _save(client, h, emp, image, source="DRH_UPLOAD"):
    """Enregistrement de la fiche avec une nouvelle photo (comme la Fiche de position)."""
    query = f"?photo_source={source}" if source else ""
    return client.put(f"/api/drh/employees/{emp.id}{query}", headers=h, json={"extra": {"photo": _data_url(image)}})


def _ref(client, h, emp):
    return client.get(f"/api/drh/employees/{emp.id}/facial-reference", headers=h).json()["reference"]


def _templates(db, emp, status=None):
    db.expire_all()
    stmt = select(BiometricTemplate).where(BiometricTemplate.employee_id == emp.id).order_by(BiometricTemplate.id)
    rows = db.execute(stmt).scalars().all()
    return [r for r in rows if status is None or r.status == status]


def _sync(db, emp):
    db.expire_all()
    return db.execute(select(BiometricPhotoSync).where(BiometricPhotoSync.employee_id == emp.id)).scalar_one_or_none()


def _audits(db, emp, event=None):
    db.expire_all()
    rows = db.execute(select(AuditEvent).where(AuditEvent.resource_id == str(emp.id), AuditEvent.action.like("drh.facial_reference.%"))
                      .order_by(AuditEvent.id)).scalars().all()
    return [r for r in rows if event is None or r.action == f"drh.facial_reference.{event}"]


def _consent(db, emp, status):
    db.add(BiometricConsent(employee_id=emp.id, status=status, source="HR_DOCUMENT", notice_version=service.NOTICE_VERSION,
                            proof_reference="REF-1" if status.endswith("confirmed") else None, recorded_by="test"))
    db.commit()


@pytest.fixture
def held(monkeypatch):
    """Retient les tâches d'arrière-plan pour les rejouer dans un ordre choisi."""
    calls = []
    real = photo_sync.run_sync_task
    monkeypatch.setattr(photo_sync, "run_sync_task", lambda *args: calls.append(args))
    return calls, real


# ── A. Réglage désactivé : aucun changement de comportement ───────────────────────────────
def test_a_flag_off_changes_nothing(client, db, drh, monkeypatch):
    monkeypatch.setattr(settings, "drh_facial_reference_auto_sync_enabled", False)
    assert settings.drh_facial_reference_auto_sync_enabled is False
    emp = _employee(db)
    assert _save(client, drh, emp, _image(face("A1"))).status_code == 200
    assert _sync(db, emp) is None and _templates(db, emp) == [] and _audits(db, emp) == []
    ref = _ref(client, drh, emp)
    assert (ref["state"], ref["message"]) == ("NONE", "La photo de la fiche n'a pas encore servi à préparer une référence faciale.")
    # Règle historique intacte : référence issue d'une ancienne photo ⇒ invalidée à la consultation biométrique.
    db.refresh(emp)
    from app.modules.biometrics import crypto
    old = BiometricTemplate(employee_id=emp.id, status="ACTIVE", embedding_encrypted=crypto.encrypt_vector(_vector("A1", 0.0, 0)),
                            engine="fake", config_version=1, source="EMPLOYEE_PHOTO", quality={"photo_sha256": "0" * 64})
    db.add(old); db.commit()
    assert _ref(client, drh, emp)["state"] == "PHOTO_TO_UPDATE"
    assert service.invalidate_if_photo_changed(db, emp) is True
    db.commit()
    assert _templates(db, emp, "ACTIVE") == []


def test_defaults_are_safe():
    from app.core.config import Settings
    fields = Settings.model_fields
    assert fields["drh_facial_reference_auto_sync_enabled"].default is False
    assert fields["facial_reference_consent_mode"].default == "explicit"
    assert fields["biometric_enabled"].default is False


# ── B / K. Photo exploitable sans référence (aucune donnée de consentement, nouveau mode) ──
def test_b_valid_photo_without_reference_becomes_ready(client, db, drh):
    emp = _employee(db)
    assert _ref(client, drh, emp)["state"] == "NONE"
    assert _save(client, drh, emp, _image(face("B1")), "DRH_CAMERA").status_code == 200
    rows = _templates(db, emp)
    assert [(r.status, r.source) for r in rows] == [("ACTIVE", "EMPLOYEE_PHOTO")]
    assert rows[0].embedding_encrypted[:1] != b"[" and rows[0].consent_id is None      # chiffré ; aucun faux consentement
    assert db.execute(select(func.count()).select_from(BiometricConsent).where(BiometricConsent.employee_id == emp.id)).scalar_one() == 0
    state = _sync(db, emp)
    assert (state.status, state.source, state.reason_code, state.previous_reference_kept) == ("READY", "DRH_CAMERA", None, False)
    assert state.photo_fingerprint == service.photo_fingerprint(db.get(Employee, emp.id)) and state.analyzed_at is not None
    ref = _ref(client, drh, emp)
    assert (ref["state"], ref["label"]) == ("READY", "Prête")
    assert [a.action.rsplit(".", 1)[1] for a in _audits(db, emp)] == ["requested", "ready"]
    assert db.execute(select(func.count()).select_from(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id)).scalar_one() == 0


def test_k_explicit_mode_requires_an_admissible_consent(client, db, drh, monkeypatch):
    monkeypatch.setattr(settings, "facial_reference_consent_mode", "explicit")
    emp = _employee(db)
    _save(client, drh, emp, _image(face("K1")))
    assert (_sync(db, emp).status, _sync(db, emp).reason_code) == ("BLOCKED", "CONSENT_REQUIRED") and _templates(db, emp) == []
    assert _ref(client, drh, emp)["state"] == "BLOCKED"
    agreed = _employee(db)
    _consent(db, agreed, "explicit_confirmed")
    _save(client, drh, agreed, _image(face("K2")))
    assert _sync(db, agreed).status == "READY" and len(_templates(db, agreed, "ACTIVE")) == 1
    monkeypatch.setattr(settings, "facial_reference_consent_mode", "n'importe quoi")
    assert service.consent_mode() == "explicit"                                         # valeur inconnue ⇒ règle stricte


# ── C. Photo inexploitable sans référence ─────────────────────────────────────────────────
@pytest.mark.parametrize("image, code", [
    (lambda: _image(), "NO_FACE"),
    (lambda: _image(face("C1"), face("C2")), "MULTIPLE_FACES"),
    (lambda: _image(face("C3", sharp=5)), "QUALITY_FAILED"),
])
def test_c_unusable_photo_without_reference(client, db, drh, image, code):
    emp = _employee(db)
    assert _save(client, drh, emp, image()).status_code == 200
    state = _sync(db, emp)
    assert (state.status, state.reason_code, state.previous_reference_kept) == ("PHOTO_INVALID", code, False)
    assert _templates(db, emp) == []
    ref = _ref(client, drh, emp)
    assert (ref["state"], ref["label"]) == ("PHOTO_TO_UPDATE", "Photo à actualiser") and ref["message"]
    if code == "QUALITY_FAILED":
        assert "Image floue" in ref["message"]
    assert db.get(Employee, emp.id).extra["photo"].startswith("/uploads/photos/")      # la photo reste enregistrée


# ── D. Même personne : remplacement atomique ──────────────────────────────────────────────
def test_d_same_person_replaces_the_reference(client, db, drh):
    emp = _employee(db)
    _save(client, drh, emp, _image(face("D1")))
    first = _templates(db, emp, "ACTIVE")[0]
    _save(client, drh, emp, _image(face("D1")), "DRH_CAMERA")
    rows = _templates(db, emp)
    assert [r.status for r in rows] == ["INACTIVE", "ACTIVE"] and rows[0].id == first.id
    assert rows[1].activated_at <= rows[0].deactivated_at                              # nouvelle activée, PUIS ancienne désactivée
    assert rows[1].quality["photo_sha256"] == service.photo_fingerprint(db.get(Employee, emp.id))
    state = _sync(db, emp)
    assert (state.status, state.template_id, state.previous_reference_kept) == ("READY", rows[1].id, False)
    assert _audits(db, emp, "ready")[-1].new_state and '"replaced": true' in _audits(db, emp, "ready")[-1].new_state.lower()
    assert _ref(client, drh, emp)["state"] == "READY"


# ── E / F. Visage différent ou ambigu : revue requise, ancienne référence conservée ───────
def _ambiguous_noise(who, cfg):
    base = _vector(who, 0.0, 0)
    for noise in range(1, 400):
        score = cosine(base, _vector(who, 2.3, noise))
        if cfg["recognition_threshold"] <= score < cfg["recognition_threshold"] + cfg["review_margin"]:
            return noise
    raise AssertionError("aucun bruit ne donne un score ambigu")


@pytest.mark.parametrize("case, code", [("different", "FACE_MISMATCH"), ("ambiguous", "FACE_AMBIGUOUS")])
def test_e_f_other_or_ambiguous_face_requires_review(client, db, drh, case, code):
    emp = _employee(db)
    who = f"EF{_tag()}"
    _save(client, drh, emp, _image(face(who), noise=0))
    old = _templates(db, emp, "ACTIVE")[0]
    if case == "different":
        new_photo = _image(face(f"X{_tag()}"))
    else:
        cfg = service.active_config(db)                                                 # seuils réellement en vigueur
        noise = _ambiguous_noise(who, {"recognition_threshold": cfg.recognition_threshold, "review_margin": cfg.review_margin})
        db.commit()
        new_photo = _image(face(who, jitter=2.3), noise=noise)
    assert _save(client, drh, emp, new_photo).status_code == 200
    rows = _templates(db, emp)
    assert [(r.id, r.status) for r in rows][0] == (old.id, "ACTIVE") and [r.status for r in rows] == ["ACTIVE", "PENDING_REVIEW"]
    state = _sync(db, emp)
    assert (state.status, state.reason_code, state.previous_reference_kept, state.template_id) == ("REVIEW_REQUIRED", code, True, rows[1].id)
    anomaly = db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.dedupe_key == f"DUPLICATE:{rows[1].id}")).scalar_one()
    assert (anomaly.anomaly_type, anomaly.status) == ("FACE_REFERENCE_MISMATCH", "OPEN")
    ref = _ref(client, drh, emp)
    assert (ref["state"], ref["label"]) == ("REVIEW_REQUIRED", "Revue requise") and "précédente conservée" in ref["message"]
    # L'ancienne référence reste utilisable : la photo changée n'entraîne plus son invalidation.
    fresh = db.get(Employee, emp.id)
    assert service.invalidate_if_photo_changed(db, fresh) is False
    site_id = db.execute(select(Assignment.site_id).where(Assignment.employee_id == emp.id)).scalar_one()
    assert [t.id for _, t in service._candidates(db, site_id, None)] == [old.id]
    assert _templates(db, emp, "ACTIVE")[0].id == old.id
    # Une photo plus récente et correcte rend caduque la référence restée en revue.
    _save(client, drh, emp, _image(face(who), noise=7))
    statuses = [r.status for r in _templates(db, emp)]
    assert statuses == ["INACTIVE", "INACTIVE", "ACTIVE"]
    db.expire_all()
    assert db.get(AttendanceAnomaly, anomaly.id).status == "RESOLVED"
    assert _sync(db, emp).status == "READY"


def test_review_decision_follows_the_consent_setting(client, db, drh, monkeypatch):
    emp = _employee(db)
    _save(client, drh, emp, _image(face(f"RV{_tag()}")))
    _save(client, drh, emp, _image(face(f"RW{_tag()}")))
    old, pending = _templates(db, emp)
    admin = db.execute(select(User).where(User.username == "testadmin")).scalar_one()
    monkeypatch.setattr(settings, "facial_reference_consent_mode", "explicit")
    with pytest.raises(Exception) as refused:
        service.review_duplicate(db, template=pending, approve=True, comment="identité vérifiée", actor=admin)
    assert getattr(refused.value, "status_code", None) == 409
    db.rollback()
    monkeypatch.setattr(settings, "facial_reference_consent_mode", "no_objection")
    service.review_duplicate(db, template=db.get(BiometricTemplate, pending.id), approve=True, comment="identité vérifiée", actor=admin)
    db.commit()
    assert [r.status for r in _templates(db, emp)] == ["INACTIVE", "ACTIVE"]
    assert _ref(client, drh, emp)["state"] == "READY"                                   # la décision de revue fait foi
    # Rejet : la référence précédente reste utilisée, la photo est à actualiser.
    other = _employee(db)
    _save(client, drh, other, _image(face(f"RX{_tag()}")))
    _save(client, drh, other, _image(face(f"RY{_tag()}")))
    kept, rejected = _templates(db, other)
    service.review_duplicate(db, template=rejected, approve=False, comment="autre personne", actor=admin)
    db.commit()
    assert [r.status for r in _templates(db, other)] == ["ACTIVE", "REJECTED"]
    ref = _ref(client, drh, other)
    assert ref["state"] == "PREVIOUS_KEPT" and "pas été retenue" in ref["message"]


# ── G. Doublon avec un autre salarié ──────────────────────────────────────────────────────
def test_g_duplicate_of_another_employee_requires_review(client, db, drh):
    who = f"G{_tag()}"
    first, second = _employee(db), _employee(db)
    _save(client, drh, first, _image(face(who)))
    _save(client, drh, second, _image(face(who)))
    rows = _templates(db, second)
    assert [(r.status, r.duplicate_of_employee_id) for r in rows] == [("PENDING_REVIEW", first.id)]
    assert (_sync(db, second).status, _sync(db, second).reason_code) == ("REVIEW_REQUIRED", "POSSIBLE_DUPLICATE")
    anomaly = db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.dedupe_key == f"DUPLICATE:{rows[0].id}")).scalar_one()
    assert anomaly.anomaly_type == "POSSIBLE_DUPLICATE_FACE"
    assert [r.status for r in _templates(db, first)] == ["ACTIVE"]                     # jamais fusionné ni écrasé
    ref = _ref(client, drh, second)
    assert ref["state"] == "REVIEW_REQUIRED" and "autre salarié" in ref["message"]


# ── H. Moteur indisponible / échec intermédiaire : fiche enregistrée, ancienne conservée ──
def test_h_engine_unavailable_never_blocks_the_fiche(client, db, drh, monkeypatch):
    emp = _employee(db)
    _save(client, drh, emp, _image(face("H1")))
    old = _templates(db, emp, "ACTIVE")[0]
    monkeypatch.setattr(settings, "biometric_models_dir", "/nonexistent")
    engine_module.set_engine(None)
    r = _save(client, drh, emp, _image(face("H1")))
    assert r.status_code == 200 and r.json()["extra"]["photo"].startswith("/uploads/photos/")
    state = _sync(db, emp)
    assert (state.status, state.reason_code, state.previous_reference_kept) == ("ENGINE_UNAVAILABLE", "ENGINE_UNAVAILABLE", True)
    assert [(t.id, t.status) for t in _templates(db, emp)] == [(old.id, "ACTIVE")]
    ref = _ref(client, drh, emp)
    assert (ref["state"], ref["label"]) == ("UNAVAILABLE", "Traitement temporairement indisponible")
    assert "précédente conservée" in ref["message"]
    # Clé absente : même garantie.
    engine_module.set_engine(FakePngEngine())
    monkeypatch.setattr(settings, "biometric_template_key", "")
    other = _employee(db)
    assert _save(client, drh, other, _image(face("H2"))).status_code == 200
    assert (_sync(db, other).status, _sync(db, other).reason_code) == ("ENGINE_UNAVAILABLE", "KEY_MISSING")
    assert _templates(db, other) == []


@pytest.mark.parametrize("failing", ["deactivate_templates", "append_audit", "encrypt"])
def test_h_intermediate_failure_rolls_everything_back(client, db, drh, monkeypatch, failing):
    emp = _employee(db)
    who = f"HR{_tag()}"
    _save(client, drh, emp, _image(face(who)))
    old = _templates(db, emp, "ACTIVE")[0]

    def boom(*args, **kwargs):
        raise RuntimeError("panne simulée")

    if failing == "deactivate_templates":
        monkeypatch.setattr(service, "deactivate_templates", boom)                      # après l'activation de la nouvelle
    elif failing == "append_audit":
        real = service.append_audit
        monkeypatch.setattr(service, "append_audit", lambda db, **kw: boom() if kw.get("action") == "biometrics.enroll" else real(db, **kw))
    else:
        monkeypatch.setattr(service.crypto, "encrypt_vector", boom)
    r = _save(client, drh, emp, _image(face(who)))
    assert r.status_code == 200                                                         # la fiche n'est jamais annulée
    assert [(t.id, t.status) for t in _templates(db, emp)] == [(old.id, "ACTIVE")], "ni nouvelle référence, ni ancienne désactivée"
    state = _sync(db, emp)
    assert (state.status, state.reason_code, state.previous_reference_kept) == ("ENGINE_UNAVAILABLE", "INTERNAL_ERROR", True)
    assert state.photo_fingerprint == service.photo_fingerprint(db.get(Employee, emp.id))
    assert _audits(db, emp, "unavailable")


def test_a_failing_sync_request_never_fails_the_fiche(client, db, drh, monkeypatch):
    emp = _employee(db)

    def boom(*args, **kwargs):
        raise RuntimeError("panne simulée")

    monkeypatch.setattr(photo_sync, "request_sync", boom)
    r = _save(client, drh, emp, _image(face("NF")))
    assert r.status_code == 200 and db.get(Employee, emp.id).extra["photo"].startswith("/uploads/photos/")


# ── I / J. Refus ou retrait explicite ─────────────────────────────────────────────────────
@pytest.mark.parametrize("status, code", [("refused", "CONSENT_REFUSED"), ("withdrawn", "CONSENT_WITHDRAWN")])
def test_i_j_refusal_or_withdrawal_blocks(client, db, drh, status, code):
    emp = _employee(db)
    _consent(db, emp, status)
    assert _save(client, drh, emp, _image(face(f"IJ{status}"))).status_code == 200
    assert (_sync(db, emp).status, _sync(db, emp).reason_code) == ("BLOCKED", code)
    assert _templates(db, emp) == []
    ref = _ref(client, drh, emp)
    assert (ref["state"], ref["label"]) == ("BLOCKED", "Référence faciale non autorisée")
    assert ("refus" in ref["message"].lower()) or ("retiré" in ref["message"].lower())
    assert _audits(db, emp, "blocked")
    # Aucun consentement créé ni modifié par la synchronisation.
    assert [c.status for c in db.execute(select(BiometricConsent).where(BiometricConsent.employee_id == emp.id)).scalars()] == [status]


def test_inadmissible_hr_status_blocks(client, db, drh):
    emp = _employee(db, status="sortant")
    _save(client, drh, emp, _image(face("ST")))
    assert (_sync(db, emp).status, _sync(db, emp).reason_code) == ("BLOCKED", "EMPLOYEE_STATUS") and _templates(db, emp) == []


# ── L / O. Idempotence par empreinte ──────────────────────────────────────────────────────
def test_l_o_same_photo_is_processed_once(client, db, drh):
    emp = _employee(db)
    image = _image(face("LO"), noise=1)
    _save(client, drh, emp, image)
    fingerprint = _sync(db, emp).photo_fingerprint
    # L. Le même traitement relancé (retry, double exécution) ne fait rien.
    assert photo_sync.sync_facial_reference_from_employee_photo(db, employee_id=emp.id, fingerprint=fingerprint) is None
    photo_sync.run_sync_task(emp.id, fingerprint, None)
    # O. La fiche est ré-enregistrée avec le MÊME fichier (double clic, ré-import) : aucun nouveau traitement.
    first_path = db.get(Employee, emp.id).extra["photo"]
    assert _save(client, drh, emp, image).status_code == 200
    assert _save(client, drh, emp, image, "DRH_CAMERA").status_code == 200
    db.expire_all()
    assert db.get(Employee, emp.id).extra["photo"] != first_path                        # nouveau fichier, même contenu
    assert len(_templates(db, emp)) == 1 and len(_audits(db, emp, "requested")) == 1 and len(_audits(db, emp, "ready")) == 1
    # Fiche enregistrée sans toucher à la photo : rien non plus.
    assert client.put(f"/api/drh/employees/{emp.id}?photo_source=DRH_UPLOAD", headers=drh, json={"phone": "0550000000"}).status_code == 200
    assert len(_audits(db, emp, "requested")) == 1


# ── M. Concurrence : la dernière photo de la fiche fait foi ───────────────────────────────
def test_m_stale_task_never_overwrites_a_newer_photo(client, db, drh, held):
    calls, real = held
    emp = _employee(db)
    _save(client, drh, emp, _image(face("M-old")))
    _save(client, drh, emp, _image(face("M-new")))
    assert len(calls) == 2 and calls[0][1] != calls[1][1]
    assert _sync(db, emp).status == "PROCESSING" and _ref(client, drh, emp)["state"] == "PROCESSING"
    real(*calls[1])                                                                     # la plus récente d'abord
    real(*calls[0])                                                                     # l'ancienne termine APRÈS
    rows = _templates(db, emp)
    assert len(rows) == 1 and rows[0].status == "ACTIVE" and rows[0].quality["photo_sha256"] == calls[1][1]
    assert _sync(db, emp).photo_fingerprint == calls[1][1] and _sync(db, emp).status == "READY"
    # Et dans l'autre ordre : l'ancienne tâche, exécutée avant, ne produit rien non plus.
    other = _employee(db)
    calls.clear()
    _save(client, drh, other, _image(face("M2-old")))
    _save(client, drh, other, _image(face("M2-new")))
    real(*calls[0])
    assert _templates(db, other) == [] and _sync(db, other).status == "PROCESSING"
    real(*calls[1]); real(*calls[1])                                                    # retry : idempotent
    assert len(_templates(db, other)) == 1 and _sync(db, other).status == "READY"


def test_retry_of_a_lost_or_deferred_task(client, db, drh, held, monkeypatch):
    calls, real = held
    emp = _employee(db)
    _save(client, drh, emp, _image(face("RT")))
    calls.clear()                                                                       # tâche perdue (redémarrage)
    assert _ref(client, drh, emp)["state"] == "PROCESSING" and calls == []              # trop récent : pas de reprise
    row = _sync(db, emp)
    row.updated_at = row.requested_at = datetime.utcnow() - timedelta(seconds=photo_sync.STALE_PROCESSING_SECONDS + 5)
    db.commit()
    monkeypatch.setattr(photo_sync, "run_sync_task", real)
    client.get(f"/api/drh/employees/{emp.id}/facial-reference", headers=drh)            # la consultation relance CET employé
    assert _sync(db, emp).status == "READY" and _sync(db, emp).attempts == 1 and len(_templates(db, emp, "ACTIVE")) == 1
    # Reprises bornées.
    other = _employee(db)
    monkeypatch.setattr(photo_sync, "run_sync_task", lambda *a: None)
    _save(client, drh, other, _image(face("RT2")))
    for expected in (1, 2, 3, 3):
        row = _sync(db, other)
        row.updated_at = datetime.utcnow() - timedelta(seconds=photo_sync.STALE_PROCESSING_SECONDS + 5)
        db.commit()
        client.get(f"/api/drh/employees/{other.id}/facial-reference", headers=drh)
        assert _sync(db, other).attempts == expected
    assert (_sync(db, other).status, _sync(db, other).reason_code) == ("ENGINE_UNAVAILABLE", "RETRY_EXHAUSTED")


# ── N. Sources exclues : import, synchronisation historique, appel sans provenance ────────
def test_n_imports_and_legacy_sync_trigger_nothing(client, db, drh):
    from app.modules.irongs import sql_bridge

    emp = _employee(db)
    for source in (None, "IMPORT", "LEGACY_SYNC", "DRH_API", "n'importe"):
        assert _save(client, drh, emp, _image(face("N1")), source).status_code == 200
    saved = sql_bridge.upsert_employee(db, {"backendId": emp.id, "matricule": emp.code, "nom": "Hist", "prenom": "Import",
                                            "societe": SOC, "photo": _data_url(_image(face("N2")))})
    db.commit()
    assert str(saved.get("photo") or "").startswith("/uploads/photos/")
    assert _sync(db, emp) is None and _templates(db, emp) == [] and _audits(db, emp) == []
    # Création depuis la fiche avec une provenance déclenchante : traitée.
    created = client.post("/api/drh/employees?photo_source=DRH_UPLOAD", headers=drh, json={
        "code": f"LBN{_tag()}", "first_name": "Nouveau", "last_name": f"Créé{_tag()}", "society": SOC, "status": "actif", "extra": {"photo": _data_url(_image(face(f"N3{_tag()}")))}})
    assert created.status_code == 200, created.text
    new_id = created.json()["id"]
    assert db.execute(select(BiometricPhotoSync.status).where(BiometricPhotoSync.employee_id == new_id)).scalar_one() == "READY"


def test_n_no_startup_scan_and_no_batch():
    """Garde structurelle : la synchronisation n'est appelée que par les routes de la fiche et
    par la lecture d'état ; aucun démarrage, planificateur, migration ou import ne l'appelle."""
    root = Path(__file__).resolve().parents[1]
    callers = set()
    for path in list((root / "app").rglob("*.py")) + list((root / "migrations").rglob("*.py")) + list((root / "scripts").rglob("*.py")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if re.search(r"\bphoto_sync\b", text) and path.name != "photo_sync.py":
            callers.add(path.relative_to(root).as_posix())
    assert callers == {"app/modules/drh/routes.py", "app/modules/biometrics/photo_reference.py", "app/modules/biometrics/service.py"}
    source = (root / "app/modules/biometrics/photo_sync.py").read_text(encoding="utf-8")
    assert "select(Employee)" not in source and "query(Employee)" not in source          # jamais de balayage des employés
    migration = (root / "migrations/versions/20261002_0001_biometric_photo_syncs.py").read_text(encoding="utf-8")
    assert "insert" not in migration.lower() and "update(" not in migration.lower()


# ── Périmètre, audit, retour arrière ──────────────────────────────────────────────────────
def test_scope_is_unchanged_and_audit_never_contains_biometric_data(client, db, drh):
    foreign = _employee(db, society=OTHER)
    assert _save(client, drh, foreign, _image(face("FO"))).status_code in (403, 404)
    assert _sync(db, foreign) is None
    emp = _employee(db)
    _save(client, drh, emp, _image(face("AU")))
    _save(client, drh, emp, _image(face(f"AV{_tag()}")))
    events = _audits(db, emp)
    assert [e.action.rsplit(".", 1)[1] for e in events] == ["requested", "ready", "requested", "review_required"]
    for e in events:
        blob = f"{e.old_state} {e.new_state}"
        assert "base64" not in blob and "iVBOR" not in blob and "embedding" not in blob and len(blob) < 600
        assert e.username and e.society == SOC
    state = _sync(db, emp)
    assert not hasattr(state, "embedding_encrypted") and not hasattr(state, "score")


def test_turning_the_flag_off_restores_the_previous_behaviour(client, db, drh, monkeypatch):
    emp = _employee(db)
    _save(client, drh, emp, _image(face("RB")))
    _save(client, drh, emp, _image(face(f"RC{_tag()}")))                              # revue requise, ancienne conservée
    assert _ref(client, drh, emp)["state"] == "REVIEW_REQUIRED"
    monkeypatch.setattr(settings, "drh_facial_reference_auto_sync_enabled", False)
    assert _ref(client, drh, emp)["state"] == "PHOTO_TO_UPDATE"                         # lecture LOT A
    assert service.photo_change_supervised(db, db.get(Employee, emp.id)) is False
    assert _save(client, drh, emp, _image(face("RD"))).status_code == 200
    assert len(_audits(db, emp, "requested")) == 2                                      # plus aucun déclenchement


# ── Migration additive : upgrade / downgrade sur une base jetable ─────────────────────────
def test_migration_is_additive_and_reversible(tmp_path):
    import os
    import sqlite3
    import subprocess
    import sys

    repo = Path(__file__).resolve().parents[1]
    database = tmp_path / "lot_b.sqlite"
    env = {**os.environ, "APP_ENV": "test", "DATABASE_URL": f"sqlite:///{database}", "JWT_SECRET": "lot-b-migration-test-secret"}

    def alembic(*args):
        return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=repo, env=env, capture_output=True, text=True, check=False)

    before = alembic("upgrade", "20260930_0002")
    assert before.returncode == 0, before.stderr
    con = sqlite3.connect(database)
    con.execute("INSERT INTO employees (id, code, first_name, last_name, society, status, children_count, salary_net, locked, created_at, extra) "
                "VALUES (9, 'LBM09', 'A', 'B', 'SOC', 'actif', 0, 0, 1, '2026-09-01', '{\"photo\": \"/uploads/photos/lbm09.jpg\"}')")
    con.commit()
    tables = lambda: {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}  # noqa: E731
    counts = lambda: {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("employees", "biometric_templates", "biometric_consents")}  # noqa: E731
    existing, rows = tables(), counts()

    up = alembic("upgrade", "20261002_0001")
    assert up.returncode == 0, up.stderr
    assert tables() - existing == {"biometric_photo_syncs"} and existing <= tables()
    assert con.execute("SELECT COUNT(*) FROM biometric_photo_syncs").fetchone()[0] == 0     # aucune photo historique traitée
    assert counts() == rows
    columns = {r[1] for r in con.execute("PRAGMA table_info(biometric_photo_syncs)")}
    assert {"employee_id", "photo_fingerprint", "status", "reason_code", "analyzed_at", "source", "created_at", "updated_at"} <= columns
    assert not columns & {"embedding", "embedding_encrypted", "image", "photo", "score"}

    down = alembic("downgrade", "20260930_0002")
    assert down.returncode == 0, down.stderr
    assert tables() == existing and counts() == rows
    assert alembic("upgrade", "20261002_0001").returncode == 0
    assert "biometric_photo_syncs" in tables()
    con.close()
