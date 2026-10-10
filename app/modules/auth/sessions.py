"""Sessions renouvelables d'ATLAS MOBILE : refresh token à rotation et révocation serveur.

Le web garde son jeton staff autonome, inchangé. Une session mobile ajoute :
- un jeton d'accès staff COURT, lié à la session par le claim `sid` ;
- un refresh token opaque, à usage unique, dont seul le condensat SHA-256 est stocké.

Révoquer la session invalide immédiatement tous ses jetons d'accès. Présenter un refresh
token déjà consommé révoque la session entière : c'est le signe d'une copie du jeton.

Le refresh token porte l'identifiant de sa session et un sceau du serveur. Tout jeton
authentique qui n'est plus le jeton courant de sa session est donc reconnu comme tel,
quelle que soit son ancienneté, sans conserver l'historique des jetons émis.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, STAFF_TOKEN_USE, TOKEN_USE_CLAIM
from app.modules.auth.models import AuthSession, User

SESSION_CLAIM = "sid"
PLATFORMS = frozenset({"ios", "android"})


class SessionError(ValueError):
    """Refresh token ou session refusés ; `reason` alimente le journal d'audit, jamais la réponse."""

    def __init__(self, reason: str, session: AuthSession | None = None):
        super().__init__(reason)
        self.reason = reason
        self.session = session


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _seal(public_id: str, secret: str) -> str:
    """Sceau du serveur : prouve qu'un refresh token a bien été émis pour cette session."""
    message = f"atlas-mobile-refresh-v1|{public_id}|{secret}".encode("utf-8")
    mac = hmac.new(settings.jwt_secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode("ascii")


def _new_refresh_token(public_id: str) -> str:
    secret = secrets.token_urlsafe(32)
    return f"{public_id}.{secret}.{_seal(public_id, secret)}"


def _session_id_of(refresh_token: str) -> str | None:
    """Identifiant de session d'un refresh token émis par ce serveur, sinon None."""
    parts = (refresh_token or "").split(".")
    if len(parts) != 3 or not all(parts):
        return None
    public_id, secret, seal = parts
    return public_id if hmac.compare_digest(seal, _seal(public_id, secret)) else None


def _clean(value: str | None, limit: int) -> str | None:
    text = "".join(ch for ch in (value or "").strip() if ch.isprintable())[:limit]
    return text or None


def _access_token(user: User, session: AuthSession) -> str:
    return create_access_token(
        str(user.id),
        {"role": user.role, "username": user.username, TOKEN_USE_CLAIM: STAFF_TOKEN_USE, SESSION_CLAIM: session.public_id},
        ttl_minutes=settings.mobile_access_token_minutes,
    )


def _tokens(user: User, session: AuthSession, refresh_token: str, now: datetime) -> dict[str, Any]:
    return {
        "access_token": _access_token(user, session),
        "token_type": "bearer",
        "expires_in": settings.mobile_access_token_minutes * 60,
        "refresh_token": refresh_token,
        "refresh_expires_in": max(0, int((session.expires_at - now).total_seconds())),
    }


def _refresh_deadline(session_created_at: datetime, now: datetime) -> datetime:
    """Échéance glissante, bornée par la durée de vie maximale de la session."""
    idle = now + timedelta(days=settings.mobile_refresh_token_days)
    absolute = session_created_at + timedelta(days=settings.mobile_session_max_days)
    return min(idle, absolute)


# Une session morte est gardée un temps pour l'analyse d'un incident, puis supprimée.
DEAD_SESSION_RETENTION = timedelta(days=30)


def purge_dead_sessions(db: Session, user_id: int | None = None, *, now: datetime | None = None) -> int:
    """Supprime les sessions révoquées ou expirées depuis plus de 30 jours.

    Appelée à chaque connexion mobile pour le compte concerné ; sans `user_id`, nettoie
    toute la table (tâche de maintenance)."""
    limit = (now or datetime.utcnow()) - DEAD_SESSION_RETENTION
    statement = delete(AuthSession).where(or_(AuthSession.expires_at < limit, AuthSession.revoked_at < limit))
    if user_id is not None:
        statement = statement.where(AuthSession.user_id == user_id)
    return db.execute(statement).rowcount


def open_session(db: Session, user: User, *, platform: str | None, app_version: str | None) -> dict[str, Any]:
    now = datetime.utcnow()
    purge_dead_sessions(db, user.id, now=now)
    public_id = secrets.token_urlsafe(18)
    refresh_token = _new_refresh_token(public_id)
    platform = (platform or "").strip().lower()
    session = AuthSession(
        public_id=public_id,
        user_id=user.id,
        refresh_hash=_digest(refresh_token),
        platform=platform if platform in PLATFORMS else None,
        app_version=_clean(app_version, 20),
        created_at=now,
        last_used_at=now,
        expires_at=_refresh_deadline(now, now),
    )
    db.add(session)
    db.flush()
    return _tokens(user, session, refresh_token, now)


def _revoke_for_reuse(db: Session, session: AuthSession, now: datetime) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.id == session.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now, revoked_reason="refresh_reuse")
    )
    db.flush()


