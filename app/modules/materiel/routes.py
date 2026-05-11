from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.pagination import paginate_statement
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


@router.get("/stores/page")
def stores_page(society: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    stmt = select(Store)
    if society:
        stmt = stmt.where(Store.society == society)
    return paginate_statement(db, stmt, model=Store, search_fields=[Store.name, Store.code, Store.society, Store.manager_name, Store.phone, Store.email], q=q, page=page, page_size=page_size)


@router.get("/stores", response_model=list[StoreOut])
def stores(society: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Store, {"society": society})


@router.post("/stores", response_model=StoreOut)
def create_store(payload: StoreCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Store, payload)


@router.put("/stores/{store_id}", response_model=StoreOut)
def update_store(store_id: int, payload: StoreCreate, db: Session = Depends(get_db)):
    return service.update_row(db, Store, store_id, payload)


@router.delete("/stores/{store_id}")
def delete_store(store_id: int, db: Session = Depends(get_db)):
    return service.delete_row(db, Store, store_id)


@router.get("/suppliers/page")
def suppliers_page(society: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    stmt = select(Supplier)
    if society:
        stmt = stmt.where(Supplier.society == society)
    return paginate_statement(db, stmt, model=Supplier, search_fields=[Supplier.name, Supplier.society, Supplier.contact_name, Supplier.phone, Supplier.email, Supplier.products], q=q, page=page, page_size=page_size)


@router.get("/suppliers", response_model=list[SupplierOut])
def suppliers(society: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Supplier, {"society": society})


@router.post("/suppliers", response_model=SupplierOut)
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Supplier, payload)


@router.put("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: int, payload: SupplierCreate, db: Session = Depends(get_db)):
    return service.update_row(db, Supplier, supplier_id, payload)


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db)):
    return service.delete_row(db, Supplier, supplier_id)


@router.get("/articles/page")
def articles_page(store_id: int | None = None, category: str | None = None, society: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    stmt = select(StockArticle).where(StockArticle.active == 1)
    if store_id is not None:
        stmt = stmt.where(StockArticle.store_id == store_id)
    if category:
        stmt = stmt.where(StockArticle.category == category)
    if society:
        stmt = stmt.where(StockArticle.society == society)
    return paginate_statement(db, stmt, model=StockArticle, search_fields=[StockArticle.code, StockArticle.designation, StockArticle.category, StockArticle.sub_category, StockArticle.society, StockArticle.brand, StockArticle.model], q=q, page=page, page_size=page_size)


@router.get("/articles", response_model=list[ArticleOut])
def articles(store_id: int | None = None, category: str | None = None, society: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, StockArticle, {"store_id": store_id, "category": category, "society": society, "active": 1})


@router.post("/articles", response_model=ArticleOut)
def create_article(payload: ArticleCreate, db: Session = Depends(get_db)):
    return service.create_row(db, StockArticle, payload)


@router.put("/articles/{article_id}", response_model=ArticleOut)
def update_article(article_id: int, payload: ArticleCreate, db: Session = Depends(get_db)):
    return service.update_row(db, StockArticle, article_id, payload)


@router.delete("/articles/{article_id}")
def delete_article(article_id: int, db: Session = Depends(get_db)):
    return service.delete_row(db, StockArticle, article_id)


@router.get("/inventory")
def inventory(store_id: int | None = None, category: str | None = None, db: Session = Depends(get_db)):
    return service.inventory(db, store_id, category)


@router.get("/movements/page")
def movements_page(article_id: int | None = None, employee_id: int | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    stmt = select(StockMovement)
    if article_id is not None:
        stmt = stmt.where(StockMovement.article_id == article_id)
    if employee_id is not None:
        stmt = stmt.where(StockMovement.employee_id == employee_id)
    return paginate_statement(db, stmt, model=StockMovement, search_fields=[StockMovement.movement_type, StockMovement.recipient, StockMovement.reason, StockMovement.voucher_number, StockMovement.notes], q=q, page=page, page_size=page_size)


@router.get("/movements", response_model=list[MovementOut])
def movements(article_id: int | None = None, employee_id: int | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, StockMovement, {"article_id": article_id, "employee_id": employee_id})


@router.post("/movements", response_model=MovementOut)
def create_movement(payload: MovementCreate, db: Session = Depends(get_db)):
    return service.create_movement(db, payload)


@router.delete("/movements/{movement_id}")
def delete_movement(movement_id: int, db: Session = Depends(get_db)):
    return service.delete_movement(db, movement_id)


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

