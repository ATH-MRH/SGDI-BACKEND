"""Terminaux faciaux mobiles autorisés (circuit B) — association, signature de l'appareil,
défis à usage unique, anti-rejeu, fail closed, périmètre 1:N, Attendance Core, QR, coupures.

Moteur simulé déterministe (images PNG portant la description du visage, comme le Mode Test) ;
l'appareil est simulé par une vraie clé ECDSA P-256 qui signe chaque requête."""
import base64
import json
import time
import uuid
from datetime import date, datetime, timedelta

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from sqlalchemy import func, select

from app.core import rate_limit
from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.modules.attendance.models import SOURCE_FACIAL, SOURCE_QR, AttendanceEvent
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.biometrics import crypto, service, terminals
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics.models import (
    BiometricConsent,
    BiometricFrameDigest,
    BiometricTemplate,
    BiometricTerminal,
    BiometricTerminalChallenge,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.biometric_fakes import _vector, face, frame
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics import TEST_KEY   # même clé : base de test partagée
from tests.test_biometrics_test_mode import FakePngEngine, _mixed, png

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"
API = "/api/biometrics"


@pytest.fixture(autouse=True)
def facial_on(monkeypatch):
    monkeypatch.setattr(settings, "biometric_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 0)
    engine_module.set_engine(FakePngEngine())
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()
    yield
    engine_module.set_engine(None)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class Device:
    """Tablette simulée : clé P-256 propre, signature de chaque requête comme le navigateur."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        nums = self.key.public_key().public_numbers()
        self.jwk = {"kty": "EC", "crv": "P-256", "x": _b64u(nums.x.to_bytes(32, "big")), "y": _b64u(nums.y.to_bytes(32, "big"))}
        self.terminal_id = None

    def headers(self, method, path, raw, ts=None, terminal_id=None):
        ts = str(ts if ts is not None else int(time.time() * 1000))
        tid = terminal_id or self.terminal_id or ""
        der = self.key.sign(terminals.signed_message(tid, method, path, ts, raw), ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        return {"X-Atlas-Terminal": terminal_id or self.terminal_id or "", "X-Atlas-Timestamp": ts,
                "X-Atlas-Signature": _b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big")), "Content-Type": "application/json"}

    def call(self, client, method, path, body=None, **kw):
        raw = json.dumps(body).encode() if body is not None else b""
        return client.request(method, API + path, content=raw, headers=self.headers(method, API + path, raw, **kw))

    def session(self, client):
        return self.call(client, "GET", "/terminal/session")

    def challenge(self, client):
        return self.call(client, "POST", "/terminal/challenge", {})

    def recognize(self, client, frames, challenge=None):
        ch = challenge or self.challenge(client).json()
        return self.call(client, "POST", "/terminal/recognize", {"challenge_id": ch["challenge_id"], "nonce": ch["nonce"], "frames": frames})


def burst(*faces_, n=3):
    return [base64.b64encode(png(frame(*faces_))).decode() for _ in range(n)]


def _site(db, society=SOC):
    site = Site(name=f"BORNE {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.flush()
    return site


def _employee(db, site, *, society=SOC, status="actif"):
    emp = Employee(code=f"TR{_tag()}", first_name="Agent", last_name=f"Borne{_tag()}", society=society, status=status)
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


def _enrolled(db, site, who=None, vector=None, **kw):
    """Employé du site, consentement admissible, gabarit ACTIF (issu de l'enrôlement supervisé)."""
    who = who or f"W-{_tag()}"
    emp = _employee(db, site, **kw)
    consent = BiometricConsent(employee_id=emp.id, status="contract_confirmed", source="EMPLOYMENT_CONTRACT",
                               proof_reference="Contrat", notice_version=service.NOTICE_VERSION)
    db.add(consent); db.flush()
    db.add(BiometricTemplate(employee_id=emp.id, status="ACTIVE", embedding_encrypted=crypto.encrypt_vector(vector or _vector(who, 0.0, 0)),
                             engine="fake", config_version=1, source="CAMERA", quality={}, consent_id=consent.id,
                             society=emp.society, site_id=site.id))
    db.commit()
    return emp, who


def _user(client, db, *, sites, features, societies=(SOC,)):
    name = f"tr{_tag()}"
    user = User(username=name, full_name=name, role="ops", access_level="H3", authorized_societies=list(societies),
                authorized_sites=list(sites), authorized_modules=["pointage"], password_hash=hash_password("trpass1234"), is_active=True)
    db.add(user); db.flush()
    for feature, action in features:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance", feature_key=feature, action_key=action))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "trpass1234"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _terminal(client, h, site, *, activate=True, terminal_type="TABLET_ANDROID"):
    """Terminal créé par l'administrateur, associé par code à usage unique, activé."""
    r = client.post(f"{API}/terminals", headers=h, json={"name": f"TAB-{_tag()}", "terminal_type": terminal_type, "site_id": site.id})
    assert r.status_code == 200, r.text
    term = r.json()
    code = client.post(f"{API}/terminals/{term['id']}/pairing-code", headers=h).json()["code"]
    device = Device()
    paired = client.post(f"{API}/terminal/pair", json={"code": code, "public_key": device.jwk, "device_label": "Galaxy Tab test"})
    assert paired.status_code == 200, paired.text
    device.terminal_id = paired.json()["terminal_id"]
    if activate:
        assert client.patch(f"{API}/terminals/{term['id']}", headers=h, json={"facial_attendance_enabled": True}).status_code == 200
    return term["id"], device


def _events(db, emp):
    db.expire_all()
    return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id).order_by(AttendanceEvent.id)).scalars().all()


# ── Association : code aléatoire, usage unique, expiration, audit ────────────────────────
def test_pairing_code_is_single_use_expiring_and_never_stored_in_clear(client, auth_headers, db):
    site = _site(db)
    term = client.post(f"{API}/terminals", headers=auth_headers, json={"name": "TAB-A", "terminal_type": "TABLET_ANDROID", "site_id": site.id}).json()
    assert (term["paired"], term["facial_attendance_enabled"], term["enabled"], term["society"]) == (False, False, True, SOC)
    out = client.post(f"{API}/terminals/{term['id']}/pairing-code", headers=auth_headers).json()
    code = out["code"]
    assert len(code.replace("-", "")) == 10 and out["expires_in"] == 600
    row = db.get(BiometricTerminal, term["id"]); db.refresh(row)
    assert row.pairing_code_hash and code.replace("-", "") not in json.dumps({"h": row.pairing_code_hash, "m": row.meta})
    device = Device()
    assert client.post(f"{API}/terminal/pair", json={"code": code.lower(), "public_key": device.jwk}).status_code == 200
    # Usage unique : le même code ne sert plus, même avec une autre clé.
    r = client.post(f"{API}/terminal/pair", json={"code": code, "public_key": Device().jwk})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "PAIRING_CODE_INVALID"
    # Expiration.
    code2 = client.post(f"{API}/terminals/{term['id']}/pairing-code", headers=auth_headers).json()["code"]
    row = db.get(BiometricTerminal, term["id"]); db.refresh(row)
    row.pairing_expires_at = datetime.utcnow() - timedelta(seconds=1); db.commit()
    assert client.post(f"{API}/terminal/pair", json={"code": code2, "public_key": Device().jwk}).status_code == 401
    actions = {a for (a,) in db.execute(select(AuditEvent.action).where(AuditEvent.resource == "biometric_terminal",
                                                                          AuditEvent.resource_id == str(term["id"])))}
    assert {"biometrics.terminal.create", "biometrics.terminal.pairing_code", "biometrics.terminal.pair"} <= actions


def test_pairing_rejects_bad_keys_and_is_rate_limited(client, auth_headers, db):
    site = _site(db)
    term = client.post(f"{API}/terminals", headers=auth_headers, json={"name": "TAB-K", "terminal_type": "IPAD", "site_id": site.id}).json()
    code = client.post(f"{API}/terminals/{term['id']}/pairing-code", headers=auth_headers).json()["code"]
    for bad in ({"kty": "RSA"}, {**Device().jwk, "crv": "P-384"}, {**Device().jwk, "x": _b64u(b"\x01" * 32)}, {**Device().jwk, "d": "secret"}):
        r = client.post(f"{API}/terminal/pair", json={"code": code, "public_key": bad})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "INVALID_PUBLIC_KEY", bad
    for _ in range(terminals.PAIRING_MAX_FAILURES_PER_IP):
        client.post(f"{API}/terminal/pair", json={"code": "AAAAA-BBBBB", "public_key": Device().jwk})
    r = client.post(f"{API}/terminal/pair", json={"code": code, "public_key": Device().jwk})
    assert r.status_code == 429          # même le bon code, une fois la limite atteinte


def test_terminal_admin_rbac_scope_and_types(client, auth_headers, db):
    site, other = _site(db), _site(db)
    reader = _user(client, db, sites=[site.id], features=[("biometric_status", "read")])
    admin = _user(client, db, sites=[site.id], features=[("biometric_status", "read"), ("biometric_admin", "admin")])
    body = {"name": "TAB-R", "terminal_type": "TABLET_ANDROID", "site_id": site.id}
    assert client.post(f"{API}/terminals", headers=reader, json=body).status_code == 403          # pointeur ordinaire
    r = client.post(f"{API}/terminals", headers=admin, json=body)
    assert r.status_code == 200
    assert client.post(f"{API}/terminals", headers=admin, json=body).status_code == 409           # nom unique par site
    assert client.post(f"{API}/terminals", headers=admin, json={**body, "site_id": other.id}).status_code in (403, 404)
    assert client.post(f"{API}/terminals", headers=admin, json={**body, "name": "X", "terminal_type": "CAMERA_RTSP"}).status_code == 422
    assert client.post(f"{API}/terminals", headers=admin, json={**body, "name": "Y", "terminal_type": "BROWSER"}).status_code == 422
    foreign = client.post(f"{API}/terminals", headers=auth_headers, json={**body, "site_id": other.id}).json()
    assert client.patch(f"{API}/terminals/{foreign['id']}", headers=admin, json={"enabled": False}).status_code == 404
    assert [t["name"] for t in client.get(f"{API}/terminals", headers=reader).json()] == ["TAB-R"]
    # Activation du facial impossible avant association.
    assert client.patch(f"{API}/terminals/{r.json()['id']}", headers=admin, json={"facial_attendance_enabled": True}).status_code == 422


# ── Authentification de l'appareil : jamais une session utilisateur ──────────────────────
def test_device_signature_is_required_and_bound_to_body_and_time(client, auth_headers, db):
    site = _site(db)
    _, device = _terminal(client, auth_headers, site)
    assert device.session(client).status_code == 200
    path = API + "/terminal/challenge"
    # Session utilisateur (même administrateur) : refusée — un navigateur n'est pas un terminal.
    assert client.post(path, headers=auth_headers, json={}).status_code == 401
    # Terminal inconnu, autre clé, corps modifié après signature, horodatage périmé.
    assert client.post(path, content=b"{}", headers=device.headers("POST", path, b"{}", terminal_id="trm_inconnu")).status_code == 401
    assert client.post(path, content=b"{}", headers=Device().headers("POST", path, b"{}", terminal_id=device.terminal_id)).status_code == 401
    assert client.post(path, content=b'{"x":1}', headers=device.headers("POST", path, b"{}")).status_code == 401
    old = int((time.time() - terminals.SIGNATURE_SKEW_SECONDS - 5) * 1000)
    r = client.post(path, content=b"{}", headers=device.headers("POST", path, b"{}", ts=old))
    assert r.status_code == 401 and r.json()["detail"]["code"] == "TERMINAL_SIGNATURE_INVALID"
    # Signature d'une autre route rejouée ici.
    other = device.headers("GET", API + "/terminal/session", b"")
    assert client.post(path, content=b"", headers=other).status_code == 401


def test_revocation_and_disable_are_immediate(client, auth_headers, db):
    site = _site(db)
    term_id, device = _terminal(client, auth_headers, site)
    assert client.patch(f"{API}/terminals/{term_id}", headers=auth_headers, json={"enabled": False}).status_code == 200
    r = device.challenge(client)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "TERMINAL_DISABLED"
    assert client.patch(f"{API}/terminals/{term_id}", headers=auth_headers, json={"enabled": True}).status_code == 200
    assert device.challenge(client).status_code == 200
    out = client.post(f"{API}/terminals/{term_id}/revoke", headers=auth_headers, json={"reason": "Tablette perdue"}).json()
    assert (out["paired"], out["enabled"], out["facial_attendance_enabled"]) == (False, False, False)
    r = device.session(client)
    assert r.status_code == 401 and r.json()["detail"]["code"] in ("TERMINAL_UNKNOWN", "TERMINAL_REVOKED")
    assert client.post(f"{API}/terminals/{term_id}/pairing-code", headers=auth_headers).status_code == 409


def test_key_rotation_replaces_the_old_device_key(client, auth_headers, db):
    site = _site(db)
    term_id, old = _terminal(client, auth_headers, site)
    code = client.post(f"{API}/terminals/{term_id}/pairing-code", headers=auth_headers).json()["code"]
    assert old.session(client).status_code == 200        # l'ancienne clé reste valable jusqu'à la nouvelle association
    new = Device()
    new.terminal_id = client.post(f"{API}/terminal/pair", json={"code": code, "public_key": new.jwk}).json()["terminal_id"]
    assert new.terminal_id == old.terminal_id             # identifiant immuable
    assert old.session(client).status_code == 401 and new.session(client).status_code == 200


# ── Fail closed ──────────────────────────────────────────────────────────────────────────
def test_fail_closed_flags_key_engine_and_activation(client, auth_headers, db, monkeypatch):
    site = _site(db)
    emp, who = _enrolled(db, site)
    term_id, device = _terminal(client, auth_headers, site, activate=False)
    r = device.challenge(client)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "TERMINAL_FACIAL_DISABLED"
    assert device.session(client).json()["facial"]["code"] == "TERMINAL_FACIAL_DISABLED"
    client.patch(f"{API}/terminals/{term_id}", headers=auth_headers, json={"facial_attendance_enabled": True})
    ch = device.challenge(client).json()
    monkeypatch.setattr(settings, "biometric_enabled", False)
    r = device.recognize(client, burst(face(who)), challenge=ch)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "BIOMETRIC_DISABLED"
    assert device.challenge(client).status_code == 503
    assert device.session(client).json()["facial"] == {"available": False, "code": "BIOMETRIC_DISABLED", "message": "Pointage facial non activé"}
    monkeypatch.setattr(settings, "biometric_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", "")
    assert device.challenge(client).status_code == 503
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "biometric_models_dir", "/nonexistent")
    engine_module.set_engine(None)
    r = device.challenge(client)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "ENGINE_UNAVAILABLE"
    assert _events(db, emp) == []


