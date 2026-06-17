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


def create_access_token(subject: str, claims: dict[str, Any] | None = None, ttl_minutes: int | None = None) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes if ttl_minutes is not None else settings.jwt_expires_minutes)
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
