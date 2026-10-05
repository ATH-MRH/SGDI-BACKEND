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
import json
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


def key_configured() -> bool:
    return bool((settings.biometric_template_key or "").strip())


def _engine_with_key() -> FaceEngine:
    # Fail closed explicite : sans clé, aucun gabarit ne peut être lu ni écrit.
    if not key_configured():
        raise HTTPException(503, detail="Biométrie : clé de chiffrement non configurée (BIOMETRIC_TEMPLATE_KEY)")
    try:
        return get_engine()
    except EngineUnavailable as exc:
        raise HTTPException(503, detail=f"Moteur biométrique indisponible : {exc}") from None


def ensure_enabled() -> FaceEngine:
    """Pointage facial de production : BIOMETRIC_ENABLED + clé + moteur."""
    if not settings.biometric_enabled:
        raise HTTPException(503, detail="Biométrie désactivée (BIOMETRIC_ENABLED=false)")
    return _engine_with_key()


def enrollment_enabled() -> bool:
    return bool(settings.biometric_enabled or settings.biometric_enrollment_enabled)


def ensure_enrollment_enabled() -> FaceEngine:
    """Enrôlement supervisé : autorisé par BIOMETRIC_ENROLLMENT_ENABLED SANS activer le
    pointage facial (préparation d'un pilote), ou par BIOMETRIC_ENABLED."""
    if not enrollment_enabled():
        raise HTTPException(503, detail="Enrôlement biométrique désactivé (BIOMETRIC_ENROLLMENT_ENABLED=false)")
    return _engine_with_key()


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


# Réglage de transition (LOT B) : FACIAL_REFERENCE_CONSENT_MODE.
# - "explicit" (défaut) : règle historique, un accord admissible est exigé ;
# - "no_objection" : aucun accord manuel n'est exigé, mais un REFUS ou un RETRAIT enregistré
#   bloque toujours. Aucun consentement n'est jamais créé ni supprimé par ce réglage.
# Portée : préparation de la référence depuis la photo DRH et décision de revue. La
# RECONNAISSANCE (pointage) continue d'exiger consent_admissible — inchangée.
CONSENT_MODE_EXPLICIT = "explicit"
CONSENT_MODE_NO_OBJECTION = "no_objection"


def consent_mode() -> str:
    value = str(settings.facial_reference_consent_mode or "").strip().lower()
    return CONSENT_MODE_NO_OBJECTION if value == CONSENT_MODE_NO_OBJECTION else CONSENT_MODE_EXPLICIT   # inconnu ⇒ strict


def consent_block(db: Session, employee_id: int) -> str | None:
    """None si une référence faciale peut être activée pour cet employé, sinon le code du blocage."""
    consent = current_consent(db, employee_id)
    if consent and consent.status == CONSENT_REFUSED:
        return "CONSENT_REFUSED"
    if consent and consent.status == CONSENT_WITHDRAWN:
        return "CONSENT_WITHDRAWN"
    if consent_mode() == CONSENT_MODE_NO_OBJECTION:
        return None
    return None if consent_admissible(db, employee_id) else "CONSENT_REQUIRED"


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
                         statuses: tuple[str, ...] = (TEMPLATE_ACTIVE, TEMPLATE_PENDING_REVIEW),
                         exclude_id: int | None = None) -> int:
    rows = [row for row in templates_of(db, employee_id, statuses) if row.id != exclude_id]
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


_FINGERPRINTS: dict[str, tuple[int, int, str]] = {}


def photo_fingerprint(employee: Employee) -> str | None:
    """Empreinte SHA-256 de la photo de la fiche, mise en cache par (chemin, mtime, taille) :
    la reconnaissance ne relit ni ne re-hache chaque photo candidate à chaque passage."""
    path = _employee_photo_path(employee)
    if path is None:
        return None
    stat = path.stat()
    cached = _FINGERPRINTS.get(str(path))
    if cached and cached[0] == stat.st_mtime_ns and cached[1] == stat.st_size:
        return cached[2]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    _FINGERPRINTS[str(path)] = (stat.st_mtime_ns, stat.st_size, digest)
    return digest


