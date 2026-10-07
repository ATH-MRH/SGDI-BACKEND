import re

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_staff_token
from app.db.session import get_db
from app.modules.auth.models import User
from app.modules.auth.service import get_user
from app.core.audit import append_audit
from app.core.scope_policy import ScopeKind, society_scope


security = HTTPBearer(auto_error=False)

AUTHORIZED_ACTIONS = {"read", "create", "update", "validate", "delete", "export", "unlock", "admin"}
SOCIETY_SCOPED_PREFIXES = (
    "/api/drh", "/api/ops", "/api/materiel", "/api/commercial",
    "/api/finance", "/api/accounting", "/api/achats", "/api/ventes", "/api/reporting",
    "/api/ronde", "/api/loans",
    "/api/irongs", "/api/assistant", "/api/erp",
    "/api/finance-core", "/api/banking", "/api/reconciliation",
    "/api/regulatory", "/api/payroll", "/api/treasury", "/api/budget",
    "/api/profitability", "/api/fiscalite", "/api/cockpit",
    "/api/site-workforce",
    "/api/attendance",
    "/api/brq",
    "/api/biometrics",
)

# Plusieurs interfaces autonomes partagent le meme routeur backend. Les valeurs
# ci-dessous sont les cles deja stockees dans User.authorized_modules par le
# panneau Administration systeme; aucune seconde source d'autorisation n'est
# introduite ici.
API_MODULE_PREFIXES: tuple[tuple[str, frozenset[str]], ...] = (
    ("/api/drh/candidates", frozenset({"drh", "recrute"})),
    ("/api/drh/leaves", frozenset({"drh", "conges"})),
    ("/api/ops/pointage", frozenset({"ops", "pointage", "pointeur"})),
    ("/api/loans/secretariat", frozenset({"pret", "secretariat"})),
    ("/api/loans/cash", frozenset({"caisse"})),
    ("/api/accounting", frozenset({"finances"})),
    ("/api/commercial", frozenset({"dc"})),
    ("/api/reporting", frozenset({"finances"})),
    ("/api/materiel", frozenset({"materiel"})),
    ("/api/finance", frozenset({"finances"})),
    ("/api/achats", frozenset({"finances"})),
    ("/api/ventes", frozenset({"dc"})),
    ("/api/loans", frozenset({"pret", "caisse"})),
    ("/api/drh", frozenset({"drh"})),
    ("/api/ops", frozenset({"ops"})),
    # Finance Core (couche d'intégration commune) et ses briques Banking/Reconciliation
    # partagent le même module "finances" que accounting/achats/reporting déjà existants —
    # une seconde clé de module aurait fabriqué une distinction que le panneau
    # Administration ne connaît pas et aurait obligé chaque compte "finances" existant à
    # être reconfiguré à la main pour accéder à ce qui est fonctionnellement le même domaine.
    ("/api/finance-core", frozenset({"finances"})),
    ("/api/banking", frozenset({"finances"})),
    ("/api/reconciliation", frozenset({"finances"})),
    # Paie/référentiel réglementaire/trésorerie/budget/rentabilité/fiscalité/cockpit DG :
    # même module "finances", même raisonnement que ci-dessus — domaine fonctionnellement
    # unique du point de vue de l'habilitation, pas une nouvelle famille de comptes.
    ("/api/regulatory", frozenset({"finances"})),
    ("/api/payroll", frozenset({"finances"})),
    ("/api/treasury", frozenset({"finances"})),
    ("/api/budget", frozenset({"finances"})),
    ("/api/profitability", frozenset({"finances"})),
    ("/api/fiscalite", frozenset({"finances"})),
    ("/api/cockpit", frozenset({"finances"})),
    # ATLAS Site Workforce — module dédié, propre clé (jamais "ops"/"drh" : ce rôle n'a pas
    # les droits transversaux de ces modules, seulement son unique site imposé).
    ("/api/site-workforce", frozenset({"site_workforce"})),
    ("/api/brq", frozenset({"brq"})),
    # Centre de contrôle du pointage + onglet Pointages de l'Employé 360.
    ("/api/attendance", frozenset({"pointage", "ops", "drh"})),
    # Saisie manuelle du pointeur : la permission fine ne réactive pas un module
    # révoqué. Couvre recherche/contexte, PRÉSENT, ABSENT et ABANDON POSTE.
    ("/api/portal/attendance-manual", frozenset({"pointage", "pointeur"})),
    # Biométrie : terminal (reconnaissance) + administration ; actions sensibles soumises en
    # plus à une permission biométrique explicite (app/modules/biometrics/routes.py).
    ("/api/biometrics", frozenset({"pointage", "pointeur", "ops", "drh"})),
)

