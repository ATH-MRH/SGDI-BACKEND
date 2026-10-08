import hashlib
import math
import re
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.audit import append_audit
from app.core.config import settings
from app.core.scope_policy import ScopeKind, SocietyScope, society_scope, society_key
from app.core.security import create_access_token, decode_token, hash_password, verify_password
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import PortalPasswordResetToken, User
from app.modules.commercial.models import Client
from app.modules.drh.models import Employee
from app.modules.irongs import service
from app.modules.irongs.models import Position
from app.modules.irongs.sql_bridge import employee_by_ref
from app.modules.ops.models import Assignment, DailyPresence, RotationTemplate, Site
from app.modules.ops.routes import _allowed_assignment_site_ids, _site_society


from app.modules.attendance import core as attendance_core
from app.modules.attendance.models import SOURCE_MANUAL, SOURCE_PORTAL_GPS, SOURCE_QR

router = APIRouter()

PORTAL_TOKEN_TTL = 60 * 24  # 24 heures
ATTENDANCE_QR_REFRESH_SECONDS = 10
# Mobile browsers may suspend JavaScript briefly when the screen locks or the
# application is backgrounded. Keep a short server-side grace period while the
# displayed QR is still replaced every ten seconds and remains single-use.
ATTENDANCE_QR_TTL_SECONDS = 120
FEED_MULTI_DAY_LIMIT = 20000
FEED_DAILY_LIMIT = 1000
# Règles de bascule arrivée/départ et durée autorisée : implémentation unique dans
# Attendance Core (app/modules/attendance/core.py). Alias conservé pour les appelants.
_authorized_work_minutes = attendance_core.authorized_work_minutes


def attendance_core_intent_reentry() -> str:
    from app.modules.attendance import counted as counted_time
    return counted_time.INTENT_REENTRY


def _attendance_society_scope(db: Session, user: User) -> SocietyScope:
    """Legacy site-only grants imply only the societies of those explicit sites.

    Explicit society grants still intersect site grants. Empty grants never imply
    global access, and deriving a society does not grant its other sites.
    """
    scope = society_scope(user)
    if scope.kind is not ScopeKind.NONE:
        return scope
    site_ids = _allowed_assignment_site_ids(db, user)
    if not site_ids:
        return scope
    sites = db.execute(select(Site).where(Site.active == 1, Site.id.in_(site_ids))).scalars()
    societies = frozenset(society_key(_site_society(site)) for site in sites if society_key(_site_society(site)))
    return SocietyScope(ScopeKind.LIMITED if societies else ScopeKind.NONE, societies)


def _ensure_attendance_employee_scope(db: Session, scanner: User, employee: Employee, requested_society: str | None = None) -> None:
    scope = _attendance_society_scope(db, scanner)
    if requested_society and (not scope.allows(requested_society)
                              or society_key(requested_society) != society_key(employee.society)):
        raise HTTPException(status_code=403, detail="Employé hors de la société sélectionnée")
    if not scope.allows(employee.society):
        raise HTTPException(status_code=403, detail="Société non autorisée")
    allowed_site_ids = _attendance_selected_sites(db, scanner)
    if allowed_site_ids is None:
        return
    assignment = attendance_core.active_assignment(db, employee.id)
    permitted = assignment and assignment.site_id in allowed_site_ids
    if not permitted:
        raise HTTPException(status_code=403, detail="Employé hors du périmètre société/site du pointeur")


def _ensure_selected_site_access(db: Session, scanner: User, site_id: Any) -> None:
    """Refuse les sites injectés hors périmètre ; conserve les conflits métier admin."""
    if site_id in (None, ""):
        return
    if _attendance_selected_sites(db, scanner) is not None:
        _attendance_selected_sites(db, scanner, site_id)


