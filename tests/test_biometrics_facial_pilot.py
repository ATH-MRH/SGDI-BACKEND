"""Pointage facial — pilote contrôlé : enrôlement supervisé (aperçu + comparaison 1:1 avec la
photo DRH + confirmation humaine), activation explicite par caméra, coupure par site, audit.

Moteur simulé déterministe (tests/biometric_fakes.py) ; capture serveur simulée."""
import base64
import json
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.modules.attendance.models import AttendanceEvent
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics import service
from app.modules.biometrics.models import BiometricTemplate
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.biometric_fakes import FakeFaceEngine, face, frame
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics import TEST_KEY   # même clé : base de test partagée

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"
CAPTURE: dict = {"frames": []}


@pytest.fixture(autouse=True)
def pilot(monkeypatch):
    from app.modules.biometrics.cameras import DahuaCameraAdapter
    monkeypatch.setattr(DahuaCameraAdapter, "burst", lambda self, count=3, interval=0.25: list(CAPTURE["frames"]))
    monkeypatch.setattr(settings, "biometric_enabled", False)             # pointage facial FERMÉ
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)   # enrôlement du pilote OUVERT
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 0)
    engine_module.set_engine(FakeFaceEngine())
    yield
    engine_module.set_engine(None)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db, society=SOC):
    site = Site(name=f"PILOTE {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.flush()
    return site


def _employee(db, site, *, society=SOC, status="actif"):
    emp = Employee(code=f"PL{_tag()}", first_name="Agent", last_name=f"Pilote{_tag()}", society=society, status=status, position="Magasinier")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


def _photo(db, emp, *faces, noise=1):
    """Photo DRH de la fiche (image simulée) ; aucun visage ⇒ photo sans visage."""
    from app.core.photo_storage import PHOTOS_DIR, ensure_upload_dirs
    ensure_upload_dirs()
    path = PHOTOS_DIR / f"{emp.code}-{_tag()}.jpg"
    path.write_bytes(frame(*faces, noise=noise))
    emp.extra = {"photo": f"/uploads/photos/{path.name}"}
    db.commit()
    return path


def _consent(client, h, emp, **over):
    body = {"status": "contract_confirmed", "source": "EMPLOYMENT_CONTRACT", "proof_reference": "Contrat CDD art. 12",
            "notice_version": service.NOTICE_VERSION, **over}
    return client.post(f"/api/biometrics/employees/{emp.id}/consent", headers=h, json=body)


def _camera(client, h, site, *, usage="ATTENDANCE_AND_ENROLLMENT", adapter="DAHUA", facial=False):
    model = client.post("/api/biometrics/camera-models", headers=h, json={
        "manufacturer": "DAHUA" if adapter == "DAHUA" else "Terminal", "model": f"Réf {_tag()}", "adapter": adapter}).json()
    r = client.post("/api/biometrics/cameras", headers=h, json={
        "name": f"CAM-{_tag()}", "camera_model_id": model["id"], "site_id": site.id, "host": "10.0.0.20" if adapter == "DAHUA" else "terminal",
        "usage": usage, "role": "ENTRY", "facial_attendance_enabled": facial})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _sees(*faces_):
    CAPTURE["frames"] = [frame(*faces_) for _ in range(3)]


def _preview(client, h, emp, body):
    return client.post(f"/api/biometrics/employees/{emp.id}/enrollment/preview", headers=h, json=body)


def _confirm(client, h, emp, token, justification=None, confirm=True):
    return client.post(f"/api/biometrics/employees/{emp.id}/enrollment/confirm", headers=h,
                       json={"token": token, "confirm": confirm, "justification": justification})


def _user(client, db, *, sites, features, societies=(SOC,), modules=("pointage",)):
    name = f"pl{_tag()}"
    user = User(username=name, full_name=name, role="ops", access_level="H3", authorized_societies=list(societies),
                authorized_sites=list(sites), authorized_modules=list(modules), password_hash=hash_password("plpass1234"), is_active=True)
    db.add(user); db.flush()
    for feature, action in features:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance", feature_key=feature, action_key=action))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "plpass1234"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _active(db, emp):
    db.expire_all()
    return db.execute(select(BiometricTemplate).where(BiometricTemplate.employee_id == emp.id, BiometricTemplate.status == "ACTIVE")).scalars().all()


def _pilot_enrolled(client, h, db, who=None):
    who = who or f"W-{_tag()}"
    site = _site(db); emp = _employee(db, site); _photo(db, emp, face(who)); _consent(client, h, emp)
    cam = _camera(client, h, site)
    _sees(face(who))
    preview = _preview(client, h, emp, {"camera_id": cam}).json()
    assert preview["comparison"]["result"] == "MATCH", preview
    assert _confirm(client, h, emp, preview["token"]).status_code == 200
    return site, emp, cam, who


# ── Flags : enrôler le pilote SANS ouvrir le pointage facial ─────────────────────────────
def test_enrollment_flag_is_independent_from_facial_attendance(client, auth_headers, db, monkeypatch):
    site, emp, cam, who = _pilot_enrolled(client, auth_headers, db)
    assert len(_active(db, emp)) == 1
    # Pointage facial toujours fermé (BIOMETRIC_ENABLED=false) : 503, aucun événement.
    assert client.patch(f"/api/biometrics/cameras/{cam}", headers=auth_headers, json={"facial_attendance_enabled": True}).status_code == 200
    _sees(face(who))
    assert client.post(f"/api/biometrics/cameras/{cam}/recognize", headers=auth_headers, json={}).status_code == 503
    assert db.execute(select(func.count()).select_from(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id)).scalar_one() == 0
    # Les deux flags coupés : plus d'enrôlement non plus.
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", False)
    assert _preview(client, auth_headers, emp, {}).status_code == 503
    status = client.get("/api/biometrics/status", headers=auth_headers).json()
    assert (status["enabled"], status["enrollment_enabled"]) == (False, False)


def test_legacy_one_shot_enrollment_is_gone(client, auth_headers, db):
    site = _site(db); emp = _employee(db, site); _photo(db, emp, face("LEGACY")); _consent(client, auth_headers, emp)
    r = client.post(f"/api/biometrics/employees/{emp.id}/enroll", headers=auth_headers, json={})
    assert r.status_code == 410 and r.json()["detail"]["code"] == "SUPERVISED_ENROLLMENT_REQUIRED"
    assert _active(db, emp) == []


def test_fail_closed_without_key_or_engine(client, auth_headers, db, monkeypatch):
    site = _site(db); emp = _employee(db, site); _photo(db, emp, face("FC")); _consent(client, auth_headers, emp)
    monkeypatch.setattr(settings, "biometric_template_key", "")
    assert _preview(client, auth_headers, emp, {}).status_code == 503
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "biometric_models_dir", "/nonexistent")
    engine_module.set_engine(None)
    r = _preview(client, auth_headers, emp, {})
    assert r.status_code == 503 and "indisponible" in r.json()["detail"]


