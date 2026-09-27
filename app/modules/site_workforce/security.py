"""ATLAS Site Workforce — sécurité (§B2, prioritaire avant toute UI).

Le rôle CHARGE_EFFECTIFS_SITE voit 1 à N sociétés et 1 à N sites, TOUS explicitement
attribués (User.authorized_societies / authorized_sites) — jamais un accès global, jamais
d'héritage implicite (une société autorisée n'ouvre aucun site non listé). Le périmètre est
résolu ICI, côté serveur (resolve_scope) :
- `scope.sites` : sites autorisés ET actifs ET appartenant à une société autorisée ;
- `scope.selected` : sous-ensemble consulté (?society= / ?site_id=), refusé (403) s'il sort
  du périmètre — le client ne peut que RÉDUIRE ce qu'il voit, jamais l'étendre.
Lectures/agrégats : `scope.selected`. Action sur une ressource existante : son site réel doit
appartenir à `scope.sites`. Création : site = affectation réelle de l'employé.
Pipeline : auth → module → société (SOCIETY_SCOPED_PREFIXES) → SITES (ici) → règle métier.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from fastapi import Depends, HTTPException, Query, status
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


def _authorized_societies(user: User) -> list[str]:
    return [str(v).strip() for v in (user.authorized_societies or []) if str(v).strip()]


def _site_society(site: Site) -> str | None:
    """Même pont legacy que ops/routes.py::_site_society — Site n'a pas de colonne
    `society` propre, elle vit dans equipment_plan (JSON). Dupliqué ici volontairement
    (fonction pure de 8 lignes) plutôt que d'importer depuis un module de routes voisin."""
    plan = site.equipment_plan if isinstance(site.equipment_plan, dict) else {}
    legacy = plan.get("_legacy") if isinstance(plan.get("_legacy"), dict) else {}
    return plan.get("societe") or plan.get("society") or legacy.get("societe") or legacy.get("society") or None


@dataclass
class BeoScope:
    sites: dict[int, Site]                       # périmètre autorisé complet
    selected: list[int] = field(default_factory=list)  # périmètre consulté (⊆ sites)
    society: str | None = None                   # filtre société demandé (ou None = toutes)

    def society_of(self, site_id: int | None) -> str | None:
        site = self.sites.get(site_id) if site_id is not None else None
        return _site_society(site) if site else None

    def site_name(self, site_id: int | None) -> str | None:
        site = self.sites.get(site_id) if site_id is not None else None
        return site.name if site else None

    def label(self, site_id: int | None) -> dict:
        """Contexte société/site joint à chaque ligne d'une vue agrégée (§8, §13, §14)."""
        return {"site_id": site_id, "site_name": self.site_name(site_id), "society": self.society_of(site_id)}

    def require(self, site_id: int | None) -> Site:
        """Ressource existante : son site réel doit être dans le périmètre AUTORISÉ."""
        site = self.sites.get(site_id) if site_id is not None else None
        if site is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ressource hors du périmètre de ce compte")
        return site


def authorized_sites(db: Session, user: User) -> dict[int, Site]:
    """Sites explicitement attribués, actifs, et appartenant à une société explicitement
    autorisée (si le compte a une liste de sociétés). Une liste vide reste vide."""
    ids = _authorized_site_ids(user)
    if not ids:
        return {}
    societies = set(_authorized_societies(user))
    rows = db.execute(select(Site).where(Site.id.in_(ids)).order_by(Site.name)).scalars().all()
    return {
        site.id: site for site in rows
        if site.active and (not societies or _site_society(site) in societies)
    }


def build_scope(db: Session, user: User, *, society: str | None = None, site_id: int | None = None) -> BeoScope:
    sites = authorized_sites(db, user)
    if not sites:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Ce compte doit être rattaché à au moins un site actif de ses sociétés autorisées",
        )
    society = (society or "").strip() or None
    selected = list(sites)
    if society is not None:
        selected = [sid for sid in selected if _site_society(sites[sid]) == society]
        if not selected:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Société hors du périmètre de ce compte")
    if site_id is not None:
        if site_id not in selected:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Site hors du périmètre de ce compte")
        selected = [site_id]
    return BeoScope(sites=sites, selected=selected, society=society)


def resolve_scope(society: str | None = Query(None, max_length=180), site_id: int | None = Query(None),
                  db: Session = Depends(get_db), user: User = Depends(current_user)) -> BeoScope:
    """Dépendance de toutes les routes du module."""
    return build_scope(db, user, society=society, site_id=site_id)