def photo_change_supervised(db: Session, employee: Employee) -> bool:
    """LOT B — vrai si la synchronisation automatique a pris en charge la photo ACTUELLE de la
    fiche : c'est alors elle qui décide du sort de la référence précédente (conservée tant que
    la nouvelle photo n'a pas produit une référence valide). Faux si le réglage est désactivé
    ou si cette photo n'a jamais été soumise à la synchronisation : règle historique."""
    from app.modules.biometrics import photo_sync

    return photo_sync.supervises(db, employee)


def invalidate_if_photo_changed(db: Session, employee: Employee, actor: Any = None) -> bool:
    """Photo de la fiche remplacée/supprimée ⇒ gabarit issu de l'ancienne photo invalidé."""
    if photo_change_supervised(db, employee):
        return False
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


# ── Enrôlement supervisé : aperçu (analyse + comparaison 1:1) puis confirmation humaine ──
ENROLLMENT_TTL_SECONDS = 300
MATCH_RESULTS = ("MATCH", "REVIEW_REQUIRED", "NO_MATCH", "NO_REFERENCE", "NOT_APPLICABLE")


def _thumbnail(image: bytes) -> str | None:
    """Vignette ≤ 320 px de la capture, pour l'affichage côte à côte de l'opérateur :
    renvoyée une fois, jamais enregistrée."""
    import base64
    import io

    try:
        from PIL import Image

        with Image.open(io.BytesIO(image)) as im:
            im = im.convert("RGB")
            im.thumbnail((320, 320))
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=80)
        return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()
    except Exception:
        return None


def compare_one_to_one(score: float | None, cfg: Any) -> str:
    """Capture ↔ photo DRH. Score cosinus brut, jamais converti en « pourcentage »."""
    if score is None:
        return "NO_REFERENCE"
    if score >= cfg.recognition_threshold + cfg.review_margin:
        return "MATCH"
    if score >= cfg.recognition_threshold:
        return "REVIEW_REQUIRED"
    return "NO_MATCH"


def _employee_site_id(db: Session, employee: Employee) -> int | None:
    today = attendance_core._now_local().date()
    row = db.execute(select(Assignment.site_id).where(
        Assignment.employee_id == employee.id, Assignment.active == 1, Assignment.start_date <= today,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= today)).order_by(Assignment.id.desc()).limit(1)).scalar_one_or_none()
    return row


# Statut RH admissible à l'ENRÔLEMENT (recherche, fiche, aperçu, confirmation) : ACTIF ou
# SUSPENDU — un salarié suspendu reste salarié et peut être enrôlé. Distinct du POINTAGE, qui
# refuse toujours un suspendu ou une mise à pied (_employee_portal_block_reason, inchangé).
# Exclus : sortant, démissionnaire, licencié, archivé, inactif, blacklisté, absences.
ENROLLMENT_ACTIVE_STATUSES = ("actif", "active")
ENROLLMENT_SUSPENDED_STATUSES = ("suspendu", "suspendue", "suspended")
ENROLLMENT_STATUSES = ENROLLMENT_ACTIVE_STATUSES + ENROLLMENT_SUSPENDED_STATUSES


def enrollment_status_block(employee: Employee) -> str:
    status = " ".join(str(getattr(employee, "status", "") or "").strip().lower().split())
    return "" if status in ENROLLMENT_STATUSES else f"statut RH « {employee.status or 'inconnu'} » non admissible à l'enrôlement"


