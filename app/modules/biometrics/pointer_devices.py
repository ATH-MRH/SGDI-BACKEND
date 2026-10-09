"""Équipements faciaux — autorisations par utilisateur et usage simultané depuis le Pointeur.

Un « équipement facial » est l'un des deux circuits EXISTANTS, jamais un troisième :
- terminal mobile associé (circuit B, `biometric_terminals`) : borne AUTONOME, qui pointe seule
  avec sa clé d'appareil. Le Pointeur ne peut que la surveiller — aucune activation distante ;
- caméra IP lue par le serveur (circuit C, `cameras`) : le poste Pointeur déclenche les essais,
  le serveur capture lui-même l'image (jamais le navigateur).

Enregistrement et association : Administration Système uniquement (`require_system_admin`).
Le Pointeur ne voit que les équipements enregistrés, actifs, de son périmètre Société ∩ Site ET
explicitement autorisés pour son compte (`FacialDeviceAuthorization`, refus par défaut). Tout
est revérifié à chaque opération : une sélection envoyée par le navigateur n'élargit rien.
Aucune réponse ne contient d'hôte, d'identifiant de connexion, de clé ni d'empreinte.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.granular_permissions import is_global_administrator, load_feature_permissions
from app.db.session import get_db
from app.modules.attendance import core as attendance_core
from app.modules.attendance.models import EVENT_ARRIVAL, SOURCE_FACIAL, AttendanceEvent
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.biometrics import service
from app.modules.biometrics.models import BiometricTerminal, Camera, FacialDeviceAuthorization
from app.modules.ops.models import Site
from app.modules.ops.routes import _allowed_assignment_site_ids

router = APIRouter()

ATTENDANCE_USAGES = ("ATTENDANCE", "ATTENDANCE_AND_ENROLLMENT")
# Une borne armée et au repos ne contacte le serveur que par à-coups (dernière communication
# écrite au plus une fois par minute) : fenêtre large pour ne pas l'afficher hors ligne à tort.
TERMINAL_ONLINE_SECONDS = 120
EVENT_WINDOW = timedelta(hours=24)
MAX_SELECTION = 50
TERMINAL_HARDWARE = {"TABLET_ANDROID": "Tablette Android", "SMARTPHONE_ANDROID": "Smartphone Android",
                     "IPHONE": "iPhone", "IPAD": "iPad"}
STATUS_LABELS = {"ACTIVE": "Actif", "INACTIVE": "Inactif", "OFFLINE": "Hors ligne", "REVOKED": "Révoqué"}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() + "Z" if value else None


# ── Permissions ──────────────────────────────────────────────────────────────────────────
def require_system_admin(db: Session, user: User) -> None:
    """Enregistrement, association, révocation, remplacement et autorisations : réservés à
    l'Administration Système (administrateur global, ou Sécurité des accès × Administrer)."""
    if is_global_administrator(user):
        return
    if any(g.module_key == "administration" and g.feature_key == "security" and g.action_key == "admin"
           for g in load_feature_permissions(db, user.id)):
        return
    append_audit(db, action="authorization.biometric", resource="api", resource_id="facial_devices:admin",
                 result="refused", user=user)
    db.commit()
    raise HTTPException(403, detail="Opération réservée à l'Administration Système")


def authorized_ids(db: Session, user_id: int) -> tuple[set[int], set[int]]:
    rows = db.execute(select(FacialDeviceAuthorization.terminal_id, FacialDeviceAuthorization.camera_id)
                      .where(FacialDeviceAuthorization.user_id == user_id)).all()
    return {t for t, _ in rows if t is not None}, {c for _, c in rows if c is not None}


def _pointer_scope(db: Session, user: User, site_id: int | None = None, society: str | None = None):
    """Périmètre du poste Pointeur : intersection Société ∩ Site (403 hors périmètre)."""
    from app.modules.portal.routes import _attendance_selected_sites, _attendance_society_scope

    return _attendance_selected_sites(db, user, site_id, society), _attendance_society_scope(db, user)


