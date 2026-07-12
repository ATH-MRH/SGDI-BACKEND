from __future__ import annotations

import base64
import binascii
import logging
import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger("sgdi.photos")
UPLOADS_ROOT = Path(os.getenv("SGDI_UPLOADS_DIR", "/app/uploads"))
PHOTOS_DIR = UPLOADS_ROOT / "photos"
# Les documents vont SOUS photos/ (et non directement sous /app/uploads) : ce dossier
# est deja provisionne et inscriptible par l'utilisateur de l'app, alors que la racine
# /app/uploads appartient a root (volume monte) -> creer un dossier a la racine echoue.
# Le frontend sert et affiche les URLs /uploads/... de la meme facon.
DOCS_DIR = PHOTOS_DIR / "docs"
PUBLIC_PHOTO_PREFIX = "/uploads/photos"
PUBLIC_DOC_PREFIX = "/uploads/photos/docs"
_DATA_URL_RE = re.compile(r"^data:image/[^;]+;base64,", re.IGNORECASE)
# En-tête d'un data:URL = tout jusqu'à la PREMIÈRE virgule. Peut contenir des
# paramètres (ex. data:text/html;charset=utf-8,... ou data:application/pdf;base64,...).
# On capture l'en-tête entier puis on en déduit le mime et l'encodage.
_DATA_ANY_RE = re.compile(r"^data:([^,]*),", re.IGNORECASE)
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")
_MIME_EXT = {
    "application/pdf": "pdf", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "image/svg+xml": "svg", "text/html": "html", "text/plain": "txt",
}


def ensure_upload_dirs() -> None:
    """Crée les dossiers d'upload si possible. BEST-EFFORT : ne fait JAMAIS planter le
    démarrage. Si le volume /app/uploads n'est pas inscriptible par l'utilisateur de
    l'app (dossier appartenant à root), on log et on continue — l'écriture des fichiers
    retombera proprement sur la conservation en base (save_base64_* renvoie l'original)."""
    for directory in (PHOTOS_DIR, DOCS_DIR):
        try:
            directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.warning("Dossier upload %s non cree (%s) : sera gere a la demande.", directory, exc)


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
    if len(content) > settings.max_photo_upload_bytes:
        logger.warning("Photo Base64 ignoree: taille %s octets > limite %s", len(content), settings.max_photo_upload_bytes)
        return ""
    ensure_upload_dirs()
    name = _candidate_photo_name(item, fallback)
    path = PHOTOS_DIR / f"{name}.jpg"
    path.write_bytes(content)
    return f"{PUBLIC_PHOTO_PREFIX}/{name}.jpg"


def save_base64_document(data_url: str, name_base: str) -> tuple[str, bool]:
    """Écrit un document data:URL sur le disque persistant, renvoie (url_publique, True).

    Ne perd JAMAIS un document : si l'URL n'est pas un data: décodable, ou en cas
    d'erreur, renvoie (valeur d'origine, False) — le base64 reste en base plutôt que
    d'être perdu. Le frontend affiche déjà les URLs /uploads/... sans modification.
    """
    if not isinstance(data_url, str):
        return data_url, False
    text = data_url.strip()
    m = _DATA_ANY_RE.match(text)
    if not m:
        return data_url, False  # déjà une URL (/uploads, http) ou autre : on ne touche pas
    header = m.group(1) or ""              # ex. "text/html;charset=utf-8" ou "application/pdf;base64"
    is_b64 = ";base64" in header.lower()   # base64 vs pourcent-encodé
    mime = header.split(";")[0].strip().lower()
    payload = text[m.end():]
    try:
        if is_b64:
            content = base64.b64decode(payload, validate=False)
        else:
            from urllib.parse import unquote_to_bytes
            content = unquote_to_bytes(payload)
    except (binascii.Error, ValueError) as exc:
        logger.warning("Document data:URL invalide conserve en base: %s", exc)
        return data_url, False
    if not content:
        return data_url, False
    ext = _MIME_EXT.get(mime, "bin")
    safe = _SAFE_NAME_RE.sub("_", str(name_base or "doc")).strip("._")[:110] or "doc"
    try:
        ensure_upload_dirs()
        (DOCS_DIR / f"{safe}.{ext}").write_bytes(content)
    except OSError as exc:
        logger.warning("Ecriture document echouee, base64 conserve en base: %s", exc)
        return data_url, False
    return f"{PUBLIC_DOC_PREFIX}/{safe}.{ext}", True


def externalize_employee_documents(documents: Any, fallback: str) -> Any:
    """Déplace le base64 des documents (clé .url en data:URL) vers le disque.

    documents = map {typeDoc: {url, name, ...}}. Renvoie une NOUVELLE map où chaque
    .url en data:URL est remplacée par /uploads/docs/... . Tout ce qui n'est pas un
    data:URL (déjà externalisé, http, vide) est laissé tel quel. Ne perd aucun document.
    """
    if not isinstance(documents, dict):
        return documents
    out: dict[str, Any] = {}
    for key, entry in documents.items():
        if not isinstance(entry, dict):
            out[key] = entry
            continue
        new_entry = deepcopy(entry)
        url = new_entry.get("url")
        if isinstance(url, str) and url.startswith("data:"):
            safe_key = _SAFE_NAME_RE.sub("_", str(key)).strip("._")[:60] or "doc"
            new_url, saved = save_base64_document(url, f"{fallback}_{safe_key}")
            if saved:
                new_entry["url"] = new_url
        out[key] = new_entry
    return out


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
