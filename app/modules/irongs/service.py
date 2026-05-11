import logging
from copy import deepcopy
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.modules.irongs.models import SgdiRecord
from app.modules.irongs import sql_bridge
from app.core.photo_storage import normalize_photo_fields

logger = logging.getLogger("sgdi.records")
OBJECT_ITEM_ID = "__object__"


def _invalid_item_id(value: Any) -> bool:
    return value in (None, "", "None", "none", "null", "undefined")


def _ensure_id(item: dict[str, Any], collection: str, fallback: str | None = None) -> dict[str, Any]:
    if not _invalid_item_id(item.get("id")):
        item["id"] = str(item["id"])
        return item
    prefix = "".join(part[0] for part in collection.split("_"))[:3] or "row"
    item["id"] = fallback or f"{prefix}_{abs(hash(str(item))) % 10_000_000}"
    return item


def _unique_item_id(base: str, used: set[str], position: int) -> str:
    candidate = base if not _invalid_item_id(base) else f"idx-{position:06d}"
    candidate = str(candidate)
    if candidate not in used:
        used.add(candidate)
        return candidate
    candidate = f"{candidate}-{position:06d}"
    while candidate in used:
        candidate = f"{candidate}-x"
    used.add(candidate)
    return candidate


def _row_item_id(collection: str, item: Any, position: int, used: set[str] | None = None) -> str:
    used = used if used is not None else set()
    if isinstance(item, dict):
        item = _ensure_id(dict(item), collection, f"idx-{position:06d}")
        return _unique_item_id(str(item["id"]), used, position)
    return _unique_item_id(f"idx-{position:06d}", used, position)


def _collection_rows(db: Session, name: str) -> list[SgdiRecord]:
    return db.execute(
        select(SgdiRecord)
        .where(SgdiRecord.collection == name)
        .order_by(SgdiRecord.position.asc(), SgdiRecord.id.asc())
    ).scalars().all()


def get_database(db: Session) -> dict[str, list[Any] | dict[str, Any]]:
    rows = db.execute(select(SgdiRecord).order_by(SgdiRecord.collection.asc(), SgdiRecord.position.asc(), SgdiRecord.id.asc())).scalars().all()
    grouped: dict[str, list[SgdiRecord]] = {}
    for row in rows:
        if row.collection in sql_bridge.SQL_COLLECTIONS:
            continue
        grouped.setdefault(row.collection, []).append(row)
    result: dict[str, list[Any] | dict[str, Any]] = {}
    for name, items in grouped.items():
        if len(items) == 1 and items[0].kind == "object" and items[0].item_id == OBJECT_ITEM_ID:
            result[name] = deepcopy(items[0].data) if isinstance(items[0].data, dict) else {}
        else:
            result[name] = [deepcopy(row.data) for row in items if row.kind == "item"]
    for name in sorted(sql_bridge.SQL_COLLECTIONS):
        result[name] = sql_bridge.list_collection(db, name)
    return result


def replace_database(db: Session, payload: dict[str, list[Any] | dict[str, Any]]) -> dict[str, list[Any] | dict[str, Any]]:
    db.execute(delete(SgdiRecord))
    logger.info("Remplacement base SGDI API-first: %s collection(s)", len(payload))
    for name, data in payload.items():
        if name in sql_bridge.SQL_COLLECTIONS:
            if isinstance(data, list) and (data or name not in sql_bridge.SQL_SKIP_EMPTY_ON_DB_REPLACE):
                sql_bridge.replace_collection(db, name, data)
            continue
        _replace_collection_no_commit(db, name, data)
    db.commit()
    logger.info("Base SGDI sauvegardée: tables SQL métier + sgdi_records résiduel")
    return get_database(db)


def get_collection(db: Session, name: str) -> list[Any] | dict[str, Any]:
    if name in sql_bridge.SQL_COLLECTIONS:
        return sql_bridge.list_collection(db, name)
    rows = _collection_rows(db, name)
    if not rows:
        return []
    if len(rows) == 1 and rows[0].kind == "object" and rows[0].item_id == OBJECT_ITEM_ID:
        return deepcopy(rows[0].data) if isinstance(rows[0].data, dict) else {}
    return [deepcopy(row.data) for row in rows if row.kind == "item"]


