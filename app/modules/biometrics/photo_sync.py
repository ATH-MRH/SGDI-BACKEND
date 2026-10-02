"""Synchronisation automatique « photo DRH → référence faciale » — LOT B.

DRH → Fiche de position → Photo employé : lorsqu'une photo est AJOUTÉE ou ACTUALISÉE par la
caméra ou par un import depuis la fiche, la référence faciale est préparée sans aucune autre
action de l'opérateur RH. Réglage serveur DRH_FACIAL_REFERENCE_AUTO_SYNC_ENABLED (FAUX par
défaut : comportement inchangé). N'active JAMAIS le pointage facial (BIOMETRIC_ENABLED).

Garanties :
- l'enregistrement de la fiche est prioritaire : cette synchronisation s'exécute APRÈS la
  validation de la fiche, dans sa propre transaction ; aucun échec ne remonte à la fiche ;
- déclenchement uniquement par un événement photo (sources DRH_CAMERA / DRH_UPLOAD) : aucun
  balayage de la base, aucun traitement au démarrage, aucune photo historique traitée ;
- une ligne d'état par employé, liée à l'EMPREINTE de la photo : même photo ⇒ aucun nouveau
  traitement ; une tâche portant une ancienne empreinte n'écrit jamais rien ;
- remplacement dans UNE transaction : nouvelle référence activée, puis ancienne désactivée ;
  tout échec intermédiaire annule l'ensemble et laisse l'ancienne référence active ;
- visage différent, ambigu ou doublon possible : la nouvelle référence reste EN REVUE,
  l'ancienne reste active ; refus / retrait enregistré : rien n'est activé (BLOCKED).

Ni image, ni gabarit, ni score dans la table d'état ; jamais d'image ni de gabarit dans l'audit.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.config import settings
from app.modules.biometrics import crypto, service
from app.modules.biometrics.engine import EngineUnavailable, cosine, get_engine
from app.modules.biometrics.models import (
    SYNC_BLOCKED,
    SYNC_ENGINE_UNAVAILABLE,
    SYNC_PHOTO_INVALID,
    SYNC_PROCESSING,
    SYNC_READY,
    SYNC_REVIEW_REQUIRED,
    TEMPLATE_ACTIVE,
    TEMPLATE_INACTIVE,
    TEMPLATE_PENDING_REVIEW,
    BiometricPhotoSync,
)
from app.modules.drh.models import Employee

logger = logging.getLogger("sgdi.biometrics.photo_sync")

# Provenance de la photo. Seules les deux premières déclenchent la synchronisation ; les
# autres (import, synchronisation historique, appel d'API sans provenance) ne déclenchent
# rien tant qu'une décision séparée ne les a pas ouvertes.
SOURCE_DRH_CAMERA = "DRH_CAMERA"
SOURCE_DRH_UPLOAD = "DRH_UPLOAD"
TRIGGER_SOURCES = frozenset({SOURCE_DRH_CAMERA, SOURCE_DRH_UPLOAD})
EXCLUDED_SOURCES = frozenset({"IMPORT", "LEGACY_SYNC", "DRH_API"})

RETRYABLE = frozenset({SYNC_ENGINE_UNAVAILABLE, SYNC_BLOCKED})   # même photo : nouvelle tentative admise
STALE_PROCESSING_SECONDS = 120        # tâche perdue (redémarrage) : reprise à la consultation
RETRY_UNAVAILABLE_SECONDS = 600       # moteur indisponible : reprise à la consultation
MAX_RETRIES = 3


def auto_sync_enabled() -> bool:
    """Réglage explicite ET enrôlement autorisé sur ce serveur (jamais BIOMETRIC_ENABLED seul)."""
    return bool(settings.drh_facial_reference_auto_sync_enabled) and service.enrollment_enabled()


def trigger_source(value: Any) -> str | None:
    source = str(value or "").strip().upper()
    return source if source in TRIGGER_SOURCES else None


def _state(db: Session, employee_id: int, *, lock: bool = False) -> BiometricPhotoSync | None:
    stmt = select(BiometricPhotoSync).where(BiometricPhotoSync.employee_id == employee_id)
    return db.execute(stmt.with_for_update() if lock else stmt).scalar_one_or_none()


def current_state(db: Session, employee: Employee) -> BiometricPhotoSync | None:
    """État de synchronisation de la photo ACTUELLE de la fiche (lecture seule), sinon None."""
    if not auto_sync_enabled():
        return None
    fingerprint = service.photo_fingerprint(employee)
    if fingerprint is None:
        return None
    row = _state(db, employee.id)
    return row if row is not None and row.photo_fingerprint == fingerprint else None


def supervises(db: Session, employee: Employee) -> bool:
    return current_state(db, employee) is not None


# ── Demande (après l'enregistrement réussi de la fiche) ───────────────────────────────────
def request_sync(db: Session, *, employee: Employee, source: Any, actor: Any, previous_fingerprint: str | None) -> str | None:
    """Enregistre la demande de synchronisation si — et seulement si — la photo de la fiche
    vient réellement de changer par une source déclenchante. Renvoie l'empreinte à traiter,
    ou None (réglage désactivé, source exclue, photo inchangée, même photo déjà traitée)."""
    origin = trigger_source(source)
    if origin is None or not auto_sync_enabled():
        return None
    fingerprint = service.photo_fingerprint(employee)
    if fingerprint is None:
        return None
    now = datetime.utcnow()
    for _ in range(2):
        row = _state(db, employee.id, lock=True)
        if row is not None:
            break
        if fingerprint == previous_fingerprint:
            return None                                   # photo inchangée, jamais synchronisée : rien
        try:
            with db.begin_nested():
                row = BiometricPhotoSync(employee_id=employee.id, photo_fingerprint=fingerprint, status=SYNC_PROCESSING,
                                         source=origin, requested_by=getattr(actor, "username", None), requested_at=now,
                                         attempts=0, previous_reference_kept=False)
                db.add(row)
                db.flush()
            _audit(db, "requested", employee, actor, row)
            db.commit()
            return fingerprint
        except IntegrityError:
            continue                                      # demande concurrente : on reprend la ligne existante
    else:
        return None
    if row.photo_fingerprint == fingerprint:
        if row.status not in RETRYABLE:
            db.rollback()
            return None                                   # même empreinte déjà traitée ou en cours : idempotent
    elif fingerprint == previous_fingerprint:
        db.rollback()
        return None                                       # photo inchangée par cet enregistrement
    row.photo_fingerprint = fingerprint
    row.status = SYNC_PROCESSING
    row.reason_code = row.reason_detail = None
    row.source = origin
    row.requested_by = getattr(actor, "username", None)
    row.requested_at = now
    row.analyzed_at = None
    row.attempts = 0
    row.template_id = None
    row.previous_reference_kept = False
    db.flush()
    _audit(db, "requested", employee, actor, row)
    db.commit()
    return fingerprint


def retry_if_due(db: Session, employee: Employee) -> str | None:
    """Reprise à la demande (consultation de la fiche) d'une synchronisation perdue ou
    différée par une indisponibilité : jamais de balayage, seulement CET employé."""
    row = current_state(db, employee)
    if row is None:
        return None
    age = datetime.utcnow() - (row.updated_at or row.requested_at)
    due = (row.status == SYNC_PROCESSING and age > timedelta(seconds=STALE_PROCESSING_SECONDS)) or \
          (row.status == SYNC_ENGINE_UNAVAILABLE and age > timedelta(seconds=RETRY_UNAVAILABLE_SECONDS))
    if not due:
        return None
    row = _state(db, employee.id, lock=True)
    if row is None or row.status not in (SYNC_PROCESSING, SYNC_ENGINE_UNAVAILABLE):
        db.rollback()
        return None
    if row.attempts >= MAX_RETRIES:
        if row.status == SYNC_PROCESSING:
            row.status, row.reason_code, row.analyzed_at = SYNC_ENGINE_UNAVAILABLE, "RETRY_EXHAUSTED", datetime.utcnow()
            db.commit()
        else:
            db.rollback()
        return None
    row.attempts += 1
    row.status = SYNC_PROCESSING
    row.updated_at = datetime.utcnow()
    db.commit()
    return row.photo_fingerprint


# ── Point d'entrée unique du traitement ───────────────────────────────────────────────────
def sync_facial_reference_from_employee_photo(db: Session, *, employee_id: int, fingerprint: str, actor: Any = None) -> str | None:
    """Prépare la référence faciale à partir de la photo de la fiche dont l'empreinte est
    `fingerprint`. Renvoie l'état obtenu, ou None si la demande est périmée (photo plus
    récente) ou déjà traitée (idempotent). Ne lève jamais : tout échec devient un état."""
    try:
        row = _state(db, employee_id, lock=True)
        if row is None or row.photo_fingerprint != fingerprint or row.status != SYNC_PROCESSING:
            db.rollback()
            return None
        employee = db.get(Employee, employee_id)
        if employee is None:
            db.rollback()
            return None
        status = _decide(db, employee, row, actor)
        db.commit()
        return status
    except Exception:
        db.rollback()
        logger.exception("Synchronisation de la référence faciale en échec (employé %s)", employee_id)
        return _mark_unavailable(db, employee_id, fingerprint, actor)


def run_sync_task(employee_id: int, fingerprint: str, actor_id: int | None = None) -> None:
    """Tâche d'arrière-plan : sa propre session, sa propre transaction."""
    from app.db import session as db_session
    from app.modules.auth.models import User

    db = db_session.SessionLocal()
    try:
        actor = db.get(User, actor_id) if actor_id else None
        sync_facial_reference_from_employee_photo(db, employee_id=employee_id, fingerprint=fingerprint, actor=actor)
    except Exception:                                       # ne doit jamais remonter au serveur web
        logger.exception("Tâche de synchronisation faciale interrompue (employé %s)", employee_id)
    finally:
        db.close()


