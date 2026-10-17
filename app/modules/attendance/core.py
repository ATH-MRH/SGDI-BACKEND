"""Attendance Core — seul point d'écriture de la présence.

Toutes les sources (pointeur QR / saisie manuelle, portail GPS, Site Workforce, reconnaissance
faciale, import) appellent ce module ; aucune n'écrit `DailyPresence` elle-même. La journée
reste `DailyPresence` (seule lue par la paie) ; `upsert_presence` en reste la couche de
persistance pour garder intacte la forme « legacy » lue par les écrans existants.

Règles de bascule arrivée/départ reprises à l'identique de l'ancien
portal/routes.py::_register_attendance (cycle ouvert borné, délai avant nouvelle arrivée),
complétées par :
- idempotence en base (source + clé unique) ;
- verrou par employé (deux scans parallèles ne produisent jamais deux arrivées) ;
- anti-rebond (settings.attendance_min_event_gap_seconds) ;
- refus d'écrire sur une journée clôturée (la paie l'a peut-être déjà consommée) ;
- anomalies et audit.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.config import settings
from app.modules.attendance.models import (
    ANOMALY_OPEN,
    EVENT_ARRIVAL,
    EVENT_DEPARTURE,
    SOURCE_MANUAL,
    AttendanceAnomaly,
    AttendanceEvent,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, RotationTemplate, Site, SiteRotation

TZ_NAME = "Africa/Algiers"
TZ = ZoneInfo(TZ_NAME)
NEW_ARRIVAL_DELAY = timedelta(hours=8)
# Un cycle non fermé ne reste pas actif indéfiniment : la limite standard couvre les postes de
# nuit ; les sites en rotation 24 h ont une fenêtre plus large pour que le départ du lendemain
# ferme bien leur arrivée.
OPEN_CYCLE_MAX = timedelta(hours=16)
OPEN_24H_CYCLE_MAX = timedelta(hours=30)

LEGACY_ACTION = {EVENT_ARRIVAL: "arrivee", EVENT_DEPARTURE: "depart"}


def open_cycle_window(site: Site | None) -> timedelta:
    """Durée pendant laquelle une ARRIVÉE reste un cycle ouvert (présence en cours) : même règle
    pour la décision ENTRÉE/SORTIE et pour l'état « présent » affiché (traverse minuit)."""
    rotation = str(getattr(site, "rotation_system", "") or "") if site else ""
    return OPEN_24H_CYCLE_MAX if "24" in rotation else OPEN_CYCLE_MAX


# ── Temps ────────────────────────────────────────────────────────────────────────────────
def to_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=TZ)
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def to_local(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc).astimezone(TZ)


def _now_local() -> datetime:
    return datetime.now(TZ)


def operational_clock(now: datetime | None = None) -> dict[str, Any]:
    """Temps MÉTIER, source unique des écrans (horloge, date opérationnelle, mouvements, vacations,
    alertes) : fuseau du site, jamais celui du poste. Les sites n'ont pas de fuseau propre en
    base : tous sont en Algérie (Africa/Algiers), le fuseau d'Attendance Core."""
    local = (now or _now_local()).astimezone(TZ)
    return {"timezone": TZ_NAME, "server_now": local.isoformat(timespec="seconds"),
            "operational_date": local.date().isoformat(), "server_time": local.strftime("%H:%M:%S"),
            "utc_offset_minutes": int(local.utcoffset().total_seconds() // 60)}


# ── Planning ─────────────────────────────────────────────────────────────────────────────
def active_assignment(db: Session, employee_id: int) -> Assignment | None:
    return db.execute(
        select(Assignment).where(Assignment.employee_id == employee_id, Assignment.active == 1).order_by(Assignment.id.desc())
    ).scalars().first()


def planned_day(db: Session, assignment: Assignment | None, site: Site | None, work_date: date,
                anchors: list[SiteRotation] | None = None) -> dict[str, Any]:
    """Jour prévu par le planning réel (rotation configurée, sinon régime du site). Aucun
    horaire n'est inventé : `start_time`/`end_time` sont vides si le planning n'en porte pas."""
    from app.modules.ops.service import configured_rotation_for_date, rotation_for_date

    if not assignment:
        return {"known": False, "on": None, "period": "", "start_time": "", "end_time": ""}
    from app.modules.attendance import official

    posted = official.legacy_rotation(db, assignment, work_date, anchors=anchors)
    if posted is not None:
        # Travail posté explicite : la vérité attendue est le planning OFFICIEL.
        return {"known": posted["known"], "on": posted["on"], "period": posted["period"],
                "start_time": posted["start_time"], "end_time": posted["end_time"]}
    rotation = db.get(RotationTemplate, assignment.rotation_id) if assignment.rotation_id else None
    if rotation and rotation.active:
        rot = configured_rotation_for_date(rotation, assignment.group_code, work_date, assignment.start_date)
    elif site is not None and site.rotation_system:
        rot = rotation_for_date(site.rotation_system, assignment.group_code, work_date, assignment.start_date)
    else:
        return {"known": False, "on": None, "period": "", "start_time": "", "end_time": ""}
    return {"known": True, "on": bool(rot.get("on")), "period": rot.get("period") or "",
            "start_time": rot.get("start_time") or "", "end_time": rot.get("end_time") or ""}


def authorized_work_minutes(db: Session, assignment: Assignment | None, site: Site | None, work_date: date) -> int:
    """Durée autorisée issue du cycle configuré, avec repli sur l'ancien régime du site."""
    import re

    from app.modules.attendance import official

    posted = official.legacy_rotation(db, assignment, work_date) if assignment else None
    if posted is not None and posted["known"]:
        return official.NORMAL_SHIFT_MINUTES
    # Travail posté dont la rotation n'est pas configurée : aucun calcul posté (le cycle officiel
    # n'est pas lu sans ancrage) ; seule la règle historique du site s'applique.
    if assignment and assignment.rotation_id and posted is None:
        rotation = db.get(RotationTemplate, assignment.rotation_id)
        days = rotation.cycle_days if rotation and isinstance(rotation.cycle_days, list) else []
        if rotation and days:
            offsets = rotation.group_offsets if isinstance(rotation.group_offsets, dict) else {}
            try:
                offset = int(offsets.get((assignment.group_code or "A").upper(), 0))
            except (TypeError, ValueError):
                offset = 0
            index = ((work_date - assignment.start_date).days + offset) % max(1, min(rotation.cycle_length, len(days)))
            day = days[index] if isinstance(days[index], dict) else {}
            start, end = str(day.get("start_time") or ""), str(day.get("end_time") or "")
            try:
                start_minutes = int(start[:2]) * 60 + int(start[3:5])
                end_minutes = int(end[:2]) * 60 + int(end[3:5])
                return (end_minutes - start_minutes) % (24 * 60) or 24 * 60
            except (TypeError, ValueError):
                pass
    system = str(getattr(site, "rotation_system", "") or "").strip().lower() if site else ""
    if "24/48" in system:
        return 24 * 60
    if "3x8" in system:
        return 8 * 60
    explicit = re.search(r"(?:^|\D)(8|12|16|24)\s*h?(?:\D|$)", system)
    return int(explicit.group(1)) * 60 if explicit else 8 * 60


# ── Anomalies ────────────────────────────────────────────────────────────────────────────
def raise_anomaly(db: Session, *, anomaly_type: str, message: str, severity: str = "warning",
                  employee: Employee | None = None, site_id: int | None = None, presence_date: date | None = None,
                  event: AttendanceEvent | None = None, source: str | None = None,
                  details: dict | None = None, dedupe_key: str | None = None) -> AttendanceAnomaly:
    """Crée une anomalie, sans jamais la dupliquer (même type/employé/jour/clé)."""
    key = dedupe_key or ":".join(str(part) for part in (
        anomaly_type, employee.id if employee else "-", site_id or "-", presence_date or "-", event.id if event else "-",
    ))
    existing = db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.dedupe_key == key)).scalar_one_or_none()
    if existing:
        return existing
    row = AttendanceAnomaly(
        anomaly_type=anomaly_type, severity=severity, status=ANOMALY_OPEN,
        employee_id=employee.id if employee else None, society=(employee.society if employee else None),
        site_id=site_id, presence_date=presence_date, event_id=event.id if event else None,
        source=source, message=message[:300], details=details or {}, dedupe_key=key,
    )
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        # Même anomalie créée en parallèle : on garde l'existante.
        return db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.dedupe_key == key)).scalar_one()
    return row


