"""LOT C1 — Prise de photo distante supervisée : PC DRH → terminal de pointage → photo candidate
→ opérateur → fiche (puis LOT B). Session courte, liée à un employé, un terminal et un opérateur ;
terminal authentifié par sa signature ; aucune vidéo ; aucun gabarit ni pointage créé ici.
Le terminal est simulé par une vraie clé ECDSA P-256 qui signe chaque requête."""
import base64
import dataclasses
import io
import json
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core import rate_limit
from app.core.config import settings
from app.core.security import hash_password
from app.modules.attendance.models import AttendanceEvent
from app.modules.auth.models import AuditEvent, User
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics import remote_capture
from app.modules.biometrics.models import BiometricPhotoSync, BiometricRemoteCaptureSession, BiometricTemplate, BiometricTerminal
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.biometric_fakes import face, frame
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics import TEST_KEY
from tests.test_biometrics_terminals import _enrolled, _terminal, burst
from tests.biometric_fakes import FakeFaceEngine
from tests.test_biometrics_test_mode import png
from tests.test_remote_capture_framing import face_for_head

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"
DRH = "/api/drh"
SIDE = 480                                    # le terminal envoie le CARRÉ du cercle de capture
SAFE_R = 0.90 * SIDE / 2
CENTRED = face_for_head(SIDE / 2, SIDE / 2, 1.3 * SAFE_R)


class FramingEngine(FakeFaceEngine):
    """Moteur simulé : visage décrit dans le PNG, boîte du visage pilotable (`box`), centrée par
    défaut ; dimensions = celles de l'image réellement reçue."""

    def analyze(self, image):
        from PIL import Image
        try:
            with Image.open(io.BytesIO(image)) as im:
                payload, size = im.text["fake"], im.size
        except Exception:
            raise ValueError("Image illisible") from None
        data = json.loads(payload)
        out = super().analyze(payload.encode())
        faces = [dataclasses.replace(obs, bbox=tuple(spec.get("box") or CENTRED)) for obs, spec in zip(out.faces, data["faces"])]
        return dataclasses.replace(out, width=size[0], height=size[1], faces=faces)


@pytest.fixture(autouse=True)
def lot_c1(monkeypatch):
    monkeypatch.setattr(settings, "biometric_enabled", False)                        # pointage facial FERMÉ
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "drh_remote_photo_capture_enabled", True)
    monkeypatch.setattr(settings, "drh_facial_reference_auto_sync_enabled", False)
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 0)
    engine_module.set_engine(FramingEngine())
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()
    yield
    engine_module.set_engine(None)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db, society=SOC):
    site = Site(name=f"C1 {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.commit()
    return site


def _employee(db, site, *, society=SOC):
    emp = Employee(code=f"C1{_tag()}", first_name="Karim", last_name=f"Photo{_tag()}", society=society, status="actif")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


def _login(client, db, *, modules=("drh",), societies=(SOC,), actions=None):
    name = f"C1U{uuid.uuid4().int % 10**6:06d}"
    db.add(User(username=name, full_name=name, role="agent", access_level="H2", password_hash=hash_password("lot-c1-pass-1"), is_active=True,
                authorized_modules=list(modules), authorized_societies=list(societies), authorized_actions=list(actions or [])))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "lot-c1-pass-1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def drh(client, db):
    return _login(client, db)


def _photo(*faces, size=(SIDE, SIDE)):
    return base64.b64encode(png(frame(*faces), size=size)).decode()


def boxed(who, cx, cy, head_h, **kw):
    """Visage dont la TÊTE estimée est centrée en (cx, cy), de hauteur head_h (pixels du carré)."""
    return {**face(who, **kw), "box": list(face_for_head(cx, cy, head_h))}


def _poll(client, device):
    r = device.call(client, "GET", "/terminal/command")
    assert r.status_code == 200, r.text
    return r.json()


def _start(client, h, emp, terminal_id):
    return client.put(f"{DRH}/employees/{emp.id}/remote-photo/session", headers=h, json={"terminal_id": terminal_id})


def _status(client, h, sid):
    return client.get(f"{DRH}/remote-photo/sessions/{sid}", headers=h)


def _decide(client, h, sid, action):
    return client.patch(f"{DRH}/remote-photo/sessions/{sid}", headers=h, json={"action": action})


def _row(db, sid):
    db.expire_all()
    return db.execute(select(BiometricRemoteCaptureSession).where(BiometricRemoteCaptureSession.public_id == sid)).scalar_one()


def _audits(db, emp):
    db.expire_all()
    return db.execute(select(AuditEvent).where(AuditEvent.resource_id == str(emp.id), AuditEvent.action.like("drh.remote_photo.%"))
                      .order_by(AuditEvent.id)).scalars().all()


@pytest.fixture
def setup(client, db, auth_headers, drh):
    """Un site, un employé, une tablette associée et EN LIGNE (elle vient d'interroger le serveur)."""
    site = _site(db)
    emp = _employee(db, site)
    terminal_id, device = _terminal(client, auth_headers, site, activate=False)
    assert _poll(client, device) == {"command": None, "poll_ms": 2000, "enabled": True}
    return {"site": site, "emp": emp, "terminal_id": terminal_id, "device": device, "h": drh}


def _capture(client, device, sid, *faces):
    ack = device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid})
    assert ack.status_code == 200, ack.text
    return device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": ack.json()["nonce"], "photo": _photo(*faces)})


