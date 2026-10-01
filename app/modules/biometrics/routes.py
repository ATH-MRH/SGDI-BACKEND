"""API /api/biometrics — consentement, enrôlement, doublons, seuils, caméras, reconnaissance.

Permissions : les actions sensibles exigent une permission EXPLICITE (module attendance ×
fonctionnalité biometric_* × action) ou un administrateur global — jamais accordées par défaut
au DRH. Périmètre : employé/caméra hors des sites autorisés du compte ⇒ 404. Aucune réponse ne
contient de gabarit, d'image stockée ni d'identifiant caméra.
"""
from __future__ import annotations

import base64
import binascii
import json
import secrets
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.audit import append_audit
from app.core.config import settings
from app.core.granular_permissions import is_global_administrator, load_feature_permissions
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.biometrics import crypto, service, terminals, test_mode
from app.modules.biometrics.cameras import PROFILES, CameraError, adapter_for
from app.modules.biometrics.engine import EngineUnavailable, get_engine
from app.modules.biometrics.models import (
    CAMERA_ROLES,
    CAMERA_USAGES,
    MOBILE_TERMINAL_TYPES,
    TEMPLATE_PENDING_REVIEW,
    TERMINAL_TYPES,
    BiometricConsent,
    BiometricTerminal,
    BiometricTemplate,
    Camera,
    CameraModel,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from app.modules.ops.routes import _allowed_assignment_site_ids, _ensure_site_allowed, _site_society

router = APIRouter()
# Circuit B : endpoints des terminaux mobiles (authentifiés par la clé de l'appareil, jamais
# par une session utilisateur) — app/modules/biometrics/terminals.py.
router.include_router(terminals.router)
MAX_FRAMES = 6
MAX_FRAME_BYTES = 3_000_000


# ── Permissions et périmètre ─────────────────────────────────────────────────────────────
def require_feature(db: Session, user: User, feature: str, action: str) -> None:
    if is_global_administrator(user):
        return
    granted = any(g.module_key == "attendance" and g.feature_key == feature and g.action_key == action
                  for g in load_feature_permissions(db, user.id))
    if not granted:
        append_audit(db, action="authorization.biometric", resource="api", resource_id=f"{feature}:{action}",
                     result="refused", user=user)
        db.commit()
        raise HTTPException(403, detail="Permission biométrique explicite requise")


def _employee_in_scope(db: Session, user: User, employee_id: int) -> Employee:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(404, detail="Employé introuvable")
    allowed = _allowed_assignment_site_ids(db, user)
    if allowed is not None:
        visible = db.execute(select(Assignment.id).where(Assignment.employee_id == employee_id,
                                                         Assignment.site_id.in_(allowed or [-1]))).first()
        if not visible:
            raise HTTPException(404, detail="Employé introuvable")
    return employee


def _camera_in_scope(db: Session, user: User, camera_id: int) -> Camera:
    camera = db.get(Camera, camera_id)
    allowed = _allowed_assignment_site_ids(db, user)
    if not camera or (allowed is not None and camera.site_id not in set(allowed)):
        raise HTTPException(404, detail="Caméra introuvable")
    return camera


def _decode_frames(frames: list[str]) -> list[bytes]:
    if len(frames) > MAX_FRAMES:
        raise HTTPException(422, detail=f"{MAX_FRAMES} images maximum")
    out = []
    for value in frames:
        data = value.split(",", 1)[1] if value.startswith("data:") else value
        try:
            raw = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(422, detail="Image invalide") from None
        if len(raw) > MAX_FRAME_BYTES:
            raise HTTPException(413, detail="Image trop volumineuse")
        out.append(raw)
    return out


# ── État et information ──────────────────────────────────────────────────────────────────
@router.get("/status")
def status(user: User = Depends(current_user)) -> dict[str, Any]:
    available, detail = False, ""
    if settings.biometric_enabled:
        try:
            engine = get_engine()
            available, detail = True, engine.engine_id
        except EngineUnavailable as exc:
            detail = str(exc)
    return {"enabled": settings.biometric_enabled, "engine_available": available, "engine": detail,
            "key_configured": bool((settings.biometric_template_key or "").strip()), "notice_version": service.NOTICE_VERSION,
            "enrollment_enabled": service.enrollment_enabled()}


@router.get("/notice")
def notice(user: User = Depends(current_user)) -> dict[str, str]:
    return {"version": service.NOTICE_VERSION, "text": service.NOTICE_TEXT}


# ── Employé : consentement, enrôlement, état ─────────────────────────────────────────────
def _consent_out(row: BiometricConsent | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {"id": row.id, "status": row.status, "source": row.source,
            "consent_date": row.consent_date.isoformat() if row.consent_date else None,
            "proof_reference": row.proof_reference, "notice_version": row.notice_version,
            "recorded_by": row.recorded_by, "recorded_at": row.created_at.isoformat() if row.created_at else None,
            "admissible": row.status in ("contract_confirmed", "explicit_confirmed") and row.notice_version == service.NOTICE_VERSION}


def _template_out(row: BiometricTemplate) -> dict[str, Any]:
    return {"id": row.id, "status": row.status, "source": row.source, "config_version": row.config_version,
            "engine": row.engine, "quality": {k: v for k, v in (row.quality or {}).items() if k != "photo_sha256"},
            "created_by": row.created_by, "created_at": row.created_at.isoformat() if row.created_at else None,
            "activated_at": row.activated_at.isoformat() if row.activated_at else None,
            "deactivated_at": row.deactivated_at.isoformat() if row.deactivated_at else None,
            "status_reason": row.status_reason, "duplicate_of_employee_id": row.duplicate_of_employee_id,
            "duplicate_score": row.duplicate_score}


def _photo_url(employee: Employee) -> str | None:
    """URL de la photo DRH (fiche) pour l'affichage côte à côte ; jamais copiée ici."""
    from app.core.photo_storage import PUBLIC_PHOTO_PREFIX

    path = service._employee_photo_path(employee)
    return f"{PUBLIC_PHOTO_PREFIX}/{path.name}" if path else None


# Recherche des employés à enrôler — bornée, filtrée et TOUJOURS limitée au périmètre côté serveur.
SEARCH_LIMIT = 25
SEARCH_FILTERS: dict[str, frozenset[str]] = {
    "status": frozenset({"actif", "suspendu"}),
    "consent": frozenset({"admissible", "non_admissible"}),
    "enrollment": frozenset({"none", "active", "review", "inactive"}),
    "photo": frozenset({"available", "missing"}),
}


def _search_filter(name: str, value: str | None) -> str | None:
    value = (value or "").strip().lower() or None
    if value is not None and value not in SEARCH_FILTERS[name]:
        raise HTTPException(422, detail=f"Filtre {name} invalide")
    return value


def _scoped_assignments(db: Session, user: User, site_id: int | None):
    """Affectations ACTIVES dans le périmètre du compte. Même définition que la DRH
    (sql_bridge._live_assignment_map) : active et non terminée — une affectation dont la date
    de début est à venir compte (l'employé figure déjà sur ce site dans la DRH)."""
    from sqlalchemy import or_

    today = attendance_core_now().date()
    allowed = _allowed_assignment_site_ids(db, user)
    stmt = select(Assignment.employee_id, Assignment.site_id).where(
        Assignment.active == 1, or_(Assignment.end_date.is_(None), Assignment.end_date >= today))
    if site_id is not None:
        if allowed is not None and site_id not in set(allowed):
            raise HTTPException(404, detail="Site introuvable")
        stmt = stmt.where(Assignment.site_id == site_id)
    elif allowed is not None:
        stmt = stmt.where(Assignment.site_id.in_(allowed or [-1]))
    return stmt


@router.get("/employees")
def search_employees(q: str = "", site_id: int | None = None, function: str | None = None, status: str | None = None,
                     consent: str | None = None, enrollment: str | None = None, photo: str | None = None,
                     db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    """Recherche d'employés à enrôler (matricule — fiche ou matricule DRH historique —, nom,
    prénom), limitée aux sites du compte. Filtres optionnels combinables, appliqués en SQL après
    le périmètre ; correspondance EXACTE du matricule classée en premier (jamais écartée par la
    limite de 25)."""
    from sqlalchemy import case, exists, func, not_, or_

    require_feature(db, user, "biometric_status", "read")
    status, consent = _search_filter("status", status), _search_filter("consent", consent)
    enrollment, photo = _search_filter("enrollment", enrollment), _search_filter("photo", photo)
    function = (function or "").strip()[:120] or None
    scope = _scoped_assignments(db, user, site_id).subquery()
    # Population admissible : statut RH ACTIF ou SUSPENDU (service.ENROLLMENT_STATUSES) —
    # jamais les sortants, licenciés, démissionnaires, archivés, inactifs.
    status_key = func.lower(func.trim(func.coalesce(Employee.status, "")))
    query = select(Employee).where(Employee.id.in_(select(scope.c.employee_id)), status_key.in_(service.ENROLLMENT_STATUSES))
    term = q.strip()[:80]
    extra_matricule = Employee.extra["matricule"].as_string()
    order = [Employee.last_name, Employee.first_name, Employee.id]
    if term:
        like, upper = f"%{term}%", term.upper()
        query = query.where(or_(Employee.code.ilike(like), Employee.last_name.ilike(like), Employee.first_name.ilike(like),
                                extra_matricule.ilike(like)))
        rank = case((func.upper(Employee.code) == upper, 0), (func.upper(extra_matricule) == upper, 0),
                    (func.upper(Employee.code).like(f"{upper}%"), 1), (func.upper(extra_matricule).like(f"{upper}%"), 1), else_=2)
        order = [rank, *order]
    if function:
        query = query.where(Employee.position == function)
    if status:
        query = query.where(status_key.in_(service.ENROLLMENT_ACTIVE_STATUSES if status == "actif" else service.ENROLLMENT_SUSPENDED_STATUSES))
    if consent:
        latest = select(BiometricConsent.employee_id, func.max(BiometricConsent.id).label("cid")) \
            .group_by(BiometricConsent.employee_id).subquery()
        admissible_ids = select(latest.c.employee_id).join(BiometricConsent, BiometricConsent.id == latest.c.cid).where(
            BiometricConsent.status.in_(("contract_confirmed", "explicit_confirmed")),
            BiometricConsent.notice_version == service.NOTICE_VERSION)
        query = query.where(Employee.id.in_(admissible_ids) if consent == "admissible" else Employee.id.not_in(admissible_ids))
    if enrollment:
        def has(*states):
            return exists().where(BiometricTemplate.employee_id == Employee.id, BiometricTemplate.status.in_(states))
        enrolled = has("ACTIVE", TEMPLATE_PENDING_REVIEW)
        query = query.where({"active": has("ACTIVE"), "review": has(TEMPLATE_PENDING_REVIEW) & not_(has("ACTIVE")),
                             "none": not_(enrolled), "inactive": not_(enrolled) & has("INACTIVE", "REJECTED")}[enrollment])
    query = query.order_by(*order)
    if photo:
        # Présence RÉELLE du fichier (comme l'affichage) : parcours borné, arrêt à 25.
        employees = []
        for e in db.execute(query.execution_options(yield_per=200)).scalars():
            if (service._employee_photo_path(e) is not None) == (photo == "available"):
                employees.append(e)
                if len(employees) >= SEARCH_LIMIT:
                    break
    else:
        employees = db.execute(query.limit(SEARCH_LIMIT)).scalars().all()
    if not employees:
        return []
    ids = [e.id for e in employees]
    site_of = {emp: site for emp, site in db.execute(select(scope.c.employee_id, scope.c.site_id)
                                                     .where(scope.c.employee_id.in_(ids))).all()}
    sites = {s.id: s.name for s in db.execute(select(Site).where(Site.id.in_(set(site_of.values())))).scalars()}
    templates = db.execute(select(BiometricTemplate.employee_id, BiometricTemplate.status).where(BiometricTemplate.employee_id.in_(ids))).all()
    out = []
    for e in employees:
        statuses = {st for emp, st in templates if emp == e.id}
        out.append({"employee_id": e.id, "matricule": e.code, "nom": e.last_name, "prenom": e.first_name, "fonction": e.position,
                    "site_id": site_of.get(e.id), "site": sites.get(site_of.get(e.id)), "statut": e.status,
                    "consent_admissible": service.consent_admissible(db, e.id),
                    "enrollment": "ACTIVE" if "ACTIVE" in statuses else ("PENDING_REVIEW" if TEMPLATE_PENDING_REVIEW in statuses else "NONE"),
                    "photo_available": service._employee_photo_path(e) is not None})
    return out


@router.get("/employees/facets")
def search_facets(site_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Valeurs proposées par les filtres : sites et fonctions PRÉSENTS dans le périmètre."""
    require_feature(db, user, "biometric_status", "read")
    scope = _scoped_assignments(db, user, site_id).subquery()
    site_rows = db.execute(select(Site.id, Site.name).where(Site.id.in_(select(scope.c.site_id))).order_by(Site.name)).all()
    functions = db.execute(select(Employee.position).where(Employee.id.in_(select(scope.c.employee_id)), Employee.position.is_not(None),
                                                           Employee.position != "").distinct().order_by(Employee.position).limit(200)).scalars().all()
    return {"sites": [{"id": i, "name": n} for i, n in site_rows], "functions": list(functions),
            "statuses": ["actif", "suspendu"], "consent": sorted(SEARCH_FILTERS["consent"]),
            "enrollment": ["none", "active", "review", "inactive"], "photo": ["available", "missing"]}


def attendance_core_now():
    from app.modules.attendance.core import _now_local

    return _now_local()


@router.get("/employees/{employee_id}")
def employee_status(employee_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_status", "read")
    employee = _employee_in_scope(db, user, employee_id)
    service.invalidate_if_photo_changed(db, employee, user)
    db.commit()
    templates = db.execute(select(BiometricTemplate).where(BiometricTemplate.employee_id == employee_id)
                           .order_by(BiometricTemplate.id.desc())).scalars().all()
    consents = db.execute(select(BiometricConsent).where(BiometricConsent.employee_id == employee_id)
                          .order_by(BiometricConsent.id.desc())).scalars().all()
    active = next((t for t in templates if t.status == "ACTIVE"), None)
    return {
        "employee_id": employee_id, "enabled": settings.biometric_enabled, "enrollment_enabled": service.enrollment_enabled(),
        "identity": {"matricule": employee.code, "nom": employee.last_name, "prenom": employee.first_name,
                     "fonction": employee.position, "societe": employee.society},
        "photo_url": _photo_url(employee),
        "consent": _consent_out(consents[0] if consents else None),
        "consent_history": [_consent_out(c) for c in consents],
        "photo_available": service._employee_photo_path(employee) is not None,
        "enrollment": "ACTIVE" if active else ("PENDING_REVIEW" if any(t.status == TEMPLATE_PENDING_REVIEW for t in templates) else "NONE"),
        "active_template": _template_out(active) if active else None,
        "templates": [_template_out(t) for t in templates],
    }


class ConsentIn(BaseModel):
    status: str
    source: str
    consent_date: datetime | None = None
    proof_reference: str | None = Field(None, max_length=200)
    notice_version: str
    comment: str | None = Field(None, max_length=1000)


@router.post("/employees/{employee_id}/consent")
def set_consent(employee_id: int, payload: ConsentIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_enrollment", "create")
    employee = _employee_in_scope(db, user, employee_id)
    row = service.record_consent(db, employee=employee, status=payload.status, source=payload.source,
                                 consent_date=payload.consent_date, proof_reference=payload.proof_reference,
                                 notice_version=payload.notice_version, actor=user, comment=payload.comment)
    db.commit()
    return _consent_out(row)


class EnrollIn(BaseModel):
    camera_id: int | None = None
    frames: list[str] | None = None


@router.post("/employees/{employee_id}/enroll")
def enroll(employee_id: int, payload: EnrollIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Remplacé par l'enrôlement SUPERVISÉ en deux étapes (aperçu + confirmation humaine) :
    un gabarit n'est plus jamais activé sans comparaison ni confirmation explicite."""
    require_feature(db, user, "biometric_enrollment", "create")
    _employee_in_scope(db, user, employee_id)
    raise HTTPException(410, detail={"code": "SUPERVISED_ENROLLMENT_REQUIRED",
                                     "message": "Enrôlement supervisé : /enrollment/preview puis /enrollment/confirm"})


def _enrollment_frames(db: Session, user: User, payload: EnrollIn) -> tuple[Camera | None, list[bytes] | None]:
    if payload.camera_id is None:
        if payload.frames:
            raise HTTPException(422, detail="Images refusées sans caméra d'enrôlement déclarée")
        return None, None
    camera = _camera_in_scope(db, user, payload.camera_id)
    if camera.usage not in ("ENROLLMENT", "ATTENDANCE_AND_ENROLLMENT") or not camera.active:
        raise HTTPException(409, detail="Caméra non autorisée pour l'enrôlement")
    return camera, _frames_for(camera, payload.frames)


@router.post("/employees/{employee_id}/enrollment/preview")
def enrollment_preview(employee_id: int, payload: EnrollIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Étape 1 : analyse photo DRH / capture, comparaison 1:1, doublons — AUCUN gabarit créé."""
    require_feature(db, user, "biometric_enrollment", "create")
    employee = _employee_in_scope(db, user, employee_id)
    camera, frames = _enrollment_frames(db, user, payload)
    result = service.enrollment_preview(db, employee=employee, actor=user, frames=frames, camera=camera)
    db.commit()
    return result


class EnrollConfirmIn(BaseModel):
    token: str = Field(min_length=20, max_length=20000)
    confirm: bool
    justification: str | None = Field(None, max_length=500)


@router.post("/employees/{employee_id}/enrollment/confirm")
def enrollment_confirm(employee_id: int, payload: EnrollConfirmIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Étape 2 : confirmation explicite par l'opérateur habilité qui a vu l'aperçu."""
    require_feature(db, user, "biometric_enrollment", "create")
    employee = _employee_in_scope(db, user, employee_id)
    if payload.confirm is not True:
        raise HTTPException(422, detail="Confirmation explicite requise")
    result = service.enrollment_confirm(db, employee=employee, actor=user, token=payload.token, justification=payload.justification)
    db.commit()
    return result


class DeactivateIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/employees/{employee_id}/deactivate")
def deactivate(employee_id: int, payload: DeactivateIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, int]:
    require_feature(db, user, "biometric_enrollment", "update")
    employee = _employee_in_scope(db, user, employee_id)
    count = service.deactivate_templates(db, employee_id=employee.id, reason=payload.reason.strip(), actor=user)
    db.commit()
    return {"deactivated": count}


# ── Doublons ─────────────────────────────────────────────────────────────────────────────
@router.get("/duplicates")
def duplicates(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    require_feature(db, user, "biometric_admin", "validate")
    rows = db.execute(select(BiometricTemplate).where(BiometricTemplate.status == TEMPLATE_PENDING_REVIEW)
                      .order_by(BiometricTemplate.id)).scalars().all()
    allowed = _allowed_assignment_site_ids(db, user)
    out = []
    for row in rows:
        if allowed is not None:
            try:
                _employee_in_scope(db, user, row.employee_id)
            except HTTPException:
                continue
        target, other = db.get(Employee, row.employee_id), db.get(Employee, row.duplicate_of_employee_id or 0)
        out.append({"template_id": row.id, "score": row.duplicate_score, "source": row.source,
                    "date": row.created_at.isoformat() if row.created_at else None, "created_by": row.created_by,
                    "target": {"id": target.id, "matricule": target.code, "nom": f"{target.last_name} {target.first_name}"} if target else None,
                    "candidate": {"id": other.id, "matricule": other.code, "nom": f"{other.last_name} {other.first_name}"} if other else None})
    return out


class ReviewIn(BaseModel):
    approve: bool
    comment: str = Field(min_length=3, max_length=1000)


@router.patch("/templates/{template_id}/review")
def review(template_id: int, payload: ReviewIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_admin", "validate")
    template = db.get(BiometricTemplate, template_id)
    if not template:
        raise HTTPException(404, detail="Gabarit introuvable")
    _employee_in_scope(db, user, template.employee_id)
    service.review_duplicate(db, template=template, approve=payload.approve, comment=payload.comment, actor=user)
    db.commit()
    return _template_out(template)


# ── Seuils versionnés ────────────────────────────────────────────────────────────────────
def _config_out(row) -> dict[str, Any]:
    return {"version": row.version, **{f: getattr(row, f) for f in service.CONFIG_FIELDS},
            "provenance": row.provenance, "created_by": row.created_by, "created_at": row.created_at.isoformat() if row.created_at else None}


@router.get("/config")
def get_config(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_admin", "admin")
    row = service.active_config(db)
    db.commit()
    return _config_out(row)


class ConfigIn(BaseModel):
    provenance: str = Field(min_length=10, max_length=4000)
    recognition_threshold: float | None = None
    review_margin: float | None = None
    duplicate_threshold: float | None = None
    liveness_threshold: float | None = None
    quality_min_detection_score: float | None = None
    quality_min_face_px: int | None = None
    quality_min_sharpness: float | None = None
    cooldown_seconds: int | None = None


@router.post("/config")
def set_config(payload: ConfigIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_admin", "admin")
    values = payload.model_dump(exclude={"provenance"}, exclude_none=True)
    row = service.new_config_version(db, values=values, provenance=payload.provenance, actor=user)
    db.commit()
    return _config_out(row)


# ── Caméras ──────────────────────────────────────────────────────────────────────────────
def _camera_out(cam: Camera, site: Site | None = None) -> dict[str, Any]:
    return {"id": cam.id, "name": cam.name, "manufacturer": cam.manufacturer, "model": cam.model, "adapter": cam.adapter,
            "camera_model_id": cam.camera_model_id, "society": cam.society, "site_id": cam.site_id,
            "site": site.name if site else None, "location": cam.location, "serial_number": cam.serial_number,
            "host": cam.host, "http_port": cam.http_port, "rtsp_port": cam.rtsp_port, "connection_type": cam.connection_type,
            "channel": cam.channel, "resolution": cam.resolution, "fps": cam.fps, "profiles": cam.profiles or {},
            "capabilities": cam.capabilities or {}, "usage": cam.usage, "role": cam.role, "is_default": cam.is_default,
            "active": cam.active, "facial_attendance_enabled": bool(cam.facial_attendance_enabled),
            "credentials_set": bool(cam.credentials_encrypted), "last_check": cam.last_check}


@router.get("/camera-models")
def camera_models(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    rows = db.execute(select(CameraModel).where(CameraModel.active.is_(True)).order_by(CameraModel.manufacturer, CameraModel.model)).scalars()
    return [{"id": r.id, "manufacturer": r.manufacturer, "model": r.model, "adapter": r.adapter,
             "resolution": r.resolution, "capabilities": r.capabilities or {}} for r in rows]


class CameraModelIn(BaseModel):
    manufacturer: str = Field(min_length=2, max_length=80)
    model: str = Field(min_length=1, max_length=120)
    adapter: str
    resolution: str | None = Field(None, max_length=40)
    capabilities: dict | None = None


@router.post("/camera-models")
def add_camera_model(payload: CameraModelIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_admin", "admin")
    if payload.adapter not in ("DAHUA", "GENERIC_RTSP", "TERMINAL"):
        raise HTTPException(422, detail="Adaptateur inconnu")
    row = CameraModel(manufacturer=payload.manufacturer.strip().upper(), model=payload.model.strip(), adapter=payload.adapter,
                      resolution=payload.resolution, capabilities=payload.capabilities or {}, active=True)
    db.add(row)
    db.flush()
    append_audit(db, action="biometrics.camera_model.create", resource="camera_model", resource_id=row.id, result="success",
                 user=user, new_state={"manufacturer": row.manufacturer, "model": row.model, "adapter": row.adapter})
    db.commit()
    return {"id": row.id, "manufacturer": row.manufacturer, "model": row.model, "adapter": row.adapter, "resolution": row.resolution}


@router.get("/cameras")
def cameras(site_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    allowed = _allowed_assignment_site_ids(db, user)
    stmt = select(Camera)
    if site_id is not None:
        _ensure_site_allowed(db, user, site_id)
        stmt = stmt.where(Camera.site_id == site_id)
    elif allowed is not None:
        stmt = stmt.where(Camera.site_id.in_(allowed or [-1]))
    rows = db.execute(stmt.order_by(Camera.site_id, Camera.name)).scalars().all()
    sites = {s.id: s for s in db.execute(select(Site).where(Site.id.in_({r.site_id for r in rows}))).scalars()} if rows else {}
    return [_camera_out(r, sites.get(r.site_id)) for r in rows]


class CameraIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    camera_model_id: int
    site_id: int
    location: str | None = Field(None, max_length=120)
    serial_number: str | None = Field(None, max_length=80)
    host: str = Field(min_length=1, max_length=255)
    http_port: int | None = Field(None, ge=1, le=65535)
    rtsp_port: int | None = Field(None, ge=1, le=65535)
    connection_type: str = "LAN"
    channel: int = Field(1, ge=1, le=64)
    resolution: str | None = None
    fps: int | None = Field(None, ge=1, le=60)
    profiles: dict | None = None
    usage: str = "ATTENDANCE"
    role: str = "ENTRY"
    is_default: bool = False
    active: bool = True
    facial_attendance_enabled: bool = False
    username: str | None = Field(None, max_length=120)
    password: str | None = Field(None, max_length=200)


class CameraPatch(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=80)
    location: str | None = None
    host: str | None = None
    http_port: int | None = Field(None, ge=1, le=65535)
    rtsp_port: int | None = Field(None, ge=1, le=65535)
    channel: int | None = Field(None, ge=1, le=64)
    resolution: str | None = None
    fps: int | None = Field(None, ge=1, le=60)
    profiles: dict | None = None
    usage: str | None = None
    role: str | None = None
    is_default: bool | None = None
    active: bool | None = None
    facial_attendance_enabled: bool | None = None
    username: str | None = Field(None, max_length=120)
    password: str | None = Field(None, max_length=200)


def _validate_usage_role(usage: str | None, role: str | None, adapter: str | None = None) -> None:
    if usage is not None and usage not in CAMERA_USAGES:
        raise HTTPException(422, detail="Usage de caméra invalide")
    # Images fournies par un navigateur = entrée non fiable (injection numérique d'une photo
    # possible, que le liveness passif ne couvre pas) : jamais pour le pointage.
    if adapter == "TERMINAL" and usage is not None and usage != "ENROLLMENT":
        raise HTTPException(422, detail="Caméra du terminal : enrôlement supervisé uniquement — le pointage exige une caméra lue par le serveur")
    if role is not None and role not in CAMERA_ROLES:
        raise HTTPException(422, detail="Rôle de caméra invalide")


def _check_facial_activation(enabled: bool | None, usage: str | None, adapter: str | None) -> None:
    """Seule une caméra lue par le serveur et dédiée au pointage peut être activée."""
    if enabled and (adapter == "TERMINAL" or usage not in ("ATTENDANCE", "ATTENDANCE_AND_ENROLLMENT")):
        raise HTTPException(422, detail="Pointage facial activable uniquement sur une caméra de pointage lue par le serveur")


def _single_default(db: Session, camera: Camera) -> None:
    if camera.is_default:
        for other in db.execute(select(Camera).where(Camera.site_id == camera.site_id, Camera.role == camera.role,
                                                     Camera.id != camera.id, Camera.is_default.is_(True))).scalars():
            other.is_default = False


@router.post("/cameras")
def add_camera(payload: CameraIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_admin", "admin")
    site = _ensure_site_allowed(db, user, payload.site_id)
    model = db.get(CameraModel, payload.camera_model_id)
    if not model or not model.active:
        raise HTTPException(422, detail="Modèle de caméra inconnu — l'ajouter d'abord au catalogue")
    _validate_usage_role(payload.usage, payload.role, model.adapter)
    _check_facial_activation(payload.facial_attendance_enabled, payload.usage, model.adapter)
    society = _site_society(site) or ""
    if not society:
        raise HTTPException(422, detail="Le site n'a pas de société : une caméra appartient à une société ET un site")
    camera = Camera(name=payload.name.strip(), camera_model_id=model.id, manufacturer=model.manufacturer, model=model.model,
                    adapter=model.adapter, society=society, site_id=site.id, location=payload.location,
                    serial_number=payload.serial_number, host=payload.host.strip(), http_port=payload.http_port,
                    rtsp_port=payload.rtsp_port, connection_type=payload.connection_type, channel=payload.channel,
                    resolution=payload.resolution or model.resolution, fps=payload.fps, profiles=payload.profiles or {},
                    capabilities=model.capabilities or {}, usage=payload.usage, role=payload.role,
                    is_default=payload.is_default, active=payload.active,
                    facial_attendance_enabled=payload.facial_attendance_enabled)
    if payload.username or payload.password:
        camera.credentials_encrypted = crypto.encrypt_secret({"username": payload.username or "", "password": payload.password or ""})
    db.add(camera)
    db.flush()
    _single_default(db, camera)
    append_audit(db, action="biometrics.camera.create", resource="camera", resource_id=camera.id, result="success",
                 user=user, society=society, new_state={k: v for k, v in _camera_out(camera, site).items() if k != "last_check"})
    db.commit()
    return _camera_out(camera, site)


@router.patch("/cameras/{camera_id}")
def update_camera(camera_id: int, payload: CameraPatch, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_admin", "admin")
    camera = _camera_in_scope(db, user, camera_id)
    changes = payload.model_dump(exclude_unset=True)
    _validate_usage_role(changes.get("usage"), changes.get("role"), camera.adapter)
    _check_facial_activation(changes.get("facial_attendance_enabled", camera.facial_attendance_enabled),
                             changes.get("usage", camera.usage), camera.adapter)
    secret_changed = "username" in changes or "password" in changes
    if secret_changed:
        current = crypto.decrypt_secret(camera.credentials_encrypted)
        current.update({k: changes.pop(k) or "" for k in ("username", "password") if k in changes})
        camera.credentials_encrypted = crypto.encrypt_secret(current)
    for key, value in changes.items():
        setattr(camera, key, value)
    _single_default(db, camera)
    append_audit(db, action="biometrics.camera.update", resource="camera", resource_id=camera.id, result="success",
                 user=user, society=camera.society, new_state={**changes, "credentials_changed": secret_changed})
    db.commit()
    return _camera_out(camera, db.get(Site, camera.site_id))


@router.post("/cameras/{camera_id}/test")
def test_camera(camera_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_admin", "admin")
    camera = _camera_in_scope(db, user, camera_id)
    result = adapter_for(camera).test()
    camera.last_check = result
    append_audit(db, action="biometrics.camera.test", resource="camera", resource_id=camera.id, result="success",
                 user=user, society=camera.society,
                 new_state={k: bool((result.get(k) or {}).get("ok")) for k in ("connection", "snapshot", "stream")})
    db.commit()
    return result


@router.get("/cameras/{camera_id}/preview.jpg")
def preview(camera_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    """Aperçu basse résolution relayé par le backend : le navigateur ne voit jamais la caméra."""
    camera = _camera_in_scope(db, user, camera_id)
    if camera.adapter == "TERMINAL":
        raise HTTPException(409, detail="Caméra du terminal : aperçu local")
    if not camera.active:
        raise HTTPException(409, detail="Caméra désactivée")
    try:
        data = adapter_for(camera).snapshot("PREVIEW_LOW_BANDWIDTH")
    except CameraError as exc:
        raise HTTPException(502, detail=str(exc)) from None
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


def _frames_for(camera: Camera, frames: list[str] | None) -> list[bytes]:
    """Images fournies par le client : UNIQUEMENT pour une caméra de terminal (enrôlement
    supervisé). Une caméra lue par le serveur est toujours capturée par le serveur."""
    if camera.adapter == "TERMINAL":
        if not frames:
            raise HTTPException(422, detail="Images du terminal attendues")
        return _decode_frames(frames)
    if frames:
        raise HTTPException(422, detail="Images client refusées : cette caméra est lue par le serveur")
    try:
        return adapter_for(camera).burst(3)
    except CameraError as exc:
        raise HTTPException(502, detail=str(exc)) from None


class RecognizeIn(BaseModel):
    burst_id: str | None = Field(None, max_length=80)
    employee_id: int | None = None   # 1:1 si un identifiant préalable (QR/matricule) est connu


@router.post("/cameras/{camera_id}/recognize")
def recognize(camera_id: int, payload: RecognizeIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Pointage facial automatique (terminal) : aucune sélection d'employé, aucune validation
    manuelle dans le parcours normal. Toute condition non remplie ⇒ aucun pointage."""
    camera = _camera_in_scope(db, user, camera_id)
    service.ensure_enabled()
    if camera.adapter == "TERMINAL":
        raise HTTPException(409, detail="Pointage facial : caméra lue par le serveur obligatoire")
    # Vérifié AVANT toute capture : une caméra désactivée n'est plus jamais interrogée.
    if not camera.active or camera.usage not in ("ATTENDANCE", "ATTENDANCE_AND_ENROLLMENT"):
        raise HTTPException(409, detail="Caméra non autorisée pour le pointage")
    if not camera.facial_attendance_enabled:
        raise HTTPException(409, detail="Pointage facial non activé pour cette caméra (activation pilote requise)")
    # Les images sont TOUJOURS lues par le serveur sur la caméra : aucune image fournie par
    # le client n'est acceptée pour pointer (voir docs/biometrics.md, injection numérique).
    frames = _frames_for(camera, None)
    try:
        result = service.recognize_and_record(db, camera=camera, frames=frames, actor=user, burst_id=payload.burst_id,
                                              employee_hint=payload.employee_id)
    except HTTPException as exc:
        db.rollback()
        _audit_recognition(db, user, camera, {"state": "ERROR", "recorded": False, "reason": str(exc.detail)[:200]})
        raise
    _audit_recognition(db, user, camera, result)
    return result


def _audit_recognition(db: Session, user: User, camera: Camera, result: dict[str, Any]) -> None:
    """Chaque tentative de pointage facial est tracée — métadonnées seulement (jamais
    d'image ni de gabarit) : caméra, site, employé reconnu, état, score, liveness, config,
    pointage créé ou non, motif de refus."""
    employee = result.get("employee") or {}
    append_audit(db, action="biometrics.recognize", resource="camera", resource_id=camera.id,
                 result="success" if result.get("recorded") else "refused", user=user, society=camera.society,
                 new_state={"camera_id": camera.id, "site_id": camera.site_id, "state": result.get("state"),
                            "matricule": employee.get("matricule"), "confidence": result.get("confidence"),
                            "liveness": result.get("liveness"), "config_version": result.get("config_version"),
                            "recorded": bool(result.get("recorded")), "action": result.get("action"),
                            "reason": result.get("reason") or (None if result.get("recorded") else result.get("message"))})
    db.commit()


@router.post("/sites/{site_id}/facial-disable")
def disable_site_facial(site_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Coupure immédiate du pointage facial d'un site (toutes ses caméras ET tous ses
    terminaux mobiles) — sans effet sur le QR ni la saisie manuelle. Réactivation caméra par
    caméra / terminal par terminal, explicitement."""
    require_feature(db, user, "biometric_admin", "admin")
    site = _ensure_site_allowed(db, user, site_id)
    cams = db.execute(select(Camera).where(Camera.site_id == site_id, Camera.facial_attendance_enabled.is_(True))).scalars().all()
    for cam in cams:
        cam.facial_attendance_enabled = False
    terms = db.execute(select(BiometricTerminal).where(BiometricTerminal.site_id == site_id,
                                                       BiometricTerminal.facial_attendance_enabled.is_(True))).scalars().all()
    for term in terms:
        term.facial_attendance_enabled = False
        term.config_version += 1          # défis en cours caducs
    append_audit(db, action="biometrics.site.facial_disable", resource="site", resource_id=site_id, result="success",
                 user=user, society=_site_society(site), new_state={"cameras": [c.id for c in cams], "terminals": [t.id for t in terms]})
    db.commit()
    return {"site_id": site_id, "disabled_cameras": len(cams), "disabled_terminals": len(terms)}


# ── Terminaux mobiles autorisés (administration) ─────────────────────────────────────────
def _terminal_out(term: BiometricTerminal, site: Site | None = None) -> dict[str, Any]:
    now = datetime.utcnow()
    iso = lambda v: v.isoformat() + "Z" if v else None  # noqa: E731
    return {"id": term.id, "terminal_id": term.public_id, "name": term.name, "terminal_type": term.terminal_type,
            "society": term.society, "site_id": term.site_id, "site": site.name if site else None, "location": term.location,
            "enabled": bool(term.enabled), "facial_attendance_enabled": bool(term.facial_attendance_enabled),
            "paired": bool(term.public_key), "paired_at": iso(term.paired_at),
            "key_fingerprint": (term.key_fingerprint or "")[:16] or None,
            "pairing_pending": bool(term.pairing_code_hash and term.pairing_expires_at and term.pairing_expires_at > now),
            "pairing_expires_at": iso(term.pairing_expires_at) if term.pairing_code_hash else None,
            "last_seen_at": iso(term.last_seen_at), "revoked_at": iso(term.revoked_at), "revoked_reason": term.revoked_reason,
            "config_version": term.config_version, "device_label": (term.meta or {}).get("device_label"),
            "created_by": term.created_by}


def _terminal_in_scope(db: Session, user: User, terminal_id: int) -> BiometricTerminal:
    term = db.get(BiometricTerminal, terminal_id)
    allowed = _allowed_assignment_site_ids(db, user)
    if not term or (allowed is not None and term.site_id not in set(allowed)):
        raise HTTPException(404, detail="Terminal introuvable")
    return term


@router.get("/terminals")
def list_terminals(site_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    require_feature(db, user, "biometric_status", "read")
    allowed = _allowed_assignment_site_ids(db, user)
    stmt = select(BiometricTerminal)
    if site_id is not None:
        _ensure_site_allowed(db, user, site_id)
        stmt = stmt.where(BiometricTerminal.site_id == site_id)
    elif allowed is not None:
        stmt = stmt.where(BiometricTerminal.site_id.in_(allowed or [-1]))
    rows = db.execute(stmt.order_by(BiometricTerminal.site_id, BiometricTerminal.name)).scalars().all()
    sites = {s.id: s for s in db.execute(select(Site).where(Site.id.in_({r.site_id for r in rows}))).scalars()} if rows else {}
    return [_terminal_out(r, sites.get(r.site_id)) for r in rows]


class TerminalIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    terminal_type: str
    site_id: int
    location: str | None = Field(None, max_length=120)


class TerminalPatch(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=80)
    location: str | None = Field(None, max_length=120)
    enabled: bool | None = None
    facial_attendance_enabled: bool | None = None


class RevokeIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/terminals")
def add_terminal(payload: TerminalIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_admin", "admin")
    if payload.terminal_type not in TERMINAL_TYPES:
        raise HTTPException(422, detail="Type de terminal inconnu")
    if payload.terminal_type not in MOBILE_TERMINAL_TYPES:
        raise HTTPException(422, detail="Caméra RTSP/Dahua : à déclarer dans Caméras (lue par le serveur)")
    site = _ensure_site_allowed(db, user, payload.site_id)
    society = _site_society(site) or ""
    if not society:
        raise HTTPException(422, detail="Le site n'a pas de société : un terminal appartient à une société ET un site")
    if db.execute(select(BiometricTerminal.id).where(BiometricTerminal.site_id == site.id,
                                                     BiometricTerminal.name == payload.name.strip())).first():
        raise HTTPException(409, detail="Un terminal porte déjà ce nom sur ce site")
    term = BiometricTerminal(public_id="trm_" + secrets.token_urlsafe(18), name=payload.name.strip(),
                             terminal_type=payload.terminal_type, society=society, site_id=site.id, location=payload.location,
                             enabled=True, facial_attendance_enabled=False, config_version=1, meta={},
                             created_by=getattr(user, "username", None))
    db.add(term)
    db.flush()
    append_audit(db, action="biometrics.terminal.create", resource="biometric_terminal", resource_id=term.id, result="success",
                 user=user, society=society, new_state={k: v for k, v in _terminal_out(term, site).items() if k != "created_by"})
    db.commit()
    return _terminal_out(term, site)


@router.patch("/terminals/{terminal_id}")
def update_terminal(terminal_id: int, payload: TerminalPatch, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    require_feature(db, user, "biometric_admin", "admin")
    term = _terminal_in_scope(db, user, terminal_id)
    if term.revoked_at:
        raise HTTPException(409, detail="Terminal révoqué")
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("facial_attendance_enabled") and not term.public_key:
        raise HTTPException(422, detail="Associez d'abord le terminal (code d'association) avant d'activer le pointage facial")
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    for key, value in changes.items():
        setattr(term, key, value)
    term.config_version += 1              # défis en cours caducs
    append_audit(db, action="biometrics.terminal.update", resource="biometric_terminal", resource_id=term.id, result="success",
                 user=user, society=term.society, new_state=changes)
    db.commit()
    return _terminal_out(term, db.get(Site, term.site_id))


@router.post("/terminals/{terminal_id}/pairing-code")
def terminal_pairing_code(terminal_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Code d'association à usage unique (10 min). Sur un terminal déjà associé : rotation de
    la clé (l'ancienne reste valable jusqu'à la nouvelle association)."""
    require_feature(db, user, "biometric_admin", "admin")
    term = _terminal_in_scope(db, user, terminal_id)
    out = terminals.new_pairing_code(db, term, user)
    db.commit()
    return {**out, "terminal": _terminal_out(term, db.get(Site, term.site_id))}


@router.post("/terminals/{terminal_id}/revoke")
def revoke_terminal(terminal_id: int, payload: RevokeIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Révocation définitive, effet immédiat : clé publique effacée, code annulé."""
    require_feature(db, user, "biometric_admin", "admin")
    term = _terminal_in_scope(db, user, terminal_id)
    if term.revoked_at:
        raise HTTPException(409, detail="Terminal déjà révoqué")
    term.revoked_at, term.revoked_reason = datetime.utcnow(), payload.reason.strip()
    term.enabled = term.facial_attendance_enabled = False
    term.public_key = term.key_fingerprint = term.pairing_code_hash = term.pairing_expires_at = None
    term.config_version += 1
    append_audit(db, action="biometrics.terminal.revoke", resource="biometric_terminal", resource_id=term.id, result="success",
                 user=user, society=term.society, new_state={"terminal_id": term.public_id, "reason": term.revoked_reason})
    db.commit()
    return _terminal_out(term, db.get(Site, term.site_id))


@router.get("/terminals/{terminal_id}/audit")
def terminal_audit(terminal_id: int, limit: int = 50, db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    """Journal du terminal (association, activations, tentatives) — métadonnées seulement."""
    from app.modules.auth.models import AuditEvent

    if not _feature_granted(db, user, "biometric_admin", ("validate", "admin")):
        require_feature(db, user, "biometric_admin", "admin")
    term = _terminal_in_scope(db, user, terminal_id)
    rows = db.execute(select(AuditEvent).where(AuditEvent.resource == "biometric_terminal", AuditEvent.resource_id == str(term.id))
                      .order_by(AuditEvent.id.desc()).limit(max(1, min(limit, 200)))).scalars().all()
    out = []
    for row in rows:
        try:
            state = json.loads(row.new_state) if row.new_state else {}
        except ValueError:
            state = {}
        out.append({"at": row.created_at.isoformat() + "Z" if getattr(row, "created_at", None) else None, "action": row.action,
                    "result": row.result, "by": row.username, "state": state.get("state"), "matricule": state.get("matricule"),
                    "recorded": state.get("recorded"), "reason": state.get("reason"), "confidence": state.get("confidence"),
                    "liveness": state.get("liveness")})
    return out


# ── Mode Test (caméra du navigateur) — AUCUN POINTAGE ────────────────────────────────────
# Circuit séparé du pointage réel (docs/biometrics.md, § Mode Test) : image du navigateur
# acceptée ICI SEULEMENT, jamais par /cameras/{id}/recognize ; aucune écriture de présence.
TEST_PERMISSION = ("biometric_admin", ("validate", "admin"))


def _feature_granted(db: Session, user: User, feature: str, actions: tuple[str, ...]) -> bool:
    return is_global_administrator(user) or any(
        g.module_key == "attendance" and g.feature_key == feature and g.action_key in actions
        for g in load_feature_permissions(db, user.id))


async def _test_mode_payload(request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Permission explicite, limitation de débit, puis lecture BORNÉE du corps (jamais plus de
    MAX_BODY_BYTES en mémoire) — avant tout décodage d'image."""
    feature, actions = TEST_PERMISSION
    if not _feature_granted(db, user, feature, actions):
        append_audit(db, action="authorization.biometric", resource="api", resource_id="biometric_test_mode",
                     result="refused", user=user)
        db.commit()
        raise HTTPException(403, detail="Permission biométrique explicite requise (biometric_admin)")
    if not settings.biometric_test_mode_enabled:
        raise HTTPException(503, detail={"code": "TEST_MODE_DISABLED",
                                         "message": "Mode Test biométrique désactivé (BIOMETRIC_TEST_MODE_ENABLED=false)"})
    key = f"biometric-test:{user.id}"
    if rate_limit.failure_count(key, 60) >= settings.biometric_test_mode_max_per_minute:
        raise HTTPException(429, detail={"code": "RATE_LIMITED", "message": "Trop d'essais — patientez une minute"})
    rate_limit.record_failure(key, 60)
    started = time.perf_counter()
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > test_mode.MAX_BODY_BYTES:
        raise HTTPException(413, detail={"code": "IMAGE_TOO_LARGE", "message": "Requête trop volumineuse"})
    size, chunks = 0, []
    async for chunk in request.stream():
        size += len(chunk)
        if size > test_mode.MAX_BODY_BYTES:
            raise HTTPException(413, detail={"code": "IMAGE_TOO_LARGE", "message": "Requête trop volumineuse"})
        chunks.append(chunk)
    try:
        payload = json.loads(b"".join(chunks) or b"{}")
    except ValueError:
        raise HTTPException(422, detail={"code": "INVALID_IMAGE", "message": "Corps JSON invalide"}) from None
    if not isinstance(payload, dict):
        raise HTTPException(422, detail={"code": "INVALID_IMAGE", "message": "Corps JSON invalide"})
    payload["_upload_ms"] = round((time.perf_counter() - started) * 1000, 1)
    return payload


@router.get("/test-mode/status")
def test_mode_status(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Contrat du Mode Test pour l'interface : état, droits du compte, limites, codes."""
    return {**test_mode.availability(), "permitted": _feature_granted(db, user, *TEST_PERMISSION),
            "records_attendance": False, "max_frames": test_mode.MAX_FRAMES, "max_frame_bytes": test_mode.MAX_FRAME_BYTES,
            "max_side_px": test_mode.MAX_SIDE, "formats": list(test_mode.FORMATS),
            "max_per_minute": settings.biometric_test_mode_max_per_minute, "states": list(test_mode.STATES),
            "refusal_reasons": list(test_mode.REFUSAL_REASONS), "error_codes": list(test_mode.UNAVAILABLE_CODES)}


@router.post("/test-mode/recognize")
def test_mode_recognize(payload: dict = Depends(_test_mode_payload), db: Session = Depends(get_db),
                        user: User = Depends(current_user)) -> dict[str, Any]:
    """Reconnaissance de TEST : { site_id, frames: [image base64 | data URL, …] } →
    résultat normalisé. N'écrit AUCUNE présence, anomalie, gabarit ni configuration."""
    from app.modules.attendance.core import _now_local

    started = time.perf_counter()
    engine = test_mode.ensure_test_mode()
    try:
        site_id = int(payload.get("site_id"))
    except (TypeError, ValueError):
        raise HTTPException(422, detail="site_id obligatoire") from None
    site = db.get(Site, site_id)
    allowed = _allowed_assignment_site_ids(db, user)
    if not site or (allowed is not None and site_id not in set(allowed)):
        raise HTTPException(404, detail="Site introuvable")
    audit = {"site_id": site_id, "frames": len(payload.get("frames") or []) if isinstance(payload.get("frames"), list) else 0}
    try:
        validation_start = time.perf_counter()
        frames = test_mode.decode_frames(payload.get("frames"))
        validation_ms = round((time.perf_counter() - validation_start) * 1000, 1)
        try:
            result = test_mode.recognize(db, engine=engine, site=site, frames=frames, today=_now_local().date())
        finally:
            # Défense en profondeur : même si une écriture s'était glissée dans le pipeline,
            # elle ne survivrait pas — seule la trace d'audit ci-dessous est enregistrée.
            db.rollback()
    except HTTPException as exc:
        code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
        append_audit(db, action="biometrics.test_mode.recognize", resource="site", resource_id=site_id, result="refused",
                     user=user, society=_site_society(site), new_state={**audit, "error": code or exc.status_code})
        db.commit()
        raise
    result["timings_ms"] = {"upload": payload.get("_upload_ms"), "validation": validation_ms, **result["timings_ms"],
                            "total": round((time.perf_counter() - started) * 1000 + (payload.get("_upload_ms") or 0), 1)}
    # Métadonnées seulement : jamais d'image, de gabarit, ni de vecteur.
    append_audit(db, action="biometrics.test_mode.recognize", resource="site", resource_id=site_id, result="success",
                 user=user, society=_site_society(site),
                 new_state={**audit, "state": result["state"], "reason_code": result["reason_code"],
                            "liveness": result["liveness"]["result"],
                            "confidence": (result["match"] or {}).get("confidence"),
                            "employee_id": (result["employee"] or {}).get("employee_id") if result["state"] == "RECOGNIZED" else None,
                            "duration_ms": result["timings_ms"]["total"], "config_version": result["config_version"]})
    db.commit()
    return result