def _replace_collection_no_commit(db: Session, name: str, data: list[Any] | dict[str, Any] | Any) -> None:
    db.execute(delete(SgdiRecord).where(SgdiRecord.collection == name))
    clean_data = normalize_photo_fields(data, fallback=name)
    if isinstance(clean_data, list):
        used_ids: set[str] = set()
        for idx, item in enumerate(clean_data):
            stored = deepcopy(item)
            if isinstance(stored, dict):
                stored = _ensure_id(stored, name, f"idx-{idx:06d}")
            item_id = _row_item_id(name, stored, idx, used_ids)
            if isinstance(stored, dict):
                stored["id"] = item_id
            db.add(SgdiRecord(collection=name, item_id=item_id, position=idx, kind="item", data=stored, label=str(stored.get("nom") or stored.get("name") or stored.get("code") or "") if isinstance(stored, dict) else str(stored)))
    else:
        db.add(SgdiRecord(collection=name, item_id=OBJECT_ITEM_ID, position=0, kind="object", data=clean_data, label=name))


def replace_collection(db: Session, name: str, data: list[Any] | dict[str, Any]) -> list[Any] | dict[str, Any]:
    if name in sql_bridge.SQL_COLLECTIONS:
        db.execute(delete(SgdiRecord).where(SgdiRecord.collection == name))
        out = sql_bridge.replace_collection(db, name, data)
        db.commit()
        return out
    _replace_collection_no_commit(db, name, data)
    db.commit()
    return get_collection(db, name)


def list_items(db: Session, name: str) -> list[Any]:
    data = get_collection(db, name)
    if isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Cette collection est un objet, pas une liste")
    return data


def create_item(db: Session, name: str, item: dict[str, Any]) -> dict[str, Any]:
    item = normalize_photo_fields(dict(item), fallback=name)
    if name in sql_bridge.SQL_COLLECTIONS:
        db.execute(delete(SgdiRecord).where(SgdiRecord.collection == name))
        out = sql_bridge.upsert_item(db, name, dict(item))
        db.commit()
        return out
    item = _ensure_id(dict(item), name)
    item_id = str(item["id"])
    exists = db.execute(select(SgdiRecord).where(SgdiRecord.collection == name, SgdiRecord.item_id == item_id)).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Identifiant déjà existant")
    position = len(_collection_rows(db, name))
    db.add(SgdiRecord(collection=name, item_id=item_id, position=position, kind="item", data=item, label=str(item.get("nom") or item.get("name") or item.get("code") or "")))
    db.commit()
    return item


def get_item(db: Session, name: str, item_id: str) -> dict[str, Any]:
    row = db.execute(select(SgdiRecord).where(SgdiRecord.collection == name, SgdiRecord.item_id == item_id)).scalar_one_or_none()
    if not row or not isinstance(row.data, dict):
        raise HTTPException(status_code=404, detail="Élément introuvable")
    return deepcopy(row.data)


def update_item(db: Session, name: str, item_id: str, patch: dict[str, Any], partial: bool = True) -> dict[str, Any]:
    patch = normalize_photo_fields(dict(patch), fallback=item_id)
    if name in sql_bridge.SQL_COLLECTIONS:
        db.execute(delete(SgdiRecord).where(SgdiRecord.collection == name))
        data = dict(patch)
        data.setdefault("id", item_id)
        out = sql_bridge.upsert_item(db, name, data)
        db.commit()
        return out
    row = db.execute(select(SgdiRecord).where(SgdiRecord.collection == name, SgdiRecord.item_id == item_id)).scalar_one_or_none()
    if not row or not isinstance(row.data, dict):
        raise HTTPException(status_code=404, detail="Élément introuvable")
    updated = {**row.data, **patch} if partial else dict(patch)
    updated["id"] = row.data.get("id", item_id)
    row.data = updated
    row.label = str(updated.get("nom") or updated.get("name") or updated.get("code") or "")
    db.commit()
    return deepcopy(updated)


def delete_item(db: Session, name: str, item_id: str) -> dict[str, str]:
    if name in sql_bridge.SQL_COLLECTIONS:
        return sql_bridge.delete_item(db, name, item_id)
    row = db.execute(select(SgdiRecord).where(SgdiRecord.collection == name, SgdiRecord.item_id == item_id)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    db.delete(row)
    db.commit()
    return {"deleted": item_id}


def cleanup_base64_photos(db: Session) -> int:
    changed = 0
    rows = db.execute(select(SgdiRecord)).scalars().all()
    for row in rows:
        cleaned = normalize_photo_fields(row.data, fallback=f"{row.collection}_{row.item_id}")
        if cleaned != row.data:
            row.data = cleaned
            changed += 1
    if changed:
        db.commit()
        logger.info("Photos Base64 nettoyees dans sgdi_records: %s ligne(s)", changed)
    return changed
