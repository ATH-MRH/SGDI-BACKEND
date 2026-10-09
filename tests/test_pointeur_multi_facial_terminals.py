"""Pointeur — plusieurs équipements faciaux simultanés (terminaux associés + caméras lues par le
serveur). Enregistrement et appairage : Administration Système uniquement, une seule fois.
Autorisation explicite par compte (refus par défaut), périmètre Société ∩ Site revérifié à
chaque opération, un résultat par équipement, jamais deux pointages pour un même passage.

Moteur simulé déterministe ; capture serveur simulée PAR caméra ; borne simulée par une vraie
clé ECDSA P-256 (tests/test_biometrics_terminals.py)."""
import json
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.core import rate_limit
from app.core.config import settings
from app.core.security import hash_password
from app.modules.attendance import core
from app.modules.attendance.models import AttendanceEvent
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics.cameras import CameraError, DahuaCameraAdapter
from app.modules.biometrics.models import BiometricConsent, BiometricTerminal, FacialDeviceAuthorization
from app.modules.ops.models import DailyPresence
from tests.biometric_fakes import face, frame
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics import TEST_KEY
from tests.test_biometrics_terminals import OTHER, SOC, Device, _enrolled, _site, burst  # noqa: F401
from tests.test_biometrics_test_mode import FakePngEngine, png

API = "/api/biometrics"
PASSWORD = "multi-facial-1234"
SEEN: dict = {}                 # caméra → images que le serveur y « lit » (ou une CameraError)
FORBIDDEN_FIELDS = ("host", "http_port", "rtsp_port", "serial_number", "credentials", "public_key", "key_fingerprint",
                    "pairing_code", "terminal_id")


