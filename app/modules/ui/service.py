from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.commercial.models import Client
from app.modules.erp.service import authorized_societies, build_erp_counters
from app.modules.finance_models import Advance, CashEntry, CreditNote, Invoice, Payment
from app.modules.irongs.models import SgdiRecord


def _legacy_counts(db: Session) -> dict[str, int]:
    rows = (
        db.query(SgdiRecord.collection, func.count(SgdiRecord.id))
        .group_by(SgdiRecord.collection)
        .all()
    )
    return {str(name): int(count or 0) for name, count in rows}


def _legacy_rows(db: Session, name: str) -> list[dict[str, Any]]:
    rows = (
        db.query(SgdiRecord)
        .filter(SgdiRecord.collection == name)
        .order_by(SgdiRecord.position.asc(), SgdiRecord.id.asc())
        .all()
    )
    return [deepcopy(row.data) for row in rows if row.kind == "item" and isinstance(row.data, dict)]


def _norm(value: Any) -> str:
    return str(value or "").strip().casefold()


def _matches_society(row: dict[str, Any], society: str | None) -> bool:
    wanted = _norm(society)
    if not wanted:
        return True
    for key in ("societe", "society", "societeRattachement", "company"):
        if _norm(row.get(key)) == wanted:
            return True
    return False


def _status(row: dict[str, Any]) -> str:
    return _norm(row.get("statut") or row.get("status"))


def _count_legacy_items(db: Session, name: str, society: str | None = None) -> int:
    return len([row for row in _legacy_rows(db, name) if _matches_society(row, society)])


def _client_site_count(data: dict[str, Any]) -> int:
    sites = data.get("tech_sites")
    if isinstance(sites, list):
        return len(sites)
    try:
        return int(data.get("tech_nbrSite") or data.get("nbrSite") or 0)
    except (TypeError, ValueError):
        return 0


def _client_effectif_count(data: dict[str, Any]) -> int:
    sites = data.get("tech_sites")
    if not isinstance(sites, list):
        try:
            return int(data.get("totalEffectif") or data.get("effectif") or 0)
        except (TypeError, ValueError):
            return 0
    total = 0
    for site in sites:
        if not isinstance(site, dict):
            continue
        try:
            saved = int(site.get("totalEffectif") or 0)
            if saved > 0:
                total += saved
                continue
            groups = int(site.get("nbrGroupe") or 0)
            day = int(site.get("nbrJour") or 0)
            night = int(site.get("nbrNuit") or 0)
            total += groups * night + max(0, day - night)
        except (TypeError, ValueError):
            continue
    return total


def _commercial_stats(db: Session, society: str | None = None) -> dict[str, int]:
    stmt = db.query(Client)
    wanted = _norm(society)
    if wanted:
        stmt = stmt.filter(Client.society == society)
    clients = stmt.all()
    today = date.today()
    active_clients = [client for client in clients if _norm(client.status) not in {"inactif", "inactive", "archive", "archivé"}]
    contracts_30j = sum(1 for client in active_clients if client.contract_end and 0 <= (client.contract_end - today).days <= 30)
    sites = 0
    employees = 0
    for client in active_clients:
        data = client.data if isinstance(client.data, dict) else {}
        sites += _client_site_count(data)
        employees += _client_effectif_count(data)
    return {
        "prospects": _count_legacy_items(db, "prospects", society),
        "clients_active": len(active_clients),
        "clients_total": len(clients),
        "sites_total": sites,
        "employees_total": employees,
        "opportunities_open": _count_legacy_items(db, "opportunites", society),
        "visits_total": _count_legacy_items(db, "visites", society),
        "contracts_30d": contracts_30j,
        "tarifs_total": _count_legacy_items(db, "catalogue", society),
    }


def _finance_stats(db: Session, society: str | None = None) -> dict[str, int]:
    def scoped(model):
        query = db.query(model)
        if society:
            query = query.filter(model.society == society)
        return query

    invoices = scoped(Invoice).all()
    overdue_statuses = {"echue", "échue", "overdue"}
    return {
        "quotes_total": _count_legacy_items(db, "devis", society),
        "invoices_total": len(invoices),
        "payments_total": scoped(Payment).count(),
        "overdue_invoices": sum(1 for invoice in invoices if _norm(invoice.status) in overdue_statuses),
        "advances_total": scoped(Advance).count(),
        "credit_notes_total": scoped(CreditNote).count(),
        "cash_entries_total": scoped(CashEntry).count(),
    }


