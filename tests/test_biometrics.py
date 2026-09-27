"""Biométrie faciale — règles métier, permissions, périmètre, secrets (moteur simulé déterministe)."""
import base64
import json
import uuid
from datetime import date

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.modules.attendance.models import AttendanceAnomaly, AttendanceEvent
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics import service
from app.modules.biometrics.models import BiometricTemplate, Camera, CameraModel
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.biometric_fakes import FakeFaceEngine, face, frame
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"
# Clé unique pour toute la session de tests : la base de test est partagée entre les tests, et
# le contrôle de doublon déchiffre les gabarits des autres employés (une clé différente par
# test les rendrait illisibles — refus explicite, comme en production après un changement de clé).
TEST_KEY = Fernet.generate_key().decode()


# Capture SERVEUR simulée : les images « vues » par la caméra Dahua du test. Le client ne
# fournit jamais d'image pour pointer (le serveur lit la caméra).
CAPTURE: dict = {"frames": []}


@pytest.fixture(autouse=True)
def biometrics_on(monkeypatch):
    from app.modules.biometrics.cameras import DahuaCameraAdapter
    monkeypatch.setattr(DahuaCameraAdapter, "burst", lambda self, count=3, interval=0.25: list(CAPTURE["frames"]))
    monkeypatch.setattr(settings, "biometric_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 0)
    engine_module.set_engine(FakeFaceEngine())
    yield
    engine_module.set_engine(None)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db):
    site = Site(name=f"BIO {_tag()}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    return site


def _employee(db, site, name="Agent"):
    emp = Employee(code=f"BI{_tag()}", first_name=name, last_name="Bio", society=SOC, status="actif")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


def _b64(*frames):
    return [base64.b64encode(f).decode() for f in frames]


def _burst(who, **kw):
    return _b64(*(frame(face(who, **kw)) for _ in range(3)))


def _camera(client, h, site, *, usage="ATTENDANCE_AND_ENROLLMENT", name=None, adapter="DAHUA"):
    model = client.post("/api/biometrics/camera-models", headers=h, json={
        "manufacturer": "DAHUA" if adapter == "DAHUA" else "Terminal", "model": f"Réf {_tag()}", "adapter": adapter}).json()
    r = client.post("/api/biometrics/cameras", headers=h, json={
        "name": name or f"CAM-{_tag()}", "camera_model_id": model["id"], "site_id": site.id, "host": "10.0.0.20",
        "usage": usage, "role": "ENTRY"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _capture(frames_b64):
    CAPTURE["frames"] = [base64.b64decode(f) for f in frames_b64]


def _consent(client, h, emp, **over):
    body = {"status": "contract_confirmed", "source": "EMPLOYMENT_CONTRACT", "proof_reference": "Contrat CDD art. 12",
            "notice_version": service.NOTICE_VERSION, **over}
    return client.post(f"/api/biometrics/employees/{emp.id}/consent", headers=h, json=body)


def _enroll(client, h, emp, cam, who, **kw):
    _capture(_burst(who, **kw))
    return client.post(f"/api/biometrics/employees/{emp.id}/enroll", headers=h, json={"camera_id": cam})


def _enroll_frames(client, h, emp, cam, frames_b64):
    _capture(frames_b64)
    return client.post(f"/api/biometrics/employees/{emp.id}/enroll", headers=h, json={"camera_id": cam})


def _recognize(client, h, cam, frames, **extra):
    """`frames` = ce que la caméra voit (capture serveur), jamais envoyé par le client."""
    _capture(frames)
    return client.post(f"/api/biometrics/cameras/{cam}/recognize", headers=h, json={**extra})


def _user(client, db, *, sites, features=(), modules=("pointage",)):
    username = f"b{_tag()}"
    user = User(username=username, full_name=username, role="ops", access_level="H3", authorized_societies=[SOC],
                authorized_sites=list(sites), authorized_modules=list(modules), password_hash=hash_password("biopass123"), is_active=True)
    db.add(user); db.flush()
    for feature, action in features:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance", feature_key=feature, action_key=action))
    db.commit()
    token = client.post("/api/auth/login", json={"username": username, "password": "biopass123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ── Activation, consentement ────────────────────────────────────────────────────────────
def test_disabled_by_default_blocks_everything(client, auth_headers, db, monkeypatch):
    monkeypatch.setattr(settings, "biometric_enabled", False)
    site = _site(db)
    emp = _employee(db, site)
    cam = _camera(client, auth_headers, site)
    _consent(client, auth_headers, emp)
    assert _enroll(client, auth_headers, emp, cam, "A").status_code == 503
    assert _recognize(client, auth_headers, cam, _burst("A")).status_code == 503
    assert client.get("/api/biometrics/status", headers=auth_headers).json()["enabled"] is False


def test_no_admissible_consent_no_enrollment(client, auth_headers, db):
    site = _site(db); emp = _employee(db, site); cam = _camera(client, auth_headers, site)
    assert _enroll(client, auth_headers, emp, cam, "A").status_code == 409
    assert _consent(client, auth_headers, emp, proof_reference="").status_code == 422          # preuve obligatoire
    assert _consent(client, auth_headers, emp, notice_version="old").status_code == 422        # texte en vigueur
    assert _consent(client, auth_headers, emp, status="pending").status_code == 200
    assert _enroll(client, auth_headers, emp, cam, "A").status_code == 409
    assert _consent(client, auth_headers, emp).status_code == 200
    r = _enroll(client, auth_headers, emp, cam, "A")
    assert r.status_code == 200 and r.json()["status"] == "ACTIVE", r.text
    # Retrait ⇒ désactivation immédiate
    assert _consent(client, auth_headers, emp, status="withdrawn", proof_reference=None).status_code == 200
    assert db.scalar(select(func.count(BiometricTemplate.id)).where(BiometricTemplate.employee_id == emp.id, BiometricTemplate.status == "ACTIVE")) == 0


# ── Enrôlement : qualité, visages multiples, image figée ────────────────────────────────
def test_enrollment_rejects_bad_captures(client, auth_headers, db):
    site = _site(db); emp = _employee(db, site); cam = _camera(client, auth_headers, site); _consent(client, auth_headers, emp)
    many = _b64(*(frame(face("A"), face("B")) for _ in range(3)))
    r = _enroll_frames(client, auth_headers, emp, cam, many)
    assert r.status_code == 422 and r.json()["detail"]["state"] == "MULTIPLE_FACES"
    assert _enroll(client, auth_headers, emp, cam, "A", sharp=5).json()["detail"]["state"] == "QUALITY_FAILED"
    assert _enroll(client, auth_headers, emp, cam, "A", px=40).json()["detail"]["state"] == "QUALITY_FAILED"
    assert _enroll(client, auth_headers, emp, cam, "A", live=0.2).json()["detail"]["state"] == "LIVENESS_FAILED"
    frozen = _b64(*(frame(face("A"), noise=0.5) for _ in range(3)))
    r = _enroll_frames(client, auth_headers, emp, cam, frozen)
    assert r.json()["detail"]["state"] == "LIVENESS_FAILED" and "figée" in r.json()["detail"]["reasons"][0]
    assert db.scalar(select(func.count(BiometricTemplate.id)).where(BiometricTemplate.employee_id == emp.id)) == 0


def test_enrollment_prefers_the_employee_file_photo_and_tracks_photo_changes(client, auth_headers, db):
    from app.core.photo_storage import PHOTOS_DIR, ensure_upload_dirs
    ensure_upload_dirs()
    site = _site(db); emp = _employee(db, site); _consent(client, auth_headers, emp)
    photo = PHOTOS_DIR / f"{emp.code}.jpg"
    photo.write_bytes(frame(face("PHOTO-PERSON"), noise=1))
    emp.extra = {"photo": f"/uploads/photos/{emp.code}.jpg"}; db.commit()
    r = client.post(f"/api/biometrics/employees/{emp.id}/enroll", headers=auth_headers, json={})
    assert r.status_code == 200 and r.json()["source"] == "EMPLOYEE_PHOTO", r.text
    photo.write_bytes(frame(face("PHOTO-PERSON"), noise=2))   # photo remplacée dans la fiche
    status = client.get(f"/api/biometrics/employees/{emp.id}", headers=auth_headers).json()
    assert status["enrollment"] == "NONE"
    assert "Photo de la fiche remplacée" in status["templates"][0]["status_reason"]


# ── Doublon ─────────────────────────────────────────────────────────────────────────────
def test_duplicate_face_blocks_activation_until_human_review(client, auth_headers, db):
    site = _site(db); a = _employee(db, site, "Alpha"); b = _employee(db, site, "Beta"); cam = _camera(client, auth_headers, site)
    for emp in (a, b):
        _consent(client, auth_headers, emp)
    assert _enroll(client, auth_headers, a, cam, "SAME").json()["status"] == "ACTIVE"
    r = _enroll(client, auth_headers, b, cam, "SAME")
    assert r.json()["status"] == "PENDING_REVIEW" and r.json()["duplicate"] is True
    anomaly = db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.anomaly_type == "POSSIBLE_DUPLICATE_FACE",
                                                         AttendanceAnomaly.employee_id == b.id)).scalar_one()
    assert anomaly.details["candidate_employee_id"] == a.id and anomaly.details["score"] > 0.9
    dup = client.get("/api/biometrics/duplicates", headers=auth_headers).json()
    entry = next(d for d in dup if d["target"]["id"] == b.id)
    assert entry["candidate"]["id"] == a.id
    assert client.patch(f"/api/biometrics/templates/{entry['template_id']}/review", headers=auth_headers,
                        json={"approve": False, "comment": "Même personne sous deux identités"}).status_code == 200
    db.expire_all()
    assert db.get(BiometricTemplate, entry["template_id"]).status == "REJECTED"
    assert db.get(AttendanceAnomaly, anomaly.id).status == "RESOLVED"


# ── Pointage facial automatique ─────────────────────────────────────────────────────────
def _enrolled(client, h, db, who="A"):
    """Identité faciale unique par appel : la base de test est partagée, et un même visage
    enrôlé par un autre test serait (à juste titre) mis en revue pour doublon."""
    who = f"{who}-{_tag()}"
    site = _site(db); emp = _employee(db, site); cam = _camera(client, h, site)
    _consent(client, h, emp)
    r = _enroll(client, h, emp, cam, who)
    assert r.status_code == 200 and r.json()["status"] == "ACTIVE", r.text
    return site, emp, cam, who


def _facial_events(db, emp):
    return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id, AttendanceEvent.source == "FACIAL")).scalars().all()


def test_recognized_face_is_recorded_automatically_through_attendance_core(client, auth_headers, db):
    site, emp, cam, W = _enrolled(client, auth_headers, db, "WORKER")
    r = _recognize(client, auth_headers, cam, _burst(W, jitter=0.05), burst_id="b1")
    body = r.json()
    assert body["state"] == "ATTENDANCE_RECORDED" and body["recorded"] is True, body
    assert body["employee"]["matricule"] == emp.code and body["action"] == "ENTRÉE"
    events = _facial_events(db, emp)
    assert len(events) == 1 and events[0].device_id == cam and events[0].confidence > 0.9
    assert events[0].liveness_result.startswith("REAL:")
    # Le même visage resté devant la caméra ne re-pointe pas (retry réseau compris).
    again = _recognize(client, auth_headers, cam, _burst(W, jitter=0.05), burst_id="b2").json()
    assert again["state"] == "ALREADY_RECORDED" and again["recorded"] is False
    retry = _recognize(client, auth_headers, cam, _burst(W, jitter=0.05), burst_id="b1").json()
    assert retry["recorded"] is False
    assert len(_facial_events(db, emp)) == 1


@pytest.mark.parametrize("frames_factory, expected", [
    (lambda W: _burst("STRANGER"), "UNKNOWN_FACE"),
    (lambda W: _b64(*(frame(face(W), face("OTHER")) for _ in range(3))), "MULTIPLE_FACES"),
    (lambda W: _burst(W, live=0.1), "LIVENESS_FAILED"),
    (lambda W: _b64(*(frame(face(W), noise=0.3) for _ in range(3))), "LIVENESS_FAILED"),
    (lambda W: _burst(W, sharp=3), "QUALITY_FAILED"),
    (lambda W: _b64(frame(noise=0.1)), "NO_FACE"),
])
def test_no_attendance_unless_every_condition_holds(client, auth_headers, db, frames_factory, expected):
    site, emp, cam, W = _enrolled(client, auth_headers, db, "WORKER")
    body = _recognize(client, auth_headers, cam, frames_factory(W)).json()
    assert body["state"] == expected and body["recorded"] is False, body
    assert _facial_events(db, emp) == []


def test_unknown_and_liveness_failures_are_traced_as_anomalies(client, auth_headers, db):
    site, emp, cam, W = _enrolled(client, auth_headers, db, "WORKER")
    _recognize(client, auth_headers, cam, _burst("STRANGER"))
    _recognize(client, auth_headers, cam, _burst(W, live=0.1))
    kinds = {a.anomaly_type for a in db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.site_id == site.id)).scalars()}
    assert {"UNKNOWN_FACE", "LIVENESS_FAILED"} <= kinds


