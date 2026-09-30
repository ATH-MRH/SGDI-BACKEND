"""Mode Test biométrique (caméra du navigateur) — reconnaissance SANS pointage.

Moteur simulé déterministe (tests/biometric_fakes.py) alimenté par de VRAIES images PNG :
la description du visage simulé voyage dans un bloc texte du PNG, ce qui laisse la
validation d'image (signature, dimensions) s'appliquer comme en production. Le vrai moteur
OpenCV est exercé à part (test_biometrics_engine_real.py)."""
import ast
import base64
import inspect
import io
import json
import math
import uuid
from datetime import date
from pathlib import Path

import pytest
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.modules.attendance.models import AttendanceEvent
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.biometrics import crypto
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics import service, test_mode
from app.modules.biometrics.models import TEMPLATE_ACTIVE, BiometricConsent, BiometricTemplate
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site
from tests.biometric_fakes import FakeFaceEngine, _vector, face, frame
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics import TEST_KEY   # même clé : la base de test est partagée

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"
URL = "/api/biometrics/test-mode/recognize"


class FakePngEngine(FakeFaceEngine):
    """Lit la description du visage simulé dans le PNG ; image illisible ⇒ ValueError,
    exactement comme le moteur OpenCV."""

    def analyze(self, image: bytes):
        try:
            payload = Image.open(io.BytesIO(image)).text["fake"]
        except Exception:
            raise ValueError("Image illisible") from None
        return super().analyze(payload.encode())


def png(raw_frame: bytes, size=(64, 48)) -> bytes:
    info = PngInfo()
    info.add_text("fake", raw_frame.decode())
    out = io.BytesIO()
    Image.new("RGB", size, (90, 90, 90)).save(out, format="PNG", pnginfo=info)
    return out.getvalue()


def b64(*images: bytes) -> list[str]:
    return [base64.b64encode(i).decode() for i in images]


def shot(*faces, noise=None) -> list[str]:
    return b64(png(frame(*faces, noise=noise)))


