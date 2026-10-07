from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.brq import service
from app.modules.brq.schemas import BRQList, BRQSituation

router = APIRouter()


def _report(db: Session, user: User, day: date | None, society: str | None,
            wilaya: str | None, site_id: int | None, client: str | None,
            site: str | None, fonction: str | None, vacation: str | None, *,
            include_attendance: bool = True, include_sortants: bool = True) -> dict[str, Any]:
    from app.modules.attendance import core

    return service.build_report(
        db,
        user,
        day=day or core._now_local().date(),
        society=society,
        wilaya=wilaya,
        site_id=site_id,
        client=client,
        site=site,
        fonction=fonction,
        vacation=vacation,
        include_attendance=include_attendance,
        include_sortants=include_sortants,
    )


def _list(report: dict[str, Any], view: str) -> dict[str, Any]:
    items = service.collection_items(report, view)
    return {
        "date": report["date"],
        "total": len(items),
        "items": items,
        "filters": report["filters"],
    }


def _filters(date: date | None = Query(None, alias="date"),
             society: str | None = Query(None, max_length=180),
             wilaya: str | None = Query(None, max_length=120),
             site_id: int | None = Query(None, ge=1),
             client: str | None = Query(None, max_length=180),
             site: str | None = Query(None, max_length=180),
             fonction: str | None = Query(None, max_length=150),
             vacation: str | None = Query(None, max_length=120)
             ) -> tuple[date | None, str | None, str | None, int | None, str | None, str | None, str | None, str | None]:
    return date, society, wilaya, site_id, client, site, fonction, vacation


@router.get("/situation", response_model=BRQSituation)
def situation(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
              user: User = Depends(current_user)) -> dict[str, Any]:
    return service.situation(_report(db, user, *filters))


@router.get("/presences", response_model=BRQList)
def presences(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
              user: User = Depends(current_user)) -> dict[str, Any]:
    return _list(_report(db, user, *filters, include_sortants=False), "presences")


@router.get("/absences", response_model=BRQList)
def absences(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
             user: User = Depends(current_user)) -> dict[str, Any]:
    return _list(_report(db, user, *filters, include_sortants=False), "absences")


@router.get("/abandons-poste", response_model=BRQList)
def abandons_poste(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
                   user: User = Depends(current_user)) -> dict[str, Any]:
    return _list(_report(db, user, *filters, include_sortants=False), "abandons-poste")


@router.get("/sortants", response_model=BRQList)
def sortants(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
             user: User = Depends(current_user)) -> dict[str, Any]:
    return _list(_report(db, user, *filters, include_attendance=False), "sortants")