# ── Réglage désactivé : rien ne change ────────────────────────────────────────────────────
def test_flag_off_offers_nothing_and_commands_nothing(client, db, auth_headers, drh, monkeypatch):
    site = _site(db); emp = _employee(db, site)
    terminal_id, device = _terminal(client, auth_headers, site, activate=False)
    monkeypatch.setattr(settings, "drh_remote_photo_capture_enabled", False)
    from app.core.config import Settings
    assert Settings.model_fields["drh_remote_photo_capture_enabled"].default is False
    assert client.get(f"{DRH}/employees/{emp.id}/remote-photo/terminals", headers=drh).json() == {"enabled": False, "terminals": []}
    r = _start(client, drh, emp, terminal_id)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "REMOTE_CAPTURE_DISABLED"
    assert _poll(client, device) == {"command": None, "enabled": False, "poll_ms": 2000}
    assert device.session(client).json()["remote_capture"] == {"enabled": False, "poll_ms": 2000}
    assert device.call(client, "POST", "/terminal/capture/ack", {"session_id": "x"}).status_code == 503
    assert db.execute(select(func.count()).select_from(BiometricRemoteCaptureSession).where(
        BiometricRemoteCaptureSession.employee_id == emp.id)).scalar_one() == 0
    # Sans clé de chiffrement, la prise distante est indisponible même si le réglage est actif.
    monkeypatch.setattr(settings, "drh_remote_photo_capture_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", "")
    assert remote_capture.enabled() is False


# ── Liste des terminaux : autorisés, actifs, compatibles, du périmètre ; jamais de secret ──
def test_terminal_list_is_scoped_and_shows_online_state(client, db, auth_headers, drh):
    site = _site(db); emp = _employee(db, site)
    online_id, online_dev = _terminal(client, auth_headers, site, activate=False)
    offline_id, _ = _terminal(client, auth_headers, site, activate=False, terminal_type="SMARTPHONE_ANDROID")
    disabled_id, _ = _terminal(client, auth_headers, site, activate=False)
    revoked_id, _ = _terminal(client, auth_headers, site, activate=False)
    other_site = _site(db, OTHER)
    foreign_id, foreign_dev = _terminal(client, auth_headers, other_site, activate=False)
    unpaired = client.post("/api/biometrics/terminals", headers=auth_headers, json={"name": f"NP-{_tag()}", "terminal_type": "TABLET_ANDROID", "site_id": site.id}).json()
    client.patch(f"/api/biometrics/terminals/{disabled_id}", headers=auth_headers, json={"enabled": False})
    client.post(f"/api/biometrics/terminals/{revoked_id}/revoke", headers=auth_headers, json={"reason": "perdu"})
    db.add(BiometricTerminal(public_id=f"rtsp-{_tag()}", name=f"RTSP-{_tag()}", terminal_type="CAMERA_RTSP", society=SOC, site_id=site.id,
                             enabled=True, public_key={"kty": "EC"}))
    db.commit()
    _poll(client, online_dev); _poll(client, foreign_dev)
    old = db.get(BiometricTerminal, offline_id); old.last_seen_at = datetime.utcnow() - timedelta(minutes=5); db.commit()

    body = client.get(f"{DRH}/employees/{emp.id}/remote-photo/terminals", headers=drh).json()
    assert all(t["id"] not in (foreign_id, disabled_id, revoked_id, unpaired["id"]) and t["type"] in ("Tablette", "Smartphone") for t in body["terminals"])
    listed = {t["id"]: t for t in body["terminals"] if t["site"] == site.name}           # (la base de test porte d'autres sites de la société)
    assert body["enabled"] is True and set(listed) == {online_id, offline_id}
    assert (listed[online_id]["online"], listed[online_id]["type"], listed[online_id]["site"], listed[online_id]["employee_site"]) == (True, "Tablette", site.name, True)
    assert (listed[offline_id]["online"], listed[offline_id]["type"]) == (False, "Smartphone") and listed[offline_id]["last_seen_at"]
    assert body["terminals"][0]["id"] == online_id                                      # en ligne d'abord
    assert set(listed[online_id]) == {"id", "name", "type", "site", "location", "online", "busy", "last_seen_at", "employee_site"}
    dump = str(body).lower()
    assert not any(word in dump for word in ("key", "fingerprint", "nonce", "challenge", "pairing", "secret"))
    # Terminal hors ligne, d'une autre société, désactivé, révoqué, non associé : aucune commande envoyée.
    r = _start(client, drh, emp, offline_id)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "TERMINAL_OFFLINE"
    for tid in (foreign_id, disabled_id, revoked_id, unpaired["id"], 99999999, "abc", None):
        r = _start(client, drh, emp, tid)
        assert r.status_code == 404 and r.json()["detail"]["code"] == "TERMINAL_NOT_FOUND", tid
    assert db.execute(select(func.count()).select_from(BiometricRemoteCaptureSession).where(
        BiometricRemoteCaptureSession.employee_id == emp.id)).scalar_one() == 0


