"""Service alertes : transforme les findings des détecteurs en Alert/
AlertEvidence/AlertHistory, gère la déduplication, le cycle de vie et les
agrégats. Aucune action métier automatique : ce service ne modifie jamais
Employee/DailyPresence/Contract, il se contente de les observer.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.alerts.detectors import DetectorFinding
from app.modules.alerts import repository
from app.modules.alerts.lifecycle import ensure_valid_transition, target_status_for_action
from app.modules.alerts.models import Alert, AlertEvidence, AlertHistory
from app.modules.alerts.rules import RULE_CONTRACT_EXPIRING, RULE_MISSING_CHECKOUT
from app.modules.alerts.scoring import ScoreResult, score_contract_expiring, score_missing_checkout

OPEN_FAMILY_STATUSES = frozenset({"open", "acknowledged", "assigned", "deferred"})
# Statuts qu'une réapparition NE réouvre PAS automatiquement : décision explicite
# d'un humain (ignore/treated), respectée tant qu'il ne la change pas lui-même.
USER_CLOSED_STATUSES = frozenset({"ignored", "treated"})


def build_dedup_key(rule_key: str, dedup_dimensions: dict) -> str:
    """Déterministe : mêmes dimensions -> même clé, quel que soit l'ordre des
    champs fournis par le détecteur."""
    parts = "|".join(f"{key}={dedup_dimensions[key]}" for key in sorted(dedup_dimensions))
    return f"{rule_key}::{parts}"


def score_finding(finding: DetectorFinding) -> ScoreResult:
    if finding.rule_key == RULE_CONTRACT_EXPIRING:
        return score_contract_expiring(**finding.score_context)
    if finding.rule_key == RULE_MISSING_CHECKOUT:
        return score_missing_checkout(**finding.score_context)
    raise ValueError(f"Règle inconnue pour le scoring : {finding.rule_key}")


def _record_history(
    db: Session,
    alert: Alert,
    *,
    action: str,
    previous_status: str | None,
    new_status: str | None,
    actor_user_id: int | None = None,
    reason: str | None = None,
    metadata: dict | None = None,
    correlation_id: str | None = None,
) -> AlertHistory:
    entry = AlertHistory(
        alert_id=alert.id,
        action=action,
        previous_status=previous_status,
        new_status=new_status,
        actor_user_id=actor_user_id,
        reason=reason,
        metadata_json=metadata,
        correlation_id=correlation_id or str(uuid.uuid4()),
    )
    db.add(entry)
    return entry


def apply_finding(db: Session, finding: DetectorFinding, *, rule_version: int) -> tuple[Alert, bool]:
    """Crée ou met à jour l'Alert pour ce finding. Retourne (alert, created)."""
    dedup_key = build_dedup_key(finding.rule_key, finding.dedup_dimensions)
    result = score_finding(finding)
    now = datetime.utcnow()
    existing = repository.get_alert_by_dedup_key(db, dedup_key)

    if existing is None:
        alert = Alert(
            rule_key=finding.rule_key,
            rule_version=rule_version,
            source_type=finding.source_type,
            source_id=finding.source_id,
            society=finding.society,
            site_id=finding.site_id,
            status="open",
            severity=result.severity,
            score=result.score,
            confidence=result.confidence,
            title=finding.title,
            summary=finding.summary,
            first_detected_at=now,
            last_detected_at=now,
            occurrence_count=1,
            dedup_key=dedup_key,
        )
        try:
            # SAVEPOINT dédié : si l'insertion viole uq_alerts_dedup_key (course
            # concurrente — un autre run/processus vient de créer la même
            # occurrence entre notre lecture et notre écriture), seul CE
            # finding est annulé ; le reste du run (déjà flush/en attente de
            # commit) n'est pas perdu par un rollback global de la session.
            with db.begin_nested():
                db.add(alert)
                db.flush()  # obtenir alert.id pour l'evidence/l'historique
                db.add(
                    AlertEvidence(
                        alert_id=alert.id,
                        evidence_type=finding.source_type,
                        evidence_key="detection_snapshot",
                        evidence_value_json=finding.evidence,
                        observed_at=now,
                    )
                )
                _record_history(db, alert, action="detected", previous_status=None, new_status="open")
        except IntegrityError:
            existing = repository.get_alert_by_dedup_key(db, dedup_key)
            if existing is None:
                raise
            return _apply_update(db, existing, finding, result, now)
        return alert, True

    return _apply_update(db, existing, finding, result, now)


