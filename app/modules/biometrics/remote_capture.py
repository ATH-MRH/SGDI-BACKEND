"""Prise de photo distante supervisée — LOT C1.

DRH → Fiche de position → « Prendre la photo » : un opérateur RH autorisé réserve, pour
quelques dizaines de secondes, un terminal de pointage (tablette ou smartphone) comme caméra.

    PC DRH ──(session utilisateur)──► serveur ◄──(requêtes SIGNÉES du terminal)── terminal

- Le PC ne parle jamais au terminal : il crée une SESSION ; le terminal l'apprend en
  interrogeant le serveur (polling signé court — aucun canal poussé n'existe, et les workers
  ne partagent pas de mémoire). Ce même appel sert de battement de cœur (« En ligne »).
- Aucun flux vidéo : la vidéo reste sur le terminal ; le serveur ne reçoit que des photos
  fixes proposées par le terminal, et le PC seulement LA photo candidate retenue.
- La photo candidate n'est jamais écrite comme photo DRH : elle vit chiffrée dans la session,
  est remise à l'opérateur qui choisit « Utiliser cette photo », puis effacée. C'est
  l'enregistrement de la fiche qui la conserve et déclenche la synchronisation (LOT B).
- Toute transition est validée ici, côté serveur ; une session est liée à un employé, un
  terminal et un opérateur, expire seule, et libère toujours le terminal (expiration, PC
  disparu, terminal muet).

Réglage serveur DRH_REMOTE_PHOTO_CAPTURE_ENABLED (FAUX par défaut). Indépendant de
BIOMETRIC_ENABLED : aucune reconnaissance, aucun pointage, aucun gabarit n'est créé ici.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.audit import append_audit
from app.core.config import settings
from app.db.session import get_db
from app.modules.biometrics import crypto, service, terminals, test_mode
from app.modules.biometrics.engine import EngineUnavailable, get_engine
from app.modules.biometrics.models import (
    CAPTURE_ACCEPTED,
    CAPTURE_ACTIVE,
    CAPTURE_CANCELLED,
    CAPTURE_EXPIRED,
    CAPTURE_FAILED,
    CAPTURE_PREVIEW_READY,
    CAPTURE_REQUESTED,
    CAPTURE_RETAKE_REQUESTED,
    CAPTURE_WAITING_FOR_FACE,
    MOBILE_TERMINAL_TYPES,
    BiometricRemoteCaptureSession,
    BiometricTerminal,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site

router = APIRouter()

SESSION_TTL_SECONDS = 120          # durée d'une prise (et de chaque reprise)
PREVIEW_TTL_SECONDS = 90           # temps laissé à l'opérateur pour décider
ACK_TIMEOUT_SECONDS = 15           # terminal muet : la commande échoue vite
OPERATOR_TIMEOUT_SECONDS = 20      # PC disparu (fiche fermée, navigateur planté, réseau)
ONLINE_SECONDS = 20                # « En ligne » : vu depuis moins de 20 s
LAST_SEEN_STEP = timedelta(seconds=10)
MAX_RETAKES = 5
IDLE_POLL_MS = 2000                # terminal au repos : « ai-je une commande ? »
ACTIVE_POLL_MS = 1000              # pendant une prise
MAX_SUBMISSIONS_PER_MINUTE = 40    # photos fixes proposées par un terminal
MAX_STARTS_PER_MINUTE = 10         # demandes par opérateur
CAPTURE = {"max_side": 1000, "jpeg_quality": 0.9, "min_interval_ms": 1500}
RETENTION = timedelta(days=30)     # lignes closes (sans photo) conservées pour la traçabilité
ACCEPTED_SOURCE_WINDOW = timedelta(hours=24)

TERMINAL_TYPE_LABELS = {"TABLET_ANDROID": "Tablette", "SMARTPHONE_ANDROID": "Smartphone", "IPHONE": "Smartphone", "IPAD": "Tablette"}
MESSAGES = {
    CAPTURE_REQUESTED: "Commande envoyée au terminal…",
    CAPTURE_WAITING_FOR_FACE: "Le terminal attend que le salarié se place devant la caméra.",
    CAPTURE_PREVIEW_READY: "Photo prise. Vérifiez-la avant de l'utiliser.",
    CAPTURE_RETAKE_REQUESTED: "Nouvelle prise demandée au terminal…",
    CAPTURE_ACCEPTED: "Photo retenue.",
    CAPTURE_CANCELLED: "Prise de photo annulée.",
    CAPTURE_EXPIRED: "La prise de photo a expiré. Le terminal est revenu au pointage.",
    CAPTURE_FAILED: "La prise de photo a échoué.",
}
REASONS = {
    "TERMINAL_UNREACHABLE": "Le terminal ne répond pas. Vérifiez qu'il est allumé et connecté.",
    "TERMINAL_DISABLED": "Le terminal a été désactivé ou révoqué.",
    "OPERATOR_GONE": "La fenêtre de prise de photo a été fermée.",
    "SUPERSEDED": "Une nouvelle prise a été demandée.",
}
# Consignes affichées sur le terminal (jamais de score).
INSTRUCTIONS = {
    "NO_FACE": "Regardez la caméra",
    "MULTIPLE_FACES": "Une seule personne devant la caméra",
    "TOO_SMALL": "Approchez-vous",
    "BLURRED": "Restez immobile",
    "QUALITY_FAILED": "Placez-vous face à la caméra, bien éclairé",
    "INVALID_IMAGE": "Restez immobile",
}


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message})


def _now() -> datetime:
    return datetime.utcnow()


def enabled() -> bool:
    return bool(settings.drh_remote_photo_capture_enabled) and service.key_configured()


def _ensure_enabled() -> None:
    if not enabled():
        raise _error(503, "REMOTE_CAPTURE_DISABLED", "Prise de photo distante non activée sur ce serveur")


def online(terminal: BiometricTerminal, now: datetime | None = None) -> bool:
    return bool(terminal.last_seen_at and (now or _now()) - terminal.last_seen_at <= timedelta(seconds=ONLINE_SECONDS))


def _usable(terminal: BiometricTerminal) -> bool:
    """Terminal compatible caméra, associé, actif, non révoqué (aucun code propre à un modèle)."""
    return bool(terminal.terminal_type in MOBILE_TERMINAL_TYPES and terminal.enabled and not terminal.revoked_at and terminal.public_key)


def _in_scope(terminal: BiometricTerminal, employee: Employee) -> bool:
    """Règle de périmètre : le terminal appartient à la MÊME SOCIÉTÉ que l'employé. Le périmètre
    DRH est défini par société (pas par site) : aucun filtre de site n'est ajouté, le site ne
    sert qu'à ordonner la liste (site d'affectation de l'employé en premier)."""
    return service._society_key(terminal.society) == service._society_key(employee.society) != ""