def test_employee_of_another_site_is_never_a_candidate(client, auth_headers, db):
    site, emp, cam, W = _enrolled(client, auth_headers, db, "WORKER")
    other_site = _site(db)
    other_cam = _camera(client, auth_headers, other_site)
    body = _recognize(client, auth_headers, other_cam, _burst(W)).json()
    assert body["state"] == "UNKNOWN_FACE" and _facial_events(db, emp) == []


def test_ambiguous_match_never_picks_a_best_candidate(client, auth_headers, db):
    site = _site(db); a = _employee(db, site, "Alpha"); b = _employee(db, site, "Beta"); cam = _camera(client, auth_headers, site)
    for emp in (a, b):
        _consent(client, auth_headers, emp)
    _enroll(client, auth_headers, a, cam, "TWIN")
    pending = _enroll(client, auth_headers, b, cam, "TWIN").json()
    client.patch(f"/api/biometrics/templates/{pending['template_id']}/review", headers=auth_headers,
                 json={"approve": True, "comment": "Jumeaux vérifiés par la DRH"})
    body = _recognize(client, auth_headers, cam, _burst("TWIN")).json()
    assert body["state"] == "AMBIGUOUS" and body["recorded"] is False
    assert _facial_events(db, a) == [] and _facial_events(db, b) == []