# ── Journal (lecture, forme historique des écrans pointeur) ──────────────────────────────
def event_to_scan_row(event: AttendanceEvent, employee: Employee | None = None) -> dict[str, Any]:
    data = event.data if isinstance(event.data, dict) else {}
    local = to_local(event.occurred_at)
    row = {
        "id": event.idempotency_key or f"evt-{event.id}",
        "eventId": event.id,
        "nonce": event.idempotency_key or "",
        "employeeId": event.employee_id,
        "matricule": data.get("matricule") or (employee.code if employee else ""),
        "agentName": data.get("agentName") or (f"{employee.last_name or ''} {employee.first_name or ''}".strip() if employee else ""),
        "action": LEGACY_ACTION.get(event.event_type, event.event_type.lower()),
        "cycle": event.cycle,
        "scannedAt": local.isoformat(),
        "presenceDate": event.presence_date.isoformat() if event.presence_date else local.date().isoformat(),
        "site": data.get("siteName") or "",
        "siteId": event.site_id,
        "scannedBy": event.actor_label or "",
        "scannedByUserId": event.actor_user_id,
        "source": event.source,
    }
    if event.observation:
        row["observation"] = event.observation
    for key in ("authorizedMinutes", "workedMinutes", "overtimeMinutes", "overtimeAlert", "counted"):
        if key in data:
            row[key] = data[key]
    return row


def scan_rows(db: Session, *, site_ids: set[int] | list[int] | None = None, since: datetime | None = None,
              until: datetime | None = None, employee_id: int | None = None) -> list[dict[str, Any]]:
    """Événements arrivée/départ filtrés EN SQL (remplace la relecture intégrale de la
    collection attendanceQrScans). `since`/`until` : datetimes locales ou aware."""
    stmt = select(AttendanceEvent).where(AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)))
    if site_ids is not None:
        ids = list(site_ids)
        if not ids:
            return []
        stmt = stmt.where(AttendanceEvent.site_id.in_(ids))
    if since is not None:
        stmt = stmt.where(AttendanceEvent.occurred_at > to_utc_naive(since))
    if until is not None:
        stmt = stmt.where(AttendanceEvent.occurred_at <= to_utc_naive(until))
    if employee_id is not None:
        stmt = stmt.where(AttendanceEvent.employee_id == employee_id)
    events = db.execute(stmt.order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars().all()
    return [event_to_scan_row(event) for event in events]


def event_by_key(db: Session, source: str, key: str, employee_id: int | None = None) -> AttendanceEvent | None:
    event = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.source == source, AttendanceEvent.idempotency_key == key,
    )).scalar_one_or_none()
    if event is not None and employee_id is not None and event.employee_id != employee_id:
        # Clé déjà consommée par un AUTRE employé : jamais renvoyer ses données.
        raise HTTPException(409, detail="Clé de pointage déjà utilisée")
    return event


def key_used(db: Session, key: str) -> bool:
    """Un nonce QR n'est utilisable qu'une fois, quelle que soit la source."""
    return db.execute(select(AttendanceEvent.id).where(AttendanceEvent.idempotency_key == key).limit(1)).first() is not None


# ── Écriture ─────────────────────────────────────────────────────────────────────────────
def _lock_employee(db: Session, employee_id: int) -> None:
    # PostgreSQL : verrou de ligne jusqu'au commit — deux scans parallèles du même employé
    # sont sérialisés (SQLite ignore FOR UPDATE ; ses écritures sont déjà sérialisées).
    db.execute(select(Employee.id).where(Employee.id == employee_id).with_for_update()).first()


def _last_scan_events(db: Session, employee_id: int, limit: int = 40) -> list[AttendanceEvent]:
    rows = db.execute(
        select(AttendanceEvent).where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)),
        ).order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.id.desc()).limit(limit)
    ).scalars().all()
    return list(reversed(rows))


def _presence_for(db: Session, employee_id: int, day: date) -> DailyPresence | None:
    return db.execute(select(DailyPresence).where(
        DailyPresence.presence_date == day, DailyPresence.employee_id == employee_id,
    ).order_by(DailyPresence.id.desc())).scalars().first()


def _hhmm_to_minutes(value: str) -> int | None:
    try:
        return int(value[:2]) * 60 + int(value[3:5])
    except (TypeError, ValueError, IndexError):
        return None


def _employee_card(employee: Employee, site_name: str) -> dict[str, Any]:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
    photo = next((str(extra.get(k) or legacy.get(k) or "").strip() for k in ("photo", "photoUrl", "photoData", "photo_url")
                  if extra.get(k) or legacy.get(k)), "")
    return {
        "id": employee.id, "matricule": employee.code, "nom": employee.last_name, "prenom": employee.first_name,
        "photo": photo, "societe": employee.society or "", "poste": employee.position or "",
        "statut": employee.status or "", "site": site_name,
    }


def _duplicate_response(event: AttendanceEvent, employee: Employee, site_name: str, message: str) -> dict[str, Any]:
    local = to_local(event.occurred_at)
    data = event.data if isinstance(event.data, dict) else {}
    return {
        "success": True, "duplicate": True, "message": message,
        "action": LEGACY_ACTION.get(event.event_type, ""), "cycle": event.cycle,
        "heure": local.strftime("%H:%M:%S"), "date": local.strftime("%Y-%m-%d"),
        "site": data.get("siteName") or site_name, "event_id": event.id,
        "employee": _employee_card(employee, data.get("siteName") or site_name),
    }