@pytest.fixture(autouse=True)
def test_mode_on(monkeypatch):
    # Pointage facial de production DÉSACTIVÉ : le Mode Test doit fonctionner sans lui.
    monkeypatch.setattr(settings, "biometric_enabled", False)
    monkeypatch.setattr(settings, "biometric_test_mode_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "biometric_test_mode_max_per_minute", 100_000)
    engine_module.set_engine(FakePngEngine())
    yield
    engine_module.set_engine(None)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db, society=SOC):
    site = Site(name=f"TEST-MODE {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.flush()
    return site


def _employee(db, site, *, status="actif", society=SOC, consent="contract_confirmed"):
    emp = Employee(code=f"TM{_tag()}", first_name="Agent", last_name="Test", society=society, status=status, position="Magasinier")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    if consent:
        db.add(BiometricConsent(employee_id=emp.id, status=consent, source="EMPLOYMENT_CONTRACT",
                                proof_reference="Contrat art. 12", notice_version=service.NOTICE_VERSION))
    db.commit()
    return emp


def _template(db, emp, *, who=None, vector=None, source="CAMERA", quality=None):
    row = BiometricTemplate(employee_id=emp.id, status=TEMPLATE_ACTIVE, engine="fake-engine-test", config_version=1,
                            embedding_encrypted=crypto.encrypt_vector(vector or _vector(who, 0.0, 0)),
                            source=source, quality=quality or {})
    db.add(row); db.commit()
    return row


def _enrolled(db, site, who, **kw):
    emp = _employee(db, site, **kw)
    _template(db, emp, who=who)
    return emp


def _user(client, db, *, sites=(), societies=(SOC,), features=(("biometric_admin", "validate"),), modules=("pointage",)):
    name = f"tm{_tag()}"
    user = User(username=name, full_name=name, role="ops", access_level="H3", authorized_societies=list(societies),
                authorized_sites=list(sites), authorized_modules=list(modules), password_hash=hash_password("tmpass1234"), is_active=True)
    db.add(user); db.flush()
    for feature, action in features:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance", feature_key=feature, action_key=action))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "tmpass1234"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _call(client, h, site, frames):
    return client.post(URL, headers=h, json={"site_id": site.id, "frames": frames})


def _mixed(who, cos):
    """Vecteur unitaire dont la similarité cosinus avec celui de `who` vaut exactement `cos`."""
    v = _vector(who, 0.0, 0)
    u = _vector("orthogonal-" + who, 0.0, 0)
    dot = sum(a * b for a, b in zip(u, v))
    u = [a - dot * b for a, b in zip(u, v)]
    n = math.sqrt(sum(a * a for a in u))
    u = [a / n for a in u]
    return [cos * a + math.sqrt(1 - cos * cos) * b for a, b in zip(v, u)]


# ── Activation, authentification, permission ────────────────────────────────────────────
def test_disabled_flag_and_independence_from_production(client, auth_headers, db, monkeypatch):
    site = _site(db)
    monkeypatch.setattr(settings, "biometric_test_mode_enabled", False)
    monkeypatch.setattr(settings, "biometric_enabled", True)          # production activée ne suffit pas
    r = _call(client, auth_headers, site, shot(face("A")))
    assert r.status_code == 503 and r.json()["detail"]["code"] == "TEST_MODE_DISABLED"
    monkeypatch.setattr(settings, "biometric_test_mode_enabled", True)
    monkeypatch.setattr(settings, "biometric_enabled", False)         # et le test marche sans elle
    assert _call(client, auth_headers, site, shot(face("A"))).status_code == 200
    # Production toujours fermée pendant ce temps.
    assert client.get("/api/biometrics/status", headers=auth_headers).json()["enabled"] is False


def test_engine_unavailable_is_explicit(client, auth_headers, db, monkeypatch):
    site = _site(db)
    monkeypatch.setattr(settings, "biometric_template_key", "")
    r = _call(client, auth_headers, site, shot(face("A")))
    assert r.status_code == 503 and r.json()["detail"]["code"] == "ENGINE_UNAVAILABLE"


def test_anonymous_and_missing_permissions(client, db):
    site = _site(db)
    assert client.post(URL, json={"site_id": site.id, "frames": shot(face("A"))}).status_code == 401
    no_feature = _user(client, db, features=())
    assert _call(client, no_feature, site, shot(face("A"))).status_code == 403
    enrollment_only = _user(client, db, features=(("biometric_enrollment", "create"), ("biometric_status", "read")))
    assert _call(client, enrollment_only, site, shot(face("A"))).status_code == 403
    no_module = _user(client, db, modules=("fac",))
    assert _call(client, no_module, site, shot(face("A"))).status_code == 403
    assert _call(client, _user(client, db, features=(("biometric_admin", "admin"),)), site, shot(face("A"))).status_code == 200


def test_status_endpoint_contract(client, auth_headers, db):
    body = client.get("/api/biometrics/test-mode/status", headers=auth_headers).json()
    assert body["test_mode_enabled"] is True and body["production_enabled"] is False and body["records_attendance"] is False
    assert body["permitted"] is True and body["max_frames"] == 6 and body["formats"] == ["jpeg", "png", "webp"]
    assert "RECOGNIZED" in body["states"] and "RATE_LIMITED" in body["error_codes"]
    assert client.get("/api/biometrics/test-mode/status", headers=_user(client, db, features=())).json()["permitted"] is False


# ── Résultats du pipeline ────────────────────────────────────────────────────────────────
def test_recognized_returns_only_display_data(client, auth_headers, db):
    site = _site(db)
    emp = _enrolled(db, site, "RECO")
    r = _call(client, auth_headers, site, shot(face("RECO")))
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["state"], body["mode"], body["recorded"], body["liveness"]["result"]) == ("RECOGNIZED", "TEST", False, "PASS")
    assert body["employee"] == {"employee_id": emp.id, "matricule": emp.code, "nom": "Test", "prenom": "Agent",
                                "fonction": "Magasinier", "site": site.name}
    assert body["match"]["confidence"] >= 0.99 and body["match"]["candidates"] == 1
    assert {"analysis", "matching", "upload", "validation", "total"} <= set(body["timings_ms"])
    text = json.dumps(body)
    for forbidden in ("embedding", "template", "signature", "vector"):
        assert forbidden not in text, forbidden


