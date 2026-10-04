"""Terminaux faciaux mobiles autorisés (tablette Samsung, smartphone) — circuit B de production.

Trois circuits strictement séparés (docs/biometrics.md, § 14) :
- A. Mode Test : image du navigateur → résultat de diagnostic, JAMAIS de présence ;
- B. CE MODULE : terminal associé par un administrateur → défi serveur → rafale live signée →
  moteur → Attendance Core ;
- C. Caméra RTSP/Dahua lue par le serveur (service.recognize_and_record).

Un navigateur quelconque n'est pas un terminal. Association : un administrateur crée le
terminal (société + site) et génère un code à usage unique (10 min) ; la tablette génère une
paire de clés ECDSA P-256 NON EXTRACTIBLE (WebCrypto, conservée dans IndexedDB), envoie la clé
publique avec le code ; le code est aussitôt invalidé. Chaque requête du terminal est ensuite
signée (méthode, chemin, horodatage, SHA-256 du corps) : aucun secret n'est stocké côté
serveur, aucun mot de passe utilisateur, aucune session humaine (pas de déconnexion
d'inactivité). Révocation = clé publique effacée, effet immédiat.

Limite assumée (docs) : un navigateur ne prouve pas cryptographiquement que chaque pixel vient
du capteur. La défense est multicouche : terminal enregistré + clé non extractible + défi à
usage unique de quelques secondes + rafale de plusieurs trames + liveness + empreintes
anti-rejeu + limitation de débit + audit + coupures (global / site / terminal).
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from datetime import datetime, timedelta
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.audit import append_audit
from app.core.config import settings
from app.db.session import get_db
from app.modules.attendance import core as attendance_core
from app.modules.attendance.models import SOURCE_QR
from app.modules.biometrics import service, test_mode
from app.modules.biometrics.engine import EngineUnavailable, get_engine
from app.modules.biometrics.models import (
    MOBILE_TERMINAL_TYPES,
    BiometricFrameDigest,
    BiometricTerminal,
    BiometricTerminalChallenge,
)
from app.modules.ops.models import Assignment, Site

router = APIRouter()

# ── Paramètres (mesurés, docs/biometrics.md § 14.6) ──────────────────────────────────────
PAIRING_TTL_SECONDS = 600
PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # sans 0/O, 1/I/L : saisie sur tablette
PAIRING_CODE_LENGTH = 10                               # ≈ 49 bits, 10 min, 10 essais / IP / 10 min
PAIRING_MAX_FAILURES_PER_IP = 10
CHALLENGE_TTL_SECONDS = 10       # rafale 0,4 s + encodage + envoi 4G ; large mais court
SIGNATURE_SKEW_SECONDS = 300     # horloge d'une tablette non synchronisée
MAX_REQUESTS_PER_MINUTE = 120    # par terminal : 1 essai (défi + rafale) / ~1,2 s au plus fort
                                 # d'une relève, jamais atteint par la borne en usage normal
BURST = {"frames": 3, "interval_ms": 200, "max_side": 800, "jpeg_quality": 0.85}
MIN_FRAMES = 2                   # liveness médian + détection d'image figée
MAX_FRAMES = 5
MAX_BODY_BYTES = MAX_FRAMES * (test_mode.MAX_FRAME_BYTES * 4 // 3 + 64) + 4096
FRAME_DIGEST_RETENTION = timedelta(days=7)
LAST_SEEN_THROTTLE = timedelta(seconds=60)
SIGNATURE_DOMAIN = "ATLAS-TERMINAL-1"


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message})


def _now() -> datetime:
    return datetime.utcnow()


def _sha256(data: bytes | str) -> str:
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def _b64url_decode(value: str) -> bytes:
    value = str(value or "")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class TerminalActor:
    """Auteur d'un pointage de borne (aucun utilisateur humain) : libellé tracé dans la
    présence et l'audit, jamais un compte."""

    def __init__(self, terminal: BiometricTerminal):
        self.id = None
        self.username = f"BORNE {terminal.name}"[:120]