# ── Audit (jamais d'image, de gabarit, de clé ni de jeton) ────────────────────────────────
def _audit(db: Session, event: str, row: BiometricRemoteCaptureSession, *, actor: Any = None, reason: str | None = None) -> None:
    append_audit(db, action=f"drh.remote_photo.{event}", resource="employee", resource_id=row.employee_id,
                 result="success" if event in ("requested", "acknowledged", "captured", "retake", "accepted") else "failure",
                 user=actor, society=row.society,
                 new_state={"user_id": row.requested_by_user_id, "employee_id": row.employee_id, "terminal_id": row.terminal_id,
                            "site_id": row.site_id, "session": row.public_id[:12], "status": row.status,
                            "reason": reason or row.reason_code, "attempt": row.attempt})


# ── Cycle de vie ──────────────────────────────────────────────────────────────────────────
def _close(db: Session, row: BiometricRemoteCaptureSession, status: str, reason: str | None, *, actor: Any = None) -> None:
    row.status, row.reason_code, row.closed_at = status, reason, _now()
    row.photo_encrypted = None                     # la photo candidate ne survit jamais à la session
    row.nonce_hash = None
    row.active_terminal_id = row.active_employee_id = None
    db.flush()
    _audit(db, {CAPTURE_ACCEPTED: "accepted", CAPTURE_CANCELLED: "cancelled", CAPTURE_EXPIRED: "expired", CAPTURE_FAILED: "failed"}[status],
           row, actor=actor)