@pytest.fixture(autouse=True)
def multi(monkeypatch):
    def read(self, count=3, interval=0.25):
        seen = SEEN.get(self.camera.id)
        if isinstance(seen, Exception):
            raise seen
        return list(seen or [])

    monkeypatch.setattr(DahuaCameraAdapter, "burst", read)
    monkeypatch.setattr(settings, "biometric_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 300)      # anti-rebond de production
    engine_module.set_engine(FakePngEngine())
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()
    SEEN.clear()
    yield
    engine_module.set_engine(None)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _pointer(client, db, *, sites, societies=(SOC,), features=(("qr_scanning", "create"), ("manual_entry", "create"))):
    """Compte Pointeur standard : module pointeur, actions lire/créer, périmètre explicite."""
    name = f"ptr{_tag().lower()}"
    user = User(username=name, full_name=f"Pointeur {name}", role="pointeur", access_level="H2", authorized_modules=["pointeur"],
                authorized_actions=["read", "create"], authorized_structures=["pointage"], authorized_societies=list(societies),
                authorized_sites=[s.id for s in sites], password_hash=hash_password(PASSWORD), is_active=True)
    db.add(user); db.flush()
    for feature, action in features:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance", feature_key=feature, action_key=action))
    db.commit()
    return user, _login(client, name)


def _login(client, name):
    r = client.post("/api/auth/login", json={"username": name, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def _camera(client, h, site, *, facial=True):
    model = client.post(f"{API}/camera-models", headers=h, json={"manufacturer": "DAHUA", "model": f"Réf {_tag()}", "adapter": "DAHUA"}).json()
    r = client.post(f"{API}/cameras", headers=h, json={"name": f"CAM-{_tag()}", "camera_model_id": model["id"], "site_id": site.id,
                                                        "host": "10.0.0.20", "username": "admin", "password": "secret-cam",
                                                        "usage": "ATTENDANCE", "role": "ENTRY", "facial_attendance_enabled": facial})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _kiosk(client, h, site, *, pair=True, facial=True):
    term = client.post(f"{API}/terminals", headers=h, json={"name": f"TAB-{_tag()}", "terminal_type": "TABLET_ANDROID", "site_id": site.id})
    assert term.status_code == 200, term.text
    tid, device = term.json()["id"], Device()
    if pair:
        code = client.post(f"{API}/terminals/{tid}/pairing-code", headers=h).json()["code"]
        paired = client.post(f"{API}/terminal/pair", json={"code": code, "public_key": device.jwk, "device_label": "Galaxy Tab"})
        assert paired.status_code == 200, paired.text
        device.terminal_id = paired.json()["terminal_id"]
        if facial:
            assert client.patch(f"{API}/terminals/{tid}", headers=h, json={"facial_attendance_enabled": True}).status_code == 200
    return tid, device


def _grant(client, h, key, *users):
    return client.post(f"{API}/facial-devices/authorizations", headers=h, json={"key": key, "user_ids": [u.id for u in users]})


def _sees(cam, who):
    SEEN[cam] = [png(frame(face(who))) for _ in range(3)]


def _recognize(client, h, cam, who=None, burst_id=None):
    if who:
        _sees(cam, who)
    return client.post(f"{API}/cameras/{cam}/recognize", headers=h, json={"burst_id": burst_id or uuid.uuid4().hex})


def _list(client, h, **params):
    return client.get(f"{API}/pointer/terminals", headers=h, params=params)


def _activate(client, h, keys, **extra):
    return client.post(f"{API}/pointer/terminals/activate", headers=h, json={"keys": keys, **extra})


def _events(db, emp):
    db.expire_all()
    return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id).order_by(AttendanceEvent.id)).scalars().all()


# ── Appairage : Administration Système, une seule fois ───────────────────────────────────
def test_pairing_is_reserved_to_system_administration(client, auth_headers, db):
    site = _site(db)
    user, pointer = _pointer(client, db, sites=[site])
    manager = User(username=f"mgr{_tag().lower()}", full_name="Gestion pointage", role="ops", access_level="H3",
                   authorized_societies=[SOC], authorized_sites=[site.id], authorized_modules=["pointage"],
                   password_hash=hash_password(PASSWORD), is_active=True)
    db.add(manager); db.flush()
    db.add(UserFeaturePermission(user_id=manager.id, module_key="attendance", feature_key="biometric_admin", action_key="admin"))
    db.commit()
    manager_h = _login(client, manager.username)
    tid, _device = _kiosk(client, auth_headers, site)
    body = {"name": "TAB-X", "terminal_type": "TABLET_ANDROID", "site_id": site.id}
    for headers in (pointer, manager_h):
        assert client.post(f"{API}/terminals", headers=headers, json=body).status_code == 403
        assert client.post(f"{API}/terminals/{tid}/pairing-code", headers=headers).status_code == 403
        assert client.post(f"{API}/terminals/{tid}/revoke", headers=headers, json={"reason": "Tentative"}).status_code == 403
        assert client.get(f"{API}/facial-devices", headers=headers).status_code == 403
        assert client.post(f"{API}/facial-devices/authorizations", headers=headers,
                           json={"key": f"trm:{tid}", "user_ids": [user.id]}).status_code == 403
    # Le Pointeur ne modifie aucun réglage administratif (ni activation, ni suppression).
    assert client.patch(f"{API}/terminals/{tid}", headers=pointer, json={"facial_attendance_enabled": False}).status_code == 403
    assert client.delete(f"{API}/terminals/{tid}", headers=pointer).status_code == 403
    db.expire_all()
    term = db.get(BiometricTerminal, tid)
    assert term.public_key and term.facial_attendance_enabled and not term.revoked_at
    # Sécurité des accès × Administrer (Administration Système) : habilité sans être administrateur global.
    db.add(UserFeaturePermission(user_id=manager.id, module_key="administration", feature_key="security", action_key="admin"))
    db.commit()
    assert client.post(f"{API}/terminals/{tid}/pairing-code", headers=manager_h).status_code == 200
    assert client.get(f"{API}/facial-devices", headers=manager_h).status_code == 200


def test_pairing_is_kept_across_reconnections_and_replacement_rotates_the_key(client, auth_headers, db):
    site = _site(db)
    user, pointer = _pointer(client, db, sites=[site])
    tid, device = _kiosk(client, auth_headers, site)
    assert _grant(client, auth_headers, f"trm:{tid}", user).status_code == 200
    paired_at = db.get(BiometricTerminal, tid).paired_at
    for _ in range(3):                                   # reconnexions du Pointeur ET de la borne
        headers = _login(client, user.username)
        rows = _list(client, headers).json()["terminals"]
        assert [r["key"] for r in rows] == [f"trm:{tid}"]
        assert device.session(client).status_code == 200
    db.expire_all()
    assert db.get(BiometricTerminal, tid).paired_at == paired_at          # aucun nouvel appairage
    # Remplacement du matériel (Administration Système) : nouvelle clé, l'autorisation est conservée.
    code = client.post(f"{API}/terminals/{tid}/pairing-code", headers=auth_headers).json()["code"]
    replacement = Device()
    out = client.post(f"{API}/terminal/pair", json={"code": code, "public_key": replacement.jwk, "device_label": "Tab neuve"})
    assert out.status_code == 200
    replacement.terminal_id = out.json()["terminal_id"]
    assert replacement.session(client).status_code == 200 and device.session(client).status_code == 401
    assert [r["key"] for r in _list(client, pointer).json()["terminals"]] == [f"trm:{tid}"]


# ── Autorisations : refus par défaut, jamais au-delà du périmètre ────────────────────────
def test_pointer_sees_only_its_authorized_paired_and_active_devices(client, auth_headers, db):
    site = _site(db)
    one, one_h = _pointer(client, db, sites=[site])
    many, many_h = _pointer(client, db, sites=[site])
    nobody, nobody_h = _pointer(client, db, sites=[site])
    cam_a, cam_b = _camera(client, auth_headers, site), _camera(client, auth_headers, site)
    cam_off = _camera(client, auth_headers, site, facial=False)
    tid, _device = _kiosk(client, auth_headers, site)
    unpaired, _ = _kiosk(client, auth_headers, site, pair=False)
    assert _grant(client, auth_headers, f"cam:{cam_a}", one, many).status_code == 200
    for key in (f"cam:{cam_b}", f"cam:{cam_off}", f"trm:{tid}", f"trm:{unpaired}"):
        assert _grant(client, auth_headers, key, many).status_code == 200

    empty = _list(client, nobody_h).json()
    assert (empty["authorized_total"], empty["terminals"]) == (0, [])            # aucun terminal autorisé
    single = _list(client, one_h).json()
    assert [r["key"] for r in single["terminals"]] == [f"cam:{cam_a}"] and single["authorized_total"] == 1
    listing = _list(client, many_h).json()
    assert {r["key"] for r in listing["terminals"]} == {f"cam:{cam_a}", f"cam:{cam_b}", f"trm:{tid}"}
    assert listing["authorized_total"] == 5                                    # dont 2 indisponibles (non appairé, facial coupé)
    by_key = {r["key"]: r for r in listing["terminals"]}
    assert (by_key[f"cam:{cam_a}"]["activation"], by_key[f"cam:{cam_a}"]["remote_activation"]) == ("SERVER_CAMERA", True)
    assert (by_key[f"trm:{tid}"]["activation"], by_key[f"trm:{tid}"]["remote_activation"]) == ("AUTONOMOUS", False)
    assert all(r["site"] == site.name and r["society"] == SOC for r in listing["terminals"])
    # Aucun secret ni paramètre de connexion ne sort vers le navigateur du Pointeur.
    text = json.dumps(listing)
    assert not any(f'"{field}"' in text for field in FORBIDDEN_FIELDS) and "10.0.0.20" not in text and "secret-cam" not in text
    # Le Pointeur ne lit pas la liste d'administration des terminaux.
    assert client.get(f"{API}/terminals", headers=many_h).status_code == 403


def test_an_authorization_never_exceeds_the_account_scope(client, auth_headers, db):
    site, elsewhere, foreign = _site(db), _site(db), _site(db, OTHER)
    user, pointer = _pointer(client, db, sites=[site])
    cam, cam_elsewhere, cam_foreign = (_camera(client, auth_headers, s) for s in (site, elsewhere, foreign))
    for key in (f"cam:{cam_elsewhere}", f"cam:{cam_foreign}"):
        r = _grant(client, auth_headers, key, user)
        assert r.status_code == 422 and user.username in r.json()["detail"]
        assert user.id not in [u["id"] for u in client.get(f"{API}/facial-devices/users", headers=auth_headers, params={"key": key}).json()]
    assert user.id in [u["id"] for u in client.get(f"{API}/facial-devices/users", headers=auth_headers, params={"key": f"cam:{cam}"}).json()]
    assert _grant(client, auth_headers, f"cam:{cam}", user).status_code == 200
    # Autorisation forcée en base hors périmètre (donnée héritée) : toujours refusée à l'usage.
    db.add(FacialDeviceAuthorization(user_id=user.id, camera_id=cam_elsewhere)); db.commit()
    assert [r["key"] for r in _list(client, pointer).json()["terminals"]] == [f"cam:{cam}"]
    _sees(cam_elsewhere, "X")
    assert client.post(f"{API}/cameras/{cam_elsewhere}/recognize", headers=pointer, json={}).status_code in (403, 404)
    out = _activate(client, pointer, [f"cam:{cam}", f"cam:{cam_elsewhere}", f"cam:{cam_foreign}"]).json()["results"]
    assert [(r["status"], r["code"]) for r in out] == [("ACTIVATED", "SERVER_CAMERA"), ("REFUSED", "NOT_AUTHORIZED"), ("REFUSED", "NOT_AUTHORIZED")]


def test_unauthorized_site_and_society_are_403(client, auth_headers, db):
    site, elsewhere, foreign = _site(db), _site(db), _site(db, OTHER)
    user, pointer = _pointer(client, db, sites=[site])
    cam = _camera(client, auth_headers, site)
    assert _grant(client, auth_headers, f"cam:{cam}", user).status_code == 200
    assert _list(client, pointer, site_id=site.id).status_code == 200
    assert _list(client, pointer, site_id=elsewhere.id).status_code == 403            # site non autorisé
    assert _list(client, pointer, site_id=foreign.id).status_code == 403
    assert _list(client, pointer, society=OTHER).status_code == 403                   # société non autorisée
    assert _activate(client, pointer, [f"cam:{cam}"], site_id=elsewhere.id).status_code == 403
    assert _activate(client, pointer, [f"cam:{cam}"], society=OTHER).status_code == 403
    assert client.post(f"{API}/pointer/terminals/stop", headers=pointer, json={"keys": [f"cam:{cam}"], "site_id": foreign.id}).status_code == 403
    # Compte de la société voisine, site autorisé chez lui : la caméra d'ici reste interdite.
    _stranger, stranger_h = _pointer(client, db, sites=[foreign], societies=(OTHER,))
    _sees(cam, "X")
    assert client.post(f"{API}/cameras/{cam}/recognize", headers=stranger_h, json={}).status_code in (403, 404)
    # Caméra du périmètre mais non autorisée pour ce compte : 403 explicite, tracé.
    _colleague, colleague_h = _pointer(client, db, sites=[site])
    mark = db.execute(select(func.max(AuditEvent.id))).scalar_one() or 0
    assert client.post(f"{API}/cameras/{cam}/recognize", headers=colleague_h, json={}).status_code == 403
    assert client.get(f"{API}/cameras/{cam}/preview.jpg", headers=colleague_h).status_code == 403
    assert client.get(f"{API}/pointer/terminals/attempt", headers=colleague_h, params={"key": f"cam:{cam}", "burst_id": "b"}).status_code == 403
    assert db.execute(select(func.count(AuditEvent.id)).where(AuditEvent.id > mark, AuditEvent.action == "authorization.biometric",
                                                              AuditEvent.result == "refused")).scalar_one() >= 1


# ── Sélection multiple et activation simultanée ──────────────────────────────────────────
def test_activation_gives_one_honest_result_per_selected_device(client, auth_headers, db):
    site = _site(db)
    user, pointer = _pointer(client, db, sites=[site])
    cam_a, cam_b, cam_off = _camera(client, auth_headers, site), _camera(client, auth_headers, site), _camera(client, auth_headers, site)
    kiosk, device = _kiosk(client, auth_headers, site)
    silent, _ = _kiosk(client, auth_headers, site)
    unpaired, _ = _kiosk(client, auth_headers, site, pair=False)
    keys = [f"cam:{cam_a}", f"cam:{cam_b}", f"cam:{cam_off}", f"trm:{kiosk}", f"trm:{silent}", f"trm:{unpaired}"]
    for key in keys:
        assert _grant(client, auth_headers, key, user).status_code == 200
    assert client.patch(f"{API}/cameras/{cam_off}", headers=auth_headers, json={"facial_attendance_enabled": False}).status_code == 200
    assert device.session(client).status_code == 200                       # la borne vient de communiquer
    row = db.get(BiometricTerminal, silent); row.last_seen_at = datetime.utcnow() - timedelta(minutes=30); db.commit()
    out = _activate(client, pointer, keys + ["cam:999999", "nimporte-quoi", f"cam:{cam_a}"])
    assert out.status_code == 200
    results = {r["key"]: r for r in out.json()["results"]}
    assert len(out.json()["results"]) == 8                                 # sélection dédoublonnée, un résultat par équipement
    assert [(results[k]["status"], results[k]["code"]) for k in keys] == [
        ("ACTIVATED", "SERVER_CAMERA"), ("ACTIVATED", "SERVER_CAMERA"), ("REFUSED", "FACIAL_OFF"),
        ("MONITORED", "AUTONOMOUS"), ("MONITORED", "AUTONOMOUS_OFFLINE"), ("REFUSED", "NOT_PAIRED")]
    # Une borne autonome n'est jamais annoncée « activée » : surveillée, avec son état réel.
    assert results[f"trm:{kiosk}"]["online"] is True and results[f"trm:{silent}"]["online"] is False
    assert results["cam:999999"]["code"] == results["nimporte-quoi"]["code"] == "NOT_AUTHORIZED"
    states = {r["key"]: r["state"] for r in _list(client, pointer).json()["terminals"]}
    assert states == {f"cam:{cam_a}": "READY", f"cam:{cam_b}": "READY", f"trm:{kiosk}": "ONLINE", f"trm:{silent}": "OFFLINE"}
    # Moteur facial coupé : aucune activation simulée.
    settings.biometric_enabled = False
    off = _activate(client, pointer, [f"cam:{cam_a}", f"trm:{kiosk}"]).json()["results"]
    assert {(r["status"], r["code"]) for r in off} == {("REFUSED", "ENGINE_UNAVAILABLE")}
    assert _list(client, pointer).json()["engine"]["ready"] is False
    settings.biometric_enabled = True
    stopped = client.post(f"{API}/pointer/terminals/stop", headers=pointer, json={"keys": [f"cam:{cam_a}", "cam:999999"]})
    assert stopped.status_code == 200 and stopped.json()["stopped"] == [f"cam:{cam_a}"]
    db.expire_all()
    assert db.get(BiometricTerminal, kiosk).facial_attendance_enabled                 # arrêter la surveillance ne règle rien
    actions = {a for (a,) in db.execute(select(AuditEvent.action).where(AuditEvent.user_id == user.id))}
    assert {"biometrics.pointer.activate", "biometrics.pointer.stop"} <= actions


def test_two_cameras_run_independently_and_never_clock_the_same_person_twice(client, auth_headers, db):
    site = _site(db)
    user, pointer = _pointer(client, db, sites=[site])
    cam_a, cam_b = _camera(client, auth_headers, site), _camera(client, auth_headers, site)
    for cam in (cam_a, cam_b):
        assert _grant(client, auth_headers, f"cam:{cam}", user).status_code == 200
    (first, who1), (second, who2) = _enrolled(db, site), _enrolled(db, site)
    a = _recognize(client, pointer, cam_a, who1).json()
    b = _recognize(client, pointer, cam_b, who1).json()                        # même personne, autre caméra, même instant
    assert (a["state"], a["recorded"], b["state"], b["recorded"]) == ("ATTENDANCE_RECORDED", True, "ALREADY_RECORDED", False)
    events = _events(db, first)
    assert [e.event_type for e in events] == ["ARRIVAL"]                       # jamais ENTRÉE puis SORTIE contradictoires
    event = events[0]
    assert (event.source, event.device_id, event.site_id, event.society, event.actor_user_id) == ("FACIAL", cam_a, site.id, SOC, user.id)
    assert event.occurred_at and event.confidence and event.data["camera"]
    # Panne de la caméra A : la caméra B continue pour une autre personne.
    SEEN[cam_a] = CameraError("Caméra injoignable")
    assert client.post(f"{API}/cameras/{cam_a}/recognize", headers=pointer, json={}).status_code == 502
    c = _recognize(client, pointer, cam_b, who2).json()
    assert (c["state"], c["employee"]["matricule"]) == ("ATTENDANCE_RECORDED", second.code)
    assert len(_events(db, second)) == 1 and len(_events(db, first)) == 1
    listing = _list(client, pointer).json()
    last = {r["key"]: r["last_event"] for r in listing["terminals"]}
    assert last[f"cam:{cam_a}"]["matricule"] == first.code and last[f"cam:{cam_b}"]["matricule"] == second.code
    assert listing["last_event"]["matricule"] == second.code and listing["last_event"]["type"] == "ENTREE"
    # Chaque reconnaissance est tracée avec son équipement, son résultat et son traitement (une
    # caméra injoignable n'a rien reconnu : elle n'écrit pas une ligne d'audit par seconde).
    trail = [json.loads(s) for (s,) in db.execute(select(AuditEvent.new_state).where(
        AuditEvent.action == "biometrics.recognize", AuditEvent.user_id == user.id).order_by(AuditEvent.id))]
    assert [(t["camera_id"], t["state"], t["recorded"]) for t in trail] == [
        (cam_a, "ATTENDANCE_RECORDED", True), (cam_b, "ALREADY_RECORDED", False), (cam_b, "ATTENDANCE_RECORDED", True)]


def test_a_kiosk_and_a_camera_seeing_the_same_person_record_one_movement(client, auth_headers, db):
    site = _site(db)
    user, pointer = _pointer(client, db, sites=[site])
    cam = _camera(client, auth_headers, site)
    kiosk, device = _kiosk(client, auth_headers, site)
    for key in (f"cam:{cam}", f"trm:{kiosk}"):
        assert _grant(client, auth_headers, key, user).status_code == 200
    emp, who = _enrolled(db, site)
    first = device.recognize(client, burst(face(who))).json()
    assert first["state"] == "ATTENDANCE_RECORDED", first
    again = _recognize(client, pointer, cam, who).json()
    assert (again["state"], again["recorded"]) == ("ALREADY_RECORDED", False)
    assert [e.event_type for e in _events(db, emp)] == ["ARRIVAL"]
    listing = _list(client, pointer).json()
    assert {r["key"]: bool(r["last_event"]) for r in listing["terminals"]} == {f"trm:{kiosk}": True, f"cam:{cam}": False}


# ── Révocation, désactivation, retrait d'autorisation ────────────────────────────────────
def test_revoked_disabled_or_deauthorized_devices_are_refused_even_when_still_selected(client, auth_headers, db):
    site = _site(db)
    user, pointer = _pointer(client, db, sites=[site])
    cam, other_cam = _camera(client, auth_headers, site), _camera(client, auth_headers, site)
    kiosk, device = _kiosk(client, auth_headers, site)
    selection = [f"cam:{cam}", f"cam:{other_cam}", f"trm:{kiosk}"]
    for key in selection:
        assert _grant(client, auth_headers, key, user).status_code == 200
    emp, who = _enrolled(db, site)
    assert [r["status"] for r in _activate(client, pointer, selection).json()["results"]] == ["ACTIVATED", "ACTIVATED", "MONITORED"]
    # Révocation du terminal, coupure du facial d'une caméra, retrait de l'autorisation de l'autre.
    assert client.post(f"{API}/terminals/{kiosk}/revoke", headers=auth_headers, json={"reason": "Tablette perdue"}).status_code == 200
    assert client.patch(f"{API}/cameras/{cam}", headers=auth_headers, json={"facial_attendance_enabled": False}).status_code == 200
    assert _grant(client, auth_headers, f"cam:{other_cam}").status_code == 200
    out = {r["key"]: (r["status"], r["code"]) for r in _activate(client, pointer, selection).json()["results"]}
    assert out == {f"trm:{kiosk}": ("REFUSED", "REVOKED"), f"cam:{cam}": ("REFUSED", "FACIAL_OFF"), f"cam:{other_cam}": ("REFUSED", "NOT_AUTHORIZED")}
    assert _list(client, pointer).json()["terminals"] == []
    assert device.session(client).status_code == 401                           # la borne révoquée ne pointe plus
    assert _recognize(client, pointer, cam, who).status_code == 409            # facial coupé par l'administration
    assert _recognize(client, pointer, other_cam, who).status_code == 403      # autorisation retirée
    assert _events(db, emp) == []
    # Un terminal révoqué ne reçoit plus d'autorisation ; il reste visible (révoqué) en administration.
    assert _grant(client, auth_headers, f"trm:{kiosk}", user).status_code == 409
    admin = {r["key"]: r for r in client.get(f"{API}/facial-devices", headers=auth_headers).json()["items"]}
    assert (admin[f"trm:{kiosk}"]["status"], admin[f"cam:{cam}"]["status"]) == ("REVOKED", "ACTIVE")


def test_administration_lists_devices_with_state_pairing_and_authorized_users(client, auth_headers, db):
    site = _site(db)
    user, _pointer_h = _pointer(client, db, sites=[site])
    other, _other_h = _pointer(client, db, sites=[site])
    cam = _camera(client, auth_headers, site)
    kiosk, device = _kiosk(client, auth_headers, site)
    unpaired, _ = _kiosk(client, auth_headers, site, pair=False)
    assert _grant(client, auth_headers, f"trm:{kiosk}", user, other).status_code == 200
    assert _grant(client, auth_headers, f"cam:{cam}", user).status_code == 200            # un compte, plusieurs équipements
    assert device.session(client).status_code == 200
    payload = client.get(f"{API}/facial-devices", headers=auth_headers).json()
    rows = {r["key"]: r for r in payload["items"]}
    row = rows[f"trm:{kiosk}"]
    assert (row["status"], row["paired"], row["site"], row["society"], row["hardware"]) == ("ACTIVE", True, site.name, SOC, "Tablette Android")
    assert row["paired_at"] and row["last_communication"] and row["equipment"] == "Galaxy Tab"
    assert sorted(u["id"] for u in row["users"]) == sorted([user.id, other.id])           # un équipement, plusieurs comptes
    assert (rows[f"trm:{unpaired}"]["status"], rows[f"trm:{unpaired}"]["paired"]) == ("INACTIVE", False)
    assert [u["id"] for u in rows[f"cam:{cam}"]["users"]] == [user.id] and rows[f"cam:{cam}"]["category"] == "IP_CAMERA"
    assert not any(f'"{field}"' in json.dumps(payload) for field in ("host", "public_key", "credentials", "pairing_code_hash"))
    supported = {c["key"]: (c["supported"], c["remote_activation"]) for c in payload["categories"]}
    assert supported == {"MOBILE_KIOSK": (True, False), "IP_CAMERA": (True, True), "NETWORK_STANDALONE": (False, False), "LOCAL_CAMERA": (False, False)}
    # Remplacer la liste retire les absents ; un compte inconnu ou inactif est refusé.
    assert [u["id"] for u in _grant(client, auth_headers, f"trm:{kiosk}", other).json()["users"]] == [other.id]
    assert client.post(f"{API}/facial-devices/authorizations", headers=auth_headers, json={"key": f"cam:{cam}", "user_ids": [10**9]}).status_code == 422
    assert client.post(f"{API}/facial-devices/authorizations", headers=auth_headers, json={"key": "cam:999999", "user_ids": []}).status_code == 404
    other.is_active = False; db.commit()
    assert _grant(client, auth_headers, f"cam:{cam}", other).status_code == 422


# ── Résultat inconnu après coupure réseau : vérification de statut, jamais un faux refus ──
def test_attempt_status_tells_whether_an_interrupted_attempt_was_recorded(client, auth_headers, db):
    site = _site(db)
    user, pointer = _pointer(client, db, sites=[site])
    cam = _camera(client, auth_headers, site)
    assert _grant(client, auth_headers, f"cam:{cam}", user).status_code == 200
    emp, who = _enrolled(db, site)
    status = lambda b: client.get(f"{API}/pointer/terminals/attempt", headers=pointer, params={"key": f"cam:{cam}", "burst_id": b})  # noqa: E731
    assert status("essai-1").json()["recorded"] is False
    assert _recognize(client, pointer, cam, who, burst_id="essai-1").json()["state"] == "ATTENDANCE_RECORDED"   # réponse « perdue »
    known = status("essai-1").json()
    assert known["recorded"] is True and (known["event"]["matricule"], known["event"]["type"]) == (emp.code, "ENTREE")
    # Rejouer le même essai ne crée rien de plus.
    assert _recognize(client, pointer, cam, who, burst_id="essai-1").json()["recorded"] is False
    assert len(_events(db, emp)) == 1
    assert status("essai-2").json()["recorded"] is False
    assert client.get(f"{API}/pointer/terminals/attempt", headers=pointer, params={"key": "trm:1", "burst_id": "x"}).status_code == 404


# ── Consentement, journée clôturée : règles existantes inchangées ────────────────────────
def test_consent_and_closed_day_rules_still_apply_through_any_device(client, auth_headers, db, monkeypatch):
    site = _site(db)
    user, pointer = _pointer(client, db, sites=[site])
    cam_a, cam_b = _camera(client, auth_headers, site), _camera(client, auth_headers, site)
    for cam in (cam_a, cam_b):
        assert _grant(client, auth_headers, f"cam:{cam}", user).status_code == 200
    (withdrawn, who1), (closed, who2) = _enrolled(db, site), _enrolled(db, site)
    consent = db.execute(select(BiometricConsent).where(BiometricConsent.employee_id == withdrawn.id)).scalar_one()
    consent.status = "withdrawn"; db.commit()
    out = _recognize(client, pointer, cam_a, who1).json()
    assert (out["state"], out["recorded"]) == ("REFUSED", False) and _events(db, withdrawn) == []
    assert _recognize(client, pointer, cam_b, who1).json()["recorded"] is False          # gabarit désactivé : plus reconnu nulle part
    # Journée clôturée : aucune reconnaissance ne la rouvre ni ne la modifie.
    assert _recognize(client, pointer, cam_a, who2).json()["state"] == "ATTENDANCE_RECORDED"
    presence = db.execute(select(DailyPresence).where(DailyPresence.employee_id == closed.id)).scalar_one()
    presence.closed_at = datetime.utcnow(); db.commit()
    snapshot = (presence.arrival_time, presence.departure_time, presence.status)
    later = core._now_local() + timedelta(hours=2)
    monkeypatch.setattr(core, "_now_local", lambda: later)
    refused = _recognize(client, pointer, cam_b, who2).json()
    assert (refused["state"], refused["recorded"]) == ("REFUSED", False), refused
    db.expire_all()
    presence = db.execute(select(DailyPresence).where(DailyPresence.employee_id == closed.id)).scalar_one()
    assert (presence.arrival_time, presence.departure_time, presence.status) == snapshot and len(_events(db, closed)) == 1


# ── Régression : QR et saisie manuelle indépendants du facial ────────────────────────────
def test_manual_entry_still_works_without_any_facial_authorization(client, auth_headers, db):
    site = _site(db)
    _user, pointer = _pointer(client, db, sites=[site])
    emp, _who = _enrolled(db, site)
    assert _list(client, pointer).json()["terminals"] == []
    r = client.post("/api/portal/attendance-manual/scan", headers=pointer,
                    json={"employee_id": emp.id, "site_id": site.id, "society": SOC, "status": "present", "observation": "Badge oublié"})
    assert r.status_code in (200, 201), r.text
    events = _events(db, emp)
    assert [(e.event_type, e.source) for e in events] == [("ARRIVAL", "MANUAL")]
