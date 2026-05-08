import logging
from copy import deepcopy
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.modules.irongs.models import SgdiRecord

logger = logging.getLogger("sgdi.records")
OBJECT_ITEM_ID = "__object__"


def _ensure_id(item: dict[str, Any], collection: str) -> dict[str, Any]:
    if item.get("id"):
        return item
    prefix = "".join(part[0] for part in collection.split("_"))[:3] or "row"
    item["id"] = f"{prefix}_{abs(hash(str(item))) % 10_000_000}"
    return item


def _row_item_id(collection: str, item: Any, position: int) -> str:
    if isinstance(item, dict):
        item = _ensure_id(dict(item), collection)
        return str(item["id"])
    return f"idx-{position:06d}"


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
        grouped.setdefault(row.collection, []).append(row)
    result: dict[str, list[Any] | dict[str, Any]] = {}
    for name, items in grouped.items():
        if len(items) == 1 and items[0].kind == "object" and items[0].item_id == OBJECT_ITEM_ID:
            result[name] = deepcopy(items[0].data) if isinstance(items[0].data, dict) else {}
        else:
            result[name] = [deepcopy(row.data) for row in items if row.kind == "item"]
    return result


def replace_database(db: Session, payload: dict[str, list[Any] | dict[str, Any]]) -> dict[str, list[Any] | dict[str, Any]]:
    db.execute(delete(SgdiRecord))
    logger.info("Remplacement base SGDI SQL: %s collection(s)", len(payload))
    for name, data in payload.items():
        _replace_collection_no_commit(db, name, data)
    db.commit()
    logger.info("Base SGDI sauvegardée dans les tables SQL")
    return get_database(db)


def get_collection(db: Session, name: str) -> list[Any] | dict[str, Any]:
    rows = _collection_rows(db, name)
    if not rows:
        return []
    if len(rows) == 1 and rows[0].kind == "object" and rows[0].item_id == OBJECT_ITEM_ID:
        return deepcopy(rows[0].data) if isinstance(rows[0].data, dict) else {}
    return [deepcopy(row.data) for row in rows if row.kind == "item"]


def _replace_collection_no_commit(db: Session, name: str, data: list[Any] | dict[str, Any] | Any) -> None:
    db.execute(delete(SgdiRecord).where(SgdiRecord.collection == name))
    clean_data = deepcopy(data)
    if isinstance(clean_data, list):
        for idx, item in enumerate(clean_data):
            stored = deepcopy(item)
            if isinstance(stored, dict):
                stored = _ensure_id(stored, name)
            db.add(SgdiRecord(collection=name, item_id=_row_item_id(name, stored, idx), position=idx, kind="item", data=stored, label=str(stored.get("nom") or stored.get("name") or stored.get("code") or "") if isinstance(stored, dict) else str(stored)))
    else:
        db.add(SgdiRecord(collection=name, item_id=OBJECT_ITEM_ID, position=0, kind="object", data=clean_data, label=name))


def replace_collection(db: Session, name: str, data: list[Any] | dict[str, Any]) -> list[Any] | dict[str, Any]:
    _replace_collection_no_commit(db, name, data)
    db.commit()
    return get_collection(db, name)


def list_items(db: Session, name: str) -> list[Any]:
    data = get_collection(db, name)
    if isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Cette collection est un objet, pas une liste")
    return data


def create_item(db: Session, name: str, item: dict[str, Any]) -> dict[str, Any]:
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
    row = db.execute(select(SgdiRecord).where(SgdiRecord.collection == name, SgdiRecord.item_id == item_id)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    db.delete(row)
    db.commit()
    return {"deleted": item_id}