def _apply_update(db: Session, existing: Alert, finding: DetectorFinding, result: ScoreResult, now: datetime) -> tuple[Alert, bool]:
    previous_status = existing.status
    existing.last_detected_at = now
    existing.occurrence_count += 1
    existing.severity = result.severity
    existing.score = result.score
    existing.confidence = result.confidence
    existing.title = finding.title
    existing.summary = finding.summary
    db.add(
        AlertEvidence(
            alert_id=existing.id,
            evidence_type=finding.source_type,
            evidence_key="detection_snapshot",
            evidence_value_json=finding.evidence,
            observed_at=now,
        )
    )
    if previous_status == "resolved":
        # Recurrence après une résolution système : réouverture automatique légitime.
        existing.status = "open"
        _record_history(
            db, existing, action="reopened", previous_status=previous_status, new_status="open",
            reason="Occurrence de nouveau détectée après résolution.",
        )
    elif previous_status in USER_CLOSED_STATUSES:
        # Décision humaine explicite : on rafraîchit les preuves sans rouvrir.
        _record_history(
            db, existing, action="observed", previous_status=previous_status, new_status=previous_status,
            reason="Occurrence toujours détectée ; statut laissé inchangé (décision utilisateur).",
        )
    else:
        _record_history(db, existing, action="observed", previous_status=previous_status, new_status=previous_status)
    return existing, False


def resolve_stale_alerts(db: Session, *, rule_key: str, active_dedup_keys: set[str]) -> int:
    """Transitionne en 'resolved' les alertes ouvertes de cette règle dont
    l'occurrence n'a pas été retrouvée dans le dernier run (global, non scoped —
    seul l'orchestrateur système appelle cette fonction)."""
    stmt = select(Alert).where(Alert.rule_key == rule_key, Alert.status.in_(OPEN_FAMILY_STATUSES))
    resolved_count = 0
    for alert in db.execute(stmt).scalars().all():
        if alert.dedup_key in active_dedup_keys:
            continue
        previous_status = alert.status
        alert.status = "resolved"
        _record_history(
            db, alert, action="resolved", previous_status=previous_status, new_status="resolved",
            reason="Occurrence non retrouvée lors du dernier passage du détecteur.",
        )
        resolved_count += 1
    return resolved_count


def run_detector(db: Session, *, detector_key: str, rule_key: str, findings: list[DetectorFinding], rule_version: int) -> dict:
    """Applique un lot de findings d'UN détecteur (run global, non scoped) :
    crée/actualise les alertes, résout celles disparues, journalise le
    DetectionRun. Toute exception d'un finding individuel est isolée : les
    autres findings du même run sont quand même traités."""
    run = repository.create_detection_run(db, detector_key=detector_key)
    created = updated = errors = 0
    active_dedup_keys: set[str] = set()
    error_messages: list[str] = []
    for finding in findings:
        try:
            _alert, was_created = apply_finding(db, finding, rule_version=rule_version)
            active_dedup_keys.add(_alert.dedup_key)
            if was_created:
                created += 1
            else:
                updated += 1
        except Exception as exc:  # noqa: BLE001 — isolation volontaire, voir docstring
            errors += 1
            error_messages.append(str(exc))
    resolved = resolve_stale_alerts(db, rule_key=rule_key, active_dedup_keys=active_dedup_keys)
    db.commit()
    status = "success" if errors == 0 else "partial_failure"
    repository.finish_detection_run(
        db,
        run,
        status=status,
        scanned_count=len(findings),
        detected_count=len(findings),
        created_count=created,
        updated_count=updated,
        error_count=errors,
        error_summary="; ".join(error_messages[:10]) or None,
    )
    return {
        "run_id": run.id,
        "created": created,
        "updated": updated,
        "resolved": resolved,
        "errors": errors,
    }


def apply_lifecycle_action(
    db: Session,
    alert: Alert,
    *,
    action: str,
    actor_user_id: int,
    reason: str | None = None,
    assigned_user_id: int | None = None,
    deferred_until: datetime | None = None,
) -> Alert:
    if action == "ignore" and not (reason or "").strip():
        raise ValueError("Un motif est obligatoire pour ignorer une alerte")
    target_status = target_status_for_action(action)
    ensure_valid_transition(alert.status, target_status)
    previous_status = alert.status
    now = datetime.utcnow()
    alert.status = target_status
    if action == "acknowledge":
        alert.acknowledged_at = now
        alert.acknowledged_by_user_id = actor_user_id
    elif action == "assign":
        alert.assigned_user_id = assigned_user_id or actor_user_id
    elif action == "defer":
        alert.deferred_until = deferred_until
    elif action == "ignore":
        alert.ignored_at = now
        alert.ignored_by_user_id = actor_user_id
        alert.ignore_reason = reason
    elif action == "treated":
        alert.treated_at = now
        alert.treated_by_user_id = actor_user_id
    _record_history(
        db, alert, action=action, previous_status=previous_status, new_status=target_status,
        actor_user_id=actor_user_id, reason=reason,
    )
    db.commit()
    db.refresh(alert)
    return alert
