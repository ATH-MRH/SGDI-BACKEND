from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.materiel import service
from app.modules.materiel.models import EmployeeEquipment, StockArticle, StockMovement, Store, Supplier
from app.modules.materiel.schemas import (
    ArticleCreate,
    ArticleOut,
    DotationCreate,
    EquipmentOut,
    MovementCreate,
    MovementOut,
    ReturnEquipmentIn,
    StoreCreate,
    StoreOut,
    SupplierCreate,
    SupplierOut,
)


router = APIRouter(dependencies=[Depends(current_user)])


@router.get("/dashboard")
def materiel_dashboard(db: Session = Depends(get_db)):
    return service.dashboard(db)


@router.get("/stores", response_model=list[StoreOut])
def stores(society: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Store, {"society": society})


@router.post("/stores", response_model=StoreOut)
def create_store(payload: StoreCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Store, payload)


@router.get("/suppliers", response_model=list[SupplierOut])
def suppliers(db: Session = Depends(get_db)):
    return service.list_rows(db, Supplier)


@router.post("/suppliers", response_model=SupplierOut)
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Supplier, payload)


@router.get("/articles", response_model=list[ArticleOut])
def articles(store_id: int | None = None, category: str | None = None, society: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, StockArticle, {"store_id": store_id, "category": category, "society": society, "active": 1})


@router.post("/articles", response_model=ArticleOut)
def create_article(payload: ArticleCreate, db: Session = Depends(get_db)):
    return service.create_row(db, StockArticle, payload)


@router.put("/articles/{article_id}", response_model=ArticleOut)
def update_article(article_id: int, payload: ArticleCreate, db: Session = Depends(get_db)):
    return service.update_row(db, StockArticle, article_id, payload)


@router.get("/inventory")
def inventory(store_id: int | None = None, category: str | None = None, db: Session = Depends(get_db)):
    return service.inventory(db, store_id, category)


@router.get("/movements", response_model=list[MovementOut])
def movements(article_id: int | None = None, employee_id: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, StockMovement, {"article_id": article_id, "employee_id": employee_id})


@router.post("/movements", response_model=MovementOut)
def create_movement(payload: MovementCreate, db: Session = Depends(get_db)):
    return service.create_movement(db, payload)


@router.post("/dotations", response_model=EquipmentOut)
def create_dotation(payload: DotationCreate, db: Session = Depends(get_db)):
    return service.create_dotation(db, payload)


@router.get("/employees/{employee_id}/equipment", response_model=list[EquipmentOut])
def employee_equipment(employee_id: int, db: Session = Depends(get_db)):
    return service.employee_equipment(db, employee_id)


@router.post("/equipment/{equipment_id}/return", response_model=EquipmentOut)
def return_equipment(equipment_id: int, payload: ReturnEquipmentIn, db: Session = Depends(get_db)):
    return service.return_equipment(db, equipment_id, payload)


@router.get("/reversements/pending")
def reversement_pending(db: Session = Depends(get_db)):
    return service.reversement_pending(db)