# ── Parcours complet : commande → prise → aperçu → reprendre → utiliser ───────────────────
def test_full_supervised_capture_flow(client, db, setup):
    emp, device, h, terminal_id = setup["emp"], setup["device"], setup["h"], setup["terminal_id"]
    extra_before = dict(db.get(Employee, emp.id).extra or {})
    started = _start(client, h, emp, terminal_id)
    assert started.status_code == 200, started.text
    sid = started.json()["session_id"]
    assert len(sid) >= 40 and started.json()["status"] == "REQUESTED" and 0 < started.json()["expires_in"] <= 120
    row = _row(db, sid)
    assert (row.employee_id, row.terminal_id, row.society, row.site_id) == (emp.id, terminal_id, SOC, setup["site"].id)

    command = _poll(client, device)
    assert command["command"] == "CAPTURE_PHOTO" and command["session_id"] == sid and command["status"] == "REQUESTED"
    assert command["employee"] == {"nom": emp.last_name, "prenom": emp.first_name}       # rien d'autre de la fiche
    assert set(command) == {"command", "session_id", "status", "attempt", "employee", "expires_in", "capture", "poll_ms", "enabled"}
    # Une photo avant la prise en compte de la commande n'est pas attendue.
    early = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": "x", "photo": _photo(face("F1"))})
    assert early.status_code == 409 and early.json()["detail"]["code"] == "CAPTURE_NOT_EXPECTED"

    ack = device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid}).json()
    assert ack["status"] == "WAITING_FOR_FACE" and ack["nonce"]
    assert _status(client, h, sid).json()["status"] == "WAITING_FOR_FACE"
    # Photo non exploitable : consigne simple, rien n'est conservé, nouveau jeton.
    bad = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": ack["nonce"], "photo": _photo()}).json()
    assert (bad["accepted"], bad["state"], bad["instruction"]) == (False, "NO_FACE", "Placez votre visage dans le cercle") and bad["nonce"]
    assert _row(db, sid).photo_encrypted is None and _row(db, sid).status == "WAITING_FOR_FACE"
    for faces, state, text in (((face("A"), face("B")), "MULTIPLE_FACES", "Une seule personne devant la caméra"),
                               ((face("S", px=20),), "TOO_FAR", "Approchez-vous"), ((face("S", sharp=5),), "BLURRED", "Restez immobile")):
        again = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": bad["nonce"], "photo": _photo(*faces)}).json()
        assert (again["accepted"], again["state"], again["instruction"]) == (False, state, text)
        assert "score" not in str(again).lower()
        bad = again
    # Jeton à usage unique : l'ancien jeton ne passe plus.
    replay = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": ack["nonce"], "photo": _photo(face("F1"))})
    assert replay.status_code == 409
    nonce = device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid}).json()["nonce"]      # terminal rechargé : idempotent
    image = _photo(face("F1"))
    good = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": nonce, "photo": image}).json()
    assert good == {"accepted": True, "state": "CAPTURED", "instruction": "Photo prise", "nonce": None}

    status = _status(client, h, sid).json()
    assert (status["status"], status["preview"], status["checks"]) == ("PREVIEW_READY", True, {"face": True, "framing": True, "quality": True})
    assert status["terminal"]["site"] == setup["site"].name and status["terminal"]["type"] == "Tablette"
    stored = _row(db, sid)
    assert stored.photo_encrypted and base64.b64decode(image) not in stored.photo_encrypted               # chiffrée au repos
    preview = client.get(f"{DRH}/remote-photo/sessions/{sid}/preview", headers=h)
    assert preview.status_code == 200 and preview.content == base64.b64decode(image) and "no-store" in preview.headers["cache-control"]
    assert _poll(client, device)["status"] == "PREVIEW_READY"                                            # terminal toujours réservé

    # Reprendre : la candidate précédente disparaît, le terminal recommence.
    retake = _decide(client, h, sid, "retake").json()
    assert (retake["status"], retake["attempt"], retake["preview"]) == ("RETAKE_REQUESTED", 1, False)
    assert _row(db, sid).photo_encrypted is None and _row(db, sid).photo_sha256 is None
    assert client.get(f"{DRH}/remote-photo/sessions/{sid}/preview", headers=h).status_code == 409
    assert _poll(client, device)["status"] == "RETAKE_REQUESTED"
    final = _photo(face("F1"))
    assert _capture(client, device, sid, face("F1")).json()["accepted"] is True
    final_bytes = client.get(f"{DRH}/remote-photo/sessions/{sid}/preview", headers=h).content

    # Utiliser cette photo : remise à l'opérateur, effacée de la session ; RIEN n'est écrit dans la fiche.
    accepted = _decide(client, h, sid, "accept").json()
    assert accepted["status"] == "ACCEPTED" and accepted["photo"] == "data:image/png;base64," + base64.b64encode(final_bytes).decode()
    closed = _row(db, sid)
    assert (closed.status, closed.photo_encrypted, closed.active_terminal_id, closed.active_employee_id, closed.nonce_hash) == ("ACCEPTED", None, None, None, None)
    assert closed.photo_sha256 and closed.closed_at
    assert _poll(client, device) == {"command": None, "poll_ms": 2000, "enabled": True}                   # retour au pointage
    assert _decide(client, h, sid, "accept").status_code == 409 and _decide(client, h, sid, "retake").status_code == 409
    assert dict(db.get(Employee, emp.id).extra or {}) == extra_before
    assert db.execute(select(func.count()).select_from(BiometricTemplate).where(BiometricTemplate.employee_id == emp.id)).scalar_one() == 0
    assert db.execute(select(func.count()).select_from(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id)).scalar_one() == 0
    events = _audits(db, emp)
    assert [e.action.rsplit(".", 1)[1] for e in events] == ["requested", "acknowledged", "captured", "retake", "acknowledged", "captured", "accepted"]
    for e in events:
        assert "base64" not in e.new_state and "iVBOR" not in e.new_state and sid not in e.new_state and len(e.new_state) < 400
        assert f'"terminal_id": {terminal_id}' in e.new_state and f'"employee_id": {emp.id}' in e.new_state and sid[:12] in e.new_state
    assert final  # (photo proposée)


