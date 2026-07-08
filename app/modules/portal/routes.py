import math
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.config import settings
from app.core.security import create_access_token, decode_token, hash_password, verify_password
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.irongs import service
from app.modules.irongs.sql_bridge import employee_by_ref, upsert_presence
from app.modules.ops.models import Assignment, DailyPresence, Site


router = APIRouter()

PORTAL_TOKEN_TTL = 60 * 24  # 24 heures


def _ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _limit_public(request: Request, name: str, maxn: int) -> None:
    """Anti-abus sur les endpoints publics du portail (par IP, fenêtre glissante)."""
    key = f"portal:{name}:{_ip(request)}"
    if rate_limit.record_failure(key, settings.login_window_seconds) > maxn:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives. Réessayez dans quelques minutes.",
            headers={"Retry-After": str(settings.login_window_seconds)},
        )


def _require_portal_token(matricule: str, authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token portail requis")
    try:
        payload = decode_token(authorization.removeprefix("Bearer "))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token portail invalide")
    if not payload.get("portal"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token non autorisé pour le portail")
    if payload.get("sub") != matricule:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé")
    return matricule


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _norm_text(value: Any) -> str:
    raw = unicodedata.normalize("NFKD", _clean_text(value))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", raw).casefold().strip()


def _norm_date(value: Any) -> str:
    raw = _clean_text(value)
    if not raw:
        return ""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return raw[:10]


def _agent_field(agent: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = agent.get(key)
        if value not in (None, ""):
            return _clean_text(value)
    return ""


def _agent_site(agent: dict[str, Any]) -> str:
    affectation = agent.get("affectationCourante")
    if isinstance(affectation, dict):
        return _agent_field(affectation, "siteName", "site", "nom")
    return _agent_field(agent, "site", "siteName", "affectation")


def _agent_matches_signup(agent: dict[str, Any], payload: dict[str, Any]) -> bool:
    return all(
        (
            _norm_text(_agent_field(agent, "nom")) == _norm_text(payload.get("nom")),
            _norm_text(_agent_field(agent, "prenom", "prénom")) == _norm_text(payload.get("prenom")),
            _norm_text(_agent_field(agent, "matricule", "code")) == _norm_text(payload.get("code")),
            _norm_date(_agent_field(agent, "dateNaissance", "birth_date", "birthDate")) == _norm_date(payload.get("dateNaissance")),
        )
    )


def _to_demande(payload: dict[str, Any]) -> dict[str, Any]:
    ref = _clean_text(payload.get("ref"))
    employee = payload.get("employee") if isinstance(payload.get("employee"), dict) else {}
    details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
    type_label = _clean_text(payload.get("typeLabel") or payload.get("type") or "Demande")
    message = "\n".join(f"{k}: {v}" for k, v in details.items() if v)
    full_name = " ".join(
        part for part in [_clean_text(employee.get("nom")), _clean_text(employee.get("prenom"))] if part
    ).strip()
    return {
        "id": ref or None,
        "ref": ref,
        "date": _clean_text(payload.get("createdAt"))[:10],
        "createdAt": _clean_text(payload.get("createdAt")),
        "createdBy": "portail-rh",
        "agentId": "",
        "agentName": full_name,
        "matricule": _clean_text(employee.get("matricule")),
        "societe": _clean_text(employee.get("societe")),
        "site": _clean_text(employee.get("site")),
        "type": type_label,
        "categorie": type_label,
        "urgence": "normale",
        "objet": type_label,
        "message": message or _clean_text(payload.get("message")),
        "statut": "nouveau",
        "pieces": [],
        "documentsDemandes": [],
        "source": "portail-rh-bilingue",
        "historique": [
            {
                "date": _clean_text(payload.get("createdAt")),
                "user": "portail-rh",
                "action": "Création",
                "note": "Demande envoyée depuis le portail RH mobile",
            }
        ],
        "payloadOriginal": payload,
    }


def _to_pointage(payload: dict[str, Any]) -> dict[str, Any]:
    employee = payload.get("employee") if isinstance(payload.get("employee"), dict) else {}
    ref = _clean_text(payload.get("ref"))
    action = _clean_text(payload.get("action") or "arrivee")
    full_name = " ".join(
        part for part in [_clean_text(employee.get("nom")), _clean_text(employee.get("prenom"))] if part
    ).strip()
    return {
        "id": ref or None,
        "ref": ref,
        "date": _clean_text(payload.get("date")) or _clean_text(payload.get("createdAt"))[:10],
        "heure": _clean_text(payload.get("heure")),
        "createdAt": _clean_text(payload.get("createdAt")),
        "createdBy": "portail-rh",
        "action": action,
        "agentName": full_name,
        "matricule": _clean_text(employee.get("matricule") or employee.get("code")),
        "societe": _clean_text(employee.get("societe")),
        "site": _clean_text(employee.get("site")),
        "statut": "valide",
        "source": "portail-rh-bilingue",
        "position": payload.get("position") if isinstance(payload.get("position"), dict) else {},
        "note": _clean_text(payload.get("note")),
        "payloadOriginal": payload,
    }


@router.post("/validate-employee")
def validate_employee(payload: dict[str, Any], request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _limit_public(request, "validate", 15)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload invalide")

    required = ("nom", "prenom", "code", "dateNaissance")
    if any(not _clean_text(payload.get(key)) for key in required):
        raise HTTPException(status_code=400, detail="Nom, prénom, code et date de naissance obligatoires")

    agents = service.list_items(db, "agents")
    for agent in agents:
        if not isinstance(agent, dict) or not _agent_matches_signup(agent, payload):
            continue
        matricule = _agent_field(agent, "matricule", "code")
        portal_token = create_access_token(
            subject=matricule,
            claims={"portal": True},
            ttl_minutes=PORTAL_TOKEN_TTL,
        )
        return {
            "verified": True,
            "portal_token": portal_token,
            "employee": {
                "id": _agent_field(agent, "id"),
                "nom": _agent_field(agent, "nom"),
                "prenom": _agent_field(agent, "prenom", "prénom"),
                "code": matricule,
                "matricule": matricule,
                "statut": _agent_field(agent, "statut", "status"),
                "societe": _agent_field(agent, "societe"),
                "site": _agent_site(agent),
                "poste": _agent_field(agent, "fonction", "poste"),
                "departement": _agent_field(agent, "departement", "service"),
            },
        }

    # Try to find agent by code only to give a more specific error
    code_norm = _norm_text(payload.get("code"))
    candidate = next(
        (a for a in agents if isinstance(a, dict) and _norm_text(_agent_field(a, "matricule", "code")) == code_norm),
        None,
    )
    if candidate is not None:
        mismatches = []
        if _norm_text(_agent_field(candidate, "nom")) != _norm_text(payload.get("nom")):
            mismatches.append("nom")
        if _norm_text(_agent_field(candidate, "prenom", "prénom")) != _norm_text(payload.get("prenom")):
            mismatches.append("prénom")
        if _norm_date(_agent_field(candidate, "dateNaissance", "birth_date", "birthDate")) != _norm_date(payload.get("dateNaissance")):
            mismatches.append("date de naissance")
        if mismatches:
            raise HTTPException(
                status_code=403,
                detail=f"Code trouvé mais champ(s) incorrect(s) : {', '.join(mismatches)}",
            )

    raise HTTPException(
        status_code=403,
        detail="Aucun employé ne correspond exactement au nom, prénom, code et date de naissance saisis",
    )


@router.post("/self-register", status_code=status.HTTP_201_CREATED)
def portal_self_register(payload: dict[str, Any], request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _limit_public(request, "register", 8)
    required = ("nom", "prenom", "code", "dateNaissance", "password")
    if any(not _clean_text(payload.get(k)) for k in required):
        raise HTTPException(status_code=400, detail="Tous les champs sont obligatoires")
    password = _clean_text(payload.get("password"))
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Mot de passe trop court (minimum 6 caractères)")

    agents = service.list_items(db, "agents")
    agent = next((a for a in agents if isinstance(a, dict) and _agent_matches_signup(a, payload)), None)
    if not agent:
        raise HTTPException(status_code=403, detail="Aucun employé ne correspond aux informations saisies")

    matricule = _agent_field(agent, "matricule", "code")
    if _find_portal_account(db, matricule):
        raise HTTPException(status_code=409, detail="Un compte portail existe déjà pour cet employé")

    account: dict[str, Any] = {
        "id": _norm_text(matricule),
        "username": _norm_text(matricule),
        "matricule": matricule,
        "passwordHash": hash_password(password),
        "nom": _agent_field(agent, "nom"),
        "prenom": _agent_field(agent, "prenom", "prénom"),
        "societe": _agent_field(agent, "societe"),
        "active": True,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "createdBy": "self-registration",
    }
    service.create_item(db, "portalAccounts", account)

    portal_token = create_access_token(subject=matricule, claims={"portal": True}, ttl_minutes=PORTAL_TOKEN_TTL)
    employee: dict[str, Any] = {
        "id": _agent_field(agent, "id"),
        "nom": _agent_field(agent, "nom"),
        "prenom": _agent_field(agent, "prenom", "prénom"),
        "code": matricule,
        "matricule": matricule,
        "statut": _agent_field(agent, "statut", "status"),
        "societe": _agent_field(agent, "societe"),
        "site": _agent_site(agent),
        "poste": _agent_field(agent, "fonction", "poste"),
        "departement": _agent_field(agent, "departement", "service"),
        "dateNaissance": _agent_field(agent, "dateNaissance", "birth_date", "birthDate"),
    }
    return {"portal_token": portal_token, "employee": employee}


@router.post("/self-reset-password")
def portal_self_reset_password(payload: dict[str, Any], request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _limit_public(request, "reset", 8)
    required = ("nom", "prenom", "code", "dateNaissance", "password")
    if any(not _clean_text(payload.get(k)) for k in required):
        raise HTTPException(status_code=400, detail="Tous les champs sont obligatoires")
    password = _clean_text(payload.get("password"))
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Mot de passe trop court (minimum 6 caractères)")

    agents = service.list_items(db, "agents")
    agent = next((a for a in agents if isinstance(a, dict) and _agent_matches_signup(a, payload)), None)
    if not agent:
        raise HTTPException(status_code=403, detail="Aucun employé ne correspond aux informations saisies")

    matricule = _agent_field(agent, "matricule", "code")
    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Aucun compte portail. Créez d'abord un compte.")

    service.update_item(db, "portalAccounts", account["id"], {"passwordHash": hash_password(password)})
    return {"ok": True, "message": "Mot de passe réinitialisé avec succès"}


@router.post("/demandes", status_code=status.HTTP_201_CREATED)
def create_demande(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload invalide")
    demande = _to_demande(payload)
    if not demande.get("id"):
        demande.pop("id", None)
    return service.create_item(db, "demandesPersonnel", demande)


@router.post("/pointages", status_code=status.HTTP_201_CREATED)
def create_pointage(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload invalide")
    pointage = _to_pointage(payload)
    if not pointage.get("matricule"):
        raise HTTPException(status_code=400, detail="Code employé obligatoire")
    position = pointage.get("position") if isinstance(pointage.get("position"), dict) else {}
    if not pointage.get("id"):
        pointage.pop("id", None)
    saved = service.create_item(db, "pointagesPortail", pointage)
    # Write instantly to feuillePresence so the attendance sheet updates in real time
    employee = employee_by_ref(db, pointage["matricule"])
    if employee:
        tz = ZoneInfo("Africa/Algiers")
        now = datetime.now(tz)
        today_str = pointage.get("date") or now.strftime("%Y-%m-%d")
        heure = pointage.get("heure") or now.strftime("%H:%M")
        action = pointage.get("action") or "arrivee"
        assignment = db.execute(
            select(Assignment).where(Assignment.employee_id == employee.id, Assignment.active == 1).order_by(Assignment.id.desc())
        ).scalars().first()
        site = db.get(Site, assignment.site_id) if assignment and assignment.site_id else None
        site_name = (site.name or site.indicatif or "") if site else ""
        presence_item: dict[str, Any] = {
            "date": today_str,
            "agentId": str(employee.id),
            "employee_id": employee.id,
            "agentBackendId": employee.id,
            "matricule": employee.code,
            "societe": employee.society or pointage.get("societe") or "",
            "agentName": " ".join([employee.last_name or "", employee.first_name or ""]).strip(),
            "statut": "present",
            "status": "present",
            "source": "portail-rh-gps",
        }
        if action == "arrivee":
            presence_item["heureArrivee"] = heure
        else:
            presence_item["heureDepart"] = heure
        if position.get("lat") and position.get("lng"):
            presence_item["posGpsLat"] = position["lat"]
            presence_item["posGpsLng"] = position["lng"]
            if position.get("accuracy"):
                presence_item["posGpsAccuracy"] = position["accuracy"]
        if assignment:
            presence_item["siteBackendId"] = assignment.site_id
            presence_item["siteId"] = assignment.site_id
            presence_item["siteName"] = site_name
            presence_item["groupe"] = assignment.group_code or ""
        upsert_presence(db, presence_item, "feuillePresence")
        db.commit()
    return saved


@router.post("/pointage-qr", status_code=status.HTTP_201_CREATED)
def create_pointage_qr(payload: dict[str, Any], db: Session = Depends(get_db), authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """QR-based attendance scan — no GPS required, token proves physical presence."""
    token = str(payload.get("token") or "").strip()
    matricule = _clean_text(payload.get("matricule") or payload.get("employee_ref") or "")
    if not token:
        raise HTTPException(status_code=400, detail="token obligatoire")
    if not matricule:
        raise HTTPException(status_code=400, detail="matricule obligatoire")
    if authorization and authorization.startswith("Bearer "):
        try:
            auth_payload = decode_token(authorization.removeprefix("Bearer "))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token portail invalide")
        if auth_payload.get("portal") and auth_payload.get("sub") != matricule:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé")
    # Validate time-based token
    # New format:    "{siteId}|{slot10s}"  — 10-second windows
    # Legacy format: "{slot300s}"          — 5-minute windows
    if "|" in token:
        parts = token.split("|", 1)
        try:
            slot = int(parts[1])
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="Token QR invalide")
        current_slot = math.floor(datetime.now(timezone.utc).timestamp() * 1000 / 10000)
        if abs(slot - current_slot) > 1:
            raise HTTPException(status_code=400, detail="QR expiré — scannez le code en cours d'affichage")
    else:
        try:
            slot = int(token)
        except ValueError:
            raise HTTPException(status_code=400, detail="Token QR invalide")
        current_slot = math.floor(datetime.now(timezone.utc).timestamp() * 1000 / 300000)
        if abs(slot - current_slot) > 1:
            raise HTTPException(status_code=400, detail="QR expiré — présentez le badge dans les 5 minutes suivant l'affichage du QR")
    employee = employee_by_ref(db, matricule)
    if not employee:
        raise HTTPException(status_code=404, detail=f"Employé introuvable: {matricule}")
    tz = ZoneInfo("Africa/Algiers")
    now = datetime.now(tz)
    heure = now.strftime("%H:%M")
    today_str = now.strftime("%Y-%m-%d")
    existing = db.execute(
        select(DailyPresence).where(
            DailyPresence.presence_date == now.date(),
            DailyPresence.employee_id == employee.id,
        ).order_by(DailyPresence.id.desc())
    ).scalars().first()
    existing_legacy = ((existing.data or {}).get("_legacy") if existing and isinstance(existing.data, dict) else {}) or {}
    if existing and (existing.arrival_time == "P" or existing_legacy.get("code") == "P" or existing_legacy.get("heureArrivee") == "P"):
        scan_time = existing_legacy.get("scanArrivee") or existing.arrival_time or heure
        return {
            "success": True,
            "duplicate": True,
            "message": "Déjà enregistré",
            "heure": scan_time,
            "date": today_str,
            "employee": {
                "id": employee.id,
                "matricule": employee.code,
                "nom": employee.last_name,
                "prenom": employee.first_name,
            },
            "record": upsert_presence(db, {"backendId": existing.id, "date": today_str, "employee_id": employee.id}, "feuillePresence"),
        }
    assignment = db.execute(
        select(Assignment).where(Assignment.employee_id == employee.id, Assignment.active == 1).order_by(Assignment.id.desc())
    ).scalars().first()
    site_name = ""
    site = db.get(Site, assignment.site_id) if assignment and assignment.site_id else None
    if site:
        site_name = site.name or site.indicatif or ""
    item: dict[str, Any] = {
        "date": today_str,
        "agentId": str(employee.id),
        "employee_id": employee.id,
        "agentBackendId": employee.id,
        "matricule": employee.code,
        "agentName": " ".join([employee.last_name or "", employee.first_name or ""]).strip(),
        "statut": "present",
        "status": "present",
        "code": "P",
        "heureArrivee": "P",
        "scanArrivee": heure,
        "valide": True,
        "valideAt": now.isoformat(),
        "source": "portail-rh-qr",
    }
    if assignment:
        item["siteBackendId"] = assignment.site_id
        item["siteId"] = assignment.site_id
        item["siteName"] = site_name
        item["groupe"] = assignment.group_code or ""
    result = upsert_presence(db, item, "feuillePresence")
    db.commit()
    return {
        "success": True,
        "duplicate": False,
        "message": "PRÉSENT",
        "heure": heure,
        "date": today_str,
        "site": site_name,
        "employee": {
            "id": employee.id,
            "matricule": employee.code,
            "nom": employee.last_name,
            "prenom": employee.first_name,
        },
        "record": result,
    }


@router.get("/pointages/{matricule}")
def list_pointages_personnel(matricule: str, db: Session = Depends(get_db), _: str = Depends(_require_portal_token)) -> dict[str, Any]:
    key = _clean_text(matricule).lower()
    if not key:
        raise HTTPException(status_code=400, detail="Code employé obligatoire")
    employee = employee_by_ref(db, key)
    pointages = service.list_items(db, "pointagesPortail")
    rows = [
        p
        for p in pointages
        if isinstance(p, dict) and _clean_text(p.get("matricule")).lower() == key
    ]
    if employee:
        daily_rows = db.execute(
            select(DailyPresence).where(DailyPresence.employee_id == employee.id).order_by(DailyPresence.presence_date.desc(), DailyPresence.id.desc())
        ).scalars().all()
        for row in daily_rows:
            legacy = ((row.data or {}).get("_legacy") if isinstance(row.data, dict) else {}) or {}
            if row.arrival_time == "P" or legacy.get("code") == "P" or legacy.get("scanArrivee"):
                rows.append({
                    "id": f"qr-{row.id}",
                    "date": row.presence_date.isoformat(),
                    "createdAt": f"{row.presence_date.isoformat()}T{legacy.get('scanArrivee') or '00:00'}:00",
                    "heure": legacy.get("scanArrivee") or "",
                    "action": "presence",
                    "site": legacy.get("siteName") or "",
                    "source": "qr",
                })
    rows.sort(key=lambda p: _clean_text(p.get("createdAt") or p.get("date")), reverse=True)
    return {"matricule": matricule, "data": rows}


@router.get("/demandes/{matricule}")
def list_demandes_personnel(matricule: str, db: Session = Depends(get_db), _: str = Depends(_require_portal_token)) -> dict[str, Any]:
    key = _clean_text(matricule).lower()
    if not key:
        raise HTTPException(status_code=400, detail="Matricule obligatoire")
    demandes = service.list_items(db, "demandesPersonnel")
    rows = [
        d
        for d in demandes
        if isinstance(d, dict) and _clean_text(d.get("matricule")).lower() == key
    ]
    rows.sort(key=lambda d: _clean_text(d.get("updatedAt") or d.get("createdAt") or d.get("date")), reverse=True)
    return {"matricule": matricule, "data": rows}


# ─────────────────────────────────────────────────────────────────
# Gestion des comptes portail (admin)
# ─────────────────────────────────────────────────────────────────

def _find_portal_account(db: Session, matricule: str) -> dict[str, Any] | None:
    accounts = service.list_items(db, "portalAccounts")
    m = _norm_text(matricule)
    return next((a for a in accounts if isinstance(a, dict) and _norm_text(a.get("matricule", "")) == m), None)


@router.get("/accounts")
def list_portal_accounts(
    societe: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> list[dict[str, Any]]:
    accounts = service.list_items(db, "portalAccounts")
    rows = [a for a in accounts if isinstance(a, dict)]
    if societe:
        s = _norm_text(societe)
        rows = [a for a in rows if _norm_text(a.get("societe", "")) == s]
    return [{k: v for k, v in a.items() if k != "passwordHash"} for a in rows]


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
def create_portal_account(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    matricule_raw = _clean_text(payload.get("matricule"))
    password = _clean_text(payload.get("password"))
    if not matricule_raw or not password:
        raise HTTPException(status_code=400, detail="Matricule et mot de passe obligatoires")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Mot de passe trop court (minimum 6 caractères)")

    agents = service.list_items(db, "agents")
    agent = next(
        (a for a in agents if isinstance(a, dict) and _norm_text(_agent_field(a, "matricule", "code")) == _norm_text(matricule_raw)),
        None,
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Employé introuvable")

    if _find_portal_account(db, matricule_raw):
        raise HTTPException(status_code=409, detail="Un compte portail existe déjà pour cet employé")

    username = _norm_text(matricule_raw)
    account: dict[str, Any] = {
        "id": username,
        "username": username,
        "matricule": _agent_field(agent, "matricule", "code"),
        "passwordHash": hash_password(password),
        "nom": _agent_field(agent, "nom"),
        "prenom": _agent_field(agent, "prenom", "prénom"),
        "societe": _agent_field(agent, "societe"),
        "active": True,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "createdBy": admin.username,
    }
    created = service.create_item(db, "portalAccounts", account)
    return {k: v for k, v in created.items() if k != "passwordHash"}


@router.get("/accounts/{matricule}")
def get_portal_account(
    matricule: str,
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Aucun compte portail pour cet employé")
    return {k: v for k, v in account.items() if k != "passwordHash"}


@router.put("/accounts/{matricule}/password")
def reset_portal_password(
    matricule: str,
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    password = _clean_text(payload.get("password"))
    if not password or len(password) < 6:
        raise HTTPException(status_code=400, detail="Mot de passe invalide (minimum 6 caractères)")
    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Aucun compte portail pour cet employé")
    updated = service.update_item(db, "portalAccounts", account["id"], {"passwordHash": hash_password(password)})
    return {k: v for k, v in updated.items() if k != "passwordHash"}


@router.delete("/accounts/{matricule}")
def delete_portal_account(
    matricule: str,
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, str]:
    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Aucun compte portail pour cet employé")
    return service.delete_item(db, "portalAccounts", account["id"])


# ─────────────────────────────────────────────────────────────────
# Connexion portail (public)
# ─────────────────────────────────────────────────────────────────

@router.post("/login")
def portal_login(payload: dict[str, Any], request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _limit_public(request, "login", 30)
    username = _norm_text(payload.get("username"))
    password = _clean_text(payload.get("password"))
    if not username or not password:
        raise HTTPException(status_code=400, detail="Identifiant et mot de passe requis")

    accounts = service.list_items(db, "portalAccounts")
    account = next(
        (a for a in accounts if isinstance(a, dict) and _norm_text(a.get("username", "")) == username),
        None,
    )
    if not account or not account.get("active"):
        raise HTTPException(status_code=403, detail="Identifiant ou mot de passe incorrect")
    if not verify_password(password, account.get("passwordHash", "")):
        raise HTTPException(status_code=403, detail="Identifiant ou mot de passe incorrect")

    matricule = account["matricule"]
    agents = service.list_items(db, "agents")
    agent = next(
        (a for a in agents if isinstance(a, dict) and _norm_text(_agent_field(a, "matricule", "code")) == _norm_text(matricule)),
        None,
    )

    portal_token = create_access_token(subject=matricule, claims={"portal": True}, ttl_minutes=PORTAL_TOKEN_TTL)
    employee: dict[str, Any] = {
        "id": _agent_field(agent, "id") if agent else "",
        "nom": _agent_field(agent, "nom") if agent else account.get("nom", ""),
        "prenom": _agent_field(agent, "prenom", "prénom") if agent else account.get("prenom", ""),
        "code": matricule,
        "matricule": matricule,
        "statut": _agent_field(agent, "statut", "status") if agent else "",
        "societe": _agent_field(agent, "societe") if agent else account.get("societe", ""),
        "site": _agent_site(agent) if agent else "",
        "poste": _agent_field(agent, "fonction", "poste") if agent else "",
        "departement": _agent_field(agent, "departement", "service") if agent else "",
        "dateNaissance": _agent_field(agent, "dateNaissance", "birth_date", "birthDate") if agent else "",
    }
    return {"portal_token": portal_token, "employee": employee}


# ─────────────────────────────────────────────────────────────────
# Changement de mot de passe (portail employé)
# ─────────────────────────────────────────────────────────────────

@router.post("/change-password")
def portal_change_password(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token portail requis")
    try:
        token_payload = decode_token(authorization.removeprefix("Bearer "))
    except ValueError:
        raise HTTPException(status_code=401, detail="Token portail invalide")
    if not token_payload.get("portal"):
        raise HTTPException(status_code=403, detail="Token non autorisé pour le portail")

    matricule = token_payload.get("sub", "")
    old_password = _clean_text(payload.get("oldPassword"))
    new_password = _clean_text(payload.get("newPassword"))
    if not old_password or not new_password:
        raise HTTPException(status_code=400, detail="Ancien et nouveau mot de passe requis")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Nouveau mot de passe trop court (minimum 6 caractères)")

    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Compte portail introuvable")
    if not verify_password(old_password, account.get("passwordHash", "")):
        raise HTTPException(status_code=403, detail="Mot de passe actuel incorrect")

    service.update_item(db, "portalAccounts", account["id"], {"passwordHash": hash_password(new_password)})
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────
# Notifications push (PWA)
# ─────────────────────────────────────────────────────────────────

@router.get("/push/vapid-public-key")
def get_vapid_public_key(db: Session = Depends(get_db)) -> dict[str, str]:
    from app.modules.portal.push import get_or_create_vapid_keys
    keys = get_or_create_vapid_keys(db)
    return {"public_key": keys["public_key"]}


@router.post("/push/subscribe")
def push_subscribe(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token portail requis")
    try:
        tok = decode_token(authorization.removeprefix("Bearer "))
    except ValueError:
        raise HTTPException(status_code=401, detail="Token invalide")
    if not tok.get("portal"):
        raise HTTPException(status_code=403, detail="Accès refusé")

    matricule = tok.get("sub", "")
    subscription = payload.get("subscription")
    if not subscription or not isinstance(subscription, dict) or not subscription.get("endpoint"):
        raise HTTPException(status_code=400, detail="Subscription invalide")

    endpoint = subscription["endpoint"]
    subs = service.list_items(db, "pushSubscriptions")
    already = next(
        (s for s in subs if isinstance(s, dict) and s.get("matricule") == matricule and s.get("endpoint") == endpoint),
        None,
    )
    if not already:
        service.create_item(db, "pushSubscriptions", {
            "matricule": matricule,
            "endpoint": endpoint,
            "keys": subscription.get("keys", {}),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        })
    return {"ok": True}


@router.delete("/push/subscribe")
def push_unsubscribe(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token portail requis")
    try:
        tok = decode_token(authorization.removeprefix("Bearer "))
    except ValueError:
        raise HTTPException(status_code=401, detail="Token invalide")
    if not tok.get("portal"):
        raise HTTPException(status_code=403, detail="Accès refusé")

    matricule = tok.get("sub", "")
    endpoint = _clean_text(payload.get("endpoint", ""))
    subs = service.list_items(db, "pushSubscriptions")
    for s in subs:
        if isinstance(s, dict) and s.get("matricule") == matricule and s.get("endpoint") == endpoint and s.get("id"):
            service.delete_item(db, "pushSubscriptions", s["id"])
    return {"ok": True}


@router.post("/push/send/{matricule}")
def push_send(
    matricule: str,
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    from app.modules.portal.push import get_or_create_vapid_keys, send_push
    keys = get_or_create_vapid_keys(db)
    subs = service.list_items(db, "pushSubscriptions")
    m = _norm_text(matricule)
    targets = [s for s in subs if isinstance(s, dict) and _norm_text(s.get("matricule", "")) == m]
    if not targets:
        raise HTTPException(status_code=404, detail="Aucun abonnement push pour cet employé")
    notification = {
        "title": _clean_text(payload.get("title", "Portail RH")),
        "body": _clean_text(payload.get("body", "")),
        "url": _clean_text(payload.get("url", "/")),
        "tag": "portail-rh",
    }
    sent = sum(
        1 for s in targets
        if send_push({"endpoint": s["endpoint"], "keys": s.get("keys", {})}, notification, keys["private_key"])
    )
    return {"ok": True, "sent": sent, "total": len(targets)}
