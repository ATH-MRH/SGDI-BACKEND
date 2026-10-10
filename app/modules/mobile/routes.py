"""Configuration publique lue par ATLAS MOBILE avant et après connexion.

Aucune donnée métier ni personnelle : uniquement ce dont l'application a besoin pour
savoir si sa version est encore acceptée. Tout vient de la configuration serveur ; sans
réglage, rien n'est imposé à l'application.
"""
import re

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.config import get_settings
from app.db.session import get_db
from app.modules.mobile import devices

router = APIRouter()

_VERSION = re.compile(r"^\d{1,4}(\.\d{1,4}){0,2}$")
_STORE_URL = re.compile(r"^https://(apps\.apple\.com|play\.google\.com)/\S+$")


def _version(value: str | None) -> str | None:
    text = (value or "").strip()
    return text if _VERSION.fullmatch(text) else None


def _store_url(value: str | None) -> str | None:
    text = (value or "").strip()
    return text if _STORE_URL.fullmatch(text) else None


@router.get("/config")
def mobile_config() -> dict:
    """Public par conception : l'application l'interroge avant toute authentification.

    Une valeur absente ou mal formée est renvoyée à `null` — jamais une valeur inventée,
    et jamais un blocage de l'application par une erreur de saisie côté serveur."""
    settings = get_settings()
    message = (settings.mobile_maintenance_message or "").strip()[:300] or None
    return {
        "min_supported_version": {
            "ios": _version(settings.mobile_min_version_ios),
            "android": _version(settings.mobile_min_version_android),
        },
        "recommended_version": {
            "ios": _version(settings.mobile_recommended_version_ios),
            "android": _version(settings.mobile_recommended_version_android),
        },
        "maintenance": {
            "enabled": bool(settings.mobile_maintenance_enabled),
            "message": message if settings.mobile_maintenance_enabled else None,
        },
        "store_urls": {
            "ios": _store_url(settings.mobile_store_url_ios),
            "android": _store_url(settings.mobile_store_url_android),
        },
    }


class DeviceIn(BaseModel):
    push_token: str = Field(min_length=10, max_length=255)
    provider: Literal["expo", "apns", "fcm"]
    platform: Literal["ios", "android"]
    environment: Literal["development", "staging", "production"]
    app_version: str | None = Field(default=None, max_length=20, pattern=r"^[0-9A-Za-z.\-+]*$")


class DeviceRevokeIn(BaseModel):
    push_token: str = Field(min_length=10, max_length=255)


@router.post("/devices")
def register_device(payload: DeviceIn, request: Request, identity=Depends(devices.session_user), db: Session = Depends(get_db)) -> dict:
    """Enregistre l'appareil du compte connecté pour les notifications push.

    Le jeton d'appareil n'est jamais renvoyé ni journalisé."""
    user, session = identity
    if not devices.valid_push_token(payload.provider, payload.push_token):
        raise HTTPException(status_code=422, detail="Jeton d'appareil invalide")
    device = devices.register_device(
        db, user, session, push_token=payload.push_token, provider=payload.provider, platform=payload.platform,
        environment=payload.environment, app_version=payload.app_version or None,
    )
    append_audit(db, action="mobile.device_register", resource="mobile_device", resource_id=device.id, result="success",
                 user=user, request=request, new_state={"platform": device.platform, "environment": device.environment})
    db.commit()
    return {"ok": True, "id": device.id}


@router.post("/devices/revoke")
def revoke_device(payload: DeviceRevokeIn, identity=Depends(devices.session_user), db: Session = Depends(get_db)) -> dict:
    user, _session = identity
    revoked = devices.revoke_device(db, user, payload.push_token)
    db.commit()
    return {"ok": True, "revoked": revoked}
