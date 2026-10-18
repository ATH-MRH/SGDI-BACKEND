"""Studio Badges DRH — API (/api/drh/badges).

Sous /api/drh : mêmes contrôles que le reste de la DRH (module « drh », périmètre société,
actions autorisées). La fiche employé reste la source de vérité ; un badge émis en garde un
instantané. Le QR imprimé pointe vers la page publique signée déjà existante
(/public/badge/{ref}?t=…) : les badges déjà en circulation restent valides.
"""
from __future__ import annotations

import io
import logging
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.config import settings
from app.core.granular_permissions import is_global_administrator, load_feature_permissions
from app.core.pagination import paginate_list
from app.db.session import get_db
from app.modules.auth.dependencies import current_user, has_badge_module, read_only_restricted
from app.modules.auth.models import User
from app.modules.drh import badge_design, badge_pdf, service
from app.modules.drh.badge_models import (
    STATUS_ACTIVE, STATUS_REPLACED, STATUS_REVOKED, BadgeEvent, BadgeSettings, BadgeTemplate, EmployeeBadge,
)
from app.modules.drh.models import Employee
from app.modules.drh.routes import (
    _allowed_societies, _canonical_allowed_society, _effective_society_filter, _ensure_employee_allowed,
    _ensure_recruitment_access, _ensure_society_allowed, _society_key,
)
from app.modules.ops.models import Assignment, Site

logger = logging.getLogger("sgdi.drh.badges")


def _enabled() -> None:
    """Interrupteur d'exploitation (BADGE_STUDIO_ENABLED=false) : coupe le studio sans
    migration ni perte de données — premier geste d'un retour arrière."""
    if not settings.badge_studio_enabled:
        raise HTTPException(status_code=503, detail="Le Studio Badges est momentanément désactivé.")


router = APIRouter(prefix="/badges", dependencies=[Depends(_enabled), Depends(current_user)])

MAX_BATCH = 200
DEFAULT_SETTINGS: dict[str, Any] = {
    "number_prefix": "BDG",
    "validity_months": 0,               # 0 = sans date de fin
    "require_photo": True,
    "photo_source": "portrait",         # portrait (visage recadré, fond blanc) | original
    "print_layout": "card",             # card (une carte par page) | a4 (planche)
    "sheet_margin_mm": 10,
    "sheet_gap_mm": 4,
    "crop_marks": True,
    # Groupe sanguin (donnée médicale déclarative) : jamais affiché par défaut. L'activation exige
    # le droit « admin » des badges ET la référence de l'autorisation interne qui l'encadre.
    "show_blood_group": False,
    "blood_group_authorization": "",
}
REVOKE_REASONS = {"perdu": "Badge perdu", "vole": "Badge volé", "deteriore": "Badge détérioré",
                  "depart": "Départ de l'employé", "erreur": "Erreur d'émission", "autre": "Autre"}
SAMPLE_VALUES = {"societe": "IRON GLOBAL", "nom": "ABDELKADER", "prenom": "MOHAMED", "nom_complet": "ABDELKADER MOHAMED",
                 "matricule": "K26", "fonction": "CARISTE", "site": "SITE EXEMPLE", "site_code": "ETP/DF/H01",
                 "statut": "ACTIF", "numero": "BDG-0000-000000", "date_emission": "01/01/2026", "validite": "—",
                 "groupe_sanguin": "O+"}
PDF_HEADERS = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}


# ── Accès ────────────────────────────────────────────────────────────────────

# Droits du Studio Badges. L'accès EXPLICITE au module « Studio Badges » (clé badge) vaut droit
# opérationnel : émettre, renouveler ou remplacer un badge (create) et imprimer, seul ou en lot
# (export). Les opérations sensibles restent des permissions explicites (Administration ›
# Permissions › Studio Badges) : révoquer (validate), modèles partagés et paramètres, dont les
# règles du groupe sanguin (admin). Une restriction explicite de lecture seule l'emporte.
RIGHTS = {"create": "émettre, renouveler ou remplacer un badge", "validate": "révoquer un badge",
          "export": "imprimer un badge", "admin": "gérer les modèles et les paramètres des badges"}
OPERATIONAL_RIGHTS = ("create", "export")


def _access(user: User) -> None:
    """Module dédié « badge » (Studio Badges, badge.irongs.com). Le contrôle d'API par module
    (API_MODULE_PREFIXES) a déjà exigé cette clé ; les comptes historiques sans liste de modules
    gardent le contrôle des profils RH."""
    if is_global_administrator(user):
        return
    if user.authorized_modules is not None:
        modules = {str(value or "").strip().lower() for value in user.authorized_modules}
        if "badge" in modules:
            return
    _ensure_recruitment_access(user)


def badge_rights(db: Session, user: User) -> dict[str, bool]:
    if is_global_administrator(user):
        return {action: True for action in RIGHTS}
    if read_only_restricted(user):
        return {action: False for action in RIGHTS}
    granted = {grant.action_key for grant in load_feature_permissions(db, user.id)
               if grant.module_key == "drh" and grant.feature_key == "badges"}
    operational = has_badge_module(user)
    return {action: action in granted or (operational and action in OPERATIONAL_RIGHTS) for action in RIGHTS}


def right_reason(user: User, action: str) -> str:
    """Explication précise d'un droit absent, affichée telle quelle dans le portail."""
    if read_only_restricted(user):
        return "Votre compte est limité à la consultation : aperçus et épreuves SPÉCIMEN uniquement."
    if action in OPERATIONAL_RIGHTS:
        return ("Réservé aux comptes autorisés au module Studio Badges (Administration › Utilisateurs › "
                "Modules › Studio Badges).")
    if action == "validate":
        return "Révocation réservée aux responsables habilités (Administration › Permissions › Studio Badges › Révoquer)."
    return "Modèles partagés et paramètres réservés aux administrateurs des badges (Administration › Permissions › Studio Badges)."


def rights_out(db: Session, user: User) -> dict[str, Any]:
    rights = badge_rights(db, user)
    return {**rights, "operational": all(rights[action] for action in OPERATIONAL_RIGHTS),
            "read_only": read_only_restricted(user) and not is_global_administrator(user),
            "reasons": {action: right_reason(user, action) for action, allowed in rights.items() if not allowed}}


def _require(db: Session, user: User, request: Request, action: str) -> None:
    _access(user)
    if not badge_rights(db, user)[action]:
        append_audit(db, action="authorization.badge", resource="api", resource_id=f"badges:{action}",
                     result="refused", user=user, request=request)
        db.commit()
        raise HTTPException(status_code=403, detail=f"Impossible de {RIGHTS[action]}. {right_reason(user, action)}")


def _site_scope(user: User) -> set[int] | None:
    """Sites explicitement autorisés au compte (None : aucune restriction par site)."""
    from app.modules.ops.routes import _authorized_site_ids

    if is_global_administrator(user):
        return None
    return set(_authorized_site_ids(user)) or None


def _site_visible(scope: set[int] | None, site_id: int | None) -> bool:
    return scope is None or (site_id is not None and site_id in scope)


