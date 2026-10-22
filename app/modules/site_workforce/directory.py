"""EFFECTIF (annuaire BEO) — statut métier, filtres, tri et compteurs calculés en SQL.

Un nombre FIXE de requêtes quel que soit le volume (liste paginée + 3 compteurs + photos de la
page) : jamais une requête par employé, jamais un full-fetch côté navigateur.

Statut métier, par priorité (le premier qui s'applique l'emporte) :
  BLACKLIST > SUSPENDU > CONGÉ > MALADE > ABSENT > NON POINTÉ > ACTIF
- BLACKLIST : source canonique EmployeeBlacklistEntry « active » (enregistrement DRH audité),
  et, pour l'historique, les valeurs miroir de Employee.status (« blackliste », etc.) ;
- SUSPENDU : Employee.status ;
- CONGÉ / MALADE : congé DRH approuvé couvrant aujourd'hui (Leave, même règle que le tableau
  de bord) ;
- ABSENT / NON POINTÉ : journée RÉELLE du jour sur le site d'affectation (une journée seulement
  planifiée n'est pas un pointage — presence_state.real_clause, comme le tableau de bord).

Champs autorisés (UserFieldPermission, même catalogue que la fiche de position) : BLACKLIST et
SUSPENDU relèvent du champ « Statut » (identity.status). Sans ce champ, ils ne sont ni affichés,
ni filtrables, ni comptés : un filtre ou un tri sur une donnée masquée servirait d'oracle. Le
tri par dates suit la même règle (contract.recruit_date, contract.end_date), la photo aussi
(identity.photo).
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.orm import Session

from app.core.pagination import normalize_page
from app.modules.attendance import presence_state
from app.modules.drh.models import Contract, Employee, EmployeeBlacklistEntry, Leave
from app.modules.ops.models import Assignment, DailyPresence
from app.modules.site_workforce.security import BeoScope, _active_assignment_filter

STATUS_ORDER = ("blacklist", "suspendu", "conge", "maladie", "absent", "non_pointe", "actif")
STATUS_LABELS = {
    "blacklist": "Blacklist", "suspendu": "Suspendu", "conge": "Congé", "maladie": "Malade",
    "absent": "Absent", "non_pointe": "Non pointé", "actif": "Actif",
}
LIFECYCLE_STATUSES = frozenset({"blacklist", "suspendu"})
BLACKLIST_VALUES = ("blacklist", "blackliste", "blacklisté", "blacklisted")
PRESENCE_FILTERS = ("present", "absent", "non_pointe")
NO_GROUP = "_none"

# Tri : clé publique -> champ de fiche requis (None = toujours visible dans l'annuaire).
SORTS = {
    "name": None, "name_desc": None, "code": None, "structure": None, "site": None, "group": None,
    "position": None, "status": None, "recruit_date": "contract.recruit_date", "contract_end": "contract.end_date",
}


def _blacklisted():
    entry = exists().where(EmployeeBlacklistEntry.employee_id == Employee.id, EmployeeBlacklistEntry.status == "active")
    return or_(func.lower(func.coalesce(Employee.status, "")).in_(BLACKLIST_VALUES), entry)


def _on_leave(kind: str, today: date):
    return exists().where(Leave.employee_id == Employee.id, Leave.status == "approuve", Leave.leave_type == kind,
                          Leave.start_date <= today, Leave.end_date >= today)


def _real_day(today: date, *conditions):
    return exists().where(DailyPresence.employee_id == Employee.id, DailyPresence.site_id == Assignment.site_id,
                          DailyPresence.presence_date == today, presence_state.real_clause(), *conditions)


def status_expression(today: date, lifecycle: bool):
    whens = []
    if lifecycle:
        whens += [(_blacklisted(), "blacklist"),
                  (func.lower(func.coalesce(Employee.status, "")).like("suspen%"), "suspendu")]
    whens += [(_on_leave("conge", today), "conge"), (_on_leave("maladie", today), "maladie"),
              (_real_day(today, DailyPresence.status == "absent"), "absent"), (~_real_day(today), "non_pointe")]
    return case(*whens, else_="actif")


def _presence_clause(presence: str, today: date):
    if presence == "present":
        return _real_day(today, DailyPresence.status == "present")
    if presence == "absent":
        return _real_day(today, DailyPresence.status == "absent")
    return ~_real_day(today)


def _group_key(value) -> str:
    text = str(value or "").strip().upper()
    return text or NO_GROUP


def _site_rank(scope: BeoScope, *, by_society: bool):
    ids = sorted(scope.selected, key=lambda sid: ((scope.society_of(sid) or "") if by_society else "", scope.site_name(sid) or "", sid))
    return case({sid: rank for rank, sid in enumerate(ids)}, value=Assignment.site_id, else_=len(ids))


def _contract_end():
    latest = select(func.max(Contract.end_date)).where(Contract.employee_id == Employee.id).scalar_subquery()
    own = Employee.contract_end_date
    return case((and_(own.isnot(None), or_(latest.is_(None), own >= latest)), own), else_=latest)


def _order(sort: str, scope: BeoScope, status_expr):
    name = [Employee.last_name, Employee.first_name]
    nulls_last = lambda expr: [expr.is_(None), expr]  # noqa: E731 — portable SQLite/PostgreSQL
    by = {
        "name": name,
        "name_desc": [Employee.last_name.desc(), Employee.first_name.desc()],
        "code": [Employee.code],
        "structure": [_site_rank(scope, by_society=True)],
        "site": [_site_rank(scope, by_society=False)],
        "group": nulls_last(func.nullif(func.trim(Assignment.group_code), "")),
        "position": nulls_last(func.nullif(func.trim(Employee.position), "")),
        "status": [case({key: i for i, key in enumerate(STATUS_ORDER)}, value=status_expr, else_=len(STATUS_ORDER))],
        "recruit_date": nulls_last(Employee.recruit_date),
        "contract_end": nulls_last(_contract_end()),
    }[sort]
    return [*by, *name, Employee.id, Assignment.site_id]


def list_directory(db: Session, scope: BeoScope, allowed: frozenset[str], *, q: str | None = None, site: int | None = None,
                   group: str | None = None, employee_status: str | None = None, presence: str | None = None,
                   sort: str | None = None, page: int = 1, page_size: int = 25, today: date | None = None) -> dict:
    today = today or date.today()
    lifecycle = "identity.status" in allowed
    status_expr = status_expression(today, lifecycle)

    base = (select(Employee, Assignment.site_id, Assignment.group_code)
            .join(Assignment, Assignment.employee_id == Employee.id)
            .where(Assignment.site_id.in_(scope.selected), *_active_assignment_filter(today)))
    needle = str(q or "").strip()
    if needle:
        pattern = f"%{needle}%"
        base = base.where(or_(Employee.code.ilike(pattern), Employee.first_name.ilike(pattern),
                              Employee.last_name.ilike(pattern), Employee.position.ilike(pattern)))

    # Compteurs (raccourcis Groupe / Site / Statut) : périmètre consulté + recherche, avant les
    # filtres locaux — un raccourci garde toujours son total, quel que soit le filtre actif.
    facet_from = base.subquery()
    groups: dict[str, int] = {}
    for code, n in db.execute(select(facet_from.c.group_code, func.count()).group_by(facet_from.c.group_code)):
        groups[_group_key(code)] = groups.get(_group_key(code), 0) + n
    site_counts = dict(db.execute(select(facet_from.c.site_id, func.count()).group_by(facet_from.c.site_id)).all())
    status_counts = _status_counts(db, base, status_expr)

    stmt = base
    if site is not None:
        if site not in scope.selected:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Site hors du périmètre consulté")
        stmt = stmt.where(Assignment.site_id == site)
    wanted_group = str(group or "").strip()
    if wanted_group:
        if wanted_group == NO_GROUP:
            stmt = stmt.where(func.coalesce(func.trim(Assignment.group_code), "") == "")
        else:
            stmt = stmt.where(func.upper(func.trim(Assignment.group_code)) == wanted_group.upper())
    wanted_status = str(employee_status or "").strip()
    if wanted_status:
        if wanted_status not in STATUS_LABELS or (wanted_status in LIFECYCLE_STATUSES and not lifecycle):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Filtre de statut non autorisé pour ce compte")
        stmt = stmt.where(status_expr == wanted_status)
    wanted_presence = str(presence or "").strip()
    if wanted_presence:
        if wanted_presence not in PRESENCE_FILTERS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Filtre de présence inconnu")
        stmt = stmt.where(_presence_clause(wanted_presence, today))
    sort_key = str(sort or "name").strip() or "name"
    required = SORTS.get(sort_key, "?")
    if required == "?" or (required and required not in allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Tri non autorisé pour ce compte")

    safe_page, safe_size = normalize_page(page, page_size)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    pages = max((total + safe_size - 1) // safe_size, 1)
    safe_page = min(safe_page, pages)
    rows = db.execute(stmt.add_columns(status_expr).order_by(*_order(sort_key, scope, status_expr))
                      .offset((safe_page - 1) * safe_size).limit(safe_size)).all()

    ids = [emp.id for emp, *_ in rows]
    presences = {
        (p.employee_id, p.site_id): p.status for p in db.execute(select(DailyPresence).where(
            DailyPresence.employee_id.in_(ids or [-1]), DailyPresence.presence_date == today,
        )).scalars()
    }
    photos = {}
    if "identity.photo" in allowed and ids:
        from app.modules.ops.employee_photos import canonical_photos
        photos = canonical_photos(db, ids)
    # Périmètre strict (§B15) : jamais salaire/RIB/paie/IRG/CNAS/données privées non
    # nécessaires — uniquement ce qu'un chargé d'effectifs terrain a besoin de voir.
    items = []
    for emp, site_id, group_code, business in rows:
        item = {
            "id": emp.id, "code": emp.code, "first_name": emp.first_name, "last_name": emp.last_name,
            "position": emp.position, "group_code": group_code, **scope.label(site_id),
            "presence_status": presences.get((emp.id, site_id), "non_pointe"),
            "status": business, "status_label": STATUS_LABELS.get(business, business),
        }
        if photos.get(emp.id):
            stamp = emp.updated_at.isoformat() if emp.updated_at else "0"
            item["photo_url"] = f"/api/site-workforce/positions/{emp.id}/photo?v={stamp}"
        items.append(item)

    visible_statuses = [s for s in STATUS_ORDER if lifecycle or s not in LIFECYCLE_STATUSES]
    return {
        "items": items, "total": total, "page": safe_page, "page_size": safe_size, "pages": pages,
        "facets": {
            "groups": [{"key": key, "count": groups[key]} for key in sorted(groups, key=lambda k: (k == NO_GROUP, k))],
            "sites": sorted(({**scope.label(sid), "count": n} for sid, n in site_counts.items()),
                            key=lambda s: (-s["count"], s["site_name"] or "")),
            "statuses": [{"key": key, "label": STATUS_LABELS[key], "count": status_counts.get(key, 0)} for key in visible_statuses],
        },
        "capabilities": {
            "lifecycle_status": lifecycle,
            "sorts": [key for key, field in SORTS.items() if not field or field in allowed],
        },
    }


def _status_counts(db: Session, base, status_expr) -> dict[str, int]:
    labelled = status_expr.label("business_status")
    counted = base.with_only_columns(labelled).subquery()
    return dict(db.execute(select(counted.c.business_status, func.count()).group_by(counted.c.business_status)).all())
