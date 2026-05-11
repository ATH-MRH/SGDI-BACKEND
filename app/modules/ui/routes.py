from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.ui.service import build_sidebar_stats


router = APIRouter()


@router.get("/sidebar-stats")
def sidebar_stats(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return build_sidebar_stats(db, user)