def test_withdrawn_consent_or_inactive_employee_stops_facial_attendance(client, auth_headers, db):
    site, emp, cam, W = _enrolled(client, auth_headers, db, "WORKER")
    emp.status = "suspendu"; db.commit()
    assert _recognize(client, auth_headers, cam, _burst(W)).json()["state"] == "REFUSED"
    emp.status = "actif"; db.commit()
    _consent(client, auth_headers, emp, status="withdrawn", proof_reference=None)
    assert _recognize(client, auth_headers, cam, _burst(W)).json()["state"] == "UNKNOWN_FACE"
    assert _facial_events(db, emp) == []


def test_enrollment_only_camera_cannot_record_attendance(client, auth_headers, db):
    site, emp, _, W = _enrolled(client, auth_headers, db, "WORKER")
    enrol_cam = _camera(client, auth_headers, site, usage="ENROLLMENT")
    assert _recognize(client, auth_headers, enrol_cam, _burst(W)).status_code == 409


# ── Permissions, périmètre, secrets ─────────────────────────────────────────────────────
def test_biometric_actions_require_explicit_permission_even_for_drh(client, auth_headers, db):
    site = _site(db); emp = _employee(db, site); cam = _camera(client, auth_headers, site)
    drh = _user(client, db, sites=[site.id], modules=("drh",))
    assert client.get(f"/api/biometrics/employees/{emp.id}", headers=drh).status_code == 403
    assert _consent(client, drh, emp).status_code == 403
    granted = _user(client, db, sites=[site.id], modules=("drh",),
                    features=[("biometric_status", "read"), ("biometric_enrollment", "create")])
    assert client.get(f"/api/biometrics/employees/{emp.id}", headers=granted).status_code == 200
    assert _consent(client, granted, emp).status_code == 200
    assert _enroll(client, granted, emp, cam, "A").status_code == 200
    assert client.get("/api/biometrics/duplicates", headers=granted).status_code == 403   # admin biométrique distinct
    assert client.get("/api/biometrics/config", headers=granted).status_code == 403


