"""LOT A — DRH → Fiche de position → Photo employé : état de la référence faciale et analyse d'une
photo candidate. Lecture seule : aucun gabarit créé, remplacé ou désactivé ; ni la photo, ni
l'employé, ni Attendance Core, ni le consentement ne sont modifiés."""
import base64
import uuid
from datetime import date

import pytest
from sqlalchemy import func, select

from app.core import rate_limit
from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.modules.auth.models import AuditEvent, User
from app.modules.biometrics import crypto
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics.models import BiometricTemplate
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.biometric_fakes import _vector, face, frame
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics import TEST_KEY
from tests.test_biometrics_test_mode import FakePngEngine, png

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"


@pytest.fixture(autouse=True)
def lot_a(monkeypatch):
    monkeypatch.setattr(settings, "biometric_enabled", False)            # pointage facial FERMÉ
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    engine_module.set_engine(FakePngEngine())
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()
    yield
    engine_module.set_engine(None)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _employee(db, *, society=SOC, status="actif", with_photo=None):
    emp = Employee(code=f"FR{_tag()}", first_name="Photo", last_name=f"Ref{_tag()}", society=society, status=status)
    db.add(emp); db.flush()
    site = Site(name=f"FR {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    if with_photo is not None:
        _photo(db, emp, with_photo)
    return emp


def _photo(db, emp, who):
    from app.core.photo_storage import PHOTOS_DIR, ensure_upload_dirs
    ensure_upload_dirs()
    path = PHOTOS_DIR / f"{emp.code}-{_tag()}.jpg"
    path.write_bytes(png(frame(face(who))))
    emp.extra = {**(emp.extra or {}), "photo": f"/uploads/photos/{path.name}"}
    db.commit()
    return path


def _template(db, emp, *, status="ACTIVE", source="CAMERA", quality=None):
    row = BiometricTemplate(employee_id=emp.id, status=status, embedding_encrypted=crypto.encrypt_vector(_vector(f"T-{emp.id}", 0.0, 0)),
                            engine="fake", config_version=1, source=source, quality=quality or {})
    db.add(row); db.commit()
    return row


def _user(client, db, *, modules=("drh",), societies=(SOC,)):
    name = f"DRH{uuid.uuid4().int % 10**6:06d}"
    db.add(User(username=name, full_name=name, role="agent", access_level="H2", password_hash=hash_password("lot-a-pass-1"), is_active=True,
                authorized_modules=list(modules), authorized_societies=list(societies)))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "lot-a-pass-1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _state(client, h, emp):
    return client.get(f"/api/drh/employees/{emp.id}/facial-reference", headers=h)


def _analyze(client, h, emp, image=None, raw=None):
    photo = raw if raw is not None else "data:image/png;base64," + base64.b64encode(image).decode()
    return client.post(f"/api/drh/employees/{emp.id}/facial-reference/analyze", headers=h, json={"photo": photo})


def _counts(db):
    db.expire_all()
    return {t.name: db.execute(select(func.count()).select_from(t)).scalar_one() for t in Base.metadata.sorted_tables if t.name != "audit_events"}


# ── État : la photo et la référence sont deux choses distinctes ───────────────────────────
def test_photo_alone_never_means_ready(client, db):
    h = _user(client, db)
    without = _employee(db)
    body = _state(client, h, without).json()
    assert body["photo"] == {"available": False}
    assert (body["reference"]["state"], body["reference"]["label"]) == ("NONE", "Aucune référence disponible")
    assert "Ajoutez une photo" in body["reference"]["message"]
    with_photo = _employee(db, with_photo="PH")
    body = _state(client, h, with_photo).json()
    assert body["photo"] == {"available": True}
    assert body["reference"]["state"] == "NONE"                         # photo présente ≠ référence prête
    assert set(body) == {"employee_id", "photo", "reference", "analysis_available"}
    assert set(body["reference"]) == {"state", "label", "message"}       # aucun détail technique


def test_reference_states_ready_review_and_photo_to_update(client, db):
    h = _user(client, db)
    ready = _employee(db, with_photo="RDY"); _template(db, ready)
    assert _state(client, h, ready).json()["reference"]["label"] == "Prête"
    review = _employee(db, with_photo="RVW"); _template(db, review, status="PENDING_REVIEW")
    assert _state(client, h, review).json()["reference"] == {
        "state": "REVIEW_REQUIRED", "label": "Revue requise", "message": "Une vérification par un responsable habilité est en attente."}
    # Référence issue d'une photo remplacée depuis : à actualiser (et l'état ne modifie RIEN).
    stale = _employee(db, with_photo="OLD"); row = _template(db, stale, source="EMPLOYEE_PHOTO", quality={"photo_sha256": "0" * 64})
    assert _state(client, h, stale).json()["reference"]["state"] == "PHOTO_TO_UPDATE"
    db.refresh(row)
    assert row.status == "ACTIVE", "la lecture de l'état ne désactive jamais un gabarit"
    inactive = _employee(db, with_photo="INA"); _template(db, inactive, status="INACTIVE")
    assert _state(client, h, inactive).json()["reference"]["state"] == "NONE"
    dump = str(_state(client, h, ready).json())
    assert not any(word in dump for word in ("embedding", "gabarit", "template", "score"))


# ── Permissions et périmètre ──────────────────────────────────────────────────────────────
def test_scope_and_permissions(client, db):
    emp = _employee(db, with_photo="SC")
    foreign = _employee(db, society=OTHER, with_photo="FO")
    drh = _user(client, db)
    assert _state(client, drh, emp).status_code == 200
    assert _state(client, drh, foreign).status_code in (403, 404)                      # autre société
    assert _analyze(client, drh, foreign, png(frame(face("X")))).status_code in (403, 404)
    assert _state(client, drh, type("E", (), {"id": 99999999})()).status_code == 404
    no_module = _user(client, db, modules=("fac",))
    assert _state(client, no_module, emp).status_code == 403                           # module DRH requis
    assert _analyze(client, no_module, emp, png(frame(face("X")))).status_code == 403
    assert client.get(f"/api/drh/employees/{emp.id}/facial-reference").status_code == 401
    assert client.post(f"/api/drh/employees/{emp.id}/facial-reference/analyze", json={"photo": "x"}).status_code == 401


# ── Analyse d'une photo : verdict compréhensible, AUCUNE écriture ─────────────────────────
def test_analysis_verdicts_and_nothing_is_written(client, db):
    h = _user(client, db)
    emp = _employee(db, with_photo="AN")
    _template(db, emp)
    photo_before = dict(emp.extra)
    before = _counts(db)
    ok = _analyze(client, h, emp, png(frame(face("NEW")))).json()
    assert ok == {"usable": True, "state": "OK", "message": "Photo exploitable pour la reconnaissance faciale.", "reasons": []}
    cases = [(png(frame()), "NO_FACE"), (png(frame(face("A"), face("B"))), "MULTIPLE_FACES"), (png(frame(face("C", sharp=5))), "QUALITY_FAILED")]
    for image, state in cases:
        body = _analyze(client, h, emp, image).json()
        assert (body["usable"], body["state"]) == (False, state) and body["message"], state
    assert _analyze(client, h, emp, png(frame(face("C", sharp=5)))).json()["reasons"] == ["Image floue — restez immobile"]
    assert _counts(db) == before, "aucune table métier modifiée (gabarits, employés, présences, consentements, configuration)"
    db.refresh(emp)
    assert emp.extra == photo_before
    assert [t.status for t in db.execute(select(BiometricTemplate).where(BiometricTemplate.employee_id == emp.id)).scalars()] == ["ACTIVE"]
    audits = db.execute(select(AuditEvent).where(AuditEvent.action == "drh.photo.facial_analysis", AuditEvent.resource_id == str(emp.id))).scalars().all()
    assert len(audits) == 5 and all("base64" not in (a.new_state or "") and "iVBOR" not in (a.new_state or "") for a in audits)


def test_analysis_rejects_bad_input_and_respects_flags(client, db, monkeypatch):
    h = _user(client, db)
    emp = _employee(db)
    assert _analyze(client, h, emp, raw="bm90IGFuIGltYWdl").status_code == 422           # pas une image
    assert client.post(f"/api/drh/employees/{emp.id}/facial-reference/analyze", headers=h, json={}).status_code == 422
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", False)
    r = _analyze(client, h, emp, png(frame(face("Z"))))
    assert r.status_code == 503 and r.json()["detail"]["code"] == "FACIAL_ANALYSIS_DISABLED"
    assert _state(client, h, emp).json()["analysis_available"] is False                    # l'état reste lisible
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)
    monkeypatch.setattr(settings, "biometric_models_dir", "/nonexistent")
    engine_module.set_engine(None)
    r = _analyze(client, h, emp, png(frame(face("Z"))))
    assert r.status_code == 503 and r.json()["detail"]["code"] == "ENGINE_UNAVAILABLE"


def test_analysis_is_rate_limited(client, db):
    h = _user(client, db)
    emp = _employee(db)
    image = png(frame(face("RL")))
    codes = [_analyze(client, h, emp, image).status_code for _ in range(31)]
    assert codes[:30] == [200] * 30 and codes[30] == 429


def test_lot_a_module_has_no_write_dependency():
    """Garde structurelle : le module LOT A ne référence aucune écriture biométrique ou Attendance."""
    import ast
    from pathlib import Path
    from app.modules.biometrics import photo_reference
    source = Path(photo_reference.__file__).read_text()
    names = {n.id for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Name)} | \
            {n.attr for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Attribute)}
    forbidden = {"record_scan", "match_and_record", "recognize_and_record", "_store_template", "enrollment_confirm", "deactivate_templates",
                 "invalidate_if_photo_changed", "record_consent", "active_config", "encrypt_vector", "add", "commit", "flush", "delete"}
    assert not (names & forbidden), names & forbidden