# ── Aperçu : photo DRH, comparaison 1:1, confirmation humaine ────────────────────────────
def test_photo_source_requires_a_usable_drh_photo(client, auth_headers, db):
    site = _site(db); emp = _employee(db, site); _consent(client, auth_headers, emp)
    r = _preview(client, auth_headers, emp, {})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "PHOTO_UNUSABLE"            # aucune photo
    for faces_, state in (((), "NO_FACE"), ((face("X1"), face("X2")), "MULTIPLE_FACES"), ((face("X3", sharp=5),), "QUALITY_FAILED")):
        _photo(db, emp, *faces_)
        r = _preview(client, auth_headers, emp, {})
        assert r.status_code == 422 and r.json()["detail"]["photo"]["state"] == state, (state, r.text)
    who = f"GOOD-{_tag()}"
    _photo(db, emp, face(who))
    body = _preview(client, auth_headers, emp, {}).json()
    assert (body["source"], body["photo"]["state"], body["comparison"]["result"], body["can_confirm"]) == ("EMPLOYEE_PHOTO", "OK", "NOT_APPLICABLE", True)
    assert _active(db, emp) == []                                                               # l'aperçu n'écrit rien
    r = _confirm(client, auth_headers, emp, body["token"])
    assert r.status_code == 200 and r.json()["status"] == "ACTIVE" and r.json()["source"] == "EMPLOYEE_PHOTO"