def _decide(db: Session, employee: Employee, row: BiometricPhotoSync, actor: Any) -> str:
    fingerprint = row.photo_fingerprint
    previous = service.templates_of(db, employee.id, (TEMPLATE_ACTIVE,))

    def finish(status: str, code: str | None = None, detail: str | None = None, template_id: int | None = None,
               replaced: bool = False) -> str:
        row.status, row.reason_code, row.reason_detail = status, code, (detail or None) and str(detail)[:200]
        row.analyzed_at = datetime.utcnow()
        row.template_id = template_id
        row.previous_reference_kept = bool(previous) and status != SYNC_READY
        db.flush()
        _audit(db, {SYNC_READY: "ready", SYNC_PHOTO_INVALID: "photo_invalid", SYNC_REVIEW_REQUIRED: "review_required",
                    SYNC_BLOCKED: "blocked", SYNC_ENGINE_UNAVAILABLE: "unavailable"}[status], employee, actor, row, replaced=replaced)
        return status

    if service.photo_fingerprint(employee) != fingerprint:
        return finish(SYNC_PHOTO_INVALID, "PHOTO_CHANGED")           # la fiche porte déjà une autre photo
    if service.enrollment_status_block(employee):
        return finish(SYNC_BLOCKED, "EMPLOYEE_STATUS")
    blocked = service.consent_block(db, employee.id)
    if blocked:
        return finish(SYNC_BLOCKED, blocked)
    if not service.key_configured():
        return finish(SYNC_ENGINE_UNAVAILABLE, "KEY_MISSING")
    try:
        engine = get_engine()
    except EngineUnavailable:
        return finish(SYNC_ENGINE_UNAVAILABLE, "ENGINE_UNAVAILABLE")
    path = service._employee_photo_path(employee)
    data = path.read_bytes() if path else b""
    if not data or hashlib.sha256(data).hexdigest() != fingerprint:
        return finish(SYNC_PHOTO_INVALID, "PHOTO_CHANGED")
    cfg = service.active_config(db)
    decision = service.analyze_frames(engine, [data], cfg, require_liveness=False)
    if decision.state != "OK":
        code = decision.state if decision.state in ("NO_FACE", "MULTIPLE_FACES", "QUALITY_FAILED") else "QUALITY_FAILED"
        return finish(SYNC_PHOTO_INVALID, code, (decision.reasons or [None])[0])
    embedding = decision.face.embedding
    score = max((cosine(embedding, crypto.decrypt_vector(t.embedding_encrypted)) for t in previous), default=None)
    result = service.compare_one_to_one(score, cfg) if previous else "NOT_APPLICABLE"
    _supersede_pending(db, employee, fingerprint, actor)
    stored = service._store_template(
        db, employee=employee, actor=actor, embedding=embedding, source="EMPLOYEE_PHOTO", source_ref=path.name,
        quality={**(decision.quality or {}), "photo_sha256": fingerprint, "origin": row.source},
        engine_id=engine.engine_id, config_version=cfg.version,
        comparison={"result": result, "score": round(score, 4) if score is not None else None},
        justification=None, identity_review=result in ("NO_MATCH", "REVIEW_REQUIRED"))
    if stored["status"] == TEMPLATE_ACTIVE:
        return finish(SYNC_READY, template_id=stored["template_id"], replaced=bool(previous))
    code = "POSSIBLE_DUPLICATE" if stored["duplicate"] else ("FACE_MISMATCH" if result == "NO_MATCH" else "FACE_AMBIGUOUS")
    return finish(SYNC_REVIEW_REQUIRED, code, template_id=stored["template_id"])


