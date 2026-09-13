"""Détecteur attendance.presence.missing_checkout.

Source : DailyPresence. Le scope société est obtenu EXCLUSIVEMENT par
DailyPresence.employee_id -> Employee.id -> Employee.society (décision
canonique figée pour 0.6-A) : aucune colonne society n'est inventée sur Site
ni sur DailyPresence. Le site vient de DailyPresence.site_id.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.alerts.detectors import DetectorFinding
from app.modules.alerts.rules import MISSING_CHECKOUT_THRESHOLD_MINUTES, RULE_MISSING_CHECKOUT
from app.modules.drh.models import Employee
from app.modules.ops.models import DailyPresence


def _arrival_datetime(presence: DailyPresence) -> datetime | None:
    if not presence.arrival_time:
        return None
    try:
        hour, minute = (int(part) for part in str(presence.arrival_time).split(":")[:2])
    except (TypeError, ValueError):
        return None
    return datetime.combine(presence.presence_date, datetime.min.time()).replace(hour=hour, minute=minute)


def detect(
    db: Session,
    *,
    allowed_societies: list[str] | None,
    reference_datetime: datetime | None = None,
    threshold_minutes: int = MISSING_CHECKOUT_THRESHOLD_MINUTES,
) -> list[DetectorFinding]:
    """``allowed_societies`` : None = accès global, liste vide ou peuplée =
    restriction stricte (mêmes règles que le détecteur contrat)."""
    now = reference_datetime or datetime.utcnow()

    stmt = (
        select(DailyPresence, Employee)
        .join(Employee, Employee.id == DailyPresence.employee_id)
        .where(
            DailyPresence.arrival_time.is_not(None),
            DailyPresence.departure_time.is_(None),
            DailyPresence.closed_at.is_(None),
        )
    )
    if allowed_societies is not None:
        if not allowed_societies:
            return []
        stmt = stmt.where(Employee.society.in_(allowed_societies))

    findings: list[DetectorFinding] = []
    for presence, employee in db.execute(stmt).all():
        arrival_dt = _arrival_datetime(presence)
        if arrival_dt is None:
            continue
        elapsed_minutes = int((now - arrival_dt).total_seconds() // 60)
        if elapsed_minutes < threshold_minutes:
            continue
        society = employee.society or ""
        title = f"Présence sans sortie — {employee.code}"
        summary = (
            f"{employee.code} pointé(e) arrivé(e) à {presence.arrival_time} le "
            f"{presence.presence_date.isoformat()}, sans sortie ni clôture après "
            f"{elapsed_minutes} minute(s)."
        )
        findings.append(
            DetectorFinding(
                rule_key=RULE_MISSING_CHECKOUT,
                source_type="presence",
                source_id=str(presence.id),
                society=society,
                site_id=presence.site_id,
                title=title,
                summary=summary,
                evidence={
                    "presence_id": presence.id,
                    "employee_id": employee.id,
                    "employee_code": employee.code,
                    "presence_date": presence.presence_date.isoformat(),
                    "arrival_time": presence.arrival_time,
                    "departure_time": presence.departure_time,
                    "closed_at": presence.closed_at.isoformat() if presence.closed_at else None,
                    "site_id": presence.site_id,
                    "elapsed_minutes": elapsed_minutes,
                    "threshold_minutes": threshold_minutes,
                    "society": society,
                },
                score_context={"elapsed_minutes": elapsed_minutes, "threshold_minutes": threshold_minutes},
                dedup_dimensions={
                    "employee_id": employee.id,
                    "presence_date": presence.presence_date.isoformat(),
                    "site_id": presence.site_id,
                },
            )
        )
    return findings