def test_camera_capture_is_compared_one_to_one_with_the_drh_photo(client, auth_headers, db):
    site = _site(db); emp = _employee(db, site); _consent(client, auth_headers, emp)
    who = f"REAL-{_tag()}"
    _photo(db, emp, face(who))
    cam = _camera(client, auth_headers, site)
    # Bon employé : MATCH, confirmation sans justification.
    _sees(face(who))
    body = _preview(client, auth_headers, emp, {"camera_id": cam}).json()
    cmp_ = body["comparison"]
    assert cmp_["result"] == "MATCH" and cmp_["score"] >= cmp_["threshold"] + cmp_["review_margin"] and body["requires_justification"] is False
    assert body["capture"]["state"] == "OK" and body["capture"]["liveness"] >= 0.8
    # Mauvais employé devant la caméra : NO_MATCH, aucun jeton, aucune confirmation possible.
    _sees(face(f"IMPOSTOR-{_tag()}"))
    wrong = _preview(client, auth_headers, emp, {"camera_id": cam}).json()
    assert (wrong["comparison"]["result"], wrong["can_confirm"], wrong["token"]) == ("NO_MATCH", False, None)
    assert wrong["comparison"]["score"] < wrong["comparison"]["threshold"]
    # Confirmation explicite obligatoire.
    assert _confirm(client, auth_headers, emp, body["token"], confirm=False).status_code == 422
    r = _confirm(client, auth_headers, emp, body["token"])
    assert r.status_code == 200 and r.json()["comparison"] == "MATCH"
    tpl = _active(db, emp)[0]
    assert (tpl.society, tpl.site_id, tpl.source, tpl.consent_id is not None) == (SOC, site.id, "CAMERA", True)
    assert tpl.quality["comparison"] == "MATCH" and "photo" not in json.dumps(tpl.quality).lower().replace("photo_sha256", "")


def test_uncertain_or_missing_reference_requires_written_justification(client, auth_headers, db, monkeypatch):
    site = _site(db); emp = _employee(db, site); _consent(client, auth_headers, emp)
    cam = _camera(client, auth_headers, site)
    who = f"NOREF-{_tag()}"
    _sees(face(who))
    body = _preview(client, auth_headers, emp, {"camera_id": cam}).json()                        # pas de photo DRH
    assert (body["comparison"]["result"], body["requires_justification"]) == ("NO_REFERENCE", True)
    r = _confirm(client, auth_headers, emp, body["token"], justification="ok")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "JUSTIFICATION_REQUIRED"
    # Score dans la bande de revue : même exigence.
    _photo(db, emp, face(who))
    monkeypatch.setattr(service, "compare_one_to_one", lambda score, cfg: "REVIEW_REQUIRED")
    review = _preview(client, auth_headers, emp, {"camera_id": cam}).json()
    assert (review["comparison"]["result"], review["requires_justification"], review["can_confirm"]) == ("REVIEW_REQUIRED", True, True)
    assert _confirm(client, auth_headers, emp, review["token"]).status_code == 422
    r = _confirm(client, auth_headers, emp, review["token"], justification="Contrôle visuel : même personne, lunettes récentes")
    assert r.status_code == 200
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "biometrics.enroll", AuditEvent.resource_id == str(emp.id))
                       .order_by(AuditEvent.id.desc())).scalars().first()
    assert "lunettes récentes" in audit.new_state and "REVIEW_REQUIRED" in audit.new_state


@pytest.mark.parametrize("compare", [0.20, 0.38, 0.45, None])
def test_compare_one_to_one_bands(compare):
    cfg = SimpleNamespace(recognition_threshold=0.363, review_margin=0.07)
    expected = {0.20: "NO_MATCH", 0.38: "REVIEW_REQUIRED", 0.45: "MATCH", None: "NO_REFERENCE"}[compare]
    assert service.compare_one_to_one(compare, cfg) == expected


def test_token_is_bound_to_employee_operator_and_time(client, auth_headers, db, monkeypatch):
    site = _site(db); a = _employee(db, site); b = _employee(db, site)
    for emp in (a, b):
        _consent(client, auth_headers, emp)
    who = f"TOK-{_tag()}"
    _photo(db, a, face(who))
    token = _preview(client, auth_headers, a, {}).json()["token"]
    r = _confirm(client, auth_headers, b, token)                                             # autre employé
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ENROLLMENT_MISMATCH"
    other_op = _user(client, db, sites=[site.id], features=[("biometric_enrollment", "create"), ("biometric_status", "read")])
    assert _confirm(client, other_op, a, token).json()["detail"]["code"] == "ENROLLMENT_MISMATCH"   # autre opérateur
    assert _confirm(client, auth_headers, a, token[:-4] + "AAAA").json()["detail"]["code"] == "ENROLLMENT_EXPIRED"
    monkeypatch.setattr(service, "ENROLLMENT_TTL_SECONDS", -1)
    assert _confirm(client, auth_headers, a, token).json()["detail"]["code"] == "ENROLLMENT_EXPIRED"
    assert _active(db, a) == [] and _active(db, b) == []