# ── Défis à usage unique ─────────────────────────────────────────────────────────────────
def test_challenge_single_use_expiry_and_binding(client, auth_headers, db):
    site = _site(db)
    emp, who = _enrolled(db, site)
    term_a, dev_a = _terminal(client, auth_headers, site)
    term_b, dev_b = _terminal(client, auth_headers, site)
    ch = dev_a.challenge(client).json()
    assert ch["expires_in"] == terminals.CHALLENGE_TTL_SECONDS and len(ch["nonce"]) >= 40
    assert dev_a.recognize(client, burst(face(who)), challenge=ch).json()["state"] == "ATTENDANCE_RECORDED"
    r = dev_a.recognize(client, burst(face(who)), challenge=ch)                              # réutilisé
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CHALLENGE_REUSED"
    ch_a = dev_a.challenge(client).json()
    r = dev_b.recognize(client, burst(face(who)), challenge=ch_a)                            # défi du terminal A sur B
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CHALLENGE_INVALID"
    r = dev_a.recognize(client, burst(face(who)), challenge={"challenge_id": ch_a["challenge_id"], "nonce": "x" * 43})
    assert r.json()["detail"]["code"] == "CHALLENGE_INVALID"                                   # nonce faux
    r = dev_a.call(client, "POST", "/terminal/recognize", {"frames": burst(face(who))})     # défi absent
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CHALLENGE_INVALID"
    ch = dev_a.challenge(client).json()                                                        # expiré
    row = db.get(BiometricTerminalChallenge, ch["challenge_id"]); db.refresh(row)
    row.expires_at = datetime.utcnow() - timedelta(seconds=1); db.commit()
    assert dev_a.recognize(client, burst(face(who)), challenge=ch).json()["detail"]["code"] == "CHALLENGE_EXPIRED"
    ch = dev_a.challenge(client).json()                                                        # site modifié depuis le défi
    other_site = _site(db)
    term = db.get(BiometricTerminal, term_a); db.refresh(term)
    term.site_id = other_site.id; db.commit()
    assert dev_a.recognize(client, burst(face(who)), challenge=ch).json()["detail"]["code"] == "CHALLENGE_STALE"
    term.site_id = site.id; db.commit()
    ch = dev_a.challenge(client).json()                                                        # seuils modifiés depuis le défi
    client.post(f"{API}/config", headers=auth_headers, json={"provenance": "Test : nouvelle version de configuration", "cooldown_seconds": 60})
    assert dev_a.recognize(client, burst(face(who)), challenge=ch).json()["detail"]["code"] == "CHALLENGE_STALE"
    assert len(_events(db, emp)) == 1