# ── Codes d'association ──────────────────────────────────────────────────────────────────
def normalize_pairing_code(code: str) -> str:
    return "".join(ch for ch in str(code or "").upper() if ch.isalnum())


def new_pairing_code(db: Session, terminal: BiometricTerminal, actor: Any) -> dict[str, Any]:
    if terminal.deleted_at:
        raise _error(409, "TERMINAL_DELETED", "Terminal supprimé : créez un nouveau terminal")
    if terminal.revoked_at:
        raise _error(409, "TERMINAL_REVOKED", "Terminal révoqué : créez un nouveau terminal")
    if terminal.terminal_type not in MOBILE_TERMINAL_TYPES:
        raise _error(422, "NOT_A_MOBILE_TERMINAL", "Association réservée aux tablettes et smartphones")
    code = "".join(secrets.choice(PAIRING_ALPHABET) for _ in range(PAIRING_CODE_LENGTH))
    terminal.pairing_code_hash = _sha256(code)
    terminal.pairing_expires_at = _now() + timedelta(seconds=PAIRING_TTL_SECONDS)
    append_audit(db, action="biometrics.terminal.pairing_code", resource="biometric_terminal", resource_id=terminal.id,
                 result="success", user=actor, society=terminal.society,
                 new_state={"public_id": terminal.public_id, "expires_in": PAIRING_TTL_SECONDS, "rotation": bool(terminal.public_key)})
    db.flush()
    return {"code": f"{code[:5]}-{code[5:]}", "expires_in": PAIRING_TTL_SECONDS,
            "expires_at": terminal.pairing_expires_at.isoformat() + "Z", "pair_path": f"/borne#pair={code}"}


def _validated_public_key(jwk: Any) -> tuple[dict[str, str], str]:
    if not isinstance(jwk, dict) or jwk.get("kty") != "EC" or jwk.get("crv") != "P-256" or "d" in jwk:
        raise _error(422, "INVALID_PUBLIC_KEY", "Clé publique P-256 attendue")
    try:
        x, y = _b64url_decode(jwk["x"]), _b64url_decode(jwk["y"])
        if len(x) != 32 or len(y) != 32:
            raise ValueError
        ec.EllipticCurvePublicNumbers(int.from_bytes(x, "big"), int.from_bytes(y, "big"), ec.SECP256R1()).public_key()
    except (KeyError, ValueError, TypeError):
        raise _error(422, "INVALID_PUBLIC_KEY", "Clé publique P-256 invalide") from None
    clean = {"kty": "EC", "crv": "P-256", "x": jwk["x"], "y": jwk["y"]}
    return clean, _sha256(f"{clean['x']}.{clean['y']}")


