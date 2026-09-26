"""ATLAS Site Workforce — sécurité (§B2, prioritaire avant toute UI).

Le rôle CHARGE_EFFECTIFS_SITE est un cas STRICT du mécanisme "superviseur terrain" déjà
présent (User.authorized_sites, voir ops/routes.py) : exactement UN site, jamais zéro,
jamais plusieurs. Le site n'est JAMAIS choisi par le client (aucun paramètre ?site_id= sur
aucune route de ce module) — il est résolu ICI, côté serveur, à partir du compte, et
réutilisé pour filtrer chaque requête. Pipeline complet : auth (current_user, déjà global)
→ module (enforce_module_access, déjà global) → société (SOCIETY_SCOPED_PREFIXES, déjà
global) → SITE (ici, spécifique à ce module) → règle métier (dans chaque route).
"""
from __future__ import annotations

from datetime import date

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site


def _authorized_site_ids(user: User) -> list[int]:
    values = user.authorized_sites if isinstance(user.authorized_sites, list) else []
    return [int(v) for v in values if str(v).strip().lstrip("-").isdigit()]


def _site_society(site: Site) -> str | None:
    """Même pont legacy que ops/routes.py::_site_society — Site n'a pas de colonne
    `society` propre, elle vit dans equipment_plan (JSON). Dupliqué ici volontairement
    (fonction pure de 8 lignes) plutôt que d'importer depuis un module de routes voisin."""
    plan = site.equipment_plan if isinstance(site.equipment_plan, dict) else {}
    legacy = plan.get("_legacy") if isinstance(plan.get("_legacy"), dict) else {}
    return plan.get("societe") or plan.get("society") or legacy.get("societe") or legacy.get("society") or None


def resolve_scoped_site(db: Session = Depends(get_db), user: User = Depends(current_user)) -> Site:
    """Résout LE site imposé de ce compte. Refuse si zéro ou plusieurs sites autorisés —
    ce rôle n'a jamais de sélecteur libre de site (§B2, §B6)."""
    site_ids = _authorized_site_ids(user)
    if len(site_ids) != 1:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Ce compte doit être rattaché à exactement un site (authorized_sites)",
        )
    site = db.get(Site, site_ids[0])
    if not site or not site.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Site introuvable ou inactif")
    society = _site_society(site)
    allowed_societies = [str(v).strip() for v in (user.authorized_societies or []) if str(v).strip()]
    if allowed_societies and (not society or society not in allowed_societies):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Site hors du périmètre société de ce compte")
    return site


BEO_ROLE = "charge_effectifs_site"


def is_beo_account(role: str | None, modules: list | None) -> bool:
    """Compte "Chargé des effectifs" (Bureau des Effectifs Ouest) : rôle métier ET clé
    site_workforce. Un autre profil qui a aussi site_workforce garde la sémantique
    historique (périmètres libres) ; resolve_scoped_site() le filtre de toute façon au runtime."""
    return str(role or "").strip().lower() == BEO_ROLE and "site_workforce" in [str(m).strip() for m in (modules or [])]


def validate_beo_account_scope(db: Session, *, role, modules, societies, sites, global_society_access) -> None:
    """Garde d'écriture (création/modification d'un compte via Administration) : exactement
    UNE société explicite, exactement UN site, et ce site appartient à cette société. Même
    comparaison société que resolve_scoped_site() — un état que le portail refuserait ne
    peut donc jamais être enregistré. Sans effet sur tout autre compte."""
    if not is_beo_account(role, modules):
        return

    def refuse(detail: str) -> None:
        raise HTTPException(status_code=422, detail=f"Chargé des effectifs (BEO) : {detail}")

    if global_society_access:
        refuse("l'accès global aux sociétés est interdit")
    allowed = [str(v).strip() for v in (societies or []) if str(v).strip()]
    if not allowed:
        refuse("une société autorisée est obligatoire (une liste vide n'est jamais un accès global)")
    if len(allowed) > 1:
        refuse("une seule société autorisée")
    site_ids = [int(v) for v in (sites or []) if str(v).strip().lstrip("-").isdigit()]
    if len(site_ids) != len(list(sites or [])):
        refuse("identifiant de site invalide")
    if not site_ids:
        refuse("un site autorisé est obligatoire")
    if len(site_ids) > 1:
        refuse("un seul site autorisé")
    site = db.get(Site, site_ids[0])
    if not site:
        refuse("site introuvable")
    if _site_society(site) != allowed[0]:
        refuse("le site n'appartient pas à la société autorisée")


def site_employee_ids(db: Session, site_id: int, *, as_of: date | None = None) -> list[int]:
    """Employés RÉELLEMENT affectés à CE site aujourd'hui (Assignment active), jamais tous
    les employés de la société — c'est la seule source de vérité "qui est sur ce site"."""
    today = as_of or date.today()
    stmt = select(Assignment.employee_id).where(
        Assignment.site_id == site_id,
        Assignment.active == 1,
        Assignment.start_date <= today,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= today),
    )
    return sorted({row for row in db.scalars(stmt).all()})


def ensure_employee_in_site(db: Session, site_id: int, employee_id: int) -> Employee:
    """403 (jamais 404 : ne pas laisser deviner qu'un employé existe ailleurs) si
    l'employé n'est pas actuellement affecté à CE site."""
    if employee_id not in site_employee_ids(db, site_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Employé hors du périmètre de ce site")
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Employé hors du périmètre de ce site")
    return employee