def _badge_employee(db: Session, user: User, employee_id: int) -> Employee:
    """Employé du périmètre du compte : société, puis sites autorisés (affectation active)."""
    employee = _ensure_employee_allowed(db, user, employee_id)
    scope = _site_scope(user)
    if scope is not None:
        current = _current_sites(db, [employee.id]).get(employee.id)
        if not _site_visible(scope, current[1].id if current else None):
            raise HTTPException(status_code=403, detail="Employé hors des sites autorisés pour votre compte.")
    return employee


def _society_visible(user: User, society: str | None) -> bool:
    return not _allowed_societies(user) or not _society_key(society) or bool(_canonical_allowed_society(user, society))


def _badge_or_404(db: Session, user: User, badge_id: int) -> EmployeeBadge:
    badge = db.get(EmployeeBadge, badge_id)
    if badge is None or (_allowed_societies(user) and not _canonical_allowed_society(user, badge.society)):
        raise HTTPException(status_code=404, detail="Badge introuvable")
    scope = _site_scope(user)
    if scope is not None and not _site_visible(scope, (badge.snapshot or {}).get("site_id") if isinstance(badge.snapshot, dict) else None):
        raise HTTPException(status_code=404, detail="Badge introuvable")
    return badge


def _log(db: Session, user: User, request: Request | None, action: str, label: str, *, badge: EmployeeBadge | None = None,
         employee_id: int | None = None, template: BadgeTemplate | None = None, society: str | None = None,
         details: dict[str, Any] | None = None) -> None:
    society = society or (badge.society if badge else None) or (template.society if template else None)
    db.add(BadgeEvent(action=action, label=label[:300], badge_id=badge.id if badge else None,
                      employee_id=employee_id or (badge.employee_id if badge else None),
                      template_id=template.id if template else None, society=society,
                      user_id=user.id, username=user.username, details=details))
    append_audit(db, action=f"badge.{action.lower()}", resource="employee_badge" if badge or employee_id else "badge_template",
                 result="success", user=user, request=request,
                 resource_id=badge.id if badge else (template.id if template else employee_id), society=society, new_state=details)


# ── Données employé ──────────────────────────────────────────────────────────

def _employee_data(employee: Employee) -> dict[str, Any]:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    return {**legacy, **extra}


def _current_sites(db: Session, employee_ids: list[int]) -> dict[int, tuple[Assignment, Site]]:
    result: dict[int, tuple[Assignment, Site]] = {}
    if employee_ids:
        rows = db.execute(
            select(Assignment, Site).join(Site, Assignment.site_id == Site.id)
            .where(Assignment.employee_id.in_(employee_ids), Assignment.active == 1)
            .order_by(Assignment.start_date.desc(), Assignment.id.desc())
        ).all()
        for assignment, site in rows:
            result.setdefault(assignment.employee_id, (assignment, site))
    return result


def blood_group_of(employee: Employee) -> str:
    """Groupe sanguin déclaré sur la fiche (groupeSanguin), normalisé ; "" s'il est absent ou
    inexploitable. Jamais déduit d'une autre information."""
    data = _employee_data(employee)
    return badge_design.normalize_blood_group(data.get("groupeSanguin") or data.get("groupe_sanguin"))


BLOOD_WAIVERS = {"non_communique": "Groupe sanguin non communiqué par l'employé",
                 "analyse_en_attente": "Analyse de groupage sanguin en attente",
                 "refus": "Refus de l'employé de le faire figurer sur son badge"}


def blood_group_state(employee: Employee, options: dict[str, Any]) -> dict[str, Any]:
    """Contrôle de la donnée pour l'interface : présente et valide (ok), absente ou invalide.
    L'état seul permet de régulariser les fiches avant toute émission ; la VALEUR n'est transmise
    que si son affichage est autorisé pour la société."""
    data = _employee_data(employee)
    raw = str(data.get("groupeSanguin") or data.get("groupe_sanguin") or "").strip()
    value = badge_design.normalize_blood_group(raw)
    status = "ok" if value else ("invalide" if raw else "absent")
    authorized = bool(options.get("show_blood_group"))
    return {"status": status, "authorized": authorized, **({"value": value} if authorized and value else {})}


def design_uses(design: dict[str, Any] | None, *, kind: str | None = None, field: str | None = None) -> bool:
    """La maquette montre-t-elle un élément de ce type, ou un texte avec ce champ {{…}} ?"""
    for page in (design or {}).get("pages") or []:
        for element in page.get("elements") or []:
            if element.get("hidden"):
                continue
            if kind and element.get("type") == kind:
                return True
            if field and element.get("type") == "text" and "{{" in str(element.get("text") or "") and \
                    field in badge_design._FIELD_RE.findall(str(element.get("text") or "")):
                return True
    return False


def site_code_state(current: tuple[Assignment, Site] | None) -> str:
    if not current:
        return "sans_affectation"
    return "ok" if str(current[1].official_code or "").strip() else "absent"


def site_code_problem(employee_values_: dict[str, Any], current: tuple[Assignment, Site] | None) -> str | None:
    """Message bloquant si le code officiel du site ne peut pas être imprimé. Jamais de valeur supposée."""
    if employee_values_.get("site_code"):
        return None
    if not current:
        return ("Code officiel du site non renseigné : l'employé n'a pas d'affectation active. "
                "Affectez-le à son site avant d'émettre le badge.")
    return (f"Code officiel du site non renseigné pour le site « {current[1].name or current[1].id} ». "
            "Complétez-le dans Gestion des sites (fiche du site › Code officiel du site), puis émettez le badge.")


def employee_values(employee: Employee, current: tuple[Assignment, Site] | None, *, blood: bool = False) -> dict[str, str]:
    """Champs du badge lus dans la fiche employé et son affectation active. Le groupe sanguin
    n'y figure que si son affichage est autorisé (blood=True) et qu'il est renseigné."""
    data = _employee_data(employee)
    affectation = data.get("affectationCourante") if isinstance(data.get("affectationCourante"), dict) else {}
    assignment, site = current if current else (None, None)
    nom = str(data.get("nom") or employee.last_name or "").strip()
    prenom = str(data.get("prenom") or employee.first_name or "").strip()
    site_name = str((site.name if site else "") or affectation.get("siteName") or affectation.get("siteNom") or affectation.get("site") or "").strip()
    return {
        "societe": str(data.get("societe") or employee.society or "").strip(),
        "nom": nom, "prenom": prenom, "nom_complet": f"{nom} {prenom}".strip(),
        "matricule": str(data.get("matricule") or employee.code or employee.id).strip(),
        "fonction": str((assignment.position if assignment else "") or affectation.get("poste") or data.get("fonction") or employee.position or "").strip(),
        "site": site_name,
        # Code OFFICIEL du site d'affectation (sites.official_code). Jamais l'indicatif radio, le nom
        # du site ou du client : absent, il reste vide et l'émission est bloquée.
        "site_code": str((site.official_code if site else "") or "").strip().upper(),
        "statut": str(data.get("statutProfessionnel") or data.get("categorie") or data.get("statut") or employee.status or "").strip(),
        **({"groupe_sanguin": value} if blood and (value := blood_group_of(employee)) else {}),
    }