def rotate_session(db: Session, refresh_token: str, *, app_version: str | None = None) -> tuple[dict[str, Any], User, AuthSession]:
    """Consomme un refresh token et en délivre un nouveau. Lève SessionError sinon.

    Un refresh token ne sert qu'une fois. En présenter un qui n'est plus le jeton courant
    de sa session révoque cette session, et elle seule."""
    now = datetime.utcnow()
    public_id = _session_id_of(refresh_token)
    if public_id is None:
        raise SessionError("unknown_refresh_token")
    session = db.execute(select(AuthSession).where(AuthSession.public_id == public_id)).scalar_one_or_none()
    if session is None:
        raise SessionError("unknown_refresh_token")
    if session.revoked_at is not None:
        raise SessionError("session_revoked", session)
    if session.expires_at <= now:
        raise SessionError("session_expired", session)
    digest = _digest(refresh_token)
    if not hmac.compare_digest(session.refresh_hash, digest):
        _revoke_for_reuse(db, session, now)
        raise SessionError("refresh_reuse", session)
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        session.revoked_at = now
        session.revoked_reason = "user_inactive"
        db.flush()
        raise SessionError("user_inactive", session)

    new_refresh = _new_refresh_token(session.public_id)
    # Mise à jour conditionnelle : de deux requêtes concurrentes portant le même refresh
    # token, une seule le consomme. L'autre présente alors un jeton déjà consommé.
    consumed = db.execute(
        update(AuthSession)
        .where(AuthSession.id == session.id, AuthSession.refresh_hash == digest, AuthSession.revoked_at.is_(None))
        .values(
            refresh_hash=_digest(new_refresh), previous_refresh_hash=digest, last_used_at=now,
            expires_at=_refresh_deadline(session.created_at, now),
            app_version=_clean(app_version, 20) or session.app_version,
        )
    ).rowcount
    if consumed != 1:
        _revoke_for_reuse(db, session, now)
        raise SessionError("refresh_reuse", session)
    db.flush()
    db.refresh(session)
    return _tokens(user, session, new_refresh, now), user, session


def revoke_session(db: Session, public_id: str, reason: str) -> bool:
    now = datetime.utcnow()
    changed = db.execute(
        update(AuthSession)
        .where(AuthSession.public_id == public_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now, revoked_reason=reason[:40])
    ).rowcount
    return changed > 0


def revoke_user_sessions(db: Session, user_id: int, reason: str) -> int:
    """À appeler quand le mot de passe change ou que le compte est désactivé."""
    return db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.utcnow(), revoked_reason=reason[:40])
    ).rowcount


def ensure_session_active(db: Session, payload: dict[str, Any]) -> None:
    """Refuse un jeton d'accès dont la session a été révoquée ou a expiré.

    Un jeton sans `sid` (web) n'est lié à aucune session : rien à vérifier."""
    if SESSION_CLAIM not in payload:
        return
    public_id = payload[SESSION_CLAIM]
    session = None
    if isinstance(public_id, str) and public_id:
        session = db.execute(select(AuthSession).where(AuthSession.public_id == public_id)).scalar_one_or_none()
    if (
        session is None
        or session.revoked_at is not None
        or session.expires_at <= datetime.utcnow()
        or str(session.user_id) != str(payload.get("sub"))
    ):
        raise ValueError("Session révoquée")
