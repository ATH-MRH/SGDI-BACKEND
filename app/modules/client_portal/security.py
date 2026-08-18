import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, decode_token
from app.db.session import get_db
from app.modules.client_portal.models import ClientPortalUser


CLIENT_PORTAL_TOKEN_TTL_MINUTES = 60 * 12  # 12 heures : session de travail, pas un accès permanent.

_security = HTTPBearer(auto_error=False)


def generate_temporary_password() -> str:
    # Lisible/copiable à la main par un admin qui la communique par téléphone/email au
    # client, sans caractères ambigus (0/O, 1/l).
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


def create_client_portal_token(user: ClientPortalUser) -> str:
    return create_access_token(
        str(user.id),
        claims={"client_portal": True, "client_id": user.client_id},
        ttl_minutes=CLIENT_PORTAL_TOKEN_TTL_MINUTES,
    )


def current_client_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
    db: Session = Depends(get_db),
) -> ClientPortalUser:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token manquant")
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide")
    if not payload.get("client_portal"):
        # Empêche explicitement un token émis pour un autre système (portail RH, staff
        # interne) d'être accepté ici même s'il est par ailleurs valide/signé.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide")
    user = db.execute(
        select(ClientPortalUser).where(ClientPortalUser.id == int(payload["sub"]))
    ).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Compte inactif")
    return user