# ── Anti-rejeu des images ────────────────────────────────────────────────────────────────
def test_replayed_or_frozen_frames_never_record(client, auth_headers, db):
    site = _site(db)
    emp, who = _enrolled(db, site)
    _, device = _terminal(client, auth_headers, site)
    frames = burst(face(who))
    assert device.recognize(client, frames).json()["state"] == "ATTENDANCE_RECORDED"
    r = device.recognize(client, frames)                               # ancienne rafale + nouveau défi
    assert r.status_code == 409 and r.json()["detail"]["code"] == "REPLAY_DETECTED"
    r = device.recognize(client, [frames[0], burst(face(who), n=1)[0]])   # une seule trame ancienne suffit
    assert r.json()["detail"]["code"] == "REPLAY_DETECTED"
    one = burst(face(who), n=1)[0]
    r = device.recognize(client, [one, one, one])                      # trames identiques (image figée)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "REPLAY_DETECTED"
    r = device.recognize(client, burst(face(who), n=1))                # une seule image : pas une rafale
    assert r.status_code == 422 and r.json()["detail"]["code"] == "INVALID_BURST"
    r = device.recognize(client, ["bm90IGFuIGltYWdl", "bm90IGFuIGltYWdlMg=="])
    assert r.status_code == 422 and r.json()["detail"]["code"] == "INVALID_IMAGE"
    assert len(_events(db, emp)) == 1
    stored = db.execute(select(BiometricFrameDigest.digest)).scalars().all()
    assert all(len(d) == 64 for d in stored)                            # empreintes seulement, jamais l'image


