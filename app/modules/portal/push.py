from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.modules.irongs import service


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def get_or_create_vapid_keys(db: Session) -> dict[str, str]:
    items = service.list_items(db, "vapidSettings")
    existing = next((s for s in items if isinstance(s, dict) and s.get("id") == "vapid"), None)
    if existing:
        return {"private_key": existing["private_key"], "public_key": existing["public_key"]}

    from cryptography.hazmat.primitives.asymmetric.ec import generate_private_key, SECP256R1
    from cryptography.hazmat.primitives.serialization import (
        Encoding, NoEncryption, PrivateFormat, PublicFormat,
    )

    key = generate_private_key(SECP256R1())
    private_pem = key.private_bytes(Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption()).decode()
    public_raw = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)

    record = {
        "id": "vapid",
        "private_key": private_pem,
        "public_key": _b64url(public_raw),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    service.create_item(db, "vapidSettings", record)
    return {"private_key": record["private_key"], "public_key": record["public_key"]}


def send_push(subscription: dict[str, Any], payload: dict[str, Any], private_key: str) -> bool:
    try:
        from pywebpush import webpush  # type: ignore[import]
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=private_key,
            vapid_claims={"sub": "mailto:portail@irongs.com"},
        )
        return True
    except Exception:
        return False
