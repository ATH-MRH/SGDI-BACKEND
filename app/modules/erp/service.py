from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import unicodedata
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.drh.models import Candidate, Contract, Employee, Leave
from app.modules.materiel.models import EmployeeEquipment, StockArticle, StockMovement, Store, Supplier
from app.modules.ops.models import Assignment, DailyPresence, Event, Site

EXIT_STATUSES = {"sortant", "demissionne", "licencie", "archive", "blackliste", "blacklist", "blacklisted"}
BLOCKING_STATUSES = {"suspendu", "suspended", "maladie", "conge", "absent", "absence", "blackliste", "blacklist", "blacklisted"}
CANDIDATE_RECRUITED_STATUSES = {
    "embauche", "embauchee",
    "recrute", "recrutee",
    "employe", "employee",
}
CANDIDATE_ARCHIVED_STATUSES = {"archive", "archived", "archivee"}
OPEN_EVENT_EXCLUDED_STATUSES = {
    "clos", "cloture", "clôture", "cloture", "clôturé", "cloturee", "clôturée",
    "closed", "termine", "terminé", "terminee", "terminée", "archive", "archivé",
}


def _status_key(value: Any) -> str:
    text = str(value or "").strip().casefold()
    return "".join(
        char for char in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(char)
    )


def _sum_statuses(counts: dict[str, int], *aliases: str) -> int:
    keys = {_status_key(alias) for alias in aliases}
    return sum(int(value or 0) for key, value in counts.items() if key in keys)


@dataclass(frozen=True)
class EmployeeOperationalState:
    employee_id: int
    status: str
    has_contract: bool
    has_assignment: bool
    has_equipment: bool
    has_installation_pv: bool
    missing_steps: tuple[str, ...]


def authorized_societies(user: User | None) -> list[str]:
    if not user:
        return []
    values = user.authorized_societies or []
    if not isinstance(values, list):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def unrestricted_scope(user: User | None) -> bool:
    if not user:
        return False
    return user.role == "admin" or user.access_level == "H5"


def effective_societies(user: User | None, society: str | None = None) -> list[str]:
    requested = (society or "").strip()
    allowed = authorized_societies(user)
    if requested and (unrestricted_scope(user) or not allowed or requested in allowed):
        return [requested]
    return allowed


def employee_scope_condition(user: User | None, society: str | None = None):
    societies = effective_societies(user, society)
    if not societies:
        return None
    return Employee.society.in_(societies)


def site_scope_condition(user: User | None, society: str | None = None):
    societies = effective_societies(user, society)
    if not societies:
        return None
    return or_(Site.equipment_plan["societe"].as_string().in_(societies), Site.equipment_plan["society"].as_string().in_(societies))


def store_scope_condition(user: User | None, society: str | None = None):
    societies = effective_societies(user, society)
    if not societies:
        return None
    return or_(Store.society.in_(societies), Store.society.is_(None), Store.society == "")


def _employee_base_stmt(user: User | None, society: str | None = None):
    stmt = select(Employee)
    condition = employee_scope_condition(user, society)
    if condition is not None:
        stmt = stmt.where(condition)
    return stmt


def _count(db: Session, stmt) -> int:
    return int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0)


def _active_candidate_count(rows: list[Candidate]) -> int:
    total = 0
    for row in rows:
        data = row.data if isinstance(row.data, dict) else {}
        statuses = {
            _status_key(row.status),
            _status_key(data.get("statut")),
            _status_key(data.get("status")),
        }
        archived = bool(
            statuses & CANDIDATE_ARCHIVED_STATUSES
            or data.get("archivedAt")
            or data.get("motifArchive")
            or data.get("commentaireArchive")
        )
        recruited = bool(
            statuses & CANDIDATE_RECRUITED_STATUSES
            or data.get("convertedEmployeeId")
            or data.get("convertedAt")
            or data.get("employeeId")
            or data.get("agentId")
        )
        if not archived and not recruited:
            total += 1
    return total


