import math
import re
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.config import settings
from app.core.security import create_access_token, decode_token, hash_password, verify_password
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.irongs import service
from app.modules.irongs.sql_bridge import employee_by_ref, upsert_presence
from app.modules.ops.models import Assignment, DailyPresence, RotationTemplate, Site
from app.modules.ops.routes import _allowed_assignment_site_ids, _site_society


router = APIRouter()

PORTAL_TOKEN_TTL = 60 * 24  # 24 heures
PORTAL_TEMPORARY_PASSWORD = "123456"
ATTENDANCE_QR_REFRESH_SECONDS = 10
# Mobile browsers may suspend JavaScript briefly when the screen locks or the
# application is backgrounded. Keep a short server-side grace period while the
# displayed QR is still replaced every ten seconds and remains single-use.
ATTENDANCE_QR_TTL_SECONDS = 120
ATTENDANCE_NEW_ARRIVAL_DELAY = timedelta(hours=8)
# Un cycle non fermé ne doit pas rester actif indéfiniment. La limite standard
# couvre les postes de nuit ; les sites en rotation 24 h bénéficient d'une
# fenêtre plus large afin que le départ du lendemain ferme bien leur arrivée.
ATTENDANCE_OPEN_CYCLE_MAX = timedelta(hours=16)
ATTENDANCE_OPEN_24H_CYCLE_MAX = timedelta(hours=30)


def _authorized_work_minutes(db: Session, assignment: Assignment | None, site: Site | None, work_date: Any) -> int:
    """Durée autorisée issue du cycle configuré, avec repli sur l'ancien régime du site."""
    if assignment and assignment.rotation_id:
        rotation = db.get(RotationTemplate, assignment.rotation_id)
        days = rotation.cycle_days if rotation and isinstance(rotation.cycle_days, list) else []
        if rotation and days:
            offsets = rotation.group_offsets if isinstance(rotation.group_offsets, dict) else {}
            try: offset = int(offsets.get((assignment.group_code or "A").upper(), 0))
            except (TypeError, ValueError): offset = 0
            index = ((work_date - assignment.start_date).days + offset) % max(1, min(rotation.cycle_length, len(days)))
            day = days[index] if isinstance(days[index], dict) else {}
            start, end = str(day.get("start_time") or ""), str(day.get("end_time") or "")
            try:
                start_minutes = int(start[:2]) * 60 + int(start[3:5])
                end_minutes = int(end[:2]) * 60 + int(end[3:5])
                return (end_minutes - start_minutes) % (24 * 60) or 24 * 60
            except (TypeError, ValueError):
                pass
    system = _clean_text(getattr(site, "rotation_system", "") if site else "").lower()
    if "24/48" in system: return 24 * 60
    if "3x8" in system: return 8 * 60
    explicit = re.search(r"(?:^|\D)(8|12|16|24)\s*h?(?:\D|$)", system)
    return int(explicit.group(1)) * 60 if explicit else 8 * 60


def _ensure_attendance_employee_scope(db: Session, scanner: User, employee: Employee) -> None:
    allowed_site_ids = _allowed_assignment_site_ids(db, scanner)
    if allowed_site_ids is None:
        return
    permitted = db.execute(
        select(Assignment.id).where(
            Assignment.employee_id == employee.id,
            Assignment.active == 1,
            Assignment.site_id.in_(allowed_site_ids),
        )
    ).scalar_one_or_none() if allowed_site_ids else None
    if not permitted:
        raise HTTPException(status_code=403, detail="Employé hors du périmètre société/site du pointeur")