BEO_ROLE = "charge_effectifs_site"


def is_beo_account(role: str | None, modules: list | None) -> bool:
    """Compte "Chargé des effectifs" (Bureau des Effectifs Ouest) : rôle métier ET clé
    site_workforce. Un autre profil qui a aussi site_workforce garde la sémantique
    historique (périmètres libres) ; resolve_scope() le filtre de toute façon au runtime."""
    return str(role or "").strip().lower() == BEO_ROLE and "site_workforce" in [str(m).strip() for m in (modules or [])]


def validate_beo_account_scope(db: Session, *, role, modules, societies, sites, global_society_access) -> None:
    """Garde d'écriture (création/modification d'un compte via Administration, état FINAL) :
    au moins UNE société explicite, au moins UN site, jamais d'accès global, et chaque site
    existe et appartient à l'une des sociétés autorisées. Même comparaison société que
    authorized_sites() — un état que le portail filtrerait ne peut jamais être enregistré.
    Sans effet sur tout autre compte."""
    if not is_beo_account(role, modules):
        return

    def refuse(detail: str) -> None:
        raise HTTPException(status_code=422, detail=f"Chargé des effectifs (BEO) : {detail}")

    if global_society_access:
        refuse("l'accès global aux sociétés est interdit")
    allowed = {str(v).strip() for v in (societies or []) if str(v).strip()}
    if not allowed:
        refuse("au moins une société autorisée est obligatoire (une liste vide n'est jamais un accès global)")
    raw_sites = list(sites or [])
    site_ids = [int(v) for v in raw_sites if str(v).strip().lstrip("-").isdigit()]
    if len(site_ids) != len(raw_sites):
        refuse("identifiant de site invalide")
    if not site_ids:
        refuse("au moins un site autorisé est obligatoire")
    rows = {site.id: site for site in db.execute(select(Site).where(Site.id.in_(site_ids))).scalars()}
    missing = [sid for sid in site_ids if sid not in rows]
    if missing:
        refuse(f"site introuvable ({', '.join(str(v) for v in missing)})")
    outside = [rows[sid].name for sid in site_ids if _site_society(rows[sid]) not in allowed]
    if outside:
        refuse("site(s) hors des sociétés autorisées : " + ", ".join(outside))


def _active_assignment_filter(as_of: date):
    return (
        Assignment.active == 1,
        Assignment.start_date <= as_of,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= as_of),
    )


def employee_site_map(db: Session, site_ids: list[int], *, as_of: date | None = None) -> dict[int, int]:
    """Employés RÉELLEMENT affectés (Assignment active) aux sites donnés → leur site, en UNE
    requête quel que soit le nombre de sites. Jamais tous les employés d'une société."""
    if not site_ids:
        return {}
    today = as_of or date.today()
    stmt = select(Assignment.employee_id, Assignment.site_id).where(
        Assignment.site_id.in_(site_ids), *_active_assignment_filter(today),
    ).order_by(Assignment.id)
    return {emp_id: site_id for emp_id, site_id in db.execute(stmt)}


def assigned_employees_subquery(site_ids: list[int], *, as_of: date | None = None):
    """Sous-requête SQL (jamais matérialisée en Python) des employés affectés aux sites."""
    today = as_of or date.today()
    return select(Assignment.employee_id).where(Assignment.site_id.in_(site_ids or [-1]), *_active_assignment_filter(today))


def ensure_employee_in_scope(db: Session, scope: BeoScope, employee_id: int, *, site_id: int | None = None,
                             as_of: date | None = None) -> tuple[Employee, Site]:
    """Employé réellement affecté à un site AUTORISÉ ; le site retenu est son site réel. Un
    site_id fourni par le client doit correspondre à cette affectation (jamais forgé). 403
    (jamais 404) : ne pas laisser deviner qu'un employé existe ailleurs."""
    today = as_of or date.today()
    candidates = sorted(set(db.scalars(select(Assignment.site_id).where(
        Assignment.employee_id == employee_id, Assignment.site_id.in_(list(scope.sites)), *_active_assignment_filter(today),
    ))))
    if site_id is not None:
        candidates = [sid for sid in candidates if sid == site_id]
    if not candidates:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Employé hors du périmètre de ce compte")
    if len(candidates) > 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Employé affecté à plusieurs sites : préciser le site")
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Employé hors du périmètre de ce compte")
    return employee, scope.sites[candidates[0]]