def _today() -> date:
    return date.today()


def _active_contract_employee_ids(db: Session, employee_ids: set[int] | None = None) -> set[int]:
    today = _today()
    stmt = (
        select(Contract.employee_id)
        .where(Contract.status == "actif")
        .where(or_(Contract.end_date.is_(None), Contract.end_date >= today))
    )
    if employee_ids is not None:
        if not employee_ids:
            return set()
        stmt = stmt.where(Contract.employee_id.in_(employee_ids))
    rows = db.execute(stmt).all()
    return {int(row[0]) for row in rows if row[0] is not None}


def _active_assignment_employee_ids(db: Session, employee_ids: set[int] | None = None) -> set[int]:
    today = _today()
    stmt = (
        select(Assignment.employee_id)
        .where(Assignment.active == 1)
        .where(or_(Assignment.end_date.is_(None), Assignment.end_date >= today))
    )
    if employee_ids is not None:
        if not employee_ids:
            return set()
        stmt = stmt.where(Assignment.employee_id.in_(employee_ids))
    rows = db.execute(stmt).all()
    return {int(row[0]) for row in rows if row[0] is not None}


def _equipped_employee_ids(db: Session, employee_ids: set[int] | None = None) -> set[int]:
    stmt = (
        select(EmployeeEquipment.employee_id)
        .where(EmployeeEquipment.status == "attribue")
        .group_by(EmployeeEquipment.employee_id)
    )
    if employee_ids is not None:
        if not employee_ids:
            return set()
        stmt = stmt.where(EmployeeEquipment.employee_id.in_(employee_ids))
    rows = db.execute(stmt).all()
    return {int(row[0]) for row in rows if row[0] is not None}


NO_EQUIPMENT_KEYS = (
    "dotationMaterielSansDotation",
    "sansDotationValidee",
    "sans_dotation_validee",
    "noEquipmentRequired",
    "no_equipment_required",
)


def _is_no_equipment_validated(employee: Employee) -> bool:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    values = {**legacy, **extra}
    return any(bool(values.get(key)) for key in NO_EQUIPMENT_KEYS)


PV_INSTALLATION_KEYS = (
    # clé canonique (nouvelle)
    "pvInstallation",
    # variantes legacy frontend
    "pvInstallationValide",
    "pvInstallationAt",
    "installationPvAt",
    "dateInstallationEffective",
    "datePvInstallation",
    # variantes snake_case
    "pv_installation",
    "installationPv",
    "installation_pv",
    "date_pv_installation",
)


def _has_installation_pv(employee: Employee) -> bool:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    values = {**legacy, **extra}
    return any(bool(values.get(key)) for key in PV_INSTALLATION_KEYS)


def employee_operational_state(
    employee: Employee,
    *,
    active_contract_ids: set[int] | None = None,
    active_assignment_ids: set[int] | None = None,
    equipped_ids: set[int] | None = None,
) -> EmployeeOperationalState:
    raw_status = _status_key(employee.status)
    has_contract = employee.id in (active_contract_ids or set())
    has_assignment = employee.id in (active_assignment_ids or set())
    has_equipment = employee.id in (equipped_ids or set()) or _is_no_equipment_validated(employee)
    has_pv = _has_installation_pv(employee)

    missing: list[str] = []
    if not has_contract:
        missing.append("contrat")
    if not has_equipment:
        missing.append("dotation")
    if not has_assignment:
        missing.append("affectation")
    if not has_pv:
        missing.append("pv_installation")

    if raw_status in EXIT_STATUSES:
        status = "sortant_archive"
    elif raw_status in BLOCKING_STATUSES:
        status = raw_status
    elif not missing:
        status = "actif_operationnel"
    elif has_contract:
        status = "en_preparation_operationnelle"
    else:
        status = "recrute_non_contractualise"

    return EmployeeOperationalState(
        employee_id=employee.id,
        status=status,
        has_contract=has_contract,
        has_assignment=has_assignment,
        has_equipment=has_equipment,
        has_installation_pv=has_pv,
        missing_steps=tuple(missing),
    )