def enrollment_preview(db: Session, *, employee: Employee, actor: Any, frames: list[bytes] | None = None,
                       camera: Camera | None = None) -> dict[str, Any]:
    """Étape 1 — AUCUNE écriture de gabarit. Analyse la photo DRH (référence) et, si une
    caméra est utilisée, la capture (liveness exigé) ; comparaison 1:1 capture ↔ photo ;
    recherche de doublon. Renvoie un jeton chiffré (5 min, lié à l'opérateur) à confirmer."""
    engine = ensure_enrollment_enabled()
    cfg = active_config(db)
    if not consent_admissible(db, employee.id):
        raise HTTPException(409, detail={"code": "CONSENT_REQUIRED", "message": "Consentement biométrique non admissible : enrôlement impossible"})
    blocked = enrollment_status_block(employee)
    if blocked:
        raise HTTPException(409, detail={"code": "EMPLOYEE_INACTIVE", "message": f"Employé non actif : {blocked}"})
    path = _employee_photo_path(employee)
    photo_bytes = path.read_bytes() if path else None
    photo = analyze_frames(engine, [photo_bytes], cfg, require_liveness=False) if photo_bytes else None
    photo_out = {"state": photo.state if photo else "ABSENT", "reasons": photo.reasons if photo else ["Aucune photo dans la fiche"],
                 "quality": photo.quality if photo else None}
    photo_ok = bool(photo and photo.state == "OK")
    if frames is None:
        # Source = photo DRH : exploitable seulement si un seul visage de qualité suffisante.
        if not photo_ok:
            raise HTTPException(422, detail={"code": "PHOTO_UNUSABLE", "photo": photo_out,
                                             "message": "Photo DRH non exploitable — enrôlement par capture supervisée nécessaire"})
        decision, source, source_ref = photo, "EMPLOYEE_PHOTO", str(path.name)
        capture_out, comparison = None, {"score": None, "result": "NOT_APPLICABLE"}
    else:
        if camera is None:
            raise HTTPException(422, detail="Caméra d'enrôlement obligatoire")
        decision = analyze_frames(engine, frames, cfg, require_liveness=True)
        source, source_ref = "CAMERA", f"camera:{camera.id}"
        capture_out = {"state": decision.state, "reasons": decision.reasons, "quality": decision.quality,
                       "liveness": round(decision.liveness, 3) if decision.liveness is not None else None,
                       "thumbnail": _thumbnail(frames[0]) if frames else None}
        if decision.state != "OK":
            return {"employee_id": employee.id, "source": source, "photo": photo_out, "capture": capture_out,
                    "comparison": None, "duplicate": None, "can_confirm": False, "requires_justification": False, "token": None}
        score = cosine(decision.face.embedding, photo.face.embedding) if photo_ok else None
        comparison = {"score": round(score, 4) if score is not None else None, "result": compare_one_to_one(score, cfg)}
    comparison.update({"threshold": cfg.recognition_threshold, "review_margin": cfg.review_margin})
    duplicate_of, dup_score = _duplicate_candidates(db, employee.id, decision.face.embedding, cfg)
    other = db.get(Employee, duplicate_of) if duplicate_of else None
    duplicate = {"suspected": bool(duplicate_of), "score": round(dup_score, 4) if duplicate_of else None,
                 "matricule": other.code if other else None}
    can_confirm = comparison["result"] != "NO_MATCH"
    requires_justification = comparison["result"] in ("REVIEW_REQUIRED", "NO_REFERENCE")
    quality = {**(decision.quality or {})}
    if source == "EMPLOYEE_PHOTO":
        quality["photo_sha256"] = hashlib.sha256(photo_bytes).hexdigest()
    token = crypto.seal({
        "employee_id": employee.id, "actor_id": getattr(actor, "id", None), "embedding": decision.face.embedding,
        "source": source, "source_ref": source_ref, "camera_id": camera.id if camera else None, "quality": quality,
        "comparison": comparison, "config_version": cfg.version, "engine": engine.engine_id,
    }) if can_confirm else None
    append_audit(db, action="biometrics.enrollment.preview", resource="employee", resource_id=employee.id, result="success",
                 user=actor, society=employee.society,
                 new_state={"source": source, "camera_id": camera.id if camera else None, "photo": photo_out["state"],
                            "comparison": comparison["result"], "score": comparison["score"], "duplicate": duplicate["suspected"]})
    return {"employee_id": employee.id, "source": source, "photo": photo_out, "capture": capture_out, "comparison": comparison,
            "duplicate": duplicate, "can_confirm": can_confirm, "requires_justification": requires_justification,
            "token": token, "expires_in": ENROLLMENT_TTL_SECONDS if token else None}