def _secretariat_stats(db: Session, society: str | None = None) -> dict[str, int]:
    courriers = [row for row in _legacy_rows(db, "secretariatCourriers") if _matches_society(row, society)]
    notes = [row for row in _legacy_rows(db, "secretariatNotes") if _matches_society(row, society)]
    archives = [row for row in courriers if bool(row.get("archive")) or _status(row) in {"archive", "archivé"}]
    return {
        "courriers_total": len(courriers),
        "courriers_open": max(0, len(courriers) - len(archives)),
        "notes_total": len(notes),
        "archives_total": len(archives),
    }


def _is_employee_archived(row: dict[str, Any]) -> bool:
    return _status(row) in {"sortant", "demissionne", "démissionné", "licencie", "licencié", "archive", "blackliste", "blacklisté"}


def _is_employee_active(row: dict[str, Any]) -> bool:
    status = _status(row)
    return bool(status in {"actif", "active"} or (not status and not _is_employee_archived(row)))


def _employee_has_assignment(row: dict[str, Any]) -> bool:
    aff = row.get("affectationCourante") if isinstance(row.get("affectationCourante"), dict) else {}
    return bool(aff.get("siteId") or aff.get("siteName") or row.get("siteId") or row.get("siteName"))


def _legacy_current_leave_counts(rows: list[dict[str, Any]], employee_ids: set[str]) -> tuple[int, int]:
    today = date.today().isoformat()
    conge = 0
    maladie = 0
    for row in rows:
        agent_id = str(row.get("agentId") or row.get("employeeId") or row.get("employee_id") or "").strip()
        if employee_ids and agent_id and agent_id not in employee_ids:
            continue
        status = _norm(row.get("statut") or row.get("status"))
        if status not in {"approuve", "approuvé", "approved"}:
            continue
        start = str(row.get("du") or row.get("start_date") or row.get("dateDebut") or "")[:10]
        end = str(row.get("au") or row.get("end_date") or row.get("dateFin") or "")[:10]
        if start and start > today:
            continue
        if end and end < today:
            continue
        kind = _norm(row.get("type") or row.get("leave_type"))
        if "malad" in kind:
            maladie += 1
        else:
            conge += 1
    return conge, maladie


def _apply_legacy_fallbacks(db: Session, erp: dict[str, Any], society: str | None) -> dict[str, Any]:
    """Fill counters from the residual SGDI JSON store when SQL tables are empty.

    During the progressive migration, some installations still have their
    operational data in sgdi_records while the new SQL tables are empty. The UI
    counters must remain stable and must not show zero just because the SQL side
    has not been hydrated yet.
    """

    agents = [row for row in _legacy_rows(db, "agents") if _matches_society(row, society)]
    if agents and not int(erp.get("employees", {}).get("total") or 0):
        active_rows = [row for row in agents if _is_employee_active(row)]
        operational_rows = [row for row in active_rows if _employee_has_assignment(row)]
        non_archived = [row for row in agents if not _is_employee_archived(row)]
        agent_ids = {str(row.get("id") or row.get("backendId") or "").strip() for row in agents if row.get("id") or row.get("backendId")}
        conge_rows = [row for row in _legacy_rows(db, "conges") if _matches_society(row, society) or not society]
        leave_count, sick_leave_count = _legacy_current_leave_counts(conge_rows, agent_ids)
        employees = erp.setdefault("employees", {})
        employees.update({
            "total": len(agents),
            "non_archived": len(non_archived),
            "active": len(active_rows),
            "operational_active": len(operational_rows),
            "preparation": 0,
            "without_contract": 0,
            "without_equipment": int(employees.get("without_equipment") or 0),
            "without_assignment": sum(1 for row in active_rows if not _employee_has_assignment(row)),
            "without_installation_pv": 0,
            "leave_current": leave_count,
            "sick_leave_current": sick_leave_count,
            "absent": sum(1 for row in agents if _status(row) == "absent"),
            "suspended": sum(1 for row in agents if _status(row) == "suspendu"),
            "blacklisted": sum(1 for row in agents if _status(row) in {"blacklist", "blackliste", "blacklisté"} or row.get("blacklist") or row.get("contractBlocked")),
            "by_status": {},
        })

    candidats = [row for row in _legacy_rows(db, "candidats") if _matches_society(row, society)]
    if candidats and not int(erp.get("drh", {}).get("candidates_total") or 0):
        archived = {"archive", "archived", "archivé", "archivee", "archivée"}
        recruited = {"embauche", "embauché", "recrute", "recruté", "employe", "employé"}
        active_candidates = [row for row in candidats if _status(row) not in archived | recruited]
        drh = erp.setdefault("drh", {})
        drh["candidates_total"] = len(active_candidates)
        drh["candidates_reserve"] = sum(1 for row in active_candidates if _status(row) in {"reserve", "réserve"})

    sites = [row for row in _legacy_rows(db, "sites") if _matches_society(row, society)]
    if sites and not int(erp.get("ops", {}).get("sites_total") or 0):
        ops = erp.setdefault("ops", {})
        ops["sites_total"] = len(sites)
        ops["sites_active"] = sum(1 for row in sites if row.get("actif") is not False and row.get("active") != 0)

    return erp