@pytest.mark.parametrize("faces, state, liveness", [
    ((), "NO_FACE", "NOT_EVALUATED"),
    ((face("A"), face("B")), "MULTIPLE_FACES", "NOT_EVALUATED"),
    ((face("A", sharp=5.0),), "QUALITY_FAILED", "NOT_EVALUATED"),
    ((face("A", px=40),), "QUALITY_FAILED", "NOT_EVALUATED"),
    ((face("A", live=0.10),), "LIVENESS_FAILED", "FAIL"),
    ((face("A", live=None),), "LIVENESS_FAILED", "INCONCLUSIVE"),
])
def test_capture_refusals(client, auth_headers, db, faces, state, liveness):
    site = _site(db)
    _enrolled(db, site, "A")
    body = _call(client, auth_headers, site, shot(*faces)).json()
    assert (body["state"], body["liveness"]["result"], body["employee"], body["recorded"]) == (state, liveness, None, False)


def test_frozen_image_across_frames_fails_liveness(client, auth_headers, db):
    site = _site(db)
    _enrolled(db, site, "A")
    frames = b64(*(png(frame(face("A"), noise=0.5)) for _ in range(3)))
    assert _call(client, auth_headers, site, frames).json()["state"] == "LIVENESS_FAILED"


def test_unknown_review_and_ambiguous(client, auth_headers, db):
    site = _site(db)
    _enrolled(db, site, "KNOWN")
    # Seuils de la configuration ACTIVE (d'autres tests peuvent en avoir créé une version).
    cfg = test_mode.readonly_config(db)
    body = _call(client, auth_headers, site, shot(face("STRANGER"))).json()
    assert body["state"] == "UNKNOWN_FACE" and body["employee"] is None
    assert body["match"]["confidence"] < cfg.recognition_threshold
    # Score dans la bande de revue [seuil ; seuil + marge) : nouvel essai, aucune identité.
    review_site = _site(db)
    _template(db, _employee(db, review_site), vector=_mixed("R", cfg.recognition_threshold + cfg.review_margin / 2))
    body = _call(client, auth_headers, review_site, shot(face("R"))).json()
    assert body["state"] == "REVIEW_REQUIRED" and body["employee"] is None
    # Deux candidats au-dessus du seuil, séparés de moins que la marge : AMBIGUOUS.
    amb_site = _site(db)
    high = min(0.99, cfg.recognition_threshold + cfg.review_margin + 0.2)
    _template(db, _employee(db, amb_site), vector=_mixed("AMB", high))
    _template(db, _employee(db, amb_site), vector=_mixed("AMB", high - cfg.review_margin / 3))
    body = _call(client, auth_headers, amb_site, shot(face("AMB"))).json()
    assert body["state"] == "AMBIGUOUS" and body["employee"] is None
    assert body["match"]["second_confidence"] >= cfg.recognition_threshold


def test_consent_and_inactive_employee(client, auth_headers, db):
    site = _site(db)
    emp = _enrolled(db, site, "NOCONSENT")
    db.add(BiometricConsent(employee_id=emp.id, status="withdrawn", source="HR_DOCUMENT", notice_version=service.NOTICE_VERSION))
    db.commit()
    body = _call(client, auth_headers, site, shot(face("NOCONSENT"))).json()
    assert (body["state"], body["reason_code"], body["employee"]) == ("REFUSED", "CONSENT_REQUIRED", None)
    assert _active_template(db, emp).status == TEMPLATE_ACTIVE          # rien désactivé (lecture seule)
    inactive = _enrolled(db, site, "SUSP", status="suspendu")
    body = _call(client, auth_headers, site, shot(face("SUSP"))).json()
    assert (body["state"], body["reason_code"], body["employee"]["employee_id"]) == ("REFUSED", "EMPLOYEE_INACTIVE", inactive.id)


def _active_template(db, emp):
    db.expire_all()
    return db.execute(select(BiometricTemplate).where(BiometricTemplate.employee_id == emp.id)).scalars().first()


# ── Périmètre société / site ─────────────────────────────────────────────────────────────
def test_cross_society_and_cross_site(client, db):
    site_a, site_a2, site_b = _site(db), _site(db), _site(db, OTHER)
    _enrolled(db, site_b, "B-PERSON", society=OTHER)
    _enrolled(db, site_a2, "A2-PERSON")
    society_user = _user(client, db)
    assert _call(client, society_user, site_b, shot(face("B-PERSON"))).status_code == 404      # IDOR société
    # Un visage d'une autre société ou d'un autre site n'est jamais un candidat.
    assert _call(client, society_user, site_a, shot(face("B-PERSON"))).json()["state"] == "UNKNOWN_FACE"
    assert _call(client, society_user, site_a, shot(face("A2-PERSON"))).json()["state"] == "UNKNOWN_FACE"
    site_user = _user(client, db, sites=(site_a.id,))
    assert _call(client, site_user, site_a2, shot(face("A2-PERSON"))).status_code == 404       # IDOR site
    assert _call(client, site_user, site_a, shot(face("A"))).status_code == 200
    assert client.post(URL, headers=site_user, json={"site_id": 99_999_999, "frames": shot(face("A"))}).status_code == 404


