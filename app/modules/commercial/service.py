from typing import Any, Type

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session


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
    row = model(**payload.model_dump(exclude_unset=True))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_row(db: Session, model: Type, row_id: int, payload: Any):
    row = get_or_404(db, model, row_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def delete_row(db: Session, model: Type, row_id: int):
    row = get_or_404(db, model, row_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": row_id}