# Écritures Pointage / Présence / Rotation : le module propriétaire est exigé en plus du
# préfixe ci-dessus, qui n'ouvre que la LECTURE aux modules consultants (DRH lit le centre de
# contrôle et l'onglet Pointages de l'Employé 360 sans jamais y écrire). Une écriture sans
# propriétaire opérationnel listé ici ou dans API_MODULE_PREFIXES n'existe pas : la première
# règle qui correspond s'applique, puis le préfixe.
READ_ONLY_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
API_WRITE_MODULE_RULES: tuple[tuple[re.Pattern[str], frozenset[str]], ...] = (
    # Comptes pointeurs : gestion d'identités, déjà portée par la permission explicite
    # Administration › Utilisateurs (attendance/pointer_users.py) — modules du préfixe inchangés.
    (re.compile(r"^/api/attendance/pointers(/|$)"), frozenset({"pointage", "ops", "drh"})),
    # Qualification d'un écart de rotation et décision planifiée : décisions d'exploitation OPS.
    (re.compile(r"^/api/attendance/rotation-(deviations|planning)(/|$)"), frozenset({"ops"})),
    # Centre de contrôle (pointage.irongs.com) : correction, clôture, réouverture, anomalies,
    # réglages et apprentissage de rotation — module du centre de contrôle ou OPS.
    (re.compile(r"^/api/attendance(/|$)"), frozenset({"ops", "pointage"})),
    # Scan du QR d'un employé : terminal Pointeur et scanner du Pointage — mêmes modules que
    # la saisie /api/ops/pointage.
    (re.compile(r"^/api/portal/attendance-qr(/|$)"), frozenset({"ops", "pointage", "pointeur"})),
    # Reconnaissance faciale : crée un pointage, contrairement au reste de /api/biometrics
    # (enrôlement, référence faciale) que DRH utilise légitimement.
    (re.compile(r"^/api/biometrics/cameras/[^/]+/recognize$"), frozenset({"ops", "pointage", "pointeur"})),
)

MODULE_KEY_ALIASES = {
    "commercial": "dc",
    "finance": "finances",
    "portail-rh": "portail",
}


def request_module_keys(request: Request) -> frozenset[str] | None:
    """Retourne les modules existants capables d'utiliser la route demandee."""
    path = request.url.path.lower().rstrip("/")
    if request.method.upper() not in READ_ONLY_METHODS:
        for pattern, module_keys in API_WRITE_MODULE_RULES:
            if pattern.match(path):
                return module_keys
    for prefix, module_keys in API_MODULE_PREFIXES:
        if path == prefix or path.startswith(f"{prefix}/"):
            return module_keys
    return None


def _normalized_module_keys(values: list | None) -> set[str]:
    return {
        MODULE_KEY_ALIASES.get(key, key)
        for value in (values or [])
        if (key := str(value or "").strip().lower())
    }


def _legacy_module_keys(user: User) -> set[str]:
    """Déduit les droits legacy avec les règles historiques de auth.routes."""
    # Import différé : auth.routes dépend déjà de current_user. Au moment d'une
    # requête, son module est entièrement initialisé et ses règles sont réutilisées
    # directement, sans copie concurrente.
    from app.modules.auth.routes import DEDICATED_LOGIN_RULES, _username_prefix

    prefix = _username_prefix(user.username)
    allowed = {
        module_key
        for module_key, (prefixes, _label) in DEDICATED_LOGIN_RULES.items()
        if prefix in prefixes
    }
    structures = {
        str(value or "").strip().lower()
        for value in (user.authorized_structures or [])
        if str(value or "").strip()
    }
    allowed.update(_normalized_module_keys(list(structures)))
    if prefix == "COM" or "commercial" in structures:
        allowed.add("dc")
    return _normalized_module_keys(list(allowed))