def pair(db: Session, *, code: str, public_key: Any, device_label: str | None, ip: str) -> BiometricTerminal:
    limiter = f"terminal-pair:{ip}"
    if rate_limit.failure_count(limiter, PAIRING_TTL_SECONDS) >= PAIRING_MAX_FAILURES_PER_IP:
        raise _error(429, "RATE_LIMITED", "Trop d'essais d'association — patientez 10 minutes")
    normalized = normalize_pairing_code(code)
    terminal = None
    if len(normalized) == PAIRING_CODE_LENGTH:
        terminal = db.execute(select(BiometricTerminal).where(
            BiometricTerminal.pairing_code_hash == _sha256(normalized)).with_for_update()
            .execution_options(populate_existing=True)).scalar_one_or_none()
    if terminal is None or terminal.deleted_at or terminal.revoked_at or not terminal.enabled or not terminal.pairing_expires_at \
            or terminal.pairing_expires_at < _now():
        rate_limit.record_failure(limiter, PAIRING_TTL_SECONDS)
        append_audit(db, action="biometrics.terminal.pair", resource="biometric_terminal",
                     resource_id=terminal.id if terminal else None, result="refused",
                     new_state={"ip": ip, "reason": "code inconnu, expiré ou terminal indisponible"})
        db.commit()
        raise _error(401, "PAIRING_CODE_INVALID", "Code d'association invalide ou expiré")
    key, fingerprint = _validated_public_key(public_key)
    rotation = bool(terminal.public_key)
    changed = db.execute(update(BiometricTerminal).where(
        BiometricTerminal.id == terminal.id, BiometricTerminal.deleted_at.is_(None),
        BiometricTerminal.revoked_at.is_(None), BiometricTerminal.enabled.is_(True),
        BiometricTerminal.pairing_code_hash == _sha256(normalized)).values(
        public_key=key, key_fingerprint=fingerprint, pairing_code_hash=None,
        pairing_expires_at=None, paired_at=_now(), config_version=BiometricTerminal.config_version + 1,
        meta={**(terminal.meta or {}), "device_label": str(device_label or "")[:120] or None}),
        execution_options={"synchronize_session": False})
    if not changed.rowcount:
        db.rollback()
        raise _error(401, "PAIRING_CODE_INVALID", "Code d'association invalide ou expiré")
    db.refresh(terminal)
    rate_limit.clear(limiter)
    append_audit(db, action="biometrics.terminal.pair", resource="biometric_terminal", resource_id=terminal.id,
                 result="success", society=terminal.society,
                 new_state={"public_id": terminal.public_id, "key_fingerprint": fingerprint[:16], "rotation": rotation,
                            "ip": ip, "device_label": terminal.meta.get("device_label")})
    db.commit()
    return terminal


# ── Authentification des requêtes du terminal (signature ECDSA P-256) ────────────────────
def signed_message(terminal_id: str, method: str, path: str, timestamp: str, body: bytes) -> bytes:
    """Message canonique signé : domaine, identifiant du terminal, méthode, chemin + requête,
    horodatage (ms), SHA-256 du corps exact. Le corps porte le défi (id + nonce) et les images :
    aucune partie d'une requête ne peut être substituée sans invalider la signature."""
    return "\n".join((SIGNATURE_DOMAIN, terminal_id, method.upper(), path, timestamp, _sha256(body))).encode()


def _verify_signature(jwk: dict, message: bytes, signature_b64url: str) -> bool:
    try:
        raw = _b64url_decode(signature_b64url)
        if len(raw) != 64:
            return False
        key = ec.EllipticCurvePublicNumbers(int.from_bytes(_b64url_decode(jwk["x"]), "big"),
                                            int.from_bytes(_b64url_decode(jwk["y"]), "big"), ec.SECP256R1()).public_key()
        der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
        key.verify(der, message, ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError, KeyError, TypeError):
        return False


async def _read_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise _error(413, "IMAGE_TOO_LARGE", "Requête trop volumineuse")
    size, chunks = 0, []
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise _error(413, "IMAGE_TOO_LARGE", "Requête trop volumineuse")
        chunks.append(chunk)
    return b"".join(chunks)


def _signed_path(request: Request) -> str:
    query = request.url.query
    return request.url.path + (f"?{query}" if query else "")


class TerminalRequest:
    def __init__(self, terminal: BiometricTerminal, body: dict[str, Any], ip: str, received: float):
        self.terminal, self.body, self.ip, self.received = terminal, body, ip, received