def require_device(db: Session, user: User, *, camera: Camera | None = None,
                   terminal: BiometricTerminal | None = None) -> None:
    """Société, site ET autorisation explicite de CE compte sur CET équipement."""
    if is_global_administrator(user):
        return
    device = camera if camera is not None else terminal
    _selected, scope = _pointer_scope(db, user, site_id=device.site_id)
    if not scope.allows(device.society):
        raise HTTPException(403, detail="Société non autorisée")
    terminal_ids, camera_ids = authorized_ids(db, user.id)
    if (camera is not None and camera.id in camera_ids) or (terminal is not None and terminal.id in terminal_ids):
        return
    append_audit(db, action="authorization.biometric", resource="camera" if camera is not None else "biometric_terminal",
                 resource_id=device.id, result="refused", user=user, society=device.society,
                 new_state={"reason": "DEVICE_NOT_AUTHORIZED"})
    db.commit()
    raise HTTPException(403, detail="Terminal non autorisé pour ce compte")


# ── État des équipements ─────────────────────────────────────────────────────────────────
def terminal_online(term: BiometricTerminal, now: datetime | None = None) -> bool:
    now = now or datetime.utcnow()
    return bool(term.last_seen_at and (now - term.last_seen_at).total_seconds() <= TERMINAL_ONLINE_SECONDS)


def terminal_block(term: BiometricTerminal) -> tuple[str, str] | None:
    if term.deleted_at or term.revoked_at:
        return "REVOKED", "Terminal révoqué par l'administration"
    if not term.public_key:
        return "NOT_PAIRED", "Terminal non appairé — appairage par l'Administration Système"
    if not term.enabled:
        return "DISABLED", "Terminal désactivé par l'administration"
    if not term.facial_attendance_enabled:
        return "FACIAL_OFF", "Pointage facial non activé sur ce terminal par l'administration"
    return None


def camera_block(cam: Camera) -> tuple[str, str] | None:
    if cam.adapter == "TERMINAL" or cam.usage not in ATTENDANCE_USAGES:
        return "UNSUPPORTED", "Équipement non prévu pour le pointage facial"
    if not cam.active:
        return "DISABLED", "Caméra désactivée par l'administration"
    if not cam.facial_attendance_enabled:
        return "FACIAL_OFF", "Pointage facial non activé sur cette caméra par l'administration"
    return None


def _engine_block() -> str | None:
    try:
        service.ensure_enabled()
    except HTTPException as exc:
        return str(exc.detail)
    return None


def _event_out(event: AttendanceEvent) -> dict[str, Any]:
    data = event.data if isinstance(event.data, dict) else {}
    local = attendance_core.to_local(event.occurred_at)
    return {"id": event.id, "at": local.isoformat(timespec="seconds"), "heure": local.strftime("%H:%M:%S"),
            "type": "ENTREE" if event.event_type == EVENT_ARRIVAL else "SORTIE", "site_id": event.site_id,
            "matricule": data.get("matricule") or "", "name": data.get("agentName") or ""}


def _last_events(db: Session, cameras: list[Camera], terminals: list[BiometricTerminal]) -> dict[str, AttendanceEvent]:
    """Dernier pointage facial ACCEPTÉ de chaque équipement (24 h) — lecture seule."""
    site_ids = {d.site_id for d in cameras} | {d.site_id for d in terminals}
    if not site_ids:
        return {}
    since = attendance_core.to_utc_naive(attendance_core._now_local() - EVENT_WINDOW)
    rows = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.source == SOURCE_FACIAL, AttendanceEvent.site_id.in_(site_ids), AttendanceEvent.occurred_at >= since,
    ).order_by(AttendanceEvent.id.desc()).limit(300)).scalars().all()
    by_public = {t.public_id: f"trm:{t.id}" for t in terminals}
    camera_keys = {c.id: f"cam:{c.id}" for c in cameras}
    out: dict[str, AttendanceEvent] = {}
    for event in rows:
        data = event.data if isinstance(event.data, dict) else {}
        key = camera_keys.get(event.device_id) if event.device_id is not None else by_public.get(data.get("terminal"))
        if key:
            out.setdefault(key, event)
    return out


