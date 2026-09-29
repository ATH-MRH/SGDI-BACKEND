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
from app.modules.biometrics import crypto, service, test_mode
from app.modules.biometrics.cameras import PROFILES, CameraError, adapter_for
from app.modules.biometrics.engine import EngineUnavailable, get_engine
from app.modules.biometrics.models import (
    CAMERA_ROLES,
    CAMERA_USAGES,
    TEMPLATE_PENDING_REVIEW,
    BiometricConsent,
    BiometricTemplate,
    Camera,
    CameraModel,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from app.modules.ops.routes import _allowed_assignment_site_ids, _ensure_site_allowed, _site_society

router = APIRouter()
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
            "key_configured": bool((settings.biometric_template_key or "").strip()), "notice_version": service.NOTICE_VERSION}


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
        "employee_id": employee_id, "enabled": settings.biometric_enabled,
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
    """Sans caméra : photo de la fiche (source prioritaire). Avec caméra : capture automatique
    (rafale serveur, ou trames du terminal pour une caméra TERMINAL), liveness exigé."""
    require_feature(db, user, "biometric_enrollment", "create")
    employee = _employee_in_scope(db, user, employee_id)
    camera = frames = None
    if payload.camera_id is not None:
        camera = _camera_in_scope(db, user, payload.camera_id)
        if camera.usage not in ("ENROLLMENT", "ATTENDANCE_AND_ENROLLMENT") or not camera.active:
            raise HTTPException(409, detail="Caméra non autorisée pour l'enrôlement")
        frames = _frames_for(camera, payload.frames)
    result = service.enroll(db, employee=employee, actor=user, frames=frames, camera=camera)
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
            "active": cam.active, "credentials_set": bool(cam.credentials_encrypted), "last_check": cam.last_check}


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
    society = _site_society(site) or ""
    if not society:
        raise HTTPException(422, detail="Le site n'a pas de société : une caméra appartient à une société ET un site")
    camera = Camera(name=payload.name.strip(), camera_model_id=model.id, manufacturer=model.manufacturer, model=model.model,
                    adapter=model.adapter, society=society, site_id=site.id, location=payload.location,
                    serial_number=payload.serial_number, host=payload.host.strip(), http_port=payload.http_port,
                    rtsp_port=payload.rtsp_port, connection_type=payload.connection_type, channel=payload.channel,
                    resolution=payload.resolution or model.resolution, fps=payload.fps, profiles=payload.profiles or {},
                    capabilities=model.capabilities or {}, usage=payload.usage, role=payload.role,
                    is_default=payload.is_default, active=payload.active)
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
    # Les images sont TOUJOURS lues par le serveur sur la caméra : aucune image fournie par
    # le client n'est acceptée pour pointer (voir docs/biometrics.md, injection numérique).
    frames = _frames_for(camera, None)
    return service.recognize_and_record(db, camera=camera, frames=frames, actor=user, burst_id=payload.burst_id,
                                        employee_hint=payload.employee_id)


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