# ── Pipeline complet : ENTRÉE / SORTIE par Attendance Core ───────────────────────────────
def test_entry_then_exit_through_attendance_core_without_any_click(client, auth_headers, db):
    site = _site(db)
    emp, who = _enrolled(db, site)
    _, device = _terminal(client, auth_headers, site)
    r = device.recognize(client, burst(face(who))).json()
    assert (r["state"], r["recorded"], r["action"], r["employee"]["matricule"]) == ("ATTENDANCE_RECORDED", True, "ENTRÉE", emp.code)
    cfg = service.active_config(db)
    assert r["confidence"] >= cfg.recognition_threshold + cfg.review_margin and r["liveness"] >= cfg.liveness_threshold
    assert "embedding" not in json.dumps(r)
    # Personne restée devant la tablette : aucun second pointage.
    again = device.recognize(client, burst(face(who))).json()
    assert (again["state"], again["recorded"]) == ("ALREADY_RECORDED", False)
    assert len(_events(db, emp)) == 1
    # Fenêtre de non-répétition écoulée (config) : le passage suivant est une SORTIE décidée par Attendance Core.
    client.post(f"{API}/config", headers=auth_headers, json={"provenance": "Test : fenêtre de non-répétition nulle", "cooldown_seconds": 0})
    out = device.recognize(client, burst(face(who))).json()
    assert (out["state"], out["action"]) == ("ATTENDANCE_RECORDED", "SORTIE")
    events = _events(db, emp)
    assert [e.event_type for e in events] == ["ARRIVAL", "DEPARTURE"] and {e.source for e in events} == {SOURCE_FACIAL}
    assert events[0].data["terminal"] == device.terminal_id and events[0].device_id is None
    assert events[0].idempotency_key.startswith("term") and events[0].actor_label.startswith("BORNE ")