def _settle(db: Session, row: BiometricRemoteCaptureSession, terminal: BiometricTerminal | None = None) -> bool:
    """Applique les échéances à une session active. Renvoie True si elle vient d'être close."""
    if row.status not in CAPTURE_ACTIVE:
        return False
    now = _now()
    terminal = terminal or db.get(BiometricTerminal, row.terminal_id)
    if terminal is None or not _usable(terminal):
        _close(db, row, CAPTURE_FAILED, "TERMINAL_DISABLED")
    elif now >= row.expires_at:
        _close(db, row, CAPTURE_EXPIRED, "TTL")
    elif row.operator_seen_at and now - row.operator_seen_at > timedelta(seconds=OPERATOR_TIMEOUT_SECONDS):
        _close(db, row, CAPTURE_CANCELLED, "OPERATOR_GONE")
    elif row.status in (CAPTURE_REQUESTED, CAPTURE_RETAKE_REQUESTED) and now - row.command_at > timedelta(seconds=ACK_TIMEOUT_SECONDS):
        _close(db, row, CAPTURE_FAILED, "TERMINAL_UNREACHABLE")
    else:
        return False
    return True


def _locked(db: Session, *conditions: Any) -> BiometricRemoteCaptureSession | None:
    return db.execute(select(BiometricRemoteCaptureSession).where(*conditions).with_for_update()).scalar_one_or_none()


def _purge(db: Session) -> None:
    """Aucune photo candidate ne reste après l'échéance ; les vieilles lignes closes disparaissent."""
    now = _now()
    db.execute(update(BiometricRemoteCaptureSession)
               .where(BiometricRemoteCaptureSession.photo_encrypted.is_not(None), BiometricRemoteCaptureSession.expires_at < now)
               .values(photo_encrypted=None))
    db.execute(delete(BiometricRemoteCaptureSession)
               .where(BiometricRemoteCaptureSession.closed_at.is_not(None), BiometricRemoteCaptureSession.closed_at < now - RETENTION))


# ── Côté opérateur RH (appelé par les routes DRH, après leurs contrôles de périmètre) ─────
def terminals_for(db: Session, employee: Employee) -> dict[str, Any]:
    if not enabled():
        return {"enabled": False, "terminals": []}
    now = _now()
    today = now.date()
    employee_sites = set(db.execute(select(Assignment.site_id).where(
        Assignment.employee_id == employee.id, Assignment.active == 1, Assignment.start_date <= today,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= today))).scalars())
    rows = [t for t in db.execute(select(BiometricTerminal).where(
        BiometricTerminal.terminal_type.in_(MOBILE_TERMINAL_TYPES), BiometricTerminal.enabled.is_(True),
        BiometricTerminal.revoked_at.is_(None))).scalars() if _usable(t) and _in_scope(t, employee)]
    sites = {s.id: s.name for s in db.execute(select(Site).where(Site.id.in_({t.site_id for t in rows}))).scalars()} if rows else {}
    busy = set(db.execute(select(BiometricRemoteCaptureSession.active_terminal_id).where(
        BiometricRemoteCaptureSession.active_terminal_id.is_not(None), BiometricRemoteCaptureSession.expires_at > now)).scalars())
    out = [{"id": t.id, "name": t.name, "type": TERMINAL_TYPE_LABELS.get(t.terminal_type, "Terminal"), "site": sites.get(t.site_id),
            "location": t.location, "online": online(t, now), "busy": t.id in busy,
            "last_seen_at": t.last_seen_at.isoformat() + "Z" if t.last_seen_at else None,
            "employee_site": t.site_id in employee_sites} for t in rows]
    out.sort(key=lambda t: (not t["employee_site"], not t["online"], t["site"] or "", t["name"]))
    return {"enabled": True, "terminals": out}