def _refuse_entry(db: Session, *, employee: Employee, actor: Any | None, source: str, counted: dict[str, Any],
                  site_id: int | None = None, events: list[AttendanceEvent] | None = None, extra: dict[str, Any] | None = None) -> None:
    """Entrée refusée par les règles du travail posté (avant T-30, nouvelle entrée avant TFIN+30,
    vacation précédente non clôturée, saisie manuelle requise). Aucun événement ni présence n'est
    créé — aucun temps n'est fabriqué ; la tentative est tracée dans l'audit (qui, où, quand,
    par quelle source, pour quelle vacation, dernière entrée / sortie), sans qualification
    disciplinaire."""
    from app.modules.attendance import counted as counted_time, official

    code, society, employee_id, matricule = counted["entry_status"], employee.society, employee.id, employee.code
    hhmm = {key: datetime.fromisoformat(counted[key]).strftime("%H:%M")
            for key in ("scheduled_start", "window_opens_at", "window_closes_at") if counted.get(key)}
    if code == counted_time.EARLY_OUTSIDE_WINDOW:
        label = official.SHIFT_LABELS.get(counted["shift"], counted["shift"])
        detail = (f"Pointage hors fenêtre : vacation {label} à {hhmm['scheduled_start']}, "
                  f"pointage possible à partir de {hhmm['window_opens_at']}.")
    elif code == counted_time.EXTRA_BEFORE_WINDOW:
        detail = (f"Nouvelle entrée refusée : vacation terminée à {hhmm['scheduled_start']}, "
                  f"nouvelle entrée possible de {hhmm['window_opens_at']} à {hhmm['window_closes_at']}.")
    elif code == counted_time.PREVIOUS_SHIFT_NOT_CLOSED:
        detail = "Nouvelle entrée refusée : la vacation précédente n'a pas de sortie enregistrée."
    else:
        detail = (f"Fenêtre de nouvelle entrée dépassée ({hhmm['window_closes_at']}) : "
                  "saisie manuelle par un pointeur habilité requise.")
    last = {kind: next((to_local(e.occurred_at).isoformat() for e in reversed(events or []) if e.event_type == kind), None)
            for kind in (EVENT_ARRIVAL, EVENT_DEPARTURE)}
    terminal = (extra or {}).get("terminal_name") or (extra or {}).get("terminal") or (extra or {}).get("camera")
    db.rollback()                                                     # libère le verrou : rien n'a été écrit
    append_audit(db, action=f"attendance.{code.lower()}", resource="attendance_event", resource_id=employee_id,
                 result="refused", user=actor, society=society,
                 new_state={"code": code, "state": "REFUSED", "recorded": False, "source": source, "message": detail,
                            "employee_id": employee_id, "matricule": matricule, "society": society, "site_id": site_id,
                            "terminal": terminal, "last_entry": last[EVENT_ARRIVAL], "last_exit": last[EVENT_DEPARTURE],
                            **{key: value for key, value in counted.items() if value is not None and key != "entry_status"}})
    db.commit()
    manual_denied = code == counted_time.MANUAL_ENTRY_REQUIRED and source == SOURCE_MANUAL
    # Motif structuré pour l'écran (ASCII : en-tête HTTP) ; `detail` reste le texte historique.
    refusal = json.dumps({"code": code, "message": detail, "recorded": False,
                          **{key: counted.get(key) for key in ("kind", "shift", "scheduled_start", "scheduled_end", "window_opens_at",
                                                               "window_closes_at", "actual_entry", "previous")}}, ensure_ascii=True)
    raise HTTPException(status_code=403 if manual_denied else 409, detail=detail,
                        headers={"X-Attendance-Code": code, "X-Attendance-Refusal": refusal})