def test_refusals_never_record(client, auth_headers, db):
    site = _site(db)
    emp, who = _enrolled(db, site)
    _, device = _terminal(client, auth_headers, site)
    cases = [
        (burst(), "NO_FACE"),
        (burst(face(who), face(f"X-{_tag()}")), "MULTIPLE_FACES"),
        (burst(face(who, sharp=5)), "QUALITY_FAILED"),
        (burst(face(who, live=0.2)), "LIVENESS_FAILED"),
        (burst(face(f"STRANGER-{_tag()}")), "UNKNOWN_FACE"),
    ]
    for frames, state in cases:
        r = device.recognize(client, frames).json()
        assert (r["state"], r["recorded"]) == (state, False), (state, r)
    # Consentement retiré : refus au moment du pointage.
    db.add(BiometricConsent(employee_id=emp.id, status="withdrawn", source="HR_DOCUMENT", notice_version=service.NOTICE_VERSION)); db.commit()
    assert device.recognize(client, burst(face(who))).json()["state"] in ("REFUSED", "UNKNOWN_FACE")
    inactive, who2 = _enrolled(db, site, status="inactif")   # statuts bloquants : _employee_portal_block_reason
    assert device.recognize(client, burst(face(who2))).json()["state"] == "REFUSED"
    assert _events(db, emp) == [] and _events(db, inactive) == []


