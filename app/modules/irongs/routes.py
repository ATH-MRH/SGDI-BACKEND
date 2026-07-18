import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.authz import assert_can, require_level
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.irongs.schemas import CollectionOut, CollectionReplace, DbReplace, ItemPayload, LegacyActionPayload
from app.modules.irongs import service
from app.modules.irongs.constants import CATEGORIES_PREST, POSTES, SOCIETES
from app.modules.irongs.models import Position
from app.modules.auth.routes import is_admin_role


router = APIRouter(dependencies=[Depends(current_user)])


def _require_collection_write(name: str, user=Depends(current_user)):
    """Écriture d'un item/collection legacy : niveau selon la collection.
    Clôtures et grilles de paie (GLOBAL_ROW_COLLECTIONS) = validation (H3) ;
    tout le reste = saisie (H2). Le cloisonnement société reste géré dans le handler."""
    assert_can(user, "validate" if name in service.GLOBAL_ROW_COLLECTIONS else "write")
    return user


def _require_collection_delete(name: str, user=Depends(current_user)):
    """Suppression d'un item legacy = supervision (H4)."""
    assert_can(user, "delete")
    return user


def _get_postes(db: Session) -> list[str]:
    rows = db.query(Position).order_by(Position.name).all()
    if not rows:
        for name in POSTES:
            db.add(Position(name=name, society=None))
        db.commit()
        rows = db.query(Position).order_by(Position.name).all()
    return [r.name for r in rows]


@router.get("/bootstrap")
def bootstrap(db: Session = Depends(get_db), user=Depends(current_user)) -> Response:
    # L'en-tête (user + constants) est petit ; le "db" (jusqu'à ~26 Mo) est pré-encodé
    # et mis en cache par get_database_json. On assemble les octets sans ré-encoder le db.
    head = json.dumps(
        {
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "full_name": user.full_name,
                "role": user.role,
                "is_active": user.is_active,
            },
            "constants": {
                "societes": SOCIETES,
                "postes": _get_postes(db),
                "categories_prestations": CATEGORIES_PREST,
            },
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    db_bytes = service.get_database_json(db, user)
    body = head[:-1] + b',"db":' + db_bytes + b"}"
    return Response(content=body, media_type="application/json")


class PositionCreate(BaseModel):
    name: str
    society: str | None = None


@router.get("/positions")
def list_positions(society: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    _get_postes(db)  # seed if empty
    q = db.query(Position).order_by(Position.society.nulls_first(), Position.name)
    if society:
        q = q.filter((Position.society == society) | (Position.society.is_(None)))
    return [{"id": r.id, "name": r.name, "society": r.society} for r in q.all()]


@router.post("/positions", status_code=201)
def create_position(payload: PositionCreate, db: Session = Depends(get_db), user=Depends(current_user)) -> dict:
    if not is_admin_role(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Réservé administrateur")
    name = payload.name.strip()
    society = payload.society.strip() if payload.society else None
    if not name:
        raise HTTPException(status_code=400, detail="Nom requis")
    if db.query(Position).filter(Position.name == name, Position.society == society).first():
        raise HTTPException(status_code=409, detail="Poste déjà existant pour cette société")
    pos = Position(name=name, society=society)
    db.add(pos)
    db.commit()
    db.refresh(pos)
    return {"id": pos.id, "name": pos.name, "society": pos.society}


@router.delete("/positions/{position_id}", status_code=200)
def delete_position(position_id: int, db: Session = Depends(get_db), user=Depends(current_user)) -> dict:
    if not is_admin_role(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Réservé administrateur")
    pos = db.get(Position, position_id)
    if not pos:
        raise HTTPException(status_code=404, detail="Poste introuvable")
    db.delete(pos)
    db.commit()
    return {"ok": True}


@router.get("/db")
def get_db_snapshot(
    light: bool = Query(False, description="Retourne le snapshot legacy sans reconstruire les collections SQL lourdes"),
    db: Session = Depends(get_db),
    user=Depends(current_user),
) -> Response:
    body = service.get_database_json(db, user, include_sql=not light)
    return Response(content=body, media_type="application/json")


@router.put("/db")
def replace_db_snapshot(payload: DbReplace, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    return service.replace_database(db, payload.data, user)


@router.post("/db")
def post_db_snapshot(payload: dict[str, Any], db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    return service.replace_database(db, data, user)


@router.get("/collections/{name}", response_model=CollectionOut)
def get_collection(name: str, db: Session = Depends(get_db), user=Depends(current_user)):
    data = service.get_collection(db, name)
    return {"name": name, "data": service.scope_collection_for_user(name, data, user)}


@router.put("/collections/{name}", response_model=CollectionOut, dependencies=[Depends(_require_collection_write)])
def replace_collection(name: str, payload: CollectionReplace, db: Session = Depends(get_db), user=Depends(current_user)):
    if not service.can_replace_collection_for_user(name, user):
        raise HTTPException(status_code=403, detail="Remplacement collection réservé administrateur")
    return {"name": name, "data": service.replace_collection(db, name, payload.data, user)}


@router.get("/collections/{name}/items")
def list_items(name: str, db: Session = Depends(get_db), user=Depends(current_user)) -> list[Any]:
    data = service.list_items(db, name)
    value = service.scope_collection_for_user(name, data, user)
    return value if isinstance(value, list) else []


@router.post("/collections/{name}/items", dependencies=[Depends(_require_collection_write)])
def create_item(name: str, payload: ItemPayload, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    data = dict(payload.data)
    if name == "echanges" and data.get("type") == "message":
        data["from"] = user.username
    service.ensure_item_allowed_for_user(data, user, name)
    return service.create_item(db, name, data)


@router.get("/collections/{name}/items/{item_id}")
def get_item(name: str, item_id: str, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    item = service.get_item(db, name, item_id)
    rows = service.scope_collection_for_user(name, service.list_items(db, name), user)
    if not isinstance(rows, list) or not any(isinstance(row, dict) and str(row.get("id")) == str(item.get("id")) for row in rows):
        raise HTTPException(status_code=404, detail="Élément introuvable")
    return item


@router.put("/collections/{name}/items/{item_id}", dependencies=[Depends(_require_collection_write)])
def replace_item(name: str, item_id: str, payload: ItemPayload, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    existing = service.get_item(db, name, item_id)
    service.ensure_item_allowed_for_user(existing, user, name)
    service.ensure_item_allowed_for_user(payload.data, user, name)
    return service.update_item(db, name, item_id, payload.data, partial=False)


@router.patch("/collections/{name}/items/{item_id}", dependencies=[Depends(_require_collection_write)])
def patch_item(name: str, item_id: str, payload: ItemPayload, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    existing = service.get_item(db, name, item_id)
    service.ensure_item_allowed_for_user(existing, user, name)
    merged = {**existing, **payload.data}
    service.ensure_item_allowed_for_user(merged, user, name)
    return service.update_item(db, name, item_id, payload.data, partial=True)


@router.delete("/collections/{name}/items/{item_id}", dependencies=[Depends(_require_collection_delete)])
def delete_item(name: str, item_id: str, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, str]:
    existing = service.get_item(db, name, item_id)
    service.ensure_item_allowed_for_user(existing, user, name)
    return service.delete_item(db, name, item_id)


@router.post("/actions/{action}", dependencies=[Depends(require_level("write"))])
def legacy_action(
    action: str,
    payload: LegacyActionPayload,
    db: Session = Depends(get_db),
    user=Depends(current_user),
) -> dict[str, Any]:
    return service.run_legacy_action(db, action, payload, user)
