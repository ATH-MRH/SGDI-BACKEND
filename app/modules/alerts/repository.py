"""Accès données du domaine alertes — TOUJOURS scoped. Aucune fonction ici ne
retourne une lecture utilisateur brute non filtrée par société (et par site
quand applicable) : l'appelant doit résoudre explicitement son périmètre
(voir app.core.scope_policy.effective_society_values) avant tout appel de
liste ou de détail.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.alerts.models import Alert, AlertEvidence, AlertHistory, AlertRule, DetectionRun
from app.modules.alerts.rules import RULE_CATALOG
from app.modules.ops.models import DailyPresence


def ensure_rule_catalog(db: Session) -> None:
    """Seed idempotent du catalogue de règles depuis rules.RULE_CATALOG. Jamais
    fait par la migration (voir 20260913_0035_alert_foundation.py) : la
    migration crée seulement la structure, ce seed applicatif est rejouable
    sans risque (upsert par rule_key+rule_version)."""
    existing = {
        (row.rule_key, row.rule_version)
        for row in db.execute(select(AlertRule.rule_key, AlertRule.rule_version)).all()
    }
    changed = False
    for entry in RULE_CATALOG:
        key = (entry["rule_key"], entry["rule_version"])
        if key in existing:
            continue
        db.add(AlertRule(**entry))
        changed = True
    if changed:
        db.commit()


def get_rule(db: Session, rule_key: str) -> AlertRule | None:
    """Dernière version active d'une règle."""
    stmt = (
        select(AlertRule)
        .where(AlertRule.rule_key == rule_key, AlertRule.enabled.is_(True))
        .order_by(AlertRule.rule_version.desc())
    )
    return db.execute(stmt).scalars().first()


def get_alert_by_dedup_key(db: Session, dedup_key: str) -> Alert | None:
    return db.execute(select(Alert).where(Alert.dedup_key == dedup_key)).scalars().first()


def _scoped_alert_stmt(*, allowed_societies: list[str] | None, allowed_site_ids: list[int] | None):
    stmt = select(Alert)
    if allowed_societies is not None:
        stmt = stmt.where(Alert.society.in_(allowed_societies))
    if allowed_site_ids is not None:
        # Un site restreint ne doit jamais masquer les alertes sans site (ex. contrat) :
        # seules les alertes rattachées à un site hors périmètre sont exclues.
        stmt = stmt.where(or_(Alert.site_id.is_(None), Alert.site_id.in_(allowed_site_ids)))
    return stmt


def list_alerts(
    db: Session,
    *,
    allowed_societies: list[str] | None,
    allowed_site_ids: list[int] | None,
    status: str | None = None,
    severity: str | None = None,
    module_key: str | None = None,
    rule_key: str | None = None,
    society: str | None = None,
    site_id: int | None = None,
    assigned_user_id: int | None = None,
    employee_id: int | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[Alert], int]:
    stmt = _scoped_alert_stmt(allowed_societies=allowed_societies, allowed_site_ids=allowed_site_ids)
    if status:
        stmt = stmt.where(Alert.status == status)
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if module_key:
        rule_keys = select(AlertRule.rule_key).where(AlertRule.module_key == module_key)
        stmt = stmt.where(Alert.rule_key.in_(rule_keys))
    if rule_key:
        stmt = stmt.where(Alert.rule_key == rule_key)
    if society:
        stmt = stmt.where(Alert.society == society)
    if site_id is not None:
        stmt = stmt.where(Alert.site_id == site_id)
    if assigned_user_id is not None:
        stmt = stmt.where(Alert.assigned_user_id == assigned_user_id)
    if employee_id is not None:
        # Deux conventions coexistent selon le détecteur (voir detectors/) :
        # rule "employee_contract.expiring" identifie directement l'employé
        # (source_type="employee"), "missing_checkout" identifie la présence
        # (source_type="presence") — on résout ses ID de présence pour cet
        # employé afin de ne rien inventer côté frontend (dossier employé 360°).
        presence_ids = [
            str(pid) for (pid,) in db.execute(
                select(DailyPresence.id).where(DailyPresence.employee_id == employee_id)
            ).all()
        ]
        employee_clause = (Alert.source_type == "employee") & (Alert.source_id == str(employee_id))
        if presence_ids:
            stmt = stmt.where(employee_clause | ((Alert.source_type == "presence") & (Alert.source_id.in_(presence_ids))))
        else:
            stmt = stmt.where(employee_clause)
    if since is not None:
        stmt = stmt.where(Alert.last_detected_at >= since)
    if until is not None:
        stmt = stmt.where(Alert.last_detected_at <= until)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    stmt = stmt.order_by(Alert.last_detected_at.desc()).limit(limit).offset(offset)
    rows = db.execute(stmt).scalars().all()
    return list(rows), int(total)


def get_alert(
    db: Session, alert_id: int, *, allowed_societies: list[str] | None, allowed_site_ids: list[int] | None
) -> Alert | None:
    stmt = _scoped_alert_stmt(allowed_societies=allowed_societies, allowed_site_ids=allowed_site_ids).where(
        Alert.id == alert_id
    )
    return db.execute(stmt).scalars().first()


def list_evidence(db: Session, alert_id: int) -> list[AlertEvidence]:
    stmt = select(AlertEvidence).where(AlertEvidence.alert_id == alert_id).order_by(AlertEvidence.observed_at.desc())
    return list(db.execute(stmt).scalars().all())


def list_history(db: Session, alert_id: int) -> list[AlertHistory]:
    stmt = select(AlertHistory).where(AlertHistory.alert_id == alert_id).order_by(AlertHistory.created_at.desc())
    return list(db.execute(stmt).scalars().all())


def stats(
    db: Session, *, allowed_societies: list[str] | None, allowed_site_ids: list[int] | None, current_user_id: int | None = None
) -> dict:
    stmt = _scoped_alert_stmt(allowed_societies=allowed_societies, allowed_site_ids=allowed_site_ids)
    rows = db.execute(stmt).scalars().all()
    open_statuses = {"open", "acknowledged", "assigned", "deferred"}
    return {
        "total_open": sum(1 for a in rows if a.status in open_statuses),
        "critical": sum(1 for a in rows if a.status in open_statuses and a.severity == "critical"),
        "unacknowledged": sum(1 for a in rows if a.status == "open"),
        "assigned_to_me": sum(
            1 for a in rows if current_user_id is not None and a.assigned_user_id == current_user_id and a.status in open_statuses
        ),
    }


def create_detection_run(db: Session, *, detector_key: str) -> DetectionRun:
    run = DetectionRun(detector_key=detector_key, started_at=datetime.utcnow(), status="running")
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def finish_detection_run(
    db: Session,
    run: DetectionRun,
    *,
    status: str,
    scanned_count: int,
    detected_count: int,
    created_count: int,
    updated_count: int,
    error_count: int = 0,
    error_summary: str | None = None,
) -> DetectionRun:
    run.finished_at = datetime.utcnow()
    run.status = status
    run.scanned_count = scanned_count
    run.detected_count = detected_count
    run.created_count = created_count
    run.updated_count = updated_count
    run.error_count = error_count
    run.error_summary = error_summary
    db.commit()
    db.refresh(run)
    return run