def enrollment_confirm(db: Session, *, employee: Employee, actor: Any, token: str, justification: str | None = None) -> dict[str, Any]:
    """Étape 2 — confirmation EXPLICITE de l'opérateur qui a vu l'aperçu. Recontrôle tout
    (consentement, statut, comparaison) : un NO_MATCH n'est jamais enrôlé ; un résultat
    incertain exige une justification écrite, tracée."""
    ensure_enrollment_enabled()
    data = crypto.unseal(token, ENROLLMENT_TTL_SECONDS)
    if data.get("employee_id") != employee.id or data.get("actor_id") != getattr(actor, "id", None):
        raise HTTPException(409, detail={"code": "ENROLLMENT_MISMATCH", "message": "Aperçu d'un autre employé ou d'un autre opérateur"})
    comparison = data.get("comparison") or {}
    if comparison.get("result") == "NO_MATCH":
        raise HTTPException(409, detail={"code": "NO_MATCH", "message": "La capture ne correspond pas à la photo DRH : enrôlement refusé"})
    note = str(justification or "").strip()
    if comparison.get("result") in ("REVIEW_REQUIRED", "NO_REFERENCE") and len(note) < 10:
        raise HTTPException(422, detail={"code": "JUSTIFICATION_REQUIRED", "message": "Résultat incertain : justification écrite obligatoire (10 caractères minimum)"})
    if not consent_admissible(db, employee.id):
        raise HTTPException(409, detail={"code": "CONSENT_REQUIRED", "message": "Consentement biométrique non admissible : enrôlement impossible"})
    blocked = enrollment_status_block(employee)
    if blocked:
        raise HTTPException(409, detail={"code": "EMPLOYEE_INACTIVE", "message": f"Employé non actif : {blocked}"})
    if data.get("source") == "EMPLOYEE_PHOTO" and (data.get("quality") or {}).get("photo_sha256") != photo_fingerprint(employee):
        raise HTTPException(409, detail={"code": "PHOTO_CHANGED", "message": "La photo de la fiche a changé depuis l'analyse — recommencez"})
    return _store_template(db, employee=employee, actor=actor, embedding=data["embedding"], source=data["source"],
                           source_ref=data["source_ref"], quality=data.get("quality") or {}, engine_id=data["engine"],
                           config_version=data["config_version"], comparison=comparison, justification=note or None)


