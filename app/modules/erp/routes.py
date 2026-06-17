from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.erp.service import operational_preparation_rows


router = APIRouter()


@router.get("/operational-preparation")
def operational_preparation(
    society: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return operational_preparation_rows(db, user, society)
