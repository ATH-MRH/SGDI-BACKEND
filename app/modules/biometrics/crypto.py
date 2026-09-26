"""Chiffrement au repos des gabarits biométriques et des secrets caméra (Fernet = AES-128-CBC
+ HMAC-SHA256). Clé dédiée hors dépôt (settings.biometric_template_key) : sans clé, rien
n'est chiffré ni déchiffré — la fonction refuse plutôt que de stocker en clair."""
from __future__ import annotations

import json
import struct

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.core.config import settings


def _fernet() -> Fernet:
    key = (settings.biometric_template_key or "").strip()
    if not key:
        raise HTTPException(503, detail="Biométrie : clé de chiffrement non configurée (BIOMETRIC_TEMPLATE_KEY)")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        raise HTTPException(503, detail="Biométrie : clé de chiffrement invalide") from None


def encrypt_vector(values: list[float]) -> bytes:
    return _fernet().encrypt(struct.pack(f"<{len(values)}f", *values))


def decrypt_vector(token: bytes) -> list[float]:
    try:
        raw = _fernet().decrypt(token)
    except InvalidToken:
        raise HTTPException(500, detail="Gabarit biométrique illisible (clé changée ?)") from None
    return list(struct.unpack(f"<{len(raw) // 4}f", raw))


def encrypt_secret(data: dict) -> bytes:
    return _fernet().encrypt(json.dumps(data).encode())


def decrypt_secret(token: bytes | None) -> dict:
    if not token:
        return {}
    try:
        return json.loads(_fernet().decrypt(token))
    except InvalidToken:
        raise HTTPException(500, detail="Secret caméra illisible (clé changée ?)") from None