async def authenticated_terminal(request: Request, db: Session = Depends(get_db)) -> TerminalRequest:
    """Dépendance commune : terminal connu, associé, non révoqué, signature valide et récente.
    Aucune session utilisateur n'est lue ni acceptée ici."""
    received = time.perf_counter()
    ip = request.client.host if request.client else "?"
    public_id = request.headers.get("x-atlas-terminal", "")
    timestamp = request.headers.get("x-atlas-timestamp", "")
    signature = request.headers.get("x-atlas-signature", "")
    ip_limiter = f"terminal-auth:{ip}"
    if rate_limit.failure_count(ip_limiter, 300) >= 30:
        raise _error(429, "RATE_LIMITED", "Trop d'échecs d'authentification")
    body = await _read_body(request, MAX_BODY_BYTES)
    terminal = db.execute(select(BiometricTerminal).where(BiometricTerminal.public_id == public_id)).scalar_one_or_none() \
        if public_id else None
    if terminal is None or terminal.deleted_at or not terminal.public_key:
        rate_limit.record_failure(ip_limiter, 300)
        raise _error(401, "TERMINAL_UNKNOWN", "Terminal non associé")
    if terminal.revoked_at:
        raise _error(401, "TERMINAL_REVOKED", "Terminal révoqué")
    try:
        skew = abs(time.time() - int(timestamp) / 1000)
    except ValueError:
        skew = float("inf")
    if skew > SIGNATURE_SKEW_SECONDS or not _verify_signature(
            terminal.public_key, signed_message(public_id, request.method, _signed_path(request), timestamp, body), signature):
        rate_limit.record_failure(ip_limiter, 300)
        append_audit(db, action="biometrics.terminal.auth", resource="biometric_terminal", resource_id=terminal.id,
                     result="refused", society=terminal.society,
                     new_state={"ip": ip, "reason": "horodatage hors fenêtre" if skew > SIGNATURE_SKEW_SECONDS else "signature invalide"})
        db.commit()
        raise _error(401, "TERMINAL_SIGNATURE_INVALID", "Signature du terminal invalide")
    if not terminal.enabled:
        raise _error(403, "TERMINAL_DISABLED", "Terminal désactivé par l'administrateur")
    now = _now()
    if not terminal.last_seen_at or now - terminal.last_seen_at > LAST_SEEN_THROTTLE:
        terminal.last_seen_at = now
        db.commit()
    try:
        payload = json.loads(body or b"{}")
    except ValueError:
        raise _error(422, "INVALID_BODY", "Corps JSON invalide") from None
    if not isinstance(payload, dict):
        raise _error(422, "INVALID_BODY", "Corps JSON invalide")
    return TerminalRequest(terminal, payload, ip, received)


def _rate_limit(terminal: BiometricTerminal) -> None:
    key = f"terminal-req:{terminal.id}"
    if rate_limit.failure_count(key, 60) >= MAX_REQUESTS_PER_MINUTE:
        raise _error(429, "RATE_LIMITED", "Trop de requêtes — patientez")
    rate_limit.record_failure(key, 60)


# ── Disponibilité du facial pour un terminal ─────────────────────────────────────────────
def facial_availability(terminal: BiometricTerminal) -> dict[str, Any]:
    """Fail closed, dans l'ordre : flag global, clé, moteur, type, activation du terminal."""
    if not settings.biometric_enabled:
        return {"available": False, "code": "BIOMETRIC_DISABLED", "message": "Pointage facial non activé"}
    if not service.key_configured():
        return {"available": False, "code": "ENGINE_UNAVAILABLE", "message": "Clé de chiffrement absente"}
    try:
        get_engine()
    except EngineUnavailable:
        return {"available": False, "code": "ENGINE_UNAVAILABLE", "message": "Moteur biométrique indisponible"}
    if terminal.terminal_type not in MOBILE_TERMINAL_TYPES:
        return {"available": False, "code": "NOT_A_MOBILE_TERMINAL", "message": "Type de terminal non mobile"}
    if not terminal.facial_attendance_enabled:
        return {"available": False, "code": "TERMINAL_FACIAL_DISABLED", "message": "Pointage facial non activé pour ce terminal"}
    return {"available": True, "code": None, "message": ""}


def _ensure_facial(terminal: BiometricTerminal) -> None:
    state = facial_availability(terminal)
    if not state["available"]:
        raise _error(503 if state["code"] in ("BIOMETRIC_DISABLED", "ENGINE_UNAVAILABLE") else 409, state["code"], state["message"])


