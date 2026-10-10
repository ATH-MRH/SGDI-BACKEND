"""Accès mobile EMPLOYÉ : une famille de jetons à part, limitée au libre-service.

`token_use = "employee_mobile"` n'est accepté par aucune route staff, portail web, portail
client, QR de pointage ou flux SSE — et les routes de ce module n'acceptent que lui.
Le sujet du jeton est l'identifiant de la FICHE EMPLOYÉ : aucune route ne prend d'identifiant
d'employé en paramètre, on ne peut donc lire que ses propres données.
"""
from __future__ import annotations

import hashlib
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import TOKEN_USE_CLAIM, create_access_token, decode_token
from app.db.session import get_db
from app.modules.auth.dependencies import security
from app.modules.drh.models import Employee

EMPLOYEE_MOBILE_TOKEN_USE = "employee_mobile"
# Exactement ces claims : tout autre désigne une autre famille de jetons.
_CLAIMS = frozenset({"sub", "exp", TOKEN_USE_CLAIM, "acc", "pv"})

_REFUSED = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expirée. Reconnectez-vous.")


def password_version(account: dict[str, Any]) -> str:
    """Empreinte courte de l'état du mot de passe : changer le mot de passe invalide les jetons émis."""
    material = f"{account.get('passwordHash', '')}|{account.get('passwordChangedAt', '')}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def create_employee_token(employee: Employee, account: dict[str, Any]) -> str:
    return create_access_token(
        str(employee.id),
        {TOKEN_USE_CLAIM: EMPLOYEE_MOBILE_TOKEN_USE, "acc": str(account.get("id") or ""), "pv": password_version(account)},
        ttl_minutes=settings.employee_mobile_token_minutes,
    )


def is_employee_mobile_payload(payload: dict[str, Any]) -> bool:
    subject = payload.get("sub")
    return (
        payload.get(TOKEN_USE_CLAIM) == EMPLOYEE_MOBILE_TOKEN_USE
        and set(payload) == _CLAIMS
        and isinstance(subject, str) and subject.isascii() and subject.isdigit()
        and isinstance(payload.get("exp"), int)
        and isinstance(payload.get("acc"), str) and bool(payload["acc"])
        and isinstance(payload.get("pv"), str)
    )


def current_employee(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> Employee:
    """Fiche employé du jeton présenté, revérifiée à CHAQUE requête : compte toujours actif,
    mot de passe inchangé, toujours rattaché à cette fiche, salarié non bloqué."""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token manquant")
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        raise _REFUSED
    if not is_employee_mobile_payload(payload):
        raise _REFUSED

    # Imports différés : le portail importe déjà une grande partie de l'application.
    from app.modules.irongs import service
    from app.modules.portal.routes import _employee_portal_block_reason

    try:
        account = service.get_item(db, "portalAccounts", payload["acc"])
    except HTTPException:
        raise _REFUSED
    employee = db.get(Employee, int(payload["sub"]))
    if (
        employee is None
        or not account.get("active")
        or account.get("mustChangePassword")
        or str(account.get("matricule") or "") != employee.code
        or password_version(account) != payload["pv"]
    ):
        raise _REFUSED
    if _employee_portal_block_reason(employee):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès suspendu pour ce compte")
    return employee