def employee_operational_states(db: Session, user: User | None = None, society: str | None = None) -> list[EmployeeOperationalState]:
    employees = db.execute(_employee_base_stmt(user, society)).scalars().all()
    employee_ids = {employee.id for employee in employees}
    contract_ids = _active_contract_employee_ids(db, employee_ids)
    assignment_ids = _active_assignment_employee_ids(db, employee_ids)
    equipped_ids = _equipped_employee_ids(db, employee_ids)
    return [
        employee_operational_state(
            employee,
            active_contract_ids=contract_ids,
            active_assignment_ids=assignment_ids,
            equipped_ids=equipped_ids,
        )
        for employee in employees
    ]


def build_erp_counters(db: Session, user: User | None = None, society: str | None = None) -> dict[str, Any]:
    employee_stmt = _employee_base_stmt(user, society)
    employees = db.execute(employee_stmt).scalars().all()
    employee_ids = {employee.id for employee in employees}
    today = _today()
    active_employee_ids = {
        employee.id
        for employee in employees
        if _status_key(employee.status) not in EXIT_STATUSES
    }
    status_counts: dict[str, int] = {}
    for employee in employees:
        key = _status_key(employee.status)
        if key:
            status_counts[key] = status_counts.get(key, 0) + 1
    active_employee_count = sum(
        1
        for employee in employees
        if _status_key(employee.status) not in EXIT_STATUSES
    )

    leaves_stmt = (
        select(Leave)
        .where(Leave.status == "approuve")
        .where(Leave.start_date <= today)
        .where(Leave.end_date >= today)
    )
    if active_employee_ids:
        leaves_stmt = leaves_stmt.where(Leave.employee_id.in_(active_employee_ids))
    elif societies := effective_societies(user, society):
        leaves_stmt = leaves_stmt.where(False)
    current_leaves = db.execute(leaves_stmt).scalars().all()
    leave_count = 0
    sick_leave_count = 0
    for leave in current_leaves:
        kind = str(leave.leave_type or "").strip().lower()
        if "malad" in kind:
            sick_leave_count += 1
        else:
            leave_count += 1

    states = employee_operational_states(db, user, society)
    by_state: dict[str, int] = {}
    missing_steps = {"contrat": 0, "dotation": 0, "affectation": 0, "pv_installation": 0}
    contracts_active = 0
    assignments_active = 0
    equipped_employees = 0
    for state in states:
        by_state[state.status] = by_state.get(state.status, 0) + 1
        contracts_active += 1 if state.has_contract else 0
        assignments_active += 1 if state.has_assignment else 0
        equipped_employees += 1 if state.has_equipment else 0
        for step in state.missing_steps:
            if step in missing_steps:
                missing_steps[step] += 1

    site_stmt = select(Site)
    site_condition = site_scope_condition(user, society)
    if site_condition is not None:
        site_stmt = site_stmt.where(site_condition)
    scoped_sites = db.execute(site_stmt).scalars().all()
    scoped_site_ids = {site.id for site in scoped_sites}

    store_stmt = select(Store)
    store_condition = store_scope_condition(user, society)
    if store_condition is not None:
        store_stmt = store_stmt.where(store_condition)

    supplier_stmt = select(Supplier)
    societies = effective_societies(user, society)
    if societies:
        supplier_stmt = supplier_stmt.where(or_(Supplier.society.in_(societies), Supplier.society.is_(None), Supplier.society == ""))

    article_stmt = select(StockArticle).where(StockArticle.active == 1)
    if societies:
        article_stmt = article_stmt.where(StockArticle.society.in_(societies))
    articles = db.execute(article_stmt).scalars().all()
    article_ids = {article.id for article in articles}
    stock_ruptures = 0
    stock_low = 0
    for article in articles:
        quantity = float(article.quantity or 0)
        min_quantity = float(article.min_quantity or 0)
        raw = article.attributes.get("raw") if isinstance(article.attributes, dict) and isinstance(article.attributes.get("raw"), dict) else {}
        try:
            threshold = float(str(raw.get("seuilAlerte") or raw.get("seuil_stock_bas") or raw.get("alert_threshold") or 0).replace(" ", "").replace(",", "."))
        except (TypeError, ValueError):
            threshold = 0
        if quantity <= 0:
            stock_ruptures += 1
        elif (threshold > 0 and quantity <= threshold) or (min_quantity > 0 and quantity <= min_quantity):
            stock_low += 1

    candidate_stmt = select(Candidate)
    if societies:
        candidate_stmt = candidate_stmt.where(Candidate.society.in_(societies))
    candidate_rows = db.execute(candidate_stmt).scalars().all()

    presence_stmt = select(DailyPresence).where(DailyPresence.presence_date == _today())
    if employee_ids:
        presence_stmt = presence_stmt.where(DailyPresence.employee_id.in_(employee_ids))
    elif societies:
        presence_stmt = presence_stmt.where(False)
    present_statuses = {"present", "presente", "p"}
    absent_statuses = {"absent", "absence", "a", "ab", "abandon"}
    presence_rows_today = db.execute(presence_stmt).scalars().all()
    presence_present_today = 0
    presence_absent_today = 0
    for row in presence_rows_today:
        data = row.data if isinstance(row.data, dict) else {}
        keys = {
            _status_key(row.status),
            _status_key(data.get("status")),
            _status_key(data.get("statut")),
            _status_key(data.get("code")),
        }
        if keys & absent_statuses:
            presence_absent_today += 1
        elif keys & present_statuses:
            presence_present_today += 1

    month_start = today.replace(day=1)
    month_stmt = select(DailyPresence).where(DailyPresence.presence_date >= month_start).where(DailyPresence.presence_date <= today)
    if employee_ids:
        month_stmt = month_stmt.where(DailyPresence.employee_id.in_(employee_ids))
    elif societies:
        month_stmt = month_stmt.where(False)
    validated_month_stmt = month_stmt.where(DailyPresence.closed_at.is_not(None))

    events_stmt = select(Event).where(or_(Event.status.is_(None), ~func.lower(Event.status).in_(OPEN_EVENT_EXCLUDED_STATUSES)))
    if employee_ids or scoped_site_ids:
        events_stmt = events_stmt.where(or_(Event.employee_id.in_(employee_ids or {-1}), Event.site_id.in_(scoped_site_ids or {-1})))
    elif societies:
        events_stmt = events_stmt.where(False)

    movement_stmt = select(StockMovement)
    if article_ids:
        movement_stmt = movement_stmt.where(StockMovement.article_id.in_(article_ids))
    elif societies:
        movement_stmt = movement_stmt.where(False)

    return {
        "employees": {
            "total": len(employees),
            "non_archived": active_employee_count,
            "active": active_employee_count,
            "operational_active": by_state.get("actif_operationnel", 0),
            "preparation": by_state.get("en_preparation_operationnelle", 0),
            "without_contract": missing_steps["contrat"],
            "without_equipment": missing_steps["dotation"],
            "without_assignment": missing_steps["affectation"],
            "without_installation_pv": missing_steps["pv_installation"],
            "leave_current": leave_count,
            "sick_leave_current": sick_leave_count,
            "absent": _sum_statuses(status_counts, "absent", "absence"),
            "suspended": _sum_statuses(status_counts, "suspendu", "suspendue", "suspended"),
            "blacklisted": _sum_statuses(status_counts, "blackliste", "blacklisté", "blacklist", "blacklisted"),
            "by_state": by_state,
            "by_status": status_counts,
        },
        "drh": {
            "candidates_total": _active_candidate_count(candidate_rows),
            "candidates_reserve": sum(1 for row in candidate_rows if _status_key(row.status) in {"reserve", "reserved"}),
            "contracts_active": contracts_active,
        },
        "ops": {
            "sites_total": len(scoped_sites),
            "sites_active": sum(1 for site in scoped_sites if site.active == 1),
            "assignments_active": assignments_active,
            "presence_today": len(presence_rows_today),
            "presence_present_today": presence_present_today,
            "presence_absent_today": presence_absent_today,
            "presence_month": _count(db, month_stmt),
            "presence_validated_month": _count(db, validated_month_stmt),
            "events_open": _count(db, events_stmt),
        },
        "materiel": {
            "stores_total": _count(db, store_stmt),
            "suppliers_total": _count(db, supplier_stmt),
            "articles_active": len(articles),
            "stock_ruptures": stock_ruptures,
            "stock_low": stock_low,
            "stock_alerts_total": stock_ruptures + stock_low,
            "employee_dotations_active": equipped_employees,
            "movements_total": _count(db, movement_stmt),
        },
    }