def _ensure_employee_on_selected_site(db: Session, employee: Employee, site_id: Any) -> None:
    if site_id in (None, ""):
        return
    try:
        selected_site_id = int(site_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Site de pointage invalide")
    assignment = db.execute(select(Assignment.id).where(
        Assignment.employee_id == employee.id,
        Assignment.site_id == selected_site_id,
        Assignment.active == 1,
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=409, detail="Cet employé n’est pas affecté au site sélectionné")


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
    # Périmètre réel du compte (sociétés explicites, ou sociétés de ses sites) : un compte sans
    # aucun périmètre ne voit rien — auparavant un périmètre vide valait « toutes les sociétés ».
    scope = _attendance_society_scope(db, user)
    if scope.kind is ScopeKind.NONE:
        raise HTTPException(status_code=403, detail="Aucun périmètre société explicite")
    if requested_key and not scope.allows(society):
        raise HTTPException(status_code=403, detail="Société non autorisée")
    employees = db.execute(select(Employee).order_by(Employee.last_name, Employee.first_name)).scalars().all()
    employees = [row for row in employees if not _employee_portal_block_reason(row)]
    if requested_key:
        employees = [row for row in employees if society_key(row.society) == requested_key]
    elif scope.kind is not ScopeKind.GLOBAL:
        employees = [row for row in employees if scope.allows(row.society)]

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
    # Adaptateur de compatibilité : l'ancienne preuve d'identité seule est refusée.
    return portal_confirm_password_reset(payload, request, db)


def _reset_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/password-reset/request")
def portal_request_password_reset(payload: dict[str, Any], request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _limit_public(request, "reset-request", 8)
    matricule = _clean_text(payload.get("code") or payload.get("matricule"))
    account = _find_portal_account(db, matricule) if matricule else None
    if account:
        raw_token = secrets.token_urlsafe(32)
        now = datetime.utcnow()
        db.query(PortalPasswordResetToken).filter(
            PortalPasswordResetToken.account_id == str(account["id"]),
            PortalPasswordResetToken.used_at.is_(None),
        ).update({"used_at": now}, synchronize_session=False)
        db.add(PortalPasswordResetToken(
            account_id=str(account["id"]), token_hash=_reset_token_hash(raw_token),
            delivery_channel=_clean_text(payload.get("channel") or "pending"),
            delivery_target_masked=None,
            expires_at=now + timedelta(minutes=settings.portal_password_reset_ttl_minutes),
        ))
        append_audit(db, action="portal.password_reset.request", resource="portal_account",
                     resource_id=account["id"], society=account.get("societe"), result="success", request=request)
        db.commit()
        # Le jeton brut sera transmis par un adaptateur email/SMS futur ; jamais dans la réponse/log.
    return {"ok": True, "message": "Si le compte existe, une procédure de récupération a été initiée."}


@router.post("/password-reset/confirm")
def portal_confirm_password_reset(payload: dict[str, Any], request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _limit_public(request, "reset-confirm", 8)
    token = _clean_text(payload.get("token") or payload.get("resetToken"))
    password = _clean_text(payload.get("password") or payload.get("newPassword"))
    if not token or len(password) < 12:
        raise HTTPException(status_code=400, detail="Jeton requis et mot de passe de 12 caractères minimum")
    now = datetime.utcnow()
    row = db.query(PortalPasswordResetToken).filter(
        PortalPasswordResetToken.token_hash == _reset_token_hash(token),
        PortalPasswordResetToken.used_at.is_(None),
        PortalPasswordResetToken.expires_at > now,
    ).one_or_none()
    if row is None:
        append_audit(db, action="portal.password_reset.confirm", resource="portal_account",
                     result="refused", request=request)
        db.commit()
        raise HTTPException(status_code=400, detail="Jeton invalide, expiré ou déjà utilisé")
    account = service.get_item(db, "portalAccounts", row.account_id)
    service.update_item(db, "portalAccounts", account["id"], {
        "passwordHash": hash_password(password), "mustChangePassword": False,
        "passwordChangedAt": datetime.now(timezone.utc).isoformat(),
    })
    row.used_at = now
    append_audit(db, action="portal.password_reset.confirm", resource="portal_account",
                 resource_id=account["id"], society=account.get("societe"), result="success", request=request)
    db.commit()
    return {"ok": True, "message": "Mot de passe réinitialisé"}


def _require_portal_account_manager(user: User, account: dict[str, Any] | None = None) -> None:
    role = str(user.role or "").strip().lower()
    structures = {str(value or "").strip().lower() for value in (user.authorized_structures or [])}
    if role not in {"admin", "adm", "adm1", "adm2", "rh", "drh", "recruteur"} and not (
        structures & {"admin", "rh", "drh", "recrutement", "gestionnaire_rh"}
    ):
        raise HTTPException(status_code=403, detail="Action réservée à la DRH ou à l'administration")
    if account:
        scope = society_scope(user)
        if scope.kind is ScopeKind.NONE or not scope.allows(account.get("societe")):
            raise HTTPException(status_code=403, detail="Compte salarié hors périmètre société")


@router.post("/password-reset/manual-token")
def portal_issue_manual_reset_token(
    payload: dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    manager: User = Depends(current_user),
) -> dict[str, Any]:
    """Remise RH hors bande : le jeton brut n'est affiché qu'une fois au gestionnaire."""
    matricule = _clean_text(payload.get("code") or payload.get("matricule"))
    account = _find_portal_account(db, matricule) if matricule else None
    if not account:
        raise HTTPException(status_code=404, detail="Compte portail introuvable")
    _require_portal_account_manager(manager, account)
    raw_token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    db.query(PortalPasswordResetToken).filter(
        PortalPasswordResetToken.account_id == str(account["id"]),
        PortalPasswordResetToken.used_at.is_(None),
    ).update({"used_at": now}, synchronize_session=False)
    db.add(PortalPasswordResetToken(
        account_id=str(account["id"]), token_hash=_reset_token_hash(raw_token),
        delivery_channel="manual_rh", delivery_target_masked="remise manuelle",
        expires_at=now + timedelta(minutes=settings.portal_password_reset_ttl_minutes),
    ))
    append_audit(db, action="portal.password_reset.manual_issue", resource="portal_account",
                 resource_id=account["id"], society=account.get("societe"), result="success",
                 user=manager, request=request, new_state={"channel": "manual_rh"})
    db.commit()
    return {"ok": True, "resetToken": raw_token, "expiresInMinutes": settings.portal_password_reset_ttl_minutes}


@router.post("/demandes", status_code=status.HTTP_201_CREATED)
def create_demande(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload invalide")
    demande = _to_demande(payload)
    if not demande.get("id"):
        demande.pop("id", None)
    return service.create_item(db, "demandesPersonnel", demande)


def _ensure_portal_self(authorization: str | None, matricule: str) -> None:
    """Un pointage portail n'est accepté que de l'employé lui-même, authentifié par son
    jeton portail (même contrôle que /attendance-qr). Sans cette garde, n'importe qui
    pouvait créer une présence pour n'importe quel matricule."""
    identity = _portal_identity(authorization)
    if identity.strip().upper() != str(matricule or "").strip().upper():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé")


@router.post("/pointages", status_code=status.HTTP_201_CREATED)
def create_pointage(payload: dict[str, Any], db: Session = Depends(get_db), authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload invalide")
    pointage = _to_pointage(payload)
    if not pointage.get("matricule"):
        raise HTTPException(status_code=400, detail="Code employé obligatoire")
    _ensure_portal_self(authorization, pointage["matricule"])
    # Date et heure imposées par le serveur : un client ne peut jamais antidater une présence.
    server_now = datetime.now(ZoneInfo("Africa/Algiers"))
    pointage["date"] = server_now.strftime("%Y-%m-%d")
    pointage["heure"] = server_now.strftime("%H:%M")
    position = pointage.get("position") if isinstance(pointage.get("position"), dict) else {}
    if not pointage.get("id"):
        pointage.pop("id", None)
    saved = service.create_item(db, "pointagesPortail", pointage)
    # Présence via Attendance Core : l'arrivée/le départ découle de l'état réel de la journée,
    # jamais de l'action envoyée par le client.
    employee = employee_by_ref(db, pointage["matricule"])
    if employee:
        gps = {}
        if position.get("lat") and position.get("lng"):
            gps = {"posGpsLat": position["lat"], "posGpsLng": position["lng"]}
            if position.get("accuracy"):
                gps["posGpsAccuracy"] = position["accuracy"]
        attendance_core.record_scan(
            db, employee=employee, source=SOURCE_PORTAL_GPS, actor=None,
            idempotency_key=(f"portal-{pointage['ref']}" if pointage.get("ref") else None), extra=gps,
        )
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
    # Le jeton QR de cette route historique n'est qu'un créneau horaire non signé (calculable
    # par n'importe qui) : l'authentification portail de l'employé lui-même est donc
    # obligatoire — auparavant optionnelle, ce qui permettait de pointer sans être connecté.
    _ensure_portal_self(authorization, matricule)
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
    result = attendance_core.record_scan(db, employee=employee, source=SOURCE_QR, actor=None, idempotency_key=None)
    return {
        **result,
        "message": "Déjà enregistré" if result.get("duplicate") else "PRÉSENT",
        "employee": {k: result["employee"][k] for k in ("id", "matricule", "nom", "prenom")},
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


EXTRA_SHIFT_ENTRY = "EXTRA_SHIFT_ENTRY"


def _manual_entry_granted(db: Session, user: User) -> bool:
    """Permission explicite attendance / manual_entry / create (refus par défaut)."""
    from app.core.granular_permissions import is_global_administrator, load_feature_permissions

    return is_global_administrator(user) or any(
        g.module_key == "attendance" and g.feature_key == "manual_entry" and g.action_key == "create"
        for g in load_feature_permissions(db, user.id))


def _register_attendance(
    db: Session,
    employee: Any,
    scanner: User,
    nonce: str,
    source: str,
    observation: str = "",
    **core_options: Any,
) -> dict[str, Any]:
    """Pointage QR / saisie manuelle : délégué à Attendance Core (seul point d'écriture de la
    présence). `nonce` est la clé d'idempotence de l'événement ; `source` (libellé historique)
    ne sert plus qu'à distinguer la saisie manuelle du scan QR."""
    core_source = SOURCE_MANUAL if (nonce.startswith("manual-") or "manuel" in source) else SOURCE_QR
    return attendance_core.record_scan(
        db, employee=employee, source=core_source, actor=scanner, idempotency_key=nonce, observation=observation,
        **core_options,
    )


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
    if attendance_core.key_used(db, nonce):
        raise HTTPException(status_code=409, detail="Ce QR a déjà été utilisé")

    employee = employee_by_ref(db, str(qr.get("sub") or ""))
    if not employee or int(qr.get("employee_id") or 0) != employee.id:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    _ensure_attendance_employee_scope(db, scanner, employee, payload.get("society"))
    _ensure_selected_site_access(db, scanner, payload.get("site_id"))
    _ensure_employee_on_selected_site(db, employee, payload.get("site_id"))
    return _register_attendance(db, employee, scanner, nonce, "portail-rh-employee-qr")


def _attendance_selected_sites(db: Session, user: User, site_id: int | None = None,
                               society: str | None = None) -> set[int] | None:
    """Intersection explicite des sociétés et sites autorisés, jamais union des droits."""
    scope = _attendance_society_scope(db, user)
    if society and not scope.allows(society):
        raise HTTPException(status_code=403, detail="Société non autorisée")
    allowed_site_ids = _allowed_assignment_site_ids(db, user)
    if scope.kind is ScopeKind.GLOBAL and allowed_site_ids is None and not society and site_id is None:
        return None
    candidates = db.execute(select(Site).where(Site.active == 1)).scalars().all()
    allowed = {site.id for site in candidates
               if (allowed_site_ids is None or site.id in allowed_site_ids)
               and scope.allows(_site_society(site))
               and (not society or society_key(_site_society(site)) == society_key(society))}
    if site_id is not None:
        site = db.get(Site, site_id)
        if not site or not site.active:
            raise HTTPException(status_code=404, detail="Site de pointage introuvable")
        if site_id not in allowed:
            raise HTTPException(status_code=403, detail="Site non autorisé pour ce compte Pointeur")
        return {site_id}
    return allowed


@router.get("/attendance-sites")
def attendance_sites(db: Session = Depends(get_db), user: User = Depends(current_user), society: str | None = None) -> list[dict[str, Any]]:
    selected = _attendance_selected_sites(db, user, society=society)
    query = select(Site).where(Site.active == 1).order_by(Site.name)
    if selected is not None:
        query = query.where(Site.id.in_(selected))
    return [{"id": site.id, "name": site.name, "indicatif": site.indicatif or "", "society": _site_society(site) or ""} for site in db.execute(query).scalars().all()]


@router.get("/attendance-sheet")
def attendance_sheet(
    site_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    society: str | None = None,
) -> dict[str, Any]:
    """Poste de pointage : FEUILLE ACTIVE de la rotation en cours du site (une ligne par
    employé), et non l'historique de la journée. Sans paramètres de rotation pour ce site —
    ou sans site unique — `configured` est faux et le poste garde son affichage historique."""
    from app.modules.attendance import sheets

    selected = _attendance_selected_sites(db, user, site_id, society)
    if selected is None or len(selected) != 1:
        return {"configured": False, "site_id": site_id, "sheet": None, "next": None, "reason": "site_required"}
    view = sheets.active_view(db, next(iter(selected)))
    db.commit()
    return view


@router.get("/attendance-live")
def attendance_live(
    site_id: int | None = None,
    after_id: int | None = None,
    after_refusal_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    society: str | None = None,
) -> dict[str, Any]:
    """Poste de sécurité : passages ACCEPTÉS par Attendance Core depuis `after_id` (sans curseur :
    le dernier), refus récents des terminaux, compteurs canoniques. Lecture seule, même
    périmètre sites que le flux de pointage. Interrogée toutes les ~2 s par le PC."""
    from app.modules.attendance import live

    allowed_site_ids = _attendance_selected_sites(db, user, site_id, society)
    return live.live(db, allowed_site_ids, after_id=after_id, after_refusal_id=after_refusal_id,
                     manual_entry=_manual_entry_granted(db, user))


@router.get("/attendance-employee/{employee_id}/portrait")
def attendance_employee_portrait(employee_id: int, site_id: int | None = None, db: Session = Depends(get_db),
                                 user: User = Depends(current_user), society: str | None = None,
) -> Response:
    """Portrait de présentation (visage agrandi, fond blanc) d'un employé du périmètre du poste :
    affecté à un site autorisé, ou ayant pointé sur un site autorisé. Jamais d'URL publique."""
    from app.modules.attendance.models import AttendanceEvent
    from app.modules.drh import portrait
    from app.modules.ops.models import Assignment

    allowed_site_ids = _attendance_selected_sites(db, user, site_id, society)
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    if allowed_site_ids is not None:
        allowed = list(allowed_site_ids) or [-1]
        visible = db.execute(select(Assignment.id).where(Assignment.employee_id == employee_id, Assignment.site_id.in_(allowed)).limit(1)).first() \
            or db.execute(select(AttendanceEvent.id).where(AttendanceEvent.employee_id == employee_id, AttendanceEvent.site_id.in_(allowed)).limit(1)).first()
        if not visible:
            raise HTTPException(status_code=404, detail="Employé introuvable")
    try:
        result = portrait.portrait_for(db, employee)
    except ValueError:
        result = None
    if result is None:
        raise HTTPException(status_code=404, detail="Aucun portrait disponible")
    return Response(content=result.image, media_type="image/jpeg",
                    headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Portrait-Method": result.method})


@router.get("/attendance-anomalies")
def attendance_anomalies(site_id: int | None = None, society: str | None = None, date: str | None = None,
                         db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    """Journal d'anomalies existantes, filtré en SQL, aucune création ni résolution."""
    from app.modules.attendance.models import AttendanceAnomaly
    selected = _attendance_selected_sites(db, user, site_id, society)
    try:
        day = datetime.fromisoformat(date).date() if date else datetime.now(ZoneInfo("Africa/Algiers")).date()
    except ValueError:
        raise HTTPException(422, "Date de suivi invalide")
    rows = db.execute(select(AttendanceAnomaly).where(*([AttendanceAnomaly.site_id.in_(selected)] if selected is not None else []),
        AttendanceAnomaly.presence_date == day).order_by(AttendanceAnomaly.id.desc()).limit(200)).scalars().all()
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_({r.employee_id for r in rows}))).scalars()} if rows else {}
    sites = {s.id: s for s in db.execute(select(Site).where(*([Site.id.in_(selected)] if selected is not None else []))).scalars()}
    return [{"id": r.id, "employee": attendance_core._employee_card(employees[r.employee_id], "") if r.employee_id in employees else {},
             "site": sites[r.site_id].name if r.site_id in sites else "", "code": r.anomaly_type,
             "message": r.message, "observation": r.message, "at": attendance_core.to_local(r.created_at).isoformat(),
             "status": r.status, "action": None} for r in rows]


@router.get("/attendance-feed")
def attendance_feed(
    since: str | None = None,
    limit: int = 50,
    include_daily: bool = False,
    days: int = 2,
    date: str | None = None,
    site_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    society: str | None = None,
) -> list[dict[str, Any]] | dict[str, Any]:
    """Flux des derniers pointages (arrivée/départ), pour l'écran de supervision temps réel
    (interrogé par polling toutes les quelques secondes). Filtré selon le même périmètre
    sites/société qu'un superviseur OPS (_allowed_assignment_site_ids) : un compte restreint
    à certains sites ne voit que leurs pointages, pas ceux de toute l'entreprise."""
    days = max(2, min(days, 8))
    # Vue multi-jours (planning) : le plafond client de 2000 lignes faisait disparaître sans
    # signal les jours les plus anciens dès ~125 agents. Le serveur garantit la fenêtre demandée.
    limit = FEED_MULTI_DAY_LIMIT if days > 2 else max(1, min(limit, 200))
    allowed_site_ids = _attendance_selected_sites(db, user, site_id, society)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    until = None
    if date:
        try:
            cutoff = datetime.fromisoformat(date).replace(tzinfo=ZoneInfo("Africa/Algiers"))
            until = cutoff + timedelta(days=1)
        except ValueError:
            raise HTTPException(status_code=422, detail="Date de suivi invalide")

    def within_retention(row: dict[str, Any]) -> bool:
        raw = _clean_text(row.get("scannedAt"))
        if not raw:
            return False
        try:
            scanned_at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if scanned_at.tzinfo is None:
                scanned_at = scanned_at.replace(tzinfo=timezone.utc)
            return scanned_at.astimezone(timezone.utc) >= cutoff and (until is None or scanned_at < until)
        except ValueError:
            return False

    rows = [
        row for row in attendance_core.scan_rows(db, site_ids=allowed_site_ids, since=cutoff - timedelta(microseconds=1), until=until - timedelta(microseconds=1) if until else None)
        if within_retention(row)
    ]
    if allowed_site_ids is not None:
        allowed = set(allowed_site_ids)
        rows = [row for row in rows if row.get("siteId") in allowed]
    since_value = _clean_text(since)
    if since_value:
        rows = [row for row in rows if _clean_text(row.get("scannedAt")) > since_value]
    rows.sort(key=lambda row: _clean_text(row.get("scannedAt")), reverse=True)
    absence_rows = db.execute(
        select(DailyPresence).where(
            DailyPresence.presence_date >= cutoff.astimezone(ZoneInfo("Africa/Algiers")).date(),
            DailyPresence.status == "absent",
            *([DailyPresence.presence_date < until.date()] if until else []),
        ).order_by(DailyPresence.presence_date.desc(), DailyPresence.id.desc())
    ).scalars().all()
    if allowed_site_ids is not None:
        allowed = set(allowed_site_ids)
        absence_rows = [row for row in absence_rows if row.site_id in allowed]
    absence_employee_ids = {row.employee_id for row in absence_rows}
    employee_ids = {
        int(row.get("employeeId")) for row in rows
        if str(row.get("employeeId") or "").strip().isdigit()
    } | absence_employee_ids
    employees_by_id = {
        employee.id: employee for employee in db.execute(
            select(Employee).where(Employee.id.in_(employee_ids))
        ).scalars().all()
    } if employee_ids else {}

    def employee_photo(employee: Employee | None) -> str:
        if employee is None:
            return ""
        extra = employee.extra if isinstance(employee.extra, dict) else {}
        legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
        return next(
            (_clean_text(extra.get(key) or legacy.get(key)) for key in ("photo", "photoUrl", "photoData", "photo_url") if extra.get(key) or legacy.get(key)),
            "",
        )

    from app.modules.attendance.models import AttendanceEvent, EVENT_ABANDON
    abandon_rows = db.execute(select(AttendanceEvent).where(AttendanceEvent.event_type == EVENT_ABANDON,
        *([AttendanceEvent.site_id.in_(allowed_site_ids)] if allowed_site_ids is not None else []), AttendanceEvent.occurred_at >= attendance_core.to_utc_naive(cutoff))).scalars().all()
    abandon_departures = {r.data.get("departure_event_id") for r in abandon_rows if isinstance(r.data, dict)}
    feed = [
        {
            "id": row.get("id"),
            "employee_id": row.get("employeeId"),
            "matricule": row.get("matricule") or (employees_by_id.get(int(row.get("employeeId"))).code if str(row.get("employeeId") or "").isdigit() and employees_by_id.get(int(row.get("employeeId"))) else ""),
            "nom": row.get("agentName") or (" ".join(filter(None, [employees_by_id.get(int(row.get("employeeId"))).last_name, employees_by_id.get(int(row.get("employeeId"))).first_name])).strip() if str(row.get("employeeId") or "").isdigit() and employees_by_id.get(int(row.get("employeeId"))) else "Employé inconnu"),
            "poste": (employees_by_id.get(int(row.get("employeeId"))).position if str(row.get("employeeId") or "").isdigit() and employees_by_id.get(int(row.get("employeeId"))) else _clean_text(row.get("poste"))),
            "societe": row.get("societe") or (employees_by_id.get(int(row.get("employeeId"))).society if str(row.get("employeeId") or "").isdigit() and employees_by_id.get(int(row.get("employeeId"))) else ""),
            # Vue multi-jours (planning) : pas de photo — elle n'y est pas affichée et alourdirait
            # la réponse de plusieurs milliers de lignes.
            "photo": employee_photo(employees_by_id.get(int(row.get("employeeId")))) if days <= 2 and str(row.get("employeeId") or "").isdigit() else "",
            "action": row.get("action") or "arrivee",
            "cycle": row.get("cycle") or 1,
            "site": row.get("site") or "",
            "site_id": row.get("siteId"),
            "scanned_at": row.get("scannedAt") or "",
            "presence_date": row.get("presenceDate") or str(row.get("scannedAt") or "")[:10],
            "scanned_by": row.get("scannedBy") or "",
            "source": row.get("source") or "",
            "duration_minutes": row.get("workedMinutes"),
            "exit_type": "Abandon poste" if row.get("eventId") in abandon_departures else "Sortie",
            "observation": row.get("observation") or "",
        }
        for row in rows
    ]
    for row in absence_rows:
        employee = employees_by_id.get(row.employee_id)
        legacy = ((row.data or {}).get("_legacy") if isinstance(row.data, dict) else {}) or {}
        validated_at = _clean_text(legacy.get("valideAt") or legacy.get("createdAt"))
        scanned_at = validated_at or f"{row.presence_date.isoformat()}T00:00:00+01:00"
        if since_value and scanned_at <= since_value:
            continue
        feed.append({
            "id": f"absence-{row.id}",
            "employee_id": row.employee_id,
            "matricule": legacy.get("matricule") or (employee.code if employee else ""),
            "nom": legacy.get("agentName") or (" ".join(filter(None, [employee.last_name, employee.first_name])).strip() if employee else "Employé inconnu"),
            "poste": employee.position if employee else _clean_text(legacy.get("poste")),
            "societe": legacy.get("societe") or (employee.society if employee else ""),
            "photo": employee_photo(employee),
            "action": "absent",
            "cycle": 1,
            "site": legacy.get("siteName") or "",
            "site_id": row.site_id,
            "scanned_at": scanned_at,
            "scanned_by": legacy.get("validePar") or "",
            "observation": row.notes or legacy.get("observations") or "",
        })
    feed.sort(key=lambda row: _clean_text(row.get("scanned_at")), reverse=True)
    if include_daily:
        daily = {}
        for event in reversed(feed):
            # Journée de PRÉSENCE (celle de l'arrivée) : une nuit 22:00 → 06:00 tient sur une seule
            # ligne. Par jour civil, elle donnait une ligne « En poste » jamais refermée.
            day = str(event.get("presence_date") or event["scanned_at"])[:10]
            key = (event["employee_id"], day)
            row = daily.setdefault(key, {**event, "date": day, "arrival": "", "departure": "", "status": "—"})
            at = str(event["scanned_at"])[11:19]
            if event["action"] == "arrivee":
                row["arrival"] = row["arrival"] or at
                row["departure"] = ""
                row["status"] = "En poste"
            elif event["action"] == "depart":
                row["departure"] = at
                row["status"] = "Sorti"
            elif event["action"] == "absent":
                row["status"] = "Absent"
            row["observation"] = event.get("observation") or row.get("observation", "")
        # Les journées les plus récentes d'abord : la coupe à 200 lignes retirait celles du jour.
        ordered = sorted(daily.values(), key=lambda row: row["date"], reverse=True)
        return {"events": feed[:limit], "daily": ordered[:FEED_DAILY_LIMIT],
                "events_limited": len(feed) > limit, "daily_limited": len(ordered) > FEED_DAILY_LIMIT}
    return feed[:limit]


@router.get("/attendance-staffing")
def attendance_staffing(
    site_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    society: str | None = None,
) -> dict[str, Any]:
    """Effectif contractuel requis pour le shift actuellement en service, par fonction.

    Source canonique UNIQUE : le contrat DC validé et publié depuis dc.irongs.com
    (Client.data.dc_contract_sites, lié via equipment_plan.dcContractSiteKey).

    AUCUN FALLBACK : les anciennes quotas techniques OPS
    (equipment_plan.groupPositionQuotas / positionQuotas) ne sont plus jamais
    présentés comme un besoin contractuel, même en l'absence de contrat DC — ces
    champs restent en base pour l'historique/l'audit (voir rapport de migration)
    mais ne sont plus lus ici. Un site sans contrat DC validé et lié est retourné
    explicitement "non configuré" (source="unconfigured", requirements={}),
    jamais avec des quotas OPS substitués silencieusement.
    """
    allowed_site_ids = _attendance_selected_sites(db, user, site_id, society)
    query = select(Site).where(Site.active == 1).order_by(Site.name)
    if allowed_site_ids is not None:
        query = query.where(Site.id.in_(allowed_site_ids))
    sites = db.execute(query).scalars().all()
    now = datetime.now(ZoneInfo("Africa/Algiers"))

    # Résout d'abord chaque site vers son contrat DC (ou None), sans encore calculer
    # les besoins par shift — permet de collecter en un seul aller-retour tous les
    # position_id référencés, pour rafraîchir leurs libellés depuis le référentiel
    # canonique (le label n'est qu'une représentation, jamais l'identité métier).
    site_dc_pairs: list[tuple[Site, dict[str, Any] | None]] = []
    referenced_position_ids: set[int] = set()
    for site in sites:
        plan = site.equipment_plan if isinstance(site.equipment_plan, dict) else {}
        dc_site: dict[str, Any] | None = None
        dc_client = db.get(Client, site.client_id) if site.client_id else None
        dc_data = dc_client.data if dc_client and isinstance(dc_client.data, dict) else {}
        dc_key = plan.get("dcContractSiteKey")
        if dc_data.get("dc_contract_status") == "valide" and dc_key:
            dc_site = next((item for item in dc_data.get("dc_contract_sites", []) if isinstance(item, dict) and item.get("key") == dc_key), None)
        site_dc_pairs.append((site, dc_site))
        if dc_site:
            for req in (dc_site.get("requirements") or []):
                if isinstance(req, dict) and isinstance(req.get("position_id"), int):
                    referenced_position_ids.add(req["position_id"])
    current_labels = {
        p.id: p.name for p in db.execute(select(Position).where(Position.id.in_(referenced_position_ids))).scalars().all()
    } if referenced_position_ids else {}

    payload_sites: list[dict[str, Any]] = []
    totals: dict[str, int] = {}
    for site, dc_site in site_dc_pairs:
        if not dc_site:
            # Aucun contrat DC validé et lié pour ce site : état explicite, jamais de
            # repli sur les quotas OPS historiques (equipment_plan.groupPositionQuotas /
            # positionQuotas), quels qu'ils soient.
            payload_sites.append({
                "site_id": site.id, "site": site.name, "group": "", "shift": "",
                "requirements": {}, "configured": False, "source": "unconfigured",
            })
            continue
        # requirements = liste canonique [{position_id, position_label, quantity}, ...]
        # (voir commercial.routes.update_dc_client_contract). Le libellé affiché est
        # RÉSOLU ICI depuis le référentiel Administration courant (jamais l'instantané
        # stocké) : un renommage de poste se reflète immédiatement, sans republier le
        # contrat DC. Repli sur l'instantané uniquement si le poste a été supprimé.
        raw_requirements = dc_site.get("requirements")
        per_shift: dict[str, int] = {}
        if isinstance(raw_requirements, list):
            for req in raw_requirements:
                if not isinstance(req, dict):
                    continue
                position_id = req.get("position_id")
                label = current_labels.get(position_id) or req.get("position_label") or ""
                if not label:
                    continue
                per_shift[label] = per_shift.get(label, 0) + max(0, int(req.get("quantity") or 0))
        elif isinstance(raw_requirements, dict):
            # Compatibilité ascendante : anciens contrats publiés avant la canonicalisation.
            per_shift = {str(name): max(0, int(value or 0)) for name, value in raw_requirements.items()}
        group_positions = {code: per_shift for code in "ABCD"}
        rotation = {
            "system": "3x8",
            "first_shift_time": dc_site.get("first_shift_time") or "06:00",
            "start_date": dc_site.get("rotation_start_date"),
        }
        requirements: dict[str, int] = {}
        group = ""
        shift = ""
        if rotation.get("system") == "3x8" and group_positions:
            try:
                start_date = datetime.fromisoformat(str(rotation.get("start_date"))).date()
                first_hour, first_minute = [int(part) for part in str(rotation.get("first_shift_time") or "06:00").split(":")]
                base_minutes = first_hour * 60 + first_minute
                now_minutes = now.hour * 60 + now.minute
                operational_date = now.date() if now_minutes >= base_minutes else now.date() - timedelta(days=1)
                shift_index = ((now_minutes - base_minutes) % 1440) // 480
                day_index = (operational_date - start_date).days
                group_index = next(index for index in range(4) if (day_index + index) % 4 == shift_index)
                group = "ABCD"[group_index]
                shift_start = (base_minutes + shift_index * 480) % 1440
                shift_end = (shift_start + 480) % 1440
                shift = f"{shift_start // 60:02d}:{shift_start % 60:02d}–{shift_end // 60:02d}:{shift_end % 60:02d}"
                configured = group_positions.get(group) if isinstance(group_positions.get(group), dict) else {}
                requirements = {str(name): max(0, int(value or 0)) for name, value in configured.items() if int(value or 0) > 0}
            except (TypeError, ValueError, StopIteration):
                requirements = {}
        if not requirements:
            # Contrat DC validé mais sans rotation 3x8 exploitable : on retombe sur
            # les besoins DC bruts (toujours DC, jamais OPS).
            requirements = {str(name): max(0, int(value or 0)) for name, value in per_shift.items() if int(value or 0) > 0}
            shift = shift or "Configuration générale"
        for name, required in requirements.items():
            totals[name] = totals.get(name, 0) + required
        payload_sites.append({
            "site_id": site.id, "site": site.name, "group": group, "shift": shift,
            "requirements": requirements, "configured": True, "source": "dc",
        })
    configured_count = sum(1 for item in payload_sites if item["configured"])
    if not payload_sites or configured_count == 0:
        source = "dc-unconfigured"
    elif configured_count == len(payload_sites):
        source = "dc"
    else:
        source = "partial"
    contractual = {"source": source, "configured": source == "dc", "requirements": totals}
    return {
        "generated_at": now.isoformat(),
        "sites": payload_sites,
        "requirements": totals,
        "source": source,
        "contractual": contractual,
    }


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
    # Même périmètre que les routes voisines : intersection sociétés × sites, et jamais « tout »
    # pour un compte sans périmètre (seul un périmètre global explicite renvoie None).
    allowed_site_ids = _attendance_selected_sites(db, user)
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
    source_rows = attendance_core.scan_rows(
        db, site_ids=allowed_site_ids,
        since=datetime(selected_year, 1, 1, tzinfo=tz) - timedelta(seconds=1),
        until=datetime(selected_year + 1, 1, 1, tzinfo=tz),
    )
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
    site_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    society: str | None = None,
) -> dict[str, Any]:
    """Alertes de présence prolongée (seuils absolus 8h/12h/16h, pour repérer un agent
    resté trop longtemps sur site quel que soit son régime de rotation) et de
    dépassement hebdomadaire (40h de vacations déjà terminées depuis lundi, la
    vacation en cours n'est pas comptée). Recalculé à partir du même journal
    attendanceQrScans que /attendance-feed (aucune donnée dédiée), avec le même
    filtrage par périmètre sites/société via _allowed_assignment_site_ids."""
    tz = ZoneInfo("Africa/Algiers")
    now = datetime.now(tz)
    allowed_site_ids = _attendance_selected_sites(db, user, site_id, society)

    # 4 jours de recul : assez large pour couvrir une vacation ouverte depuis avant-hier
    # (rotations longues comprises), sans avoir à charger tout l'historique.
    cutoff = now - timedelta(days=4)
    rows = attendance_core.scan_rows(db, site_ids=allowed_site_ids, since=cutoff)

    return _compute_attendance_alerts(rows, now, tz)


def _employee_search_result(db: Session, employee: Employee, allowed_sites: set[int] | None) -> dict[str, Any]:
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
        select(Assignment).where(Assignment.employee_id == employee.id, Assignment.active == 1, *([Assignment.site_id.in_(allowed_sites)] if allowed_sites is not None else [])).order_by(Assignment.id.desc())
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
    site_id: int | None = None,
    db: Session = Depends(get_db),
    scanner: User = Depends(current_user),
    society: str | None = None,
) -> list[dict[str, Any]]:
    """Recherche par code ou nom/prénom pour le pointage manuel (employé sans smartphone,
    ou QR illisible) : le pointeur tape le code ou le nom donné par l'employé, choisit la
    bonne fiche dans la liste, puis confirme le pointage via /attendance-manual/scan."""
    allowed_site_ids = _attendance_selected_sites(db, scanner, site_id, society)
    query = _clean_text(q)
    if len(query) < 2:
        return []
    scope = _attendance_society_scope(db, scanner)
    permitted_societies = {value for (value,) in db.execute(select(Employee.society).distinct())
                           if scope.allows(value)
                           and (not society or society_key(value) == society_key(society))}
    like = f"%{query}%"
    stmt = (
        select(Employee)
        .where(
            Employee.status == "actif",
            Employee.society.in_(permitted_societies),
            or_(
                Employee.code.ilike(like),
                Employee.first_name.ilike(like),
                Employee.last_name.ilike(like),
                (Employee.last_name + " " + Employee.first_name).ilike(like),
                (Employee.first_name + " " + Employee.last_name).ilike(like),
            ),
        )
        .where(*([Employee.id.in_(select(Assignment.employee_id).where(Assignment.active == 1, Assignment.site_id.in_(allowed_site_ids)))] if allowed_site_ids is not None else []))
        .order_by(Employee.last_name, Employee.first_name)
        .limit(8)
    )
    rows = db.execute(stmt).scalars().all()
    allowed_site_ids = _attendance_selected_sites(db, scanner, site_id, society)
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
    return [_employee_search_result(db, row, allowed_site_ids) for row in rows]


@router.get("/attendance-manual/context")
def manual_attendance_context(employee_id: int, site_id: int | None = None, db: Session = Depends(get_db),
                              scanner: User = Depends(current_user)) -> dict[str, Any]:
    """Contexte affiché avant une saisie manuelle (lecture seule) : dernière vacation de l'employé,
    sa sortie, la fenêtre de nouvelle entrée et la vacation supplémentaire concernée, tels
    qu'Attendance Core les appliquera. Rien n'est écrit ; l'opération elle-même sera auditée."""
    from app.modules.attendance import counted as counted_time

    employee = employee_by_ref(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    _ensure_attendance_employee_scope(db, scanner, employee)
    _ensure_selected_site_access(db, scanner, site_id)
    _ensure_employee_on_selected_site(db, employee, site_id)
    assignment = attendance_core.active_assignment(db, employee.id)
    site = db.get(Site, assignment.site_id) if assignment and assignment.site_id else None
    now = attendance_core._now_local()
    events = attendance_core._last_scan_events(db, employee.id)
    allowed = _manual_entry_granted(db, scanner)
    extra = counted_time.extra_context(events, site.id if site else None, now, manual_allowed=allowed)
    reentry = bool(allowed and not extra and attendance_core._reentry_possible(events[-1] if events else None, site, now))
    return {
        "employee": {"id": employee.id, "matricule": employee.code, "nom": employee.last_name, "prenom": employee.first_name,
                     "poste": employee.position or ""},
        "site": {"id": site.id, "name": site.name} if site else None, "group": assignment.group_code if assignment else None,
        "extra_shift": counted_time.view({"counted": extra}) if extra else None,
        "abandon_threshold_minutes": attendance_core.settings.attendance_abandon_threshold_minutes,
        "manual_entry_allowed": allowed,
        "intent": counted_time.INTENT_EXTRA_ENTRY if extra else (counted_time.INTENT_REENTRY if reentry else None),
        # Reprise de poste : la dernière sortie appartient à une vacation encore en cours (double
        # scan, sortie ou abandon saisi par erreur). Motif obligatoire, opération signalée.
        "reentry": {"available": True, "previous_exit": attendance_core.to_local(events[-1].occurred_at).strftime("%H:%M")} if reentry else None,
        "reason_required": bool(reentry or (extra and extra["entry_status"] == counted_time.ENTRY_EXTRA_MANUAL)),
        "audited": True, **attendance_core.operational_clock(now),
    }


def _abandon_employee(db, scanner, employee_id, site_id):
    if not _manual_entry_granted(db, scanner):
        raise HTTPException(403, "Saisie manuelle non autorisée")
    employee = employee_by_ref(db, employee_id)
    if not employee:
        raise HTTPException(404, "Employé introuvable")
    _ensure_attendance_employee_scope(db, scanner, employee)
    _ensure_selected_site_access(db, scanner, site_id)
    _ensure_employee_on_selected_site(db, employee, site_id)
    assignment = attendance_core.active_assignment(db, employee.id)
    if not assignment or not assignment.site_id:
        raise HTTPException(409, "Aucune affectation valide")
    _attendance_selected_sites(db, scanner, assignment.site_id)
    if site_id is not None and assignment.site_id != site_id:
        raise HTTPException(409, "Site différent de la vacation concernée")
    return employee


@router.get("/attendance-manual/abandon/context")
def abandon_attendance_context(employee_id: int, site_id: int | None = None,
                               db: Session = Depends(get_db), scanner: User = Depends(current_user)):
    from app.modules.attendance import abandon
    employee = _abandon_employee(db, scanner, employee_id, site_id)
    return abandon.context(db, employee)


@router.post("/attendance-manual/abandon", status_code=201)
def abandon_employee_attendance(payload: dict[str, Any], db: Session = Depends(get_db),
                                scanner: User = Depends(current_user)):
    from app.core.scope_policy import society_key
    employee = _abandon_employee(db, scanner, payload.get("employee_id"), payload.get("site_id"))
    if payload.get("society") is not None and society_key(payload["society"]) != society_key(employee.society):
        raise HTTPException(409, "Société différente de la vacation concernée")
    shift_id = payload.get("shift_id")
    if isinstance(shift_id, bool) or not isinstance(shift_id, int) or shift_id < 1:
        raise HTTPException(422, "Vacation concernée obligatoire")
    observation = payload.get("observation")
    if not isinstance(observation, str) or not observation.strip() or len(observation) > 500:
        raise HTTPException(422, "Motif / observation obligatoire (500 caractères maximum)")
    return attendance_core.record_scan(db, employee=employee, source=SOURCE_MANUAL, actor=scanner,
        idempotency_key=None, observation=observation, manual_entry_allowed=True, abandon_shift_id=shift_id)


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
    _ensure_attendance_employee_scope(db, scanner, employee, payload.get("society"))
    _ensure_selected_site_access(db, scanner, payload.get("site_id"))
    if not _manual_entry_granted(db, scanner):
        raise HTTPException(status_code=403, detail="Permission de pointage manuel requise",
                            headers={"X-Attendance-Code": "MANUAL_ENTRY_REQUIRED"})
    _ensure_employee_on_selected_site(db, employee, payload.get("site_id"))
    requested_action = _clean_text(payload.get("action") or "present").lower()
    if requested_action not in {"present", "absent"}:
        raise HTTPException(status_code=422, detail="Action de pointage manuel invalide")
    if requested_action == "absent":
        tz = ZoneInfo("Africa/Algiers")
        now = datetime.now(tz)
        existing = db.execute(
            select(DailyPresence).where(
                DailyPresence.presence_date == now.date(),
                DailyPresence.employee_id == employee.id,
            ).order_by(DailyPresence.id.desc())
        ).scalars().first()
        if existing and (existing.arrival_time or str(existing.status or "").lower() == "present"):
            raise HTTPException(status_code=409, detail="Impossible de marquer absent : une présence est déjà enregistrée aujourd’hui")
        assignment = db.execute(
            select(Assignment).where(Assignment.employee_id == employee.id, Assignment.active == 1).order_by(Assignment.id.desc())
        ).scalars().first()
        site = db.get(Site, assignment.site_id) if assignment and assignment.site_id else None
        observation = _clean_text(payload.get("observation"))
        # Via Attendance Core : statut de journée (refusé si la journée est clôturée).
        row = attendance_core.record_day_status(
            db, employee=employee, site_id=assignment.site_id if assignment else None, day=now.date(),
            status="absent", source=SOURCE_MANUAL, actor=scanner,
            notes=observation or "Absence constatée par le pointeur",
            legacy={
                "date": now.date().isoformat(), "employee_id": employee.id, "matricule": employee.code,
                "agentName": " ".join(filter(None, [employee.last_name, employee.first_name])),
                "statut": "absent", "status": "absent", "code": "A", "valide": True,
                "valideAt": now.isoformat(), "validePar": scanner.username,
                "observations": observation or "Absence constatée par le pointeur",
                "source": "pointage-manuel-absence",
                "siteBackendId": assignment.site_id if assignment else None,
                "siteName": (site.name or site.indicatif or "") if site else "",
                "groupe": assignment.group_code if assignment else "",
            },
        )
        from app.modules.irongs.sql_bridge import presence_to_item
        result = presence_to_item(row)
        extra = employee.extra if isinstance(employee.extra, dict) else {}
        legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
        events = list(legacy.get("gestionEvents") or [])
        source_id = f"pointage-absence-{result.get('backendId') or now.date().isoformat()}"
        if not any(event.get("sourceId") == source_id for event in events if isinstance(event, dict)):
            events.append({
                "id": source_id,
                "type": "Absence",
                "du": now.date().isoformat(),
                "au": now.date().isoformat(),
                "motif": observation or "Absence constatée par le pointeur",
                "statut": "en_cours",
                "createdAt": now.isoformat(),
                "createdBy": scanner.username,
                "source": "Pointage",
                "sourceId": source_id,
                "details": {"presenceBackendId": result.get("backendId"), "site": (site.name or site.indicatif or "") if site else ""},
            })
            employee.extra = {**extra, "_legacy": {**legacy, "gestionEvents": events}}
        db.commit()
        return {
            "success": True, "action": "absent", "message": "ABSENCE ENREGISTRÉE",
            "date": now.date().isoformat(), "heure": now.strftime("%H:%M:%S"),
            "employee": {"id": employee.id, "matricule": employee.code, "nom": employee.last_name, "prenom": employee.first_name},
            "record": result,
        }
    today_presence = db.execute(
        select(DailyPresence).where(
            DailyPresence.presence_date == datetime.now(ZoneInfo("Africa/Algiers")).date(),
            DailyPresence.employee_id == employee.id,
        ).order_by(DailyPresence.id.desc())
    ).scalars().first()
    if today_presence and str(today_presence.status or "").lower() == "absent":
        raise HTTPException(status_code=409, detail="Impossible de marquer présent : une absence est déjà enregistrée aujourd’hui")
    nonce = f"manual-{secrets.token_urlsafe(12)}"
    return _register_attendance(
        db,
        employee,
        scanner,
        nonce,
        "portail-rh-employee-manuel",
        _clean_text(payload.get("observation")),
        # Vacation supplémentaire après la fenêtre : permission « Saisie manuelle » explicite.
        manual_entry_allowed=_manual_entry_granted(db, scanner),
        intent=next((code for code in (EXTRA_SHIFT_ENTRY, attendance_core_intent_reentry())
                     if _clean_text(payload.get("intent")).upper() == code), None),
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
    attendance_events = attendance_core.scan_rows(db, employee_id=employee.id) if employee else []
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
    return result


@router.get("/accounts")
def list_portal_accounts(
    societe: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> list[dict[str, Any]]:
    _require_portal_account_manager(admin)
    accounts = service.list_items(db, "portalAccounts")
    rows = [a for a in accounts if isinstance(a, dict)]
    if societe:
        s = _norm_text(societe)
        rows = [a for a in rows if _norm_text(a.get("societe", "")) == s]
    return [_public_portal_account(a) for a in rows]


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
def create_portal_account(
    payload: dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    _require_portal_account_manager(admin)
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
    temporary_password = secrets.token_urlsafe(12)
    account: dict[str, Any] = {
        "id": username,
        "username": username,
        "matricule": _agent_field(agent, "matricule", "code"),
        "passwordHash": hash_password(temporary_password),
        "nom": _agent_field(agent, "nom"),
        "prenom": _agent_field(agent, "prenom", "prénom"),
        "societe": _agent_field(agent, "societe"),
        "active": True,
        "mustChangePassword": True,
        "temporaryPasswordIssuedAt": datetime.now(timezone.utc).isoformat(),
        "temporaryPasswordExpiresAt": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
        "passwordChangedAt": "",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "createdBy": admin.username,
    }
    created = service.create_item(db, "portalAccounts", account)
    append_audit(db, action="portal.account.create", resource="portal_account", resource_id=created.get("id"),
                 society=created.get("societe"), result="success", user=admin, request=request)
    db.commit()
    return {**_public_portal_account(created), "temporaryPassword": temporary_password}


@router.get("/accounts/{matricule}")
def get_portal_account(
    matricule: str,
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Aucun compte portail pour cet employé")
    _require_portal_account_manager(admin, account)
    return _public_portal_account(account)


@router.put("/accounts/{matricule}/password")
def reset_portal_password(
    matricule: str,
    payload: dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, Any]:
    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Aucun compte portail pour cet employé")
    _require_portal_account_manager(admin, account)
    issued_at = datetime.now(timezone.utc).isoformat()
    temporary_password = secrets.token_urlsafe(12)
    updated = service.update_item(db, "portalAccounts", account["id"], {
        "passwordHash": hash_password(temporary_password),
        "mustChangePassword": True,
        "temporaryPasswordIssuedAt": issued_at,
        "temporaryPasswordExpiresAt": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
        "passwordChangedAt": "",
    })
    append_audit(db, action="portal.account.temporary_password", resource="portal_account", resource_id=account["id"],
                 society=account.get("societe"), result="success", user=admin, request=request)
    db.commit()
    return {**_public_portal_account(updated), "temporaryPassword": temporary_password}


@router.delete("/accounts/{matricule}")
def delete_portal_account(
    matricule: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(current_user),
) -> dict[str, str]:
    account = _find_portal_account(db, matricule)
    if not account:
        raise HTTPException(status_code=404, detail="Aucun compte portail pour cet employé")
    _require_portal_account_manager(admin, account)
    result = service.delete_item(db, "portalAccounts", account["id"])
    append_audit(db, action="portal.account.delete", resource="portal_account", resource_id=account["id"],
                 society=account.get("societe"), result="success", user=admin, request=request)
    db.commit()
    return result


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
    if account.get("mustChangePassword") and account.get("temporaryPasswordExpiresAt"):
        try:
            expires = datetime.fromisoformat(str(account["temporaryPasswordExpiresAt"]).replace("Z", "+00:00"))
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires <= datetime.now(timezone.utc):
                raise HTTPException(status_code=403, detail="Mot de passe provisoire expiré")
        except ValueError:
            raise HTTPException(status_code=403, detail="Mot de passe provisoire invalide")
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

    if verify_password(new_password, account.get("passwordHash", "")):
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit être différent")
    changed_at = datetime.now(timezone.utc).isoformat()
    service.update_item(db, "portalAccounts", account["id"], {
        "passwordHash": hash_password(new_password),
        "mustChangePassword": False,
        "passwordChangedAt": changed_at,
        "temporaryPasswordExpiresAt": "",
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
