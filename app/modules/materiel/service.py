from datetime import date
from typing import Any, Type

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.drh.models import Employee
from app.modules.materiel.models import EmployeeEquipment, StockArticle, StockMovement, Store, Supplier
from app.modules.materiel.schemas import DotationCreate, MovementCreate, ReturnEquipmentIn


ENTRY_TYPES = {"entree", "achat", "retour_employe", "retour_site", "regularisation_entree"}
EXIT_TYPES = {
    "sortie",
    "nouvelle_dotation",
    "renouvellement_dotation",
    "dotation_pret_mission",
    "reformer",
    "perte",
    "casse",
}


def list_rows(db: Session, model: Type, filters: dict[str, Any] | None = None):
    stmt = select(model)
    for key, value in (filters or {}).items():
        if value not in (None, "") and hasattr(model, key):
            stmt = stmt.where(getattr(model, key) == value)
    return db.execute(stmt.order_by(model.id.desc())).scalars().all()


def get_or_404(db: Session, model: Type, row_id: int):
    row = db.get(model, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    return row


def create_row(db: Session, model: Type, payload: Any):
    try:
        row = model(**payload.model_dump(exclude_unset=True))
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Enregistrement déjà existant ou code déjà utilisé") from exc


def update_row(db: Session, model: Type, row_id: int, payload: Any):
    try:
        row = get_or_404(db, model, row_id)
        for key, value in payload.model_dump(exclude_unset=True).items():
            setattr(row, key, value)
        db.commit()
        db.refresh(row)
        return row
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Enregistrement déjà existant ou code déjà utilisé") from exc



def delete_row(db: Session, model: Type, row_id: int):
    row = get_or_404(db, model, row_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": row_id}

def dashboard(db: Session):
    return {
        "articles": 0,
        "stores": 0,
        "suppliers": 0,
        "low_stock_alerts": 0,
        "active_employee_dotations": 0,
    }


def inventory(db: Session, store_id: int | None = None, category: str | None = None):
    articles = list_rows(db, StockArticle, {"store_id": store_id, "category": category, "active": 1})
    return {
        "count": len(articles),
        "total_quantity": sum(a.quantity or 0 for a in articles),
        "articles": articles,
    }


def create_movement(db: Session, payload: MovementCreate):
    article = get_or_404(db, StockArticle, payload.article_id)
    movement_type = payload.movement_type
    sign = 1 if movement_type in ENTRY_TYPES else -1 if movement_type in EXIT_TYPES else 0
    if sign == -1 and article.quantity < payload.quantity:
        raise HTTPException(status_code=422, detail="Stock insuffisant")
    article.quantity = (article.quantity or 0) + sign * payload.quantity
    movement = StockMovement(**payload.model_dump(exclude_unset=True))
    if not movement.unit_price:
        movement.unit_price = article.unit_price or 0
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return movement


def create_dotation(db: Session, payload: DotationCreate):
    article = get_or_404(db, StockArticle, payload.article_id)
    employee = get_or_404(db, Employee, payload.employee_id)
    unit_price = payload.unit_price if payload.unit_price is not None else article.unit_price
    movement = create_movement(
        db,
        MovementCreate(
            article_id=payload.article_id,
            movement_date=payload.dotation_date,
            movement_type="nouvelle_dotation",
            quantity=payload.quantity,
            unit_price=unit_price or 0,
            employee_id=payload.employee_id,
            recipient=f"{employee.last_name} {employee.first_name}",
            reason=payload.dotation_reason,
            voucher_number=payload.voucher_number,
        ),
    )
    equipment = EmployeeEquipment(
        employee_id=payload.employee_id,
        article_id=payload.article_id,
        movement_id=movement.id,
        quantity=payload.quantity,
        unit_price=unit_price or 0,
        dotation_date=payload.dotation_date,
        dotation_reason=payload.dotation_reason,
        voucher_number=payload.voucher_number,
        status="attribue",
    )
    db.add(equipment)
    db.commit()
    db.refresh(equipment)
    return equipment


def return_equipment(db: Session, equipment_id: int, payload: ReturnEquipmentIn):
    equipment = get_or_404(db, EmployeeEquipment, equipment_id)
    if equipment.status != "attribue":
        raise HTTPException(status_code=422, detail="Equipement déjà reversé")
    equipment.status = "reverse"
    equipment.return_date = payload.return_date
    equipment.return_reason = payload.return_reason
    create_movement(
        db,
        MovementCreate(
            article_id=equipment.article_id,
            movement_date=payload.return_date,
            movement_type="retour_employe",
            quantity=equipment.quantity,
            unit_price=equipment.unit_price,
            employee_id=equipment.employee_id,
            reason=payload.return_reason,
        ),
    )
    db.commit()
    db.refresh(equipment)
    return equipment



def delete_movement(db: Session, movement_id: int):
    movement = get_or_404(db, StockMovement, movement_id)
    article = db.get(StockArticle, movement.article_id)
    if article:
        sign = 1 if movement.movement_type in ENTRY_TYPES else -1 if movement.movement_type in EXIT_TYPES else 0
        article.quantity = (article.quantity or 0) - sign * (movement.quantity or 0)
    db.delete(movement)
    db.commit()
    return {"deleted": True, "id": movement_id}

def employee_equipment(db: Session, employee_id: int):
    return list_rows(db, EmployeeEquipment, {"employee_id": employee_id})


def reversement_pending(db: Session):
    employees = db.execute(select(Employee).where(Employee.status.in_(["sortant", "archive"]))).scalars().all()
    rows = []
    for employee in employees:
        equipment = list_rows(db, EmployeeEquipment, {"employee_id": employee.id, "status": "attribue"})
        if equipment:
            rows.append(
                {
                    "employee_id": employee.id,
                    "code": employee.code,
                    "name": f"{employee.last_name} {employee.first_name}",
                    "articles_count": len(equipment),
                    "total_value": sum((e.quantity or 0) * (e.unit_price or 0) for e in equipment),
                    "equipment": equipment,
                }
            )
    return rows