def test_other_site_employee_and_camera_are_invisible(client, auth_headers, db):
    site, other = _site(db), _site(db)
    emp_other = _employee(db, other)
    cam_other = _camera(client, auth_headers, other)
    h = _user(client, db, sites=[site.id], modules=("pointage", "drh"),
              features=[("biometric_status", "read"), ("biometric_enrollment", "create")])
    assert client.get(f"/api/biometrics/employees/{emp_other.id}", headers=h).status_code == 404
    assert _recognize(client, h, cam_other, _burst("A")).status_code == 404
    assert client.get("/api/biometrics/cameras", headers=h).json() == []


def test_templates_and_camera_secrets_never_leave_the_backend(client, auth_headers, db):
    site, emp, cam, W = _enrolled(client, auth_headers, db, "WORKER")
    model = client.post("/api/biometrics/camera-models", headers=auth_headers,
                        json={"manufacturer": "DAHUA", "model": f"Réf {_tag()}", "adapter": "DAHUA", "resolution": "5MP"}).json()
    created = client.post("/api/biometrics/cameras", headers=auth_headers, json={
        "name": "CAM-ENTREE-01", "camera_model_id": model["id"], "site_id": site.id, "host": "10.0.0.20",
        "http_port": 80, "username": "admin", "password": "S3cr3t-Cam!"}).json()
    listing = json.dumps(client.get("/api/biometrics/cameras", headers=auth_headers).json())
    status = json.dumps(client.get(f"/api/biometrics/employees/{emp.id}", headers=auth_headers).json())
    assert "S3cr3t-Cam!" not in json.dumps(created) + listing and created["credentials_set"] is True
    assert "embedding" not in status and "photo_sha256" not in status
    row = db.execute(select(BiometricTemplate).where(BiometricTemplate.employee_id == emp.id)).scalar_one()
    assert b"\x00\x00" not in row.embedding_encrypted[:8] and row.embedding_encrypted.startswith(b"gAAAAA")  # Fernet
    from app.core.audit import AuditEvent
    audits = " ".join(f"{a.old_state or ''}{a.new_state or ''}" for a in db.execute(select(AuditEvent)).scalars())
    assert "S3cr3t-Cam!" not in audits
    cam_row = db.get(Camera, created["id"])
    assert b"S3cr3t" not in cam_row.credentials_encrypted


