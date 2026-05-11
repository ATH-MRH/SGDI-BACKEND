from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.drh.models import Candidate, Employee
from app.modules.irongs.models import SgdiRecord
from app.modules.ops.models import Assignment, DailyPresence, Event, Site


def _authorized_societies(user: User) -> list[str]:
    values = user.authorized_societies or []
    if not isinstance(values, list):
        return []
    return [str(v).strip() for v in values if str(v).strip()]


def _count(db: Session, model: Any, *filters: Any) -> int:
    query = db.query(func.count(model.id))
    for item in filters:
        query = query.filter(item)
    return int(query.scalar() or 0)


def _society_filter(column: Any, allowed: list[str]) -> tuple[Any, ...]:
    return (column.in_(allowed),) if allowed else ()


def _legacy_counts(db: Session) -> dict[str, int]:
    rows = (
        db.query(SgdiRecord.collection, func.count(SgdiRecord.id))
        .group_by(SgdiRecord.collection)
        .all()
    )
    return {str(name): int(count or 0) for name, count in rows}


def build_sidebar_stats(db: Session, user: User) -> dict[str, Any]:
    """Return sidebar/dashboard counters computed by Python, not by the HTML view.

    The frontend can refresh these values asynchronously after navigation.  This
    keeps count logic close to SQL models and avoids rendering stale badges from
    localStorage or preloaded DOM fragments.
    """

    societies = _authorized_societies(user)
    candidate_scope = _society_filter(Candidate.society, societies)
    employee_scope = _society_filter(Employee.society, societies)

    candidates_total = _count(db, Candidate, *candidate_scope)
    candidates_new = _count(
        db,
        Candidate,
        Candidate.status.in_(["nouvelle", "new", "reserve", "préselection", "preselection"]),
        *candidate_scope,
    )
    candidates_archived = _count(
        db,
        Candidate,
        Candidate.status.in_(["archive", "archivé", "archived"]),
        *candidate_scope,
    )

    employees_total = _count(db, Employee, *employee_scope)
    employees_active = _count(db, Employee, Employee.status.in_(["actif", "active"]), *employee_scope)

    legacy = _legacy_counts(db)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "username": user.username,
            "role": user.role,
            "societies": societies,
        },
        "drh": {
            "recrutement": {
                "total": candidates_total,
                "nouveaux": candidates_new,
                "archives": candidates_archived,
            },
            "effectifs": {
                "total": employees_total,
                "actifs": employees_active,
            },
        },
        "ops": {
            "sites": {
                "total": _count(db, Site),
                "actifs": _count(db, Site, Site.active == 1),
            },
            "pointage": {
                "jour": _count(db, DailyPresence, DailyPresence.presence_date == date.today()),
            },
            "affectations": {
                "actives": _count(db, Assignment, Assignment.active == 1),
            },
            "main_courante": {
                "ouvertes": _count(db, Event, Event.status.in_(["ouvert", "ouverte", "open"])),
            },
        },
        "admin": {
            "utilisateurs": _count(db, User),
        },
        "legacy": legacy,
    }