def _employee_display_name(employee: Employee) -> str:
    return f"{employee.last_name or ''} {employee.first_name or ''}".strip() or employee.code


def _employee_extra_values(employee: Employee) -> dict[str, Any]:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    return {**legacy, **extra}


def operational_preparation_rows(db: Session, user: User | None = None, society: str | None = None) -> dict[str, Any]:
    employees = db.execute(_employee_base_stmt(user, society).order_by(Employee.last_name, Employee.first_name, Employee.id)).scalars().all()
    employee_ids = {employee.id for employee in employees}
    contract_ids = _active_contract_employee_ids(db, employee_ids)
    assignment_ids = _active_assignment_employee_ids(db, employee_ids)
    equipped_ids = _equipped_employee_ids(db, employee_ids)
    rows: list[dict[str, Any]] = []
    counters = {"contrat": 0, "dotation": 0, "affectation": 0, "pv_installation": 0}

    for employee in employees:
        raw_status = _status_key(employee.status)
        if raw_status in EXIT_STATUSES:
            continue
        state = employee_operational_state(
            employee,
            active_contract_ids=contract_ids,
            active_assignment_ids=assignment_ids,
            equipped_ids=equipped_ids,
        )
        if state.status == "actif_operationnel":
            continue
        values = _employee_extra_values(employee)
        blockers = []
        if not state.has_contract:
            counters["contrat"] += 1
            blockers.append({"key": "contrat", "label": "Contrat", "action": "Créer contrat", "route": "contrats/nouveau_contrat"})
        if not state.has_equipment:
            counters["dotation"] += 1
            blockers.append({"key": "dotation", "label": "Dotation", "action": "Doter", "route": "materiel/dotation"})
        if not state.has_assignment:
            counters["affectation"] += 1
            blockers.append({"key": "affectation", "label": "Affectation", "action": "Affecter", "route": "effectif/instance_affectation"})
        if not state.has_installation_pv:
            counters["pv_installation"] += 1
            blockers.append({"key": "pv_installation", "label": "PV installation", "action": "Ouvrir fiche", "route": f"agents/{employee.id}"})

        rows.append(
            {
                "employee_id": employee.id,
                "backend_id": employee.id,
                "code": employee.code,
                "name": _employee_display_name(employee),
                "first_name": employee.first_name,
                "last_name": employee.last_name,
                "society": employee.society,
                "position": employee.position or values.get("fonction") or values.get("poste") or values.get("posteContrat"),
                "site": (values.get("siteName") or values.get("site") or ((values.get("affectationCourante") or {}).get("siteName") if isinstance(values.get("affectationCourante"), dict) else None)),
                "status": state.status,
                "employee_status": employee.status,
                "has_contract": state.has_contract,
                "has_equipment": state.has_equipment,
                "has_assignment": state.has_assignment,
                "has_installation_pv": state.has_installation_pv,
                "missing_steps": list(state.missing_steps),
                "blockers": blockers,
                "recommended_action": blockers[0] if blockers else None,
            }
        )

    return {
        "society": (society or "").strip(),
        "total": len(rows),
        "counters": counters,
        "items": rows,
    }
