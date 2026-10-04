"""ATLAS Site Workforce — routes du portail "Chargé des effectifs" (1 à N sociétés, 1 à N sites).

Toutes les routes exigent `resolve_scope` (§security.py) : le périmètre est résolu depuis le
compte ; ?society= / ?site_id= ne font que le RÉDUIRE (403 s'ils en sortent). Lectures et
agrégats : `scope.selected`. Action sur une ressource existante : son site réel doit être dans
`scope.sites`. Création : site = affectation réelle de l'employé (un site_id client n'est
qu'une vérification). Toute action sensible passe par `append_audit` (§B18, réutilise le
mécanisme existant, jamais une nouvelle table d'audit), avec le site et la société de la
ressource — une vue multi-sites ne perd jamais le contexte du site.
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.pagination import normalize_page
from app.core.photo_storage import save_base64_document
from app.db.session import get_db
from app.modules.auth.dependencies import AUTHORIZED_ACTIONS, current_user
from app.modules.auth.models import User
from app.modules.drh.models import Document, Employee, Leave
from app.modules.ops.models import Assignment, DailyPresence, Incident, Site
from app.modules.site_workforce.models import Reclamation, SiteNotification, Transmission
from app.modules.site_workforce.schemas import (
    AbsenceDecision,
    AttendanceCorrection,
    AttendanceUpsert,
    DocumentUpload,
    DocumentVerify,
    IncidentCreate,
    LeaveCreate,
    ReclamationCreate,
    ReclamationRespond,
    TransmissionCreate,
)
from app.modules.attendance import core as attendance_core
from app.modules.attendance.models import ANOMALY_OPEN, SOURCE_SITE_WORKFORCE, AttendanceAnomaly
from app.modules.site_workforce.security import (
    BeoScope,
    _active_assignment_filter,
    _site_society,
    assigned_employees_subquery,
    employee_site_map,
    ensure_employee_in_scope,
    resolve_scope,
)

router = APIRouter(dependencies=[Depends(current_user)])

ATTENDANCE_STATUSES = {"present", "absent", "conge", "maladie", "repos", "mission"}
LIST_LIMIT = 500


def _require_action(user: User, action: str) -> None:
    """Une action métier au-delà du CRUD générique de request_action (ex. clôture,
    vérification de justificatif) doit rester soumise à la même politique
    authorized_actions que le reste du backend — jamais une garde propre à ce module."""
    actions = [str(v).strip().lower() for v in (user.authorized_actions or [])]
    actions = [v for v in actions if v in AUTHORIZED_ACTIONS]
    if actions and action not in actions and "admin" not in actions:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=f"Action non autorisée : {action}")


def _emit(db: Session, site: Site, *, notif_type: str, message: str, level: str = "info", employee_id: int | None = None) -> None:
    db.add(SiteNotification(site_id=site.id, employee_id=employee_id, notif_type=notif_type, message=message[:300], level=level))


def _audit(db: Session, request: Request, user: User, site: Site, *, action: str, resource: str,
           resource_id: int, old_state=None, new_state=None) -> None:
    append_audit(
        db, action=f"site_workforce.{action}", resource=f"site_workforce.{resource}",
        resource_id=f"{site.id}:{resource_id}", society=_site_society(site), result="success",
        user=user, request=request, old_state=old_state, new_state=new_state,
    )


# ── Périmètre (§6) : alimente les sélecteurs Société / Site ─────────────────────────────
@router.get("/scope")
def scope_info(scope: BeoScope = Depends(resolve_scope)):
    """UNIQUEMENT le périmètre autorisé de ce compte — jamais la liste des sociétés/sites ATLAS."""
    sites = [{"id": s.id, "name": s.name, "indicatif": s.indicatif, "society": _site_society(s)} for s in scope.sites.values()]
    return {"societies": sorted({s["society"] for s in sites if s["society"]}), "sites": sites}


# ── Justificatifs : périmètre documentaire en SQL (jamais matérialisé, aucun N+1) ────────
# TROUVÉ EN REVUE DE SÉCURITÉ INDÉPENDANTE (§B22) : une version antérieure chargeait TOUS les
# Document leave/attendance/reclamation de la base puis filtrait en Python par ligne (N+1).
# Le périmètre est désormais une clause SQL sur les sites (1 à N), sous-requêtes comprises.
def document_scope_clause(site_ids: list[int]):
    ids = site_ids or [-1]
    presence_ids = select(DailyPresence.id).where(DailyPresence.site_id.in_(ids))
    leave_ids = select(Leave.id).where(Leave.employee_id.in_(assigned_employees_subquery(ids)))
    reclamation_ids = select(Reclamation.id).where(Reclamation.site_id.in_(ids))
    return or_(
        and_(Document.owner_type == "attendance", Document.owner_id.in_(presence_ids)),
        and_(Document.owner_type == "leave", Document.owner_id.in_(leave_ids)),
        and_(Document.owner_type == "reclamation", Document.owner_id.in_(reclamation_ids)),
    )


def document_owner_site(db: Session, owner_type: str, owner_id: int, site_ids: list[int]) -> tuple[int | None, int | None]:
    """(site réel, employé) du dossier propriétaire d'un justificatif, s'il est dans les sites
    donnés ; (None, None) sinon."""
    if owner_type == "attendance":
        row = db.get(DailyPresence, owner_id)
        return (row.site_id, row.employee_id) if row and row.site_id in site_ids else (None, None)
    if owner_type == "leave":
        row = db.get(Leave, owner_id)
        if not row:
            return None, None
        site_id = employee_site_map(db, site_ids).get(row.employee_id)
        return (site_id, row.employee_id) if site_id else (None, None)
    if owner_type == "reclamation":
        row = db.get(Reclamation, owner_id)
        return (row.site_id, row.employee_id) if row and row.site_id in site_ids else (None, None)
    return None, None


def _employee_names(db: Session, ids) -> dict[int, dict]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {e.id: {"code": e.code, "name": " ".join(filter(None, [e.last_name, e.first_name]))}
            for e in db.execute(select(Employee).where(Employee.id.in_(ids))).scalars()}


def _with_employee(row: dict, names: dict[int, dict]) -> dict:
    info = names.get(row.get("employee_id")) or {}
    return {**row, "employee_code": info.get("code"), "employee_name": info.get("name")}


# ── Dashboard (§7) : agrégats SQL groupés par site, un nombre de requêtes fixe ──────────
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    site_ids = scope.selected
    today = date.today()
    active = _active_assignment_filter(today)
    per_site = {sid: {**scope.label(sid), "effectif": 0, "presents": 0, "absents": 0, "pointes": 0, "anomalies": 0} for sid in site_ids}

    for sid, n in db.execute(select(Assignment.site_id, func.count(func.distinct(Assignment.employee_id)))
                             .where(Assignment.site_id.in_(site_ids), *active).group_by(Assignment.site_id)):
        per_site[sid]["effectif"] = n
    absents_rows = []
    for sid, st, n in db.execute(select(DailyPresence.site_id, DailyPresence.status, func.count(DailyPresence.id))
                                 .where(DailyPresence.site_id.in_(site_ids), DailyPresence.presence_date == today)
                                 .group_by(DailyPresence.site_id, DailyPresence.status)):
        per_site[sid]["pointes"] += n
        if st == "present":
            per_site[sid]["presents"] += n
        elif st == "absent":
            per_site[sid]["absents"] += n
    if any(v["absents"] for v in per_site.values()):
        absents_rows = db.execute(select(DailyPresence.data).where(
            DailyPresence.site_id.in_(site_ids), DailyPresence.presence_date == today, DailyPresence.status == "absent",
        )).scalars().all()
    for sid, n in db.execute(select(AttendanceAnomaly.site_id, func.count(AttendanceAnomaly.id))
                             .where(AttendanceAnomaly.site_id.in_(site_ids), AttendanceAnomaly.status == ANOMALY_OPEN)
                             .group_by(AttendanceAnomaly.site_id)):
        per_site[sid]["anomalies"] = n
    retards = db.scalar(select(func.count(AttendanceAnomaly.id)).where(
        AttendanceAnomaly.site_id.in_(site_ids), AttendanceAnomaly.anomaly_type == "LATE", AttendanceAnomaly.presence_date == today,
    )) or 0
    assigned = assigned_employees_subquery(site_ids, as_of=today)
    leaves_today = dict(db.execute(select(Leave.leave_type, func.count(func.distinct(Leave.employee_id))).where(
        Leave.employee_id.in_(assigned), Leave.status == "approuve", Leave.start_date <= today, Leave.end_date >= today,
    ).group_by(Leave.leave_type)).all())
    prochains = db.execute(select(Leave).where(
        Leave.employee_id.in_(assigned), Leave.status == "approuve", Leave.end_date >= today,
    ).order_by(Leave.start_date).limit(5)).scalars().all()
    justificatifs = db.scalar(select(func.count(Document.id)).where(
        Document.validity_status == "en_attente", document_scope_clause(site_ids),
    )) or 0
    reclamations_ouvertes = db.scalar(select(func.count(Reclamation.id)).where(
        Reclamation.site_id.in_(site_ids), Reclamation.status.in_(["nouvelle", "en_cours"]),
    )) or 0
    incidents_a_transmettre = db.scalar(select(func.count(Incident.id)).where(
        Incident.site_id.in_(site_ids), Incident.status.in_(["brouillon", "signale"]),
    )) or 0
    incidents_ouverts = db.scalar(select(func.count(Incident.id)).where(
        Incident.site_id.in_(site_ids), Incident.status != "cloture",
    )) or 0
    absences_a_traiter = sum(1 for data in absents_rows if not isinstance(data, dict) or data.get("absence_decision_status", "en_attente") == "en_attente")

    effectif = sum(v["effectif"] for v in per_site.values())
    single = scope.sites[site_ids[0]] if len(site_ids) == 1 else None
    return {
        # Compatibilité : "site" reste renseigné quand le périmètre consulté est un site unique.
        "site": {"id": single.id, "name": single.name, "indicatif": single.indicatif} if single else None,
        "scope": {"society": scope.society, "site_ids": site_ids, "sites_count": len(site_ids)},
        "kpi": {
            "effectif_total": effectif,
            "presents_aujourdhui": sum(v["presents"] for v in per_site.values()),
            "absents": sum(v["absents"] for v in per_site.values()),
            "retards": retards,
            "en_conge": leaves_today.get("conge", 0),
            "en_maladie": leaves_today.get("maladie", 0),
            "pointages_incomplets": sum(max(v["effectif"] - v["pointes"], 0) for v in per_site.values()),
            "justificatifs_a_verifier": justificatifs,
            "reclamations_ouvertes": reclamations_ouvertes,
            "incidents_a_transmettre": incidents_a_transmettre,
        },
        "actions_rapides": {
            "absences_a_traiter": absences_a_traiter,
            "justificatifs_en_attente": justificatifs,
            "prochains_conges": [{"employee_id": r.employee_id, "start_date": r.start_date.isoformat(), "end_date": r.end_date.isoformat(), "leave_type": r.leave_type} for r in prochains],
            "incidents_discipline": incidents_ouverts,
        },
        "by_site": [
            {k: v for k, v in row.items() if k != "pointes"} | {"non_pointes": max(row["effectif"] - row["pointes"], 0)}
            for row in per_site.values()
        ],
    }


# ── Personnel (§8) : pagination SQL, colonnes société/site ──────────────────────────────
@router.get("/employees")
def employees(q: str | None = None, page: int = 1, page_size: int = 25,
              db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    today = date.today()
    stmt = select(Employee, Assignment.site_id, Assignment.group_code).join(
        Assignment, Assignment.employee_id == Employee.id,
    ).where(Assignment.site_id.in_(scope.selected), *_active_assignment_filter(today))
    needle = str(q or "").strip()
    if needle:
        pattern = f"%{needle}%"
        stmt = stmt.where(or_(Employee.code.ilike(pattern), Employee.first_name.ilike(pattern),
                              Employee.last_name.ilike(pattern), Employee.position.ilike(pattern)))
    safe_page, safe_size = normalize_page(page, page_size)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    pages = max((total + safe_size - 1) // safe_size, 1)
    safe_page = min(safe_page, pages)
    rows = db.execute(stmt.order_by(Employee.last_name, Employee.first_name, Employee.id, Assignment.site_id)
                      .offset((safe_page - 1) * safe_size).limit(safe_size)).all()
    ids = [emp.id for emp, _, _ in rows]
    presences = {
        (p.employee_id, p.site_id): p.status for p in db.execute(select(DailyPresence).where(
            DailyPresence.employee_id.in_(ids or [-1]), DailyPresence.presence_date == today,
        )).scalars()
    }
    # Périmètre strict (§B15) : jamais salaire/RIB/paie/IRG/CNAS/données privées non
    # nécessaires — uniquement ce qu'un chargé d'effectifs terrain a besoin de voir.
    items = [{
        "id": emp.id, "code": emp.code, "first_name": emp.first_name, "last_name": emp.last_name,
        "position": emp.position, "group_code": group_code, **scope.label(site_id),
        "presence_status": presences.get((emp.id, site_id), "non_pointe"),
    } for emp, site_id, group_code in rows]
    return {"items": items, "total": total, "page": safe_page, "page_size": safe_size, "pages": pages}


# Monthly UI adapter: shared central read model, same scope and existing write API.
@router.get("/attendance/workspace")
def attendance_workspace(month: str = Query(pattern=r"^\d{4}-\d{2}$"), q: str = "", employee_status: str | None = None,
                         employee_id: int | None = None, page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=50),
                         db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    from app.modules.attendance.workspace import read_workspace
    actions = set(user.authorized_actions or [])
    if "read" not in actions and "admin" not in actions:
        raise HTTPException(403, "Lecture du pointage non autorisée")
    result = read_workspace(db, site_ids=scope.selected, month=month, q=q, employee_status=employee_status,
                            employee_id=employee_id, page=page, page_size=page_size)
    result["permissions"] = {a: a in actions or "admin" in actions for a in ("create", "update", "validate", "unlock", "export")}
    return result


# ── Pointage (§9) ────────────────────────────────────────────────────────────────────────
@router.get("/attendance")
def attendance(presence_date: date, db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    emp_sites = employee_site_map(db, scope.selected, as_of=presence_date)
    rows = {r.employee_id: r for r in db.execute(select(DailyPresence).where(
        DailyPresence.site_id.in_(scope.selected), DailyPresence.presence_date == presence_date,
    )).scalars()} if emp_sites else {}
    names = _employee_names(db, emp_sites)
    entries = [_with_employee({
        "employee_id": eid, **scope.label(sid),
        "status": rows[eid].status if eid in rows else "non_pointe",
        "arrival_time": rows[eid].arrival_time if eid in rows else None,
        "closed_at": rows[eid].closed_at.isoformat() if eid in rows and rows[eid].closed_at else None,
        "id": rows[eid].id if eid in rows else None,
    }, names) for eid, sid in sorted(emp_sites.items(), key=lambda kv: (scope.site_name(kv[1]) or "", kv[0]))]
    pointed = sum(1 for e in entries if e["status"] != "non_pointe")
    return {"date": presence_date.isoformat(), "progress": {"pointed": pointed, "total": len(entries)}, "entries": entries}


@router.post("/attendance")
def upsert_attendance(payload: AttendanceUpsert, request: Request, db: Session = Depends(get_db),
                       scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    if not set(user.authorized_actions or []) & {"create", "admin"}:
        raise HTTPException(403, "Saisie du pointage non autorisée")
    if payload.status not in ATTENDANCE_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Statut de pointage invalide")
    employee, site = ensure_employee_in_scope(db, scope, payload.employee_id, site_id=payload.site_id, as_of=payload.presence_date)
    existing = db.execute(select(DailyPresence).where(
        DailyPresence.employee_id == payload.employee_id, DailyPresence.presence_date == payload.presence_date,
    ).order_by(DailyPresence.id.desc())).scalars().first()
    if existing is not None and existing.site_id not in (None, site.id):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Journée déjà pointée sur un autre site")
    if existing is not None:
        _require_action(user, "update")
    old_state = {"status": existing.status} if existing else None
    # Écriture via Attendance Core (seul point d'écriture de la présence) ; l'audit métier
    # Site Workforce ci-dessous reste celui du module.
    row = attendance_core.record_day_status(
        db, employee=employee, site_id=site.id, day=payload.presence_date, status=payload.status,
        source=SOURCE_SITE_WORKFORCE, actor=user, arrival_time=payload.arrival_time,
        departure_time=payload.departure_time, notes=payload.notes, request=request, audit=False,
    )
    if payload.status == "absent" and (not old_state or old_state.get("status") != "absent"):
        _emit(db, site, notif_type="absence_sans_justificatif", message=f"Absence non justifiée — employé #{payload.employee_id}", level="warn", employee_id=payload.employee_id)
    _audit(db, request, user, site, action="attendance.upsert", resource="attendance", resource_id=row.id, old_state=old_state, new_state={"status": payload.status})
    db.commit()
    return {"id": row.id, "status": row.status, "site_id": site.id}


@router.post("/attendance/close")
def close_attendance(presence_date: date, request: Request, db: Session = Depends(get_db),
                      scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    """Clôture du périmètre CONSULTÉ (un site, une société ou tous les sites autorisés)."""
    _require_action(user, "validate")
    emp_sites = employee_site_map(db, scope.selected, as_of=presence_date)
    rows = db.execute(select(DailyPresence).where(
        DailyPresence.site_id.in_(scope.selected), DailyPresence.presence_date == presence_date,
    )).scalars().all()
    pointed = {(r.employee_id, r.site_id) for r in rows}
    missing_by_site: dict[int, int] = {}
    for eid, sid in emp_sites.items():
        if (eid, sid) not in pointed:
            missing_by_site[sid] = missing_by_site.get(sid, 0) + 1
    attendance_core.close_day(db, day=presence_date, site_ids=list(scope.selected), actor=user,
                              source=SOURCE_SITE_WORKFORCE, request=request)
    for sid in scope.selected:
        site = scope.sites[sid]
        if missing_by_site.get(sid):
            _emit(db, site, notif_type="pointage_incomplet", message=f"{missing_by_site[sid]} employé(s) non pointé(s) le {presence_date.isoformat()}", level="warn")
        _audit(db, request, user, site, action="attendance.close", resource="attendance_day", resource_id=0,
               new_state={"date": presence_date.isoformat(), "missing": missing_by_site.get(sid, 0)})
    db.commit()
    return {"closed": len(rows), "missing": sum(missing_by_site.values()), "sites": len(scope.selected)}


@router.post("/attendance/{presence_id}/correct")
def correct_attendance(presence_id: int, payload: AttendanceCorrection, request: Request, db: Session = Depends(get_db),
                        scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    _require_action(user, "validate")
    if payload.status not in ATTENDANCE_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Statut de pointage invalide")
    row = db.get(DailyPresence, presence_id)
    if not row or row.site_id not in scope.sites:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pointage introuvable")
    site = scope.sites[row.site_id]
    old_state = {"status": row.status, "notes": row.notes}
    # Correction post-clôture autorisée ici : l'action "validate" a été exigée ci-dessus.
    attendance_core.correct_presence(
        db, row=row, reason=payload.reason, source=SOURCE_SITE_WORKFORCE, actor=user, allow_closed=True,
        status=payload.status, notes=payload.notes, request=request, audit=False,
    )
    _audit(db, request, user, site, action="attendance.correct", resource="attendance", resource_id=row.id,
           old_state=old_state, new_state={"status": payload.status, "reason": payload.reason})
    db.commit()
    return {"id": row.id, "status": row.status}


# ── Absences (§10) ──────────────────────────────────────────────────────────────────────
@router.get("/absences")
def absences(decision_status: str | None = None, date_from: date | None = None, date_to: date | None = None,
             employee_id: int | None = None, db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    stmt = select(DailyPresence).where(DailyPresence.site_id.in_(scope.selected), DailyPresence.status == "absent")
    if date_from:
        stmt = stmt.where(DailyPresence.presence_date >= date_from)
    if date_to:
        stmt = stmt.where(DailyPresence.presence_date <= date_to)
    if employee_id is not None:
        stmt = stmt.where(DailyPresence.employee_id == employee_id)
    rows = db.execute(stmt.order_by(DailyPresence.presence_date.desc(), DailyPresence.id.desc()).limit(LIST_LIMIT)).scalars().all()
    names = _employee_names(db, (r.employee_id for r in rows))
    out = []
    for row in rows:
        current = row.data.get("absence_decision_status", "en_attente") if isinstance(row.data, dict) else "en_attente"
        if decision_status and current != decision_status:
            continue
        out.append(_with_employee({
            "id": row.id, "employee_id": row.employee_id, "presence_date": row.presence_date.isoformat(),
            "absence_decision_status": current, **scope.label(row.site_id),
        }, names))
    return out


@router.post("/absences/{presence_id}/decision")
def decide_absence(presence_id: int, payload: AbsenceDecision, request: Request, db: Session = Depends(get_db),
                    scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    if payload.decision not in {"justifiee", "injustifiee"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Décision invalide")
    row = db.get(DailyPresence, presence_id)
    if not row or row.site_id not in scope.sites or row.status != "absent":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Absence introuvable")
    _require_action(user, "validate")
    site = scope.sites[row.site_id]
    old_state = dict(row.data) if isinstance(row.data, dict) else {}
    # Décision explicite et séparée — JAMAIS déduite d'un validity_status de document
    # (§B9) : même si un justificatif "conforme" existe, cette route reste le seul chemin.
    row.data = {**old_state, "absence_decision_status": payload.decision, "absence_decision_by": user.username, "absence_decision_at": datetime.utcnow().isoformat(), "absence_decision_comment": payload.comment}
    _audit(db, request, user, site, action="absence.decision", resource="attendance", resource_id=row.id, old_state=old_state, new_state=row.data)
    db.commit()
    return {"id": row.id, "absence_decision_status": payload.decision}


# ── Justificatifs / documents (§10) ─────────────────────────────────────────────────────
@router.get("/documents")
def documents(owner_type: str | None = None, owner_id: int | None = None, validity_status: str | None = None,
              db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    stmt = select(Document).where(document_scope_clause(scope.selected))
    if owner_type:
        stmt = stmt.where(Document.owner_type == owner_type)
    if owner_id is not None:
        stmt = stmt.where(Document.owner_id == owner_id)
    if validity_status:
        stmt = stmt.where(Document.validity_status == validity_status)
    rows = db.execute(stmt.order_by(Document.id.desc()).limit(LIST_LIMIT)).scalars().all()
    # Site de chaque dossier propriétaire : 3 requêtes groupées, jamais une par ligne.
    by_type: dict[str, set[int]] = {}
    for r in rows:
        by_type.setdefault(r.owner_type, set()).add(r.owner_id)
    sites: dict[tuple[str, int], int | None] = {}
    if by_type.get("attendance"):
        for pid, sid in db.execute(select(DailyPresence.id, DailyPresence.site_id).where(DailyPresence.id.in_(by_type["attendance"]))):
            sites[("attendance", pid)] = sid
    if by_type.get("reclamation"):
        for rid, sid in db.execute(select(Reclamation.id, Reclamation.site_id).where(Reclamation.id.in_(by_type["reclamation"]))):
            sites[("reclamation", rid)] = sid
    if by_type.get("leave"):
        emp_sites = employee_site_map(db, scope.selected)
        for lid, eid in db.execute(select(Leave.id, Leave.employee_id).where(Leave.id.in_(by_type["leave"]))):
            sites[("leave", lid)] = emp_sites.get(eid)
    return [{
        "id": r.id, "owner_type": r.owner_type, "owner_id": r.owner_id, "label": r.label,
        "validity_status": r.validity_status, "verified_by": r.verified_by,
        "verified_at": r.verified_at.isoformat() if r.verified_at else None, "comment": r.comment,
        **scope.label(sites.get((r.owner_type, r.owner_id))),
    } for r in rows]


@router.post("/documents")
def upload_document(payload: DocumentUpload, request: Request, db: Session = Depends(get_db),
                     scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    if payload.owner_type not in {"leave", "attendance", "reclamation"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Type de dossier invalide")
    site_id, employee_id = document_owner_site(db, payload.owner_type, payload.owner_id, list(scope.sites))
    if site_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Dossier hors du périmètre de ce compte")
    site = scope.sites[site_id]
    url, saved = save_base64_document(payload.data_url, f"just_{payload.owner_type}_{payload.owner_id}_{datetime.utcnow().timestamp():.0f}")
    row = Document(owner_type=payload.owner_type, owner_id=payload.owner_id, label=payload.label,
                    file_path=url, uploaded_by=user.username, validity_status="en_attente")
    db.add(row)
    db.flush()
    _emit(db, site, notif_type="justificatif_recu", message=f"Justificatif reçu — {payload.label}", employee_id=employee_id)
    _emit(db, site, notif_type="justificatif_a_verifier", message=f"Justificatif à vérifier — {payload.label}", level="warn", employee_id=employee_id)
    _audit(db, request, user, site, action="document.upload", resource="document", resource_id=row.id, new_state={"label": payload.label, "saved_to_disk": saved})
    db.commit()
    return {"id": row.id, "file_path": row.file_path}


@router.post("/documents/{document_id}/verify")
def verify_document(document_id: int, payload: DocumentVerify, request: Request, db: Session = Depends(get_db),
                     scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    if payload.validity_status not in {"conforme", "non_conforme"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Statut invalide")
    _require_action(user, "validate")
    row = db.get(Document, document_id)
    site_id = document_owner_site(db, row.owner_type, row.owner_id, list(scope.sites))[0] if row else None
    if site_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document introuvable")
    old_state = {"validity_status": row.validity_status}
    # §B9 : ceci change UNIQUEMENT document_validity_status. absence_decision_status (table
    # daily_presence) n'est JAMAIS touché ici, même implicitement.
    row.validity_status = payload.validity_status
    row.verified_by = user.username
    row.verified_at = datetime.utcnow()
    row.comment = payload.comment
    _audit(db, request, user, scope.sites[site_id], action="document.verify", resource="document", resource_id=row.id, old_state=old_state, new_state={"validity_status": payload.validity_status})
    db.commit()
    return {"id": row.id, "validity_status": row.validity_status}


# ── Congés / Maladies (§11) ─────────────────────────────────────────────────────────────
@router.get("/leaves")
def leaves(leave_type: str | None = None, upcoming: bool = False, leave_status: str | None = None,
           employee_id: int | None = None, db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    emp_sites = employee_site_map(db, scope.selected)
    if not emp_sites:
        return []
    stmt = select(Leave).where(Leave.employee_id.in_(assigned_employees_subquery(scope.selected)))
    if leave_type:
        stmt = stmt.where(Leave.leave_type == leave_type)
    if upcoming:
        stmt = stmt.where(Leave.start_date >= date.today())
    if leave_status:
        stmt = stmt.where(Leave.status == leave_status)
    if employee_id is not None:
        stmt = stmt.where(Leave.employee_id == employee_id)
    rows = db.execute(stmt.order_by(Leave.start_date).limit(LIST_LIMIT)).scalars().all()
    names = _employee_names(db, (r.employee_id for r in rows))
    return [_with_employee({
        "id": r.id, "employee_id": r.employee_id, "leave_type": r.leave_type,
        "start_date": r.start_date.isoformat(), "end_date": r.end_date.isoformat(),
        "status": r.status, "reason": r.reason, **scope.label(emp_sites.get(r.employee_id)),
    }, names) for r in rows]


@router.post("/leaves")
def create_leave(payload: LeaveCreate, request: Request, db: Session = Depends(get_db),
                  scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    if payload.leave_type not in {"conge", "maladie"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Type de congé invalide")
    _, site = ensure_employee_in_scope(db, scope, payload.employee_id, site_id=payload.site_id)
    # §B11/§B16 : le chargé PRÉPARE la demande — validation reste exclusivement DRH, jamais
    # exposée par ce module (aucune route approve/refuse ici), quel que soit son périmètre.
    row = Leave(employee_id=payload.employee_id, leave_type=payload.leave_type, start_date=payload.start_date,
                end_date=payload.end_date, reason=payload.reason, status="instance")
    db.add(row)
    db.flush()
    if payload.leave_type == "maladie":
        _emit(db, site, notif_type="maladie", message=f"Déclaration maladie — employé #{payload.employee_id}", employee_id=payload.employee_id)
    else:
        _emit(db, site, notif_type="depart_conge", message=f"Demande de congé — employé #{payload.employee_id}", employee_id=payload.employee_id)
    _audit(db, request, user, site, action="leave.create", resource="leave", resource_id=row.id, new_state={"leave_type": payload.leave_type})
    db.commit()
    return {"id": row.id, "status": row.status, "site_id": site.id}


# ── Discipline (§12, réutilise ops.Incident) ────────────────────────────────────────────
@router.get("/discipline")
def discipline(db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    rows = db.execute(select(Incident).where(Incident.site_id.in_(scope.selected)).order_by(Incident.id.desc()).limit(LIST_LIMIT)).scalars().all()
    names = _employee_names(db, (r.employee_id for r in rows))
    return [_with_employee({
        "id": r.id, "employee_id": r.employee_id, "event_type": r.event_type, "category": r.category,
        "severity": r.severity, "subject": r.subject, "status": r.status,
        "incident_date": r.incident_date.isoformat() if r.incident_date else None, **scope.label(r.site_id),
    }, names) for r in rows]


@router.post("/discipline")
def create_incident(payload: IncidentCreate, request: Request, db: Session = Depends(get_db),
                     scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    if payload.employee_id is not None:
        _, site = ensure_employee_in_scope(db, scope, payload.employee_id, site_id=payload.site_id)
    elif payload.site_id is not None:
        if payload.site_id not in scope.sites:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Site hors du périmètre de ce compte")
        site = scope.sites[payload.site_id]
    elif len(scope.selected) == 1:
        site = scope.sites[scope.selected[0]]
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Préciser le site de l'incident")
    row = Incident(
        site_id=site.id, employee_id=payload.employee_id, event_type=payload.event_type,
        category=payload.category, severity=payload.severity, subject=payload.subject,
        description=payload.description, incident_date=payload.incident_date or date.today(),
        # Brouillon -> Signalé -> Transmis -> En cours DRH -> Décision -> Clôturé (§B13).
        # Cette route ne va jamais au-delà de "signale" : le chargé ne peut pas prononcer de
        # sanction hors de ses droits — cette route ne l'expose tout simplement pas.
        status="brouillon",
    )
    db.add(row)
    db.flush()
    _audit(db, request, user, site, action="discipline.create", resource="incident", resource_id=row.id, new_state={"status": row.status})
    db.commit()
    return {"id": row.id, "status": row.status, "site_id": site.id}


@router.post("/discipline/{incident_id}/signaler")
def signaler_incident(incident_id: int, request: Request, db: Session = Depends(get_db),
                       scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    row = db.get(Incident, incident_id)
    if not row or row.site_id not in scope.sites:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Incident introuvable")
    if row.status != "brouillon":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Incident déjà signalé")
    site = scope.sites[row.site_id]
    old_state = {"status": row.status}
    row.status = "signale"
    _emit(db, site, notif_type="discipline", message=f"Incident signalé — {row.subject}", level="warn", employee_id=row.employee_id)
    _audit(db, request, user, site, action="discipline.signaler", resource="incident", resource_id=row.id, old_state=old_state, new_state={"status": row.status})
    db.commit()
    return {"id": row.id, "status": row.status}


# ── Réclamations (§12) ──────────────────────────────────────────────────────────────────
@router.get("/reclamations")
def reclamations(db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    rows = db.execute(select(Reclamation).where(Reclamation.site_id.in_(scope.selected)).order_by(Reclamation.id.desc()).limit(LIST_LIMIT)).scalars().all()
    names = _employee_names(db, (r.employee_id for r in rows))
    return [_with_employee({
        "id": r.id, "employee_id": r.employee_id, "subject": r.subject, "status": r.status,
        "priority": r.priority, "response": r.response, **scope.label(r.site_id),
    }, names) for r in rows]


@router.post("/reclamations")
def create_reclamation(payload: ReclamationCreate, request: Request, db: Session = Depends(get_db),
                        scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    _, site = ensure_employee_in_scope(db, scope, payload.employee_id, site_id=payload.site_id)
    row = Reclamation(employee_id=payload.employee_id, site_id=site.id, category=payload.category,
                       subject=payload.subject, description=payload.description, priority=payload.priority,
                       created_by=user.username)
    db.add(row)
    db.flush()
    _emit(db, site, notif_type="reclamation", message=f"Nouvelle réclamation — {payload.subject}", employee_id=payload.employee_id)
    _audit(db, request, user, site, action="reclamation.create", resource="reclamation", resource_id=row.id, new_state={"subject": payload.subject})
    db.commit()
    return {"id": row.id, "status": row.status, "site_id": site.id}


@router.post("/reclamations/{reclamation_id}/respond")
def respond_reclamation(reclamation_id: int, payload: ReclamationRespond, request: Request, db: Session = Depends(get_db),
                         scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    row = db.get(Reclamation, reclamation_id)
    if not row or row.site_id not in scope.sites:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Réclamation introuvable")
    old_state = {"status": row.status}
    row.response = payload.response
    row.responded_by = user.username
    row.responded_at = datetime.utcnow()
    row.status = "reponse_recue"
    _audit(db, request, user, scope.sites[row.site_id], action="reclamation.respond", resource="reclamation", resource_id=row.id, old_state=old_state, new_state={"status": row.status})
    db.commit()
    return {"id": row.id, "status": row.status}


# ── Transmission (§13) : réutilise le dossier source, ne le duplique jamais ─────────────
@router.get("/transmissions")
def transmissions(resource_type: str | None = None, resource_id: int | None = None,
                   db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    stmt = select(Transmission).where(Transmission.site_id.in_(scope.selected))
    if resource_type:
        stmt = stmt.where(Transmission.resource_type == resource_type)
    if resource_id is not None:
        stmt = stmt.where(Transmission.resource_id == resource_id)
    rows = db.execute(stmt.order_by(Transmission.id.desc()).limit(LIST_LIMIT)).scalars().all()
    return [{
        "id": r.id, "resource_type": r.resource_type, "resource_id": r.resource_id,
        "destinataire": r.destinataire, "objet": r.objet, "priority": r.priority, "status": r.status,
        "source": r.source, "created_by": r.created_by, **scope.label(r.site_id),
    } for r in rows]


@router.post("/transmissions")
def create_transmission(payload: TransmissionCreate, request: Request, db: Session = Depends(get_db),
                         scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    if payload.resource_type not in {"incident", "reclamation"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Type de ressource invalide")
    if payload.destinataire not in {"drh", "ops", "direction"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Destinataire invalide")
    # TROUVÉ EN REVUE FINALE D'INTÉGRATION (§16, double-submit) : un double POST identique
    # créait deux Transmission pour le même dossier. Garde d'état AVANT création (même patron
    # que signaler_incident) : une fois transmis, le statut du dossier source l'atteste déjà.
    if payload.resource_type == "incident":
        source = db.get(Incident, payload.resource_id)
        if not source or source.site_id not in scope.sites:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Dossier introuvable")
        if source.status not in {"brouillon", "signale"}:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Incident déjà transmis")
        source.status = "transmis"
    else:
        source = db.get(Reclamation, payload.resource_id)
        if not source or source.site_id not in scope.sites:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Dossier introuvable")
        if source.status not in {"nouvelle", "en_cours"}:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Réclamation déjà transmise")
        source.status = "transmise"
    # Contexte conservé : site (donc société) du dossier SOURCE, jamais celui de la vue.
    site = scope.sites[source.site_id]
    row = Transmission(resource_type=payload.resource_type, resource_id=payload.resource_id, site_id=site.id,
                        destinataire=payload.destinataire, objet=payload.objet, commentaire=payload.commentaire,
                        priority=payload.priority, source="site_workforce", created_by=user.username)
    db.add(row)
    db.flush()
    _audit(db, request, user, site, action="transmission.create", resource="transmission", resource_id=row.id,
           new_state={"resource_type": payload.resource_type, "resource_id": payload.resource_id, "destinataire": payload.destinataire})
    db.commit()
    return {"id": row.id, "status": row.status, "site_id": site.id}


# ── Notifications (§14) ─────────────────────────────────────────────────────────────────
@router.get("/notifications")
def notifications(status_filter: str | None = None, db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    stmt = select(SiteNotification).where(SiteNotification.site_id.in_(scope.selected))
    if status_filter:
        stmt = stmt.where(SiteNotification.status == status_filter)
    rows = db.execute(stmt.order_by(SiteNotification.id.desc()).limit(100)).scalars().all()
    return [{
        "id": r.id, "notif_type": r.notif_type, "message": r.message, "level": r.level,
        "status": r.status, "employee_id": r.employee_id, "created_at": r.created_at.isoformat(),
        **scope.label(r.site_id),
    } for r in rows]


@router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: int, db: Session = Depends(get_db),
                       scope: BeoScope = Depends(resolve_scope), user: User = Depends(current_user)):
    row = db.get(SiteNotification, notification_id)
    if not row or row.site_id not in scope.sites:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Notification introuvable")
    row.status = "lue"
    row.read_at = datetime.utcnow()
    row.read_by = user.username
    db.commit()
    return {"id": row.id, "status": row.status}


# ── Audit (§B18) — lecture seule, réutilise AuditEvent existant ────────────────────────
@router.get("/audit")
def audit(db: Session = Depends(get_db), scope: BeoScope = Depends(resolve_scope)):
    from app.modules.auth.models import AuditEvent
    rows = db.execute(select(AuditEvent).where(
        AuditEvent.resource.like("site_workforce.%"),
        or_(*(AuditEvent.resource_id.like(f"{sid}:%") for sid in scope.selected)),
    ).order_by(AuditEvent.id.desc()).limit(200)).scalars().all()
    return [{
        "id": r.id, "created_at": r.created_at.isoformat(), "username": r.username, "action": r.action,
        "resource": r.resource, "resource_id": r.resource_id, "result": r.result,
        "old_state": r.old_state, "new_state": r.new_state,
    } for r in rows]