def record_scan(
    db: Session,
    *,
    employee: Employee,
    source: str,
    actor: Any | None,
    idempotency_key: str | None,
    observation: str = "",
    device_id: int | None = None,
    confidence: float | None = None,
    quality_result: str | None = None,
    liveness_result: str | None = None,
    extra: dict[str, Any] | None = None,
    now: datetime | None = None,
    intent: str | None = None,
    manual_entry_allowed: bool = False,
    abandon_shift_id: int | None = None,
) -> dict[str, Any]:
    """Enregistre un pointage (arrivée ou départ déterminé par l'état métier réel) et met à
    jour la journée DailyPresence. Renvoie la réponse affichée par le terminal."""
    from app.modules.irongs.sql_bridge import upsert_presence
    from app.modules.portal.routes import _employee_portal_block_reason

    blocked_reason = _employee_portal_block_reason(employee)
    if blocked_reason:
        raise HTTPException(status_code=403, detail=f"Pointage refusé : {blocked_reason}")

    explicit_now = now
    actor_label = getattr(actor, "username", None) or ""
    actor_id = getattr(actor, "id", None)
    if abandon_shift_id is not None and (
            not isinstance(observation, str) or not observation.strip() or len(observation) > 500):
        raise HTTPException(422, "Motif / observation obligatoire (500 caractères maximum)")
    observation = str(observation or "").strip()[:500]
    assignment = active_assignment(db, employee.id)
    site = db.get(Site, assignment.site_id) if assignment and assignment.site_id else None
    site_name = (site.name or site.indicatif or "") if site else ""

    if idempotency_key:
        previous = event_by_key(db, source, idempotency_key, employee.id)
        if previous:
            return _duplicate_response(previous, employee, site_name, "Déjà enregistré")

    if abandon_shift_id is not None and db.get_bind().dialect.name == "sqlite":
        # sqlite3 diffère BEGIN jusqu'à une écriture : ouvrir une transaction réelle
        # avant les SAVEPOINTs et sérialiser les confirmations comme le verrou PostgreSQL.
        connection = db.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    _lock_employee(db, employee.id)
    # Horodatage pris SOUS le verrou : une requête parallèle validée juste avant a forcément
    # une heure antérieure (sinon l'écart devient négatif et l'anti-rebond ne s'applique plus).
    now = (explicit_now or _now_local()).astimezone(TZ)
    if idempotency_key:
        previous = event_by_key(db, source, idempotency_key, employee.id)
        if previous:
            return _duplicate_response(previous, employee, site_name, "Déjà enregistré")
    events = _last_scan_events(db, employee.id)
    last_event = events[-1] if events else None

    abandon_details = None
    if abandon_shift_id is not None:
        from app.modules.attendance import abandon
        if source != SOURCE_MANUAL or not manual_entry_allowed:
            raise HTTPException(403, "Saisie manuelle non autorisée")
        if not observation:
            raise HTTPException(422, "Motif / observation obligatoire")
        previous_abandon = abandon.existing(db, employee.id, abandon_shift_id)
        if previous_abandon:
            return abandon.response(previous_abandon, duplicate=True)
        abandon_details = abandon.context(db, employee, now=now)
        if abandon_details["shift_id"] != abandon_shift_id:
            raise HTTPException(409, "La vacation concernée a changé : rechargez la confirmation")
        if not abandon_details["applicable"]:
            raise HTTPException(409, "Abandon de poste non applicable : il reste "
                f"{int(abandon_details['remaining_minutes'])} minutes avant la fin prévue du service. "
                f"Le seuil requis est de {abandon_details['threshold_minutes']} minutes.")

    # Anti-rebond : double scan, visage resté devant la caméra, retry réseau.
    gap = timedelta(seconds=max(0, settings.attendance_min_event_gap_seconds))
    if abandon_details is None and last_event and abs(now - to_local(last_event.occurred_at)) < gap:
        return _duplicate_response(last_event, employee, site_name, "Déjà enregistré")

    last_arrival = next((e for e in reversed(events) if e.event_type == EVENT_ARRIVAL), None)
    last_arrival_at = to_local(last_arrival.occurred_at) if last_arrival else None
    open_cycle_max = open_cycle_window(site)
    open_arrival = (
        last_arrival if last_event is last_arrival and last_arrival_at is not None
        and timedelta(0) <= now - last_arrival_at <= open_cycle_max else None
    )
    if abandon_details is not None and open_arrival is None:
        raise HTTPException(409, "Vacation sans prise de service ouverte valide")
    event_type = EVENT_DEPARTURE if open_arrival else EVENT_ARRIVAL
    cycle_number: int | None = None                                   # fixé plus bas, une fois la journée connue
    presence_day = now.date()
    if event_type == EVENT_DEPARTURE and open_arrival:
        presence_day = open_arrival.presence_date
    existing = _presence_for(db, employee.id, presence_day)
    legacy = ((existing.data or {}).get("_legacy") if existing and isinstance(existing.data, dict) else {}) or {}
    arrival_at_for_departure = last_arrival_at if event_type == EVENT_DEPARTURE else None
    # Compatibilité : journées pointées avant le journal d'événements.
    if not events and existing:
        has_arrival = bool(existing.arrival_time or legacy.get("scanArrivee") or legacy.get("heureArrivee"))
        has_departure = bool(existing.departure_time or legacy.get("scanDepart") or legacy.get("heureDepart"))
        event_type = EVENT_DEPARTURE if has_arrival and not has_departure else EVENT_ARRIVAL
        cycle_number = 1
        if event_type == EVENT_DEPARTURE:
            legacy_arrival = legacy.get("scanArrivee") or existing.arrival_time or legacy.get("heureArrivee")
            try:
                arrival_at_for_departure = datetime.combine(existing.presence_date, datetime.strptime(str(legacy_arrival), "%H:%M:%S").time(), TZ)
            except (TypeError, ValueError):
                arrival_at_for_departure = None
    # Travail posté (lots 1-2) : temps RÉEL et temps COMPTABILISÉ sont distincts ; l'heure réelle
    # reste celle de l'événement. Hors travail posté : None, rien ne change.
    from app.modules.attendance import counted as counted_time

    counted: dict[str, Any] | None = None
    previous = counted_time.previous_shift(events, site.id) if site is not None else None
    if previous is not None and intent == counted_time.INTENT_EXTRA_ENTRY and open_arrival is previous[1]:
        # Entrée explicite alors que la vacation est encore ouverte : jamais requalifiée en sortie.
        counted = counted_time.extra_entry(previous[0], now, previous_event_id=previous[1].id)
    elif event_type == EVENT_ARRIVAL and site is not None:
        counted = counted_time.entry(db, employee_id=employee.id, site_id=site.id, at=now)
        normal_entry = counted is not None and counted["entry_status"] not in counted_time.REFUSALS
        if previous is not None and not normal_entry and counted_time.in_extra_slot(previous[0], now):
            # Maintien : nouvelle entrée sur le créneau qui suit la vacation normale. Deux
            # vacations distinctes, jamais une seule présence continue.
            manual = source == SOURCE_MANUAL and manual_entry_allowed
            if manual and not observation and now > datetime.fromisoformat(previous[0]["scheduled_end"]) + counted_time.EXTRA_WINDOW_END:
                raise HTTPException(status_code=422, detail="Motif obligatoire pour la saisie manuelle d'une vacation supplémentaire")
            counted = counted_time.extra_entry(previous[0], now, previous_event_id=previous[1].id, manual_allowed=manual)
    elif event_type == EVENT_DEPARTURE and open_arrival is not None:
        counted = counted_time.close((open_arrival.data or {}).get("counted"), now)
    if counted is not None and counted["entry_status"] in counted_time.REFUSALS:
        _refuse_entry(db, employee=employee, actor=actor, source=source, counted=counted,
                      site_id=site.id if site is not None else None, events=events, extra=extra)
    extra_shift = counted is not None and counted.get("kind") == counted_time.KIND_EXTRA

    # Journée de TRAVAIL : une arrivée de nuit après minuit appartient à la vacation commencée la
    # veille (work_date du planning officiel), pas au jour civil. Sans cela, deux nuits
    # consécutives tombaient sur une seule journée de présence et la paie en perdait une.
    closed_work_day: date | None = None
    if (event_type == EVENT_ARRIVAL and counted is not None and not extra_shift
            and counted["entry_status"] not in counted_time.REFUSALS and counted.get("work_date")):
        work_day = date.fromisoformat(str(counted["work_date"])[:10])
        if work_day != presence_day:
            target = _presence_for(db, employee.id, work_day)
            if target is not None and target.closed_at is not None:
                # Journée de travail déjà clôturée (lisible par la paie) : jamais modifiée ici. Le
                # passage reste rattaché au jour civil et une anomalie demande la régularisation.
                closed_work_day = work_day
            else:
                presence_day, existing = work_day, target
                legacy = ((existing.data or {}).get("_legacy") if existing and isinstance(existing.data, dict) else {}) or {}
    # Numéro de vacation dans la JOURNÉE de présence (1, 2…). Le départ reprend celui de son
    # arrivée. L'ancien calcul comptait les arrivées des 40 derniers événements : il dérivait
    # d'un jour à l'autre puis se déréglait (arrivée 21 / départ 20) après 20 vacations.
    if cycle_number is None:
        if event_type == EVENT_DEPARTURE and open_arrival is not None:
            cycle_number = int(open_arrival.cycle or 1)
        else:
            cycle_number = 1 + len(db.execute(select(AttendanceEvent.id).where(
                AttendanceEvent.employee_id == employee.id, AttendanceEvent.event_type == EVENT_ARRIVAL,
                AttendanceEvent.presence_date == presence_day)).all())

    # Le délai entre deux arrivées ne s'applique pas à la vacation supplémentaire : sa fenêtre
    # (TFIN+30 → TFIN+45) est la règle.
    reentry = False
    if event_type == EVENT_ARRIVAL and last_arrival_at is not None and not extra_shift:
        remaining = NEW_ARRIVAL_DELAY - (now - last_arrival_at)
        if remaining > timedelta(0) and intent == counted_time.INTENT_REENTRY and _reentry_possible(last_event, site, now):
            # Reprise de poste : la sortie précédente (double scan, erreur de saisie, abandon
            # enregistré à tort) appartient à une vacation encore en cours. Seul un opérateur
            # habilité à la saisie manuelle peut rouvrir, avec un motif ; rien n'est effacé : la
            # sortie reste dans le journal et la reprise ouvre une nouvelle vacation, signalée.
            if source != SOURCE_MANUAL or not manual_entry_allowed:
                raise HTTPException(status_code=403, detail="Reprise de poste réservée à la saisie manuelle habilitée")
            if not observation:
                raise HTTPException(status_code=422, detail="Motif obligatoire pour une reprise de poste")
            reentry = True
        elif remaining > timedelta(0):
            remaining_minutes = max(1, int(remaining.total_seconds() // 60) + 1)
            hours, minutes = divmod(remaining_minutes, 60)
            wait_label = f"{hours} h {minutes:02d}" if hours else f"{minutes} min"
            raise HTTPException(status_code=409, detail=f"Nouvelle arrivée disponible dans {wait_label}. Le départ précédent est bien enregistré.")

    closed_presence = existing is not None and existing.closed_at is not None
    if closed_presence and not (event_type == EVENT_DEPARTURE and open_arrival is not None):
        raise HTTPException(status_code=409, detail="Journée clôturée : pointage refusé. Une correction post-clôture est nécessaire.")
    # Sortie d'une vacation ouverte dont la journée d'arrivée a été clôturée entre-temps (poste de
    # nuit) : le fait est enregistré — sinon l'agent ne peut plus sortir et la vacation reste sans
    # temps compté — mais la journée clôturée n'est PAS modifiée ; une anomalie le signale.

    heure = now.strftime("%H:%M:%S")
    worked_minutes = (
        max(0, int((now - arrival_at_for_departure).total_seconds() // 60))
        if event_type == EVENT_DEPARTURE and arrival_at_for_departure else None
    )
    authorized_minutes = authorized_work_minutes(db, assignment, site, (arrival_at_for_departure or now).date())
    overtime_minutes = max(0, worked_minutes - authorized_minutes) if worked_minutes is not None else 0
    if counted is not None and counted["counted_minutes"] is not None:
        # Le dépassement se mesure sur le temps comptabilisé, jamais sur la présence physique
        # brute : arriver avant T ou sortir après la fin de vacation ne crée aucun OVERTIME.
        authorized_minutes = int(counted["normal_minutes"])
        overtime_minutes = max(0, counted["counted_minutes"] - authorized_minutes)
    agent_name = f"{employee.last_name or ''} {employee.first_name or ''}".strip()
    legacy_action = LEGACY_ACTION[event_type]

    event = AttendanceEvent(
        employee_id=employee.id, society=employee.society, site_id=site.id if site else None,
        presence_date=presence_day, occurred_at=to_utc_naive(now), event_type=event_type, source=source,
        idempotency_key=idempotency_key, cycle=cycle_number, device_id=device_id,
        actor_user_id=actor_id, actor_label=actor_label or None, confidence=confidence,
        quality_result=quality_result, liveness_result=liveness_result, observation=observation or None,
        data={
            "matricule": employee.code, "agentName": agent_name, "siteName": site_name,
            "authorizedMinutes": authorized_minutes,
            **({"workedMinutes": worked_minutes, "overtimeMinutes": overtime_minutes, "overtimeAlert": True} if overtime_minutes else {}),
            **({"workedMinutes": worked_minutes} if worked_minutes is not None and not overtime_minutes else {}),
            **({"counted": counted} if counted is not None else {}),
            **(extra or {}),
        },
    )
    try:
        with db.begin_nested():
            db.add(event)
            db.flush()
    except IntegrityError:
        # Même événement source enregistré en parallèle : aucun second effet.
        db.rollback()
        previous = event_by_key(db, source, idempotency_key, employee.id) if idempotency_key else None
        if previous is None:
            raise
        return _duplicate_response(previous, employee, site_name, "Déjà enregistré")

    existing_notes = str((existing.notes if existing else "") or legacy.get("observations") or "").strip()
    observation_line = (
        f"[{heure} · {actor_label or source} · {'DÉPART' if event_type == EVENT_DEPARTURE else 'ARRIVÉE'}] {observation}"
        if observation else ""
    )
    item: dict[str, Any] = {
        "date": presence_day.isoformat(), "agentId": str(employee.id), "employee_id": employee.id,
        "agentBackendId": employee.id, "matricule": employee.code, "societe": employee.society or "",
        "agentName": agent_name, "statut": "present", "status": "present", "code": "P", "valide": True,
        "valideAt": now.isoformat(), "source": source, "scannedBy": actor_label, "scannedByUserId": actor_id,
        "scanCycles": [
            *(legacy.get("scanCycles") if isinstance(legacy.get("scanCycles"), list) else []),
            {"action": legacy_action, "heure": heure, "scannedAt": now.isoformat(), "scannedBy": actor_label,
             "cycle": cycle_number, "source": source, **({"observation": observation} if observation else {})},
        ],
        "authorizedMinutes": authorized_minutes,
        **({"workedMinutes": worked_minutes, "overtimeMinutes": overtime_minutes, "overtimeAlert": True} if overtime_minutes else {}),
        # Journée : la vacation normale et la vacation supplémentaire ne s'écrasent pas.
        **({("countedExtra" if extra_shift else "counted"): counted} if counted is not None else {}),
        **(extra or {}),
    }
    if observation_line:
        item["observations"] = "\n".join(part for part in (existing_notes, observation_line) if part)
    if event_type == EVENT_ARRIVAL:
        if not existing or not existing.arrival_time:
            item["heureArrivee"] = "P"
            item["scanArrivee"] = heure
        item["lastScanArrivee"] = heure
    else:
        item["heureDepart"] = heure
        item["scanDepart"] = heure
    if assignment:
        item.update({"siteBackendId": assignment.site_id, "siteId": assignment.site_id, "siteName": site_name,
                     "groupe": assignment.group_code or ""})
    if closed_presence:
        record = {"backendId": existing.id, "closed": True}
        event.presence_id = existing.id
        raise_anomaly(db, anomaly_type="DEPARTURE_AFTER_CLOSURE", employee=employee, site_id=event.site_id,
                      presence_date=presence_day, event=event, source=source,
                      message=f"Sortie à {now.strftime('%H:%M')} enregistrée après la clôture de la journée du {presence_day.isoformat()}",
                      details={"departure_at": now.isoformat(), "closed_at": existing.closed_at.isoformat(),
                               "regularization": "correction post-clôture"})
    else:
        record = upsert_presence(db, item, "feuillePresence")
        event.presence_id = record.get("backendId") if isinstance(record, dict) else None
    if closed_work_day is not None:
        raise_anomaly(db, anomaly_type="ARRIVAL_AFTER_CLOSURE", employee=employee, site_id=event.site_id,
                      presence_date=closed_work_day, event=event, source=source,
                      message=f"Arrivée à {now.strftime('%H:%M')} pour la vacation du {closed_work_day.isoformat()}, journée déjà clôturée",
                      details={"arrival_at": now.isoformat(), "work_date": closed_work_day.isoformat(),
                               "recorded_on": presence_day.isoformat(), "regularization": "correction post-clôture"})

    # Anomalies détectables à l'événement.
    if source == SOURCE_MANUAL:
        raise_anomaly(db, anomaly_type="MANUAL_POINTAGE", severity="info", employee=employee,
                      site_id=event.site_id, presence_date=presence_day, event=event, source=source,
                      message=f"Pointage manuel ({legacy_action}) par {actor_label or 'opérateur'}",
                      details={"observation": observation} if observation else None)
    if overtime_minutes:
        raise_anomaly(db, anomaly_type="OVERTIME", employee=employee, site_id=event.site_id,
                      presence_date=presence_day, event=event, source=source,
                      message=f"Durée {worked_minutes} min pour {authorized_minutes} min autorisées",
                      details={"worked_minutes": worked_minutes, "authorized_minutes": authorized_minutes})
    if reentry:
        raise_anomaly(db, anomaly_type="REENTRY", severity="info", employee=employee, site_id=event.site_id,
                      presence_date=presence_day, event=event, source=source,
                      message=f"Reprise de poste à {now.strftime('%H:%M')} après une sortie à "
                              f"{to_local(last_event.occurred_at).strftime('%H:%M')} (saisie par {actor_label or 'opérateur'})",
                      details={"observation": observation, "previous_departure_event_id": last_event.id})
    if extra_shift and event_type == EVENT_ARRIVAL:
        # Maintien détecté : un fait à connaître, pas une faute (sévérité « info »).
        raise_anomaly(db, anomaly_type=counted_time.KIND_EXTRA, severity="info", employee=employee, site_id=event.site_id,
                      presence_date=presence_day, event=event, source=source,
                      message=f"Vacation supplémentaire {counted['scheduled_start'][11:16]} → {counted['scheduled_end'][11:16]} (maintien)",
                      details={"entry_status": counted["entry_status"], "previous": counted.get("previous")})
    if event_type == EVENT_DEPARTURE and open_arrival is not None:
        counted_time.resolve_unclosed(db, arrival=open_arrival, exit_at=now)
    if event_type == EVENT_ARRIVAL and not extra_shift:
        plan = planned_day(db, assignment, site, presence_day)
        if plan["known"] and plan["on"] is False:
            raise_anomaly(db, anomaly_type="OFF_SCHEDULE", employee=employee, site_id=event.site_id,
                          presence_date=presence_day, event=event, source=source,
                          message=f"Arrivée un jour non travaillé selon le planning ({plan['period'] or 'repos'})")
        expected = _hhmm_to_minutes(plan["start_time"]) if plan["known"] and plan["on"] else None
        scheduled = counted.get("scheduled_start") if counted is not None else None
        if scheduled:
            # Vacation officielle : retard = écart au début RÉEL de la vacation (date comprise),
            # donc correct aussi pour une arrivée après minuit sur un poste de nuit.
            start_at = datetime.fromisoformat(scheduled)
            late = int((now - start_at).total_seconds() // 60)
            expected_label = start_at.strftime("%H:%M")
        elif expected is not None:
            late = (now.hour * 60 + now.minute) - expected
            expected_label = plan["start_time"]
        else:
            late = None
        if late is not None and late > max(0, settings.attendance_late_tolerance_minutes) and late < 12 * 60:
            raise_anomaly(db, anomaly_type="LATE", employee=employee, site_id=event.site_id,
                          presence_date=presence_day, event=event, source=source,
                          message=f"Arrivée à {now.strftime('%H:%M')} pour {expected_label} prévu ({late} min de retard)",
                          details={"expected": expected_label, "late_minutes": late})

    # Feuille de présence de la rotation (lot 1) : reflet opérationnel du FAIT ci-dessus. Le fait
    # est déjà écrit ; ce rattachement est isolé dans son point de sauvegarde et ne peut ni le
    # modifier ni faire échouer le pointage.
    from app.modules.attendance import sheets
    sheet_line = sheets.attach_event_safely(db, event=event, employee=employee, site=site, assignment=assignment, now=now)
    # Comparaison prévu / réel (lot 3) : APRÈS le fait et la feuille, isolée de la même façon.
    # Elle n'émet un écart que sur un site ACTIVE dont le modèle est STABLE ; le pointage est accepté.
    from app.modules.attendance import deviations
    rotation_alert = deviations.check_arrival_safely(db, event=event, employee=employee, site=site, line=sheet_line, now=now)

    append_audit(db, action="attendance.event", resource="attendance_event", resource_id=event.id,
                 result="success", user=actor, society=employee.society,
                 new_state={"type": event_type, "source": source, "site_id": event.site_id,
                            "presence_date": presence_day.isoformat(), "device_id": device_id,
                            **({"shift_kind": counted.get("kind", counted_time.KIND_NORMAL), "entry_status": counted["entry_status"]} if counted is not None else {})})
    if abandon_details is not None:
        business_event = abandon.record(db, departure=event, employee=employee, actor=actor, details=abandon_details)
    db.commit()
    if abandon_details is not None:
        return abandon.response(business_event)

    duration_label = ""
    if worked_minutes is not None:
        duration_hours, remaining_minutes = divmod(worked_minutes, 60)
        duration_label = f"{duration_hours} h {remaining_minutes:02d} min"
    return {
        "success": True, "duplicate": False, "event_id": event.id,
        "action": legacy_action, "cycle": cycle_number, "heure": heure,
        "arrival_time": arrival_at_for_departure.strftime("%H:%M:%S") if arrival_at_for_departure else (heure if event_type == EVENT_ARRIVAL else ""),
        "departure_time": heure if event_type == EVENT_DEPARTURE else "",
        "duration_minutes": worked_minutes, "duration_label": duration_label,
        "authorized_minutes": authorized_minutes, "overtime_minutes": overtime_minutes,
        "overtime_alert": overtime_minutes > 0, "date": now.strftime("%Y-%m-%d"), "site": site_name,
        "observation": observation, "employee": _employee_card(employee, site_name), "record": record,
        "rotation_alert": rotation_alert,
        **({"counted": counted_time.view({"counted": counted})} if counted is not None else {}),
    }


def _reentry_possible(last_event: AttendanceEvent | None, site: Site | None, now: datetime) -> bool:
    """Le dernier passage est une SORTIE dont la vacation est encore en cours : avant la fin
    prévue de la vacation officielle, sinon dans la fenêtre de cycle ouvert de son arrivée."""
    if last_event is None or last_event.event_type != EVENT_DEPARTURE:
        return False
    snapshot = (last_event.data or {}).get("counted") if isinstance(last_event.data, dict) else None
    if isinstance(snapshot, dict) and snapshot.get("scheduled_end"):
        return now < datetime.fromisoformat(snapshot["scheduled_end"])
    return now - to_local(last_event.occurred_at) < open_cycle_window(site)


def regularize_departure(db: Session, *, arrival_event_id: int, exit_at: datetime, reason: str, actor: Any | None,
                         request: Any = None) -> dict[str, Any]:
    """Régularisation EXPLICITE d'un oubli de sortie : ajoute au journal la sortie manquante d'une
    arrivée restée ouverte, à l'heure déclarée et motivée par un responsable. Rien n'est modifié :
    l'arrivée, les passages suivants et une journée déjà clôturée restent tels quels. La vacation
    reçoit enfin un temps comptabilisé (borné par le planning officiel), lu par le récapitulatif."""
    from app.modules.attendance import counted as counted_time

    reason = str(reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(422, detail="Motif de régularisation obligatoire")
    arrival = db.get(AttendanceEvent, arrival_event_id)
    if arrival is None or arrival.event_type != EVENT_ARRIVAL:
        raise HTTPException(404, detail="Arrivée introuvable")
    _lock_employee(db, arrival.employee_id)
    db.refresh(arrival)
    employee = db.get(Employee, arrival.employee_id)
    site = db.get(Site, arrival.site_id) if arrival.site_id else None
    arrival_at = to_local(arrival.occurred_at)
    exit_local = (exit_at if exit_at.tzinfo else exit_at.replace(tzinfo=TZ)).astimezone(TZ)
    following = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.employee_id == arrival.employee_id, AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)),
        AttendanceEvent.id != arrival.id,
        (AttendanceEvent.occurred_at > arrival.occurred_at)
        | ((AttendanceEvent.occurred_at == arrival.occurred_at) & (AttendanceEvent.id > arrival.id)),
    ).order_by(AttendanceEvent.occurred_at, AttendanceEvent.id).limit(1)).scalar_one_or_none()
    if following is not None and following.event_type == EVENT_DEPARTURE:
        raise HTTPException(409, detail="Cette arrivée a déjà sa sortie")
    if exit_local <= arrival_at:
        raise HTTPException(422, detail="La sortie doit être postérieure à l'arrivée")
    if exit_local > _now_local():
        raise HTTPException(422, detail="La sortie ne peut pas être dans le futur")
    if exit_local - arrival_at > open_cycle_window(site):
        raise HTTPException(422, detail="Sortie trop éloignée de l'arrivée pour une seule vacation")
    if following is not None and exit_local >= to_local(following.occurred_at):
        raise HTTPException(422, detail="La sortie doit précéder le passage suivant de l'employé")

    snapshot = counted_time.close((arrival.data or {}).get("counted") if isinstance(arrival.data, dict) else None, exit_local)
    worked = max(0, int((exit_local - arrival_at).total_seconds() // 60))
    presence = _presence_for(db, arrival.employee_id, arrival.presence_date)
    closed = presence is not None and presence.closed_at is not None
    data = arrival.data if isinstance(arrival.data, dict) else {}
    event = AttendanceEvent(
        employee_id=arrival.employee_id, society=arrival.society, site_id=arrival.site_id,
        presence_id=presence.id if presence is not None else None, presence_date=arrival.presence_date,
        occurred_at=to_utc_naive(exit_local), event_type=EVENT_DEPARTURE, source=SOURCE_MANUAL, cycle=arrival.cycle,
        actor_user_id=getattr(actor, "id", None), actor_label=getattr(actor, "username", None), observation=reason[:500],
        data={"matricule": data.get("matricule"), "agentName": data.get("agentName"), "siteName": data.get("siteName"),
              "workedMinutes": worked, "regularized": True, "regularizedAt": _now_local().isoformat(),
              "regularizedArrivalEventId": arrival.id, **({"counted": snapshot} if snapshot is not None else {})},
    )
    db.add(event)
    db.flush()
    if presence is not None and not closed:
        # Journée encore ouverte : l'heure de sortie y est reportée. Une journée clôturée n'est
        # jamais touchée ici (correction post-clôture, permission renforcée, par sa propre route).
        presence.departure_time = exit_local.strftime("%H:%M:%S")
    counted_time.resolve_unclosed(db, arrival=arrival, exit_at=exit_local)
    raise_anomaly(db, anomaly_type="EXIT_REGULARIZED", severity="info", employee=employee, site_id=arrival.site_id,
                  presence_date=arrival.presence_date, event=event, source=SOURCE_MANUAL,
                  message=f"Sortie régularisée à {exit_local.strftime('%H:%M')} par {getattr(actor, 'username', None) or 'opérateur'}",
                  details={"reason": reason[:500], "arrival_event_id": arrival.id, "presence_closed": closed})
    append_audit(db, action="attendance.regularize_exit", resource="attendance_event", resource_id=event.id, result="success",
                 user=actor, request=request, society=arrival.society,
                 old_state={"arrival_event_id": arrival.id, "open": True},
                 new_state={"departure_event_id": event.id, "exit_at": exit_local.isoformat(), "reason": reason[:500],
                            "counted_minutes": (snapshot or {}).get("counted_minutes"), "presence_closed": closed})
    return {"event_id": event.id, "arrival_event_id": arrival.id, "exit_at": exit_local.isoformat(), "worked_minutes": worked,
            "counted_minutes": (snapshot or {}).get("counted_minutes"), "presence_updated": presence is not None and not closed,
            "presence_closed": closed}


# ── Statut de journée et corrections ─────────────────────────────────────────────────────
DAY_STATUSES = frozenset({"present", "absent", "conge", "maladie", "repos", "mission"})
_UNSET: Any = object()


def _presence_state(row: DailyPresence) -> dict[str, Any]:
    return {"status": row.status, "arrival_time": row.arrival_time, "departure_time": row.departure_time,
            "notes": row.notes, "site_id": row.site_id}


def _append_event(db: Session, *, employee: Employee, row: DailyPresence, event_type: str, source: str,
                  actor: Any | None, idempotency_key: str | None = None, observation: str | None = None,
                  data: dict | None = None) -> AttendanceEvent:
    event = AttendanceEvent(
        employee_id=employee.id, society=employee.society, site_id=row.site_id, presence_id=row.id,
        presence_date=row.presence_date, occurred_at=to_utc_naive(_now_local()), event_type=event_type,
        source=source, idempotency_key=idempotency_key, actor_user_id=getattr(actor, "id", None),
        actor_label=getattr(actor, "username", None), observation=observation, data=data or {},
    )
    db.add(event)
    db.flush()
    return event


def record_day_status(db: Session, *, employee: Employee, site_id: int | None, day: date, status: str, source: str,
                      actor: Any | None, arrival_time: str | None = None, departure_time: str | None = None,
                      notes: str | None = None, legacy: dict | None = None, request: Any = None,
                      audit: bool = True) -> DailyPresence:
    """Statut de journée saisi (présent/absent/congé/maladie/repos/mission). Refusé sur une
    journée clôturée : une correction post-clôture passe par correct_presence()."""
    from app.modules.attendance.models import EVENT_STATUS

    if status not in DAY_STATUSES:
        raise HTTPException(400, detail="Statut de pointage invalide")
    _lock_employee(db, employee.id)
    row = _presence_for(db, employee.id, day)
    if row is not None and row.closed_at is not None:
        raise HTTPException(409, detail="Journée clôturée — utiliser la correction post-clôture")
    old_state = _presence_state(row) if row else None
    if row is None:
        row = DailyPresence(presence_date=day, employee_id=employee.id, site_id=site_id, generated=0, status=status)
        db.add(row)
    if site_id is not None:
        row.site_id = site_id
    row.status = status
    # None = « non fourni » : une saisie de statut (BEO, OPS) ne doit jamais effacer les heures
    # réellement mesurées par un terminal ; l'effacement explicite passe par correct_presence().
    if arrival_time is not None:
        row.arrival_time = arrival_time
    if departure_time is not None:
        row.departure_time = departure_time
    if notes is not None:
        row.notes = notes
    if legacy:
        data = dict(row.data or {})
        data["_legacy"] = {**(data.get("_legacy") or {}), **legacy}
        row.data = data
    db.flush()
    event = _append_event(db, employee=employee, row=row, event_type=EVENT_STATUS, source=source, actor=actor,
                          observation=notes, data={"status": status, "arrival_time": arrival_time, "departure_time": departure_time})
    if status == "absent" and (not old_state or old_state.get("status") != "absent"):
        raise_anomaly(db, anomaly_type="ABSENT", employee=employee, site_id=row.site_id, presence_date=day,
                      event=event, source=source, message="Absence constatée", dedupe_key=f"ABSENT:{employee.id}:{day}")
    if audit:
        append_audit(db, action="attendance.status", resource="daily_presence", resource_id=row.id, result="success",
                     user=actor, request=request, society=employee.society, old_state=old_state,
                     new_state={"status": status, "source": source})
    return row


def correct_presence(db: Session, *, row: DailyPresence, reason: str, source: str, actor: Any | None,
                     allow_closed: bool, status: str | None = _UNSET, arrival_time: str | None = _UNSET,
                     departure_time: str | None = _UNSET, notes: str | None = _UNSET, request: Any = None,
                     audit: bool = True) -> DailyPresence:
    """Correction tracée : motif obligatoire, avant/après dans l'événement CORRECTION et
    l'audit. Une journée clôturée n'est corrigée que si l'appelant a vérifié la permission
    renforcée (allow_closed=True)."""
    from app.modules.attendance.models import EVENT_CORRECTION

    reason = str(reason or "").strip()
    if not reason:
        raise HTTPException(422, detail="Motif de correction obligatoire")
    if status is not _UNSET and status not in DAY_STATUSES:
        raise HTTPException(400, detail="Statut de pointage invalide")
    if row.closed_at is not None and not allow_closed:
        raise HTTPException(409, detail="Journée clôturée — correction post-clôture non autorisée pour ce compte")
    employee = db.get(Employee, row.employee_id)
    _lock_employee(db, row.employee_id)
    before = _presence_state(row)
    if status is not _UNSET:
        row.status = status
    if arrival_time is not _UNSET:
        row.arrival_time = arrival_time
    if departure_time is not _UNSET:
        row.departure_time = departure_time
    if notes is not _UNSET:
        row.notes = notes
    after = _presence_state(row)
    changes = {k: {"avant": before[k], "apres": after[k]} for k in before if before[k] != after[k]}
    db.flush()
    event = _append_event(db, employee=employee, row=row, event_type=EVENT_CORRECTION, source=source, actor=actor,
                          observation=reason, data={"reason": reason, "changes": changes, "post_closure": row.closed_at is not None})
    raise_anomaly(db, anomaly_type="CORRECTION", severity="info", employee=employee, site_id=row.site_id,
                  presence_date=row.presence_date, event=event, source=source,
                  message=f"Correction : {reason}"[:300], details={"changes": changes})
    if audit:
        append_audit(db, action="attendance.correct", resource="daily_presence", resource_id=row.id, result="success",
                     user=actor, request=request, society=employee.society if employee else None,
                     old_state=before, new_state={**after, "reason": reason})
    return row


# ── Clôture / réouverture ────────────────────────────────────────────────────────────────
def open_anomalies_for(db: Session, *, day: date, site_ids: list[int] | None) -> list[AttendanceAnomaly]:
    stmt = select(AttendanceAnomaly).where(AttendanceAnomaly.presence_date == day, AttendanceAnomaly.status == ANOMALY_OPEN)
    if site_ids is not None:
        stmt = stmt.where(AttendanceAnomaly.site_id.in_(site_ids))
    return db.execute(stmt).scalars().all()


def close_day(db: Session, *, day: date, site_ids: list[int] | None, actor: Any | None, source: str,
              request: Any = None) -> dict[str, Any]:
    """Clôture la journée sur un PÉRIMÈTRE explicite (jamais « toutes sociétés » par défaut :
    site_ids=None n'est accepté que pour un appelant global, décision prise par la route).
    Les anomalies ouvertes ne sont jamais masquées : elles sont renvoyées et restent ouvertes."""
    from app.modules.attendance.models import EVENT_CLOSE

    stmt = select(DailyPresence).where(DailyPresence.presence_date == day, DailyPresence.closed_at.is_(None))
    if site_ids is not None:
        if not site_ids:
            return {"closed": 0, "date": day.isoformat(), "open_anomalies": 0}
        stmt = stmt.where(DailyPresence.site_id.in_(site_ids))
    rows = db.execute(stmt).scalars().all()
    now = datetime.utcnow()
    for row in rows:
        row.closed_at = now
    db.flush()
    for row in rows:
        employee = db.get(Employee, row.employee_id)
        if employee:
            _append_event(db, employee=employee, row=row, event_type=EVENT_CLOSE, source=source, actor=actor)
    anomalies = open_anomalies_for(db, day=day, site_ids=site_ids)
    append_audit(db, action="attendance.close", resource="attendance_day", resource_id=day.isoformat(), result="success",
                 user=actor, request=request,
                 new_state={"date": day.isoformat(), "closed": len(rows), "site_ids": site_ids, "open_anomalies": len(anomalies)})
    return {"closed": len(rows), "date": day.isoformat(), "open_anomalies": len(anomalies)}


def reopen_presence(db: Session, *, row: DailyPresence, reason: str, actor: Any | None, source: str,
                    request: Any = None) -> DailyPresence:
    from app.modules.attendance.models import EVENT_REOPEN

    reason = str(reason or "").strip()
    if not reason:
        raise HTTPException(422, detail="Motif de réouverture obligatoire")
    if row.closed_at is None:
        return row
    employee = db.get(Employee, row.employee_id)
    previous = row.closed_at
    row.closed_at = None
    db.flush()
    _append_event(db, employee=employee, row=row, event_type=EVENT_REOPEN, source=source, actor=actor,
                  observation=reason, data={"closed_at": previous.isoformat()})
    append_audit(db, action="attendance.reopen", resource="daily_presence", resource_id=row.id, result="success",
                 user=actor, request=request, society=employee.society if employee else None,
                 old_state={"closed_at": previous.isoformat()}, new_state={"closed_at": None, "reason": reason})
    return row


# ── Écran legacy « feuille de présence » (/api/irongs/collections/feuillePresence) ───────
def _legacy_target(db: Session, item: dict[str, Any]) -> DailyPresence | None:
    from app.modules.irongs.sql_bridge import as_date, as_int, employee_by_ref

    row = db.get(DailyPresence, as_int(item.get("backendId")) or 0)
    if row is not None:
        return row
    employee = employee_by_ref(db, item.get("employee_id") or item.get("agentBackendId") or item.get("agentId") or item.get("matricule"))
    day = as_date(item.get("date") or item.get("presence_date"))
    return _presence_for(db, employee.id, day) if employee and day else None


def legacy_upsert_presence(db: Session, item: dict[str, Any], collection: str) -> dict[str, Any]:
    """Écriture depuis l'écran legacy : jamais sur une journée clôturée (déjà lisible par la
    paie), et toujours tracée dans le journal (source IMPORT, l'utilisateur n'étant pas connu
    à ce niveau — l'audit HTTP de la route irongs le porte)."""
    from app.modules.attendance.models import EVENT_STATUS, SOURCE_IMPORT
    from app.modules.irongs.sql_bridge import upsert_presence

    target = _legacy_target(db, item)
    if target is not None and target.closed_at is not None:
        raise HTTPException(409, detail="Journée clôturée : modification refusée. Une correction post-clôture est nécessaire.")
    before = _presence_state(target) if target is not None else None
    record = upsert_presence(db, item, collection)
    row = db.get(DailyPresence, record.get("backendId")) if isinstance(record, dict) and record.get("backendId") else None
    if row is not None:
        after = _presence_state(row)
        if before != after:
            employee = db.get(Employee, row.employee_id)
            _append_event(db, employee=employee, row=row, event_type=EVENT_STATUS, source=SOURCE_IMPORT, actor=None,
                          data={"collection": collection, "before": before, "after": after})
    return record


def legacy_delete_presence(db: Session, row: DailyPresence) -> None:
    from app.modules.attendance.models import EVENT_STATUS, SOURCE_IMPORT

    if row.closed_at is not None:
        raise HTTPException(409, detail="Journée clôturée : suppression refusée.")
    employee = db.get(Employee, row.employee_id)
    if employee is not None:
        _append_event(db, employee=employee, row=row, event_type=EVENT_STATUS, source=SOURCE_IMPORT, actor=None,
                      data={"deleted": True, "before": _presence_state(row)})
