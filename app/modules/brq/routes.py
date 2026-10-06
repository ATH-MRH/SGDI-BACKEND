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
            wilaya: str | None, site_id: int | None) -> dict[str, Any]:
    from app.modules.attendance import core

    return service.build_report(
        db,
        user,
        day=day or core._now_local().date(),
        society=society,
        wilaya=wilaya,
        site_id=site_id,
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
             site_id: int | None = Query(None, ge=1)) -> tuple[date | None, str | None, str | None, int | None]:
    return date, society, wilaya, site_id


@router.get("/situation", response_model=BRQSituation)
def situation(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
              user: User = Depends(current_user)) -> dict[str, Any]:
    return service.situation(_report(db, user, *filters))


@router.get("/presences", response_model=BRQList)
def presences(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
              user: User = Depends(current_user)) -> dict[str, Any]:
    return _list(_report(db, user, *filters), "presences")


@router.get("/absences", response_model=BRQList)
def absences(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
             user: User = Depends(current_user)) -> dict[str, Any]:
    return _list(_report(db, user, *filters), "absences")


@router.get("/abandons-poste", response_model=BRQList)
def abandons_poste(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
                   user: User = Depends(current_user)) -> dict[str, Any]:
    return _list(_report(db, user, *filters), "abandons-poste")


@router.get("/sortants", response_model=BRQList)
def sortants(filters: tuple = Depends(_filters), db: Session = Depends(get_db),
             user: User = Depends(current_user)) -> dict[str, Any]:
    return _list(_report(db, user, *filters), "sortants")


@router.get("/export")
def export(view: str = Query(..., pattern=r"^(situation|presences|absences|abandons-poste|sortants)$"),
           filters: tuple = Depends(_filters), db: Session = Depends(get_db),
           user: User = Depends(current_user)) -> dict[str, Any]:
    report = _report(db, user, *filters)
    items = service.situation(report)["items"] if view == "situation" else service.collection_items(report, view)
    return {"date": report["date"], "view": view, "items": items}
