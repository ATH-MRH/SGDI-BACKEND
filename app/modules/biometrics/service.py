"""Biométrie faciale — consentement, enrôlement, doublons, reconnaissance, pointage automatique.

Principes (docs/biometrics.md) :
- Aucun gabarit actif sans consentement admissible ; retrait/refus ⇒ désactivation immédiate.
- Photo administrative ≠ gabarit : la photo de la fiche est lue, jamais copiée ; le gabarit est
  chiffré, jamais renvoyé, jamais journalisé.
- Doublon possible ⇒ activation BLOQUÉE, anomalie POSSIBLE_DUPLICATE_FACE, décision humaine.
- Visage inconnu / ambigu / incertain / liveness en échec / qualité insuffisante ⇒ AUCUN
  pointage ; jamais de rattachement au « meilleur candidat » sous le seuil.
- Un pointage facial accepté passe par Attendance Core (source FACIAL) comme toute source.
"""
from __future__ import annotations

import hashlib
import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.config import settings
from app.modules.attendance import core as attendance_core
from app.modules.attendance.models import SOURCE_FACIAL, AttendanceEvent
from app.modules.biometrics import crypto
from app.modules.biometrics.engine import EngineUnavailable, FaceEngine, FaceObservation, cosine, get_engine
from app.modules.biometrics.models import (
    CONSENT_ADMISSIBLE,
    CONSENT_PENDING,
    CONSENT_REFUSED,
    CONSENT_SOURCES,
    CONSENT_STATUSES,
    CONSENT_WITHDRAWN,
    TEMPLATE_ACTIVE,
    TEMPLATE_INACTIVE,
    TEMPLATE_PENDING_REVIEW,
    TEMPLATE_REJECTED,
    BiometricConfig,
    BiometricConsent,
    BiometricTemplate,
    Camera,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment

# ── Information de l'employé (versionnée) ─────────────────────────────────────────────────
NOTICE_VERSION = "2026-09-v1"
NOTICE_TEXT = """INFORMATION — POINTAGE PAR RECONNAISSANCE FACIALE (version 2026-09-v1)

Finalité : contrôler le pointage (arrivées et départs) sur les sites où vous êtes affecté(e).
Données utilisées : un gabarit numérique calculé à partir des caractéristiques de votre visage.
Le gabarit n'est pas une photo ; il est chiffré et ne sert qu'à la comparaison lors du pointage.
Source : la photo de votre fiche employé ou, si elle n'est pas exploitable, une capture réalisée
par une caméra de pointage autorisée, en votre présence.
Utilisation : limitée au pointage sur les sites autorisés. Aucune autre utilisation.
Sécurité : stockage chiffré, accès réservé aux personnes habilitées, traçabilité des accès.
Conservation : selon la politique de conservation définie par IRON Global (Direction des
Ressources Humaines). Le gabarit est désactivé en cas de retrait de l'accord ou de départ.
Erreur : si le système ne vous reconnaît pas ou vous confond avec une autre personne,
signalez-le à votre responsable ou à la DRH ; un pointage de secours reste toujours possible.
Refus ou retrait : conformément aux règles RH applicables, vous pouvez refuser ou retirer votre
accord ; le pointage se fait alors par une autre méthode (QR, saisie par un opérateur).
Contact : Direction des Ressources Humaines d'IRON Global.
"""

# ── Configuration versionnée ─────────────────────────────────────────────────────────────
DEFAULT_CONFIG = {
    "recognition_threshold": 0.363,
    "review_margin": 0.07,
    "duplicate_threshold": 0.363,
    "liveness_threshold": 0.80,
    "quality_min_detection_score": 0.90,
    "quality_min_face_px": 80,
    "quality_min_sharpness": 60.0,
    "cooldown_seconds": 60,
}
DEFAULT_PROVENANCE = (
    "v1 — recognition/duplicate 0.363 : seuil cosinus de l'exemple officiel OpenCV pour SFace "
    "(samples/dnn/face_detect.py) ; mesures locales : même personne 0.81, personnes différentes "
    "0.14–0.26. review_margin 0.07 : bande prudente [0.363 ; 0.433) → nouvel essai / revue. "
    "liveness 0.80 : probabilité « réel » MiniFASNetV2 (projet d'origine : argmax). "
    "qualité : score YuNet 0.90 (valeur de l'exemple OpenCV), visage ≥ 80 px, netteté (variance "
    "du laplacien sur 112 px) ≥ 60 — mesures locales : net 845–1418, flou 5–7. "
    "cooldown 60 s : fenêtre de non-répétition caméra (l'anti-rebond d'Attendance Core reste actif). "
    "À CALIBRER SUR SITE avec la caméra réelle avant toute activation (voir docs/biometrics.md)."
)
CONFIG_FIELDS = tuple(DEFAULT_CONFIG)


def active_config(db: Session) -> BiometricConfig:
    row = db.execute(select(BiometricConfig).order_by(BiometricConfig.version.desc()).limit(1)).scalar_one_or_none()
    if row is None:
        row = BiometricConfig(version=1, provenance=DEFAULT_PROVENANCE, created_by="system", **DEFAULT_CONFIG)
        db.add(row)
        db.flush()
    return row


def new_config_version(db: Session, *, values: dict[str, Any], provenance: str, actor: Any) -> BiometricConfig:
    if not str(provenance or "").strip():
        raise HTTPException(422, detail="Provenance obligatoire : d'où viennent ces seuils ?")
    current = active_config(db)
    data = {field: getattr(current, field) for field in CONFIG_FIELDS}
    for key, value in values.items():
        if key not in CONFIG_FIELDS or value is None:
            continue
        data[key] = value
    for key in ("recognition_threshold", "duplicate_threshold", "liveness_threshold", "quality_min_detection_score"):
        if not 0 < float(data[key]) < 1:
            raise HTTPException(422, detail=f"{key} doit être compris entre 0 et 1")
    row = BiometricConfig(version=current.version + 1, provenance=provenance.strip(),
                          created_by=getattr(actor, "username", None), **data)
    db.add(row)
    db.flush()
    append_audit(db, action="biometrics.config", resource="biometric_config", resource_id=row.version, result="success",
                 user=actor, old_state={f: getattr(current, f) for f in CONFIG_FIELDS}, new_state={**data, "provenance": row.provenance})
    return row


def ensure_enabled() -> FaceEngine:
    if not settings.biometric_enabled:
        raise HTTPException(503, detail="Biométrie désactivée (BIOMETRIC_ENABLED=false)")
    try:
        return get_engine()
    except EngineUnavailable as exc:
        raise HTTPException(503, detail=f"Moteur biométrique indisponible : {exc}") from None


# ── Consentement ─────────────────────────────────────────────────────────────────────────
def current_consent(db: Session, employee_id: int) -> BiometricConsent | None:
    return db.execute(select(BiometricConsent).where(BiometricConsent.employee_id == employee_id)
                      .order_by(BiometricConsent.id.desc()).limit(1)).scalar_one_or_none()


def record_consent(db: Session, *, employee: Employee, status: str, source: str, consent_date: datetime | None,
                   proof_reference: str | None, notice_version: str, actor: Any, comment: str | None = None) -> BiometricConsent:
    if status not in CONSENT_STATUSES:
        raise HTTPException(422, detail="Statut de consentement invalide")
    if source not in CONSENT_SOURCES:
        raise HTTPException(422, detail="Source de consentement invalide")
    if status in CONSENT_ADMISSIBLE and notice_version != NOTICE_VERSION:
        raise HTTPException(422, detail=f"L'accord doit porter sur la version en vigueur du texte d'information ({NOTICE_VERSION})")
    if status in CONSENT_ADMISSIBLE and not str(proof_reference or "").strip():
        raise HTTPException(422, detail="Référence du document ou du contrat obligatoire")
    row = BiometricConsent(employee_id=employee.id, status=status, source=source, consent_date=consent_date,
                           proof_reference=(proof_reference or "").strip() or None, notice_version=notice_version,
                           recorded_by=getattr(actor, "username", None), comment=comment)
    db.add(row)
    db.flush()
    if status in (CONSENT_REFUSED, CONSENT_WITHDRAWN, CONSENT_PENDING):
        deactivate_templates(db, employee_id=employee.id, reason=f"Consentement {status}", actor=actor)
    append_audit(db, action="biometrics.consent", resource="employee", resource_id=employee.id, result="success",
                 user=actor, society=employee.society,
                 new_state={"status": status, "source": source, "notice_version": notice_version, "reference": row.proof_reference})
    return row


def consent_admissible(db: Session, employee_id: int) -> bool:
    consent = current_consent(db, employee_id)
    return bool(consent and consent.status in CONSENT_ADMISSIBLE and consent.notice_version == NOTICE_VERSION)


# ── Analyse d'images ─────────────────────────────────────────────────────────────────────
@dataclass
class FrameDecision:
    state: str                      # OK | NO_FACE | MULTIPLE_FACES | QUALITY_FAILED | LIVENESS_FAILED
    face: FaceObservation | None
    reasons: list[str]
    liveness: float | None = None
    quality: dict | None = None


def _quality_failures(face: FaceObservation, cfg: BiometricConfig) -> list[str]:
    reasons = []
    if face.detection_score < cfg.quality_min_detection_score:
        reasons.append("Visage mal détecté (cadrage, orientation ou occlusion)")
    if face.face_px < cfg.quality_min_face_px:
        reasons.append("Visage trop petit — approchez-vous")
    if face.sharpness < cfg.quality_min_sharpness:
        reasons.append("Image floue — restez immobile")
    return reasons


def _quality_summary(face: FaceObservation) -> dict:
    return {"detection_score": round(face.detection_score, 3), "face_px": face.face_px,
            "sharpness": round(face.sharpness, 1), "brightness": round(face.brightness, 1),
            "liveness_real": round(face.liveness_real, 3) if face.liveness_real is not None else None}


def _static_scene(faces: list[FaceObservation]) -> bool:
    """Plusieurs trames au pixel près identiques : image figée ré-injectée (un capteur réel
    produit toujours du bruit entre deux trames)."""
    if len(faces) < 2:
        return False
    diffs = [sum(abs(a - b) for a, b in zip(faces[i].signature, faces[i + 1].signature)) / len(faces[i].signature)
             for i in range(len(faces) - 1)]
    return max(diffs) < 0.002


def analyze_frames(engine: FaceEngine, frames: list[bytes], cfg: BiometricConfig, *, require_liveness: bool) -> FrameDecision:
    """Fenêtre d'observation : sélection AUTOMATIQUE de la meilleure trame (aucun bouton
    Capturer). Plusieurs visages dans une trame ⇒ aucune attribution arbitraire."""
    if not frames:
        raise HTTPException(422, detail="Aucune image reçue")
    usable: list[FaceObservation] = []
    multiple = False
    for frame in frames[:10]:
        try:
            analysis = engine.analyze(frame)
        except ValueError:
            continue
        relevant = [f for f in analysis.faces if f.detection_score >= 0.6]
        if len(relevant) > 1:
            multiple = True
        elif len(relevant) == 1:
            usable.append(relevant[0])
    if multiple:
        return FrameDecision("MULTIPLE_FACES", None, ["Plusieurs visages détectés — présentez-vous individuellement"])
    if not usable:
        return FrameDecision("NO_FACE", None, ["Aucun visage détecté"])
    passing = [f for f in usable if not _quality_failures(f, cfg)]
    if not passing:
        best = max(usable, key=lambda f: (f.detection_score, f.sharpness))
        return FrameDecision("QUALITY_FAILED", best, _quality_failures(best, cfg), quality=_quality_summary(best))
    best = max(passing, key=lambda f: (f.detection_score * min(f.sharpness, 1000) * min(f.face_px, 400)))
    quality = _quality_summary(best)
    if require_liveness:
        scores = [f.liveness_real for f in passing if f.liveness_real is not None]
        if _static_scene(usable):
            return FrameDecision("LIVENESS_FAILED", best, ["Image figée détectée"], liveness=0.0, quality=quality)
        if not scores:
            return FrameDecision("LIVENESS_FAILED", best, ["Contrôle de présence réelle impossible"], quality=quality)
        median = statistics.median(scores)
        if median < cfg.liveness_threshold or (best.liveness_real or 0) < cfg.liveness_threshold:
            return FrameDecision("LIVENESS_FAILED", best, ["Présence réelle non confirmée"], liveness=median, quality=quality)
        return FrameDecision("OK", best, [], liveness=median, quality=quality)
    return FrameDecision("OK", best, [], quality=quality)


# ── Gabarits ─────────────────────────────────────────────────────────────────────────────
def templates_of(db: Session, employee_id: int, statuses: tuple[str, ...] = (TEMPLATE_ACTIVE,)) -> list[BiometricTemplate]:
    return db.execute(select(BiometricTemplate).where(BiometricTemplate.employee_id == employee_id,
                                                      BiometricTemplate.status.in_(statuses))
                      .order_by(BiometricTemplate.id.desc())).scalars().all()


def deactivate_templates(db: Session, *, employee_id: int, reason: str, actor: Any,
                         statuses: tuple[str, ...] = (TEMPLATE_ACTIVE, TEMPLATE_PENDING_REVIEW)) -> int:
    rows = templates_of(db, employee_id, statuses)
    now = datetime.utcnow()
    for row in rows:
        row.status = TEMPLATE_INACTIVE
        row.deactivated_at = now
        row.status_reason = reason
    if rows:
        db.flush()
        append_audit(db, action="biometrics.template.deactivate", resource="employee", resource_id=employee_id,
                     result="success", user=actor, new_state={"templates": [r.id for r in rows], "reason": reason})
    return len(rows)


def _employee_photo_path(employee: Employee) -> Path | None:
    from app.core.photo_storage import PHOTOS_DIR, PUBLIC_PHOTO_PREFIX

    extra = employee.extra if isinstance(employee.extra, dict) else {}
    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    value = next((str(extra.get(k) or legacy.get(k) or "") for k in ("photo", "photoUrl", "photo_url") if extra.get(k) or legacy.get(k)), "")
    if not value.startswith(PUBLIC_PHOTO_PREFIX + "/"):
        return None
    name = value[len(PUBLIC_PHOTO_PREFIX) + 1:].split("?")[0]
    path = (PHOTOS_DIR / name).resolve()
    try:
        path.relative_to(PHOTOS_DIR.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def photo_fingerprint(employee: Employee) -> str | None:
    path = _employee_photo_path(employee)
    return hashlib.sha256(path.read_bytes()).hexdigest() if path else None


def invalidate_if_photo_changed(db: Session, employee: Employee, actor: Any = None) -> bool:
    """Photo de la fiche remplacée/supprimée ⇒ gabarit issu de l'ancienne photo invalidé."""
    current = photo_fingerprint(employee)
    changed = False
    for row in templates_of(db, employee.id, (TEMPLATE_ACTIVE, TEMPLATE_PENDING_REVIEW)):
        if row.source == "EMPLOYEE_PHOTO" and (row.quality or {}).get("photo_sha256") != current:
            row.status = TEMPLATE_INACTIVE
            row.deactivated_at = datetime.utcnow()
            row.status_reason = "Photo de la fiche remplacée ou supprimée — ré-enrôlement requis"
            changed = True
    if changed:
        db.flush()
        append_audit(db, action="biometrics.template.photo_changed", resource="employee", resource_id=employee.id,
                     result="success", user=actor)
    return changed


def _duplicate_candidates(db: Session, employee_id: int, embedding: list[float], cfg: BiometricConfig) -> tuple[int | None, float]:
    """Recherche de doublon sur TOUS les gabarits actifs ou en revue des AUTRES employés
    (un même visage ne doit jamais pointer sous deux identités, quel que soit le site)."""
    best_id, best_score = None, -1.0
    for row in db.execute(select(BiometricTemplate).where(
            BiometricTemplate.employee_id != employee_id,
            BiometricTemplate.status.in_((TEMPLATE_ACTIVE, TEMPLATE_PENDING_REVIEW)))).scalars():
        score = cosine(embedding, crypto.decrypt_vector(row.embedding_encrypted))
        if score > best_score:
            best_id, best_score = row.employee_id, score
    return (best_id, best_score) if best_score >= cfg.duplicate_threshold else (None, best_score)


def enroll(db: Session, *, employee: Employee, actor: Any, frames: list[bytes] | None = None,
           camera: Camera | None = None) -> dict[str, Any]:
    """Enrôlement : photo de la fiche en priorité (frames=None), sinon trames caméra (liveness
    exigé). Activation automatique si tout est conforme ; doublon ⇒ revue humaine."""
    from app.modules.attendance.core import raise_anomaly
    from app.modules.portal.routes import _employee_portal_block_reason

    engine = ensure_enabled()
    cfg = active_config(db)
    if not consent_admissible(db, employee.id):
        raise HTTPException(409, detail="Consentement biométrique non admissible : enrôlement impossible")
    blocked = _employee_portal_block_reason(employee)
    if blocked:
        raise HTTPException(409, detail=f"Employé non actif : {blocked}")
    if frames is None:
        path = _employee_photo_path(employee)
        if path is None:
            raise HTTPException(422, detail="Aucune photo exploitable dans la fiche — enrôlement par caméra nécessaire")
        photo = path.read_bytes()
        decision = analyze_frames(engine, [photo], cfg, require_liveness=False)
        source, source_ref = "EMPLOYEE_PHOTO", str(path.name)
        extra_quality = {"photo_sha256": hashlib.sha256(photo).hexdigest()}
    else:
        if camera is None:
            raise HTTPException(422, detail="Caméra d'enrôlement obligatoire")
        decision = analyze_frames(engine, frames, cfg, require_liveness=True)
        source, source_ref, extra_quality = "CAMERA", f"camera:{camera.id}", {}
    if decision.state != "OK":
        raise HTTPException(422, detail={"state": decision.state, "reasons": decision.reasons, "quality": decision.quality})
    embedding = decision.face.embedding
    duplicate_of, score = _duplicate_candidates(db, employee.id, embedding, cfg)
    consent = current_consent(db, employee.id)
    template = BiometricTemplate(
        employee_id=employee.id, status=TEMPLATE_PENDING_REVIEW if duplicate_of else TEMPLATE_ACTIVE,
        embedding_encrypted=crypto.encrypt_vector(embedding), engine=engine.engine_id, config_version=cfg.version,
        source=source, source_ref=source_ref, quality={**(decision.quality or {}), **extra_quality},
        consent_id=consent.id if consent else None, created_by=getattr(actor, "username", None),
        duplicate_of_employee_id=duplicate_of, duplicate_score=round(score, 4) if duplicate_of else None,
    )
    if duplicate_of:
        db.add(template)
        db.flush()
        other = db.get(Employee, duplicate_of)
        raise_anomaly(db, anomaly_type="POSSIBLE_DUPLICATE_FACE", severity="critical", employee=employee,
                      source=SOURCE_FACIAL, message="Ce visage semble déjà associé à un autre employé — vérification nécessaire",
                      details={"template_id": template.id, "target_employee_id": employee.id,
                               "candidate_employee_id": duplicate_of, "candidate_matricule": other.code if other else None,
                               "score": round(score, 4), "source": source},
                      dedupe_key=f"DUPLICATE:{template.id}")
    else:
        deactivate_templates(db, employee_id=employee.id, reason="Remplacé par un nouvel enrôlement", actor=actor,
                             statuses=(TEMPLATE_ACTIVE,))
        template.activated_at = datetime.utcnow()
        db.add(template)
        db.flush()
    append_audit(db, action="biometrics.enroll", resource="employee", resource_id=employee.id, result="success",
                 user=actor, society=employee.society,
                 new_state={"template_id": template.id, "status": template.status, "source": source,
                            "config_version": cfg.version, "duplicate_of": duplicate_of})
    return {"template_id": template.id, "status": template.status, "source": source,
            "quality": decision.quality, "duplicate": bool(duplicate_of)}


def review_duplicate(db: Session, *, template: BiometricTemplate, approve: bool, comment: str, actor: Any) -> BiometricTemplate:
    from app.modules.attendance.models import ANOMALY_OPEN, AttendanceAnomaly

    if template.status != TEMPLATE_PENDING_REVIEW:
        raise HTTPException(409, detail="Aucune revue en attente pour ce gabarit")
    if not str(comment or "").strip():
        raise HTTPException(422, detail="Justification obligatoire")
    if approve:
        if not consent_admissible(db, template.employee_id):
            raise HTTPException(409, detail="Consentement non admissible")
        deactivate_templates(db, employee_id=template.employee_id, reason="Remplacé après revue", actor=actor,
                             statuses=(TEMPLATE_ACTIVE,))
        template.status = TEMPLATE_ACTIVE
        template.activated_at = datetime.utcnow()
    else:
        template.status = TEMPLATE_REJECTED
        template.deactivated_at = datetime.utcnow()
    template.status_reason = comment.strip()
    anomaly = db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.dedupe_key == f"DUPLICATE:{template.id}")).scalar_one_or_none()
    if anomaly and anomaly.status == ANOMALY_OPEN:
        anomaly.status = "RESOLVED"
        anomaly.resolution = f"{'Activé' if approve else 'Rejeté'} après revue : {comment.strip()}"
        anomaly.resolved_by = getattr(actor, "username", None)
        anomaly.resolved_at = datetime.utcnow()
    db.flush()
    append_audit(db, action="biometrics.duplicate.review", resource="biometric_template", resource_id=template.id,
                 result="success", user=actor, new_state={"approve": approve, "comment": comment.strip()})
    return template