def start(db: Session, *, employee: Employee, terminal_id: Any, user: Any) -> dict[str, Any]:
    _ensure_enabled()
    limiter = f"remote-photo-start:{getattr(user, 'id', None)}"
    if rate_limit.failure_count(limiter, 60) >= MAX_STARTS_PER_MINUTE:
        raise _error(429, "RATE_LIMITED", "Trop de demandes — patientez une minute")
    rate_limit.record_failure(limiter, 60)
    try:
        terminal = db.get(BiometricTerminal, int(terminal_id))
    except (TypeError, ValueError):
        terminal = None
    if terminal is None or not _usable(terminal) or not _in_scope(terminal, employee):
        raise _error(404, "TERMINAL_NOT_FOUND", "Terminal introuvable ou non autorisé pour cet employé")
    if not online(terminal):
        raise _error(409, "TERMINAL_OFFLINE", "Terminal hors ligne : aucune commande envoyée")
    # Sessions restées actives sur ce terminal ou pour cet employé : échéances appliquées ; une
    # session du MÊME opérateur est remplacée, celle d'un autre opérateur bloque (pas d'écrasement).
    for stale in db.execute(select(BiometricRemoteCaptureSession).where(
            (BiometricRemoteCaptureSession.active_terminal_id == terminal.id) |
            (BiometricRemoteCaptureSession.active_employee_id == employee.id)).with_for_update()).scalars().all():
        if not _settle(db, stale) and stale.requested_by_user_id == getattr(user, "id", None):
            _close(db, stale, CAPTURE_CANCELLED, "SUPERSEDED", actor=user)
    _purge(db)
    db.flush()
    now = _now()
    row = BiometricRemoteCaptureSession(
        public_id=secrets.token_urlsafe(32), employee_id=employee.id, terminal_id=terminal.id,
        requested_by_user_id=getattr(user, "id", None), requested_by=getattr(user, "username", None),
        society=employee.society, site_id=terminal.site_id, status=CAPTURE_REQUESTED, attempt=0,
        active_terminal_id=terminal.id, active_employee_id=employee.id,
        expires_at=now + timedelta(seconds=SESSION_TTL_SECONDS), command_at=now, operator_seen_at=now)
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        db.commit()                                      # conserve les clôtures d'échéance ci-dessus
        busy_terminal = db.execute(select(BiometricRemoteCaptureSession.id).where(
            BiometricRemoteCaptureSession.active_terminal_id == terminal.id)).first()
        if busy_terminal:
            raise _error(409, "TERMINAL_BUSY", "Terminal déjà utilisé pour une prise de photo.") from None
        raise _error(409, "EMPLOYEE_BUSY", "Une prise de photo est déjà en cours pour cet employé.") from None
    _audit(db, "requested", row, actor=user)
    db.commit()
    return _out(row, terminal, db)


def mime(image: bytes) -> str:
    return "image/" + test_mode.sniff_image(image)[0]


def _owned(db: Session, session_id: str, user: Any) -> BiometricRemoteCaptureSession:
    """La session n'est visible que de l'opérateur qui l'a créée."""
    row = _locked(db, BiometricRemoteCaptureSession.public_id == str(session_id or ""))
    if row is None or row.requested_by_user_id != getattr(user, "id", None):
        db.rollback()
        raise _error(404, "SESSION_NOT_FOUND", "Session de prise de photo introuvable")
    return row


def status(db: Session, *, session_id: str, user: Any) -> dict[str, Any]:
    row = _owned(db, session_id, user)
    if not _settle(db, row) and row.status in CAPTURE_ACTIVE:
        row.operator_seen_at = _now()                    # signe de vie du PC
    db.commit()
    return _out(row, db.get(BiometricTerminal, row.terminal_id), db)


