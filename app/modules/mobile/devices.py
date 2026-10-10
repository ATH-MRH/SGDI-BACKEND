"""Registre des appareils ATLAS MOBILE pour les notifications push.

Ce module n'envoie rien : il tient à jour QUI peut recevoir une notification. L'envoi
(APNs / FCM) demande des identifiants de production et reste à brancher sur `active_devices`.
"""
from __future__ import annotations

import re
from datetime import datetime

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_token_payload, security
from app.modules.auth.models import AuthSession, User
from app.modules.auth.sessions import SESSION_CLAIM, ensure_session_active
from app.modules.mobile.models import MobileDevice

_TOKEN_FORMATS = {
    "expo": re.compile(r"^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,80}\]$"),
    "apns": re.compile(r"^[0-9a-fA-F]{64,200}$"),
    "fcm": re.compile(r"^[A-Za-z0-9_:\-]{100,255}$"),
}


def valid_push_token(provider: str, token: str) -> bool:
    pattern = _TOKEN_FORMATS.get(provider)
    return bool(pattern and pattern.fullmatch(token))


def session_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> tuple[User, AuthSession | None]:
    """Utilisateur staff actif et sa session mobile.

    Volontairement sans contrôle de module ni d'action : enregistrer SON appareil n'est
    pas une action métier, et un compte en lecture seule doit pouvoir recevoir ses alertes."""
    payload = current_token_payload(credentials)
    try:
        ensure_session_active(db, payload)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expirée")
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur inactif")
    session = None
    if payload.get(SESSION_CLAIM):
        session = db.execute(select(AuthSession).where(AuthSession.public_id == payload[SESSION_CLAIM])).scalar_one_or_none()
    return user, session


def register_device(db: Session, user: User, session: AuthSession | None, *, push_token: str, provider: str,
                    platform: str, environment: str, app_version: str | None) -> MobileDevice:
    now = datetime.utcnow()
    # Un jeton d'appareil suit le dernier compte connecté sur ce téléphone : l'ancien
    # propriétaire ne reçoit plus rien dessus.
    values = dict(
        user_id=user.id, session_id=session.id if session else None, provider=provider, platform=platform,
        environment=environment, app_version=app_version, last_seen_at=now, revoked_at=None,
    )
    by_token = select(MobileDevice).where(MobileDevice.push_token == push_token)
    device = db.execute(by_token).scalar_one_or_none()
    if device is None:
        try:
            # Point de sauvegarde : deux enregistrements simultanés du même jeton ne doivent
            # ni échouer ni créer deux lignes.
            with db.begin_nested():
                device = MobileDevice(push_token=push_token, created_at=now, **values)
                db.add(device)
                db.flush()
            return device
        except IntegrityError:
            device = db.execute(by_token).scalar_one()
    for name, value in values.items():
        setattr(device, name, value)
    db.flush()
    return device


def revoke_device(db: Session, user: User, push_token: str) -> bool:
    changed = db.execute(
        update(MobileDevice)
        .where(MobileDevice.push_token == push_token, MobileDevice.user_id == user.id, MobileDevice.revoked_at.is_(None))
        .values(revoked_at=datetime.utcnow())
    ).rowcount
    return changed > 0


def active_devices(db: Session, user_id: int, *, environment: str) -> list[MobileDevice]:
    """Appareils à notifier : non révoqués, et dont la session est toujours valide."""
    now = datetime.utcnow()
    rows = db.execute(
        select(MobileDevice, AuthSession)
        .join(AuthSession, AuthSession.id == MobileDevice.session_id)
        .where(MobileDevice.user_id == user_id, MobileDevice.environment == environment, MobileDevice.revoked_at.is_(None))
    ).all()
    return [device for device, session in rows if session.revoked_at is None and session.expires_at > now and session.user_id == user_id]
