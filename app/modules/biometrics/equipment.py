"""Gestion des équipements — Administration Système.

Vue unifiée des deux registres EXISTANTS, jamais un troisième :
- terminaux mobiles (`biometric_terminals`) : tablettes, smartphones, iPad, iPhone ;
- caméras IP lues par le serveur (`cameras`).
Les affectations aux comptes Pointeur sont les lignes de `facial_device_authorizations` (une par
compte × équipement) : les mêmes que celles écrites par l'écran historique, avec la même trace
d'audit (`biometrics.device.authorizations`, listes avant / après) — l'historique reste unique.

Une affectation ne donne QUE le droit d'utiliser l'équipement depuis le poste Pointeur : elle
n'accorde aucune permission biométrique, n'élargit aucun périmètre Société / Site (un compte
hors périmètre est refusé) et n'active jamais le pointage facial (`facial_attendance_enabled`
n'est jamais écrit ici). Le verrou d'enrôlement n'est pas concerné : rien n'est enrôlé.

Aucune réponse ne contient d'adresse réseau, d'identifiant de connexion, de clé, d'empreinte,
d'identifiant public de terminal ni de code d'appairage.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import AuditEvent, User
from app.modules.biometrics import pointer_devices as pd
from app.modules.biometrics.models import BiometricTerminal, Camera, FacialDeviceAuthorization

router = APIRouter()

MAX_KEYS, MAX_USERS = 50, 200
TYPE_LABELS = {**pd.TERMINAL_HARDWARE, "IP_CAMERA": "Caméra IP"}
ADMIN_STATES = {"ACTIVE": "Actif", "INACTIVE": "Inactif", "REVOKED": "Révoqué"}
AVAILABILITY = {"ONLINE": "En ligne", "OFFLINE": "Hors ligne", "UNKNOWN": "Inconnue"}
PAIRING = {"PAIRED": "Appairé", "PENDING": "Code d'association en attente", "NOT_PAIRED": "Non appairé",
           "REGISTERED": "Enregistrée (liaison serveur)"}
REASONS = {
    "ACCOUNT_INACTIVE": "Compte désactivé",
    "NOT_POINTER": "Compte sans accès au module Pointeur",
    "GLOBAL_ADMIN": "Administrateur global : accès déjà complet, aucune affectation nécessaire",
    "OUT_OF_SCOPE": "Société ou site de l'équipement hors du périmètre du compte",
    "DEVICE_REVOKED": "Équipement révoqué",
    "ALREADY_ASSIGNED": "Déjà affecté",
    "NOT_ASSIGNED": "Non affecté",
}
HISTORY_LABELS = {
    "biometrics.terminal.create": "Enregistrement", "biometrics.terminal.update": "Modification",
    "biometrics.terminal.pairing_code": "Code d'association émis", "biometrics.terminal.pair": "Appairage",
    "biometrics.terminal.revoke": "Révocation", "biometrics.terminal.delete": "Suppression",
    "biometrics.camera.create": "Enregistrement", "biometrics.camera.update": "Modification",
    "biometrics.camera.test": "Test de connexion", "biometrics.device.authorizations": "Affectations modifiées",
    "authorization.biometric": "Accès refusé",
}


# ── Lecture ──────────────────────────────────────────────────────────────────────────────
def _kind_key(device: Any) -> str:
    return f"cam:{device.id}" if isinstance(device, Camera) else f"trm:{device.id}"


def _capabilities(device: Any) -> list[str]:
    if isinstance(device, Camera):
        caps = ["FACIAL_ATTENDANCE"] if device.usage in pd.ATTENDANCE_USAGES else []
        if device.usage in ("ENROLLMENT", "ATTENDANCE_AND_ENROLLMENT"):
            caps.append("ENROLLMENT_CAPTURE")
        return caps + ["PREVIEW"]
    return ["FACIAL_ATTENDANCE", "HEARTBEAT"]


def _row(device: Any, sites: dict[int, str], users: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    """Fiche d'un équipement : la ligne d'administration existante, complétée des états séparés
    (administratif, appairage, disponibilité) et de l'autorisation faciale, distincte."""
    row = pd._admin_row(device, sites, users, now)
    if isinstance(device, Camera):
        admin = "ACTIVE" if device.active else "INACTIVE"
        pairing = "REGISTERED"
        reachable = ((device.last_check or {}).get("connection") or {}).get("ok") if isinstance(device.last_check, dict) else None
        availability = "ONLINE" if reachable is True else "OFFLINE" if reachable is False else "UNKNOWN"
        device_type = "IP_CAMERA"
        extra = {"serial_number": device.serial_number, "usage": device.usage, "role": device.role}
    else:
        admin = "REVOKED" if device.revoked_at else "ACTIVE" if device.enabled else "INACTIVE"
        pairing = "PAIRED" if device.public_key else "PENDING" if row.get("pairing_pending") else "NOT_PAIRED"
        connection = row.get("connection")
        availability = {"ONLINE": "ONLINE", "SILENT": "UNKNOWN"}.get(connection, "OFFLINE")
        device_type = device.terminal_type
        extra = {}
    return {**row, **extra, "location": device.location, "type": device_type, "type_label": TYPE_LABELS.get(device_type, device_type),
            "admin_state": admin, "admin_state_label": ADMIN_STATES[admin],
            "pairing_state": pairing, "pairing_label": PAIRING[pairing],
            "availability": availability, "availability_label": AVAILABILITY[availability],
            "capabilities": _capabilities(device), "facial_authorization": bool(device.facial_attendance_enabled),
            "created_at": pd._iso(device.created_at), "updated_at": pd._iso(getattr(device, "updated_at", None))}