def preview(db: Session, *, session_id: str, user: Any) -> bytes:
    row = _owned(db, session_id, user)
    closed = _settle(db, row)
    data = None if closed or row.status != CAPTURE_PREVIEW_READY or not row.photo_encrypted else crypto.decrypt_bytes(row.photo_encrypted)
    db.commit()
    if data is None:
        raise _error(409, "NO_PREVIEW", "Aucune photo à afficher pour cette session")
    return data


def decide(db: Session, *, session_id: str, action: str, user: Any) -> dict[str, Any]:
    """Décisions de l'opérateur : retake | accept | cancel. Toute autre transition est refusée."""
    if action not in ("retake", "accept", "cancel"):
        raise _error(422, "INVALID_ACTION", "Action inconnue")
    row = _owned(db, session_id, user)
    terminal = db.get(BiometricTerminal, row.terminal_id)
    closed = _settle(db, row, terminal)
    photo = None
    if action == "cancel":
        if not closed and row.status in CAPTURE_ACTIVE:
            _close(db, row, CAPTURE_CANCELLED, "OPERATOR", actor=user)
    elif closed or row.status != CAPTURE_PREVIEW_READY or not row.photo_encrypted:
        db.commit()
        raise _error(409, "INVALID_TRANSITION", "Cette action n'est pas possible dans l'état actuel de la prise de photo")
    elif action == "retake":
        if row.attempt >= MAX_RETAKES:
            db.commit()
            raise _error(409, "TOO_MANY_RETAKES", "Nombre maximal de reprises atteint — recommencez une prise de photo")
        now = _now()
        row.status, row.attempt = CAPTURE_RETAKE_REQUESTED, row.attempt + 1
        row.photo_encrypted = row.photo_sha256 = row.checks = row.nonce_hash = None
        row.command_at = row.operator_seen_at = now
        row.expires_at = now + timedelta(seconds=SESSION_TTL_SECONDS)
        db.flush()
        _audit(db, "retake", row, actor=user)
    else:
        image = crypto.decrypt_bytes(row.photo_encrypted)
        photo = f"data:{mime(image)};base64," + base64.b64encode(image).decode()
        _close(db, row, CAPTURE_ACCEPTED, None, actor=user)   # efface la candidate, garde son empreinte
    db.commit()
    out = _out(row, terminal, db)
    if photo:
        out["photo"] = photo
    return out


def _out(row: BiometricRemoteCaptureSession, terminal: BiometricTerminal | None, db: Session) -> dict[str, Any]:
    site = db.get(Site, terminal.site_id) if terminal else None
    message = REASONS.get(row.reason_code or "") if row.status not in CAPTURE_ACTIVE and row.status != CAPTURE_ACCEPTED else None
    return {"session_id": row.public_id, "status": row.status, "active": row.status in CAPTURE_ACTIVE, "reason": row.reason_code,
            "message": message or MESSAGES.get(row.status, ""), "attempt": row.attempt,
            "expires_in": max(0, int((row.expires_at - _now()).total_seconds())) if row.status in CAPTURE_ACTIVE else 0,
            "preview": row.status == CAPTURE_PREVIEW_READY, "checks": row.checks if row.status == CAPTURE_PREVIEW_READY else None,
            "terminal": {"name": terminal.name if terminal else None, "site": site.name if site else None,
                         "type": TERMINAL_TYPE_LABELS.get(terminal.terminal_type, "Terminal") if terminal else None}}