# ── LOT B : la photo retenue suit le mécanisme existant, avec une provenance vérifiée ─────
def test_accepted_photo_feeds_lot_b_with_a_verified_source(client, db, setup, monkeypatch):
    monkeypatch.setattr(settings, "drh_facial_reference_auto_sync_enabled", True)
    monkeypatch.setattr(settings, "facial_reference_consent_mode", "no_objection")
    emp, device, h = setup["emp"], setup["device"], setup["h"]
    sid = _start(client, h, emp, setup["terminal_id"]).json()["session_id"]
    assert _capture(client, device, sid, face(f"LB{_tag()}")).json()["accepted"] is True
    photo = _decide(client, h, sid, "accept").json()["photo"]
    assert db.execute(select(func.count()).select_from(BiometricPhotoSync).where(BiometricPhotoSync.employee_id == emp.id)).scalar_one() == 0
    saved = client.put(f"{DRH}/employees/{emp.id}?photo_source=DRH_REMOTE_TERMINAL", headers=h, json={"extra": {"photo": photo}})
    assert saved.status_code == 200
    db.expire_all()
    sync = db.execute(select(BiometricPhotoSync).where(BiometricPhotoSync.employee_id == emp.id)).scalar_one()
    assert (sync.status, sync.source) == ("READY", "DRH_REMOTE_TERMINAL")
    assert client.get(f"{DRH}/employees/{emp.id}/facial-reference", headers=h).json()["reference"]["label"] == "Prête"
    # Provenance déclarée sans prise distante correspondante : tracée comme un import ordinaire.
    other = _employee(db, setup["site"])
    forged = "data:image/png;base64," + _photo(face(f"FG{_tag()}"))
    assert client.put(f"{DRH}/employees/{other.id}?photo_source=DRH_REMOTE_TERMINAL", headers=h, json={"extra": {"photo": forged}}).status_code == 200
    db.expire_all()
    assert db.execute(select(BiometricPhotoSync.source).where(BiometricPhotoSync.employee_id == other.id)).scalar_one() == "DRH_UPLOAD"


# ── Transitions : validées côté serveur ───────────────────────────────────────────────────
def test_transitions_are_enforced_by_the_server(client, db, setup, auth_headers):
    emp, device, h = setup["emp"], setup["device"], setup["h"]
    sid = _start(client, h, emp, setup["terminal_id"]).json()["session_id"]
    for action in ("accept", "retake"):                                                   # REQUESTED → ACCEPTED impossible
        r = _decide(client, h, sid, action)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "INVALID_TRANSITION"
    assert _decide(client, h, sid, "n'importe").status_code == 422
    assert client.get(f"{DRH}/remote-photo/sessions/{sid}/preview", headers=h).status_code == 409
    device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid})
    assert _decide(client, h, sid, "accept").status_code == 409                           # aucune photo
    # Un autre terminal ne peut ni voir ni alimenter cette session.
    _, intruder = _terminal(client, auth_headers, setup["site"], activate=False)
    assert _poll(client, intruder)["command"] is None
    assert intruder.call(client, "POST", "/terminal/capture/ack", {"session_id": sid}).status_code == 409
    assert intruder.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": "x", "photo": _photo(face("I"))}).status_code == 409
    # Un autre opérateur ne voit pas la session ; une session humaine n'est pas un terminal.
    stranger = _login(client, db)
    assert _status(client, stranger, sid).status_code == 404
    assert _decide(client, stranger, sid, "cancel").status_code == 404
    assert client.get(f"{DRH}/remote-photo/sessions/{sid}/preview", headers=stranger).status_code == 404
    assert client.get("/api/biometrics/terminal/command", headers=h).status_code == 401
    assert client.post("/api/biometrics/terminal/capture/photo", headers=h, json={"session_id": sid}).status_code == 401
    assert client.get("/api/biometrics/terminal/command").status_code == 401
    assert _status(client, h, sid).json()["status"] == "WAITING_FOR_FACE"                 # rien n'a bougé
    # Reprises bornées.
    for n in range(remote_capture.MAX_RETAKES):
        assert _capture(client, device, sid, face("T")).json()["accepted"] is True
        assert _decide(client, h, sid, "retake").status_code == 200, n
    assert _capture(client, device, sid, face("T")).json()["accepted"] is True
    assert _decide(client, h, sid, "retake").json()["detail"]["code"] == "TOO_MANY_RETAKES"
    assert _decide(client, h, sid, "cancel").json()["status"] == "CANCELLED"