def _store_template(db: Session, *, employee: Employee, actor: Any, embedding: list[float], source: str, source_ref: str,
                    quality: dict, engine_id: str, config_version: int, comparison: dict, justification: str | None,
                    identity_review: bool = False) -> dict[str, Any]:
    """`identity_review` (LOT B) : le visage ne correspond pas avec certitude à la référence
    active — le gabarit est gardé EN REVUE, la référence active n'est pas touchée."""
    from app.modules.attendance.core import raise_anomaly

    cfg = active_config(db)
    duplicate_of, score = _duplicate_candidates(db, employee.id, embedding, cfg)
    consent = current_consent(db, employee.id)
    template = BiometricTemplate(
        employee_id=employee.id, status=TEMPLATE_PENDING_REVIEW if (duplicate_of or identity_review) else TEMPLATE_ACTIVE,
        embedding_encrypted=crypto.encrypt_vector(embedding), engine=engine_id, config_version=config_version,
        source=source, source_ref=source_ref, quality={**quality, "comparison": comparison.get("result"), "comparison_score": comparison.get("score")},
        consent_id=consent.id if consent else None, created_by=getattr(actor, "username", None),
        society=employee.society, site_id=_employee_site_id(db, employee),
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
    elif identity_review:
        db.add(template)
        db.flush()
        raise_anomaly(db, anomaly_type="FACE_REFERENCE_MISMATCH", severity="critical", employee=employee,
                      source=SOURCE_FACIAL, message="La nouvelle photo ne correspond pas avec certitude à la référence faciale — vérification nécessaire",
                      details={"template_id": template.id, "target_employee_id": employee.id,
                               "comparison": comparison.get("result"), "source": source},
                      dedupe_key=f"DUPLICATE:{template.id}")
    else:
        # La nouvelle référence est activée AVANT que l'ancienne soit désactivée (même
        # transaction : un échec intermédiaire laisse l'ancienne référence active).
        template.activated_at = datetime.utcnow()
        db.add(template)
        db.flush()
        deactivate_templates(db, employee_id=employee.id, reason="Remplacé par un nouvel enrôlement", actor=actor,
                             statuses=(TEMPLATE_ACTIVE,), exclude_id=template.id)
    append_audit(db, action="biometrics.enroll", resource="employee", resource_id=employee.id, result="success",
                 user=actor, society=employee.society,
                 new_state={"template_id": template.id, "status": template.status, "source": source, "config_version": config_version,
                            "duplicate_of": duplicate_of, "comparison": comparison.get("result"), "score": comparison.get("score"),
                            "justification": justification, "confirmed_by": getattr(actor, "username", None)})
    return {"template_id": template.id, "status": template.status, "source": source,
            "quality": {k: v for k, v in (quality or {}).items() if k != "photo_sha256"}, "duplicate": bool(duplicate_of),
            "comparison": comparison.get("result")}


def review_duplicate(db: Session, *, template: BiometricTemplate, approve: bool, comment: str, actor: Any) -> BiometricTemplate:
    from app.modules.attendance.models import ANOMALY_OPEN, AttendanceAnomaly

    if template.status != TEMPLATE_PENDING_REVIEW:
        raise HTTPException(409, detail="Aucune revue en attente pour ce gabarit")
    if not str(comment or "").strip():
        raise HTTPException(422, detail="Justification obligatoire")
    if approve:
        if consent_block(db, template.employee_id):
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
def _society_key(value: Any) -> str:
    import unicodedata

    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    return " ".join(text.upper().split())


def _candidates(db: Session, site_id: int, employee_hint: int | None,
                society: str | None = None) -> list[tuple[Employee, BiometricTemplate]]:
    """Périmètre 1:N minimal : gabarits ACTIFS des employés affectés (actifs) au site de la
    caméra/du terminal — et de la société de ce site si elle est connue (jamais toute la
    base). 1:1 si un identifiant préalable (QR/matricule) est fourni."""
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
    society_key = _society_key(society) if society else ""
    out = []
    for row in rows:
        employee = employees.get(row.employee_id)
        if employee is None:
            continue
        if society_key and _society_key(employee.society) != society_key:
            continue
        # Contrôle sur le gabarit DÉJÀ chargé (aucune requête par candidat) ; invalidation
        # (rare) seulement si la photo de la fiche a réellement changé.
        if row.source == "EMPLOYEE_PHOTO" and (row.quality or {}).get("photo_sha256") != photo_fingerprint(employee) \
                and not photo_change_supervised(db, employee):
            invalidate_if_photo_changed(db, employee)
            continue
        out.append((employee, row))
    return out


def _person(employee: Employee) -> dict[str, Any]:
    return {"nom": employee.last_name, "prenom": employee.first_name, "matricule": employee.code}


@dataclass
class FacialSource:
    """Origine d'un pointage facial de production : caméra lue par le serveur (circuit C) ou
    terminal mobile autorisé (circuit B). Les deux partagent ENTIÈREMENT la suite du pipeline."""
    label: str                        # « caméra X » / « terminal Y » (messages d'anomalie)
    key: str                          # préfixe des clés de déduplication d'anomalie : "12" / "T3"
    site_id: int
    society: str | None
    details: dict                     # {"camera_id": …} / {"terminal_id": …}
    idempotency_key: str | None
    device_id: int | None             # AttendanceEvent.device_id (caméras) ; None pour un terminal
    extra: dict
    society_scoped: bool = False      # 1:N limité aussi à la société (terminaux)


def match_and_record(db: Session, *, source: FacialSource, decision: FrameDecision, cfg: BiometricConfig, actor: Any,
                     employee_hint: int | None = None) -> dict[str, Any]:
    """Après l'analyse des trames : liveness → 1:N du site → non-ambiguïté → contrôles employé
    → non-répétition → Attendance Core. Toute condition non satisfaite ⇒ AUCUN pointage."""
    from app.modules.attendance.core import raise_anomaly
    from app.modules.portal.routes import _employee_portal_block_reason

    minute = attendance_core._now_local().strftime("%Y%m%d%H%M")
    base = {**source.details, "site_id": source.site_id, "config_version": cfg.version,
            "liveness": round(decision.liveness, 3) if decision.liveness is not None else None}
    if decision.state in ("NO_FACE", "MULTIPLE_FACES", "QUALITY_FAILED"):
        return {**base, "state": decision.state, "recorded": False, "message": decision.reasons[0] if decision.reasons else "", "reasons": decision.reasons}
    if decision.state == "LIVENESS_FAILED":
        raise_anomaly(db, anomaly_type="LIVENESS_FAILED", severity="critical", site_id=source.site_id,
                      presence_date=attendance_core._now_local().date(), source=SOURCE_FACIAL,
                      message=f"Échec du contrôle de présence réelle — {source.label}",
                      details={**source.details, "reasons": decision.reasons, "liveness": decision.liveness},
                      dedupe_key=f"LIVENESS:{source.key}:{minute}")
        db.commit()
        return {**base, "state": "LIVENESS_FAILED", "recorded": False, "message": "Pointage refusé : présence réelle non confirmée"}
    embedding = decision.face.embedding
    candidates = _candidates(db, source.site_id, employee_hint, source.society if source.society_scoped else None)
    scored = sorted(((cosine(embedding, crypto.decrypt_vector(t.embedding_encrypted)), e, t) for e, t in candidates),
                    key=lambda x: x[0], reverse=True)
    top_score = scored[0][0] if scored else -1.0
    if not scored or top_score < cfg.recognition_threshold:
        raise_anomaly(db, anomaly_type="UNKNOWN_FACE", severity="warning", site_id=source.site_id,
                      presence_date=attendance_core._now_local().date(), source=SOURCE_FACIAL,
                      message=f"Visage inconnu — {source.label}", details=dict(source.details),
                      dedupe_key=f"UNKNOWN:{source.key}:{minute}")
        db.commit()
        return {**base, "state": "UNKNOWN_FACE", "recorded": False, "message": "VISAGE INCONNU"}
    second = scored[1][0] if len(scored) > 1 else -1.0
    top_employee = scored[0][1]
    if second >= cfg.recognition_threshold and top_score - second < cfg.review_margin:
        raise_anomaly(db, anomaly_type="AMBIGUOUS_MATCH", severity="critical", site_id=source.site_id,
                      presence_date=attendance_core._now_local().date(), source=SOURCE_FACIAL,
                      message=f"Reconnaissance ambiguë entre deux employés — {source.label}",
                      details={**source.details, "candidates": [scored[0][1].id, scored[1][1].id],
                               "scores": [round(top_score, 4), round(second, 4)]},
                      dedupe_key=f"AMBIGUOUS:{source.key}:{minute}")
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
    # Non-répétition : le même employé resté devant la caméra / la tablette ne re-pointe pas.
    # Caméra : fenêtre par caméra ; terminal : fenêtre sur toute source faciale de l'employé.
    since = attendance_core.to_utc_naive(attendance_core._now_local() - timedelta(seconds=cfg.cooldown_seconds))
    stmt = select(AttendanceEvent).where(AttendanceEvent.employee_id == top_employee.id, AttendanceEvent.source == SOURCE_FACIAL,
                                         AttendanceEvent.occurred_at >= since)
    if source.device_id is not None:
        stmt = stmt.where(AttendanceEvent.device_id == source.device_id)
    recent = db.execute(stmt.order_by(AttendanceEvent.id.desc()).limit(1)).scalar_one_or_none()
    if recent is not None:
        return {**base, "state": "ALREADY_RECORDED", "recorded": False, "message": "Pointage déjà enregistré",
                "employee": _person(top_employee), "action": "ENTRÉE" if recent.event_type == "ARRIVAL" else "SORTIE",
                "heure": attendance_core.to_local(recent.occurred_at).strftime("%H:%M")}
    try:
        result = attendance_core.record_scan(
            db, employee=top_employee, source=SOURCE_FACIAL, actor=actor,
            idempotency_key=source.idempotency_key, device_id=source.device_id,
            confidence=round(top_score, 4), quality_result="OK",
            liveness_result=f"REAL:{decision.liveness:.3f}" if decision.liveness is not None else None,
            extra={**source.extra, "config_version": cfg.version},
        )
    except HTTPException as exc:
        db.rollback()
        # Refus décidé par Attendance Core : son code et son motif structuré sont transmis tels
        # quels à l'écran (le facial ne décide ni n'interprète aucune règle de pointage).
        headers = exc.headers or {}
        refusal = None
        if headers.get("X-Attendance-Refusal"):
            try:
                refusal = json.loads(headers["X-Attendance-Refusal"])
            except ValueError:
                refusal = None
        return {**base, "state": "REFUSED", "recorded": False, "message": str(exc.detail), "employee": _person(top_employee),
                **({"code": headers["X-Attendance-Code"], "refusal": refusal} if headers.get("X-Attendance-Code") else {})}
    return {**base, "state": "ALREADY_RECORDED" if result.get("duplicate") else "ATTENDANCE_RECORDED",
            "recorded": not result.get("duplicate"), "message": "POINTAGE ENREGISTRÉ",
            **({"counted": result["counted"]} if result.get("counted") else {}),
            "employee": _person(top_employee), "action": "ENTRÉE" if result["action"] == "arrivee" else "SORTIE",
            "heure": result["heure"][:5], "site": result.get("site"), "confidence": round(top_score, 4)}


def recognize_and_record(db: Session, *, camera: Camera, frames: list[bytes], actor: Any,
                         burst_id: str | None = None, employee_hint: int | None = None) -> dict[str, Any]:
    """Caméra lue par le serveur (circuit C). READY → FACE_DETECTED → QUALITY_CHECK →
    LIVENESS_CHECK → FACE_MATCH → EMPLOYEE_CHECK → SITE/AFFECTATION_CHECK →
    ATTENDANCE_RULE_CHECK → AUTO_VALIDATE → ATTENDANCE_RECORDED. Toute condition non satisfaite
    ⇒ AUCUN pointage."""
    engine = ensure_enabled()
    if camera.adapter == "TERMINAL":
        raise HTTPException(409, detail="Pointage facial : caméra lue par le serveur obligatoire")
    if not camera.active or camera.usage not in ("ATTENDANCE", "ATTENDANCE_AND_ENROLLMENT"):
        raise HTTPException(409, detail="Caméra non autorisée pour le pointage")
    if not camera.facial_attendance_enabled:
        # Pilote : BIOMETRIC_ENABLED ne suffit pas, chaque caméra est activée explicitement.
        raise HTTPException(409, detail="Pointage facial non activé pour cette caméra (activation pilote requise)")
    cfg = active_config(db)
    decision = analyze_frames(engine, frames, cfg, require_liveness=True)
    source = FacialSource(label=f"caméra {camera.name}", key=str(camera.id), site_id=camera.site_id, society=camera.society,
                          details={"camera_id": camera.id}, idempotency_key=f"cam{camera.id}-{burst_id}" if burst_id else None,
                          device_id=camera.id, extra={"camera": camera.name})
    return match_and_record(db, source=source, decision=decision, cfg=cfg, actor=actor, employee_hint=employee_hint)
