from __future__ import annotations

import time
from copy import deepcopy
from datetime import date, datetime, timezone
from threading import Lock
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.commercial.models import Client
from app.modules.erp.service import authorized_societies, build_erp_counters
from app.modules.finance_models import Advance, CashEntry, CreditNote, Invoice, Payment
from app.modules.irongs.models import SgdiRecord
from app.core.scope_policy import effective_society_values, society_key


def _legacy_counts(db: Session) -> dict[str, int]:
    rows = (
        db.query(SgdiRecord.collection, func.count(SgdiRecord.id))
        .group_by(SgdiRecord.collection)
        .all()
    )
    return {str(name): int(count or 0) for name, count in rows}


def _legacy_rows(db: Session, name: str) -> list[dict[str, Any]]:
    # Lecture seule : tous les appelants ne font que lire/compter (jamais muter) ces
    # dicts, donc pas besoin de deepcopy ici — ça évite de recopier en mémoire des
    # blobs JSON potentiellement volumineux pour chaque collection à chaque appel.
    rows = (
        db.query(SgdiRecord)
        .filter(SgdiRecord.collection == name)
        .order_by(SgdiRecord.position.asc(), SgdiRecord.id.asc())
        .all()
    )
    return [row.data for row in rows if row.kind == "item" and isinstance(row.data, dict)]


def _norm(value: Any) -> str:
    return str(value or "").strip().casefold()


def _scope_values(scope: str | list[str] | None) -> list[str] | None:
    if scope is None:
        return None
    if isinstance(scope, list):
        return [str(value).strip() for value in scope if str(value or "").strip()]
    value = str(scope or "").strip()
    return [value] if value else []


def _matches_society(row: dict[str, Any], scope: str | list[str] | None) -> bool:
    values = _scope_values(scope)
    if values is None:
        return True
    wanted = {society_key(value) for value in values}
    for key in ("societe", "society", "societeRattachement", "company"):
        if society_key(row.get(key)) in wanted:
            return True
    return False


def _status(row: dict[str, Any]) -> str:
    return _norm(row.get("statut") or row.get("status"))


_SOCIETY_JSON_KEYS = ("societe", "society", "societeRattachement", "company")


def _count_legacy_items(db: Session, name: str, society: str | list[str] | None = None) -> int:
    # Compte en SQL plutôt que de récupérer toutes les lignes en Python pour les
    # jeter après comptage — appelée ~10 fois par sidebar-stats, c'était l'un des
    # postes de coût les plus lourds de l'endpoint. Reproduit exactement la logique
    # de _matches_society (mêmes 4 clés, comparaison insensible à la casse, trim).
    values = _scope_values(society)
    stmt = db.query(func.count(SgdiRecord.id)).filter(
        SgdiRecord.collection == name,
        SgdiRecord.kind == "item",
    )
    if values is not None:
        rows = [row for row in _legacy_rows(db, name) if _matches_society(row, values)]
        return len(rows)
    return int(stmt.scalar() or 0)


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


def _commercial_stats(db: Session, society: str | list[str] | None = None) -> dict[str, int]:
    stmt = db.query(Client)
    values = _scope_values(society)
    if values is not None:
        stmt = stmt.filter(Client.society.in_(values))
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
        "opportunities_open": sum(1 for row in _legacy_rows(db, "opportunites") if _matches_society(row, society) and _norm(row.get("etape")) not in {"gagnee", "gagnée", "perdue"}),
        "visits_total": _count_legacy_items(db, "visites", society),
        "contracts_30d": contracts_30j,
        "tarifs_total": _count_legacy_items(db, "catalogue", society),
    }


def _finance_stats(db: Session, society: str | list[str] | None = None) -> dict[str, int]:
    def scoped(model):
        query = db.query(model)
        values = _scope_values(society)
        if values is not None:
            query = query.filter(model.society.in_(values))
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


def _secretariat_stats(db: Session, society: str | list[str] | None = None) -> dict[str, int]:
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


def _apply_legacy_fallbacks(db: Session, erp: dict[str, Any], society: str | list[str] | None) -> dict[str, Any]:
    """Fill counters from the residual SGDI JSON store when SQL tables are empty.

    During the progressive migration, some installations still have their
    operational data in sgdi_records while the new SQL tables are empty. The UI
    counters must remain stable and must not show zero just because the SQL side
    has not been hydrated yet.
    """

    agents = [row for row in _legacy_rows(db, "agents") if _matches_society(row, society)]
    if agents:
        non_exit_rows = [row for row in agents if not _is_employee_archived(row)]
        legacy_without_assignment = sum(1 for row in non_exit_rows if not _employee_has_assignment(row))

        if not int(erp.get("employees", {}).get("total") or 0):
            active_rows = [row for row in agents if _is_employee_active(row)]
            operational_rows = [row for row in active_rows if _employee_has_assignment(row)]
            agent_ids = {str(row.get("id") or row.get("backendId") or "").strip() for row in agents if row.get("id") or row.get("backendId")}
            conge_rows = [row for row in _legacy_rows(db, "conges") if _matches_society(row, society)]
            leave_count, sick_leave_count = _legacy_current_leave_counts(conge_rows, agent_ids)
            employees = erp.setdefault("employees", {})
            employees.update({
                "total": len(agents),
                "non_archived": len(non_exit_rows),
                "active": len(non_exit_rows),
                "operational_active": len(operational_rows),
                "preparation": 0,
                "without_contract": 0,
                "without_equipment": int(employees.get("without_equipment") or 0),
                "without_assignment": legacy_without_assignment,
                "without_installation_pv": 0,
                "leave_current": leave_count,
                "sick_leave_current": sick_leave_count,
                "absent": sum(1 for row in agents if _status(row) == "absent"),
                "suspended": sum(1 for row in agents if _status(row) == "suspendu"),
                "blacklisted": sum(1 for row in agents if _status(row) in {"blacklist", "blackliste", "blacklisté"} or row.get("blacklist") or row.get("contractBlocked")),
                "by_status": {},
            })
        else:
            # SQL employees table is populated but Assignment table may be out of sync
            # with legacy affectationCourante — always trust the legacy value for this counter
            erp["employees"]["without_assignment"] = legacy_without_assignment

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
    # _apply_legacy_fallbacks (appelée avant, dans le même appel à build_sidebar_stats)
    # charge déjà "agents" et "sites" en entier — on évite de les recharger ici en
    # ne demandant que les valeurs distinctes directement en SQL.
    values: set[str] = set()
    rows = db.query(Client.society).distinct().all()
    values.update(str(row[0]).strip() for row in rows if row and str(row[0] or "").strip())
    for name in ("agents", "sites", "clients"):
        for key in ("societe", "society", "societeRattachement"):
            rows = (
                db.query(SgdiRecord.data[key].as_string())
                .filter(SgdiRecord.collection == name, SgdiRecord.kind == "item")
                .distinct()
                .all()
            )
            values.update(str(row[0]).strip() for row in rows if row and row[0] and str(row[0]).strip())
    return len(values)