# ── Endpoints du terminal ────────────────────────────────────────────────────────────────
@router.post("/terminal/pair")
async def pair_terminal(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Échange d'un code d'association (usage unique) contre l'enregistrement de la clé
    publique de l'appareil. Aucune session utilisateur."""
    try:
        payload = json.loads(await _read_body(request, 16_384) or b"{}")
    except ValueError:
        raise _error(422, "INVALID_BODY", "Corps JSON invalide") from None
    if not isinstance(payload, dict):
        raise _error(422, "INVALID_BODY", "Corps JSON invalide")
    terminal = pair(db, code=payload.get("code"), public_key=payload.get("public_key"),
                    device_label=payload.get("device_label"), ip=request.client.host if request.client else "?")
    site = db.get(Site, terminal.site_id)
    return {"terminal_id": terminal.public_id, "name": terminal.name, "terminal_type": terminal.terminal_type,
            "site": site.name if site else None, "society": terminal.society}


def _remote_capture():
    """Prise de photo distante (LOT C1) — import tardif : ce module-là dépend de celui-ci."""
    from app.modules.biometrics import remote_capture

    return remote_capture


@router.get("/terminal/session")
def terminal_session(req: TerminalRequest = Depends(authenticated_terminal), db: Session = Depends(get_db)) -> dict[str, Any]:
    """État du terminal pour l'écran de borne : identité, disponibilité du facial / du QR,
    paramètres de rafale. Aucune donnée employé."""
    terminal = req.terminal
    site = db.get(Site, terminal.site_id)
    return {"terminal": {"terminal_id": terminal.public_id, "name": terminal.name, "terminal_type": terminal.terminal_type,
                         "site_id": terminal.site_id, "site": site.name if site else None, "society": terminal.society,
                         "location": terminal.location},
            "facial": facial_availability(terminal), "qr": {"available": True},
            "remote_capture": _remote_capture().session_info(),
            "burst": BURST, "challenge_ttl": CHALLENGE_TTL_SECONDS, "server_time": int(time.time() * 1000)}


@router.post("/terminal/challenge")
def terminal_challenge(req: TerminalRequest = Depends(authenticated_terminal), db: Session = Depends(get_db)) -> dict[str, Any]:
    terminal = req.terminal
    _ensure_facial(terminal)
    _remote_capture().ensure_not_capturing(db, terminal)     # terminal réservé à une prise de photo
    _rate_limit(terminal)
    cfg = service.active_config(db)
    nonce = secrets.token_urlsafe(32)
    now = _now()
    row = BiometricTerminalChallenge(terminal_id=terminal.id, site_id=terminal.site_id, config_version=cfg.version,
                                     terminal_config_version=terminal.config_version, nonce_hash=_sha256(nonce),
                                     issued_at=now, expires_at=now + timedelta(seconds=CHALLENGE_TTL_SECONDS))
    db.add(row)
    # Purge : défis expirés depuis plus d'un jour, empreintes au-delà de la rétention.
    db.execute(delete(BiometricTerminalChallenge).where(BiometricTerminalChallenge.expires_at < now - timedelta(days=1)))
    db.execute(delete(BiometricFrameDigest).where(BiometricFrameDigest.created_at < now - FRAME_DIGEST_RETENTION))
    db.commit()
    return {"challenge_id": row.id, "nonce": nonce, "expires_in": CHALLENGE_TTL_SECONDS, "burst": BURST}


def consume_challenge(db: Session, terminal: BiometricTerminal, challenge_id: Any, nonce: Any, config_version: int) -> BiometricTerminalChallenge:
    """Usage unique, atomique (UPDATE … WHERE consumed_at IS NULL) : deux requêtes parallèles
    avec le même défi ⇒ une seule passe. Lié au terminal, au site et aux configurations."""
    try:
        challenge_id = int(challenge_id)
    except (TypeError, ValueError):
        raise _error(409, "CHALLENGE_INVALID", "Défi absent ou invalide") from None
    row = db.get(BiometricTerminalChallenge, challenge_id)
    if row is None or row.terminal_id != terminal.id or not isinstance(nonce, str) \
            or not secrets.compare_digest(row.nonce_hash, _sha256(nonce)):
        raise _error(409, "CHALLENGE_INVALID", "Défi absent ou invalide")
    if row.consumed_at is not None:
        raise _error(409, "CHALLENGE_REUSED", "Défi déjà utilisé")
    now = _now()
    consumed = db.execute(update(BiometricTerminalChallenge).where(
        BiometricTerminalChallenge.id == row.id, BiometricTerminalChallenge.consumed_at.is_(None)
    ).values(consumed_at=now)).rowcount
    db.commit()
    if consumed != 1:
        raise _error(409, "CHALLENGE_REUSED", "Défi déjà utilisé")
    if row.expires_at < now:
        raise _error(409, "CHALLENGE_EXPIRED", "Défi expiré")
    if row.site_id != terminal.site_id or row.terminal_config_version != terminal.config_version \
            or row.config_version != config_version:
        raise _error(409, "CHALLENGE_STALE", "Configuration modifiée depuis le défi")
    return row


def register_frames(db: Session, terminal: BiometricTerminal, frames: list[bytes]) -> None:
    """Anti-rejeu : une trame déjà reçue (à l'octet près) — ou deux trames identiques dans la
    même rafale, ce qu'aucun capteur réel ne produit — est refusée."""
    digests = [_sha256(f) for f in frames]
    if len(set(digests)) != len(digests):
        raise _error(409, "REPLAY_DETECTED", "Trames identiques dans la rafale")
    seen = db.execute(select(BiometricFrameDigest.id).where(BiometricFrameDigest.digest.in_(digests)).limit(1)).first()
    if seen:
        raise _error(409, "REPLAY_DETECTED", "Image déjà reçue")
    now = _now()
    db.add_all([BiometricFrameDigest(digest=d, terminal_id=terminal.id, created_at=now) for d in digests])
    db.commit()


def _audit(db: Session, terminal: BiometricTerminal, action: str, result: dict[str, Any], extra: dict[str, Any]) -> None:
    """Une ligne par tentative — métadonnées seulement (jamais d'image ni de gabarit)."""
    employee = result.get("employee") or {}
    append_audit(db, action=action, resource="biometric_terminal", resource_id=terminal.id,
                 result="success" if result.get("recorded") else "refused", user=TerminalActor(terminal), society=terminal.society,
                 new_state={"terminal_id": terminal.public_id, "site_id": terminal.site_id, "state": result.get("state"),
                            "matricule": employee.get("matricule"), "confidence": result.get("confidence"),
                            "liveness": result.get("liveness"), "config_version": result.get("config_version"),
                            "recorded": bool(result.get("recorded")), "action": result.get("action"),
                            "reason": result.get("reason") or (None if result.get("recorded") else result.get("message")), **extra})
    db.commit()


@router.post("/terminal/recognize")
def terminal_recognize(req: TerminalRequest = Depends(authenticated_terminal), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Terminal authentifié → défi consommé → rafale validée → anti-rejeu → moteur → 1:N du
    site → Attendance Core. Toute condition non satisfaite ⇒ AUCUN pointage."""
    terminal, body = req.terminal, req.body
    frames_in = body.get("frames")
    audit = {"challenge_id": body.get("challenge_id"), "frames": len(frames_in) if isinstance(frames_in, list) else 0}
    try:
        _ensure_facial(terminal)
        engine = service.ensure_enabled()
        _remote_capture().ensure_not_capturing(db, terminal)
        _rate_limit(terminal)
        cfg = service.active_config(db)
        challenge = consume_challenge(db, terminal, body.get("challenge_id"), body.get("nonce"), cfg.version)
        if not isinstance(frames_in, list) or not MIN_FRAMES <= len(frames_in) <= MAX_FRAMES:
            raise _error(422, "INVALID_BURST", f"Rafale de {MIN_FRAMES} à {MAX_FRAMES} images attendue")
        frames = test_mode.decode_frames(frames_in)
        register_frames(db, terminal, frames)
        decision = service.analyze_frames(engine, frames, cfg, require_liveness=True)
        source = service.FacialSource(
            label=f"terminal {terminal.name}", key=f"T{terminal.id}", site_id=terminal.site_id, society=terminal.society,
            details={"terminal_id": terminal.id}, idempotency_key=f"term{terminal.id}-ch{challenge.id}", device_id=None,
            extra={"terminal": terminal.public_id, "terminal_name": terminal.name}, society_scoped=True)
        result = service.match_and_record(db, source=source, decision=decision, cfg=cfg, actor=TerminalActor(terminal))
    except HTTPException as exc:
        db.rollback()
        code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
        _audit(db, terminal, "biometrics.terminal.recognize", {"state": code or "ERROR", "recorded": False,
                                                              "reason": str(exc.detail)[:200]}, audit)
        raise
    result.pop("terminal_id", None)
    result["duration_ms"] = round((time.perf_counter() - req.received) * 1000, 1)
    _audit(db, terminal, "biometrics.terminal.recognize", result, {**audit, "duration_ms": result["duration_ms"]})
    return result


@router.post("/terminal/qr")
def terminal_qr(req: TerminalRequest = Depends(authenticated_terminal), db: Session = Depends(get_db)) -> dict[str, Any]:
    """QR employé (Portail RH, signé, usage unique) lu par la caméra de la borne : même
    Attendance Core que le facial et le HENEX. Indépendant de BIOMETRIC_ENABLED."""
    from app.core.security import decode_token
    from app.modules.irongs.sql_bridge import employee_by_ref

    terminal = req.terminal
    audit: dict[str, Any] = {}
    try:
        _remote_capture().ensure_not_capturing(db, terminal)
        _rate_limit(terminal)
        token = str(req.body.get("token") or "").strip()
        try:
            qr = decode_token(token) if token else {}
        except ValueError:
            qr = {}
        if not qr.get("attendance_qr") or not qr.get("nonce"):
            raise _error(422, "QR_INVALID", "QR expiré ou invalide")
        nonce = str(qr["nonce"])
        if attendance_core.key_used(db, nonce):
            raise _error(409, "QR_ALREADY_USED", "Ce QR a déjà été utilisé")
        employee = employee_by_ref(db, str(qr.get("sub") or ""))
        if not employee or int(qr.get("employee_id") or 0) != employee.id:
            raise _error(404, "EMPLOYEE_NOT_FOUND", "Employé introuvable")
        audit["matricule"] = employee.code
        today = attendance_core._now_local().date()
        on_site = db.execute(select(Assignment.id).where(
            Assignment.employee_id == employee.id, Assignment.site_id == terminal.site_id, Assignment.active == 1,
            Assignment.start_date <= today, (Assignment.end_date.is_(None)) | (Assignment.end_date >= today)).limit(1)).first()
        if not on_site or service._society_key(employee.society) != service._society_key(terminal.society):
            raise _error(403, "EMPLOYEE_NOT_ON_SITE", "Employé non affecté au site de cette borne")
        scan = attendance_core.record_scan(db, employee=employee, source=SOURCE_QR, actor=TerminalActor(terminal),
                                           idempotency_key=nonce, extra={"terminal": terminal.public_id, "terminal_name": terminal.name})
    except HTTPException as exc:
        db.rollback()
        code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
        _audit(db, terminal, "biometrics.terminal.qr", {"state": code or "ERROR", "recorded": False,
                                                       "reason": str(exc.detail)[:200], "employee": audit}, {})
        raise
    result = {"state": "ALREADY_RECORDED" if scan.get("duplicate") else "ATTENDANCE_RECORDED", "recorded": not scan.get("duplicate"),
              "message": "POINTAGE ENREGISTRÉ", "employee": service._person(employee),
              "action": "ENTRÉE" if scan["action"] == "arrivee" else "SORTIE", "heure": scan["heure"][:5], "site": scan.get("site")}
    _audit(db, terminal, "biometrics.terminal.qr", result, {})
    return result

