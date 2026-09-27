"""Migration des photos à nom prévisible (/uploads/photos/<MATRICULE>.jpg) vers des noms
imprévisibles (URL-capacités), références mises à jour partout où elles sont stockées :
Employee.extra, Candidate.data et collections génériques (sgdi_records.data).

Simulation par défaut. Ordre d'exploitation : sauvegarde → simulation → --apply →
PHOTOS_REQUIRE_UNGUESSABLE_NAMES=true. Voir scripts/rename_public_photos.py.
"""
from __future__ import annotations

import re
import secrets
from typing import Any

from sqlalchemy.orm import Session

from app.core.photo_storage import PHOTOS_DIR, PUBLIC_PHOTO_PREFIX

UNGUESSABLE = re.compile(r"^[A-Za-z0-9_.-]+-[0-9a-f]{32}\.[A-Za-z0-9]+$")
PHOTO_URL = re.compile(re.escape(PUBLIC_PHOTO_PREFIX) + r"/([^/?\"']+)")


def _walk(value: Any, found: set[str]) -> None:
    if isinstance(value, str):
        for name in PHOTO_URL.findall(value):
            if not UNGUESSABLE.match(name):
                found.add(name)
    elif isinstance(value, dict):
        for v in value.values():
            _walk(v, found)
    elif isinstance(value, list):
        for v in value:
            _walk(v, found)


def _replace(value: Any, mapping: dict[str, str]) -> Any:
    if isinstance(value, str):
        return PHOTO_URL.sub(lambda m: f"{PUBLIC_PHOTO_PREFIX}/{mapping.get(m.group(1), m.group(1))}", value)
    if isinstance(value, dict):
        return {k: _replace(v, mapping) for k, v in value.items()}
    if isinstance(value, list):
        return [_replace(v, mapping) for v in value]
    return value


def _sources(db: Session):
    from app.modules.drh.models import Candidate, Employee
    from app.modules.irongs.models import SgdiRecord

    return ((Employee, "extra"), (Candidate, "data"), (SgdiRecord, "data"))


def migrate_public_photos(db: Session, *, apply: bool = False) -> dict[str, Any]:
    """Renvoie le plan (et l'applique si apply=True). Idempotent : un nom déjà imprévisible
    n'est jamais retouché ; une référence vers un fichier absent est signalée, pas inventée."""
    found: set[str] = set()
    rows = []
    for model, column in _sources(db):
        for row in db.query(model).yield_per(500):
            value = getattr(row, column)
            before = len(found)
            _walk(value, found)
            if len(found) != before or (value and PHOTO_URL.search(str(value))):
                rows.append((row, column))
    mapping: dict[str, str] = {}
    missing: list[str] = []
    for name in sorted(found):
        stem, dot, ext = name.rpartition(".")
        mapping[name] = f"{stem or name}-{secrets.token_hex(16)}.{ext if dot else 'jpg'}"
        if not (PHOTOS_DIR / name).is_file():
            missing.append(name)
    plan = {"photos": len(mapping), "renamed": dict(mapping), "missing_files": missing, "references_rows": 0, "applied": apply}
    changed_rows = []
    for row, column in rows:
        value = getattr(row, column)
        new = _replace(value, mapping)
        if new != value:
            changed_rows.append((row, column, new))
    plan["references_rows"] = len(changed_rows)
    if not apply:
        return plan
    for old, new in mapping.items():
        source = PHOTOS_DIR / old
        if source.is_file():
            source.rename(PHOTOS_DIR / new)
    for row, column, new in changed_rows:
        setattr(row, column, new)
    db.commit()
    return plan