# Cache par (utilisateur, société) : (instant, signature d'événements, résultat).
# build_sidebar_stats parcourt et recopie une douzaine de collections legacy en
# entier à chaque appel (agents, congés, candidats, sites, prospects, devis...) —
# c'était la requête la plus lente de l'app (jusqu'à 8s), appelée très fréquemment.
# Même mécanisme d'invalidation que le cache de snapshot (/api/irongs/db) : dès
# qu'une donnée surveillée change, la signature diffère et le résultat est recalculé.
_SIDEBAR_STATS_CACHE: dict[str, tuple[float, str, dict]] = {}
_SIDEBAR_STATS_CACHE_LOCK = Lock()
_SIDEBAR_STATS_CACHE_TTL = 120.0


def _sidebar_stats_signature() -> str:
    try:
        from app.main import _events_signature_cached
        return _events_signature_cached()
    except Exception:
        return ""


def build_sidebar_stats(db: Session, user: User, society: str | None = None) -> dict[str, Any]:
    scope = effective_society_values(user, society)
    scope_key = "*" if scope is None else "|".join(sorted(society_key(value) for value in scope))
    cache_key = f"{user.username}|{scope_key}|{user.role}|{user.authorized_modules!r}|{user.authorized_structures!r}"
    signature = _sidebar_stats_signature()
    now = time.monotonic()
    with _SIDEBAR_STATS_CACHE_LOCK:
        entry = _SIDEBAR_STATS_CACHE.get(cache_key)
        if entry and now - entry[0] < _SIDEBAR_STATS_CACHE_TTL and entry[1] == signature:
            return deepcopy(entry[2])
    result = _build_sidebar_stats_uncached(db, user, society)
    with _SIDEBAR_STATS_CACHE_LOCK:
        _SIDEBAR_STATS_CACHE[cache_key] = (now, signature, result)
    return deepcopy(result)


def _build_sidebar_stats_uncached(db: Session, user: User, society: str | None = None) -> dict[str, Any]:
    """Return ERP counters computed by the backend.

    The frontend still keeps the legacy snapshot during the transition, but this
    response gives the application one reliable source for operational counts.
    """

    societies = authorized_societies(user)
    effective_scope = effective_society_values(user, society)
    global_legacy = _legacy_counts(db)
    legacy = (
        global_legacy
        if effective_scope is None
        else {name: _count_legacy_items(db, name, effective_scope) for name in global_legacy}
    )
    erp = _apply_legacy_fallbacks(db, build_erp_counters(db, user, society), effective_scope)
    erp.setdefault("ops", {})["missions_current"] = _count_legacy_items(db, "missions", effective_scope)
    commercial = _commercial_stats(db, effective_scope)
    finance = _finance_stats(db, effective_scope)
    secretariat = _secretariat_stats(db, effective_scope)
    from app.modules.drh.models import Candidate
    from app.modules.drh.service import _candidate_is_recruited, _candidate_is_transmitted
    from app.modules.drh.routes import _ensure_recruitment_access
    from fastapi import HTTPException
    candidate_query = db.query(Candidate)
    if effective_scope is not None:
        candidate_query = candidate_query.filter(Candidate.society.in_(effective_scope))
    scoped_candidates = candidate_query.all()
    recruitment_pending = None
    try:
        _ensure_recruitment_access(user)
        recruitment_pending = sum(not _candidate_is_recruited(row) for row in scoped_candidates)
    except HTTPException:
        pass
    contracts_pending = sum(_candidate_is_transmitted(row) and not _candidate_is_recruited(row) for row in scoped_candidates)


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
                "shared_pending": recruitment_pending,
                "contracts_pending": contracts_pending,
                "reserve": erp["drh"].get("candidates_reserve", 0),
                # `legacy` contient les totaux globaux. Pour une société active,
                # le total DRH déjà filtré est la seule valeur sûre à exposer ici.
                "nouveaux": erp["drh"]["candidates_total"] if effective_scope is not None else legacy.get("candidats", 0),
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
            "utilisateurs": _user_count(db) if effective_scope is None else 0,
            "societies_total": _distinct_society_count(db) if effective_scope is None else len(effective_scope),
            "access_rules": _count_legacy_items(db, "accessRules", effective_scope),
            "alerts": _count_legacy_items(db, "workflowTasks", effective_scope),
            "messages": _count_legacy_items(db, "messages", effective_scope),
            "journal": _count_legacy_items(db, "unlockLog", effective_scope),
        },
        "legacy": legacy,
    }
