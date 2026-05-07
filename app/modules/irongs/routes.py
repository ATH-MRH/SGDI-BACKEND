from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.irongs.schemas import CollectionOut, CollectionReplace, DbReplace, ItemPayload
from app.modules.irongs import service
from app.modules.irongs.constants import CATEGORIES_PREST, POSTES, SOCIETES


router = APIRouter(dependencies=[Depends(current_user)])


@router.get("/bootstrap")
def bootstrap(db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    return {
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
            "postes": POSTES,
            "categories_prestations": CATEGORIES_PREST,
        },
        "db": service.get_database(db),
    }


@router.get("/db")
def get_db_snapshot(db: Session = Depends(get_db)) -> dict[str, Any]:
    return service.get_database(db)


@router.put("/db")
def replace_db_snapshot(payload: DbReplace, db: Session = Depends(get_db)) -> dict[str, Any]:
    return service.replace_database(db, payload.data)


@router.post("/db")
def post_db_snapshot(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    return service.replace_database(db, data)


@router.get("/collections/{name}", response_model=CollectionOut)
def get_collection(name: str, db: Session = Depends(get_db)):
    return {"name": name, "data": service.get_collection(db, name)}


@router.put("/collections/{name}", response_model=CollectionOut)
def replace_collection(name: str, payload: CollectionReplace, db: Session = Depends(get_db)):
    return {"name": name, "data": service.replace_collection(db, name, payload.data)}


@router.get("/collections/{name}/items")
def list_items(name: str, db: Session = Depends(get_db)) -> list[Any]:
    return service.list_items(db, name)


@router.post("/collections/{name}/items")
def create_item(name: str, payload: ItemPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    return service.create_item(db, name, payload.data)


@router.get("/collections/{name}/items/{item_id}")
def get_item(name: str, item_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return service.get_item(db, name, item_id)


@router.put("/collections/{name}/items/{item_id}")
def replace_item(name: str, item_id: str, payload: ItemPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    return service.update_item(db, name, item_id, payload.data, partial=False)


@router.patch("/collections/{name}/items/{item_id}")
def patch_item(name: str, item_id: str, payload: ItemPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    return service.update_item(db, name, item_id, payload.data, partial=True)


@router.delete("/collections/{name}/items/{item_id}")
def delete_item(name: str, item_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    return service.delete_item(db, name, item_id)