def unprintable_fields(values: dict[str, Any]) -> list[str]:
    return [badge_design.FIELDS[key] for key, value in values.items() if key in badge_design.FIELDS and badge_design.unprintable(value)]


def _photo_value(employee: Employee) -> str:
    data = _employee_data(employee)
    return next((str(data.get(key)) for key in ("photo", "photoUrl", "photo_url") if data.get(key)), "")


def _normalize_jpeg(content: bytes) -> bytes | None:
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(content)) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((900, 900))
            out = io.BytesIO()
            image.save(out, format="JPEG", quality=88)
            return out.getvalue()
    except Exception:
        return None


def employee_photo(db: Session, employee: Employee, source: str = "portrait") -> bytes | None:
    """Photo du badge : portrait de présentation déjà calculé par la DRH (visage recadré, fond
    blanc), sinon la photo de la fiche telle quelle. Jamais d'écriture de la photo source."""
    from app.modules.biometrics.service import _employee_photo_path

    path = _employee_photo_path(employee)
    if path is None:
        value = _photo_value(employee)
        if value.startswith("data:image/"):
            try:
                import base64
                return _normalize_jpeg(base64.b64decode(value.split(",", 1)[1]))
            except Exception:
                return None
        return None
    if source == "portrait":
        try:
            from app.modules.drh import portrait

            result = portrait.portrait_for(db, employee)
            if result is not None:
                return result.image
        except Exception:
            logger.exception("Portrait indisponible pour le badge (employé %s) : photo d'origine utilisée", employee.id)
            db.rollback()
    return _normalize_jpeg(path.read_bytes())


def _qr_url(request: Request, employee: Employee, badge_id: int | None = None) -> str:
    """RETOUR ARRIÈRE de l'émission A1 : les nouveaux badges reprennent le lien public signé
    (`…?t=…&b=…`). La LECTURE des badges A1 déjà imprimés est conservée (Pointeur, /p/<code>) :
    voir app/modules/drh/badge_qr.py et docs/drh-badge-studio.md, « Retour arrière »."""
    return _studio_link_v0(request, employee, badge_id)


def _studio_link_v0(request: Request, employee: Employee, badge_id: int | None = None) -> str:
    """Lien public signé `…/public/badge/<id>?t=…[&b=…]` : format de tous les badges émis avant le
    format A1. Ces badges, déjà imprimés, restent valides au Pointeur et en consultation publique."""
    from urllib.parse import quote

    from app.main import _public_employee_token

    ref = str(employee.id)
    base = f"{str(request.base_url).rstrip('/')}/public/badge/{quote(ref, safe='')}"
    if badge_id is None:
        return f"{base}?t={_public_employee_token('badge', ref)}"
    return f"{base}?t={_public_employee_token('badge', f'{ref}:{badge_id}')}&b={badge_id}"


# ── Paramètres ───────────────────────────────────────────────────────────────

def _clean_settings(raw: dict[str, Any]) -> dict[str, Any]:
    data = dict(DEFAULT_SETTINGS)
    prefix = "".join(ch for ch in str(raw.get("number_prefix") or "").upper() if ch.isalnum())[:8]
    data["number_prefix"] = prefix or DEFAULT_SETTINGS["number_prefix"]
    data["validity_months"] = int(badge_design._number(raw.get("validity_months"), 0, 120, 0))
    data["require_photo"] = bool(raw.get("require_photo", True))
    data["photo_source"] = raw.get("photo_source") if raw.get("photo_source") in ("portrait", "original") else "portrait"
    data["print_layout"] = raw.get("print_layout") if raw.get("print_layout") in ("card", "a4") else "card"
    data["sheet_margin_mm"] = badge_design._number(raw.get("sheet_margin_mm"), 5, 30, 10)
    data["sheet_gap_mm"] = badge_design._number(raw.get("sheet_gap_mm"), 0, 20, 4)
    data["crop_marks"] = bool(raw.get("crop_marks", True))
    reference = " ".join(str(raw.get("blood_group_authorization") or "").split())[:200]
    data["blood_group_authorization"] = reference
    data["show_blood_group"] = bool(raw.get("show_blood_group")) and len(reference) >= 3
    return data


def blood_allowed(db: Session, society: str | None) -> bool:
    return bool(load_settings(db, society)["show_blood_group"])


def load_settings(db: Session, society: str | None) -> dict[str, Any]:
    data: dict[str, Any] = {}
    rows = {row.scope: row for row in db.execute(select(BadgeSettings)).scalars()}
    if "*" in rows:
        data.update(rows["*"].data or {})
    key = _society_key(society)
    for scope, row in rows.items():
        if key and _society_key(scope) == key:
            data.update(row.data or {})
    return _clean_settings(data)


# ── Modèles ──────────────────────────────────────────────────────────────────

REFERENCE_KEY = "reference"


def ensure_reference_template(db: Session) -> BadgeTemplate:
    """Modèle officiel, créé au premier accès. La clé unique system_key garantit qu'il n'en
    existe qu'un, même si deux requêtes arrivent en même temps."""
    stmt = select(BadgeTemplate).where(BadgeTemplate.system_key == REFERENCE_KEY)
    template = db.execute(stmt).scalar_one_or_none()
    if template is None:
        design = badge_design.reference_design()
        has_default = db.execute(select(BadgeTemplate.id).where(BadgeTemplate.is_default == 1, BadgeTemplate.society.is_(None),
                                                                BadgeTemplate.active == 1)).first()
        try:
            with db.begin_nested():
                db.add(BadgeTemplate(name="IRON GLOBAL — Référence", society=None, design=design,
                                     description="Modèle officiel : bandeau noir du site, photo bordée de jaune, bandeau jaune de la fonction.",
                                     width_mm=design["width"], height_mm=design["height"], is_default=0 if has_default else 1,
                                     is_system=1, system_key=REFERENCE_KEY, active=1, created_by="système"))
            db.commit()
        except IntegrityError:
            db.rollback()
        template = db.execute(stmt).scalar_one()
    if template.version < badge_design.REFERENCE_VERSION:
        _upgrade_reference(db, template)
    return template


def _upgrade_reference(db: Session, template: BadgeTemplate) -> None:
    """Le modèle système n'est pas modifiable par les utilisateurs : sa maquette suit celle du
    code. Les badges déjà émis gardent la leur (instantané) ; seuls les NOUVEAUX badges émis
    avec ce modèle en profitent. Tracé dans l'historique."""
    design = badge_design.reference_design()
    previous = template.version
    template.design, template.width_mm, template.height_mm = design, design["width"], design["height"]
    template.version = badge_design.REFERENCE_VERSION
    template.updated_by = "système"
    db.add(BadgeEvent(action="MODELE_MODIFIE", template_id=template.id, society=None, username="système",
                      label=f"Modèle « {template.name} » mis à jour (version {previous} → {template.version}) : élément « Groupe sanguin », masqué tant que son affichage n'est pas autorisé",
                      details={"from": previous, "to": template.version}))
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