# ── Concurrence : une session active par terminal et par employé ──────────────────────────
def test_one_active_session_per_terminal_and_per_employee(client, db, setup, auth_headers):
    emp, h, terminal_id = setup["emp"], setup["h"], setup["terminal_id"]
    pc_b = _login(client, db)
    first = _start(client, h, emp, terminal_id).json()["session_id"]
    other_emp = _employee(db, setup["site"])
    busy = _start(client, pc_b, other_emp, terminal_id)                                   # PC B → même tablette
    assert busy.status_code == 409 and busy.json()["detail"] == {"code": "TERMINAL_BUSY", "message": "Terminal déjà utilisé pour une prise de photo."}
    assert _status(client, h, first).json()["status"] == "REQUESTED"                      # pas d'écrasement
    listed = client.get(f"{DRH}/employees/{emp.id}/remote-photo/terminals", headers=pc_b).json()["terminals"]
    assert [t["busy"] for t in listed if t["id"] == terminal_id] == [True]
    second_id, second_dev = _terminal(client, auth_headers, setup["site"], activate=False)
    _poll(client, second_dev)
    same_emp = _start(client, pc_b, emp, second_id)                                       # même employé, autre tablette
    assert same_emp.status_code == 409 and same_emp.json()["detail"]["code"] == "EMPLOYEE_BUSY"
    # Le même opérateur relance : sa session précédente est remplacée proprement.
    again = _start(client, h, emp, second_id)
    assert again.status_code == 200
    assert (_row(db, first).status, _row(db, first).reason_code) == ("CANCELLED", "SUPERSEDED")
    assert _poll(client, setup["device"])["command"] is None and _poll(client, second_dev)["session_id"] == again.json()["session_id"]
    # Contraintes d'unicité en base (défense en profondeur).
    now = datetime.utcnow()
    db.add(BiometricRemoteCaptureSession(public_id=f"dup-{_tag()}", employee_id=other_emp.id, terminal_id=second_id, status="REQUESTED",
                                         active_terminal_id=second_id, active_employee_id=other_emp.id, expires_at=now, command_at=now))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# ── Le terminal revient toujours au pointage ──────────────────────────────────────────────
def test_cancel_expiry_and_lost_operator_always_free_the_terminal(client, db, setup):
    emp, device, h, terminal_id = setup["emp"], setup["device"], setup["h"], setup["terminal_id"]
    # Annulation depuis le PC (photo candidate supprimée).
    sid = _start(client, h, emp, terminal_id).json()["session_id"]
    assert _capture(client, device, sid, face("X1")).json()["accepted"] is True
    assert _decide(client, h, sid, "cancel").json()["status"] == "CANCELLED"
    assert _row(db, sid).photo_encrypted is None and _poll(client, device)["command"] is None
    assert _decide(client, h, sid, "cancel").json()["status"] == "CANCELLED"              # idempotent
    # Expiration : aucune capture tardive.
    sid = _start(client, h, emp, terminal_id).json()["session_id"]
    nonce = device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid}).json()["nonce"]
    row = _row(db, sid); row.expires_at = datetime.utcnow() - timedelta(seconds=1); db.commit()
    late = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": nonce, "photo": _photo(face("X2"))})
    assert late.status_code == 409 and late.json()["detail"]["code"] == "SESSION_CLOSED"
    assert _poll(client, device)["command"] is None
    expired = _status(client, h, sid).json()
    assert (expired["status"], expired["active"], expired["preview"]) == ("EXPIRED", False, False) and "expiré" in expired["message"]
    assert _decide(client, h, sid, "accept").status_code == 409
    # Photo candidate en attente à l'expiration : effacée.
    sid = _start(client, h, emp, terminal_id).json()["session_id"]
    _capture(client, device, sid, face("X3"))
    row = _row(db, sid); row.expires_at = datetime.utcnow() - timedelta(seconds=1); db.commit()
    assert client.get(f"{DRH}/remote-photo/sessions/{sid}/preview", headers=h).status_code == 409
    assert (_row(db, sid).status, _row(db, sid).photo_encrypted) == ("EXPIRED", None)
    # PC disparu (fiche fermée brutalement, navigateur planté, réseau coupé) : le terminal se libère seul.
    sid = _start(client, h, emp, terminal_id).json()["session_id"]
    device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid})
    row = _row(db, sid); row.operator_seen_at = datetime.utcnow() - timedelta(seconds=remote_capture.OPERATOR_TIMEOUT_SECONDS + 1); db.commit()
    assert _poll(client, device)["command"] is None
    assert (_row(db, sid).status, _row(db, sid).reason_code) == ("CANCELLED", "OPERATOR_GONE")
    # Terminal muet : la commande échoue vite, avec un message clair.
    sid = _start(client, h, emp, terminal_id).json()["session_id"]
    row = _row(db, sid); row.command_at = datetime.utcnow() - timedelta(seconds=remote_capture.ACK_TIMEOUT_SECONDS + 1); db.commit()
    failed = _status(client, h, sid).json()
    assert (failed["status"], failed["reason"]) == ("FAILED", "TERMINAL_UNREACHABLE") and "ne répond pas" in failed["message"]
    actions = [e.action.rsplit(".", 1)[1] for e in _audits(db, emp)]
    assert {"cancelled", "expired", "failed"} <= set(actions)


