"""Référence faciale vue depuis la DRH (Fiche de position → Photo employé) — LOT A.

LECTURE SEULE : ce module ne crée, ne remplace et ne désactive AUCUN gabarit, ne modifie ni
la photo, ni l'employé, ni Attendance Core, ni le consentement, ni la configuration. Il
fournit deux choses à l'opérateur RH, sans aucun détail technique (ni gabarit, ni score) :

- l'ÉTAT de la référence faciale d'un employé, distinct de la présence d'une photo ;
- l'ANALYSE d'une photo candidate (exploitable ou non, et pourquoi), traitée en mémoire.

La génération automatique de la référence à partir de la photo relève du LOT B
(photo_sync.py) : ce module se contente d'en LIRE l'état pour l'afficher.
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.biometrics import photo_sync, service, test_mode
from app.modules.biometrics.engine import EngineUnavailable, get_engine
from app.modules.biometrics.models import (
    SYNC_BLOCKED,
    SYNC_ENGINE_UNAVAILABLE,
    SYNC_PHOTO_INVALID,
    SYNC_PROCESSING,
    SYNC_REVIEW_REQUIRED,
    TEMPLATE_ACTIVE,
    TEMPLATE_PENDING_REVIEW,
    BiometricTemplate,
)
from app.modules.drh.models import Employee

# États présentés à l'opérateur RH (jamais « Prête » du seul fait qu'une photo existe).
STATE_READY = "READY"
STATE_PHOTO_TO_UPDATE = "PHOTO_TO_UPDATE"
STATE_REVIEW_REQUIRED = "REVIEW_REQUIRED"
STATE_NONE = "NONE"
# LOT B — synchronisation automatique de la photo actuelle.
STATE_PROCESSING = "PROCESSING"
STATE_PREVIOUS_KEPT = "PREVIOUS_KEPT"
STATE_UNAVAILABLE = "UNAVAILABLE"
STATE_BLOCKED = "BLOCKED"
STATE_LABELS = {
    STATE_READY: "Prête",
    STATE_PHOTO_TO_UPDATE: "Photo à actualiser",
    STATE_REVIEW_REQUIRED: "Revue requise",
    STATE_NONE: "Aucune référence disponible",
    STATE_PROCESSING: "Traitement en cours…",
    STATE_PREVIOUS_KEPT: "Nouvelle photo non exploitable",
    STATE_UNAVAILABLE: "Traitement temporairement indisponible",
    STATE_BLOCKED: "Référence faciale non autorisée",
}

ANALYSIS_MESSAGES = {
    "OK": "Photo exploitable pour la reconnaissance faciale.",
    "NO_FACE": "Aucun visage détecté sur cette photo.",
    "MULTIPLE_FACES": "Plusieurs visages détectés : la photo doit montrer une seule personne.",
    "QUALITY_FAILED": "Qualité insuffisante pour la reconnaissance faciale.",
}


REASON_MESSAGES = {
    "PHOTO_CHANGED": "La photo de la fiche a été remplacée pendant le traitement.",
    "FACE_MISMATCH": "Le visage de la nouvelle photo ne correspond pas à la référence faciale du salarié.",
    "FACE_AMBIGUOUS": "La correspondance entre la nouvelle photo et la référence faciale du salarié n'est pas certaine.",
    "POSSIBLE_DUPLICATE": "Ce visage ressemble à celui d'un autre salarié.",
    "CONSENT_REFUSED": "Un refus de la reconnaissance faciale est enregistré pour ce salarié.",
    "CONSENT_WITHDRAWN": "Le salarié a retiré son accord pour la reconnaissance faciale.",
    "CONSENT_REQUIRED": "L'accord du salarié doit être enregistré avant de préparer la référence faciale.",
    "EMPLOYEE_STATUS": "Le statut RH du salarié ne permet pas de préparer une référence faciale.",
}
KEPT = "Référence faciale précédente conservée"


def _sync_state(db: Session, sync: Any, has_active: bool) -> tuple[str, str] | None:
    """Traduction de l'état de synchronisation de la photo actuelle (LOT B) pour l'opérateur RH."""
    code = sync.reason_code or ""
    if sync.status == SYNC_REVIEW_REQUIRED:
        # La décision du responsable habilité fait foi dès qu'elle est prise.
        reviewed = db.get(BiometricTemplate, sync.template_id) if sync.template_id else None
        if reviewed is not None and reviewed.status == TEMPLATE_ACTIVE:
            return None
        if reviewed is None or reviewed.status != TEMPLATE_PENDING_REVIEW:
            declined = "La nouvelle photo n'a pas été retenue lors de la vérification."
            return (STATE_PREVIOUS_KEPT, f"{KEPT}. {declined}") if has_active else (STATE_PHOTO_TO_UPDATE, declined)
    reason = ANALYSIS_MESSAGES.get(code) or REASON_MESSAGES.get(code) or ""
    if code == "QUALITY_FAILED" and sync.reason_detail:
        reason = f"{reason} {sync.reason_detail}."
    if sync.status == SYNC_PROCESSING:
        return STATE_PROCESSING, "La référence faciale est en cours de préparation."
    if sync.status == SYNC_PHOTO_INVALID:
        if has_active:
            return STATE_PREVIOUS_KEPT, f"{KEPT}. {reason}".strip()
        return STATE_PHOTO_TO_UPDATE, reason or "Cette photo ne permet pas de préparer la référence faciale."
    if sync.status == SYNC_REVIEW_REQUIRED:
        tail = f" {KEPT} en attendant la vérification par un responsable habilité." if has_active \
            else " Une vérification par un responsable habilité est en attente."
        return STATE_REVIEW_REQUIRED, (reason + tail).strip()
    if sync.status == SYNC_ENGINE_UNAVAILABLE:
        return STATE_UNAVAILABLE, ("La photo est enregistrée. " + (f"{KEPT}." if has_active
                                   else "La référence faciale sera préparée dès que possible."))
    if sync.status == SYNC_BLOCKED:
        return STATE_BLOCKED, reason or "La référence faciale ne peut pas être préparée pour ce salarié."
    return None                                              # READY : l'état réel des références fait foi


def reference_state(db: Session, employee: Employee) -> dict[str, Any]:
    """État de la référence faciale — aucune écriture (contrairement à la fiche biométrique de
    Gestion du pointage, qui invalide un gabarit dont la photo a changé)."""
    photo_available = service._employee_photo_path(employee) is not None
    active = service.templates_of(db, employee.id, (TEMPLATE_ACTIVE,))
    pending = service.templates_of(db, employee.id, (TEMPLATE_PENDING_REVIEW,))
    sync = photo_sync.current_state(db, employee)            # None si réglage désactivé ou photo non synchronisée
    translated = _sync_state(db, sync, bool(active)) if sync is not None else None
    if translated:
        state, message = translated
    elif active:
        row = active[0]
        stale = sync is None and row.source == "EMPLOYEE_PHOTO" \
            and (row.quality or {}).get("photo_sha256") != service.photo_fingerprint(employee)
        state = STATE_PHOTO_TO_UPDATE if stale else STATE_READY
        message = ("La photo de la fiche a changé depuis la création de la référence faciale."
                   if stale else "Le salarié peut être reconnu par les terminaux de pointage autorisés.")
    elif pending:
        state, message = STATE_REVIEW_REQUIRED, "Une vérification par un responsable habilité est en attente."
    else:
        state = STATE_NONE
        message = ("La photo de la fiche n'a pas encore servi à préparer une référence faciale."
                   if photo_available else "Ajoutez une photo pour permettre la reconnaissance faciale.")
    return {"employee_id": employee.id,
            "photo": {"available": photo_available},
            "reference": {"state": state, "label": STATE_LABELS[state], "message": message},
            "analysis_available": service.enrollment_enabled()}


def analyze_photo(db: Session, photo: Any) -> dict[str, Any]:
    """Analyse d'UNE photo candidate, en mémoire : visage unique, qualité. Renvoie un verdict
    compréhensible — jamais de gabarit, de score ni d'image. Rien n'est enregistré."""
    if not service.enrollment_enabled():
        raise HTTPException(503, detail={"code": "FACIAL_ANALYSIS_DISABLED", "message": "Analyse faciale non activée sur ce serveur"})
    try:
        engine = get_engine()
    except EngineUnavailable:
        raise HTTPException(503, detail={"code": "ENGINE_UNAVAILABLE", "message": "Analyse faciale momentanément indisponible"}) from None
    frames = test_mode.decode_frames([photo] if isinstance(photo, str) else photo)
    if len(frames) != 1:
        raise HTTPException(422, detail={"code": "INVALID_IMAGE", "message": "Une seule photo est attendue"})
    cfg = test_mode.readonly_config(db)                      # ne crée jamais la configuration
    decision = service.analyze_frames(engine, frames, cfg, require_liveness=False)
    state = decision.state if decision.state in ANALYSIS_MESSAGES else "QUALITY_FAILED"
    return {"usable": state == "OK", "state": state, "message": ANALYSIS_MESSAGES[state],
            "reasons": list(decision.reasons or []) if state != "OK" else []}
