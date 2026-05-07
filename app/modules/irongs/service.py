import logging
from copy import deepcopy
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.modules.irongs.models import IrongsCollection

logger = logging.getLogger("sgdi.irongs")


def _ensure_id(item: dict[str, Any], collection: str) -> dict[str, Any]:
    if item.get("id"):
        return item
    prefix = "".join(part[0] for part in collection.split("_"))[:3] or "row"
    item["id"] = f"{prefix}_{abs(hash(str(item))) % 10_000_000}"
    return item


def get_database(db: Session) -> dict[str, list[Any] | dict[str, Any]]:
    rows = db.query(IrongsCollection).order_by(IrongsCollection.name).all()
    return {row.name: row.data for row in rows}


def replace_database(db: Session, payload: dict[str, list[Any] | dict[str, Any]]) -> dict[str, list[Any] | dict[str, Any]]:
    db.query(IrongsCollection).delete()
    logger.info("Remplacement snapshot IRONGS: %s collection(s)", len(payload))
    for name, data in payload.items():
        db.add(IrongsCollection(name=name, data=deepcopy(data)))
    db.commit()
    logger.info("Snapshot IRONGS sauvegardé dans PostgreSQL")
    return get_database(db)


def get_collection(db: Session, name: str) -> list[Any] | dict[str, Any]:
    row = db.get(IrongsCollection, name)
    if not row:
        row = IrongsCollection(name=name, data=[])
        db.add(row)
        db.commit()
        db.refresh(row)
    return row.data


def replace_collection(db: Session, name: str, data: list[Any] | dict[str, Any]) -> list[Any] | dict[str, Any]:
    clean_data = deepcopy(data)
    row = db.get(IrongsCollection, name)
    if not row:
        row = IrongsCollection(name=name, data=clean_data)
        db.add(row)
    else:
        row.data = clean_data
        flag_modified(row, "data")
    db.commit()
    db.refresh(row)
    return row.data


def list_items(db: Session, name: str) -> list[Any]:
    data = get_collection(db, name)
    if isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Cette collection est un objet, pas une liste")
    return data


def create_item(db: Session, name: str, item: dict[str, Any]) -> dict[str, Any]:
    data = list_items(db, name)
    item = _ensure_id(dict(item), name)
    if any(isinstance(row, dict) and row.get("id") == item["id"] for row in data):
        raise HTTPException(status_code=409, detail="Identifiant déjà existant")
    data.append(item)
    replace_collection(db, name, data)
    return item


def get_item(db: Session, name: str, item_id: str) -> dict[str, Any]:
    data = list_items(db, name)
    for item in data:
        if isinstance(item, dict) and str(item.get("id")) == item_id:
            return item
    raise HTTPException(status_code=404, detail="Élément introuvable")


def update_item(db: Session, name: str, item_id: str, patch: dict[str, Any], partial: bool = True) -> dict[str, Any]:
    data = list_items(db, name)
    for idx, item in enumerate(data):
        if isinstance(item, dict) and str(item.get("id")) == item_id:
            updated = {**item, **patch} if partial else dict(patch)
            updated["id"] = item.get("id", item_id)
            data[idx] = updated
            replace_collection(db, name, data)
            return updated
    raise HTTPException(status_code=404, detail="Élément introuvable")


def delete_item(db: Session, name: str, item_id: str) -> dict[str, str]:
    data = list_items(db, name)
    next_data = [item for item in data if not (isinstance(item, dict) and str(item.get("id")) == item_id)]
    if len(next_data) == len(data):
        raise HTTPException(status_code=404, detail="Élément introuvable")
    replace_collection(db, name, next_data)
    return {"deleted": item_id}
