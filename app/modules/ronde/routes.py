"""
Contrôleur de Ronde — API
  /ronde/circuits          → admin (SGDI)
  /ronde/checkpoints       → admin (SGDI)
  /ronde/executions        → guard (portal token) + admin
  /ronde/scans             → guard (portal token)
"""
import math
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.ronde.models import (
    RondeCheckpoint,
    RondeCircuit,
    RondeExecution,
    RondeScan,
)

router = APIRouter()


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ─── helpers ────────────────────────────────────────────────────────────────

def _require_portal(matricule: str, authorization: str | None = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token portail requis")
    try:
        payload = decode_token(authorization.removeprefix("Bearer "))
    except ValueError:
        raise HTTPException(status_code=401, detail="Token invalide")
    if not payload.get("portal"):
        raise HTTPException(status_code=403, detail="Token non autorisé pour le portail")
    if payload.get("sub") != matricule:
        raise HTTPException(status_code=403, detail="Accès refusé")
    return matricule


def _circuit_dict(c: RondeCircuit, with_checkpoints: bool = True) -> dict:
    d: dict[str, Any] = {
        "id": c.id, "name": c.name, "site": c.site, "societe": c.societe,
        "description": c.description, "duree_prevue_min": c.duree_prevue_min,
        "active": c.active,
        "total_checkpoints": len(c.checkpoints),
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }
    if with_checkpoints:
        d["checkpoints"] = [_cp_dict(cp) for cp in c.checkpoints]
    return d


def _active_response(e: RondeExecution, db: Session) -> dict:
    """Build the standardised active-execution response used by all portal endpoints."""
    circuit = db.get(RondeCircuit, e.circuit_id)
    all_cps = list(circuit.checkpoints) if circuit else []
    scanned_ids = {s.checkpoint_id for s in e.scans}
    remaining = [_cp_dict(cp) for cp in all_cps if cp.id not in scanned_ids]
    return {
        "execution": _exec_dict(e, with_scans=True),
        "remaining_checkpoints": remaining,
        "all_checkpoints": [_cp_dict(cp) for cp in all_cps],
    }


def _cp_dict(cp: RondeCheckpoint) -> dict:
    return {
        "id": cp.id, "circuit_id": cp.circuit_id,
        "name": cp.name, "position": cp.position,
        "qr_token": cp.qr_token,
        "gps_lat": cp.gps_lat, "gps_lng": cp.gps_lng,
        "gps_radius_m": cp.gps_radius_m,
        "description": cp.description,
    }


def _exec_dict(e: RondeExecution, with_scans: bool = False) -> dict:
    d: dict[str, Any] = {
        "id": e.id, "circuit_id": e.circuit_id,
        "circuit_name": e.circuit_name,
        "guard_matricule": e.guard_matricule, "guard_name": e.guard_name,
        "site": e.site, "societe": e.societe,
        "started_at": e.started_at.isoformat() if e.started_at else None,
        "ended_at": e.ended_at.isoformat() if e.ended_at else None,
        "statut": e.statut,
        "total_checkpoints": e.total_checkpoints,
        "scanned_checkpoints": e.scanned_checkpoints,
        "taux": round(e.scanned_checkpoints / e.total_checkpoints * 100) if e.total_checkpoints else 0,
        "note": e.note,
    }
    if with_scans:
        d["scans"] = [_scan_dict(s) for s in e.scans]
    return d


def _scan_dict(s: RondeScan) -> dict:
    return {
        "id": s.id, "execution_id": s.execution_id,
        "checkpoint_id": s.checkpoint_id,
        "checkpoint_name": s.checkpoint_name,
        "checkpoint_position": s.checkpoint_position,
        "scanned_at": s.scanned_at.isoformat() if s.scanned_at else None,
        "scan_method": s.scan_method,
        "gps_lat": s.gps_lat, "gps_lng": s.gps_lng,
        "gps_accuracy": s.gps_accuracy,
        "note": s.note,
    }


# ─── CIRCUITS (admin) ────────────────────────────────────────────────────────

@router.get("/circuits")
def list_circuits(
    site: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> list[dict]:
    q = select(RondeCircuit).order_by(RondeCircuit.id.desc())
    if site:
        q = q.where(RondeCircuit.site == site)
    circuits = db.execute(q).scalars().all()
    return [_circuit_dict(c) for c in circuits]


@router.post("/circuits", status_code=201)
def create_circuit(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> dict:
    c = RondeCircuit(
        name=str(payload.get("name", "")).strip() or "Circuit",
        site=payload.get("site") or None,
        societe=payload.get("societe") or None,
        description=payload.get("description") or None,
        duree_prevue_min=int(payload.get("duree_prevue_min") or 60),
        active=bool(payload.get("active", True)),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _circuit_dict(c)


@router.get("/circuits/{circuit_id}")
def get_circuit(
    circuit_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> dict:
    c = db.get(RondeCircuit, circuit_id)
    if not c:
        raise HTTPException(404, "Circuit introuvable")
    return _circuit_dict(c)


@router.put("/circuits/{circuit_id}")
def update_circuit(
    circuit_id: int,
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> dict:
    c = db.get(RondeCircuit, circuit_id)
    if not c:
        raise HTTPException(404, "Circuit introuvable")
    for field in ("name", "site", "societe", "description", "duree_prevue_min", "active"):
        if field in payload:
            setattr(c, field, payload[field])
    db.commit()
    db.refresh(c)
    return _circuit_dict(c)


@router.delete("/circuits/{circuit_id}", status_code=204)
def delete_circuit(
    circuit_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> None:
    c = db.get(RondeCircuit, circuit_id)
    if not c:
        raise HTTPException(404, "Circuit introuvable")
    db.delete(c)
    db.commit()


# ─── CHECKPOINTS (admin) ─────────────────────────────────────────────────────

@router.post("/circuits/{circuit_id}/checkpoints", status_code=201)
def add_checkpoint(
    circuit_id: int,
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> dict:
    c = db.get(RondeCircuit, circuit_id)
    if not c:
        raise HTTPException(404, "Circuit introuvable")
    # Auto-position: next after last
    existing = db.execute(
        select(RondeCheckpoint)
        .where(RondeCheckpoint.circuit_id == circuit_id)
        .order_by(RondeCheckpoint.position.desc())
    ).scalar_one_or_none()
    next_pos = (existing.position + 1) if existing else 1
    cp = RondeCheckpoint(
        circuit_id=circuit_id,
        name=str(payload.get("name", "")).strip() or f"Checkpoint {next_pos}",
        position=int(payload.get("position") or next_pos),
        gps_lat=payload.get("gps_lat"),
        gps_lng=payload.get("gps_lng"),
        gps_radius_m=int(payload.get("gps_radius_m") or 50),
        description=payload.get("description") or None,
    )
    db.add(cp)
    db.commit()
    db.refresh(cp)
    return _cp_dict(cp)


@router.put("/checkpoints/{cp_id}")
def update_checkpoint(
    cp_id: int,
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> dict:
    cp = db.get(RondeCheckpoint, cp_id)
    if not cp:
        raise HTTPException(404, "Checkpoint introuvable")
    for field in ("name", "position", "gps_lat", "gps_lng", "gps_radius_m", "description"):
        if field in payload:
            setattr(cp, field, payload[field])
    db.commit()
    db.refresh(cp)
    return _cp_dict(cp)


@router.delete("/checkpoints/{cp_id}", status_code=204)
def delete_checkpoint(
    cp_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> None:
    cp = db.get(RondeCheckpoint, cp_id)
    if not cp:
        raise HTTPException(404, "Checkpoint introuvable")
    db.delete(cp)
    db.commit()


# ─── CIRCUITS (portail — lecture seule pour gardes) ──────────────────────────

@router.get("/portal/circuits")
def portal_list_circuits(
    matricule: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    _require_portal(matricule, authorization)
    circuits = db.execute(
        select(RondeCircuit).where(RondeCircuit.active == True).order_by(RondeCircuit.name)
    ).scalars().all()
    return {"circuits": [_circuit_dict(c) for c in circuits]}


# ─── EXECUTIONS (portail — gardes) ───────────────────────────────────────────

@router.get("/portal/executions/active")
def portal_get_active(
    matricule: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    _require_portal(matricule, authorization)
    e = db.execute(
        select(RondeExecution)
        .where(
            RondeExecution.guard_matricule == matricule,
            RondeExecution.statut == "en_cours",
        )
        .order_by(RondeExecution.started_at.desc())
    ).scalar_one_or_none()
    if not e:
        return {}
    return _active_response(e, db)


@router.post("/portal/executions/start")
def portal_start_execution(
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    matricule = str(payload.get("matricule") or "")
    _require_portal(matricule, authorization)

    # Prevent duplicate active rounds
    existing = db.execute(
        select(RondeExecution).where(
            RondeExecution.guard_matricule == matricule,
            RondeExecution.statut == "en_cours",
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Une ronde est déjà en cours pour ce garde")

    circuit_id = int(payload.get("circuit_id") or 0)
    circuit = db.get(RondeCircuit, circuit_id)
    if not circuit:
        raise HTTPException(404, "Circuit introuvable")

    e = RondeExecution(
        circuit_id=circuit_id,
        circuit_name=circuit.name,
        guard_matricule=matricule,
        guard_name=str(payload.get("guard_name") or "").strip() or None,
        site=circuit.site,
        societe=circuit.societe,
        started_at=datetime.utcnow(),
        statut="en_cours",
        total_checkpoints=len(circuit.checkpoints),
        scanned_checkpoints=0,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _active_response(e, db)


@router.post("/portal/executions/{execution_id}/scan")
def portal_scan_checkpoint(
    execution_id: int,
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    matricule = str(payload.get("matricule") or "")
    _require_portal(matricule, authorization)

    e = db.get(RondeExecution, execution_id)
    if not e or e.guard_matricule != matricule:
        raise HTTPException(404, "Exécution introuvable")
    if e.statut != "en_cours":
        raise HTTPException(400, "Cette ronde est déjà terminée")

    scan_method = str(payload.get("scan_method") or "qr")
    qr_token = str(payload.get("qr_token") or "").strip()
    gps_lat = payload.get("gps_lat")
    gps_lng = payload.get("gps_lng")

    circuit = db.get(RondeCircuit, e.circuit_id)
    scanned_ids_now = {s.checkpoint_id for s in e.scans}

    if scan_method == "gps" and not qr_token:
        # GPS-only: find next unscanned checkpoint within radius
        if gps_lat is None or gps_lng is None:
            raise HTTPException(400, "Coordonnées GPS requises pour la validation GPS")
        if not circuit:
            raise HTTPException(404, "Circuit introuvable")
        cp = None
        for candidate in circuit.checkpoints:
            if candidate.id in scanned_ids_now:
                continue
            if candidate.gps_lat is None or candidate.gps_lng is None:
                continue
            dist = _haversine_m(float(gps_lat), float(gps_lng), candidate.gps_lat, candidate.gps_lng)
            if dist <= (candidate.gps_radius_m or 50):
                cp = candidate
                break
        if not cp:
            raise HTTPException(400, "Aucun checkpoint GPS à portée. Rapprochez-vous du point de contrôle.")
    else:
        if not qr_token:
            raise HTTPException(400, "qr_token requis")
        cp = db.execute(
            select(RondeCheckpoint).where(RondeCheckpoint.qr_token == qr_token)
        ).scalar_one_or_none()
        if not cp:
            raise HTTPException(404, "QR code non reconnu")
        if cp.circuit_id != e.circuit_id:
            raise HTTPException(400, "Ce checkpoint n'appartient pas au circuit en cours")

    if cp.id in scanned_ids_now:
        raise HTTPException(409, f"Checkpoint « {cp.name} » déjà scanné")

    scan = RondeScan(
        execution_id=execution_id,
        checkpoint_id=cp.id,
        checkpoint_name=cp.name,
        checkpoint_position=cp.position,
        scanned_at=datetime.utcnow(),
        scan_method=scan_method,
        gps_lat=gps_lat,
        gps_lng=gps_lng,
        gps_accuracy=payload.get("gps_accuracy"),
        note=payload.get("note") or None,
    )
    db.add(scan)
    e.scanned_checkpoints = (e.scanned_checkpoints or 0) + 1
    db.commit()
    db.refresh(e)

    res = _active_response(e, db)
    res["last_scan"] = _scan_dict(scan)
    return res


@router.put("/portal/executions/{execution_id}/end")
def portal_end_execution(
    execution_id: int,
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    matricule = str(payload.get("matricule") or "")
    _require_portal(matricule, authorization)

    e = db.get(RondeExecution, execution_id)
    if not e or e.guard_matricule != matricule:
        raise HTTPException(404, "Exécution introuvable")
    if e.statut != "en_cours":
        raise HTTPException(400, "Ronde déjà terminée")

    e.ended_at = datetime.utcnow()
    e.statut = "terminee" if e.scanned_checkpoints >= e.total_checkpoints else "incomplete"
    e.note = payload.get("note") or e.note
    db.commit()
    db.refresh(e)
    return {"execution": _exec_dict(e, with_scans=True)}


# ─── EXECUTIONS (admin) ──────────────────────────────────────────────────────

@router.get("/executions")
def list_executions(
    site: str | None = None,
    matricule: str | None = None,
    statut: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> list[dict]:
    q = select(RondeExecution).order_by(RondeExecution.started_at.desc())
    if site:
        q = q.where(RondeExecution.site == site)
    if matricule:
        q = q.where(RondeExecution.guard_matricule == matricule)
    if statut:
        q = q.where(RondeExecution.statut == statut)
    execs = db.execute(q.limit(200)).scalars().all()
    return [_exec_dict(e, with_scans=False) for e in execs]


@router.get("/executions/{execution_id}")
def get_execution(
    execution_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> dict:
    e = db.get(RondeExecution, execution_id)
    if not e:
        raise HTTPException(404, "Exécution introuvable")
    return _exec_dict(e, with_scans=True)