def _user_count(db: Session) -> int:
    return int(db.query(func.count(User.id)).scalar() or 0)


def _distinct_society_count(db: Session) -> int:
    values: set[str] = set()
    for model, attr in ((Client, Client.society),):
        rows = db.query(attr).distinct().all()
        values.update(str(row[0]).strip() for row in rows if row and str(row[0] or "").strip())
    for name in ("agents", "sites", "clients"):
        for row in _legacy_rows(db, name):
            for key in ("societe", "society", "societeRattachement"):
                value = str(row.get(key) or "").strip()
                if value:
                    values.add(value)
    return len(values)


def build_sidebar_stats(db: Session, user: User, society: str | None = None) -> dict[str, Any]:
    """Return ERP counters computed by the backend.

    The frontend still keeps the legacy snapshot during the transition, but this
    response gives the application one reliable source for operational counts.
    """

    societies = authorized_societies(user)
    legacy = _legacy_counts(db)
    erp = _apply_legacy_fallbacks(db, build_erp_counters(db, user, society), society)
    erp.setdefault("ops", {})["missions_current"] = _count_legacy_items(db, "missions", society)
    commercial = _commercial_stats(db, society)
    finance = _finance_stats(db, society)
    secretariat = _secretariat_stats(db, society)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "username": user.username,
            "role": user.role,
            "societies": societies,
            "active_society": (society or "").strip(),
        },
        "erp": erp,
        "drh": {
            "recrutement": {
                "total": erp["drh"]["candidates_total"],
                "reserve": erp["drh"].get("candidates_reserve", 0),
                "nouveaux": legacy.get("candidats", 0),
                "archives": 0,
            },
            "effectifs": {
                "total": erp["employees"]["total"],
                "actifs": erp["employees"].get("active", erp["employees"].get("non_archived", erp["employees"]["operational_active"])),
                "en_preparation": erp["employees"]["preparation"],
                "sans_contrat": erp["employees"]["without_contract"],
                "sans_dotation": erp["employees"]["without_equipment"],
                "sans_affectation": erp["employees"]["without_assignment"],
                "sans_pv_installation": erp["employees"]["without_installation_pv"],
                "conge": erp["employees"].get("leave_current", 0),
                "maladie": erp["employees"].get("sick_leave_current", 0),
                "absent": erp["employees"].get("absent", 0),
                "suspendu": erp["employees"].get("suspended", 0),
                "blacklist": erp["employees"].get("blacklisted", 0),
            },
        },
        "ops": {
            "sites": {
                "total": erp["ops"]["sites_total"],
                "actifs": erp["ops"]["sites_active"],
            },
            "pointage": {
                "jour": erp["ops"]["presence_today"],
            },
            "affectations": {
                "actives": erp["ops"]["assignments_active"],
            },
            "main_courante": {
                "ouvertes": erp["ops"]["events_open"],
            },
        },
        "materiel": erp["materiel"],
        "commercial": commercial,
        "facturation": finance,
        "secretariat": secretariat,
        "pointage": {
            "presence_today": erp["ops"].get("presence_today", 0),
            "present_today": erp["ops"].get("presence_present_today", 0),
            "absent_today": erp["ops"].get("presence_absent_today", 0),
            "monthly_rows": erp["ops"].get("presence_month", 0),
            "validated_month": erp["ops"].get("presence_validated_month", 0),
        },
        "admin": {
            "utilisateurs": _user_count(db),
            "societies_total": _distinct_society_count(db),
            "access_rules": _count_legacy_items(db, "accessRules", society),
            "alerts": _count_legacy_items(db, "workflowTasks", society),
            "messages": _count_legacy_items(db, "messages", society),
            "journal": _count_legacy_items(db, "unlockLog", society),
        },
        "legacy": legacy,
    }
