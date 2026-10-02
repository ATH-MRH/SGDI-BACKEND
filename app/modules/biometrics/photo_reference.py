"""Référence faciale vue depuis la DRH (Fiche de position → Photo employé) — LOT A.

LECTURE SEULE : ce module ne crée, ne remplace et ne désactive AUCUN gabarit, ne modifie ni
la photo, ni l'employé, ni Attendance Core, ni le consentement, ni la configuration. Il
fournit deux choses à l'opérateur RH, sans aucun détail technique (ni gabarit, ni score) :

- l'ÉTAT de la référence faciale d'un employé, distinct de la présence d'une photo ;
- l'ANALYSE d'une photo candidate (exploitable ou non, et pourquoi), traitée en mémoire.

La génération automatique de la référence à partir de la photo relève du LOT B.
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.biometrics import service, test_mode
from app.modules.biometrics.engine import EngineUnavailable, get_engine
from app.modules.biometrics.models import TEMPLATE_ACTIVE, TEMPLATE_PENDING_REVIEW
from app.modules.drh.models import Employee

# États présentés à l'opérateur RH (jamais « Prête » du seul fait qu'une photo existe).
STATE_READY = "READY"
STATE_PHOTO_TO_UPDATE = "PHOTO_TO_UPDATE"
STATE_REVIEW_REQUIRED = "REVIEW_REQUIRED"
STATE_NONE = "NONE"
STATE_LABELS = {
    STATE_READY: "Prête",
    STATE_PHOTO_TO_UPDATE: "Photo à actualiser",
    STATE_REVIEW_REQUIRED: "Revue requise",
    STATE_NONE: "Aucune référence disponible",
}

ANALYSIS_MESSAGES = {
    "OK": "Photo exploitable pour la reconnaissance faciale.",
    "NO_FACE": "Aucun visage détecté sur cette photo.",
    "MULTIPLE_FACES": "Plusieurs visages détectés : la photo doit montrer une seule personne.",
    "QUALITY_FAILED": "Qualité insuffisante pour la reconnaissance faciale.",
}


def reference_state(db: Session, employee: Employee) -> dict[str, Any]:
    """État de la référence faciale — aucune écriture (contrairement à la fiche biométrique de
    Gestion du pointage, qui invalide un gabarit dont la photo a changé)."""
    photo_available = service._employee_photo_path(employee) is not None
    active = service.templates_of(db, employee.id, (TEMPLATE_ACTIVE,))
    pending = service.templates_of(db, employee.id, (TEMPLATE_PENDING_REVIEW,))
    if active:
        row = active[0]
        stale = row.source == "EMPLOYEE_PHOTO" and (row.quality or {}).get("photo_sha256") != service.photo_fingerprint(employee)
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