def test_revoked_or_disabled_terminal_fails_the_session(client, db, setup, auth_headers):
    emp, device, h, terminal_id = setup["emp"], setup["device"], setup["h"], setup["terminal_id"]
    sid = _start(client, h, emp, terminal_id).json()["session_id"]
    device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid})
    client.patch(f"/api/biometrics/terminals/{terminal_id}", headers=auth_headers, json={"enabled": False})
    assert device.call(client, "GET", "/terminal/command").status_code == 403
    assert (_status(client, h, sid).json()["status"], _row(db, sid).reason_code) == ("FAILED", "TERMINAL_DISABLED")
    client.patch(f"/api/biometrics/terminals/{terminal_id}", headers=auth_headers, json={"enabled": True})
    _poll(client, device)
    sid = _start(client, h, emp, terminal_id).json()["session_id"]
    client.post(f"/api/biometrics/terminals/{terminal_id}/revoke", headers=auth_headers, json={"reason": "volé"})
    assert device.call(client, "GET", "/terminal/command").status_code == 401
    assert device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid}).status_code == 401
    assert _status(client, h, sid).json()["status"] == "FAILED"


# ── Terminal réservé : aucun pointage pendant la prise ; opération engagée jamais interrompue ──
def test_terminal_does_not_clock_in_while_capturing(client, db, auth_headers, drh, monkeypatch):
    monkeypatch.setattr(settings, "biometric_enabled", True)
    site = _site(db)
    worker, who = _enrolled(db, site)
    emp = _employee(db, site)
    terminal_id, device = _terminal(client, auth_headers, site, activate=True)
    _poll(client, device)
    events = lambda: db.execute(select(func.count()).select_from(AttendanceEvent).where(AttendanceEvent.employee_id == worker.id)).scalar_one()  # noqa: E731
    sid = _start(client, drh, emp, terminal_id).json()["session_id"]
    # Commande pas encore prise en compte : le pointage déjà engagé se termine normalement.
    done = device.recognize(client, burst(face(who)))
    assert done.status_code == 200 and done.json()["state"] == "ATTENDANCE_RECORDED" and events() == 1
    device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid})
    for call in (lambda: device.challenge(client), lambda: device.call(client, "POST", "/terminal/qr", {"token": "x"})):
        refused = call()
        assert refused.status_code == 409 and refused.json()["detail"]["code"] == "CAPTURE_IN_PROGRESS"
    assert events() == 1                                                                  # aucun demi-pointage
    _capture(client, device, sid, face("NEW"))
    assert device.challenge(client).status_code == 409                                    # toujours réservé pendant l'aperçu
    _decide(client, drh, sid, "cancel")
    again = device.recognize(client, burst(face(who)))
    assert again.status_code == 200 and again.json()["state"] in ("ATTENDANCE_RECORDED", "ALREADY_RECORDED")   # retour au pointage


# ── Permissions et périmètre ──────────────────────────────────────────────────────────────
def test_permissions_and_scope(client, db, setup):
    emp, terminal_id = setup["emp"], setup["terminal_id"]
    foreign = _employee(db, _site(db, OTHER), society=OTHER)
    h = setup["h"]
    assert client.get(f"{DRH}/employees/{foreign.id}/remote-photo/terminals", headers=h).status_code in (403, 404)
    assert _start(client, h, foreign, terminal_id).status_code in (403, 404)             # employé hors périmètre
    # PC du poste de sécurité (application Pointage) et comptes sans module DRH : refusés partout.
    for modules in (("pointeur",), ("pointage",), ("fac",)):
        guard = _login(client, db, modules=modules)
        assert client.get(f"{DRH}/employees/{emp.id}/remote-photo/terminals", headers=guard).status_code == 403, modules
        assert _start(client, guard, emp, terminal_id).status_code == 403, modules
    # Consultation sans droit de modification : peut voir, ne peut pas commander le terminal.
    reader = _login(client, db, actions=["read"])
    assert client.get(f"{DRH}/employees/{emp.id}/remote-photo/terminals", headers=reader).status_code == 200
    assert _start(client, reader, emp, terminal_id).status_code == 403
    assert client.put(f"{DRH}/employees/{emp.id}", headers=reader, json={"phone": "0550000000"}).status_code == 403   # même règle que la fiche
    editor = _login(client, db, actions=["read", "update"])
    sid = _start(client, editor, emp, terminal_id)
    assert sid.status_code == 200
    assert _decide(client, editor, sid.json()["session_id"], "cancel").status_code == 200
    # Anonyme.
    assert client.get(f"{DRH}/employees/{emp.id}/remote-photo/terminals").status_code == 401
    assert client.put(f"{DRH}/employees/{emp.id}/remote-photo/session", json={"terminal_id": terminal_id}).status_code == 401
    assert db.execute(select(func.count()).select_from(BiometricRemoteCaptureSession).where(
        BiometricRemoteCaptureSession.employee_id == foreign.id)).scalar_one() == 0