def accepted_photo(db: Session, employee_id: int, fingerprint: str | None) -> bool:
    """La photo de cette empreinte a-t-elle bien été retenue lors d'une prise distante récente
    pour cet employé ? (La provenance déclarée par la fiche n'est jamais crue sur parole.)"""
    if not fingerprint:
        return False
    return db.execute(select(BiometricRemoteCaptureSession.id).where(
        BiometricRemoteCaptureSession.employee_id == employee_id, BiometricRemoteCaptureSession.status == CAPTURE_ACCEPTED,
        BiometricRemoteCaptureSession.photo_sha256 == fingerprint,
        BiometricRemoteCaptureSession.closed_at >= _now() - ACCEPTED_SOURCE_WINDOW).limit(1)).first() is not None


# ── Côté terminal (requêtes signées — aucune session utilisateur) ─────────────────────────
def session_info() -> dict[str, Any]:
    return {"enabled": enabled(), "poll_ms": IDLE_POLL_MS}


def _terminal_session(db: Session, terminal: BiometricTerminal, session_id: Any = None) -> BiometricRemoteCaptureSession | None:
    conditions = [BiometricRemoteCaptureSession.active_terminal_id == terminal.id]
    if session_id is not None:
        conditions.append(BiometricRemoteCaptureSession.public_id == str(session_id))
    row = _locked(db, *conditions)
    if row is not None and _settle(db, row, terminal):
        db.commit()
        return None
    return row


def reserved(db: Session, terminal: BiometricTerminal) -> bool:
    """Le terminal est-il réservé à une prise de photo (commande déjà prise en compte) ? Tant
    qu'il l'est, il ne reconnaît personne et n'enregistre aucun pointage."""
    if not enabled():
        return False
    row = _terminal_session(db, terminal)
    return row is not None and row.status != CAPTURE_REQUESTED


def ensure_not_capturing(db: Session, terminal: BiometricTerminal) -> None:
    if reserved(db, terminal):
        raise _error(409, "CAPTURE_IN_PROGRESS", "Prise de photo en cours sur ce terminal")


def _command(row: BiometricRemoteCaptureSession, db: Session) -> dict[str, Any]:
    employee = db.get(Employee, row.employee_id)
    return {"command": "CAPTURE_PHOTO", "session_id": row.public_id, "status": row.status, "attempt": row.attempt,
            # Le strict nécessaire pour que la bonne personne se présente : nom et prénom.
            "employee": {"nom": employee.last_name if employee else "", "prenom": employee.first_name if employee else ""},
            "expires_in": max(0, int((row.expires_at - _now()).total_seconds())), "capture": CAPTURE, "poll_ms": ACTIVE_POLL_MS}


@router.get("/terminal/command")
def terminal_command(req: terminals.TerminalRequest = Depends(terminals.authenticated_terminal), db: Session = Depends(get_db)) -> dict[str, Any]:
    """« Ai-je une commande ? » — interrogation courte et signée ; sert aussi de battement de cœur."""
    terminal = req.terminal
    if not enabled():
        return {"command": None, "enabled": False, "poll_ms": IDLE_POLL_MS}
    now = _now()
    if not terminal.last_seen_at or now - terminal.last_seen_at > LAST_SEEN_STEP:
        terminal.last_seen_at = now
        db.commit()
    row = _terminal_session(db, terminal)
    out = _command(row, db) if row is not None else {"command": None, "poll_ms": IDLE_POLL_MS}
    db.commit()
    return {**out, "enabled": True}


