from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.erp.service import authorized_societies, build_erp_counters
from app.modules.irongs.models import SgdiRecord


def _legacy_counts(db: Session) -> dict[str, int]:
    rows = (
        db.query(SgdiRecord.collection, func.count(SgdiRecord.id))
        .group_by(SgdiRecord.collection)
        .all()
    )
    return {str(name): int(count or 0) for name, count in rows}


def build_sidebar_stats(db: Session, user: User, society: str | None = None) -> dict[str, Any]:
    """Return ERP counters computed by the backend.

    The frontend still keeps the legacy snapshot during the transition, but this
    response gives the application one reliable source for operational counts.
    """

    societies = authorized_societies(user)
    legacy = {name: 0 for name in _legacy_counts(db)}
    erp = build_erp_counters(db, user, society)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "username": user.username,
            "role": user.role,
            "societies": societies,
            "active_society": (society or "").strip(),
        },
        "erp": erp,
        "drh": {
            "recrutement": {
                "total": erp["drh"]["candidates_total"],
                "reserve": erp["drh"].get("candidates_reserve", 0),
                "nouveaux": legacy.get("candidats", 0),
                "archives": 0,
            },
            "effectifs": {
                "total": erp["employees"]["total"],
                "actifs": erp["employees"]["operational_active"],
                "en_preparation": erp["employees"]["preparation"],
                "sans_contrat": erp["employees"]["without_contract"],
                "sans_dotation": erp["employees"]["without_equipment"],
                "sans_affectation": erp["employees"]["without_assignment"],
                "sans_pv_installation": erp["employees"]["without_installation_pv"],
                "conge": erp["employees"].get("leave_current", 0),
                "maladie": erp["employees"].get("sick_leave_current", 0),
                "absent": erp["employees"].get("absent", 0),
                "suspendu": erp["employees"].get("suspended", 0),
                "blacklist": erp["employees"].get("blacklisted", 0),
            },
        },
        "ops": {
            "sites": {
                "total": erp["ops"]["sites_total"],
                "actifs": erp["ops"]["sites_active"],
            },
            "pointage": {
                "jour": erp["ops"]["presence_today"],
            },
            "affectations": {
                "actives": erp["ops"]["assignments_active"],
            },
            "main_courante": {
                "ouvertes": erp["ops"]["events_open"],
            },
        },
        "materiel": erp["materiel"],
        "admin": {
            "utilisateurs": 0,
        },
        "legacy": legacy,
    }
