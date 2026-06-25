from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select, delete
from sqlalchemy.orm import Session

from app.core.pagination import paginate_statement
from app.db.session import get_db
from app.modules.auth.dependencies import current_token_payload, current_user
from app.modules.auth.models import User
from app.modules.auth.routes import is_admin_role
from app.modules.drh.models import Employee
from app.modules.materiel import service
from app.modules.materiel.models import EmployeeEquipment, MaterialAssignment, StockArticle, StockMovement, Store, Supplier
from app.modules.materiel.schemas import (
    ArticleCreate,
    ArticleOut,
    DotationCreate,
    EquipmentOut,
    MaterialAssignmentOut,
    MovementCreate,
    MovementOut,
    ReturnEquipmentIn,
    StoreCreate,
    StoreOut,
    SupplierCreate,
    SupplierOut,
)


router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _ensure_admin_system_user(user: User, token_payload: dict) -> None:
    role = str(user.role or "").strip().upper()
    if role not in {"ADMIN", "ADM", "ADM1", "ADM2"} or token_payload.get("admin_system") is not True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Suppression magasin réservée à l'administration système",
        )


def _effective_society_filter(user: User, requested: str | None) -> str | None:
    allowed = _allowed_societies(user)
    if requested:
        _ensure_society_allowed(user, requested)
        return requested
    if len(allowed) == 1:
        return allowed[0]
    return None


def _ensure_row_society_allowed(row, user: User):
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    _ensure_society_allowed(user, getattr(row, "society", None))
    return row


def _store_allowed_filter(allowed: list[str]):
    return or_(Store.society.in_(allowed), Store.society.is_(None), Store.society == "")


def _ensure_store_update_allowed(row: Store | None, user: User, payload: StoreCreate) -> Store:
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    allowed = _allowed_societies(user)
    if not allowed:
        return row
    if row.society in allowed:
        _ensure_society_allowed(user, payload.society)
        return row
    if not row.society and payload.society in allowed:
        return row
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _ensure_article_allowed(db: Session, user: User, article_id: int | None) -> StockArticle | None:
    if article_id is None:
        return None
    return _ensure_row_society_allowed(db.get(StockArticle, article_id), user)


def _ensure_employee_allowed(db: Session, user: User, employee_id: int | None) -> Employee | None:
    if employee_id is None:
        return None
    row = db.get(Employee, employee_id)
    if not row:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    _ensure_society_allowed(user, row.society)
    return row


