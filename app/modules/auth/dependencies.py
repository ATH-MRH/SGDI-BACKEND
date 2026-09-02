from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.modules.auth.models import User
from app.modules.auth.service import get_user


security = HTTPBearer(auto_error=False)

AUTHORIZED_ACTIONS = {"read", "create", "update", "validate", "delete", "export", "unlock", "admin"}


def request_action(request: Request) -> str:
    """Traduit une opération HTTP en action métier administrable par utilisateur."""
    method = request.method.upper()
    path = request.url.path.lower()
    if any(part in path for part in ("/export", "/download", "/pdf")):
        return "export"
    if any(part in path for part in ("/validate", "/valider", "/approve", "/refuse", "/close", "/payer", "/recruit", "/convertir", "/annuler")):
        return "validate"
    if any(part in path for part in ("/unlock", "/deverrou", "/déverrou")):
        return "unlock"
    if path.startswith("/api/auth/users") or path.startswith("/api/auth/access-rules"):
        return "admin" if method not in {"GET", "HEAD", "OPTIONS"} else "read"
    return {"GET": "read", "HEAD": "read", "OPTIONS": "read", "POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}.get(method, "read")


def current_token_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token manquant")
    try:
        return decode_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide")


def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    payload = current_token_payload(credentials)
    user = get_user(db, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur inactif")
    actions = [str(value).strip().lower() for value in (user.authorized_actions or [])]
    actions = [value for value in actions if value in AUTHORIZED_ACTIONS]
    if actions and request_action(request) not in actions and "admin" not in actions:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Action non autorisée : {request_action(request)}")
    return user