def _template_or_404(db: Session, user: User, template_id: int) -> BadgeTemplate:
    template = db.get(BadgeTemplate, template_id)
    if template is None or not _society_visible(user, template.society):
        raise HTTPException(status_code=404, detail="Modèle introuvable")
    return template


def default_template(db: Session, society: str | None) -> BadgeTemplate:
    reference = ensure_reference_template(db)
    defaults = db.execute(select(BadgeTemplate).where(BadgeTemplate.is_default == 1, BadgeTemplate.active == 1)
                          .order_by(BadgeTemplate.id.desc())).scalars().all()
    key = _society_key(society)
    for template in defaults:
        if key and _society_key(template.society) == key:
            return template
    return next((template for template in defaults if template.society is None), reference)


def _template_out(template: BadgeTemplate, *, with_design: bool = True) -> dict[str, Any]:
    out = {"id": template.id, "name": template.name, "description": template.description or "", "society": template.society,
           "width_mm": template.width_mm, "height_mm": template.height_mm, "is_default": bool(template.is_default),
           "is_system": bool(template.is_system), "active": bool(template.active), "version": template.version,
           "created_by": template.created_by, "updated_by": template.updated_by,
           "created_at": template.created_at, "updated_at": template.updated_at}
    if with_design:
        out["design"] = template.design
        out["warnings"] = badge_design.design_warnings(template.design)
    return out


def _design_or_422(raw: Any) -> dict[str, Any]:
    try:
        return badge_design.sanitize_design(raw)
    except badge_design.DesignError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: str | None = Field(None, max_length=1000)
    society: str | None = Field(None, max_length=150)
    design: dict[str, Any]


def _template_society(user: User, society: str | None) -> str | None:
    """Un modèle commun (sans société) ne peut être créé ou modifié que par un compte sans
    restriction de société ; sinon le modèle appartient à une société autorisée."""
    if not _society_key(society):
        if _allowed_societies(user):
            raise HTTPException(status_code=403, detail="Choisissez une société : un modèle commun est réservé aux comptes sans restriction de société.")
        return None
    _ensure_society_allowed(user, society)
    return _canonical_allowed_society(user, society) or str(society).strip()