# ── Validation des images ────────────────────────────────────────────────────────────────
def _png_header(width, height):
    import struct
    import zlib
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))


@pytest.mark.parametrize("frames, status, code", [
    ([base64.b64encode(b"<html>pas une image</html>").decode()], 422, "INVALID_IMAGE"),
    (["%%%pas du base64%%%"], 422, "INVALID_IMAGE"),
    ([""], 422, "INVALID_IMAGE"),
    ([], 422, "INVALID_IMAGE"),
    (None, 422, "INVALID_IMAGE"),
    ([base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 30).decode()], 422, "INVALID_IMAGE"),       # en-tête corrompu
    ([base64.b64encode(_png_header(20000, 20000)).decode()], 413, "IMAGE_TOO_LARGE"),            # bombe de décompression
    ([base64.b64encode(b"\xff\xd8\xff" + b"\x00" * 4_000_000).decode()], 413, "IMAGE_TOO_LARGE"),
    (["data:image/jpeg;base64," + base64.b64encode(png(frame(face("A")))).decode()], 422, "INVALID_IMAGE"),  # type menteur
    ([base64.b64encode(_png_header(640, 480) + b"corrompu").decode()], 422, "INVALID_IMAGE"),     # illisible au décodage
    (shot(face("A")) * 7, 422, "INVALID_IMAGE"),
])
def test_invalid_images_are_refused(client, auth_headers, db, frames, status, code):
    site = _site(db)
    r = client.post(URL, headers=auth_headers, json={"site_id": site.id, "frames": frames})
    assert r.status_code == status, r.text
    assert r.json()["detail"]["code"] == code


def test_data_url_and_oversized_body(client, auth_headers, db):
    site = _site(db)
    _enrolled(db, site, "DATAURL")
    ok = _call(client, auth_headers, site, ["data:image/png;base64," + base64.b64encode(png(frame(face("DATAURL")))).decode()])
    assert ok.json()["state"] == "RECOGNIZED"
    big = client.post(URL, headers={**auth_headers, "Content-Type": "application/json"},
                      content=b'{"site_id": 1, "frames": ["' + b"A" * (test_mode.MAX_BODY_BYTES + 10) + b'"]}')
    assert big.status_code == 413 and big.json()["detail"]["code"] == "IMAGE_TOO_LARGE"


# ── Limitation de débit ─────────────────────────────────────────────────────────────────
def test_rate_limit(client, db, monkeypatch):
    monkeypatch.setattr(settings, "biometric_test_mode_max_per_minute", 3)
    site = _site(db)
    h = _user(client, db)
    assert [_call(client, h, site, shot(face("A"))).status_code for _ in range(3)] == [200, 200, 200]
    r = _call(client, h, site, shot(face("A")))
    assert r.status_code == 429 and r.json()["detail"]["code"] == "RATE_LIMITED"
    assert _call(client, _user(client, db), site, shot(face("A"))).status_code == 200            # limite par compte


# ── Audit sans donnée biométrique ────────────────────────────────────────────────────────
def test_audit_has_metadata_only(client, auth_headers, db):
    site = _site(db)
    emp = _enrolled(db, site, "AUDIT")
    frames = shot(face("AUDIT"))
    _call(client, auth_headers, site, frames)
    db.expire_all()
    event = db.execute(select(AuditEvent).where(AuditEvent.action == "biometrics.test_mode.recognize")
                       .order_by(AuditEvent.id.desc()).limit(1)).scalar_one()
    state = json.loads(event.new_state)
    assert state["state"] == "RECOGNIZED" and state["employee_id"] == emp.id and state["site_id"] == site.id
    assert frames[0][:40] not in event.new_state and "embedding" not in event.new_state and "template" not in event.new_state


# ── ZÉRO ÉCRITURE ────────────────────────────────────────────────────────────────────────
def _table_counts(db):
    db.expire_all()
    return {t.name: db.execute(select(func.count()).select_from(t)).scalar_one()
            for t in Base.metadata.sorted_tables if t.name != "audit_events"}


