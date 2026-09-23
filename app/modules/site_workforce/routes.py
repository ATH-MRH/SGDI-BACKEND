"""ATLAS Site Workforce — routes du portail "Chargé des effectifs — Site".

Toutes les routes exigent `resolve_scoped_site` (§security.py) : le site n'est JAMAIS un
paramètre client, il est résolu depuis le compte. Toute action sensible passe par
`append_audit` (§B18, réutilise le mécanisme existant, jamais une nouvelle table d'audit).
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.pagination import paginate_list
from app.core.photo_storage import save_base64_document
from app.db.session import get_db
from app.modules.auth.dependencies import AUTHORIZED_ACTIONS, current_user, request_action
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
from app.modules.site_workforce.security import ensure_employee_in_site, resolve_scoped_site, site_employee_ids

router = APIRouter(dependencies=[Depends(current_user)])

ATTENDANCE_STATUSES = {"present", "absent", "conge", "maladie", "repos", "mission"}


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
    from app.modules.site_workforce.security import _site_society
    append_audit(
        db, action=f"site_workforce.{action}", resource=f"site_workforce.{resource}",
        resource_id=f"{site.id}:{resource_id}", society=_site_society(site), result="success",
        user=user, request=request, old_state=old_state, new_state=new_state,
    )


# ── Dashboard (§B6) ──────────────────────────────────────────────────────────────────────
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    employee_ids = site_employee_ids(db, site.id)
    today = date.today()
    presences = {
        row.employee_id: row
        for row in db.execute(select(DailyPresence).where(
            DailyPresence.site_id == site.id, DailyPresence.presence_date == today,
        )).scalars()
    }
    presents = sum(1 for row in presences.values() if row.status == "present")
    absents_rows = [row for row in presences.values() if row.status == "absent"]
    leaves_today = db.execute(select(Leave).where(
        Leave.employee_id.in_(employee_ids or [-1]), Leave.status == "approuve",
        Leave.start_date <= today, Leave.end_date >= today,
    )).scalars().all() if employee_ids else []
    en_conge = sum(1 for row in leaves_today if row.leave_type == "conge")
    en_maladie = sum(1 for row in leaves_today if row.leave_type == "maladie")

    absences_a_traiter = sum(1 for row in absents_rows if not isinstance(row.data, dict) or row.data.get("absence_decision_status", "en_attente") == "en_attente")
    justificatifs_en_attente = db.execute(select(Document).where(
        Document.owner_type.in_(["attendance", "leave"]), Document.validity_status == "en_attente",
    )).scalars().all()
    # owner_id de Document est polymorphe : filtré après coup au périmètre du site (jamais
    # de fuite d'un document d'un autre site dans ce compte).
    site_presence_ids = {row.id for row in db.execute(select(DailyPresence).where(DailyPresence.site_id == site.id)).scalars()}
    site_leave_ids = {row.id for row in db.execute(select(Leave).where(Leave.employee_id.in_(employee_ids or [-1]))).scalars()} if employee_ids else set()
    justificatifs_en_attente_count = sum(
        1 for doc in justificatifs_en_attente
        if (doc.owner_type == "attendance" and doc.owner_id in site_presence_ids)
        or (doc.owner_type == "leave" and doc.owner_id in site_leave_ids)
    )
    prochains_conges = sorted(
        [row for row in leaves_today or db.execute(select(Leave).where(
            Leave.employee_id.in_(employee_ids or [-1]), Leave.status == "approuve", Leave.start_date >= today,
        )).scalars().all()],
        key=lambda row: row.start_date,
    )[:5]
    incidents_ouverts = db.execute(select(Incident).where(Incident.site_id == site.id, Incident.status != "cloture")).scalars().all()

    return {
        "site": {"id": site.id, "name": site.name, "indicatif": site.indicatif},
        "kpi": {
            "effectif_total": len(employee_ids),
            "presents_aujourdhui": presents,
            "absents": len(absents_rows),
            "en_conge": en_conge,
            "en_maladie": en_maladie,
        },
        "actions_rapides": {
            "absences_a_traiter": absences_a_traiter,
            "justificatifs_en_attente": justificatifs_en_attente_count,
            "prochains_conges": [{"employee_id": r.employee_id, "start_date": r.start_date.isoformat(), "end_date": r.end_date.isoformat(), "leave_type": r.leave_type} for r in prochains_conges],
            "incidents_discipline": len(incidents_ouverts),
        },
    }


# ── Personnel (§B15) ─────────────────────────────────────────────────────────────────────
@router.get("/employees")
def employees(q: str | None = None, page: int = 1, page_size: int = 25,
              db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    ids = site_employee_ids(db, site.id)
    if not ids:
        return paginate_list([], page=page, page_size=page_size)
    rows = db.execute(select(Employee).where(Employee.id.in_(ids)).order_by(Employee.last_name, Employee.first_name)).scalars().all()
    if q:
        needle = q.casefold().strip()
        rows = [r for r in rows if needle in " ".join([r.code, r.first_name, r.last_name, r.position or ""]).casefold()]
    assignments = {
        a.employee_id: a for a in db.execute(select(Assignment).where(
            Assignment.site_id == site.id, Assignment.employee_id.in_(ids), Assignment.active == 1,
        )).scalars()
    }
    today = date.today()
    presences = {
        p.employee_id: p for p in db.execute(select(DailyPresence).where(
            DailyPresence.site_id == site.id, DailyPresence.presence_date == today,
        )).scalars()
    }
    # Périmètre strict (§B15) : jamais salaire/RIB/paie/IRG/CNAS/données privées non
    # nécessaires — uniquement ce qu'un chargé d'effectifs terrain a besoin de voir.
    out = [{
        "id": r.id, "code": r.code, "first_name": r.first_name, "last_name": r.last_name,
        "position": r.position, "group_code": assignments[r.id].group_code if r.id in assignments else None,
        "presence_status": presences[r.id].status if r.id in presences else "non_pointe",
    } for r in rows]
    return paginate_list(out, page=page, page_size=page_size)


# ── Pointage (§B8) ───────────────────────────────────────────────────────────────────────
@router.get("/attendance")
def attendance(presence_date: date, db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    ids = site_employee_ids(db, site.id, as_of=presence_date)
    rows = {r.employee_id: r for r in db.execute(select(DailyPresence).where(
        DailyPresence.site_id == site.id, DailyPresence.presence_date == presence_date,
    )).scalars()} if ids else {}
    entries = [{
        "employee_id": eid,
        "status": rows[eid].status if eid in rows else "non_pointe",
        "arrival_time": rows[eid].arrival_time if eid in rows else None,
        "closed_at": rows[eid].closed_at.isoformat() if eid in rows and rows[eid].closed_at else None,
        "id": rows[eid].id if eid in rows else None,
    } for eid in ids]
    pointed = sum(1 for e in entries if e["status"] != "non_pointe")
    return {"date": presence_date.isoformat(), "progress": {"pointed": pointed, "total": len(entries)}, "entries": entries}


@router.post("/attendance")
def upsert_attendance(payload: AttendanceUpsert, request: Request, db: Session = Depends(get_db),
                       site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    if payload.status not in ATTENDANCE_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Statut de pointage invalide")
    ensure_employee_in_site(db, site.id, payload.employee_id)
    existing = db.execute(select(DailyPresence).where(
        DailyPresence.site_id == site.id, DailyPresence.employee_id == payload.employee_id,
        DailyPresence.presence_date == payload.presence_date,
    )).scalars().first()
    if existing and existing.closed_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Journée clôturée — utiliser la correction post-clôture")
    old_state = {"status": existing.status} if existing else None
    if existing:
        existing.status = payload.status
        existing.arrival_time = payload.arrival_time
        existing.departure_time = payload.departure_time
        existing.notes = payload.notes
        row = existing
    else:
        row = DailyPresence(
            presence_date=payload.presence_date, employee_id=payload.employee_id, site_id=site.id,
            status=payload.status, arrival_time=payload.arrival_time, departure_time=payload.departure_time,
            notes=payload.notes, generated=0,
        )
        db.add(row)
    db.flush()
    if payload.status == "absent" and (not old_state or old_state.get("status") != "absent"):
        _emit(db, site, notif_type="absence_sans_justificatif", message=f"Absence non justifiée — employé #{payload.employee_id}", level="warn", employee_id=payload.employee_id)
    _audit(db, request, user, site, action="attendance.upsert", resource="attendance", resource_id=row.id, old_state=old_state, new_state={"status": payload.status})
    db.commit()
    return {"id": row.id, "status": row.status}


@router.post("/attendance/close")
def close_attendance(presence_date: date, request: Request, db: Session = Depends(get_db),
                      site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    _require_action(user, "validate")
    ids = site_employee_ids(db, site.id, as_of=presence_date)
    rows = db.execute(select(DailyPresence).where(
        DailyPresence.site_id == site.id, DailyPresence.presence_date == presence_date,
    )).scalars().all()
    pointed_ids = {r.employee_id for r in rows}
    missing = [eid for eid in ids if eid not in pointed_ids]
    now = datetime.utcnow()
    for row in rows:
        if row.closed_at is None:
            row.closed_at = now
    if missing:
        _emit(db, site, notif_type="pointage_incomplet", message=f"{len(missing)} employé(s) non pointé(s) le {presence_date.isoformat()}", level="warn")
    _audit(db, request, user, site, action="attendance.close", resource="attendance_day", resource_id=0, new_state={"date": presence_date.isoformat(), "missing": len(missing)})
    db.commit()
    return {"closed": len(rows), "missing": len(missing)}


@router.post("/attendance/{presence_id}/correct")
def correct_attendance(presence_id: int, payload: AttendanceCorrection, request: Request, db: Session = Depends(get_db),
                        site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    _require_action(user, "validate")
    if payload.status not in ATTENDANCE_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Statut de pointage invalide")
    row = db.get(DailyPresence, presence_id)
    if not row or row.site_id != site.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pointage introuvable")
    old_state = {"status": row.status, "notes": row.notes}
    row.status = payload.status
    row.notes = payload.notes
    _audit(db, request, user, site, action="attendance.correct", resource="attendance", resource_id=row.id,
           old_state=old_state, new_state={"status": payload.status, "reason": payload.reason})
    db.commit()
    return {"id": row.id, "status": row.status}


# ── Absences (§B9) ───────────────────────────────────────────────────────────────────────
@router.get("/absences")
def absences(decision_status: str | None = None, db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    rows = db.execute(select(DailyPresence).where(DailyPresence.site_id == site.id, DailyPresence.status == "absent")).scalars().all()
    out = []
    for row in rows:
        current = row.data.get("absence_decision_status", "en_attente") if isinstance(row.data, dict) else "en_attente"
        if decision_status and current != decision_status:
            continue
        out.append({
            "id": row.id, "employee_id": row.employee_id, "presence_date": row.presence_date.isoformat(),
            "absence_decision_status": current,
        })
    return out


@router.post("/absences/{presence_id}/decision")
def decide_absence(presence_id: int, payload: AbsenceDecision, request: Request, db: Session = Depends(get_db),
                    site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    if payload.decision not in {"justifiee", "injustifiee"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Décision invalide")
    row = db.get(DailyPresence, presence_id)
    if not row or row.site_id != site.id or row.status != "absent":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Absence introuvable")
    _require_action(user, "validate")
    old_state = dict(row.data) if isinstance(row.data, dict) else {}
    # Décision explicite et séparée — JAMAIS déduite d'un validity_status de document
    # (§B9) : même si un justificatif "conforme" existe, cette route reste le seul chemin.
    row.data = {**old_state, "absence_decision_status": payload.decision, "absence_decision_by": user.username, "absence_decision_at": datetime.utcnow().isoformat(), "absence_decision_comment": payload.comment}
    _audit(db, request, user, site, action="absence.decision", resource="attendance", resource_id=row.id, old_state=old_state, new_state=row.data)
    db.commit()
    return {"id": row.id, "absence_decision_status": payload.decision}


# ── Justificatifs / documents (§B10) ────────────────────────────────────────────────────
# TROUVÉ EN REVUE DE SÉCURITÉ INDÉPENDANTE (§B22) : la version précédente chargeait TOUS les
# Document de type leave/attendance/reclamation de TOUTE LA BASE (table réellement partagée
# entre modules — photos employé, pièces jointes portail client, etc. — jamais scopée par
# site elle-même), puis appelait _document_in_scope() PAR LIGNE, chacune exécutant un
# db.get() supplémentaire — un N+1 réel, et une requête SQL qui ne filtrait rien par site
# avant le filtrage Python (jamais une fuite constatée — le filtre Python était correct —
# mais une seconde ligne de défense manquante et un passage à l'échelle qui se dégraderait
# avec le volume total de documents du système, pas seulement ceux de ce site). Corrigé :
# les ensembles d'ids autorisés sont calculés UNE SEULE FOIS (3 requêtes), puis une SEULE
# requête Document filtre directement dessus — scopée dès le SQL, aucun N+1.
def _scoped_document_owner_ids(db: Session, site: Site, employee_ids: list[int]) -> dict[str, set[int]]:
    presence_ids = set(db.scalars(select(DailyPresence.id).where(DailyPresence.site_id == site.id)))
    leave_ids = set(db.scalars(select(Leave.id).where(Leave.employee_id.in_(employee_ids or [-1])))) if employee_ids else set()
    reclamation_ids = set(db.scalars(select(Reclamation.id).where(Reclamation.site_id == site.id)))
    return {"attendance": presence_ids, "leave": leave_ids, "reclamation": reclamation_ids}


@router.get("/documents")
def documents(owner_type: str | None = None, owner_id: int | None = None,
              db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    ids = site_employee_ids(db, site.id)
    scoped = _scoped_document_owner_ids(db, site, ids)
    clauses = [and_(Document.owner_type == t, Document.owner_id.in_(owner_ids or [-1])) for t, owner_ids in scoped.items()]
    stmt = select(Document).where(or_(*clauses))
    if owner_type:
        stmt = stmt.where(Document.owner_type == owner_type)
    if owner_id is not None:
        stmt = stmt.where(Document.owner_id == owner_id)
    rows = db.execute(stmt).scalars().all()
    return [{
        "id": r.id, "owner_type": r.owner_type, "owner_id": r.owner_id, "label": r.label,
        "validity_status": r.validity_status, "verified_by": r.verified_by,
        "verified_at": r.verified_at.isoformat() if r.verified_at else None, "comment": r.comment,
    } for r in rows]


@router.post("/documents")
def upload_document(payload: DocumentUpload, request: Request, db: Session = Depends(get_db),
                     site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    if payload.owner_type not in {"leave", "attendance", "reclamation"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Type de dossier invalide")
    ids = site_employee_ids(db, site.id)
    scoped = _scoped_document_owner_ids(db, site, ids)
    if payload.owner_id not in scoped[payload.owner_type]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Dossier hors du périmètre de ce site")
    url, saved = save_base64_document(payload.data_url, f"just_{payload.owner_type}_{payload.owner_id}_{datetime.utcnow().timestamp():.0f}")
    row = Document(owner_type=payload.owner_type, owner_id=payload.owner_id, label=payload.label,
                    file_path=url, uploaded_by=user.username, validity_status="en_attente")
    db.add(row)
    db.flush()
    employee_id = None
    if payload.owner_type == "attendance":
        presence = db.get(DailyPresence, payload.owner_id)
        employee_id = presence.employee_id if presence else None
    elif payload.owner_type == "leave":
        leave = db.get(Leave, payload.owner_id)
        employee_id = leave.employee_id if leave else None
    _emit(db, site, notif_type="justificatif_recu", message=f"Justificatif reçu — {payload.label}", employee_id=employee_id)
    _emit(db, site, notif_type="justificatif_a_verifier", message=f"Justificatif à vérifier — {payload.label}", level="warn", employee_id=employee_id)
    _audit(db, request, user, site, action="document.upload", resource="document", resource_id=row.id, new_state={"label": payload.label, "saved_to_disk": saved})
    db.commit()
    return {"id": row.id, "file_path": row.file_path}


@router.post("/documents/{document_id}/verify")
def verify_document(document_id: int, payload: DocumentVerify, request: Request, db: Session = Depends(get_db),
                     site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    if payload.validity_status not in {"conforme", "non_conforme"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Statut invalide")
    _require_action(user, "validate")
    row = db.get(Document, document_id)
    ids = site_employee_ids(db, site.id)
    scoped = _scoped_document_owner_ids(db, site, ids)
    if not row or row.owner_type not in scoped or row.owner_id not in scoped[row.owner_type]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document introuvable")
    old_state = {"validity_status": row.validity_status}
    # §B9 : ceci change UNIQUEMENT document_validity_status. absence_decision_status (table
    # daily_presence) n'est JAMAIS touché ici, même implicitement.
    row.validity_status = payload.validity_status
    row.verified_by = user.username
    row.verified_at = datetime.utcnow()
    row.comment = payload.comment
    _audit(db, request, user, site, action="document.verify", resource="document", resource_id=row.id, old_state=old_state, new_state={"validity_status": payload.validity_status})
    db.commit()
    return {"id": row.id, "validity_status": row.validity_status}


# ── Congés / Maladies (§B11/§B12) ───────────────────────────────────────────────────────
@router.get("/leaves")
def leaves(leave_type: str | None = None, upcoming: bool = False,
           db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    ids = site_employee_ids(db, site.id)
    if not ids:
        return []
    stmt = select(Leave).where(Leave.employee_id.in_(ids))
    if leave_type:
        stmt = stmt.where(Leave.leave_type == leave_type)
    if upcoming:
        stmt = stmt.where(Leave.start_date >= date.today())
    rows = db.execute(stmt.order_by(Leave.start_date)).scalars().all()
    return [{
        "id": r.id, "employee_id": r.employee_id, "leave_type": r.leave_type,
        "start_date": r.start_date.isoformat(), "end_date": r.end_date.isoformat(),
        "status": r.status, "reason": r.reason,
    } for r in rows]


@router.post("/leaves")
def create_leave(payload: LeaveCreate, request: Request, db: Session = Depends(get_db),
                  site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    if payload.leave_type not in {"conge", "maladie"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Type de congé invalide")
    ensure_employee_in_site(db, site.id, payload.employee_id)
    # §B11/§B16 : le chargé PRÉPARE la demande — validation reste exclusivement DRH, jamais
    # exposée par ce module (aucune route approve/refuse ici).
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
    return {"id": row.id, "status": row.status}


# ── Discipline (§B13, réutilise ops.Incident) ───────────────────────────────────────────
@router.get("/discipline")
def discipline(db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    rows = db.execute(select(Incident).where(Incident.site_id == site.id).order_by(Incident.id.desc())).scalars().all()
    return [{
        "id": r.id, "employee_id": r.employee_id, "event_type": r.event_type, "category": r.category,
        "severity": r.severity, "subject": r.subject, "status": r.status,
        "incident_date": r.incident_date.isoformat() if r.incident_date else None,
    } for r in rows]


@router.post("/discipline")
def create_incident(payload: IncidentCreate, request: Request, db: Session = Depends(get_db),
                     site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    if payload.employee_id is not None:
        ensure_employee_in_site(db, site.id, payload.employee_id)
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
    return {"id": row.id, "status": row.status}


@router.post("/discipline/{incident_id}/signaler")
def signaler_incident(incident_id: int, request: Request, db: Session = Depends(get_db),
                       site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    row = db.get(Incident, incident_id)
    if not row or row.site_id != site.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Incident introuvable")
    if row.status != "brouillon":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Incident déjà signalé")
    old_state = {"status": row.status}
    row.status = "signale"
    _emit(db, site, notif_type="discipline", message=f"Incident signalé — {row.subject}", level="warn", employee_id=row.employee_id)
    _audit(db, request, user, site, action="discipline.signaler", resource="incident", resource_id=row.id, old_state=old_state, new_state={"status": row.status})
    db.commit()
    return {"id": row.id, "status": row.status}


# ── Réclamations (§B14) ─────────────────────────────────────────────────────────────────
@router.get("/reclamations")
def reclamations(db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    rows = db.execute(select(Reclamation).where(Reclamation.site_id == site.id).order_by(Reclamation.id.desc())).scalars().all()
    return [{
        "id": r.id, "employee_id": r.employee_id, "subject": r.subject, "status": r.status,
        "priority": r.priority, "response": r.response,
    } for r in rows]


@router.post("/reclamations")
def create_reclamation(payload: ReclamationCreate, request: Request, db: Session = Depends(get_db),
                        site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    ensure_employee_in_site(db, site.id, payload.employee_id)
    row = Reclamation(employee_id=payload.employee_id, site_id=site.id, category=payload.category,
                       subject=payload.subject, description=payload.description, priority=payload.priority,
                       created_by=user.username)
    db.add(row)
    db.flush()
    _emit(db, site, notif_type="reclamation", message=f"Nouvelle réclamation — {payload.subject}", employee_id=payload.employee_id)
    _audit(db, request, user, site, action="reclamation.create", resource="reclamation", resource_id=row.id, new_state={"subject": payload.subject})
    db.commit()
    return {"id": row.id, "status": row.status}


@router.post("/reclamations/{reclamation_id}/respond")
def respond_reclamation(reclamation_id: int, payload: ReclamationRespond, request: Request, db: Session = Depends(get_db),
                         site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    row = db.get(Reclamation, reclamation_id)
    if not row or row.site_id != site.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Réclamation introuvable")
    old_state = {"status": row.status}
    row.response = payload.response
    row.responded_by = user.username
    row.responded_at = datetime.utcnow()
    row.status = "reponse_recue"
    _audit(db, request, user, site, action="reclamation.respond", resource="reclamation", resource_id=row.id, old_state=old_state, new_state={"status": row.status})
    db.commit()
    return {"id": row.id, "status": row.status}


# ── Transmission (§B16) : réutilise le dossier source, ne le duplique jamais ────────────
@router.get("/transmissions")
def transmissions(resource_type: str | None = None, resource_id: int | None = None,
                   db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    stmt = select(Transmission).where(Transmission.site_id == site.id)
    if resource_type:
        stmt = stmt.where(Transmission.resource_type == resource_type)
    if resource_id is not None:
        stmt = stmt.where(Transmission.resource_id == resource_id)
    rows = db.execute(stmt.order_by(Transmission.id.desc())).scalars().all()
    return [{
        "id": r.id, "resource_type": r.resource_type, "resource_id": r.resource_id,
        "destinataire": r.destinataire, "objet": r.objet, "priority": r.priority, "status": r.status,
    } for r in rows]


@router.post("/transmissions")
def create_transmission(payload: TransmissionCreate, request: Request, db: Session = Depends(get_db),
                         site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    if payload.resource_type not in {"incident", "reclamation"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Type de ressource invalide")
    if payload.destinataire not in {"drh", "ops", "direction"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Destinataire invalide")
    # TROUVÉ EN REVUE FINALE D'INTÉGRATION (§16, double-submit) : rejoué et démontré — un
    # double POST identique (double-clic réel) créait deux Transmission pour le même
    # dossier, donc une DRH avertie/saisie deux fois du même incident. Corrigé par une
    # vérification d'état AVANT création, même patron déjà établi par signaler_incident()
    # (if row.status != "brouillon": 409) — pas un nouveau mécanisme, la même garde
    # appliquée ici : une fois transmis, le statut du dossier source l'atteste déjà.
    if payload.resource_type == "incident":
        source = db.get(Incident, payload.resource_id)
        if not source or source.site_id != site.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Dossier introuvable")
        if source.status not in {"brouillon", "signale"}:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Incident déjà transmis")
        source.status = "transmis"
    else:
        source = db.get(Reclamation, payload.resource_id)
        if not source or source.site_id != site.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Dossier introuvable")
        if source.status not in {"nouvelle", "en_cours"}:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Réclamation déjà transmise")
        source.status = "transmise"
    row = Transmission(resource_type=payload.resource_type, resource_id=payload.resource_id, site_id=site.id,
                        destinataire=payload.destinataire, objet=payload.objet, commentaire=payload.commentaire,
                        priority=payload.priority, source="site_workforce", created_by=user.username)
    db.add(row)
    db.flush()
    _audit(db, request, user, site, action="transmission.create", resource="transmission", resource_id=row.id,
           new_state={"resource_type": payload.resource_type, "resource_id": payload.resource_id, "destinataire": payload.destinataire})
    db.commit()
    return {"id": row.id, "status": row.status}


# ── Notifications (§B17) ────────────────────────────────────────────────────────────────
@router.get("/notifications")
def notifications(status_filter: str | None = None, db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    stmt = select(SiteNotification).where(SiteNotification.site_id == site.id)
    if status_filter:
        stmt = stmt.where(SiteNotification.status == status_filter)
    rows = db.execute(stmt.order_by(SiteNotification.id.desc()).limit(100)).scalars().all()
    return [{
        "id": r.id, "notif_type": r.notif_type, "message": r.message, "level": r.level,
        "status": r.status, "employee_id": r.employee_id, "created_at": r.created_at.isoformat(),
    } for r in rows]


@router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: int, db: Session = Depends(get_db),
                       site: Site = Depends(resolve_scoped_site), user: User = Depends(current_user)):
    row = db.get(SiteNotification, notification_id)
    if not row or row.site_id != site.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Notification introuvable")
    row.status = "lue"
    row.read_at = datetime.utcnow()
    row.read_by = user.username
    db.commit()
    return {"id": row.id, "status": row.status}


# ── Audit (§B18) — lecture seule, réutilise AuditEvent existant ────────────────────────
@router.get("/audit")
def audit(db: Session = Depends(get_db), site: Site = Depends(resolve_scoped_site)):
    from app.modules.auth.models import AuditEvent
    rows = db.execute(select(AuditEvent).where(
        AuditEvent.resource.like("site_workforce.%"),
        AuditEvent.resource_id.like(f"{site.id}:%"),
    ).order_by(AuditEvent.id.desc()).limit(200)).scalars().all()
    return [{
        "id": r.id, "created_at": r.created_at.isoformat(), "username": r.username, "action": r.action,
        "resource": r.resource, "resource_id": r.resource_id, "result": r.result,
        "old_state": r.old_state, "new_state": r.new_state,
    } for r in rows]
