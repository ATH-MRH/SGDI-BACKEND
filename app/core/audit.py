from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.modules.auth.models import AuditEvent

logger = logging.getLogger("sgdi.audit")
_SENSITIVE = {"password", "password_hash", "passwordhash", "token", "secret", "authorization"}


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        clean: dict[Any, Any] = {}
        for key, item in value.items():
            normalized = str(key).lower().replace("_", "").replace("-", "")
            clean[key] = "[REDACTED]" if any(word.replace("_", "") in normalized for word in _SENSITIVE) else _redact(item)
        return clean
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    return value


def _safe_summary(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(_redact(value), ensure_ascii=False, default=str)[:4000]


def append_audit(db: Session, *, action: str, resource: str, result: str,
                 user: Any | None = None, request: Request | None = None,
                 resource_id: Any = None, society: Any = None,
                 old_state: Any = None, new_state: Any = None,
                 correlation_id: str | None = None) -> AuditEvent:
    correlation = correlation_id or (request.headers.get("x-correlation-id") if request else None) or uuid.uuid4().hex
    ip = request.client.host if request and request.client else None
    event = AuditEvent(
        user_id=getattr(user, "id", None), username=getattr(user, "username", None),
        action=action[:120], resource=resource[:120], resource_id=str(resource_id)[:180] if resource_id is not None else None,
        society=str(society)[:150] if society else None, result=result[:20], ip_address=ip,
        user_agent=(request.headers.get("user-agent", "")[:300] if request else None),
        old_state=_safe_summary(old_state), new_state=_safe_summary(new_state), correlation_id=correlation[:64],
    )
    db.add(event)
    db.flush()
    logger.info("audit action=%s resource=%s result=%s correlation_id=%s", action, resource, result, correlation)
    return event