def test_consent_inactive_employee_and_photo_changed_are_rechecked_at_confirmation(client, auth_headers, db):
    site = _site(db); emp = _employee(db, site)
    who = f"RECHK-{_tag()}"
    _photo(db, emp, face(who))
    assert _preview(client, auth_headers, emp, {}).json()["detail"]["code"] == "CONSENT_REQUIRED"
    _consent(client, auth_headers, emp)
    token = _preview(client, auth_headers, emp, {}).json()["token"]
    _consent(client, auth_headers, emp, status="withdrawn", proof_reference=None)
    assert _confirm(client, auth_headers, emp, token).json()["detail"]["code"] == "CONSENT_REQUIRED"
    _consent(client, auth_headers, emp)
    token = _preview(client, auth_headers, emp, {}).json()["token"]
    _photo(db, emp, face(who), noise=2)                                                     # photo remplacée entre-temps
    assert _confirm(client, auth_headers, emp, token).json()["detail"]["code"] == "PHOTO_CHANGED"
    token = _preview(client, auth_headers, emp, {}).json()["token"]
    emp.status = "suspendu"; db.commit()
    assert _confirm(client, auth_headers, emp, token).json()["detail"]["code"] == "EMPLOYEE_INACTIVE"
    assert _active(db, emp) == []


def test_reenrollment_replaces_and_revocation_deactivates(client, auth_headers, db):
    site, emp, cam, who = _pilot_enrolled(client, auth_headers, db)
    first = _active(db, emp)[0].id
    _sees(face(who))
    preview = _preview(client, auth_headers, emp, {"camera_id": cam}).json()
    assert _confirm(client, auth_headers, emp, preview["token"]).status_code == 200
    active = _active(db, emp)
    assert len(active) == 1 and active[0].id != first
    assert db.get(BiometricTemplate, first).status == "INACTIVE"
    _consent(client, auth_headers, emp, status="withdrawn", proof_reference=None)
    assert _active(db, emp) == []


def test_no_frame_or_image_is_stored(client, auth_headers, db):
    site, emp, cam, who = _pilot_enrolled(client, auth_headers, db)
    tpl = _active(db, emp)[0]
    stored = json.dumps(tpl.quality)
    assert "data:image" not in stored and "base64" not in stored
    for row in db.execute(select(AuditEvent).where(AuditEvent.resource_id == str(emp.id))).scalars():
        assert "data:image" not in (row.new_state or "") and "embedding" not in (row.new_state or "")


# ── RBAC et périmètre ────────────────────────────────────────────────────────────────────
def test_enrollment_permissions_and_scope(client, auth_headers, db):
    site = _site(db); other_site = _site(db); other_soc = _site(db, OTHER)
    emp = _employee(db, site); far = _employee(db, other_site); foreign = _employee(db, other_soc, society=OTHER)
    for e in (emp, far):
        _consent(client, auth_headers, e)
    _photo(db, emp, face(f"RB-{_tag()}"))
    pointeur = _user(client, db, sites=[site.id], features=[("biometric_status", "read")])             # pointeur ordinaire
    assert _preview(client, pointeur, emp, {}).status_code == 403
    operator = _user(client, db, sites=[site.id], features=[("biometric_status", "read"), ("biometric_enrollment", "create")])
    assert _preview(client, operator, emp, {}).status_code == 200
    assert _preview(client, operator, far, {}).status_code == 404                                       # autre site
    assert _preview(client, operator, foreign, {}).status_code == 404                                   # autre société
    found = client.get("/api/biometrics/employees", headers=operator, params={"q": emp.code}).json()
    assert [e["employee_id"] for e in found] == [emp.id] and found[0]["fonction"] == "Magasinier"
    assert client.get("/api/biometrics/employees", headers=operator, params={"q": far.code}).json() == []
    assert client.get("/api/biometrics/employees", headers=operator, params={"site_id": other_site.id}).status_code == 404
    assert client.get("/api/biometrics/employees", headers=_user(client, db, sites=[site.id], features=[])).status_code == 403


# ── Pointage facial de production : activation par caméra, coupure par site ──────────────
def _recognize(client, h, cam, who):
    _sees(face(who))
    return client.post(f"/api/biometrics/cameras/{cam}/recognize", headers=h, json={})