def test_ambiguous_match_never_records(client, auth_headers, db):
    site = _site(db)
    twin = f"TWIN-{_tag()}"
    a, _ = _enrolled(db, site, who=twin)
    b, _ = _enrolled(db, site, who=twin)
    _, device = _terminal(client, auth_headers, site)
    assert device.recognize(client, burst(face(twin))).json()["state"] == "AMBIGUOUS"
    assert _events(db, a) == [] and _events(db, b) == []


def test_one_to_n_is_limited_to_the_terminal_site_and_society(client, auth_headers, db):
    site, elsewhere = _site(db), _site(db)
    far, who_far = _enrolled(db, elsewhere)                       # autre site
    foreign, who_foreign = _enrolled(db, site, society=OTHER)     # même site, autre société
    _, device = _terminal(client, auth_headers, site)
    assert device.recognize(client, burst(face(who_far))).json()["state"] == "UNKNOWN_FACE"
    assert device.recognize(client, burst(face(who_foreign))).json()["state"] == "UNKNOWN_FACE"
    assert _events(db, far) == [] and _events(db, foreign) == []


# ── Coupures : site / terminal / global — QR et saisie manuelle intacts ──────────────────
def test_site_kill_switch_cuts_terminals_but_not_qr(client, auth_headers, db, monkeypatch):
    site = _site(db)
    emp, who = _enrolled(db, site)
    term_id, device = _terminal(client, auth_headers, site)
    out = client.post(f"{API}/sites/{site.id}/facial-disable", headers=auth_headers).json()
    assert out["disabled_terminals"] == 1
    assert device.challenge(client).json()["detail"]["code"] == "TERMINAL_FACIAL_DISABLED"
    monkeypatch.setattr(settings, "biometric_enabled", False)           # coupure globale aussi
    token = create_access_token(subject=emp.code, claims={"attendance_qr": True, "employee_id": emp.id, "nonce": uuid.uuid4().hex},
                                ttl_seconds=60)
    r = device.call(client, "POST", "/terminal/qr", {"token": token})
    assert r.status_code == 200 and r.json()["state"] == "ATTENDANCE_RECORDED" and r.json()["action"] == "ENTRÉE"
    assert device.call(client, "POST", "/terminal/qr", {"token": token}).json()["detail"]["code"] == "QR_ALREADY_USED"
    events = _events(db, emp)
    assert [e.source for e in events] == [SOURCE_QR] and events[0].data["terminal"] == device.terminal_id


def test_terminal_qr_refuses_employee_of_another_site(client, auth_headers, db):
    site, other = _site(db), _site(db)
    emp, _ = _enrolled(db, other)
    _, device = _terminal(client, auth_headers, site)
    token = create_access_token(subject=emp.code, claims={"attendance_qr": True, "employee_id": emp.id, "nonce": uuid.uuid4().hex},
                                ttl_seconds=60)
    r = device.call(client, "POST", "/terminal/qr", {"token": token})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "EMPLOYEE_NOT_ON_SITE"
    assert device.call(client, "POST", "/terminal/qr", {"token": "forged"}).json()["detail"]["code"] == "QR_INVALID"
    assert _events(db, emp) == []


def test_rate_limit_per_terminal(client, auth_headers, db, monkeypatch):
    site = _site(db)
    _, device = _terminal(client, auth_headers, site)
    monkeypatch.setattr(terminals, "MAX_REQUESTS_PER_MINUTE", 3)
    assert [device.challenge(client).status_code for _ in range(4)] == [200, 200, 200, 429]