def test_one_hundred_test_recognitions_write_nothing(client, auth_headers, db):
    site = _site(db)
    known = _enrolled(db, site, "ZERO")
    no_consent = _enrolled(db, site, "ZERO-NC")
    db.add(BiometricConsent(employee_id=no_consent.id, status="withdrawn", source="HR_DOCUMENT", notice_version=service.NOTICE_VERSION))
    # Gabarit issu d'une photo depuis remplacée : ignoré par le Mode Test, JAMAIS désactivé ici.
    stale = _template(db, _employee(db, site), who="ZERO-STALE", source="EMPLOYEE_PHOTO", quality={"photo_sha256": "ancienne"})
    db.commit()
    statuses = {r.id: r.status for r in db.execute(select(BiometricTemplate)).scalars()}
    before = _table_counts(db)
    scenarios = [shot(face("ZERO")), shot(face("ZERO-NC")), shot(face("ZERO-STALE")), shot(face("NOBODY")),
                 shot(face("ZERO", live=0.1)), shot(face("ZERO"), face("NOBODY")), shot()]
    states = set()
    for i in range(100):
        r = _call(client, auth_headers, site, scenarios[i % len(scenarios)])
        assert r.status_code == 200, r.text
        states.add(r.json()["state"])
    assert {"RECOGNIZED", "REFUSED", "UNKNOWN_FACE", "LIVENESS_FAILED", "MULTIPLE_FACES", "NO_FACE"} <= states
    after = _table_counts(db)
    changed = {k: (before[k], after[k]) for k in before if before[k] != after[k]}
    assert changed == {}, changed                    # présences, événements, anomalies, gabarits, config, paie…
    assert db.execute(select(func.count()).select_from(DailyPresence).where(DailyPresence.employee_id == known.id)).scalar_one() == 0
    assert db.execute(select(func.count()).select_from(AttendanceEvent).where(AttendanceEvent.employee_id == known.id)).scalar_one() == 0
    assert {r.id: r.status for r in db.execute(select(BiometricTemplate)).scalars()} == statuses
    assert db.get(BiometricTemplate, stale.id).status == TEMPLATE_ACTIVE


def test_write_paths_are_never_reached(client, auth_headers, db, monkeypatch):
    """Garde d'exécution : toute fonction d'écriture appelée pendant un test lève."""
    from app.modules.attendance import core as attendance_core

    def boom(*a, **k):
        raise AssertionError("écriture interdite en Mode Test")
    for target, name in ((attendance_core, "record_scan"), (attendance_core, "raise_anomaly"), (service, "recognize_and_record"),
                         (service, "deactivate_templates"), (service, "invalidate_if_photo_changed"), (service, "active_config"),
                         (service, "enrollment_preview"), (service, "enrollment_confirm"), (service, "_store_template")):
        monkeypatch.setattr(target, name, boom)
    site = _site(db)
    _enrolled(db, site, "GUARD")
    for frames in (shot(face("GUARD")), shot(face("GUARD", live=0.1)), shot(face("OTHER"))):
        assert _call(client, auth_headers, site, frames).status_code == 200


def test_test_mode_code_has_no_write_dependency():
    """Garde structurelle : le module du Mode Test ne référence aucune fonction d'écriture."""
    source = Path(test_mode.__file__).read_text()
    names = {n.id for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Name)} | \
            {n.attr for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Attribute)} | \
            {a.name for n in ast.walk(ast.parse(source)) if isinstance(n, ast.ImportFrom) for a in n.names}
    modules = {n.module for n in ast.walk(ast.parse(source)) if isinstance(n, ast.ImportFrom)}
    forbidden = {"record_scan", "recognize_and_record", "raise_anomaly", "deactivate_templates", "invalidate_if_photo_changed",
                 "active_config", "enroll", "enrollment_preview", "enrollment_confirm", "_store_template", "review_duplicate", "new_config_version", "record_consent", "append_audit",
                 "add", "commit", "flush", "delete", "merge", "DailyPresence", "AttendanceEvent", "AttendanceAnomaly"}
    assert not (names & forbidden), names & forbidden
    assert not any(m and m.startswith("app.modules.attendance") for m in modules), modules
    from app.modules.biometrics import routes
    route_source = inspect.getsource(routes.test_mode_recognize)
    assert "record_scan" not in route_source and "recognize_and_record" not in route_source