def _authorized_devices(db: Session, user: User, selected: set[int] | None, scope) -> tuple[list[Camera], list[BiometricTerminal]]:
    """Équipements autorisés pour ce compte dans le périmètre demandé — quel que soit leur état."""
    terminal_ids, camera_ids = (None, None) if is_global_administrator(user) else authorized_ids(db, user.id)
    cam_stmt, term_stmt = select(Camera), select(BiometricTerminal)
    if selected is not None:
        cam_stmt = cam_stmt.where(Camera.site_id.in_(selected or [-1]))
        term_stmt = term_stmt.where(BiometricTerminal.site_id.in_(selected or [-1]))
    if camera_ids is not None:
        cam_stmt = cam_stmt.where(Camera.id.in_(camera_ids or [-1]))
        term_stmt = term_stmt.where(BiometricTerminal.id.in_(terminal_ids or [-1]))
    cameras = [c for c in db.execute(cam_stmt.order_by(Camera.site_id, Camera.name)).scalars() if scope.allows(c.society)]
    terminals = [t for t in db.execute(term_stmt.order_by(BiometricTerminal.site_id, BiometricTerminal.name)).scalars()
                 if scope.allows(t.society)]
    return cameras, terminals


def _site_names(db: Session, devices: list[Any]) -> dict[int, str]:
    ids = {d.site_id for d in devices}
    return {s.id: s.name for s in db.execute(select(Site).where(Site.id.in_(ids))).scalars()} if ids else {}


def _pointer_row(device: Any, key: str, sites: dict[int, str], last: AttendanceEvent | None, now: datetime) -> dict[str, Any]:
    base = {"key": key, "name": device.name, "location": device.location, "site_id": device.site_id,
            "site": sites.get(device.site_id), "society": device.society, "last_event": _event_out(last) if last else None}
    if isinstance(device, Camera):
        # Aucune liaison permanente : la disponibilité réelle n'est connue qu'à l'essai (online=None).
        return {**base, "kind": "CAMERA", "category": "IP_CAMERA",
                "hardware": " ".join(v for v in (device.manufacturer, device.model) if v) or "Caméra IP",
                "activation": "SERVER_CAMERA", "remote_activation": True, "online": None, "state": "READY",
                "last_communication": None}
    online = terminal_online(device, now)
    return {**base, "kind": "TERMINAL", "category": "MOBILE_KIOSK",
            "hardware": TERMINAL_HARDWARE.get(device.terminal_type, device.terminal_type),
            "activation": "AUTONOMOUS", "remote_activation": False, "online": online,
            "state": "ONLINE" if online else "OFFLINE", "last_communication": _iso(device.last_seen_at)}