@router.get("/templates")
def list_templates(include_archived: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _access(user)
    ensure_reference_template(db)
    stmt = select(BadgeTemplate).order_by(BadgeTemplate.is_system.desc(), BadgeTemplate.name)
    if not include_archived:
        stmt = stmt.where(BadgeTemplate.active == 1)
    rows = [row for row in db.execute(stmt).scalars() if _society_visible(user, row.society)]
    return {"items": [_template_out(row) for row in rows], "fields": badge_design.FIELDS, "fonts": badge_design.FONTS}


@router.post("/templates")
def create_template(payload: TemplateIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _require(db, user, request, "admin")
    design = _design_or_422(payload.design)
    template = BadgeTemplate(name=payload.name.strip(), description=(payload.description or "").strip() or None,
                             society=_template_society(user, payload.society), width_mm=design["width"], height_mm=design["height"],
                             design=design, created_by=user.username, updated_by=user.username)
    db.add(template)
    db.flush()
    _log(db, user, request, "MODELE_CREE", f"Modèle « {template.name} » créé", template=template)
    db.commit()
    return _template_out(template)


@router.put("/templates/{template_id}")
def update_template(template_id: int, payload: TemplateIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _require(db, user, request, "admin")
    template = _template_or_404(db, user, template_id)
    if template.is_system:
        raise HTTPException(status_code=409, detail="Le modèle de référence n'est pas modifiable : dupliquez-le pour le personnaliser.")
    _template_society(user, template.society)
    design = _design_or_422(payload.design)
    template.name = payload.name.strip()
    template.description = (payload.description or "").strip() or None
    template.society = _template_society(user, payload.society)
    template.design, template.width_mm, template.height_mm = design, design["width"], design["height"]
    template.version += 1
    template.updated_by = user.username
    if template.is_default:
        _clear_other_defaults(db, template)
    _log(db, user, request, "MODELE_MODIFIE", f"Modèle « {template.name} » modifié (version {template.version})", template=template)
    db.commit()
    return _template_out(template)


@router.post("/templates/{template_id}/duplicate")
def duplicate_template(template_id: int, request: Request, society: str | None = Query(None, max_length=150),
                       db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _require(db, user, request, "admin")
    source = _template_or_404(db, user, template_id)
    allowed = _allowed_societies(user)
    target = society or source.society or (allowed[0] if allowed else None)
    copy = BadgeTemplate(name=f"{source.name} — copie"[:150], description=source.description, society=_template_society(user, target),
                         width_mm=source.width_mm, height_mm=source.height_mm, design=source.design,
                         created_by=user.username, updated_by=user.username)
    db.add(copy)
    db.flush()
    _log(db, user, request, "MODELE_DUPLIQUE", f"Modèle « {source.name} » dupliqué", template=copy, details={"source_id": source.id})
    db.commit()
    return _template_out(copy)


def _clear_other_defaults(db: Session, template: BadgeTemplate) -> None:
    key = _society_key(template.society)
    for other in db.execute(select(BadgeTemplate).where(BadgeTemplate.is_default == 1, BadgeTemplate.id != template.id)).scalars():
        if _society_key(other.society) == key:
            other.is_default = 0


@router.post("/templates/{template_id}/default")
def set_default_template(template_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _require(db, user, request, "admin")
    template = _template_or_404(db, user, template_id)
    _template_society(user, template.society)
    if not template.active:
        raise HTTPException(status_code=409, detail="Un modèle archivé ne peut pas être le modèle par défaut.")
    _clear_other_defaults(db, template)
    template.is_default = 1
    _log(db, user, request, "MODELE_DEFAUT", f"Modèle « {template.name} » défini par défaut", template=template)
    db.commit()
    return _template_out(template)


@router.delete("/templates/{template_id}")
def archive_template(template_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Archive (jamais de suppression physique : des badges émis s'y réfèrent)."""
    _require(db, user, request, "admin")
    template = _template_or_404(db, user, template_id)
    if template.is_system:
        raise HTTPException(status_code=409, detail="Le modèle de référence ne peut pas être archivé.")
    _template_society(user, template.society)
    if template.is_default:
        raise HTTPException(status_code=409, detail="Choisissez d'abord un autre modèle par défaut.")
    template.active = 0
    _log(db, user, request, "MODELE_ARCHIVE", f"Modèle « {template.name} » archivé", template=template)
    db.commit()
    return {"ok": True}


# ── Badges ───────────────────────────────────────────────────────────────────

def _expired(badge: EmployeeBadge) -> bool:
    return bool(badge.valid_until and badge.valid_until < date.today())


def _snapshot_values(badge: EmployeeBadge, blood: bool) -> dict[str, Any]:
    """Valeurs figées à l'émission. Le groupe sanguin éventuellement figé n'est restitué que si
    son affichage est encore autorisé : un retrait d'autorisation le masque aussi en réimpression."""
    snapshot = badge.snapshot if isinstance(badge.snapshot, dict) else {}
    values = dict(snapshot.get("values") or {})
    if not blood:
        values.pop("groupe_sanguin", None)
    return values


def _badge_out(badge: EmployeeBadge, *, detail: bool = False, blood: bool = False) -> dict[str, Any]:
    snapshot = badge.snapshot if isinstance(badge.snapshot, dict) else {}
    out = {"id": badge.id, "number": badge.number, "employee_id": badge.employee_id, "status": badge.status,
           "expired": _expired(badge), "society": badge.society, "template_id": badge.template_id, "template_name": badge.template_name,
           "values": _snapshot_values(badge, blood), "has_photo": badge.photo is not None, "page_count": len((badge.design or {}).get("pages") or []) or 1,
           "width_mm": badge.width_mm, "height_mm": badge.height_mm,
           "issued_at": badge.issued_at, "issued_by": badge.issued_by, "valid_until": badge.valid_until,
           "revoked_at": badge.revoked_at, "revoked_by": badge.revoked_by, "revoke_reason": badge.revoke_reason,
           "print_count": badge.print_count, "last_printed_at": badge.last_printed_at}
    if detail:
        out.update(design=badge.design, crop=snapshot.get("crop") or {}, qr=badge_design.qr_matrix(snapshot.get("qr_url") or ""))
    return out


def _item(badge: EmployeeBadge, blood: bool = False) -> badge_pdf.BadgeItem:
    snapshot = badge.snapshot if isinstance(badge.snapshot, dict) else {}
    return badge_pdf.BadgeItem(design=badge.design, values=_snapshot_values(badge, blood), photo=badge.photo,
                               crop=snapshot.get("crop"), qr=badge_design.qr_matrix(snapshot.get("qr_url") or ""))


def _set_public_badge_state(employee: Employee, active: bool) -> None:
    """La page publique scannée lit badgeActif dans la fiche : elle suit l'état du badge émis."""
    extra = dict(employee.extra) if isinstance(employee.extra, dict) else {}
    if extra.get("badgeActif", True) is not active:
        extra["badgeActif"] = active
        employee.extra = extra


def _add_months(day: date, months: int) -> date:
    month = day.month - 1 + months
    year, month = day.year + month // 12, month % 12 + 1
    last = (date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)).day
    return date(year, month, min(day.day, last))


def issue_badge(db: Session, user: User, request: Request, employee: Employee, template: BadgeTemplate, *,
                crop: dict[str, Any] | None, valid_until: date | None, blood_group_waiver: str | None = None) -> EmployeeBadge:
    if str(employee.status or "").strip().lower() == "sortant":
        raise HTTPException(status_code=409, detail="Employé sortant : aucun badge ne peut être émis.")
    options = load_settings(db, employee.society)
    photo = employee_photo(db, employee, options["photo_source"])
    if photo is None and options["require_photo"]:
        raise HTTPException(status_code=409, detail="Photo manquante : ajoutez la photo de l'employé avant d'émettre le badge.")
    # Verrou de la fiche (PostgreSQL) : deux émissions simultanées ne laissent pas deux badges actifs.
    db.execute(select(Employee.id).where(Employee.id == employee.id).with_for_update())
    current = _current_sites(db, [employee.id]).get(employee.id)
    values = employee_values(employee, current, blood=options["show_blood_group"])
    problems = unprintable_fields(values)
    if problems:
        raise HTTPException(status_code=409, detail="Caractères non imprimables sur le badge (alphabet non latin) : " + ", ".join(problems)
                            + ". Saisissez ces informations en caractères latins sur la fiche.")
    if design_uses(template.design, field="site_code") and (problem := site_code_problem(values, current)):
        raise HTTPException(status_code=409, detail=problem)
    waiver = None
    if options["show_blood_group"] and design_uses(template.design, kind="blood") and "groupe_sanguin" not in values:
        # Affichage autorisé : chaque badge officiel porte le groupe sanguin. S'il manque, aucune
        # valeur n'est supposée : on régularise la fiche, ou un responsable (droit de révocation)
        # émet avec une dérogation motivée, tracée sans donnée médicale.
        state = blood_group_state(employee, options)["status"]
        missing = "invalide sur la fiche (valeurs admises : O+, O−, A+, A−, B+, B−, AB+, AB−)" if state == "invalide" else "non renseigné sur la fiche"
        if not blood_group_waiver:
            raise HTTPException(status_code=409, detail=f"Groupe sanguin {missing} : régularisez la fiche employé (DRH), ou émettez avec une dérogation motivée.")
        if blood_group_waiver not in BLOOD_WAIVERS:
            raise HTTPException(status_code=422, detail="Motif de dérogation inconnu.")
        if not badge_rights(db, user)["validate"]:
            raise HTTPException(status_code=403, detail="Dérogation au groupe sanguin réservée aux responsables habilités (Administration › Permissions › Studio Badges › Révoquer).")
        waiver = blood_group_waiver
    today = date.today()
    if valid_until is None and options["validity_months"]:
        valid_until = _add_months(today, options["validity_months"])
    if valid_until is not None and valid_until < today:
        raise HTTPException(status_code=422, detail="La fin de validité ne peut pas être dans le passé.")
    replaced = db.execute(select(EmployeeBadge).where(EmployeeBadge.employee_id == employee.id, EmployeeBadge.status == STATUS_ACTIVE)).scalars().all()
    for previous in replaced:
        previous.status = STATUS_REPLACED
        previous.revoked_at, previous.revoked_by = datetime.utcnow(), user.username
        previous.revoke_reason = "Remplacé par un nouveau badge"
    badge = EmployeeBadge(employee_id=employee.id, template_id=template.id, template_name=template.name, society=employee.society,
                          status=STATUS_ACTIVE, snapshot={}, design=template.design, width_mm=template.width_mm, height_mm=template.height_mm,
                          photo=photo, issued_at=datetime.utcnow(), issued_by=user.username, valid_until=valid_until)
    db.add(badge)
    db.flush()
    badge.number = f"{options['number_prefix']}-{today.year}-{badge.id:06d}"
    values.update(numero=badge.number, date_emission=today.strftime("%d/%m/%Y"),
                  validite=valid_until.strftime("%d/%m/%Y") if valid_until else "")
    badge.snapshot = {"values": values, "crop": badge_design.clean_crop(crop), "qr_url": _qr_url(request, employee, badge.id),
                      "site_id": current[1].id if current else None, "template_version": template.version,
                      "blood_group_shown": "groupe_sanguin" in values, **({"blood_group_waiver": waiver} if waiver else {})}
    _set_public_badge_state(employee, True)
    _log(db, user, request, "EMISSION", f"Badge {badge.number} émis pour {values['nom_complet']} ({values['matricule']})", badge=badge,
         details={"number": badge.number, "template": template.name, "replaced": [row.number for row in replaced],
                  **({"blood_group_waiver": waiver} if waiver else {})})
    return badge


class IssueIn(BaseModel):
    employee_id: int
    template_id: int | None = None
    crop: dict[str, Any] | None = None
    valid_until: date | None = None
    blood_group_waiver: str | None = Field(None, max_length=30)


class IssueBatchIn(BaseModel):
    employee_ids: list[int] = Field(min_length=1, max_length=MAX_BATCH)
    template_id: int | None = None
    skip_existing: bool = True


class RevokeIn(BaseModel):
    reason: str = Field(max_length=20)
    comment: str | None = Field(None, max_length=500)


class PrintIn(BaseModel):
    badge_ids: list[int] = Field(min_length=1, max_length=MAX_BATCH)
    layout: str | None = Field(None, max_length=10)


class PreviewIn(BaseModel):
    employee_id: int | None = None
    template_id: int | None = None
    design: dict[str, Any] | None = None
    crop: dict[str, Any] | None = None


def _scoped_employees(db: Session, user: User, society: str | None) -> list[Employee]:
    effective = _effective_society_filter(user, society)
    rows = service.list_employees(db, society=effective, allowed_societies=_allowed_societies(user))
    rows = [row for row in rows if _society_visible(user, row.society)]
    scope = _site_scope(user)
    if scope is not None:
        sites = _current_sites(db, [row.id for row in rows])
        rows = [row for row in rows if _site_visible(scope, sites[row.id][1].id if row.id in sites else None)]
    return rows


def _active_badges(db: Session, employee_ids: list[int]) -> dict[int, EmployeeBadge]:
    if not employee_ids:
        return {}
    rows = db.execute(select(EmployeeBadge).where(EmployeeBadge.status == STATUS_ACTIVE, EmployeeBadge.employee_id.in_(employee_ids))
                      .order_by(EmployeeBadge.id.desc())).scalars().all()
    result: dict[int, EmployeeBadge] = {}
    for row in rows:
        result.setdefault(row.employee_id, row)
    return result


class _BloodPolicy:
    """Autorisation d'affichage du groupe sanguin, lue une fois par société et par requête."""

    def __init__(self, db: Session) -> None:
        self.db, self.cache = db, {}

    def __call__(self, society: str | None) -> bool:
        key = _society_key(society)
        if key not in self.cache:
            self.cache[key] = blood_allowed(self.db, society)
        return self.cache[key]


def _employee_row(employee: Employee, current: tuple[Assignment, Site] | None, badge: EmployeeBadge | None, *, blood: bool = False) -> dict[str, Any]:
    values = employee_values(employee, current, blood=blood)
    return {"id": employee.id, **values, "employee_status": employee.status, "unprintable": unprintable_fields(values),
            "site_id": current[1].id if current else None, "site_code_status": site_code_state(current),
            "has_photo": bool(_photo_value(employee)), "badge": _badge_out(badge, blood=blood) if badge else None}


def _is_sortant(employee: Employee) -> bool:
    return str(employee.status or "").strip().lower() == "sortant"


@router.get("/permissions")
def my_badge_rights(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _access(user)
    return rights_out(db, user)


@router.get("/dashboard")
def dashboard(society: str | None = Query(None, max_length=150), site_id: int | None = Query(None, ge=1),
              db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _access(user)
    ensure_reference_template(db)
    employees = [row for row in _scoped_employees(db, user, society) if not _is_sortant(row)]
    if site_id:
        sites = _current_sites(db, [row.id for row in employees])
        employees = [row for row in employees if row.id in sites and sites[row.id][1].id == site_id]
    badges = _active_badges(db, [row.id for row in employees])
    today = date.today()
    soon = today + timedelta(days=30)
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    ids = {row.id for row in employees}
    all_badges = [row for row in db.execute(select(EmployeeBadge.employee_id, EmployeeBadge.status, EmployeeBadge.issued_at,
                                                    EmployeeBadge.valid_until, EmployeeBadge.revoke_reason)).all() if row.employee_id in ids]
    active = list(badges.values())
    expired = [badge for badge in active if badge.valid_until and badge.valid_until < today]
    events = _history_rows(db, user, society)
    return {
        "employees": len(employees),
        "with_badge": len(badges),
        "without_badge": len(employees) - len(badges),
        "without_photo": sum(1 for row in employees if not _photo_value(row)),
        "to_print": sum(1 for badge in active if not badge.print_count),
        "expiring": sum(1 for badge in active if badge.valid_until and today <= badge.valid_until <= soon),
        "revoked": sum(1 for row in all_badges if row.status == STATUS_REVOKED),
        "issued_this_month": sum(1 for row in all_badges if row.issued_at and row.issued_at >= month_start),
        # Portail badge.irongs.com : état du parc de badges émis
        "total_badges": len(all_badges),
        "active": len(active) - len(expired),
        "expired": len(expired),
        "lost": sum(1 for row in all_badges if row.status == STATUS_REVOKED and str(row.revoke_reason or "").startswith(REVOKE_REASONS["perdu"])),
        "to_renew": len(expired) + sum(1 for badge in active if badge.valid_until and today <= badge.valid_until <= soon),
        "templates": sum(1 for row in db.execute(select(BadgeTemplate.society).where(BadgeTemplate.active == 1)).all() if _society_visible(user, row.society)),
        "recent": events[:8],
        "recent_issues": [event for event in events if event["action"] == "EMISSION"][:6],
    }


@router.get("/employees/facets")
def badge_employee_facets(society: str | None = Query(None, max_length=150), db: Session = Depends(get_db),
                          user: User = Depends(current_user)) -> dict[str, Any]:
    """Valeurs proposées par les filtres (sociétés, sites, fonctions) du périmètre de l'utilisateur."""
    _access(user)
    employees = [row for row in _scoped_employees(db, user, society) if not _is_sortant(row)]
    sites = _current_sites(db, [row.id for row in employees])
    societies, site_rows, functions = set(), {}, set()
    for employee in employees:
        current = sites.get(employee.id)
        values = employee_values(employee, current)
        if values["societe"]:
            societies.add(values["societe"])
        if current:
            site_rows[current[1].id] = {"id": current[1].id, "name": current[1].name or "", "code": current[1].official_code or ""}
        if values["fonction"]:
            functions.add(values["fonction"])
    return {"societies": sorted(societies, key=str.upper),
            "sites": sorted(site_rows.values(), key=lambda row: (row["code"] or row["name"]).upper()),
            "functions": sorted(functions, key=str.upper)}


@router.get("/employees")
def badge_employees(society: str | None = Query(None, max_length=150), q: str | None = Query(None, max_length=120),
                    state: str = Query("all", max_length=20), site_id: int | None = Query(None, ge=1),
                    fonction: str | None = Query(None, max_length=150),
                    page: int = 1, page_size: int = 50,
                    db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Employés (hors sortants) avec l'état de leur badge."""
    _access(user)
    employees = [row for row in _scoped_employees(db, user, society) if not _is_sortant(row)]
    sites = _current_sites(db, [row.id for row in employees])
    badges = _active_badges(db, [row.id for row in employees])
    needle, wanted_function = _society_key(q), _society_key(fonction)
    blood = _BloodPolicy(db)
    rows = []
    for employee in employees:
        current, badge = sites.get(employee.id), badges.get(employee.id)
        if site_id and (not current or current[1].id != site_id):
            continue
        row = _employee_row(employee, current, badge, blood=blood(employee.society))
        if wanted_function and _society_key(row["fonction"]) != wanted_function:
            continue
        if needle and needle not in _society_key(" ".join((row["nom"], row["prenom"], row["matricule"], row["fonction"], row["site"], row["site_code"]))):
            continue
        if ((state == "with" and not badge) or (state == "without" and badge) or (state == "no_photo" and row["has_photo"])
                or (state == "to_print" and (not badge or badge.print_count))):
            continue
        rows.append(row)
    rows.sort(key=lambda row: (row["nom"].upper(), row["prenom"].upper()))
    return paginate_list(rows, page=page, page_size=min(max(page_size, 1), 200))


@router.get("/employees/{employee_id}")
def badge_employee(employee_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Tout ce qu'il faut pour préparer le badge d'un employé : champs, QR, modèle proposé, badges déjà émis."""
    _access(user)
    employee = _badge_employee(db, user, employee_id)
    current = _current_sites(db, [employee.id]).get(employee.id)
    history = db.execute(select(EmployeeBadge).where(EmployeeBadge.employee_id == employee.id).order_by(EmployeeBadge.id.desc())).scalars().all()
    active = next((row for row in history if row.status == STATUS_ACTIVE), None)
    badge_settings = load_settings(db, employee.society)
    blood = badge_settings["show_blood_group"]
    return {**_employee_row(employee, current, active, blood=blood), "qr": badge_design.qr_matrix(_qr_url(request, employee)),
            "default_template_id": default_template(db, employee.society).id, "badges": [_badge_out(row, blood=blood) for row in history],
            "settings": badge_settings, "can_issue": not _is_sortant(employee), "rights": rights_out(db, user),
            "blood_group": blood_group_state(employee, badge_settings), "blood_waivers": BLOOD_WAIVERS,
            "site_code_problem": site_code_problem(employee_values(employee, current), current)}


@router.get("/employees/{employee_id}/photo")
def badge_employee_photo(employee_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    _access(user)
    employee = _badge_employee(db, user, employee_id)
    content = employee_photo(db, employee, load_settings(db, employee.society)["photo_source"])
    if content is None:
        raise HTTPException(status_code=404, detail="Aucune photo sur la fiche de l'employé")
    return Response(content=content, media_type="image/jpeg", headers=PDF_HEADERS)


@router.post("/issue")
def issue(payload: IssueIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _require(db, user, request, "create")
    employee = _badge_employee(db, user, payload.employee_id)
    template = _template_or_404(db, user, payload.template_id) if payload.template_id else default_template(db, employee.society)
    if not template.active:
        raise HTTPException(status_code=409, detail="Ce modèle est archivé.")
    badge = issue_badge(db, user, request, employee, template, crop=payload.crop, valid_until=payload.valid_until,
                        blood_group_waiver=payload.blood_group_waiver)
    db.commit()
    return _badge_out(badge, detail=True, blood=blood_allowed(db, badge.society))


@router.post("/issue-batch")
def issue_batch(payload: IssueBatchIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Émission en lot : chaque employé est traité séparément ; un refus (photo manquante,
    société non autorisée…) n'empêche pas les autres."""
    _require(db, user, request, "create")
    template = _template_or_404(db, user, payload.template_id) if payload.template_id else None
    if template is not None and not template.active:
        raise HTTPException(status_code=409, detail="Ce modèle est archivé.")
    existing = _active_badges(db, payload.employee_ids) if payload.skip_existing else {}
    issued, skipped = [], []
    for employee_id in dict.fromkeys(payload.employee_ids):
        if employee_id in existing:
            issued.append(_badge_out(existing[employee_id]))
            continue
        try:
            employee = _badge_employee(db, user, employee_id)
            badge = issue_badge(db, user, request, employee, template or default_template(db, employee.society), crop=None, valid_until=None)
            db.commit()
            issued.append(_badge_out(badge))
        except HTTPException as exc:
            db.rollback()
            skipped.append({"employee_id": employee_id, "reason": str(exc.detail)})
    return {"issued": issued, "skipped": skipped}


@router.get("")
def list_badges(society: str | None = Query(None, max_length=150), status: str | None = Query(None, max_length=20),
                q: str | None = Query(None, max_length=120), page: int = 1, page_size: int = 50,
                db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _access(user)
    effective = _effective_society_filter(user, society)
    stmt = select(EmployeeBadge).order_by(EmployeeBadge.id.desc())
    if status:
        stmt = stmt.where(EmployeeBadge.status == status.upper())
    needle = _society_key(q)
    rows = []
    for badge in db.execute(stmt).scalars():
        if not _society_visible(user, badge.society) or (effective and _society_key(badge.society) != _society_key(effective)):
            continue
        values = (badge.snapshot or {}).get("values") or {}
        if needle and needle not in _society_key(" ".join(str(values.get(key) or "") for key in ("nom", "prenom", "matricule", "site_code")) + " " + str(badge.number)):
            continue
        rows.append(badge)
    result = paginate_list(rows, page=page, page_size=min(max(page_size, 1), 200))
    result["items"] = [_badge_out(row) for row in result["items"]]
    return result


def _history_rows(db: Session, user: User, society: str | None, action: str | None = None, employee_id: int | None = None) -> list[dict[str, Any]]:
    effective = _effective_society_filter(user, society)
    stmt = select(BadgeEvent).order_by(BadgeEvent.id.desc()).limit(2000)
    if action:
        stmt = stmt.where(BadgeEvent.action == action.upper())
    if employee_id:
        stmt = stmt.where(BadgeEvent.employee_id == employee_id)
    rows = []
    for event in db.execute(stmt).scalars():
        if not _society_visible(user, event.society) or (effective and event.society and _society_key(event.society) != _society_key(effective)):
            continue
        rows.append({"id": event.id, "created_at": event.created_at, "action": event.action, "label": event.label,
                     "badge_id": event.badge_id, "employee_id": event.employee_id, "template_id": event.template_id,
                     "society": event.society, "username": event.username})
    return rows


@router.get("/history")
def history(society: str | None = Query(None, max_length=150), action: str | None = Query(None, max_length=40),
            employee_id: int | None = Query(None, ge=1), q: str | None = Query(None, max_length=120),
            page: int = 1, page_size: int = 50, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _access(user)
    rows = _history_rows(db, user, society, action, employee_id)
    needle = _society_key(q)
    if needle:
        rows = [row for row in rows if needle in _society_key(f"{row['label']} {row['username']}")]
    return paginate_list(rows, page=page, page_size=min(max(page_size, 1), 200))


@router.get("/settings")
def get_settings(society: str | None = Query(None, max_length=150), db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _access(user)
    _ensure_society_allowed(user, society)
    return {"society": society or None, "data": load_settings(db, society), "revoke_reasons": REVOKE_REASONS,
            "card": {"width_mm": badge_design.CARD_WIDTH_MM, "height_mm": badge_design.CARD_HEIGHT_MM}}


class SettingsIn(BaseModel):
    society: str | None = Field(None, max_length=150)
    data: dict[str, Any]


@router.put("/settings")
def put_settings(payload: SettingsIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _require(db, user, request, "admin")
    society = _template_society(user, payload.society)
    scope = society or "*"
    data = _clean_settings(payload.data)
    before = load_settings(db, society)["show_blood_group"]
    row = db.execute(select(BadgeSettings).where(BadgeSettings.scope == scope)).scalar_one_or_none()
    if row is None:
        db.add(BadgeSettings(scope=scope, data=data, updated_by=user.username))
    else:
        row.data, row.updated_by = data, user.username
    label = f"Paramètres des badges modifiés ({society or 'toutes sociétés'})"
    if data["show_blood_group"] != before:
        label += (f" — affichage du groupe sanguin AUTORISÉ (référence : {data['blood_group_authorization']})" if data["show_blood_group"]
                  else " — affichage du groupe sanguin désactivé")
    _log(db, user, request, "PARAMETRES", label, society=society, details=data)
    db.commit()
    return {"society": society, "data": load_settings(db, society)}


def _specimen(content_items: list[badge_pdf.BadgeItem]) -> bytes:
    """Épreuve : une page par face, barrée « SPÉCIMEN » — elle ne remplace jamais un badge émis."""
    from reportlab.lib.colors import HexColor
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdf_canvas

    buffer = io.BytesIO()
    c = pdf_canvas.Canvas(buffer)
    c.setTitle("Épreuve de badge")
    for item in content_items:
        width, height = item.design["width"] * mm, item.design["height"] * mm
        for page_index in range(len(item.design["pages"])):
            c.setPageSize((width, height))
            badge_pdf.draw_face(c, item, page_index, 0, height)
            c.saveState()
            c.translate(width / 2, height / 2)
            c.rotate(55)
            c.setFillColor(HexColor("#DC2626"))
            c.setFillAlpha(0.28)
            c.setFont("Helvetica-Bold", min(width, height) / 5)
            c.drawCentredString(0, 0, "SPÉCIMEN")
            c.restoreState()
            c.showPage()
    c.save()
    return buffer.getvalue()


@router.post("/preview/pdf")
def preview_pdf(payload: PreviewIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    """Épreuve PDF d'une maquette (enregistrée ou en cours d'édition), sans rien émettre."""
    _access(user)
    if payload.design is not None:
        design = _design_or_422(payload.design)
    elif payload.template_id:
        design = _template_or_404(db, user, payload.template_id).design
    else:
        design = default_template(db, None).design
    values, photo, qr = dict(SAMPLE_VALUES), None, badge_design.qr_matrix("https://drh.irongs.com/public/badge/specimen")
    if payload.employee_id:
        employee = _badge_employee(db, user, payload.employee_id)
        values = {key: value for key, value in SAMPLE_VALUES.items() if key != "groupe_sanguin"}
        values.update(employee_values(employee, _current_sites(db, [employee.id]).get(employee.id), blood=blood_allowed(db, employee.society)))
        photo = employee_photo(db, employee, load_settings(db, employee.society)["photo_source"])
        qr = badge_design.qr_matrix(_qr_url(request, employee))
    content = _specimen([badge_pdf.BadgeItem(design=design, values=values, photo=photo, crop=badge_design.clean_crop(payload.crop), qr=qr)])
    return Response(content=content, media_type="application/pdf",
                    headers={**PDF_HEADERS, "Content-Disposition": 'inline; filename="epreuve-badge.pdf"'})


@router.post("/print/pdf")
def print_pdf(payload: PrintIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    """PDF d'impression des badges émis (un ou plusieurs). Chaque impression est comptée et tracée."""
    _require(db, user, request, "export")
    badges = [_badge_or_404(db, user, badge_id) for badge_id in dict.fromkeys(payload.badge_ids)]
    blocked = [badge.number for badge in badges if badge.status != STATUS_ACTIVE]
    if blocked:
        raise HTTPException(status_code=409, detail="Badges non imprimables (révoqués ou remplacés) : " + ", ".join(str(n) for n in blocked))
    options = load_settings(db, badges[0].society)
    layout = payload.layout if payload.layout in ("card", "a4") else options["print_layout"]
    blood = _BloodPolicy(db)
    items = [_item(badge, blood(badge.society)) for badge in badges]
    title = f"Badge {badges[0].number}" if len(badges) == 1 else f"Badges ({len(badges)})"
    if layout == "a4":
        content = badge_pdf.render_sheets(items, margin_mm=options["sheet_margin_mm"], gap_mm=options["sheet_gap_mm"],
                                          crop_marks=options["crop_marks"], title=title)
    else:
        content = badge_pdf.render_cards(items, title=title)
    now = datetime.utcnow()
    for badge in badges:
        badge.print_count += 1
        badge.last_printed_at = now
        _log(db, user, request, "IMPRESSION", f"Badge {badge.number} imprimé ({'planche A4' if layout == 'a4' else 'carte'})", badge=badge,
             details={"layout": layout, "batch": len(badges), "print_count": badge.print_count})
    db.commit()
    name = f"badge-{badges[0].number}.pdf" if len(badges) == 1 else f"badges-{now:%Y%m%d-%H%M}.pdf"
    return Response(content=content, media_type="application/pdf",
                    headers={**PDF_HEADERS, "Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/{badge_id}")
def get_badge(badge_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _access(user)
    badge = _badge_or_404(db, user, badge_id)
    return _badge_out(badge, detail=True, blood=blood_allowed(db, badge.society))


@router.get("/{badge_id}/photo")
def badge_photo(badge_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    _access(user)
    badge = _badge_or_404(db, user, badge_id)
    if badge.photo is None:
        raise HTTPException(status_code=404, detail="Ce badge a été émis sans photo")
    return Response(content=badge.photo, media_type="image/jpeg", headers=PDF_HEADERS)


@router.post("/{badge_id}/revoke")
def revoke_badge(badge_id: int, payload: RevokeIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _require(db, user, request, "validate")
    badge = _badge_or_404(db, user, badge_id)
    if payload.reason not in REVOKE_REASONS:
        raise HTTPException(status_code=422, detail="Motif de révocation inconnu.")
    if badge.status != STATUS_ACTIVE:
        raise HTTPException(status_code=409, detail="Ce badge n'est plus actif.")
    reason = REVOKE_REASONS[payload.reason] + (f" — {payload.comment.strip()}" if payload.comment and payload.comment.strip() else "")
    badge.status, badge.revoked_at, badge.revoked_by, badge.revoke_reason = STATUS_REVOKED, datetime.utcnow(), user.username, reason
    employee = db.get(Employee, badge.employee_id) if badge.employee_id else None
    if employee is not None:
        _set_public_badge_state(employee, False)
    _log(db, user, request, "REVOCATION", f"Badge {badge.number} révoqué : {reason}", badge=badge, details={"reason": payload.reason})
    db.commit()
    return _badge_out(badge)
