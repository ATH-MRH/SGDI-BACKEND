from __future__ import annotations

import base64
import binascii
import logging
import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

logger = logging.getLogger("sgdi.photos")
UPLOADS_ROOT = Path(os.getenv("SGDI_UPLOADS_DIR", "/app/uploads"))
PHOTOS_DIR = UPLOADS_ROOT / "photos"
PUBLIC_PHOTO_PREFIX = "/uploads/photos"
_DATA_URL_RE = re.compile(r"^data:image/[^;]+;base64,", re.IGNORECASE)
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def ensure_upload_dirs() -> None:
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)


def is_base64_photo(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    text = value.strip()
    return text.startswith("data:image/") or (len(text) > 500 and not text.startswith(("/", "http://", "https://")))


def _candidate_photo_name(item: dict[str, Any], fallback: str | None = None) -> str:
    for key in ("matricule", "code", "employeeCode", "numero", "id", "backendId", "nin"):
        value = item.get(key)
        if value not in (None, "", "None", "undefined", "null"):
            name = _SAFE_NAME_RE.sub("_", str(value).strip()).strip("._")
            if name:
                return name[:90]
    if fallback:
        name = _SAFE_NAME_RE.sub("_", str(fallback).strip()).strip("._")
        if name:
            return name[:90]
    return "photo"


def save_base64_photo(value: str, item: dict[str, Any] | None = None, fallback: str | None = None) -> str:
    item = item or {}
    text = value.strip()
    if not is_base64_photo(text):
        return text
    raw = _DATA_URL_RE.sub("", text)
    try:
        content = base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError) as exc:
        logger.warning("Photo Base64 invalide ignoree: %s", exc)
        return ""
    if not content:
        return ""
    ensure_upload_dirs()
    name = _candidate_photo_name(item, fallback)
    path = PHOTOS_DIR / f"{name}.jpg"
    path.write_bytes(content)
    return f"{PUBLIC_PHOTO_PREFIX}/{name}.jpg"


def normalize_photo_fields(value: Any, fallback: str | None = None) -> Any:
    if isinstance(value, list):
        return [normalize_photo_fields(item, fallback=f"{fallback or 'row'}_{idx:06d}") for idx, item in enumerate(value)]
    if not isinstance(value, dict):
        return deepcopy(value)
    item = deepcopy(value)
    item_fallback = str(item.get("matricule") or item.get("code") or item.get("id") or fallback or "")
    photo = item.get("photo")
    if is_base64_photo(photo):
        item["photo"] = save_base64_photo(photo, item, item_fallback)
    return item