@router.get("/attendance-employees")
def attendance_employees(
    society: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[dict[str, Any]]:
    """Référentiel léger du pointage : même table Employee que Pointeur, sans les lourdes
    fiches RH `extra`. Il évite que le téléchargement de plusieurs Mo masque tout OPS/DRH."""
    def society_key(value: Any) -> str:
        text = unicodedata.normalize("NFD", _clean_text(value).upper())
        return " ".join("".join(ch for ch in text if unicodedata.category(ch) != "Mn").split())

    requested_key = society_key(society)
    authorized_societies = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    allowed_keys = {society_key(value) for value in authorized_societies if society_key(value)}
    if requested_key and allowed_keys and requested_key not in allowed_keys:
        raise HTTPException(status_code=403, detail="Société non autorisée")
    effective_keys = {requested_key} if requested_key else allowed_keys
    employees = db.execute(select(Employee).order_by(Employee.last_name, Employee.first_name)).scalars().all()
    employees = [row for row in employees if not _employee_portal_block_reason(row)]
    if effective_keys:
        employees = [row for row in employees if society_key(row.society) in effective_keys]

    employee_ids = [row.id for row in employees]
    assignments = db.execute(
        select(Assignment).where(Assignment.employee_id.in_(employee_ids), Assignment.active == 1)
        .order_by(Assignment.id.desc())
    ).scalars().all() if employee_ids else []
    current_assignment: dict[int, Assignment] = {}
    for assignment in assignments:
        current_assignment.setdefault(assignment.employee_id, assignment)
    explicit_sites = {
        int(value) for value in (user.authorized_sites if isinstance(user.authorized_sites, list) else [])
        if str(value).strip().isdigit()
    }
    if explicit_sites:
        employees = [row for row in employees if current_assignment.get(row.id) and current_assignment[row.id].site_id in explicit_sites]
    site_ids = {assignment.site_id for assignment in current_assignment.values() if assignment.site_id}
    sites = {row.id: row for row in db.execute(select(Site).where(Site.id.in_(site_ids))).scalars().all()} if site_ids else {}
    return [{
        "id": row.id, "matricule": row.code, "nom": row.last_name, "prenom": row.first_name,
        "societe": row.society or "", "statut": row.status or "", "poste": row.position or "",
        "assignment": ({
            "id": current_assignment[row.id].id,
            "site_id": current_assignment[row.id].site_id,
            "site_name": (sites.get(current_assignment[row.id].site_id).name if sites.get(current_assignment[row.id].site_id) else ""),
            "groupe": current_assignment[row.id].group_code or "",
            "poste": current_assignment[row.id].position or row.position or "",
        } if row.id in current_assignment else None),
    } for row in employees]


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


def _portal_identity(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token portail requis")
    try:
        payload = decode_token(authorization.removeprefix("Bearer "))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token portail invalide")
    if not payload.get("portal") or not payload.get("sub"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token non autorisé pour le portail")
    return str(payload["sub"])


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


def _employee_portal_block_reason(employee: Any, on_date: str | None = None) -> str:
    """Return why an employee cannot use the HR portal or attendance QR."""
    if not employee:
        return ""
    if isinstance(employee, dict):
        status_value = employee.get("statut") or employee.get("status") or ""
        extra = employee
    else:
        status_value = getattr(employee, "status", "") or ""
        extra = employee.extra if isinstance(getattr(employee, "extra", None), dict) else {}
    status_key = _norm_text(status_value)
    blocked_statuses = (
        "suspend",
        "sortant",
        "inact",
        "blacklist",
        "archive",
        "demission",
        "licenc",
        "mise a pied",
        "mis a pied",
    )
    if any(marker in status_key for marker in blocked_statuses):
        return "Compte portail suspendu : situation administrative non active"

    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    sanctions = extra.get("sanctions") or legacy.get("sanctions") or []
    target_date = on_date or datetime.now(ZoneInfo("Africa/Algiers")).date().isoformat()
    if isinstance(sanctions, list):
        for sanction in sanctions:
            if not isinstance(sanction, dict) or "mise a pied" not in _norm_text(sanction.get("type")):
                continue
            start = _norm_date(sanction.get("dateMiseAPiedDebut") or sanction.get("dateDebut"))
            end = _norm_date(sanction.get("dateMiseAPiedFin"))
            if start and start <= target_date and (not end or target_date <= end):
                return f"Compte portail suspendu pour mise à pied jusqu'au {end or 'terme de la décision'}"
    return ""


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
        "mustChangePassword": False,
        "passwordChangedAt": datetime.now(timezone.utc).isoformat(),
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

    service.update_item(db, "portalAccounts", account["id"], {
        "passwordHash": hash_password(password),
        "mustChangePassword": False,
        "passwordChangedAt": datetime.now(timezone.utc).isoformat(),
    })
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


@router.get("/attendance-qr")
def create_employee_attendance_qr(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Issue a signed, single-use employee QR, refreshed every ten seconds."""
    matricule = _portal_identity(authorization)
    employee = employee_by_ref(db, matricule)
    if not employee:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    blocked_reason = _employee_portal_block_reason(employee)
    if blocked_reason:
        raise HTTPException(status_code=403, detail=blocked_reason)
    account = _find_portal_account(db, matricule)
    if account and account.get("mustChangePassword"):
        raise HTTPException(status_code=403, detail="Modifiez d'abord votre mot de passe provisoire")
    now = datetime.now(timezone.utc)
    nonce = secrets.token_urlsafe(12)
    token = create_access_token(
        subject=employee.code,
        claims={
            "attendance_qr": True,
            "employee_id": employee.id,
            "nonce": nonce,
            "iat": int(now.timestamp()),
        },
        ttl_seconds=ATTENDANCE_QR_TTL_SECONDS,
    )
    return {
        "token": token,
        "expires_in": ATTENDANCE_QR_REFRESH_SECONDS,
        "expires_at": int(now.timestamp()) + ATTENDANCE_QR_REFRESH_SECONDS,
        "valid_until": int(now.timestamp()) + ATTENDANCE_QR_TTL_SECONDS,
    }


def _register_attendance(
    db: Session,
    employee: Any,
    scanner: User,
    nonce: str,
    source: str,
    observation: str = "",
) -> dict[str, Any]:
    """Logique de pointage partagée entre le scan QR et la saisie manuelle (employé sans
    smartphone) : bascule arrivée/départ, écrit la feuille de présence partagée, construit
    la réponse affichée au pointeur. `nonce` identifie l'événement dans attendanceQrScans
    (pour la déduplication QR et l'historique arrivée/départ, quelle que soit la source)."""
    blocked_reason = _employee_portal_block_reason(employee)
    if blocked_reason:
        raise HTTPException(status_code=403, detail=f"Pointage refusé : {blocked_reason}")

    tz = ZoneInfo("Africa/Algiers")
    now = datetime.now(tz)
    scan_date_str = now.strftime("%Y-%m-%d")
    heure = now.strftime("%H:%M:%S")
    observation = _clean_text(observation)[:500]
    assignment = db.execute(
        select(Assignment).where(Assignment.employee_id == employee.id, Assignment.active == 1).order_by(Assignment.id.desc())
    ).scalars().first()
    site = db.get(Site, assignment.site_id) if assignment and assignment.site_id else None
    site_name = (site.name or site.indicatif or "") if site else ""

    def scan_datetime(row: dict[str, Any] | None) -> datetime | None:
        if not row or not row.get("scannedAt"):
            return None
        try:
            value = datetime.fromisoformat(str(row["scannedAt"]).replace("Z", "+00:00"))
            return (value.replace(tzinfo=tz) if value.tzinfo is None else value).astimezone(tz)
        except (TypeError, ValueError):
            return None

    employee_scans = sorted(
        (
            row for row in service.list_items(db, "attendanceQrScans")
            if isinstance(row, dict)
            and str(row.get("employeeId") or "") == str(employee.id)
            and row.get("action") in {"arrivee", "depart"}
            and row.get("scannedAt")
        ),
        key=lambda row: str(row.get("scannedAt")),
    )
    last_event = employee_scans[-1] if employee_scans else None
    last_arrival = next((row for row in reversed(employee_scans) if row.get("action") == "arrivee"), None)
    last_arrival_at = scan_datetime(last_arrival)
    rotation = _clean_text(getattr(site, "rotation_system", "") if site else "")
    open_cycle_max = ATTENDANCE_OPEN_24H_CYCLE_MAX if "24" in rotation else ATTENDANCE_OPEN_CYCLE_MAX
    open_arrival = (
        last_arrival
        if last_event is last_arrival
        and last_arrival_at is not None
        and timedelta(0) <= now - last_arrival_at <= open_cycle_max
        else None
    )
    action = "depart" if open_arrival else "arrivee"
    cycle_number = sum(1 for row in employee_scans if row.get("action") == "arrivee") + (1 if action == "arrivee" else 0)
    presence_date_str = scan_date_str
    if action == "depart" and open_arrival:
        presence_date_str = str(open_arrival.get("scannedAt"))[:10] or scan_date_str
    if action == "arrivee" and last_arrival:
        remaining = ATTENDANCE_NEW_ARRIVAL_DELAY - (now - last_arrival_at) if last_arrival_at else timedelta(0)
        if remaining > timedelta(0):
            remaining_minutes = max(1, int(remaining.total_seconds() // 60) + 1)
            hours, minutes = divmod(remaining_minutes, 60)
            wait_label = f"{hours} h {minutes:02d}" if hours else f"{minutes} min"
            raise HTTPException(
                status_code=409,
                detail=f"Nouvelle arrivée disponible dans {wait_label}. Le départ précédent est bien enregistré.",
            )

    existing = db.execute(
        select(DailyPresence).where(
            DailyPresence.presence_date == datetime.fromisoformat(presence_date_str).date(),
            DailyPresence.employee_id == employee.id,
        ).order_by(DailyPresence.id.desc())
    ).scalars().first()
    legacy = ((existing.data or {}).get("_legacy") if existing and isinstance(existing.data, dict) else {}) or {}
    arrival_at_for_departure = last_arrival_at if action == "depart" else None
    # Compatibilité avec les pointages créés avant l'historique multi-cycles.
    if not employee_scans and existing:
        has_arrival = bool(existing.arrival_time or legacy.get("scanArrivee") or legacy.get("heureArrivee"))
        has_departure = bool(existing.departure_time or legacy.get("scanDepart") or legacy.get("heureDepart"))
        action = "depart" if has_arrival and not has_departure else "arrivee"
        cycle_number = 1
        if action == "depart":
            legacy_arrival = existing.arrival_time or legacy.get("scanArrivee") or legacy.get("heureArrivee")
            try:
                arrival_at_for_departure = datetime.combine(existing.presence_date, datetime.strptime(str(legacy_arrival), "%H:%M:%S").time(), tz)
            except (TypeError, ValueError):
                arrival_at_for_departure = None
    existing_notes = _clean_text((existing.notes if existing else "") or legacy.get("observations"))
    observation_line = (
        f"[{heure} · {scanner.username} · {'DÉPART' if action == 'depart' else 'ARRIVÉE'}] {observation}"
        if observation
        else ""
    )
    worked_minutes = (
        max(0, int((now - arrival_at_for_departure).total_seconds() // 60))
        if action == "depart" and arrival_at_for_departure else None
    )
    authorized_minutes = _authorized_work_minutes(
        db, assignment, site, (arrival_at_for_departure or now).date()
    )
    overtime_minutes = max(0, worked_minutes - authorized_minutes) if worked_minutes is not None else 0
    item: dict[str, Any] = {
        "date": presence_date_str,
        "agentId": str(employee.id),
        "employee_id": employee.id,
        "agentBackendId": employee.id,
        "matricule": employee.code,
        "societe": employee.society or "",
        "agentName": " ".join([employee.last_name or "", employee.first_name or ""]).strip(),
        "statut": "present",
        "status": "present",
        "code": "P",
        "valide": True,
        "valideAt": now.isoformat(),
        "source": source,
        "scannedBy": scanner.username,
        "scannedByUserId": scanner.id,
        "scanCycles": [
            *(legacy.get("scanCycles") if isinstance(legacy.get("scanCycles"), list) else []),
            {
                "action": action,
                "heure": heure,
                "scannedAt": now.isoformat(),
                "scannedBy": scanner.username,
                "cycle": cycle_number,
                **({"observation": observation} if observation else {}),
            },
        ],
        "authorizedMinutes": authorized_minutes,
        **({"workedMinutes": worked_minutes, "overtimeMinutes": overtime_minutes, "overtimeAlert": True} if overtime_minutes else {}),
    }
    if observation_line:
        item["observations"] = "\n".join(part for part in (existing_notes, observation_line) if part)
    if action == "arrivee":
        if not existing or not existing.arrival_time:
            item["heureArrivee"] = "P"
            item["scanArrivee"] = heure
        item["lastScanArrivee"] = heure
    else:
        item["heureDepart"] = heure
        item["scanDepart"] = heure
    if assignment:
        item.update({
            "siteBackendId": assignment.site_id,
            "siteId": assignment.site_id,
            "siteName": site_name,
            "groupe": assignment.group_code or "",
        })
    result = upsert_presence(db, item, "feuillePresence")
    service.create_item(db, "attendanceQrScans", {
        "id": nonce,
        "nonce": nonce,
        "employeeId": employee.id,
        "matricule": employee.code,
        "agentName": item["agentName"],
        "action": action,
        "cycle": cycle_number,
        "scannedAt": now.isoformat(),
        "site": site_name,
        "siteId": assignment.site_id if assignment else None,
        "scannedBy": scanner.username,
        "scannedByUserId": scanner.id,
        **({"observation": observation} if observation else {}),
        "authorizedMinutes": authorized_minutes,
        **({"workedMinutes": worked_minutes, "overtimeMinutes": overtime_minutes, "overtimeAlert": True} if overtime_minutes else {}),
    })
    db.commit()
    employee_extra = employee.extra if isinstance(employee.extra, dict) else {}
    employee_legacy = employee_extra.get("_legacy") if isinstance(employee_extra.get("_legacy"), dict) else {}
    employee_photo = next(
        (
            _clean_text(employee_extra.get(key) or employee_legacy.get(key))
            for key in ("photo", "photoUrl", "photoData", "photo_url")
            if employee_extra.get(key) or employee_legacy.get(key)
        ),
        "",
    )
    duration_minutes = worked_minutes
    duration_label = ""
    if duration_minutes is not None:
        duration_hours, remaining_minutes = divmod(duration_minutes, 60)
        duration_label = f"{duration_hours} h {remaining_minutes:02d} min"
    return {
        "success": True,
        "action": action,
        "cycle": cycle_number,
        "heure": heure,
        "arrival_time": arrival_at_for_departure.strftime("%H:%M:%S") if arrival_at_for_departure else (heure if action == "arrivee" else ""),
        "departure_time": heure if action == "depart" else "",
        "duration_minutes": duration_minutes,
        "duration_label": duration_label,
        "authorized_minutes": authorized_minutes,
        "overtime_minutes": overtime_minutes,
        "overtime_alert": overtime_minutes > 0,
        "date": scan_date_str,
        "site": site_name,
        "observation": observation,
        "employee": {
            "id": employee.id,
            "matricule": employee.code,
            "nom": employee.last_name,
            "prenom": employee.first_name,
            "photo": employee_photo,
            "societe": employee.society or "",
            "poste": employee.position or "",
            "statut": employee.status or "",
            "site": site_name,
        },
        "record": result,
    }


@router.post("/attendance-qr/scan", status_code=status.HTTP_201_CREATED)
def scan_employee_attendance_qr(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    scanner: User = Depends(current_user),
) -> dict[str, Any]:
    """Validate a supervisor scan and write it directly to the shared attendance sheet."""
    token = _clean_text(payload.get("token"))
    if not token:
        raise HTTPException(status_code=400, detail="QR obligatoire")
    try:
        qr = decode_token(token)
    except ValueError:
        raise HTTPException(status_code=400, detail="QR expiré ou invalide")
    if not qr.get("attendance_qr") or not qr.get("nonce"):
        raise HTTPException(status_code=400, detail="Ce QR n'est pas un QR de pointage employé")

    nonce = str(qr["nonce"])
    used = next(
        (
            row for row in service.list_items(db, "attendanceQrScans")
            if isinstance(row, dict) and row.get("nonce") == nonce
        ),
        None,
    )
    if used:
        raise HTTPException(status_code=409, detail="Ce QR a déjà été utilisé")

    employee = employee_by_ref(db, str(qr.get("sub") or ""))
    if not employee or int(qr.get("employee_id") or 0) != employee.id:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    _ensure_attendance_employee_scope(db, scanner, employee)
    return _register_attendance(db, employee, scanner, nonce, "portail-rh-employee-qr")


@router.get("/attendance-feed")
def attendance_feed(
    since: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[dict[str, Any]]:
    """Flux des derniers pointages (arrivée/départ), pour l'écran de supervision temps réel
    (interrogé par polling toutes les quelques secondes). Filtré selon le même périmètre
    sites/société qu'un superviseur OPS (_allowed_assignment_site_ids) : un compte restreint
    à certains sites ne voit que leurs pointages, pas ceux de toute l'entreprise."""
    limit = max(1, min(limit, 200))
    allowed_site_ids = _allowed_assignment_site_ids(db, user)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)

    def within_retention(row: dict[str, Any]) -> bool:
        raw = _clean_text(row.get("scannedAt"))
        if not raw:
            return False
        try:
            scanned_at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if scanned_at.tzinfo is None:
                scanned_at = scanned_at.replace(tzinfo=timezone.utc)
            return scanned_at.astimezone(timezone.utc) >= cutoff
        except ValueError:
            return False

    rows = [
        row for row in service.list_items(db, "attendanceQrScans")
        if isinstance(row, dict) and within_retention(row)
    ]
    if allowed_site_ids is not None:
        allowed = set(allowed_site_ids)
        rows = [row for row in rows if row.get("siteId") in allowed]
    since_value = _clean_text(since)
    if since_value:
        rows = [row for row in rows if _clean_text(row.get("scannedAt")) > since_value]
    rows.sort(key=lambda row: _clean_text(row.get("scannedAt")), reverse=True)
    employee_ids = {
        int(row.get("employeeId")) for row in rows
        if str(row.get("employeeId") or "").strip().isdigit()
    }
    employees_by_id = {
        employee.id: employee for employee in db.execute(
            select(Employee).where(Employee.id.in_(employee_ids))
        ).scalars().all()
    } if employee_ids else {}
    return [
        {
            "id": row.get("id"),
            "employee_id": row.get("employeeId"),
            "matricule": row.get("matricule") or (employees_by_id.get(int(row.get("employeeId"))).code if str(row.get("employeeId") or "").isdigit() and employees_by_id.get(int(row.get("employeeId"))) else ""),
            "nom": row.get("agentName") or (" ".join(filter(None, [employees_by_id.get(int(row.get("employeeId"))).last_name, employees_by_id.get(int(row.get("employeeId"))).first_name])).strip() if str(row.get("employeeId") or "").isdigit() and employees_by_id.get(int(row.get("employeeId"))) else "Employé inconnu"),
            "action": row.get("action") or "arrivee",
            "cycle": row.get("cycle") or 1,
            "site": row.get("site") or "",
            "site_id": row.get("siteId"),
            "scanned_at": row.get("scannedAt") or "",
            "scanned_by": row.get("scannedBy") or "",
            "observation": row.get("observation") or "",
        }
        for row in rows[:limit]
    ]


@router.get("/attendance-statistics")
def attendance_statistics(
    year: int | None = None,
    month: int | None = None,
    site: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Statistiques consolidées du Pointeur, filtrées par le périmètre du compte.

    Les indicateurs sont factuels (évènements et durées enregistrées). Les alertes
    restent des signaux de contrôle RH et ne constituent pas une décision juridique.
    """
    tz = ZoneInfo("Africa/Algiers")
    now = datetime.now(tz)
    selected_year = max(2020, min(int(year or now.year), now.year + 1))
    selected_month = int(month) if month else None
    if selected_month is not None and not 1 <= selected_month <= 12:
        raise HTTPException(status_code=422, detail="Mois invalide")
    allowed_site_ids = _allowed_assignment_site_ids(db, user)
    site_catalog_query = select(Site.name).where(Site.active == 1)
    if allowed_site_ids is not None:
        site_catalog_query = site_catalog_query.where(Site.id.in_(allowed_site_ids))
    site_options = sorted({name for (name,) in db.execute(site_catalog_query).all() if _clean_text(name)})
    society_by_site_name: dict[str, str] = {}
    society_catalog_query = select(Site)
    if allowed_site_ids is not None:
        society_catalog_query = society_catalog_query.where(Site.id.in_(allowed_site_ids))
    for site_row_ref in db.execute(society_catalog_query).scalars().all():
        if _clean_text(site_row_ref.name):
            society_by_site_name[site_row_ref.name] = _site_society(site_row_ref) or "Société non renseignée"
    site_filter = _clean_text(site).casefold()
    source_rows = [
        row for row in service.list_items(db, "attendanceQrScans")
        if isinstance(row, dict) and row.get("action") in {"arrivee", "depart"}
    ]
    if allowed_site_ids is not None:
        allowed = set(allowed_site_ids)
        source_rows = [row for row in source_rows if row.get("siteId") in allowed]

    parsed: list[tuple[datetime, dict[str, Any]]] = []
    for row in source_rows:
        at = _parse_scan_at(row.get("scannedAt"), tz)
        if not at or at.year != selected_year or (selected_month and at.month != selected_month):
            continue
        if site_filter and _clean_text(row.get("site")).casefold() != site_filter:
            continue
        parsed.append((at, row))
    parsed.sort(key=lambda pair: pair[0])

    employee_ids = {
        int(row.get("employeeId")) for _, row in parsed
        if str(row.get("employeeId") or "").isdigit()
    }
    employees_by_id = {
        employee.id: employee for employee in db.execute(
            select(Employee).where(Employee.id.in_(employee_ids))
        ).scalars().all()
    } if employee_ids else {}
    months = [{"month": index, "entries": 0, "exits": 0, "minutes": 0} for index in range(1, 13)]
    sites: dict[str, dict[str, Any]] = {}
    societies: dict[str, dict[str, Any]] = {}
    employees: dict[str, dict[str, Any]] = {}
    open_arrivals: dict[str, datetime] = {}

    for at, row in parsed:
        employee_key = str(row.get("employeeId") or row.get("matricule") or "")
        if not employee_key:
            continue
        employee = employees_by_id.get(int(row.get("employeeId"))) if str(row.get("employeeId") or "").isdigit() else None
        employee_name = _clean_text(row.get("agentName")) or (
            " ".join(filter(None, [employee.last_name, employee.first_name])).strip() if employee else "Employé"
        )
        site_name = _clean_text(row.get("site")) or "Site non renseigné"
        society_name = society_by_site_name.get(site_name, "Société non renseignée")
        site_row = sites.setdefault(site_name, {"site": site_name, "entries": 0, "exits": 0, "minutes": 0, "employees": set()})
        society_row = societies.setdefault(society_name, {"societe": society_name, "entries": 0, "exits": 0, "minutes": 0, "employees": set(), "sites": set()})
        employee_row = employees.setdefault(employee_key, {
            "employee_id": row.get("employeeId"), "matricule": row.get("matricule") or (employee.code if employee else ""),
            "name": employee_name, "site": site_name, "entries": 0, "exits": 0, "minutes": 0, "missing_exits": 0,
        })
        site_row["employees"].add(employee_key)
        society_row["employees"].add(employee_key)
        society_row["sites"].add(site_name)
        action = row.get("action")
        if action == "arrivee":
            months[at.month - 1]["entries"] += 1; site_row["entries"] += 1; society_row["entries"] += 1; employee_row["entries"] += 1
            open_arrivals[employee_key] = at
        else:
            months[at.month - 1]["exits"] += 1; site_row["exits"] += 1; society_row["exits"] += 1; employee_row["exits"] += 1
            arrival = open_arrivals.pop(employee_key, None)
            if arrival and at >= arrival:
                duration = min(int((at - arrival).total_seconds() // 60), 48 * 60)
                months[at.month - 1]["minutes"] += duration; site_row["minutes"] += duration; society_row["minutes"] += duration; employee_row["minutes"] += duration

    alerts: list[dict[str, Any]] = []
    for key, arrival in open_arrivals.items():
        row = employees.get(key)
        if not row:
            continue
        row["missing_exits"] = 1
        alerts.append({"level": "warning", "title": "Pointage de sortie manquant", "name": row["name"], "site": row["site"], "detail": arrival.isoformat()})
    for row in employees.values():
        hours = round(row["minutes"] / 60, 1)
        row["hours"] = hours
    site_output = []
    for row in sites.values():
        count = len(row.pop("employees"))
        row["employee_count"] = count
        row["hours"] = round(row.pop("minutes") / 60, 1)
        row["completion_rate"] = round(row["exits"] * 100 / row["entries"]) if row["entries"] else 0
        site_output.append(row)
    site_output.sort(key=lambda row: (-row["completion_rate"], row["site"]))
    society_output = []
    for row in societies.values():
        employee_count = len(row.pop("employees"))
        site_count = len(row.pop("sites"))
        row["employee_count"] = employee_count
        row["site_count"] = site_count
        row["hours"] = round(row.pop("minutes") / 60, 1)
        row["completion_rate"] = round(row["exits"] * 100 / row["entries"]) if row["entries"] else 0
        society_output.append(row)
    society_output.sort(key=lambda row: row["societe"])
    employee_output = sorted(employees.values(), key=lambda row: (-row["hours"], row["name"]))
    return {
        "year": selected_year, "month": selected_month, "sites": site_output, "site_options": site_options,
        "societies": society_output,
        "employees": employee_output, "months": months, "alerts": alerts[:50],
        "summary": {
            "employees": len(employees), "sites": len(sites),
            "entries": sum(row["entries"] for row in months), "exits": sum(row["exits"] for row in months),
            "hours": round(sum(row["minutes"] for row in months) / 60, 1), "alerts": len(alerts),
        },
    }
def _parse_scan_at(value: Any, tz: ZoneInfo) -> datetime | None:
    raw = _clean_text(value)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return (parsed.replace(tzinfo=tz) if parsed.tzinfo is None else parsed).astimezone(tz)
    except ValueError:
        return None


def _compute_attendance_alerts(rows: list[dict[str, Any]], now: datetime, tz: ZoneInfo) -> dict[str, Any]:
    """Logique pure (sans accès DB) : isolée pour pouvoir être testée avec un `now`
    maîtrisé, sans dépendre de l'heure réelle d'exécution des tests."""
    parsed_rows: list[tuple[datetime, dict[str, Any]]] = []
    for row in rows:
        at = _parse_scan_at(row.get("scannedAt"), tz)
        if at:
            parsed_rows.append((at, row))

    by_employee: dict[str, list[tuple[datetime, dict[str, Any]]]] = {}
    for at, row in parsed_rows:
        key = str(row.get("employeeId") or row.get("matricule") or "")
        if key:
            by_employee.setdefault(key, []).append((at, row))

    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    presence_alerts: list[dict[str, Any]] = []
    weekly_alerts: list[dict[str, Any]] = []

    for events in by_employee.values():
        events.sort(key=lambda pair: pair[0])
        last_at, last_row = events[-1]

        # Seuils absolus (8h/12h/16h) : s'appliquent à tout le monde de la même façon,
        # peu importe la durée de vacation normalement prévue pour le site/poste — objectif
        # sécurité/fatigue, pas contractuel (contrairement à overtime_alert au départ).
        if last_row.get("action") == "arrivee":
            elapsed = now - last_at
            if elapsed >= timedelta(0):
                elapsed_minutes = int(elapsed.total_seconds() // 60)
                threshold = 16 if elapsed_minutes >= 960 else 12 if elapsed_minutes >= 720 else 8 if elapsed_minutes >= 480 else 0
                if threshold:
                    presence_alerts.append({
                        "employee_id": last_row.get("employeeId"),
                        "matricule": last_row.get("matricule") or "",
                        "nom": last_row.get("agentName") or "Employé",
                        "site": last_row.get("site") or "",
                        "arrival_at": last_at.isoformat(),
                        "elapsed_minutes": elapsed_minutes,
                        "threshold_hours": threshold,
                    })

        # Total hebdomadaire : uniquement les vacations terminées (paires arrivée→départ)
        # depuis lundi. Une arrivée sans départ correspondant est la vacation en cours,
        # volontairement exclue (déjà couverte par l'alerte de présence ci-dessus).
        open_arrival_at: datetime | None = None
        week_minutes = 0
        for at, row in events:
            if at < week_start:
                continue
            if row.get("action") == "arrivee":
                open_arrival_at = at
            elif row.get("action") == "depart" and open_arrival_at is not None:
                week_minutes += max(0, int((at - open_arrival_at).total_seconds() // 60))
                open_arrival_at = None
        if week_minutes >= 2400:
            weekly_alerts.append({
                "employee_id": last_row.get("employeeId"),
                "matricule": last_row.get("matricule") or "",
                "nom": last_row.get("agentName") or "Employé",
                "week_minutes": week_minutes,
                "week_hours": round(week_minutes / 60, 1),
            })

    presence_alerts.sort(key=lambda a: -a["elapsed_minutes"])
    weekly_alerts.sort(key=lambda a: -a["week_minutes"])
    return {"presence_alerts": presence_alerts, "weekly_alerts": weekly_alerts}


@router.get("/attendance-alerts")
def attendance_alerts(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """Alertes de présence prolongée (seuils absolus 8h/12h/16h, pour repérer un agent
    resté trop longtemps sur site quel que soit son régime de rotation) et de
    dépassement hebdomadaire (40h de vacations déjà terminées depuis lundi, la
    vacation en cours n'est pas comptée). Recalculé à partir du même journal
    attendanceQrScans que /attendance-feed (aucune donnée dédiée), avec le même
    filtrage par périmètre sites/société via _allowed_assignment_site_ids."""
    tz = ZoneInfo("Africa/Algiers")
    now = datetime.now(tz)
    allowed_site_ids = _allowed_assignment_site_ids(db, user)

    # 4 jours de recul : assez large pour couvrir une vacation ouverte depuis avant-hier
    # (rotations longues comprises), sans avoir à charger tout l'historique.
    cutoff = now - timedelta(days=4)
    rows = [
        row for row in service.list_items(db, "attendanceQrScans")
        if isinstance(row, dict) and row.get("action") in {"arrivee", "depart"}
    ]
    if allowed_site_ids is not None:
        allowed = set(allowed_site_ids)
        rows = [row for row in rows if row.get("siteId") in allowed]
    rows = [row for row in rows if (_parse_scan_at(row.get("scannedAt"), tz) or cutoff) >= cutoff]

    return _compute_attendance_alerts(rows, now, tz)


def _employee_search_result(db: Session, employee: Employee) -> dict[str, Any]:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    photo = next(
        (
            _clean_text(extra.get(key) or legacy.get(key))
            for key in ("photo", "photoUrl", "photoData", "photo_url")
            if extra.get(key) or legacy.get(key)
        ),
        "",
    )
    assignment = db.execute(
        select(Assignment).where(Assignment.employee_id == employee.id, Assignment.active == 1).order_by(Assignment.id.desc())
    ).scalars().first()
    site = db.get(Site, assignment.site_id) if assignment and assignment.site_id else None
    return {
        "id": employee.id,
        "matricule": employee.code,
        "nom": employee.last_name,
        "prenom": employee.first_name,
        "photo": photo,
        "societe": employee.society or "",
        "poste": employee.position or "",
        "statut": employee.status or "",
        "site": (site.name or site.indicatif or "") if site else "",
    }


@router.get("/attendance-manual/search")
def search_employee_for_manual_attendance(
    q: str = "",
    db: Session = Depends(get_db),
    scanner: User = Depends(current_user),
) -> list[dict[str, Any]]:
    """Recherche par code ou nom/prénom pour le pointage manuel (employé sans smartphone,
    ou QR illisible) : le pointeur tape le code ou le nom donné par l'employé, choisit la
    bonne fiche dans la liste, puis confirme le pointage via /attendance-manual/scan."""
    query = _clean_text(q)
    if len(query) < 2:
        return []
    like = f"%{query}%"
    stmt = (
        select(Employee)
        .where(
            Employee.status == "actif",
            or_(
                Employee.code.ilike(like),
                Employee.first_name.ilike(like),
                Employee.last_name.ilike(like),
                (Employee.last_name + " " + Employee.first_name).ilike(like),
                (Employee.first_name + " " + Employee.last_name).ilike(like),
            ),
        )
        .order_by(Employee.last_name, Employee.first_name)
        .limit(8)
    )
    rows = db.execute(stmt).scalars().all()
    allowed_site_ids = _allowed_assignment_site_ids(db, scanner)
    if allowed_site_ids is not None:
        allowed = set(allowed_site_ids)
        employee_ids = {row.id for row in rows}
        permitted_employee_ids = {
            assignment.employee_id
            for assignment in db.execute(
                select(Assignment).where(
                    Assignment.employee_id.in_(employee_ids),
                    Assignment.active == 1,
                    Assignment.site_id.in_(allowed),
                )
            ).scalars().all()
        } if employee_ids and allowed else set()
        rows = [row for row in rows if row.id in permitted_employee_ids]
    return [_employee_search_result(db, row) for row in rows]


@router.post("/attendance-manual/scan", status_code=status.HTTP_201_CREATED)
def manual_employee_attendance_scan(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    scanner: User = Depends(current_user),
) -> dict[str, Any]:
    """Pointage saisi par le pointeur au nom d'un employé sans smartphone (identifié par
    code ou nom via /attendance-manual/search), au lieu d'un scan QR."""
    employee = employee_by_ref(db, payload.get("employee_id"))
    if not employee:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    _ensure_attendance_employee_scope(db, scanner, employee)
    nonce = f"manual-{secrets.token_urlsafe(12)}"
    return _register_attendance(
        db,
        employee,
        scanner,
        nonce,
        "portail-rh-employee-manuel",
        _clean_text(payload.get("observation")),
    )


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
    attendance_events = [
        event
        for event in service.list_items(db, "attendanceQrScans")
        if isinstance(event, dict) and _clean_text(event.get("matricule")).lower() == key
    ]
    attendance_dates: set[str] = set()
    for event in attendance_events:
        scanned_at = _clean_text(event.get("scannedAt"))
        scan_date = scanned_at[:10]
        attendance_dates.add(scan_date)
        rows.append({
            "id": f"attendance-{event.get('id')}",
            "date": scan_date,
            "createdAt": scanned_at,
            "heure": scanned_at[11:19],
            "action": event.get("action") or "arrivee",
            "cycle": event.get("cycle") or 1,
            "site": event.get("site") or "",
            "source": "employee-qr",
        })
    if employee:
        daily_rows = db.execute(
            select(DailyPresence).where(DailyPresence.employee_id == employee.id).order_by(DailyPresence.presence_date.desc(), DailyPresence.id.desc())
        ).scalars().all()
        for row in daily_rows:
            if row.presence_date.isoformat() in attendance_dates:
                continue
            legacy = ((row.data or {}).get("_legacy") if isinstance(row.data, dict) else {}) or {}
            if row.arrival_time == "P" or legacy.get("code") == "P" or legacy.get("scanArrivee"):
                arrival = _clean_text(legacy.get("scanArrivee"))
                rows.append({
                    "id": f"qr-{row.id}",
                    "date": row.presence_date.isoformat(),
                    "createdAt": f"{row.presence_date.isoformat()}T{arrival or '00:00:00'}",
                    "heure": arrival,
                    "action": "arrivee",
                    "site": legacy.get("siteName") or "",
                    "source": "qr",
                })
            departure = _clean_text(legacy.get("scanDepart") or row.departure_time)
            if departure:
                rows.append({
                    "id": f"qr-depart-{row.id}",
                    "date": row.presence_date.isoformat(),
                    "createdAt": f"{row.presence_date.isoformat()}T{departure}",
                    "heure": departure,
                    "action": "depart",
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


def _public_portal_account(account: dict[str, Any]) -> dict[str, Any]:
    result = {k: v for k, v in account.items() if k != "passwordHash"}
    result["temporaryPassword"] = PORTAL_TEMPORARY_PASSWORD if account.get("mustChangePassword") else ""
    return result


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
    return [_public_portal_account(a) for a in rows]


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
def create_portal_account(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    matricule_raw = _clean_text(payload.get("matricule"))
    if not matricule_raw:
        raise HTTPException(status_code=400, detail="Matricule obligatoire")

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
        "passwordHash": hash_password(PORTAL_TEMPORARY_PASSWORD),
        "nom": _agent_field(agent, "nom"),
        "prenom": _agent_field(agent, "prenom", "prénom"),
        "societe": _agent_field(agent, "societe"),
        "active": True,
        "mustChangePassword": True,
        "temporaryPasswordIssuedAt": datetime.now(timezone.utc).isoformat(),
        "passwordChangedAt": "",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "createdBy": admin.username,
    }
    created = service.create_item(db, "portalAccounts", account)
    return _public_portal_account(created)


@router.get("/accounts/{matricule}")
def get_portal_account(
    matricule: str,
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Aucun compte portail pour cet employé")
    return _public_portal_account(account)


@router.put("/accounts/{matricule}/password")
def reset_portal_password(
    matricule: str,
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Aucun compte portail pour cet employé")
    issued_at = datetime.now(timezone.utc).isoformat()
    updated = service.update_item(db, "portalAccounts", account["id"], {
        "passwordHash": hash_password(PORTAL_TEMPORARY_PASSWORD),
        "mustChangePassword": True,
        "temporaryPasswordIssuedAt": issued_at,
        "passwordChangedAt": "",
    })
    return _public_portal_account(updated)


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
    employee_row = employee_by_ref(db, matricule)
    agents = service.list_items(db, "agents")
    agent = next(
        (a for a in agents if isinstance(a, dict) and _norm_text(_agent_field(a, "matricule", "code")) == _norm_text(matricule)),
        None,
    )
    blocked_reason = _employee_portal_block_reason(employee_row or agent)
    if blocked_reason:
        raise HTTPException(status_code=403, detail=blocked_reason)

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
        "photo": _agent_field(agent, "photo", "photoUrl", "photoData", "photo_url") if agent else "",
    }
    return {
        "portal_token": portal_token,
        "employee": employee,
        "must_change_password": bool(account.get("mustChangePassword")),
    }


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

    if new_password == PORTAL_TEMPORARY_PASSWORD:
        raise HTTPException(status_code=400, detail="Choisissez un mot de passe différent du mot de passe provisoire")
    changed_at = datetime.now(timezone.utc).isoformat()
    service.update_item(db, "portalAccounts", account["id"], {
        "passwordHash": hash_password(new_password),
        "mustChangePassword": False,
        "passwordChangedAt": changed_at,
    })
    return {"ok": True, "passwordChangedAt": changed_at}


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
