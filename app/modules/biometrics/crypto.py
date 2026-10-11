"""Chiffrement au repos des gabarits biométriques et des secrets caméra (Fernet = AES-128-CBC
+ HMAC-SHA256). Clé dédiée hors dépôt (settings.biometric_template_key) : sans clé, rien
n'est chiffré ni déchiffré — la fonction refuse plutôt que de stocker en clair.

Rotation : pendant une transition, settings.biometric_template_key_previous porte l'ancienne
clé. On chiffre TOUJOURS avec la clé active ; on déchiffre avec la clé active puis, à défaut,
avec l'ancienne (MultiFernet). Sans ancienne clé, le comportement est celui d'une clé unique.
Voir docs/biometric-key-rotation.md."""
from __future__ import annotations

import hashlib
import json
import struct

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from fastapi import HTTPException

from app.core.config import settings


def _key(value: str | None) -> str:
    return (value or "").strip()


def _build(key: str, label: str) -> Fernet:
    # Le message ne contient jamais la clé, seulement le nom de la variable en cause.
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        raise HTTPException(503, detail=f"Biométrie : clé de chiffrement invalide ({label})") from None


def _active() -> Fernet:
    """Clé active seule : celle qui chiffre, et la seule à subsister après une rotation."""
    key = _key(settings.biometric_template_key)
    if not key:
        raise HTTPException(503, detail="Biométrie : clé de chiffrement non configurée (BIOMETRIC_TEMPLATE_KEY)")
    return _build(key, "BIOMETRIC_TEMPLATE_KEY")


def _previous() -> Fernet | None:
    key = _key(settings.biometric_template_key_previous)
    if not key:
        return None
    if key == _key(settings.biometric_template_key):
        return None   # même clé des deux côtés : aucune transition en cours
    return _build(key, "BIOMETRIC_TEMPLATE_KEY_PREVIOUS")


def previous_key_configured() -> bool:
    key = _key(settings.biometric_template_key_previous)
    return bool(key) and key != _key(settings.biometric_template_key)


def _fernet() -> MultiFernet:
    # Une ancienne clé sans clé active ne suffit pas : _active() refuse d'abord.
    active, previous = _active(), _previous()
    return MultiFernet([active, previous] if previous else [active])


def key_id(which: str = "active") -> str | None:
    """Identifiant court et non réversible d'une clé, pour vérifier une configuration sans
    l'afficher. Ne permet pas de retrouver la clé."""
    key = _key(settings.biometric_template_key if which == "active" else settings.biometric_template_key_previous)
    return hashlib.sha256(b"atlas-biometric-key-id:" + key.encode()).hexdigest()[:8] if key else None


def readable_with_active_key(token: bytes | str) -> bool:
    """Vrai si la clé active SEULE déchiffre ce contenu (donc lisible après retrait de l'ancienne)."""
    try:
        _active().decrypt(token.encode() if isinstance(token, str) else bytes(token))
    except InvalidToken:
        return False
    return True


def reencrypt(token: bytes) -> bytes:
    """Rechiffre un contenu avec la clé active (l'horodatage Fernet d'origine est conservé).
    InvalidToken si aucune des clés configurées ne le déchiffre."""
    return _fernet().rotate(bytes(token))


def encrypt_vector(values: list[float]) -> bytes:
    return _fernet().encrypt(struct.pack(f"<{len(values)}f", *values))


def decrypt_vector(token: bytes) -> list[float]:
    try:
        raw = _fernet().decrypt(token)
    except InvalidToken:
        raise HTTPException(500, detail="Gabarit biométrique illisible (clé changée ?)") from None
    return list(struct.unpack(f"<{len(raw) // 4}f", raw))


def encrypt_bytes(data: bytes) -> bytes:
    """Chiffrement d'un contenu binaire temporaire (photo candidate d'une prise distante)."""
    return _fernet().encrypt(data)


def decrypt_bytes(token: bytes) -> bytes:
    try:
        return _fernet().decrypt(token)
    except InvalidToken:
        raise HTTPException(500, detail="Contenu chiffré illisible (clé changée ?)") from None


def encrypt_secret(data: dict) -> bytes:
    return _fernet().encrypt(json.dumps(data).encode())


def decrypt_secret(token: bytes | None) -> dict:
    if not token:
        return {}
    try:
        return json.loads(_fernet().decrypt(token))
    except InvalidToken:
        raise HTTPException(500, detail="Secret caméra illisible (clé changée ?)") from None


def seal(data: dict) -> str:
    """Jeton opaque chiffré et authentifié (Fernet, horodaté) : l'aperçu d'enrôlement y place
    le gabarit calculé, jamais lisible ni modifiable par le navigateur."""
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def unseal(token: str, ttl_seconds: int) -> dict:
    try:
        return json.loads(_fernet().decrypt(str(token or "").encode(), ttl=ttl_seconds))
    except (InvalidToken, ValueError):
        raise HTTPException(409, detail={"code": "ENROLLMENT_EXPIRED",
                                         "message": "Aperçu d'enrôlement expiré ou invalide — recommencez l'analyse"}) from None
