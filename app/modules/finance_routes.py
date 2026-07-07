from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.pagination import paginate_list
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.irongs import service


router = APIRouter(dependencies=[Depends(current_user)])


def _list_collection(db: Session, name: str, user: Any = None) -> list[Any]:
    data = service.get_collection(db, name)
    data = service.scope_collection_for_user(name, data, user)
    return data if isinstance(data, list) else []


@router.get("/entries")
def entries(db: Session = Depends(get_db), user: Any = Depends(current_user)) -> dict[str, list[Any]]:
    return {
        "caisse": _list_collection(db, "caisse", user),
        "factures": _list_collection(db, "factures", user),
        "paiements": _list_collection(db, "paiements", user),
        "avances": _list_collection(db, "avances", user),
        "avoirs": _list_collection(db, "avoirs", user),
    }


@router.get("/payroll")
def payroll(db: Session = Depends(get_db), user: Any = Depends(current_user)) -> dict[str, list[Any]]:
    return {
        "agents": _list_collection(db, "agents", user),
        "pointageMensuel": _list_collection(db, "pointageMensuel", user),
        "contratsPersonnel": _list_collection(db, "contratsPersonnel", user),
    }


@router.get("/entries/{collection}/page")
def entries_page(collection: str, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: Any = Depends(current_user)):
    allowed = {"caisse", "factures", "paiements", "avances", "avoirs"}
    if collection not in allowed:
        return {"items": [], "total": 0, "page": 1, "page_size": page_size, "pages": 1}
    return paginate_list(_list_collection(db, collection, user), page=page, page_size=page_size)


@router.get("/payroll/{collection}/page")
def payroll_page(collection: str, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: Any = Depends(current_user)):
    allowed = {"agents", "pointageMensuel", "contratsPersonnel"}
    if collection not in allowed:
        return {"items": [], "total": 0, "page": 1, "page_size": page_size, "pages": 1}
    return paginate_list(_list_collection(db, collection, user), page=page, page_size=page_size)