# ── Reconnaissance et pointage automatique ───────────────────────────────────────────────
def _candidates(db: Session, site_id: int, employee_hint: int | None) -> list[tuple[Employee, BiometricTemplate]]:
    """Périmètre 1:N minimal : gabarits ACTIFS des employés affectés (actifs) au site de la
    caméra. 1:1 si un identifiant préalable (QR/matricule) est fourni."""
    today = attendance_core._now_local().date()
    stmt = select(Assignment.employee_id).where(
        Assignment.site_id == site_id, Assignment.active == 1, Assignment.start_date <= today,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= today))
    employee_ids = set(db.execute(stmt).scalars())
    if employee_hint is not None:
        employee_ids &= {employee_hint}
    if not employee_ids:
        return []
    rows = db.execute(select(BiometricTemplate).where(BiometricTemplate.employee_id.in_(employee_ids),
                                                      BiometricTemplate.status == TEMPLATE_ACTIVE)).scalars().all()
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_({r.employee_id for r in rows}))).scalars()} if rows else {}
    out = []
    for row in rows:
        employee = employees.get(row.employee_id)
        if employee is None:
            continue
        if row.source == "EMPLOYEE_PHOTO" and invalidate_if_photo_changed(db, employee):
            continue
        out.append((employee, row))
    return out