def enforce_module_access(db: Session, request: Request, user: User) -> None:
    """Bloque cote API un module non coche dans le compte utilisateur.

    NULL réutilise la politique historique des comptes legacy au lieu de devenir
    un accès global. Une liste vide signifie qu'aucun module dédié n'est autorisé.
    Les rôles Administration conservent leur accès transversal existant.
    """
    required = request_module_keys(request)
    configured = user.authorized_modules
    if required is None:
        return
    from app.modules.auth.routes import is_admin_role

    if is_admin_role(user.role):
        return
    allowed = _legacy_module_keys(user) if configured is None else _normalized_module_keys(configured)
    if allowed.isdisjoint(required):
        append_audit(
            db,
            action="authorization.module",
            resource="api",
            resource_id=request.url.path,
            result="refused",
            user=user,
            request=request,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Module non autorise pour ce compte",
        )


# Applications dont l'accès est revérifié à CHAQUE requête servie sur leur sous-domaine (pas
# seulement à la connexion) : un jeton obtenu sur pointage.irongs.com ne vaut pas accès au
# terminal terrain pointeur.irongs.com sans la clé de module « pointeur ».
HOST_ENFORCED_APPLICATIONS = frozenset({"pointeur", "brq"})


def enforce_application_host(request: Request, user: User) -> None:
    from app.modules.auth.routes import _host_subdomain, enforce_subdomain_login_scope, is_admin_role

    # Même règle que la connexion sur ce sous-domaine ; les rôles Administration gardent leur
    # accès transversal (comme enforce_module_access ; /admin-system-login ne filtre pas l'hôte).
    if _host_subdomain(request) in HOST_ENFORCED_APPLICATIONS and not is_admin_role(user.role):
        enforce_subdomain_login_scope(request, user)


def request_action(request: Request) -> str:
    """Traduit une opération HTTP en action métier administrable par utilisateur."""
    method = request.method.upper()
    path = request.url.path.lower()
    if any(part in path for part in ("/export", "/download", "/pdf")):
        return "export"
    if any(part in path for part in ("/validate", "/valider", "/approve", "/refuse", "/close", "/payer", "/recruit", "/convertir", "/annuler")):
        return "validate"
    if "/blacklist" in path:
        # GET .../blacklist (historique) reste "read" — seules les mutations (POST créer /
        # POST .../lift lever) sont une décision "validate", au même titre qu'approve/refuse.
        # Un mot-clé insensible à la méthode (comme les autres ci-dessus) classerait à tort
        # la LECTURE de l'historique comme "validate" : cette route partage le même chemin
        # entre GET et POST, contrairement aux autres routes validate qui ont un chemin dédié.
        return "validate" if method != "GET" else "read"
    if any(part in path for part in ("/unlock", "/deverrou", "/déverrou")):
        return "unlock"
    if path.startswith("/api/auth/users") or path.startswith("/api/auth/access-rules"):
        return "admin" if method not in {"GET", "HEAD", "OPTIONS"} else "read"
    return {"GET": "read", "HEAD": "read", "OPTIONS": "read", "POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}.get(method, "read")


def current_token_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token manquant")
    try:
        return decode_staff_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide")


def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    payload = current_token_payload(credentials)
    user = get_user(db, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur inactif")
    from app.modules.auth.pointer_policy import validate_pointer_scope
    validate_pointer_scope(db, role=user.role, societies=user.authorized_societies, sites=user.authorized_sites, global_society_access=user.global_society_access, status_code=403)
    enforce_module_access(db, request, user)
    enforce_application_host(request, user)
    if request.url.path.lower().startswith(SOCIETY_SCOPED_PREFIXES) and society_scope(user).kind is ScopeKind.NONE:
        append_audit(db, action="authorization.no_society_scope", resource="api",
                     resource_id=request.url.path, result="refused", user=user, request=request)
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Aucun périmètre société explicite")
    actions = [str(value).strip().lower() for value in (user.authorized_actions or [])]
    actions = [value for value in actions if value in AUTHORIZED_ACTIONS]
    if actions and request_action(request) not in actions and "admin" not in actions:
        append_audit(db, action="authorization.action", resource="api", resource_id=request.url.path,
                     result="refused", user=user, request=request)
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Action non autorisée : {request_action(request)}")
    return user
