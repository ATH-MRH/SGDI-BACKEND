from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.erp.service import operational_preparation_rows
from app.core.scope_policy import SocietyScopeError


router = APIRouter()


@router.get("/operational-preparation")
def operational_preparation(
    society: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    try:
        return operational_preparation_rows(db, user, society)
    except SocietyScopeError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
