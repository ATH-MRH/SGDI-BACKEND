from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.reporting import service

router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _effective_society(user: User, requested: str | None) -> str | None:
    allowed = _allowed_societies(user)
    if requested:
        if allowed and requested not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")
        return requested
    if len(allowed) == 1:
        return allowed[0]
    return None


@router.get("/dashboard")
def dashboard(
    society: str | None = None,
    date_debut: date | None = None,
    date_fin: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    return service.dashboard_kpis(db, eff, allowed, date_debut, date_fin)


@router.get("/ventes")
def ventes(
    society: str | None = None,
    date_debut: date | None = None,
    date_fin: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    return service.ventes_stats(db, eff, allowed, date_debut, date_fin)


@router.get("/achats")
def achats(
    society: str | None = None,
    date_debut: date | None = None,
    date_fin: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    return service.achats_stats(db, eff, allowed, date_debut, date_fin)


@router.get("/tresorerie")
def tresorerie(
    society: str | None = None,
    date_debut: date | None = None,
    date_fin: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    return service.tresorerie_stats(db, eff, allowed, date_debut, date_fin)


@router.get("/top-clients")
def top_clients(
    society: str | None = None,
    date_debut: date | None = None,
    date_fin: date | None = None,
    limit: int = 10,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    return service.top_clients(db, eff, allowed, date_debut, date_fin, min(limit, 50))


@router.get("/top-fournisseurs")
def top_fournisseurs(
    society: str | None = None,
    date_debut: date | None = None,
    date_fin: date | None = None,
    limit: int = 10,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    return service.top_fournisseurs(db, eff, allowed, date_debut, date_fin, min(limit, 50))