def _ensure_store_allowed(db: Session, user: User, store_id: int | None) -> Store | None:
    if store_id is None:
        return None
    row = db.get(Store, store_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    allowed = _allowed_societies(user)
    if allowed and row.society and row.society not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")
    return row


def _ensure_supplier_allowed(db: Session, user: User, supplier_id: int | None) -> Supplier | None:
    if supplier_id is None:
        return None
    row = db.get(Supplier, supplier_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    allowed = _allowed_societies(user)
    if allowed and row.society and row.society not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")
    return row


@router.get("/dashboard")
def materiel_dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return service.dashboard(db, _allowed_societies(user))


@router.get("/stores/page")
def stores_page(society: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    service.ensure_store_schema(db)
    effective_society = _effective_society_filter(user, society)
    allowed = _allowed_societies(user)
    stmt = select(Store)
    if effective_society:
        stmt = stmt.where(Store.society == effective_society)
    elif allowed:
        stmt = stmt.where(_store_allowed_filter(allowed))
    return paginate_statement(db, stmt, model=Store, search_fields=[Store.name, Store.code, Store.society, Store.manager_name, Store.phone, Store.email], q=q, page=page, page_size=page_size)


@router.get("/stores", response_model=list[StoreOut])
def stores(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    service.ensure_store_schema(db)
    effective_society = _effective_society_filter(user, society)
    rows = service.list_rows(db, Store, {"society": effective_society})
    allowed = _allowed_societies(user)
    if allowed and not effective_society:
        rows = [row for row in rows if row.society in allowed or not row.society]
    return rows


@router.post("/stores", response_model=StoreOut)
def create_store(payload: StoreCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    service.ensure_store_schema(db)
    _ensure_society_allowed(user, payload.society)
    return service.create_row(db, Store, payload)


@router.put("/stores/{store_id}", response_model=StoreOut)
def update_store(store_id: int, payload: StoreCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    service.ensure_store_schema(db)
    _ensure_store_update_allowed(db.get(Store, store_id), user, payload)
    _ensure_society_allowed(user, payload.society)
    return service.update_row(db, Store, store_id, payload)


@router.delete("/stores/{store_id}")
def delete_store(
    store_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    token_payload: dict = Depends(current_token_payload),
):
    service.ensure_store_schema(db)
    _ensure_admin_system_user(user, token_payload)
    _ensure_row_society_allowed(db.get(Store, store_id), user)
    return service.delete_row(db, Store, store_id)


@router.get("/suppliers/page")
def suppliers_page(society: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    effective_society = _effective_society_filter(user, society)
    allowed = _allowed_societies(user)
    stmt = select(Supplier)
    if effective_society:
        stmt = stmt.where(Supplier.society == effective_society)
    elif allowed:
        stmt = stmt.where(Supplier.society.in_(allowed))
    return paginate_statement(db, stmt, model=Supplier, search_fields=[Supplier.name, Supplier.society, Supplier.contact_name, Supplier.phone, Supplier.email, Supplier.products], q=q, page=page, page_size=page_size)


@router.get("/suppliers", response_model=list[SupplierOut])
def suppliers(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    effective_society = _effective_society_filter(user, society)
    rows = service.list_rows(db, Supplier, {"society": effective_society})
    allowed = _allowed_societies(user)
    if allowed and not effective_society:
        rows = [row for row in rows if row.society in allowed]
    return rows


@router.post("/suppliers", response_model=SupplierOut)
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_row(db, Supplier, payload)


@router.put("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: int, payload: SupplierCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_row_society_allowed(db.get(Supplier, supplier_id), user)
    _ensure_society_allowed(user, payload.society)
    return service.update_row(db, Supplier, supplier_id, payload)


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_row_society_allowed(db.get(Supplier, supplier_id), user)
    return service.delete_row(db, Supplier, supplier_id)


@router.get("/articles/page")
def articles_page(store_id: int | None = None, category: str | None = None, society: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    service.ensure_material_schema(db)
    effective_society = _effective_society_filter(user, society)
    allowed = _allowed_societies(user)
    stmt = select(StockArticle).where(StockArticle.active == 1)
    if store_id is not None:
        stmt = stmt.where(StockArticle.store_id == store_id)
    if category:
        stmt = stmt.where(StockArticle.category == category)
    if effective_society:
        stmt = stmt.where(StockArticle.society == effective_society)
    elif allowed:
        stmt = stmt.where(StockArticle.society.in_(allowed))
    return paginate_statement(db, stmt, model=StockArticle, search_fields=[StockArticle.code, StockArticle.designation, StockArticle.category, StockArticle.sub_category, StockArticle.society, StockArticle.brand, StockArticle.model], q=q, page=page, page_size=page_size)


@router.get("/articles", response_model=list[ArticleOut])
def articles(store_id: int | None = None, category: str | None = None, society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    service.ensure_material_schema(db)
    effective_society = _effective_society_filter(user, society)
    rows = service.list_rows(db, StockArticle, {"store_id": store_id, "category": category, "society": effective_society, "active": 1})
    allowed = _allowed_societies(user)
    if allowed and not effective_society:
        rows = [row for row in rows if row.society in allowed]
    return rows


@router.post("/articles", response_model=ArticleOut)
def create_article(payload: ArticleCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_article(db, payload)


@router.put("/articles/{article_id}", response_model=ArticleOut)
def update_article(article_id: int, payload: ArticleCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_article_allowed(db, user, article_id)
    _ensure_society_allowed(user, payload.society)
    return service.update_article(db, article_id, payload)


@router.delete("/articles/{article_id}")
def delete_article(
    article_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    token_payload: dict = Depends(current_token_payload),
):
    _ensure_admin_system_user(user, token_payload)
    _ensure_article_allowed(db, user, article_id)
    return service.delete_article(db, article_id)


@router.get("/inventory")
def inventory(store_id: int | None = None, category: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_store_allowed(db, user, store_id)
    return service.inventory(db, store_id, category, _allowed_societies(user))


@router.get("/movements/page")
def movements_page(article_id: int | None = None, employee_id: int | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    service.ensure_material_schema(db)
    if article_id is not None:
        _ensure_article_allowed(db, user, article_id)
    allowed = _allowed_societies(user)
    allowed_articles = None
    if allowed and article_id is None:
        allowed_articles = set(db.execute(select(StockArticle.id).where(StockArticle.society.in_(allowed))).scalars().all())
    stmt = select(StockMovement)
    if article_id is not None:
        stmt = stmt.where(StockMovement.article_id == article_id)
    elif allowed_articles is not None:
        stmt = stmt.where(StockMovement.article_id.in_(allowed_articles))
    if employee_id is not None:
        stmt = stmt.where(StockMovement.employee_id == employee_id)
    return paginate_statement(db, stmt, model=StockMovement, search_fields=[StockMovement.movement_type, StockMovement.recipient, StockMovement.reason, StockMovement.voucher_number, StockMovement.notes], q=q, page=page, page_size=page_size)


@router.get("/movements", response_model=list[MovementOut])
def movements(article_id: int | None = None, employee_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    service.ensure_material_schema(db)
    if article_id is not None:
        _ensure_article_allowed(db, user, article_id)
    rows = service.list_rows(db, StockMovement, {"article_id": article_id, "employee_id": employee_id})
    allowed = _allowed_societies(user)
    if allowed and article_id is None:
        allowed_articles = set(db.execute(select(StockArticle.id).where(StockArticle.society.in_(allowed))).scalars().all())
        rows = [row for row in rows if row.article_id in allowed_articles]
    return rows


@router.post("/movements", response_model=MovementOut)
def create_movement(payload: MovementCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    article = _ensure_article_allowed(db, user, payload.article_id)
    store = _ensure_store_allowed(db, user, payload.store_id)
    _ensure_supplier_allowed(db, user, payload.supplier_id)
    _ensure_employee_allowed(db, user, payload.employee_id)
    if store and article and article.store_id and store.id != article.store_id:
        raise HTTPException(status_code=422, detail="Magasin incohérent avec l'article")
    return service.create_movement(db, payload)


@router.delete("/movements/{movement_id}")
def delete_movement(movement_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    movement = db.get(StockMovement, movement_id)
    if not movement:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    _ensure_article_allowed(db, user, movement.article_id)
    return service.delete_movement(db, movement_id)


@router.post("/dotations", response_model=EquipmentOut | MaterialAssignmentOut)
def create_dotation(payload: DotationCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    article = _ensure_article_allowed(db, user, payload.article_id)
    employee = _ensure_employee_allowed(db, user, payload.employee_id)
    if article and employee and article.society and employee.society and article.society != employee.society:
        raise HTTPException(status_code=422, detail="Article et employé de sociétés différentes")
    return service.create_dotation(db, payload)


@router.get("/employees/{employee_id}/equipment", response_model=list[EquipmentOut])
def employee_equipment(employee_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = service.employee_equipment(db, employee_id)
    allowed = _allowed_societies(user)
    if allowed:
        allowed_articles = set(db.execute(select(StockArticle.id).where(StockArticle.society.in_(allowed))).scalars().all())
        rows = [row for row in rows if row.article_id in allowed_articles]
    return rows


@router.post("/equipment/{equipment_id}/return", response_model=EquipmentOut)
def return_equipment(equipment_id: int, payload: ReturnEquipmentIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    equipment = db.get(EmployeeEquipment, equipment_id)
    if not equipment:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    _ensure_article_allowed(db, user, equipment.article_id)
    return service.return_equipment(db, equipment_id, payload)


@router.get("/reversements/pending")
def reversement_pending(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return service.reversement_pending(db, _allowed_societies(user))


@router.get("/admin/bulk-dotation-articles")
def bulk_dotation_articles(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Retourne tous les articles actifs pour la sélection du kit."""
    if not is_admin_role(user.role):
        raise HTTPException(status_code=403, detail="Accès administrateur requis")
    rows = db.execute(select(StockArticle).where(StockArticle.active == 1).order_by(StockArticle.designation)).scalars().all()
    return [{"id": a.id, "designation": a.designation, "category": a.category or "", "quantity": a.quantity} for a in rows]


@router.post("/admin/bulk-dotation-initiale")
def bulk_dotation_initiale(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    token_payload: dict = Depends(current_token_payload),
):
    """Efface toutes les dotations et applique le kit choisi à tous les employés actifs.
    payload: { kit: [{article_id: int, quantity: float}] }
    """
    _ensure_admin_system_user(user, token_payload)
    if payload.get("confirmation") != "APPLIQUER DOTATION INITIALE":
        raise HTTPException(status_code=422, detail="Confirmation obligatoire: APPLIQUER DOTATION INITIALE")

    target_society = str(payload.get("society") or payload.get("societe") or "").strip()
    allowed = _allowed_societies(user)
    if not target_society:
        if len(allowed) == 1:
            target_society = allowed[0]
        else:
            raise HTTPException(status_code=422, detail="Société cible obligatoire pour une dotation initiale massive")
    _ensure_society_allowed(user, target_society)

    kit_items = payload.get("kit", [])
    if not kit_items:
        raise HTTPException(status_code=422, detail="Kit vide — sélectionnez au moins un article.")

    resolved = []
    for item in kit_items:
        art_id = item.get("article_id")
        qty = float(item.get("quantity", 1))
        article = db.get(StockArticle, art_id)
        if not article:
            raise HTTPException(status_code=422, detail=f"Article ID {art_id} introuvable.")
        if article.society and article.society != target_society:
            raise HTTPException(status_code=422, detail=f"Article {article.designation} hors société cible.")
        resolved.append((article, qty))

    employees = db.execute(
        select(Employee).where(
            Employee.status.in_(["actif", "active", "Actif", "Active"]),
            Employee.society == target_society,
        )
    ).scalars().all()

    if not employees:
        raise HTTPException(status_code=422, detail="Aucun employé actif trouvé.")

    employee_ids = [emp.id for emp in employees]
    article_ids = [article.id for article, _qty in resolved]
    # Effacer uniquement la dotation initiale de la société cible / kit cible.
    db.execute(
        delete(EmployeeEquipment).where(
            EmployeeEquipment.employee_id.in_(employee_ids),
            EmployeeEquipment.article_id.in_(article_ids),
        )
    )
    db.execute(
        delete(MaterialAssignment).where(
            MaterialAssignment.employee_id.in_(employee_ids),
            MaterialAssignment.article_id.in_(article_ids),
        )
    )
    db.execute(
        delete(StockMovement).where(
            StockMovement.movement_type == "nouvelle_dotation",
            StockMovement.employee_id.in_(employee_ids),
            StockMovement.article_id.in_(article_ids),
        )
    )
    db.flush()

    today = date.today()
    created = 0
    errors = 0
    for emp in employees:
        for article, qty in resolved:
            try:
                service.create_dotation(db, DotationCreate(
                    employee_id=emp.id,
                    article_id=article.id,
                    quantity=qty,
                    dotation_date=today,
                    dotation_reason="Dotation initiale",
                    target_type="employee",
                    item_state="neuf",
                ))
                created += 1
            except Exception:
                errors += 1

    db.commit()
    return {"status": "ok", "society": target_society, "employees": len(employees), "dotations_creees": created, "erreurs": errors}