def test_audit_is_metadata_only(client, auth_headers, db):
    site = _site(db)
    emp, who = _enrolled(db, site)
    term_id, device = _terminal(client, auth_headers, site)
    frames = burst(face(who))
    device.recognize(client, frames)
    device.recognize(client, frames)          # rejeu refusé, tracé aussi
    rows = db.execute(select(AuditEvent).where(AuditEvent.action == "biometrics.terminal.recognize",
                                               AuditEvent.resource_id == str(term_id)).order_by(AuditEvent.id)).scalars().all()
    assert [r.result for r in rows] == ["success", "refused"]
    first = json.loads(rows[0].new_state)             # audit : JSON sérialisé (_safe_summary)
    assert (first["state"], first["matricule"], first["recorded"], first["action"], first["frames"]) == ("ATTENDANCE_RECORDED", emp.code, True, "ENTRÉE", 3)
    assert first["terminal_id"] == device.terminal_id and first["config_version"] and first["liveness"]
    assert json.loads(rows[1].new_state)["state"] == "REPLAY_DETECTED"
    dump = "".join(r.new_state for r in rows)
    assert frames[0][:40] not in dump and "embedding" not in dump


def test_production_circuits_stay_separate(client, auth_headers, db):
    """Le Mode Test n'écrit jamais ; la caméra serveur refuse toujours les images du client."""
    from app.modules.biometrics import test_mode
    src = open(test_mode.__file__).read()
    assert "match_and_record" not in src and "terminals" not in src and "record_scan(" not in src
    terminal_src = open(terminals.__file__).read()
    assert "test-mode" not in terminal_src and "current_user" not in terminal_src
    assert db.execute(select(func.count()).select_from(BiometricTerminal).where(BiometricTerminal.public_key.is_(None),
                                                                               BiometricTerminal.facial_attendance_enabled.is_(True))).scalar_one() == 0


def test_terminal_identity_and_user_session_are_never_interchangeable(client, auth_headers, db):
    site = _site(db)
    term_id, device = _terminal(client, auth_headers, site)
    # Identité terminal (signée) sur les routes d'administration : refusée.
    for method, path in (("GET", "/terminals"), ("POST", f"/terminals/{term_id}/pairing-code"), ("GET", "/employees?q=a"),
                         ("PATCH", f"/terminals/{term_id}")):
        r = device.call(client, method, path, {} if method != "GET" else None)
        assert r.status_code == 401, (path, r.status_code)
    # Requête terminal sans signature (en-têtes absents) : refusée, même avec l'identifiant.
    r = client.post(f"{API}/terminal/challenge", json={}, headers={"X-Atlas-Terminal": device.terminal_id})
    assert r.status_code == 401
    # Signature valide d'un terminal présentée sous l'identifiant d'un autre terminal : refusée.
    _, other = _terminal(client, auth_headers, site)
    path = API + "/terminal/challenge"
    forged = device.headers("POST", path, b"{}", terminal_id=device.terminal_id)
    forged["X-Atlas-Terminal"] = other.terminal_id
    assert client.post(path, content=b"{}", headers=forged).status_code == 401


def test_review_band_and_clear_recognition(client, auth_headers, db):
    site = _site(db)
    who = f"R-{_tag()}"
    cfg = service.active_config(db); db.commit()        # base partagée : seuils de la version active
    band = cfg.recognition_threshold + cfg.review_margin / 2                         # [seuil ; seuil + marge) : revue
    uncertain, _ = _enrolled(db, site, who=f"U-{who}", vector=_mixed(who, band))
    _, device = _terminal(client, auth_headers, site)
    r = device.recognize(client, burst(face(who))).json()
    assert (r["state"], r["recorded"]) == ("REVIEW_REQUIRED", False) and "employee" not in r
    clear, who2 = _enrolled(db, site)
    r = device.recognize(client, burst(face(who2))).json()
    assert (r["state"], r["employee"]) == ("ATTENDANCE_RECORDED", {"nom": clear.last_name, "prenom": clear.first_name, "matricule": clear.code})
    # Confidentialité : uniquement l'affichage nécessaire, jamais de candidats ni de données DRH.
    assert set(r) <= {"state", "recorded", "message", "employee", "action", "heure", "site", "confidence", "liveness",
                      "site_id", "config_version", "duration_ms"}
    assert _events(db, uncertain) == []