# ── Poste Pointeur ───────────────────────────────────────────────────────────────────────
@router.get("/pointer/terminals")
def pointer_terminals(site_id: int | None = None, society: str | None = None,
                      db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Équipements faciaux utilisables par CE compte : enregistrés, actifs, autorisés et du
    périmètre Société/Site sélectionné. Sert aussi de relevé d'état périodique."""
    selected, scope = _pointer_scope(db, user, site_id, society)
    cameras, terminals = _authorized_devices(db, user, selected, scope)
    cameras = [c for c in cameras if c.adapter != "TERMINAL"]
    terminals = [t for t in terminals if not t.deleted_at]
    usable_cameras = [c for c in cameras if camera_block(c) is None]
    usable_terminals = [t for t in terminals if terminal_block(t) is None]
    sites = _site_names(db, usable_cameras + usable_terminals)
    last = _last_events(db, usable_cameras, usable_terminals)
    now = datetime.utcnow()
    rows = [_pointer_row(t, f"trm:{t.id}", sites, last.get(f"trm:{t.id}"), now) for t in usable_terminals] \
        + [_pointer_row(c, f"cam:{c.id}", sites, last.get(f"cam:{c.id}"), now) for c in usable_cameras]
    rows.sort(key=lambda r: ((r["site"] or "").lower(), r["name"].lower()))
    latest = max(last.values(), key=lambda e: e.id) if last else None
    engine_error = _engine_block()
    return {"server_time": attendance_core._now_local().isoformat(timespec="seconds"),
            "engine": {"ready": engine_error is None, "message": engine_error},
            "authorized_total": len(cameras) + len(terminals), "terminals": rows,
            "last_event": _event_out(latest) if latest else None}


class SelectionIn(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=MAX_SELECTION)
    site_id: int | None = None
    society: str | None = Field(None, max_length=150)


def _selection(db: Session, user: User, payload: SelectionIn) -> dict[str, Any]:
    selected, scope = _pointer_scope(db, user, payload.site_id, payload.society)
    cameras, terminals = _authorized_devices(db, user, selected, scope)
    return {**{f"cam:{c.id}": c for c in cameras}, **{f"trm:{t.id}": t for t in terminals}}


@router.post("/pointer/terminals/activate")
def activate_terminals(payload: SelectionIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Contrôle la sélection équipement par équipement : chacun reçoit SON résultat, le refus de
    l'un n'empêche pas les autres. Une borne autonome n'est jamais déclarée « activée » : elle
    est surveillée, et son état réel (en ligne / hors ligne) est renvoyé."""
    devices = _selection(db, user, payload)
    engine_error = _engine_block()
    now = datetime.utcnow()
    results = []
    for key in dict.fromkeys(payload.keys):
        device = devices.get(key)
        if device is None:
            results.append({"key": key, "status": "REFUSED", "code": "NOT_AUTHORIZED",
                            "message": "Terminal non autorisé pour ce compte ou hors du périmètre sélectionné"})
            continue
        block = camera_block(device) if isinstance(device, Camera) else terminal_block(device)
        if block:
            results.append({"key": key, "status": "REFUSED", "code": block[0], "message": block[1]})
        elif engine_error:
            results.append({"key": key, "status": "REFUSED", "code": "ENGINE_UNAVAILABLE", "message": engine_error})
        elif isinstance(device, Camera):
            results.append({"key": key, "status": "ACTIVATED", "code": "SERVER_CAMERA", "message": "Caméra activée"})
        else:
            online = terminal_online(device, now)
            results.append({"key": key, "status": "MONITORED", "code": "AUTONOMOUS" if online else "AUTONOMOUS_OFFLINE",
                            "online": online, "last_communication": _iso(device.last_seen_at),
                            "message": "Terminal autonome : il pointe seul, sans activation distante. Surveillance démarrée."
                            if online else "Terminal hors ligne : aucune communication récente. Surveillance démarrée."})
    append_audit(db, action="biometrics.pointer.activate", resource="facial_device", result="success", user=user,
                 new_state={"site_id": payload.site_id, "results": [{k: r[k] for k in ("key", "status", "code")} for r in results]})
    db.commit()
    return {"results": results, "server_time": attendance_core._now_local().isoformat(timespec="seconds")}


@router.post("/pointer/terminals/stop")
def stop_terminals(payload: SelectionIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Fin de surveillance décidée au poste (tracée). Ne modifie AUCUN réglage administratif :
    une borne autonome continue de fonctionner."""
    devices = _selection(db, user, payload)
    stopped = [key for key in dict.fromkeys(payload.keys) if key in devices]
    append_audit(db, action="biometrics.pointer.stop", resource="facial_device", result="success", user=user,
                 new_state={"site_id": payload.site_id, "keys": stopped})
    db.commit()
    return {"stopped": stopped}


def _camera_by_key(db: Session, key: str) -> Camera:
    kind, _, raw = key.partition(":")
    camera = db.get(Camera, int(raw)) if kind == "cam" and raw.isdigit() else None
    if camera is None:
        raise HTTPException(404, detail="Terminal introuvable")
    return camera


@router.get("/pointer/terminals/attempt")
def attempt_status(key: str, burst_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Vérification de statut après une coupure réseau : l'essai `burst_id` a-t-il créé un
    pointage ? Lecture seule — évite d'afficher un refus (ou de re-pointer) à l'aveugle."""
    if not burst_id or len(burst_id) > 80:
        raise HTTPException(422, detail="Identifiant d'essai invalide")
    camera = _camera_by_key(db, key)
    allowed = _allowed_assignment_site_ids(db, user)
    if allowed is not None and camera.site_id not in set(allowed):
        raise HTTPException(404, detail="Terminal introuvable")
    require_device(db, user, camera=camera)
    event = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.source == SOURCE_FACIAL, AttendanceEvent.idempotency_key == f"cam{camera.id}-{burst_id}",
    )).scalar_one_or_none()
    return {"key": key, "burst_id": burst_id, "recorded": event is not None, "event": _event_out(event) if event else None,
            "server_time": attendance_core._now_local().isoformat(timespec="seconds")}


# ── Administration Système ───────────────────────────────────────────────────────────────
def _admin_devices(db: Session, user: User) -> tuple[list[Camera], list[BiometricTerminal]]:
    allowed = _allowed_assignment_site_ids(db, user)
    cam_stmt = select(Camera).where(Camera.adapter != "TERMINAL")
    term_stmt = select(BiometricTerminal).where(BiometricTerminal.deleted_at.is_(None))
    if allowed is not None:
        cam_stmt = cam_stmt.where(Camera.site_id.in_(allowed or [-1]))
        term_stmt = term_stmt.where(BiometricTerminal.site_id.in_(allowed or [-1]))
    return (db.execute(cam_stmt.order_by(Camera.site_id, Camera.name)).scalars().all(),
            db.execute(term_stmt.order_by(BiometricTerminal.site_id, BiometricTerminal.name)).scalars().all())


def _admin_row(device: Any, sites: dict[int, str], users: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    if isinstance(device, Camera):
        check = device.last_check if isinstance(device.last_check, dict) else {}
        reachable = (check.get("connection") or {}).get("ok")
        status = "INACTIVE" if not device.active else "OFFLINE" if reachable is False else "ACTIVE"
        extra = {"key": f"cam:{device.id}", "kind": "CAMERA", "category": "IP_CAMERA",
                 "hardware": " ".join(v for v in (device.manufacturer, device.model) if v) or "Caméra IP",
                 "equipment": device.location, "paired": True, "paired_at": _iso(device.created_at),
                 "last_communication": check.get("checked_at"), "remote_activation": True, "pairing": "REGISTRATION"}
    else:
        paired = bool(device.public_key)
        status = "REVOKED" if device.revoked_at else "INACTIVE" if not (device.enabled and paired) \
            else "ACTIVE" if terminal_online(device, now) else "OFFLINE"
        extra = {"key": f"trm:{device.id}", "kind": "TERMINAL", "category": "MOBILE_KIOSK",
                 "hardware": TERMINAL_HARDWARE.get(device.terminal_type, device.terminal_type),
                 "equipment": (device.meta or {}).get("device_label") or device.location, "paired": paired,
                 "paired_at": _iso(device.paired_at), "last_communication": _iso(device.last_seen_at),
                 "remote_activation": False, "pairing": "DEVICE_KEY",
                 "pairing_pending": bool(device.pairing_code_hash and device.pairing_expires_at and device.pairing_expires_at > now),
                 "revoked_reason": device.revoked_reason}
    return {**extra, "id": device.id, "name": device.name, "society": device.society, "site_id": device.site_id,
            "site": sites.get(device.site_id), "status": status, "status_label": STATUS_LABELS[status],
            "facial_attendance_enabled": bool(device.facial_attendance_enabled), "users": users}


def _user_out(user: User) -> dict[str, Any]:
    return {"id": user.id, "username": user.username, "full_name": user.full_name, "is_active": bool(user.is_active)}


def _authorized_users(db: Session) -> dict[str, list[dict[str, Any]]]:
    rows = db.execute(select(FacialDeviceAuthorization, User).join(User, User.id == FacialDeviceAuthorization.user_id)
                      .order_by(User.username)).all()
    out: dict[str, list[dict[str, Any]]] = {}
    for auth, target in rows:
        key = f"trm:{auth.terminal_id}" if auth.terminal_id is not None else f"cam:{auth.camera_id}"
        out.setdefault(key, []).append(_user_out(target))
    return out


@router.get("/facial-devices")
def facial_devices(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Administration Système : tous les équipements faciaux et leurs utilisateurs autorisés."""
    require_system_admin(db, user)
    cameras, terminals = _admin_devices(db, user)
    sites = _site_names(db, cameras + terminals)
    users = _authorized_users(db)
    now = datetime.utcnow()
    rows = [_admin_row(d, sites, users.get(f"trm:{d.id}", []), now) for d in terminals] \
        + [_admin_row(d, sites, users.get(f"cam:{d.id}", []), now) for d in cameras]
    return {"items": rows, "kpi": {status.lower(): sum(r["status"] == status for r in rows) for status in STATUS_LABELS},
            # Catégories de matériel réellement prises en charge pour le pointage facial.
            "categories": [
                {"key": "MOBILE_KIOSK", "label": "Terminal mobile autonome (tablette / smartphone, page /borne)", "supported": True,
                 "remote_activation": False},
                {"key": "IP_CAMERA", "label": "Caméra IP lue par le serveur (Dahua, RTSP générique)", "supported": True,
                 "remote_activation": True},
                {"key": "NETWORK_STANDALONE", "label": "Terminal réseau autonome à reconnaissance embarquée", "supported": False,
                 "remote_activation": False},
                {"key": "LOCAL_CAMERA", "label": "Caméra USB ou intégrée du poste Pointeur", "supported": False,
                 "remote_activation": False},
            ]}


def _device_by_key(db: Session, user: User, key: str) -> Camera | BiometricTerminal:
    cameras, terminals = _admin_devices(db, user)
    device = {**{f"cam:{c.id}": c for c in cameras}, **{f"trm:{t.id}": t for t in terminals}}.get(key)
    if device is None:
        raise HTTPException(404, detail="Terminal introuvable")
    return device


def _fits(db: Session, target: User, device: Any) -> bool:
    """Le périmètre Société ∩ Site du compte couvre-t-il cet équipement ?"""
    try:
        _selected, scope = _pointer_scope(db, target, site_id=device.site_id)
    except HTTPException:
        return False
    return scope.allows(device.society)


def _pointer_capable(target: User) -> bool:
    modules = target.authorized_modules
    return bool(target.is_active) and not is_global_administrator(target) and (
        str(target.role or "").lower() == "pointeur" or modules is None or "pointeur" in modules)


@router.get("/facial-devices/users")
def eligible_users(key: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    """Comptes actifs du module Pointage dont le périmètre couvre l'équipement."""
    require_system_admin(db, user)
    device = _device_by_key(db, user, key)
    rows = db.execute(select(User).where(User.is_active.is_(True)).order_by(User.username)).scalars().all()
    return [_user_out(u) for u in rows if _pointer_capable(u) and _fits(db, u, device)]


class AuthorizationsIn(BaseModel):
    key: str = Field(max_length=40)
    user_ids: list[int] = Field(max_length=500)


@router.post("/facial-devices/authorizations")
def set_authorizations(payload: AuthorizationsIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Remplace la liste des utilisateurs autorisés sur un équipement. Un compte dont le
    périmètre Société/Site ne couvre pas l'équipement est refusé (422) : rien n'est élargi."""
    require_system_admin(db, user)
    device = _device_by_key(db, user, payload.key)
    is_camera = isinstance(device, Camera)
    if not is_camera and device.revoked_at:
        raise HTTPException(409, detail="Terminal révoqué")
    wanted = set(payload.user_ids)
    targets = {u.id: u for u in db.execute(select(User).where(User.id.in_(wanted or [-1]))).scalars()}
    missing = wanted - set(targets)
    if missing:
        raise HTTPException(422, detail="Utilisateur introuvable")
    outside = sorted(u.username for u in targets.values() if not _pointer_capable(u) or not _fits(db, u, device))
    if outside:
        raise HTTPException(422, detail="Hors périmètre Société/Site ou compte non éligible : " + ", ".join(outside))
    column = FacialDeviceAuthorization.camera_id if is_camera else FacialDeviceAuthorization.terminal_id
    # Verrou de l'équipement : deux enregistrements simultanés sont sérialisés (le second relit
    # la liste déjà à jour) ; la contrainte unique reste le dernier filet.
    model = Camera if is_camera else BiometricTerminal
    db.execute(select(model.id).where(model.id == device.id).with_for_update())
    current = set(db.execute(select(FacialDeviceAuthorization.user_id).where(column == device.id)).scalars())
    if current - wanted:
        db.execute(delete(FacialDeviceAuthorization).where(column == device.id,
                                                           FacialDeviceAuthorization.user_id.in_(current - wanted)))
    for user_id in sorted(wanted - current):
        db.add(FacialDeviceAuthorization(user_id=user_id, granted_by=getattr(user, "username", None),
                                         **({"camera_id": device.id} if is_camera else {"terminal_id": device.id})))
    append_audit(db, action="biometrics.device.authorizations", resource="camera" if is_camera else "biometric_terminal",
                 resource_id=device.id, result="success", user=user, society=device.society,
                 old_state={"user_ids": sorted(current)}, new_state={"user_ids": sorted(wanted)})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail="Autorisations modifiées en parallèle — rechargez la liste") from None
    sites = _site_names(db, [device])
    return _admin_row(device, sites, _authorized_users(db).get(payload.key, []), datetime.utcnow())