def _supersede_pending(db: Session, employee: Employee, fingerprint: str, actor: Any) -> None:
    """Une référence EN REVUE issue d'une photo plus ancienne n'a plus d'objet : elle ne doit
    pas pouvoir être activée par la suite à la place de la photo actuelle."""
    from app.modules.attendance.models import ANOMALY_OPEN, AttendanceAnomaly

    now = datetime.utcnow()
    for old in service.templates_of(db, employee.id, (TEMPLATE_PENDING_REVIEW,)):
        if old.source != "EMPLOYEE_PHOTO" or (old.quality or {}).get("photo_sha256") == fingerprint:
            continue
        old.status, old.deactivated_at, old.status_reason = TEMPLATE_INACTIVE, now, "Photo de la fiche remplacée avant la revue"
        anomaly = db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.dedupe_key == f"DUPLICATE:{old.id}")).scalar_one_or_none()
        if anomaly is not None and anomaly.status == ANOMALY_OPEN:
            anomaly.status, anomaly.resolved_at = "RESOLVED", now
            anomaly.resolution = "Photo de la fiche remplacée avant la revue"
            anomaly.resolved_by = getattr(actor, "username", None)
    db.flush()


def _mark_unavailable(db: Session, employee_id: int, fingerprint: str, actor: Any) -> str | None:
    try:
        row = _state(db, employee_id, lock=True)
        if row is None or row.photo_fingerprint != fingerprint or row.status != SYNC_PROCESSING:
            db.rollback()
            return None
        employee = db.get(Employee, employee_id)
        row.status, row.reason_code, row.reason_detail = SYNC_ENGINE_UNAVAILABLE, "INTERNAL_ERROR", None
        row.analyzed_at = datetime.utcnow()
        row.template_id = None
        row.previous_reference_kept = bool(service.templates_of(db, employee_id, (TEMPLATE_ACTIVE,)))
        db.flush()
        if employee is not None:
            _audit(db, "unavailable", employee, actor, row)
        db.commit()
        return SYNC_ENGINE_UNAVAILABLE
    except Exception:
        db.rollback()
        logger.exception("État de synchronisation faciale non enregistré (employé %s)", employee_id)
        return None


def _audit(db: Session, event: str, employee: Employee, actor: Any, row: BiometricPhotoSync, *, replaced: bool = False) -> None:
    """Jamais d'image, de gabarit, de clé ni de secret : états, codes et empreinte tronquée."""
    append_audit(db, action=f"drh.facial_reference.{event}", resource="employee", resource_id=employee.id,
                 result="success" if event in ("requested", "ready") else "failure", user=actor, society=employee.society,
                 new_state={"status": row.status, "reason": row.reason_code, "source": row.source,
                            "photo": (row.photo_fingerprint or "")[:12], "reference_id": row.template_id,
                            "replaced": replaced, "previous_reference_kept": bool(row.previous_reference_kept)})