def test_rate_limits_and_analysis_unavailable(client, db, setup, monkeypatch):
    emp, device, h, terminal_id = setup["emp"], setup["device"], setup["h"], setup["terminal_id"]
    # Analyse indisponible : aucune prise distante (le serveur ne pourrait valider ni visage, ni cadrage, ni qualité).
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", False)
    refused = _start(client, h, emp, terminal_id)
    assert refused.status_code == 503 and refused.json()["detail"]["code"] == "FACIAL_ANALYSIS_UNAVAILABLE"
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)
    # Image invalide : refusée sans être conservée.
    sid = _start(client, h, emp, terminal_id).json()["session_id"]
    nonce = device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid}).json()["nonce"]
    junk = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": nonce, "photo": base64.b64encode(b"pas une image").decode()}).json()
    assert (junk["accepted"], junk["state"]) == (False, "INVALID_IMAGE") and _row(db, sid).photo_encrypted is None
    # Débit borné par terminal et par opérateur.
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()
    codes = []
    nonce = junk["nonce"]
    for _ in range(remote_capture.MAX_SUBMISSIONS_PER_MINUTE + 1):
        r = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": nonce, "photo": _photo()})
        codes.append(r.status_code)
        nonce = r.json().get("nonce") if r.status_code == 200 else nonce
    assert codes[-1] == 429 and set(codes[:-1]) == {200}
    _decide(client, h, sid, "cancel")
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()
    starts = []
    for _ in range(remote_capture.MAX_STARTS_PER_MINUTE + 1):
        starts.append(_start(client, h, emp, terminal_id).status_code)
    assert starts[-1] == 429 and set(starts[:-1]) == {200}


def test_no_video_no_storage_outside_the_session_and_structure():
    """Gardes structurelles : aucun flux, aucun fichier, aucune écriture de gabarit ou de pointage."""
    root = Path(__file__).resolve().parents[1]
    source = (root / "app/modules/biometrics/remote_capture.py").read_text(encoding="utf-8")
    for forbidden in ("StreamingResponse", "WebSocket", "write_bytes", "open(", "record_scan", "match_and_record", "_store_template",
                      "encrypt_vector", "save_base64_photo", "PHOTOS_DIR"):
        assert forbidden not in source, forbidden
    pointeur = (root / "app/static/pointeur.html").read_text(encoding="utf-8")
    assert "remote-photo" not in pointeur                                                # jamais depuis le poste de sécurité


def test_migration_is_additive_reversible_and_enforces_one_active_session(tmp_path):
    import os
    import sqlite3
    import subprocess
    import sys

    repo = Path(__file__).resolve().parents[1]
    database = tmp_path / "lot_c1.sqlite"
    env = {**os.environ, "APP_ENV": "test", "DATABASE_URL": f"sqlite:///{database}", "JWT_SECRET": "lot-c1-migration-test-secret"}

    def alembic(*args):
        return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=repo, env=env, capture_output=True, text=True, check=False)

    assert alembic("upgrade", "20261002_0001").returncode == 0
    con = sqlite3.connect(database)
    tables = lambda: {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}  # noqa: E731
    existing = tables()
    up = alembic("upgrade", "20261003_0001")
    assert up.returncode == 0, up.stderr
    assert tables() - existing == {"biometric_remote_capture_sessions"}
    assert con.execute("SELECT COUNT(*) FROM biometric_remote_capture_sessions").fetchone()[0] == 0
    con.execute("INSERT INTO employees (id, code, first_name, last_name, society, status, children_count, salary_net, locked, created_at) "
                "VALUES (5, 'C1M05', 'A', 'B', 'SOC', 'actif', 0, 0, 1, '2026-09-01')")
    con.execute("INSERT INTO sites (id, name, contractual_staff, day_staff, night_staff, weekend_staff, holiday_staff, groups_count, active, created_at) "
                "VALUES (3, 'Site C1', 0, 0, 0, 0, 0, 0, 1, '2026-09-01')")
    con.execute("INSERT INTO biometric_terminals (id, public_id, name, terminal_type, society, site_id, enabled, facial_attendance_enabled, config_version, created_at) "
                "VALUES (7, 'pub7', 'T7', 'TABLET_ANDROID', 'SOC', 3, 1, 0, 1, '2026-09-01')")
    insert = ("INSERT INTO biometric_remote_capture_sessions (public_id, employee_id, terminal_id, status, attempt, active_terminal_id, active_employee_id, "
              "expires_at, command_at, created_at) VALUES (?, 5, 7, ?, 0, ?, ?, '2026-10-03', '2026-10-03', '2026-10-03')")
    con.execute(insert, ("s1", "REQUESTED", 7, 5))
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(insert, ("s2", "REQUESTED", 7, None))                                 # second actif sur le même terminal
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(insert, ("s3", "REQUESTED", None, 5))                                 # second actif pour le même employé
    con.execute(insert, ("s4", "CANCELLED", None, None)); con.execute(insert, ("s5", "EXPIRED", None, None))   # closes : sans limite
    con.commit(); con.close()
    down = alembic("downgrade", "20261002_0001")
    assert down.returncode == 0, down.stderr
    con = sqlite3.connect(database)
    assert {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")} == existing
    con.close()
    assert alembic("upgrade", "20261003_0001").returncode == 0


# ── Correctif C1 : cadrage strict, carré du cercle uniquement, contrôle sans stockage ─────
@pytest.mark.parametrize("label, photo, state, instruction", [
    ("image complète de la caméra", lambda: _photo(face("FULL"), size=(1280, 720)), "NOT_CROPPED", "Restez immobile"),
    ("visage partiellement hors du cercle", lambda: _photo(boxed("P1", SIDE * 0.15, SIDE / 2, 1.3 * SAFE_R)), "TOO_RIGHT", "Déplacez-vous légèrement vers la gauche"),
    ("front coupé", lambda: _photo(boxed("P2", SIDE / 2, SIDE * 0.28, 1.3 * SAFE_R)), "TOO_HIGH", "Descendez légèrement"),
    ("menton coupé", lambda: _photo(boxed("P3", SIDE / 2, SIDE * 0.74, 1.3 * SAFE_R)), "TOO_LOW", "Montez légèrement"),
    ("trop près", lambda: _photo(boxed("P4", SIDE / 2, SIDE / 2, 2.1 * SAFE_R)), "TOO_CLOSE", "Reculez-vous"),
    ("trop loin", lambda: _photo(boxed("P5", SIDE / 2, SIDE / 2, 0.8 * SAFE_R)), "TOO_FAR", "Approchez-vous"),
])
def test_candidate_outside_the_circle_never_becomes_a_photo(client, db, setup, label, photo, state, instruction):
    emp, device, h = setup["emp"], setup["device"], setup["h"]
    sid = _start(client, h, emp, setup["terminal_id"]).json()["session_id"]
    nonce = device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid}).json()["nonce"]
    out = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": nonce, "photo": photo()}).json()
    assert (out["accepted"], out["state"], out["instruction"]) == (False, state, instruction), label
    row = _row(db, sid)
    assert (row.status, row.photo_encrypted, row.checks) == ("WAITING_FOR_FACE", None, None), label
    assert client.get(f"{DRH}/remote-photo/sessions/{sid}/preview", headers=h).status_code == 409
    assert _decide(client, h, sid, "accept").status_code == 409, "jamais « Utiliser cette photo »"
    # Bien cadré : retenu, et le PC reçoit exactement ce carré.
    good = _photo(face("OK-" + label[:4]))
    out = device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": out["nonce"], "photo": good}).json()
    assert out["accepted"] is True
    preview = client.get(f"{DRH}/remote-photo/sessions/{sid}/preview", headers=h).content
    from PIL import Image
    assert preview == base64.b64decode(good) and Image.open(io.BytesIO(preview)).size == (SIDE, SIDE)
    _decide(client, h, sid, "cancel")