def _rows(db: Session, user: User) -> list[dict[str, Any]]:
    cameras, terminals = pd._admin_devices(db, user)
    sites = pd._site_names(db, cameras + terminals)
    users = pd._authorized_users(db)
    now = datetime.utcnow()
    return [_row(d, sites, users.get(_kind_key(d), []), now) for d in terminals + cameras]


def _matches(row: dict[str, Any], *, society: str | None, site_id: int | None, kind: str | None,
             device_type: str | None, state: str | None, user_id: int | None) -> bool:
    return ((not society or row["society"] == society) and (site_id is None or row["site_id"] == site_id)
            and (not kind or row["kind"] == kind) and (not device_type or row["type"] == device_type)
            and (not state or state in (row["admin_state"], row["availability"], row["status"]))
            and (user_id is None or any(u["id"] == user_id for u in row["users"])))


@router.get("/equipment")
def equipment_list(society: str | None = None, site_id: int | None = None, kind: str | None = None,
                   type: str | None = None, state: str | None = None, user_id: int | None = None,
                   db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Tableau de bord et liste filtrée des équipements du périmètre de l'administrateur."""
    pd.require_system_admin(db, user)
    every = _rows(db, user)
    items = [r for r in every if _matches(r, society=society, site_id=site_id, kind=kind, device_type=type,
                                          state=state, user_id=user_id)]
    count = lambda rows, field, value: sum(r[field] == value for r in rows)  # noqa: E731
    assigned_users = {u["id"]: u for r in every for u in r["users"]}
    return {
        "items": items,
        "dashboard": {
            "total": len(every), "terminals": count(every, "kind", "TERMINAL"), "cameras": count(every, "kind", "CAMERA"),
            **{f"admin_{k.lower()}": count(every, "admin_state", k) for k in ADMIN_STATES},
            **{f"availability_{k.lower()}": count(every, "availability", k) for k in AVAILABILITY},
            "unassigned": sum(not r["users"] for r in every if r["admin_state"] != "REVOKED"),
            "facial_enabled": sum(r["facial_authorization"] for r in every),
        },
        "filters": {
            "societies": sorted({r["society"] for r in every if r["society"]}),
            "sites": sorted({(r["site_id"], r["site"] or "") for r in every}, key=lambda s: s[1].lower()),
            "types": [{"key": k, "label": v} for k, v in TYPE_LABELS.items()],
            "states": [{"key": k, "label": v} for k, v in {**ADMIN_STATES, **AVAILABILITY}.items()],
            "users": sorted(assigned_users.values(), key=lambda u: u["username"].lower()),
        },
        "categories": pd.CATEGORIES,
    }


def _history(db: Session, device: Any, limit: int = 100) -> list[dict[str, Any]]:
    resource = "camera" if isinstance(device, Camera) else "biometric_terminal"
    rows = db.execute(select(AuditEvent).where(AuditEvent.resource == resource, AuditEvent.resource_id == str(device.id))
                      .order_by(AuditEvent.id.desc()).limit(limit)).scalars().all()
    ids: set[int] = set()
    parsed = []
    for row in rows:
        try:
            old = json.loads(row.old_state) if row.old_state else {}
            new = json.loads(row.new_state) if row.new_state else {}
        except ValueError:
            old, new = {}, {}
        old, new = (old if isinstance(old, dict) else {}), (new if isinstance(new, dict) else {})
        before, after = set(old.get("user_ids") or []), set(new.get("user_ids") or [])
        ids |= before | after
        parsed.append((row, new, after - before, before - after))
    names = {u.id: u.username for u in db.execute(select(User).where(User.id.in_(ids or {-1}))).scalars()}
    return [{"at": pd._iso(row.created_at), "action": row.action, "label": HISTORY_LABELS.get(row.action, row.action),
             "result": row.result, "by": row.username,
             "added": sorted(names.get(i, f"#{i}") for i in added), "removed": sorted(names.get(i, f"#{i}") for i in removed),
             "reason": new.get("reason") if isinstance(new.get("reason"), str) else None,
             "changes": sorted(k for k in new if k in ("name", "location", "enabled", "facial_attendance_enabled"))}
            for row, new, added, removed in parsed]


@router.get("/equipment/accounts")
def equipment_accounts(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    """Comptes affectables : actifs, du module Pointeur, avec leurs équipements actuels."""
    pd.require_system_admin(db, user)
    assigned: dict[int, list[str]] = {}
    for terminal_id, camera_id, user_id in db.execute(select(
            FacialDeviceAuthorization.terminal_id, FacialDeviceAuthorization.camera_id, FacialDeviceAuthorization.user_id)):
        assigned.setdefault(user_id, []).append(f"trm:{terminal_id}" if terminal_id is not None else f"cam:{camera_id}")
    rows = db.execute(select(User).where(User.is_active.is_(True)).order_by(User.username)).scalars().all()
    return [{**pd._user_out(u), "societies": list(u.authorized_societies or []) if isinstance(u.authorized_societies, list) else [],
             "site_ids": list(u.authorized_sites or []) if isinstance(u.authorized_sites, list) else [],
             "equipment": sorted(assigned.get(u.id, []))} for u in rows if pd._pointer_capable(u)]


@router.get("/equipment/{key}")
def equipment_detail(key: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    pd.require_system_admin(db, user)
    device = pd._device_by_key(db, user, key)
    row = _row(device, pd._site_names(db, [device]), pd._authorized_users(db).get(key, []), datetime.utcnow())
    return {**row, "history": _history(db, device)}


# ── Affectations ─────────────────────────────────────────────────────────────────────────
class AssignmentIn(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=MAX_KEYS)
    user_ids: list[int] = Field(min_length=1, max_length=MAX_USERS)


class AssignmentChange(AssignmentIn):
    action: Literal["grant", "revoke"]


def _resolve(db: Session, user: User, payload: AssignmentIn) -> tuple[list[Any], dict[int, User]]:
    devices = [pd._device_by_key(db, user, key) for key in dict.fromkeys(payload.keys)]
    wanted = set(payload.user_ids)
    targets = {u.id: u for u in db.execute(select(User).where(User.id.in_(wanted))).scalars()}
    if wanted - set(targets):
        raise HTTPException(422, detail="Utilisateur introuvable")
    return devices, targets


def _current(db: Session, device: Any) -> set[int]:
    column = FacialDeviceAuthorization.camera_id if isinstance(device, Camera) else FacialDeviceAuthorization.terminal_id
    return set(db.execute(select(FacialDeviceAuthorization.user_id).where(column == device.id)).scalars())


def _verdict(db: Session, device: Any, target: User, action: str, current: set[int]) -> str | None:
    """Motif de refus d'une paire compte × équipement, None si l'opération est permise."""
    if action == "revoke":
        return None if target.id in current else "NOT_ASSIGNED"
    if not target.is_active:
        return "ACCOUNT_INACTIVE"
    if pd.is_global_administrator(target):
        return "GLOBAL_ADMIN"
    if not pd._pointer_capable(target):
        return "NOT_POINTER"
    if not isinstance(device, Camera) and device.revoked_at:
        return "DEVICE_REVOKED"
    if not pd._fits(db, target, device):
        return "OUT_OF_SCOPE"
    return "ALREADY_ASSIGNED" if target.id in current else None


def _pairs(db: Session, devices: list[Any], targets: dict[int, User], action: str) -> list[dict[str, Any]]:
    out = []
    for device in devices:
        current = _current(db, device)
        for target in sorted(targets.values(), key=lambda u: u.username.lower()):
            code = _verdict(db, device, target, action, current)
            out.append({"key": _kind_key(device), "device": device.name, "user_id": target.id, "username": target.username,
                        "allowed": code in (None, "ALREADY_ASSIGNED", "NOT_ASSIGNED"), "change": code is None,
                        "code": code, "message": REASONS.get(code, "Autorisé")})
    return out


@router.post("/equipment/assignments/check")
def check_assignments(payload: AssignmentChange, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Vérification préalable (société, site, éligibilité) : rien n'est écrit."""
    pd.require_system_admin(db, user)
    devices, targets = _resolve(db, user, payload)
    pairs = _pairs(db, devices, targets, payload.action)
    return {"pairs": pairs, "allowed": all(p["allowed"] for p in pairs), "changes": sum(p["change"] for p in pairs)}


@router.post("/equipment/assignments")
def change_assignments(payload: AssignmentChange, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Affecte (ou retire) des équipements à des comptes, tout ou rien : une seule paire refusée
    annule l'ensemble. Chaque équipement est verrouillé (ordre stable : pas d'interblocage) et
    relu sous verrou ; deux administrateurs simultanés sont sérialisés."""
    pd.require_system_admin(db, user)
    devices, targets = _resolve(db, user, payload)
    for model in (BiometricTerminal, Camera):
        ids = sorted(d.id for d in devices if isinstance(d, model))
        if ids:
            db.execute(select(model.id).where(model.id.in_(ids)).order_by(model.id).with_for_update()).all()
    db.expire_all()
    devices = [pd._device_by_key(db, user, _kind_key(d)) for d in devices]
    pairs = _pairs(db, devices, targets, payload.action)
    refused = [p for p in pairs if not p["allowed"]]
    if refused:
        db.rollback()
        raise HTTPException(422, detail={"message": "Affectation refusée : aucune modification enregistrée",
                                          "refused": [{k: p[k] for k in ("key", "device", "username", "code", "message")} for p in refused]})
    changed = 0
    for device in devices:
        is_camera = isinstance(device, Camera)
        column = FacialDeviceAuthorization.camera_id if is_camera else FacialDeviceAuthorization.terminal_id
        before = _current(db, device)
        moving = {p["user_id"] for p in pairs if p["key"] == _kind_key(device) and p["change"]}
        if not moving:
            continue
        if payload.action == "grant":
            for user_id in sorted(moving):
                db.add(FacialDeviceAuthorization(user_id=user_id, granted_by=getattr(user, "username", None),
                                                 **({"camera_id": device.id} if is_camera else {"terminal_id": device.id})))
            after = before | moving
        else:
            db.execute(delete(FacialDeviceAuthorization).where(column == device.id, FacialDeviceAuthorization.user_id.in_(moving)))
            after = before - moving
        changed += len(moving)
        append_audit(db, action="biometrics.device.authorizations", resource="camera" if is_camera else "biometric_terminal",
                     resource_id=device.id, result="success", user=user, society=device.society,
                     old_state={"user_ids": sorted(before)},
                     new_state={"user_ids": sorted(after), "via": "equipment", "action": payload.action})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail="Affectations modifiées en parallèle — rechargez la liste") from None
    rows = {r["key"]: r for r in _rows(db, user)}
    return {"changed": changed, "items": [rows[_kind_key(d)] for d in devices if _kind_key(d) in rows]}
