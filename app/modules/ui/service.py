from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.irongs.models import SgdiRecord


def _authorized_societies(user: User) -> list[str]:
    values = user.authorized_societies or []
    if not isinstance(values, list):
        return []
    return [str(v).strip() for v in values if str(v).strip()]


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
    legacy = {name: 0 for name in _legacy_counts(db)}

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "username": user.username,
            "role": user.role,
            "societies": societies,
        },
        "drh": {
            "recrutement": {
                "total": 0,
                "nouveaux": 0,
                "archives": 0,
            },
            "effectifs": {
                "total": 0,
                "actifs": 0,
            },
        },
        "ops": {
            "sites": {
                "total": 0,
                "actifs": 0,
            },
            "pointage": {
                "jour": 0,
            },
            "affectations": {
                "actives": 0,
            },
            "main_courante": {
                "ouvertes": 0,
            },
        },
        "admin": {
            "utilisateurs": 0,
        },
        "legacy": legacy,
    }