# ── Protection du VRAI pointage (permanente) ─────────────────────────────────────────────
def test_production_recognition_still_refuses_browser_images(client, auth_headers, db, monkeypatch):
    """Le Mode Test n'ouvre aucune porte : /cameras/{id}/recognize ignore toute image fournie
    par le client (la caméra est lue par le serveur) et reste fermé si la production l'est."""
    from app.modules.biometrics.cameras import DahuaCameraAdapter

    site = _site(db)
    _enrolled(db, site, "PROD")
    monkeypatch.setattr(settings, "biometric_enabled", True)
    engine_module.set_engine(FakeFaceEngine())
    monkeypatch.setattr(DahuaCameraAdapter, "burst", lambda self, count=3, interval=0.25: [frame() for _ in range(3)])
    model = client.post("/api/biometrics/camera-models", headers=auth_headers,
                        json={"manufacturer": "DAHUA", "model": f"Réf {_tag()}", "adapter": "DAHUA"}).json()
    cam = client.post("/api/biometrics/cameras", headers=auth_headers, json={
        "name": f"CAM-{_tag()}", "camera_model_id": model["id"], "site_id": site.id, "host": "10.0.0.20",
        "usage": "ATTENDANCE", "role": "ENTRY"}).json()["id"]
    injected = [base64.b64encode(frame(face("PROD"))).decode() for _ in range(3)]
    # Caméra non activée pour le pilote : refus avant toute capture.
    assert client.post(f"/api/biometrics/cameras/{cam}/recognize", headers=auth_headers, json={"frames": injected}).status_code == 409
    assert client.patch(f"/api/biometrics/cameras/{cam}", headers=auth_headers, json={"facial_attendance_enabled": True}).status_code == 200
    before = db.execute(select(func.count()).select_from(AttendanceEvent)).scalar_one()
    r = client.post(f"/api/biometrics/cameras/{cam}/recognize", headers=auth_headers, json={"frames": injected})
    assert r.status_code == 200 and r.json()["state"] == "NO_FACE" and r.json()["recorded"] is False   # capture serveur, pas le client
    db.expire_all()
    assert db.execute(select(func.count()).select_from(AttendanceEvent)).scalar_one() == before
    monkeypatch.setattr(settings, "biometric_enabled", False)
    assert client.post(f"/api/biometrics/cameras/{cam}/recognize", headers=auth_headers, json={}).status_code == 503


# ── Vrai moteur (si les modèles et photos de test sont fournis) ──────────────────────────
def test_real_engine_test_mode_pipeline(client, auth_headers, db):
    """BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES (voir test_biometrics_engine_real.py) :
    gabarit calculé sur obama1, reconnaissance testée sur obama2 (même personne) et biden1."""
    import os
    pytest.importorskip("cv2")
    models, faces_dir = os.getenv("BIOMETRIC_MODELS_DIR"), os.getenv("BIOMETRIC_TEST_FACES")
    if not models or not faces_dir:
        pytest.skip("BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES non définis")
    real = engine_module.OpenCvFaceEngine(models)
    engine_module.set_engine(real)
    def photo(name):
        """Comme une capture de navigateur : JPEG réduit à 1280 px (les originaux dépassent 3 Mo)."""
        im = Image.open(Path(faces_dir) / name).convert("RGB")
        im.thumbnail((1280, 1280))
        out = io.BytesIO()
        im.save(out, format="JPEG", quality=90)
        return out.getvalue()
    site = _site(db)
    emp = _employee(db, site)
    _template(db, emp, vector=real.analyze(photo("obama1.jpg")).faces[0].embedding)
    same = _call(client, auth_headers, site, b64(photo("obama2.jpg"))).json()
    other = _call(client, auth_headers, site, b64(photo("biden1.jpg"))).json()
    print("\nREAL same:", same["state"], same["liveness"], same["match"], same["timings_ms"])
    print("REAL other:", other["state"], other["liveness"], other["match"], other["timings_ms"])
    assert same["recorded"] is False and other["recorded"] is False
    assert other["state"] != "RECOGNIZED" and other["employee"] is None
    assert same["match"] is None or same["match"]["confidence"] > other["match"]["confidence"]
    if same["state"] == "RECOGNIZED":
        assert same["employee"]["employee_id"] == emp.id
    for phase in ("decode", "detection", "embedding", "liveness", "analysis", "total"):
        assert phase in same["timings_ms"], phase