def _person(employee: Employee) -> dict[str, Any]:
    return {"nom": employee.last_name, "prenom": employee.first_name, "matricule": employee.code}


def recognize_and_record(db: Session, *, camera: Camera, frames: list[bytes], actor: Any,
                         burst_id: str | None = None, employee_hint: int | None = None) -> dict[str, Any]:
    """READY → FACE_DETECTED → QUALITY_CHECK → LIVENESS_CHECK → FACE_MATCH → EMPLOYEE_CHECK →
    SITE/AFFECTATION_CHECK → ATTENDANCE_RULE_CHECK → AUTO_VALIDATE → ATTENDANCE_RECORDED.
    Toute condition non satisfaite ⇒ AUCUN pointage."""
    from app.modules.attendance.core import raise_anomaly
    from app.modules.portal.routes import _employee_portal_block_reason

    engine = ensure_enabled()
    if camera.adapter == "TERMINAL":
        raise HTTPException(409, detail="Pointage facial : caméra lue par le serveur obligatoire")
    if not camera.active or camera.usage not in ("ATTENDANCE", "ATTENDANCE_AND_ENROLLMENT"):
        raise HTTPException(409, detail="Caméra non autorisée pour le pointage")
    cfg = active_config(db)
    decision = analyze_frames(engine, frames, cfg, require_liveness=True)
    minute = attendance_core._now_local().strftime("%Y%m%d%H%M")
    base = {"camera_id": camera.id, "site_id": camera.site_id, "config_version": cfg.version}
    if decision.state in ("NO_FACE", "MULTIPLE_FACES", "QUALITY_FAILED"):
        return {**base, "state": decision.state, "recorded": False, "message": decision.reasons[0] if decision.reasons else "", "reasons": decision.reasons}
    if decision.state == "LIVENESS_FAILED":
        raise_anomaly(db, anomaly_type="LIVENESS_FAILED", severity="critical", site_id=camera.site_id,
                      presence_date=attendance_core._now_local().date(), source=SOURCE_FACIAL,
                      message=f"Échec du contrôle de présence réelle — caméra {camera.name}",
                      details={"camera_id": camera.id, "reasons": decision.reasons, "liveness": decision.liveness},
                      dedupe_key=f"LIVENESS:{camera.id}:{minute}")
        db.commit()
        return {**base, "state": "LIVENESS_FAILED", "recorded": False, "message": "Pointage refusé : présence réelle non confirmée"}
    embedding = decision.face.embedding
    scored = sorted(((cosine(embedding, crypto.decrypt_vector(t.embedding_encrypted)), e, t)
                     for e, t in _candidates(db, camera.site_id, employee_hint)), key=lambda x: x[0], reverse=True)
    top_score = scored[0][0] if scored else -1.0
    if not scored or top_score < cfg.recognition_threshold:
        raise_anomaly(db, anomaly_type="UNKNOWN_FACE", severity="warning", site_id=camera.site_id,
                      presence_date=attendance_core._now_local().date(), source=SOURCE_FACIAL,
                      message=f"Visage inconnu — caméra {camera.name}", details={"camera_id": camera.id},
                      dedupe_key=f"UNKNOWN:{camera.id}:{minute}")
        db.commit()
        return {**base, "state": "UNKNOWN_FACE", "recorded": False, "message": "VISAGE INCONNU"}
    second = scored[1][0] if len(scored) > 1 else -1.0
    top_employee, top_template = scored[0][1], scored[0][2]
    if second >= cfg.recognition_threshold and top_score - second < cfg.review_margin:
        raise_anomaly(db, anomaly_type="AMBIGUOUS_MATCH", severity="critical", site_id=camera.site_id,
                      presence_date=attendance_core._now_local().date(), source=SOURCE_FACIAL,
                      message=f"Reconnaissance ambiguë entre deux employés — caméra {camera.name}",
                      details={"camera_id": camera.id, "candidates": [scored[0][1].id, scored[1][1].id],
                               "scores": [round(top_score, 4), round(second, 4)]},
                      dedupe_key=f"AMBIGUOUS:{camera.id}:{minute}")
        db.commit()
        return {**base, "state": "AMBIGUOUS", "recorded": False, "message": "Reconnaissance ambiguë — utilisez le pointage de secours"}
    if top_score < cfg.recognition_threshold + cfg.review_margin:
        return {**base, "state": "REVIEW_REQUIRED", "recorded": False, "message": "Reconnaissance incertaine — nouvel essai",
                "confidence": round(top_score, 4)}
    # Contrôles employé (au moment du pointage, pas seulement à l'enrôlement).
    if not consent_admissible(db, top_employee.id):
        deactivate_templates(db, employee_id=top_employee.id, reason="Consentement non admissible au pointage", actor=actor)
        db.commit()
        return {**base, "state": "REFUSED", "recorded": False, "message": "Pointage facial non autorisé pour cet employé"}
    blocked = _employee_portal_block_reason(top_employee)
    if blocked:
        return {**base, "state": "REFUSED", "recorded": False, "message": f"Pointage refusé : {blocked}", "employee": _person(top_employee)}
    # Non-répétition caméra : le même employé resté devant la caméra ne re-pointe pas.
    recent = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.employee_id == top_employee.id, AttendanceEvent.device_id == camera.id,
        AttendanceEvent.source == SOURCE_FACIAL,
        AttendanceEvent.occurred_at >= attendance_core.to_utc_naive(attendance_core._now_local() - timedelta(seconds=cfg.cooldown_seconds)),
    ).order_by(AttendanceEvent.id.desc()).limit(1)).scalar_one_or_none()
    if recent is not None:
        return {**base, "state": "ALREADY_RECORDED", "recorded": False, "message": "Pointage déjà enregistré",
                "employee": _person(top_employee), "action": "ENTRÉE" if recent.event_type == "ARRIVAL" else "SORTIE",
                "heure": attendance_core.to_local(recent.occurred_at).strftime("%H:%M")}
    try:
        result = attendance_core.record_scan(
            db, employee=top_employee, source=SOURCE_FACIAL, actor=actor,
            idempotency_key=f"cam{camera.id}-{burst_id}" if burst_id else None, device_id=camera.id,
            confidence=round(top_score, 4), quality_result="OK",
            liveness_result=f"REAL:{decision.liveness:.3f}" if decision.liveness is not None else None,
            extra={"camera": camera.name, "config_version": cfg.version},
        )
    except HTTPException as exc:
        db.rollback()
        return {**base, "state": "REFUSED", "recorded": False, "message": str(exc.detail), "employee": _person(top_employee)}
    return {**base, "state": "ALREADY_RECORDED" if result.get("duplicate") else "ATTENDANCE_RECORDED",
            "recorded": not result.get("duplicate"), "message": "POINTAGE ENREGISTRÉ",
            "employee": _person(top_employee), "action": "ENTRÉE" if result["action"] == "arrivee" else "SORTIE",
            "heure": result["heure"][:5], "site": result.get("site"), "confidence": round(top_score, 4)}