def test_thresholds_are_versioned_with_provenance(client, auth_headers, db):
    v1 = client.get("/api/biometrics/config", headers=auth_headers).json()
    assert "OpenCV" in v1["provenance"]
    assert client.post("/api/biometrics/config", headers=auth_headers, json={"provenance": "", "recognition_threshold": 0.5}).status_code == 422
    assert client.post("/api/biometrics/config", headers=auth_headers, json={"provenance": "Calibration", "recognition_threshold": 1.5}).status_code == 422
    v2 = client.post("/api/biometrics/config", headers=auth_headers,
                     json={"provenance": "Calibration site Hamoul 01, 200 passages", "recognition_threshold": 0.42}).json()
    assert v2["version"] == v1["version"] + 1 and v2["recognition_threshold"] == 0.42
    assert v2["liveness_threshold"] == v1["liveness_threshold"]


# ── Images fournies par le client : jamais pour pointer ─────────────────────────────────
def test_terminal_camera_is_enrollment_only(client, auth_headers, db):
    site = _site(db)
    model = client.post("/api/biometrics/camera-models", headers=auth_headers,
                        json={"manufacturer": "Terminal", "model": f"Tab {_tag()}", "adapter": "TERMINAL"}).json()
    body = {"name": f"TAB-{_tag()}", "camera_model_id": model["id"], "site_id": site.id, "host": "terminal", "role": "ENROLLMENT"}
    for usage in ("ATTENDANCE", "ATTENDANCE_AND_ENROLLMENT"):
        assert client.post("/api/biometrics/cameras", headers=auth_headers, json={**body, "usage": usage}).status_code == 422
    tab = client.post("/api/biometrics/cameras", headers=auth_headers, json={**body, "usage": "ENROLLMENT"}).json()["id"]
    assert client.patch(f"/api/biometrics/cameras/{tab}", headers=auth_headers, json={"usage": "ATTENDANCE"}).status_code == 422
    emp = _employee(db, site); _consent(client, auth_headers, emp)
    who = f"TAB-{_tag()}"
    # Enrôlement supervisé : images fournies par le terminal, liveness exigé.
    r = client.post(f"/api/biometrics/employees/{emp.id}/enroll", headers=auth_headers, json={"camera_id": tab, "frames": _burst(who)})
    assert r.status_code == 200 and r.json()["status"] == "ACTIVE", r.text
    assert client.post(f"/api/biometrics/cameras/{tab}/recognize", headers=auth_headers, json={}).status_code == 409


def test_client_images_are_never_used_to_record_attendance(client, auth_headers, db):
    site, emp, cam, W = _enrolled(client, auth_headers, db, "WORKER")
    CAPTURE["frames"] = [frame(face("STRANGER")) for _ in range(3)]            # ce que la caméra voit réellement
    forged = _burst(W)                                                          # photo injectée par un client
    r = client.post(f"/api/biometrics/cameras/{cam}/recognize", headers=auth_headers, json={"frames": forged})
    assert r.json()["state"] == "UNKNOWN_FACE", r.json()
    assert _facial_events(db, emp) == []
    other = _employee(db, site); _consent(client, auth_headers, other)
    r = client.post(f"/api/biometrics/employees/{other.id}/enroll", headers=auth_headers, json={"camera_id": cam, "frames": forged})
    assert r.status_code == 422 and "lue par le serveur" in r.json()["detail"]


def test_camera_catalog_and_camera_tests_are_audited_without_secrets(client, auth_headers, db):
    from app.core.audit import AuditEvent
    site = _site(db)
    cam = _camera(client, auth_headers, site, adapter="TERMINAL", usage="ENROLLMENT")
    assert client.post(f"/api/biometrics/cameras/{cam}/test", headers=auth_headers).status_code == 200
    actions = {a.action for a in db.execute(select(AuditEvent).where(AuditEvent.action.like("biometrics.camera%"))).scalars()}
    assert {"biometrics.camera_model.create", "biometrics.camera.create", "biometrics.camera.test"} <= actions
