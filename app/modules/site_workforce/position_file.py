"""Fiche de position BEO — projection LECTURE SEULE des données canoniques ATLAS.

Aucune copie : chaque valeur est lue à la demande dans ses tables d'origine (Employee et son
blob `extra` côté DRH, Assignment/Site/RotationTemplate côté OPS, Contract et Sanction côté
DRH). Le compte BEO n'a besoin que du module `site_workforce` : ce module lit ces tables côté
serveur, jamais par un endpoint /api/drh.

Deux gardes cumulatives, toutes deux serveur :
1. périmètre — l'employé doit être affecté (Assignment active) à un site autorisé du compte
   (security.py ; 403 sinon, jamais 404) ;
2. champs — seuls les champs cochés par l'administrateur (UserFieldPermission) sont CALCULÉS
   et renvoyés. Un champ refusé est absent de la réponse (jamais `null`), une section sans
   champ autorisé est absente, et une sélection vide n'ouvre aucun champ (deny by default).

CATALOGUE est la source unique des clés, libellés, ordre, sensibilité et valeur par défaut :
Administration système et le portail BEO l'affichent tous deux depuis l'API.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from functools import cached_property
from typing import Any, Callable

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.granular_permissions import load_field_permissions
from app.modules.drh.models import Contract, Employee, Sanction
from app.modules.ops.models import Assignment, RotationTemplate, Site
from app.modules.site_workforce.security import BeoScope, _active_assignment_filter, _site_society

MODULE_KEY = "site_workforce"
RESOURCE_KEY = "position_file"


@dataclass(frozen=True)
class FieldDef:
    key: str          # « section.champ » — la donnée métier, jamais un identifiant HTML
    label: str
    kind: str = "text"  # text | date | badge | photo | table
    sensitive: bool = False
    default: bool = False  # coché dans le profil « BEO Standard »
    columns: tuple[tuple[str, str], ...] = ()  # kind == "table" : (clé, libellé)


@dataclass(frozen=True)
class SectionDef:
    key: str
    label: str
    fields: tuple[FieldDef, ...]


CATALOG: tuple[SectionDef, ...] = (
    SectionDef("identity", "Identité", (
        FieldDef("identity.last_name", "Nom", default=True),
        FieldDef("identity.first_name", "Prénom", default=True),
        FieldDef("identity.employee_code", "Code employé", default=True),
        FieldDef("identity.photo", "Photo professionnelle", kind="photo", default=True),
        FieldDef("identity.status", "Statut", kind="badge", default=True),
        FieldDef("identity.birth_date", "Date de naissance", kind="date"),
        FieldDef("identity.phone", "Téléphone personnel", sensitive=True),
        FieldDef("identity.nin", "NIN", sensitive=True),
        FieldDef("identity.id_document", "N° pièce d'identité", sensitive=True),
        FieldDef("identity.address", "Adresse personnelle", sensitive=True),
        FieldDef("identity.blood_group", "Groupe sanguin (donnée médicale)", sensitive=True),
    )),
    SectionDef("assignment", "Position actuelle", (
        FieldDef("assignment.society", "Société", default=True),
        FieldDef("assignment.site", "Site", default=True),
        FieldDef("assignment.client", "Client du site"),
        FieldDef("assignment.position", "Poste (affectation)", default=True),
        FieldDef("assignment.function", "Fonction contractuelle", default=True),
        FieldDef("assignment.start_date", "Date d'affectation", kind="date", default=True),
        FieldDef("assignment.group", "Groupe", default=True),
        FieldDef("assignment.vacation", "Vacation du jour", default=True),
        FieldDef("assignment.rotation", "Rotation", default=True),
        FieldDef("assignment.work_regime", "Régime de travail", default=True),
    )),
    SectionDef("contract", "Contrat", (
        FieldDef("contract.type", "Type de contrat", default=True),
        FieldDef("contract.start_date", "Date de début", kind="date", default=True),
        FieldDef("contract.end_date", "Date de fin", kind="date", default=True),
        FieldDef("contract.status", "État du contrat", kind="badge", default=True),
        FieldDef("contract.trial_end_date", "Fin de période d'essai", kind="date"),
        FieldDef("contract.recruit_date", "Date de recrutement", kind="date"),
        FieldDef("contract.seniority", "Ancienneté"),
        FieldDef("contract.salary", "Salaire net", sensitive=True),
        FieldDef("contract.bank", "Coordonnées bancaires (RIB)", sensitive=True),
    )),
    SectionDef("history", "Historique", (
        FieldDef("history.assignments", "Historique des affectations (sites et postes)", kind="table", default=True,
                 columns=(("site", "Site"), ("position", "Poste"), ("group", "Groupe"), ("start_date", "Du"), ("end_date", "Au"))),
        FieldDef("history.contracts", "Historique des contrats", kind="table",
                 columns=(("type", "Type"), ("position", "Poste"), ("start_date", "Début"), ("end_date", "Fin"), ("status", "Statut"))),
        FieldDef("history.sanctions", "Sanctions disciplinaires", kind="table", sensitive=True,
                 columns=(("date", "Date"), ("type", "Sanction"), ("suspension_days", "Mise à pied (j)"), ("site", "Site"))),
    )),
)

FIELDS: dict[str, FieldDef] = {f.key: f for s in CATALOG for f in s.fields}
STANDARD_PROFILE: frozenset[str] = frozenset(f.key for f in FIELDS.values() if f.default)
assert not any(FIELDS[k].sensitive for k in STANDARD_PROFILE), "BEO Standard ne coche jamais un champ sensible"

# Colonnes de la LISTE « Fiches de position » (même filtrage que la fiche).
LIST_FIELDS = ("identity.last_name", "identity.first_name", "identity.employee_code", "assignment.position",
               "assignment.function", "assignment.society", "assignment.site", "assignment.start_date", "identity.status")

REGIME_LABELS = {"NORMAL": "Horaire normal", "POSTE_CONTINU": "Travail posté (poste continu)"}


def catalog_payload() -> dict:
    return {
        "module_key": MODULE_KEY,
        "resource_key": RESOURCE_KEY,
        "sections": [{
            "key": s.key, "label": s.label, "order": si,
            "fields": [{"key": f.key, "label": f.label, "order": fi, "sensitive": f.sensitive, "default": f.default}
                       for fi, f in enumerate(s.fields)],
        } for si, s in enumerate(CATALOG)],
        "standard_profile": sorted(STANDARD_PROFILE),
        "total": len(FIELDS),
    }


def unknown_fields(keys) -> list[str]:
    return sorted({str(k) for k in keys} - set(FIELDS))


def allowed_fields(db: Session, user_id: int) -> frozenset[str]:
    """Champs autorisés ET encore connus du catalogue (une clé retirée du catalogue n'ouvre rien)."""
    return load_field_permissions(db, user_id, module_key=MODULE_KEY, resource_key=RESOURCE_KEY) & set(FIELDS)


def _iso(value):
    return value.isoformat() if isinstance(value, (date, datetime)) else value


def _extra(employee: Employee) -> dict:
    """Même fusion que le reste d'ATLAS (badge_routes._employee_data, employeeFromApi)."""
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    return {**legacy, **extra}


def _clean(value) -> str | None:
    text = str(value or "").strip()
    return text or None


def _seniority(start: date | None, today: date) -> str | None:
    if not start or start > today:
        return None
    months = (today.year - start.year) * 12 + today.month - start.month - (1 if today.day < start.day else 0)
    years, months = divmod(max(months, 0), 12)
    parts = ([f"{years} an{'s' if years > 1 else ''}"] if years else []) + ([f"{months} mois"] if months else [])
    return " ".join(parts) or "Moins d'un mois"


class _Source:
    """Valeurs d'UN employé, calculées paresseusement : un champ non autorisé n'est jamais lu
    (aucune requête pour les contrats, sanctions ou le blob extra si rien ne les demande)."""

    def __init__(self, db: Session, employee: Employee, site: Site, assignment: Assignment, today: date):
        self.db, self.employee, self.site, self.assignment, self.today = db, employee, site, assignment, today

    @cached_property
    def extra(self) -> dict:
        return _extra(self.employee)

    @cached_property
    def contracts(self) -> list[Contract]:
        return list(self.db.execute(select(Contract).where(Contract.employee_id == self.employee.id)
                                    .order_by(Contract.start_date.desc().nullslast(), Contract.id.desc()).limit(50)).scalars())

    @property
    def latest_contract(self) -> Contract | None:
        return self.contracts[0] if self.contracts else None

    @cached_property
    def contract_end(self) -> date | None:
        # Même règle que la fiche DRH (employeePositionContractEndDate) : la plus tardive entre la
        # fin portée par l'employé et celle du dernier contrat.
        ends = [d for d in (self.employee.contract_end_date, getattr(self.latest_contract, "end_date", None)) if d]
        return max(ends) if ends else None

    def vacation(self) -> str | None:
        from app.modules.attendance.official import STATUS_OFFICIAL, official_shift
        result = official_shift(self.db, employee_id=self.employee.id, site_id=self.site.id, at=datetime.now())
        if result.get("status") != STATUS_OFFICIAL or not result.get("shift_label"):
            return None
        start, end = result.get("scheduled_start"), result.get("scheduled_end")
        hours = f" ({start.strftime('%H:%M')}–{end.strftime('%H:%M')})" if start and end else ""
        return f"{result['shift_label']}{hours}"

    def rotation(self) -> str | None:
        if self.assignment.rotation_id:
            template = self.db.get(RotationTemplate, self.assignment.rotation_id)
            if template:
                return template.name
        return _clean(self.site.rotation_system)

    def contract_status(self) -> dict | None:
        end = self.contract_end
        if end is None:
            if not (self.employee.contract_type or self.latest_contract):
                return None
            return {"label": "En cours (sans date de fin)", "tone": "success"}
        days = (end - self.today).days
        if days < 0:
            return {"label": "Échu", "tone": "danger"}
        if days <= 30:
            return {"label": f"Échéance dans {days} j", "tone": "warn"}
        return {"label": "En cours", "tone": "success"}

    def assignment_history(self) -> list[dict]:
        rows = self.db.execute(select(Assignment, Site.name).join(Site, Assignment.site_id == Site.id)
                               .where(Assignment.employee_id == self.employee.id)
                               .order_by(Assignment.start_date.desc(), Assignment.id.desc()).limit(100)).all()
        return [{"site": name, "position": a.position, "group": a.group_code,
                 "start_date": _iso(a.start_date), "end_date": _iso(a.end_date)} for a, name in rows]

    def contract_history(self) -> list[dict]:
        # Jamais le salaire : un champ dédié (contract.salary) le gouverne.
        return [{"type": c.contract_type or None, "position": c.position, "start_date": _iso(c.start_date),
                 "end_date": _iso(c.end_date), "status": c.status} for c in self.contracts]

    def sanctions(self) -> list[dict]:
        # Type et durée seulement : le texte de la faute n'est jamais exposé au BEO.
        rows = self.db.execute(select(Sanction).where(Sanction.employee_id == self.employee.id)
                               .order_by(Sanction.infraction_date.desc(), Sanction.id.desc()).limit(100)).scalars()
        return [{"date": _iso(s.infraction_date), "type": s.sanction_type, "suspension_days": s.suspension_days,
                 "site": s.site_name} for s in rows]


def _photo(src: _Source):
    from app.modules.ops.employee_photos import canonical_photos
    if not canonical_photos(src.db, [src.employee.id]).get(src.employee.id):
        return None
    stamp = src.employee.updated_at.isoformat() if src.employee.updated_at else "0"
    return {"url": f"/api/site-workforce/positions/{src.employee.id}/photo?v={stamp}"}


def _blood_group(src: _Source):
    from app.modules.drh.badge_routes import blood_group_of
    return blood_group_of(src.employee) or None


def _address(src: _Source):
    e = src.employee
    return ", ".join(p for p in (_clean(e.address), _clean(e.commune), _clean(e.wilaya)) if p) or None


def _bank(src: _Source):
    x = src.extra
    parts = [("Banque", x.get("banque")), ("Compte", x.get("numeroCompte")), ("IBAN", x.get("iban"))]
    return " · ".join(f"{k} : {_clean(v)}" for k, v in parts if _clean(v)) or None


GETTERS: dict[str, Callable[[_Source], Any]] = {
    "identity.last_name": lambda s: s.employee.last_name,
    "identity.first_name": lambda s: s.employee.first_name,
    "identity.employee_code": lambda s: s.employee.code,
    "identity.photo": _photo,
    "identity.status": lambda s: s.employee.status,
    "identity.birth_date": lambda s: _iso(s.employee.birth_date),
    "identity.phone": lambda s: _clean(s.employee.phone),
    "identity.nin": lambda s: _clean(s.employee.nin),
    "identity.id_document": lambda s: _clean(s.extra.get("numeroPieceIdentite") or s.extra.get("numeroPasseport")),
    "identity.address": _address,
    "identity.blood_group": _blood_group,
    "assignment.society": lambda s: _clean(s.employee.society) or _site_society(s.site),
    "assignment.site": lambda s: s.site.name,
    "assignment.client": lambda s: _clean(s.site.client_name),
    "assignment.position": lambda s: _clean(s.assignment.position),
    "assignment.function": lambda s: _clean(s.employee.position),
    "assignment.start_date": lambda s: _iso(s.assignment.start_date),
    "assignment.group": lambda s: _clean(s.assignment.group_code),
    "assignment.vacation": lambda s: s.vacation(),
    "assignment.rotation": lambda s: s.rotation(),
    "assignment.work_regime": lambda s: REGIME_LABELS.get(s.assignment.work_regime or ""),
    "contract.type": lambda s: _clean(s.employee.contract_type) or _clean(getattr(s.latest_contract, "contract_type", None)),
    "contract.start_date": lambda s: _iso(getattr(s.latest_contract, "start_date", None) or s.employee.recruit_date),
    "contract.end_date": lambda s: _iso(s.contract_end),
    "contract.status": lambda s: s.contract_status(),
    "contract.trial_end_date": lambda s: _iso(s.employee.trial_end_date or getattr(s.latest_contract, "trial_end_date", None)),
    "contract.recruit_date": lambda s: _iso(s.employee.recruit_date),
    "contract.seniority": lambda s: _seniority(s.employee.recruit_date, s.today),
    "contract.salary": lambda s: s.employee.salary_net,
    "contract.bank": _bank,
    "history.assignments": lambda s: s.assignment_history(),
    "history.contracts": lambda s: s.contract_history(),
    "history.sanctions": lambda s: s.sanctions(),
}
assert set(GETTERS) == set(FIELDS), "chaque champ du catalogue a exactement une source"


def _field_out(field: FieldDef, value) -> dict:
    out = {"key": field.key, "label": field.label, "kind": field.kind, "value": value}
    if field.columns:
        out["columns"] = [{"key": k, "label": label} for k, label in field.columns]
    return out


def current_placement(db: Session, scope: BeoScope, employee_id: int, today: date) -> tuple[Assignment, Site] | None:
    """Affectation ACTIVE de l'employé sur un site AUTORISÉ — de préférence dans la sélection
    consultée, sinon dans tout le périmètre ; la plus récente si plusieurs."""
    rows = db.execute(select(Assignment).where(
        Assignment.employee_id == employee_id, Assignment.site_id.in_(list(scope.sites)), *_active_assignment_filter(today),
    ).order_by(Assignment.start_date.desc(), Assignment.id.desc())).scalars().all()
    preferred = [a for a in rows if a.site_id in scope.selected] or rows
    return (preferred[0], scope.sites[preferred[0].site_id]) if preferred else None


def build_position_file(db: Session, employee: Employee, assignment: Assignment, site: Site,
                        allowed: frozenset[str], *, today: date | None = None) -> dict:
    src = _Source(db, employee, site, assignment, today or date.today())
    sections = []
    for section in CATALOG:
        fields = [_field_out(f, GETTERS[f.key](src)) for f in section.fields if f.key in allowed]
        if fields:  # section sans champ autorisé : absente, jamais une section vide
            sections.append({"key": section.key, "label": section.label, "fields": fields})
    # Champs TECHNIQUES (§19) : identifient la ligne, n'exposent aucune donnée métier.
    return {"employee_id": employee.id, "site_id": site.id, "sections": sections,
            "allowed_count": len(allowed), "read_only": True}


def list_positions(db: Session, scope: BeoScope, allowed: frozenset[str], *, q: str | None, position: str | None,
                   status: str | None, page: int, page_size: int, today: date | None = None) -> dict:
    """Liste paginée en SQL (3 requêtes quel que soit le volume). Un filtre ou une recherche ne
    porte QUE sur des champs autorisés : sinon il servirait d'oracle sur une donnée masquée."""
    from app.core.pagination import normalize_page

    today = today or date.today()
    stmt = (select(Employee, Assignment).join(Assignment, Assignment.employee_id == Employee.id)
            .where(Assignment.site_id.in_(scope.selected), *_active_assignment_filter(today)))
    needle = str(q or "").strip()
    searchable = [col for key, col in (("identity.employee_code", Employee.code), ("identity.first_name", Employee.first_name),
                                       ("identity.last_name", Employee.last_name)) if key in allowed]
    if needle and searchable:
        stmt = stmt.where(or_(*(col.ilike(f"%{needle}%") for col in searchable)))
    wanted_position = str(position or "").strip()
    position_cols = [col for key, col in (("assignment.position", Assignment.position), ("assignment.function", Employee.position))
                     if key in allowed]
    if wanted_position and position_cols:
        stmt = stmt.where(or_(*(col.ilike(f"%{wanted_position}%") for col in position_cols)))
    wanted_status = str(status or "").strip()
    if wanted_status and "identity.status" in allowed:
        stmt = stmt.where(Employee.status == wanted_status)

    safe_page, safe_size = normalize_page(page, page_size)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    pages = max((total + safe_size - 1) // safe_size, 1)
    safe_page = min(safe_page, pages)
    rows = db.execute(stmt.order_by(Employee.last_name, Employee.first_name, Employee.id, Assignment.site_id)
                      .offset((safe_page - 1) * safe_size).limit(safe_size)).all()

    keys = [k for k in LIST_FIELDS if k in allowed]
    items = []
    for employee, assignment in rows:
        src = _Source(db, employee, scope.sites[assignment.site_id], assignment, today)
        items.append({"employee_id": employee.id, "site_id": assignment.site_id,
                      "fields": {k: GETTERS[k](src) for k in keys}})
    statuses = []
    if "identity.status" in allowed:
        statuses = sorted(v for v in db.scalars(select(Employee.status).join(Assignment, Assignment.employee_id == Employee.id).where(
            Assignment.site_id.in_(scope.selected), *_active_assignment_filter(today)).distinct()) if v)
    return {"columns": [{"key": k, "label": FIELDS[k].label, "kind": FIELDS[k].kind} for k in keys],
            "items": items, "total": total, "page": safe_page, "page_size": safe_size, "pages": pages,
            "filters": {"search": bool(searchable), "position": bool(position_cols), "statuses": statuses}}
