from datetime import datetime, timedelta, timezone
from typing import Any
import base64
import hashlib
import hmac
import json
import secrets

import bcrypt

from app.core.config import settings


PBKDF2_ROUNDS = 260_000


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def hash_password(password: str) -> str:
    salt = secrets.token_urlsafe(18)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${_b64url_encode(digest)}"


def verify_password(password: str, password_hash: str) -> bool:
    if password_hash.startswith(("$2a$", "$2b$", "$2y$")):
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    try:
        algorithm, rounds, salt, expected = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(rounds))
        return hmac.compare_digest(_b64url_encode(digest), expected)
    except Exception:
        return False


def create_access_token(
    subject: str,
    claims: dict[str, Any] | None = None,
    ttl_minutes: int | None = None,
    ttl_seconds: int | None = None,
) -> str:
    ttl = timedelta(seconds=ttl_seconds) if ttl_seconds is not None else timedelta(
        minutes=ttl_minutes if ttl_minutes is not None else settings.jwt_expires_minutes
    )
    expires = datetime.now(timezone.utc) + ttl
    header = {"typ": "JWT", "alg": "HS256"}
    payload = {"sub": subject, "exp": int(expires.timestamp()), **(claims or {})}
    head = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    body = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{head}.{body}".encode("ascii")
    signature = hmac.new(settings.jwt_secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{head}.{body}.{_b64url_encode(signature)}"


def decode_token(token: str) -> dict[str, Any]:
    try:
        head, body, signature = token.split(".")
        signing_input = f"{head}.{body}".encode("ascii")
        expected = hmac.new(settings.jwt_secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_encode(expected), signature):
            raise ValueError("Signature invalide")
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
        if payload.get("exp") is not None and int(payload["exp"]) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("Token expiré")
        return payload
    except Exception as exc:
        raise ValueError("Token invalide") from exc


# --- Isolation des familles de jetons -------------------------------------------------
# Tous les jetons (staff, portail client, portail employé, QR de pointage, ticket SSE)
# sont signés par le même secret. La signature seule ne dit donc pas à QUI le jeton a été
# délivré : sans contrôle de famille, le `sub` d'un compte portail client serait lu comme
# un identifiant staff. Les routes staff n'acceptent que ce que valident ces fonctions.

TOKEN_USE_CLAIM = "token_use"
STAFF_TOKEN_USE = "staff"

# Jetons staff émis avant l'ajout de `token_use` (durée de vie : jwt_expires_minutes) :
# ils ne portaient que ces claims. Tout autre claim désigne une autre famille (ou une
# famille future) et fait refuser le jeton : refus par défaut.
_LEGACY_STAFF_CLAIMS = frozenset({"sub", "exp", "iat", "role", "username", "admin_system"})
_SSE_TICKET_CLAIMS = frozenset({"sub", "exp", "sse_ticket"})


def _has_staff_subject(payload: dict[str, Any]) -> bool:
    subject = payload.get("sub")
    return isinstance(subject, str) and subject.isascii() and subject.isdigit() and isinstance(payload.get("exp"), int)


def is_staff_token_payload(payload: dict[str, Any]) -> bool:
    if not _has_staff_subject(payload):
        return False
    if TOKEN_USE_CLAIM in payload:
        return payload[TOKEN_USE_CLAIM] == STAFF_TOKEN_USE
    return set(payload) <= _LEGACY_STAFF_CLAIMS


def is_sse_ticket_payload(payload: dict[str, Any]) -> bool:
    return _has_staff_subject(payload) and payload.get("sse_ticket") is True and set(payload) <= _SSE_TICKET_CLAIMS


def create_staff_token(user_id: int, claims: dict[str, Any] | None = None) -> str:
    return create_access_token(str(user_id), {**(claims or {}), TOKEN_USE_CLAIM: STAFF_TOKEN_USE})


def decode_staff_token(token: str) -> dict[str, Any]:
    """Décode un jeton et exige qu'il soit un jeton staff ; ValueError sinon."""
    payload = decode_token(token)
    if not is_staff_token_payload(payload):
        raise ValueError("Token invalide")
    return payload