def test_camera_must_be_explicitly_activated_and_site_kill_switch(client, auth_headers, db, monkeypatch):
    site, emp, cam, who = _pilot_enrolled(client, auth_headers, db)
    monkeypatch.setattr(settings, "biometric_enabled", True)
    r = _recognize(client, auth_headers, cam, who)
    assert r.status_code == 409 and "activation pilote" in r.json()["detail"]                 # flag global seul : refus
    assert client.patch(f"/api/biometrics/cameras/{cam}", headers=auth_headers, json={"facial_attendance_enabled": True}).status_code == 200
    r = _recognize(client, auth_headers, cam, who)
    assert r.status_code == 200 and r.json()["state"] == "ATTENDANCE_RECORDED" and r.json()["action"] == "ENTRÉE", r.text
    # Coupure immédiate du site : plus aucun pointage facial…
    off = client.post(f"/api/biometrics/sites/{site.id}/facial-disable", headers=auth_headers)
    assert off.status_code == 200 and off.json()["disabled_cameras"] == 1
    assert _recognize(client, auth_headers, cam, who).status_code == 409
    # … sans toucher au pointage manuel / QR.
    assert client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": emp.id}).status_code in (200, 201)


def test_only_server_attendance_cameras_can_be_activated(client, auth_headers, db):
    site = _site(db)
    tab = _camera(client, auth_headers, site, adapter="TERMINAL", usage="ENROLLMENT")
    assert client.patch(f"/api/biometrics/cameras/{tab}", headers=auth_headers, json={"facial_attendance_enabled": True}).status_code == 422
    enrol = _camera(client, auth_headers, site, usage="ENROLLMENT")
    assert client.patch(f"/api/biometrics/cameras/{enrol}", headers=auth_headers, json={"facial_attendance_enabled": True}).status_code == 422
    model = client.post("/api/biometrics/camera-models", headers=auth_headers, json={"manufacturer": "DAHUA", "model": f"R {_tag()}", "adapter": "DAHUA"}).json()
    r = client.post("/api/biometrics/cameras", headers=auth_headers, json={"name": f"C-{_tag()}", "camera_model_id": model["id"], "site_id": site.id,
                                                                            "host": "10.0.0.9", "usage": "ENROLLMENT", "facial_attendance_enabled": True})
    assert r.status_code == 422


def test_entry_exit_double_scan_and_audit(client, auth_headers, db, monkeypatch):
    site, emp, cam, who = _pilot_enrolled(client, auth_headers, db)
    monkeypatch.setattr(settings, "biometric_enabled", True)
    client.patch(f"/api/biometrics/cameras/{cam}", headers=auth_headers, json={"facial_attendance_enabled": True})
    # Base partagée : les identifiants de caméra peuvent être réutilisés après purge d'un autre
    # module — on ne lit que les audits créés par CE test.
    audit_mark = db.execute(select(func.max(AuditEvent.id))).scalar_one() or 0
    first = _recognize(client, auth_headers, cam, who).json()
    assert (first["state"], first["action"], first["recorded"]) == ("ATTENDANCE_RECORDED", "ENTRÉE", True)
    # Rafale / visage resté devant la caméra : aucune seconde écriture.
    again = _recognize(client, auth_headers, cam, who).json()
    assert (again["state"], again["recorded"]) == ("ALREADY_RECORDED", False)
    # Même employé plus tard (fenêtre de non-répétition écoulée) : SORTIE par la règle Attendance.
    real = service.active_config
    monkeypatch.setattr(service, "active_config", lambda db_: _NoCooldown(real(db_)))
    out = _recognize(client, auth_headers, cam, who).json()
    assert (out["state"], out["action"]) == ("ATTENDANCE_RECORDED", "SORTIE"), out
    events = db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id)).scalars().all()
    assert [e.event_type for e in events] == ["ARRIVAL", "DEPARTURE"]
    # Inconnu, et audit de chaque tentative (métadonnées seulement).
    unknown = _recognize(client, auth_headers, cam, f"STRANGER-{_tag()}").json()
    assert (unknown["state"], unknown["recorded"]) == ("UNKNOWN_FACE", False)
    audits = db.execute(select(AuditEvent).where(AuditEvent.action == "biometrics.recognize", AuditEvent.resource_id == str(cam),
                                                 AuditEvent.id > audit_mark).order_by(AuditEvent.id)).scalars().all()
    states = [json.loads(a.new_state)["state"] for a in audits]
    assert states == ["ATTENDANCE_RECORDED", "ALREADY_RECORDED", "ATTENDANCE_RECORDED", "UNKNOWN_FACE"]
    assert all("data:image" not in a.new_state and "embedding" not in a.new_state for a in audits)
    recorded = json.loads(audits[0].new_state)
    assert recorded["recorded"] is True and recorded["matricule"] == emp.code and recorded["liveness"] is not None


class _NoCooldown:
    """Configuration active identique, fenêtre de non-répétition caméra nulle."""

    def __init__(self, cfg):
        self._cfg = cfg

    def __getattr__(self, name):
        return 0 if name == "cooldown_seconds" else getattr(self._cfg, name)