@router.post("/terminal/capture/ack")
def terminal_capture_ack(req: terminals.TerminalRequest = Depends(terminals.authenticated_terminal), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Le terminal passe en mode « prise de photo » : il reçoit un jeton de capture à usage unique.
    Idempotent (terminal rechargé pendant une session) : un nouveau jeton remplace l'ancien."""
    _ensure_enabled()
    terminal = req.terminal
    row = _terminal_session(db, terminal, req.body.get("session_id"))
    if row is None:
        raise _error(409, "SESSION_CLOSED", "Aucune prise de photo en cours pour ce terminal")
    if row.status not in (CAPTURE_REQUESTED, CAPTURE_RETAKE_REQUESTED, CAPTURE_WAITING_FOR_FACE):
        db.commit()
        raise _error(409, "INVALID_TRANSITION", "Photo déjà prise : en attente de l'opérateur")
    first = row.status != CAPTURE_WAITING_FOR_FACE
    nonce = secrets.token_urlsafe(32)
    row.status, row.nonce_hash = CAPTURE_WAITING_FOR_FACE, hashlib.sha256(nonce.encode()).hexdigest()
    if first:
        row.acknowledged_at = _now()
        db.flush()
        _audit(db, "acknowledged", row, actor=terminals.TerminalActor(terminal))
    db.commit()
    return {**_command(row, db), "nonce": nonce}


def _instruction(decision: Any) -> tuple[str, str]:
    code = decision.state
    if code == "QUALITY_FAILED":
        text = " ".join(decision.reasons or [])
        code = "TOO_SMALL" if "trop petit" in text else "BLURRED" if "floue" in text else "QUALITY_FAILED"
    return code, INSTRUCTIONS.get(code, INSTRUCTIONS["QUALITY_FAILED"])


@router.post("/terminal/capture/photo")
def terminal_capture_photo(req: terminals.TerminalRequest = Depends(terminals.authenticated_terminal), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Photo fixe proposée par le terminal. Acceptée seulement pour LA session en attente de ce
    terminal, avec le jeton de capture en cours (usage unique), avant expiration. Une photo
    non exploitable n'est pas conservée : le terminal reçoit une consigne et un nouveau jeton."""
    _ensure_enabled()
    terminal, body = req.terminal, req.body
    limiter = f"remote-photo-submit:{terminal.id}"
    if rate_limit.failure_count(limiter, 60) >= MAX_SUBMISSIONS_PER_MINUTE:
        raise _error(429, "RATE_LIMITED", "Trop de photos — patientez")
    rate_limit.record_failure(limiter, 60)
    row = _terminal_session(db, terminal, body.get("session_id"))
    if row is None:
        raise _error(409, "SESSION_CLOSED", "Aucune prise de photo en cours pour ce terminal")
    presented = hashlib.sha256(str(body.get("nonce") or "").encode()).hexdigest()
    if row.status != CAPTURE_WAITING_FOR_FACE or not row.nonce_hash or not hmac.compare_digest(presented, row.nonce_hash):
        db.commit()
        raise _error(409, "CAPTURE_NOT_EXPECTED", "Photo non attendue pour cette session")
    nonce = secrets.token_urlsafe(32)                      # le jeton présenté est consommé dans tous les cas
    row.nonce_hash = hashlib.sha256(nonce.encode()).hexdigest()
    try:
        image = test_mode.decode_frames([body.get("photo")])[0]      # format, taille et dimensions contrôlés
    except HTTPException:
        db.commit()
        return {"accepted": False, "state": "INVALID_IMAGE", "instruction": INSTRUCTIONS["INVALID_IMAGE"], "nonce": nonce}
    checks: dict[str, Any] | None = None
    if service.enrollment_enabled():
        try:
            decision = service.analyze_frames(get_engine(), [image], test_mode.readonly_config(db), require_liveness=False)
        except EngineUnavailable:
            decision = None
        if decision is not None:
            if decision.state != "OK":
                code, instruction = _instruction(decision)
                db.commit()
                return {"accepted": False, "state": code, "instruction": instruction, "nonce": nonce}
            checks = {"face": True, "quality": True}
    now = _now()
    row.photo_encrypted = crypto.encrypt_bytes(image)
    row.photo_sha256 = hashlib.sha256(image).hexdigest()
    row.checks = checks
    row.status, row.nonce_hash, row.captured_at = CAPTURE_PREVIEW_READY, None, now
    row.expires_at = now + timedelta(seconds=PREVIEW_TTL_SECONDS)
    db.flush()
    _audit(db, "captured", row, actor=terminals.TerminalActor(terminal))
    db.commit()
    return {"accepted": True, "state": "CAPTURED", "instruction": "Photo prise", "nonce": None}