def test_live_framing_check_guides_without_storing_anything(client, db, setup):
    emp, device, h = setup["emp"], setup["device"], setup["h"]
    sid = _start(client, h, emp, setup["terminal_id"]).json()["session_id"]
    check = lambda photo: device.call(client, "POST", "/terminal/capture/check", {"session_id": sid, "photo": photo})  # noqa: E731
    assert check(_photo(face("C0"))).status_code == 409                                  # pas encore pris en compte
    nonce = device.call(client, "POST", "/terminal/capture/ack", {"session_id": sid}).json()["nonce"]
    cases = [(_photo(), "NO_FACE"), (_photo(face("A"), face("B")), "MULTIPLE_FACES"), (_photo(boxed("L", SIDE * 0.85, SIDE / 2, 1.3 * SAFE_R)), "TOO_LEFT"),
             (_photo(boxed("H", SIDE / 2, SIDE * 0.25, 1.3 * SAFE_R)), "TOO_HIGH"), (_photo(face("F"), size=(640, 480)), "NOT_CROPPED"), (_photo(face("OK")), "OK")]
    for photo, state in cases:
        out = check(photo).json()
        assert (out["ok"], out["state"]) == (state == "OK", state), state
        assert out["instruction"] and "score" not in str(out).lower()
    assert check(_photo(face("OK"))).json()["instruction"] == "Position correcte — restez immobile"
    row = _row(db, sid)
    assert (row.status, row.photo_encrypted, row.photo_sha256) == ("WAITING_FOR_FACE", None, None), "aucun contrôle n'est conservé"
    # Le jeton de capture n'est pas consommé par les contrôles.
    assert device.call(client, "POST", "/terminal/capture/photo", {"session_id": sid, "nonce": nonce, "photo": _photo(face("OK"))}).json()["accepted"] is True
    assert check(_photo(face("OK"))).status_code == 409                                  # photo prise : plus de contrôle
    actions = [e.action.rsplit(".", 1)[1] for e in _audits(db, emp)]
    assert actions.count("captured") == 1


def test_unvalidated_candidate_can_never_be_used(client, db, setup):
    """Défense en profondeur : une candidate sans validation complète (ex. session ouverte avant
    le correctif) ne peut pas être utilisée."""
    emp, device, h = setup["emp"], setup["device"], setup["h"]
    sid = _start(client, h, emp, setup["terminal_id"]).json()["session_id"]
    assert _capture(client, device, sid, face("LEG")).json()["accepted"] is True
    row = _row(db, sid); row.checks = {"face": True, "quality": True}; db.commit()          # ancienne forme
    assert _status(client, h, sid).json()["checks"] == {"face": True, "quality": True}
    r = _decide(client, h, sid, "accept")
    assert r.status_code == 409 and "photo" not in r.json() and "base64" not in r.text
    assert _decide(client, h, sid, "retake").status_code == 200
