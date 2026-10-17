"""Poste de sécurité (pointeur.irongs.com) — lecture temps réel d'Attendance Core.

LECTURE SEULE : ce module ne décide rien. Attendance Core (`core.record_scan`) reste l'unique
autorité sur l'acceptation d'un passage, ENTRÉE / SORTIE, doublon et présence. Ici :

- les passages ACCEPTÉS (événements ARRIVÉE / DÉPART en base) postérieurs à un identifiant,
  pour afficher automatiquement le dernier pointage sur le PC ;
- les REFUS récents d'un terminal (ex. employé suspendu reconnu), lus dans l'audit, pour que le
  gardien sache pourquoi aucun pointage n'a eu lieu — jamais affichés sur la tablette ;
- les compteurs canoniques du jour, calculés côté serveur avec la règle de cycle ouvert
  d'Attendance Core (une présence de nuit traverse minuit).

Règle des compteurs (journée civile, Africa/Algiers) :
- Entrées aujourd'hui : ARRIVÉES dont la journée de présence est aujourd'hui ;
- Sorties aujourd'hui : DÉPARTS survenus aujourd'hui (une sortie à 06:00 d'un poste de nuit
  commencé la veille compte aujourd'hui) ;
- Présents sur site : employés dont le dernier passage est une ARRIVÉE encore dans la fenêtre
  de cycle ouvert (16 h, 30 h en rotation 24 h) — présents de la veille au soir inclus ;
- Absents aujourd'hui : journées du jour saisies « absent ».
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.attendance import core
from app.modules.attendance import counted as counted_time
from app.modules.attendance.models import EVENT_ARRIVAL, EVENT_DEPARTURE, AttendanceEvent
from app.modules.drh.models import Employee
from app.modules.ops.models import DailyPresence, Site

MAX_EVENTS = 20
REFUSAL_WINDOW = timedelta(minutes=10)
REFUSAL_ACTIONS = ("biometrics.terminal.recognize", "biometrics.terminal.qr")
# Refus décidés par Attendance Core (travail posté) : toutes sources (QR, facial, manuel, terminal).
CORE_REFUSAL_ACTIONS = tuple(f"attendance.{code.lower()}" for code in sorted(counted_time.REFUSALS))
ALL_REFUSAL_ACTIONS = REFUSAL_ACTIONS + CORE_REFUSAL_ACTIONS
# Alertes poussées dans le flux live du Pointeur (codes canoniques).
ALERT_ANOMALY_TYPES = (counted_time.ANOMALY_UNCLOSED, counted_time.KIND_EXTRA, "MANUAL_POINTAGE")
ALERT_WINDOW = timedelta(hours=48)
ALERT_LABELS = {
    counted_time.ANOMALY_UNCLOSED: "Vacation non clôturée", counted_time.KIND_EXTRA: "Vacation supplémentaire (maintien)",
    "MANUAL_POINTAGE": "Pointage manuel",
    **{code: counted_time.ENTRY_STATUS_LABELS[code] for code in counted_time.REFUSALS},
}
SOURCE_LABELS = {"FACIAL": "Reconnaissance faciale", "QR": "QR", "MANUAL": "Saisie manuelle", "PORTAL_GPS": "Portail (GPS)",
                 "SITE_WORKFORCE": "Site Workforce", "IMPORT": "Import", "SYSTEM": "Système"}


def _site_filter(stmt, column, site_ids):
    return stmt.where(column.in_(site_ids or [-1])) if site_ids is not None else stmt


def _last_scan_by_employee(db: Session, employee_ids: set[int], since: datetime) -> dict[int, AttendanceEvent]:
    """Dernier ARRIVÉE / DÉPART de chaque employé (toutes sources, tous sites) depuis `since`
    (UTC naïf). Chaque appelant choisit ses employés parmi ceux qui ont un passage depuis
    `since` : leur dernier passage est donc toujours dans cette fenêtre, et le résultat est
    identique à une lecture complète. Sans cette borne, tout l'historique de chaque employé
    était relu à chaque relève (toutes les 2 s par poste)."""
    if not employee_ids:
        return {}
    rows = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.employee_id.in_(employee_ids), AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)),
        AttendanceEvent.occurred_at >= since,
    ).order_by(AttendanceEvent.employee_id, AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars().all()
    last: dict[int, AttendanceEvent] = {}
    for row in rows:
        last[row.employee_id] = row
    return last


def _is_present(event: AttendanceEvent | None, now_local: datetime, sites: dict[int, Site]) -> bool:
    if event is None or event.event_type != EVENT_ARRIVAL:
        return False
    elapsed = now_local - core.to_local(event.occurred_at)
    return timedelta(0) <= elapsed <= core.open_cycle_window(sites.get(event.site_id))


def summary(db: Session, site_ids: set[int] | None, now: datetime | None = None) -> dict[str, int]:
    now_local = (now or core._now_local()).astimezone(core.TZ)
    today = now_local.date()
    start_utc = core.to_utc_naive(datetime.combine(today, datetime.min.time(), core.TZ))
    window = core.to_utc_naive(now_local - core.OPEN_24H_CYCLE_MAX)
    events = db.execute(_site_filter(select(AttendanceEvent).where(
        AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)),
        AttendanceEvent.occurred_at >= min(window, start_utc)), AttendanceEvent.site_id, site_ids)).scalars().all()
    entries = sum(1 for e in events if e.event_type == EVENT_ARRIVAL and e.presence_date == today)
    exits = sum(1 for e in events if e.event_type == EVENT_DEPARTURE and e.occurred_at >= start_utc)
    candidate_ids = {e.employee_id for e in events if e.event_type == EVENT_ARRIVAL}
    last = _last_scan_by_employee(db, candidate_ids, min(window, start_utc))
    sites = {s.id: s for s in db.execute(select(Site).where(Site.id.in_({e.site_id for e in last.values() if e.site_id}))).scalars()} if last else {}
    present = sum(1 for emp_id, e in last.items() if _is_present(e, now_local, sites)
                  and (site_ids is None or e.site_id in site_ids))
    absents = len(db.execute(_site_filter(select(DailyPresence.id).where(
        DailyPresence.presence_date == today, DailyPresence.status == "absent"), DailyPresence.site_id, site_ids)).all())
    return {"entries_today": entries, "exits_today": exits, "present_now": present, "absent_today": absents}


def _event_out(event: AttendanceEvent, employee: Employee | None, current: AttendanceEvent | None, now_local: datetime,
               sites: dict[int, Site]) -> dict[str, Any]:
    local = core.to_local(event.occurred_at)
    data = event.data if isinstance(event.data, dict) else {}
    site = sites.get(event.site_id)
    site_name = data.get("siteName") or (site.name if site else "") or ""
    card = core._employee_card(employee, site_name) if employee else {}
    if current is not None and current.id == event.id:
        state = "PRESENT" if _is_present(event, now_local, sites) else ("SORTI" if event.event_type == EVENT_DEPARTURE else "INCONNU")
    else:
        state = "PRESENT" if _is_present(current, now_local, sites) else "SORTI"
    return {"id": event.id, "type": "ENTREE" if event.event_type == EVENT_ARRIVAL else "SORTIE",
            "heure": local.strftime("%H:%M:%S"), "date": local.strftime("%Y-%m-%d"), "presence_date": event.presence_date.isoformat(),
            "source": event.source, "source_label": SOURCE_LABELS.get(event.source, event.source),
            "terminal": data.get("terminal_name") or None, "site_id": event.site_id, "site": site_name,
            "state": state, "counted": counted_time.view(data), "employee": {**card, "fonction": card.get("poste", ""), "has_photo": bool(card.get("photo"))}}


def _refusal_label(employee: Employee | None, reason: str) -> str:
    status = str(getattr(employee, "status", "") or "").lower()
    if "suspend" in status or "mise a pied" in status or "mis a pied" in status:
        return "EMPLOYÉ SUSPENDU"
    if any(marker in status for marker in ("sortant", "inact", "archive", "demission", "licenc", "blacklist")):
        return "EMPLOYÉ NON ACTIF"
    return "POINTAGE NON AUTORISÉ"


def refusals(db: Session, site_ids: set[int] | None, after_id: int, now: datetime) -> list[dict[str, Any]]:
    """Refus récents d'un terminal pour un employé RECONNU (statut, consentement…), sans image."""
    import json

    from app.modules.auth.models import AuditEvent

    since = core.to_utc_naive(now.astimezone(core.TZ) - REFUSAL_WINDOW)
    rows = db.execute(select(AuditEvent).where(AuditEvent.action.in_(ALL_REFUSAL_ACTIONS), AuditEvent.result == "refused",
                                               AuditEvent.id > after_id, AuditEvent.created_at >= since)
                      .order_by(AuditEvent.id).limit(MAX_EVENTS)).scalars().all()
    out = []
    parsed = []
    for row in rows:
        try:
            parsed.append((row, json.loads(row.new_state or "{}")))
        except ValueError:
            continue
    # Un refus d'Attendance Core relayé par un terminal n'apparaît qu'une fois (celui du moteur).
    core_refused = [(state.get("matricule"), row.created_at) for row, state in parsed if row.action in CORE_REFUSAL_ACTIONS]
    for row, state in parsed:
        matricule = state.get("matricule")
        if row.action in REFUSAL_ACTIONS and any(m == matricule and abs((row.created_at - at).total_seconds()) <= 5 for m, at in core_refused):
            continue
        if not matricule or state.get("state") != "REFUSED":
            continue
        if site_ids is not None and state.get("site_id") not in site_ids:
            continue
        employee = db.execute(select(Employee).where(Employee.code == matricule)).scalar_one_or_none()
        local = core.to_local(row.created_at)
        core_row = row.action in CORE_REFUSAL_ACTIONS
        out.append({"id": row.id, "heure": local.strftime("%H:%M:%S"),
                    "label": ALERT_LABELS[state["code"]] if core_row else _refusal_label(employee, str(state.get("reason") or "")),
                    "code": state.get("code") if core_row else None, "message": state.get("message") if core_row else None,
                    "source": state.get("source") if core_row else None, "recorded": False,
                    "counted": counted_time.view({"counted": {**state, "entry_status": state["code"]}}) if core_row else None,
                    "terminal": (state.get("terminal") if core_row else (row.username or "").replace("BORNE ", "")) or None,
                    "site_id": state.get("site_id"),
                    "employee": {**core._employee_card(employee, ""), "fonction": employee.position or ""} if employee else {"matricule": matricule}})
    return out


def alerts(db: Session, site_ids: set[int] | None, now: datetime) -> list[dict[str, Any]]:
    """Anomalies OUVERTES à connaître au poste (vacation non clôturée, maintien, pointage manuel).
    Lecture seule : rafraîchir ne crée rien."""
    from app.modules.attendance.models import ANOMALY_OPEN, AttendanceAnomaly

    since = core.to_utc_naive(now.astimezone(core.TZ) - ALERT_WINDOW)
    rows = db.execute(_site_filter(select(AttendanceAnomaly).where(
        AttendanceAnomaly.anomaly_type.in_(ALERT_ANOMALY_TYPES), AttendanceAnomaly.status == ANOMALY_OPEN,
        AttendanceAnomaly.created_at >= since), AttendanceAnomaly.site_id, site_ids)
        .order_by(AttendanceAnomaly.id.desc()).limit(50)).scalars().all()
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_({r.employee_id for r in rows} or {0}))).scalars()}
    return [{"id": r.id, "code": r.anomaly_type, "label": ALERT_LABELS.get(r.anomaly_type, r.anomaly_type), "severity": r.severity,
             "message": r.message, "site_id": r.site_id, "presence_date": r.presence_date.isoformat() if r.presence_date else None,
             "event_id": r.event_id, "at": core.to_local(r.created_at).isoformat(timespec="seconds"),
             "employee": core._employee_card(employees[r.employee_id], "") if r.employee_id in employees else None}
            for r in rows]


# ── Poste de contrôle (Pointeur V5) ──────────────────────────────────────────────────────
TODO_TYPES = (counted_time.ANOMALY_UNCLOSED, counted_time.KIND_EXTRA)
TODO_LABELS = {counted_time.ANOMALY_UNCLOSED: "Vacation non clôturée", counted_time.KIND_EXTRA: "Maintien à qualifier",
               counted_time.MANUAL_ENTRY_REQUIRED: "Saisie manuelle requise"}
EXCUSED_STATUSES = ("conge", "maladie", "mission", "repos")
MOVEMENTS_LIMIT = 30
MOVEMENTS_WINDOW = timedelta(hours=24)


def _hm(value: Any) -> str | None:
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.astimezone(core.TZ).strftime("%H:%M") if value is not None else None


def _slot_out(slot: dict[str, Any] | None) -> dict[str, Any] | None:
    if slot is None:
        return None
    return {"shift": slot["shift"], "shift_label": slot["shift_label"], "group": slot["group"], "work_date": slot["work_date"].isoformat(),
            "start": _hm(slot["scheduled_start"]), "end": _hm(slot["scheduled_end"]),
            "scheduled_start": slot["scheduled_start"].isoformat(), "scheduled_end": slot["scheduled_end"].isoformat()}


def _core_refusals(db: Session, site_id: int, since: datetime) -> list[tuple[Any, dict[str, Any]]]:
    import json

    from app.modules.auth.models import AuditEvent

    rows = db.execute(select(AuditEvent).where(AuditEvent.action.in_(CORE_REFUSAL_ACTIONS), AuditEvent.result == "refused",
                                               AuditEvent.created_at >= core.to_utc_naive(since)).order_by(AuditEvent.id.desc()).limit(200)).scalars().all()
    out = []
    for row in rows:
        try:
            state = json.loads(row.new_state or "{}")
        except ValueError:
            continue
        if state.get("site_id") == site_id:
            out.append((row, state))
    return out


def control_post(db: Session, site_id: int, now: datetime, *, manual_entry: bool = False) -> dict[str, Any]:
    """Poste de contrôle d'UN site : vacation active et prochaine relève (planning officiel),
    personnes attendues / présentes / absentes / en maintien, anomalies à traiter, derniers
    mouvements. Lecture seule ; rien n'est inventé quand la rotation n'est pas configurée."""
    from app.modules.attendance import official
    from app.modules.attendance.models import ANOMALY_OPEN, AttendanceAnomaly
    from app.modules.ops.models import Assignment

    local = now.astimezone(core.TZ)
    board = official.site_shift(db, site_id=site_id, at=local)
    current = board["current"]
    site = db.get(Site, site_id)
    sites = {site_id: site} if site is not None else {}

    # Présents : dernier passage = ARRIVÉE encore dans son cycle ouvert — UNE ligne par employé.
    recent_since = core.to_utc_naive(local - core.OPEN_24H_CYCLE_MAX)
    recent = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)), AttendanceEvent.site_id == site_id,
        AttendanceEvent.occurred_at >= recent_since)).scalars().all()
    last = _last_scan_by_employee(db, {e.employee_id for e in recent if e.event_type == EVENT_ARRIVAL}, recent_since)
    present = {emp_id: e for emp_id, e in last.items() if e.site_id == site_id and _is_present(e, local, sites)}

    expected_ids: set[int] = set()
    groups: dict[int, str] = {}
    posted = db.execute(select(Assignment).where(
        Assignment.site_id == site_id, Assignment.active == 1, Assignment.work_regime == official.REGIME_POSTE_CONTINU,
        Assignment.start_date <= local.date(), (Assignment.end_date.is_(None)) | (Assignment.end_date >= local.date()))).scalars().all()
    for assignment in posted:
        groups[assignment.employee_id] = assignment.group_code
        if current is not None and assignment.group_code == current["group"]:
            expected_ids.add(assignment.employee_id)
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_(expected_ids | set(present) or {0}))).scalars()}
    expected_ids = {i for i in expected_ids if str(getattr(employees.get(i), "status", "") or "").strip().lower() in ("actif", "active")}
    excused: set[int] = set()
    if current is not None and expected_ids:
        excused = set(db.execute(select(DailyPresence.employee_id).where(
            DailyPresence.presence_date == current["work_date"], DailyPresence.employee_id.in_(expected_ids),
            DailyPresence.status.in_(EXCUSED_STATUSES))).scalars())

    def card(employee_id: int) -> dict[str, Any]:
        employee = employees.get(employee_id)
        base = core._employee_card(employee, site.name if site else "") if employee else {"id": employee_id}
        return {**base, "fonction": base.get("poste", ""), "has_photo": bool(base.get("photo")), "group": groups.get(employee_id)}

    present_rows = []
    for employee_id, event in present.items():
        snapshot = counted_time.view(event.data) or {}
        maintained = snapshot.get("kind") == counted_time.KIND_EXTRA
        present_rows.append({
            "employee": {**card(employee_id), "group": snapshot.get("group") or groups.get(employee_id)}, "event_id": event.id,
            "entry": core.to_local(event.occurred_at).strftime("%H:%M"), "entry_at": core.to_local(event.occurred_at).isoformat(timespec="seconds"),
            "shift_start": _hm(snapshot.get("scheduled_start")), "shift_end": _hm(snapshot.get("scheduled_end")),
            "shift_label": snapshot.get("shift_label"), "kind": snapshot.get("kind"),
            "badge": "EN_MAINTIEN" if maintained else "EN_POSTE", "badge_label": "EN MAINTIEN" if maintained else "EN POSTE"})
    present_rows.sort(key=lambda row: row["entry_at"], reverse=True)

    # À traiter : anomalies OUVERTES qui appellent une intervention, puis saisies manuelles requises.
    grace = timedelta(minutes=max(0, int(settings_grace())))
    open_rows = db.execute(select(AttendanceAnomaly).where(
        AttendanceAnomaly.site_id == site_id, AttendanceAnomaly.status == ANOMALY_OPEN,
        (AttendanceAnomaly.anomaly_type.in_(TODO_TYPES)) | (AttendanceAnomaly.severity == "critical"),
        AttendanceAnomaly.created_at >= core.to_utc_naive(local - ALERT_WINDOW)).order_by(AttendanceAnomaly.id.desc()).limit(50)).scalars().all()
    missing = {r.employee_id for r in open_rows if r.employee_id} - set(employees)
    employees.update({e.id: e for e in db.execute(select(Employee).where(Employee.id.in_(missing or {0}))).scalars()})
    todo = []
    for row in open_rows:
        details = row.details if isinstance(row.details, dict) else {}
        end = details.get("scheduled_end")
        todo.append({"key": f"a{row.id}", "anomaly_id": row.id, "code": row.anomaly_type,
                     "label": TODO_LABELS.get(row.anomaly_type, ALERT_LABELS.get(row.anomaly_type, row.anomaly_type)),
                     "severity": row.severity, "message": row.message, "employee": card(row.employee_id) if row.employee_id else None,
                     "scheduled_end": _hm(end) if end else None,
                     "overdue_since": _hm(datetime.fromisoformat(end) + grace) if end and row.anomaly_type == counted_time.ANOMALY_UNCLOSED else None,
                     "action": None})
    refusal_rows = _core_refusals(db, site_id, local - MOVEMENTS_WINDOW)
    seen: set[str] = set()
    codes = {e.code: e for e in employees.values()}
    for row, state in refusal_rows:
        matricule = state.get("matricule")
        if state.get("code") != counted_time.MANUAL_ENTRY_REQUIRED or matricule in seen:
            continue
        seen.add(matricule)
        end = state.get("scheduled_end")
        employee = codes.get(matricule) or db.execute(select(Employee).where(Employee.code == matricule)).scalar_one_or_none()
        if not end or datetime.fromisoformat(end) <= local or (employee is not None and employee.id in present):
            continue                                                 # créneau terminé, ou entrée saisie depuis
        if employee is not None:
            employees.setdefault(employee.id, employee)
        todo.append({"key": f"r{row.id}", "anomaly_id": None, "code": counted_time.MANUAL_ENTRY_REQUIRED,
                     "label": TODO_LABELS[counted_time.MANUAL_ENTRY_REQUIRED], "severity": "warning", "message": state.get("message"),
                     "employee": card(employee.id) if employee is not None else {"matricule": matricule},
                     "scheduled_end": _hm((state.get("previous") or {}).get("scheduled_end")), "overdue_since": _hm(state.get("window_closes_at")),
                     "action": "MANUAL_ENTRY" if manual_entry and employee is not None else None})

    # Derniers mouvements : passages acceptés ET tentatives refusées (qui ne comptent jamais comme présence).
    movement_events = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)), AttendanceEvent.site_id == site_id,
        AttendanceEvent.occurred_at >= core.to_utc_naive(local - MOVEMENTS_WINDOW),
    ).order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.id.desc()).limit(MOVEMENTS_LIMIT)).scalars().all()
    movements = []
    for event in movement_events:
        data = event.data if isinstance(event.data, dict) else {}
        kind = (data.get("counted") or {}).get("kind") if isinstance(data.get("counted"), dict) else None
        entry = event.event_type == EVENT_ARRIVAL
        kind_code = "MAINTIEN" if entry and kind == counted_time.KIND_EXTRA else ("ENTREE" if entry else "SORTIE")
        at = core.to_local(event.occurred_at)
        movements.append({"key": f"e{event.id}", "type": kind_code, "label": {"MAINTIEN": "MAINTIEN", "ENTREE": "ENTRÉE", "SORTIE": "SORTIE"}[kind_code],
                          "heure": at.strftime("%H:%M:%S"), "at": at.isoformat(timespec="seconds"), "matricule": data.get("matricule") or "",
                          "name": data.get("agentName") or "", "source": event.source, "detail": None})
    def attempted_at(row: Any, state: dict[str, Any]) -> datetime:
        # Heure RÉELLE de la tentative, figée dans l'audit.
        return datetime.fromisoformat(state["actual_entry"]) if state.get("actual_entry") else core.to_local(row.created_at)

    for row, state in refusal_rows[:MOVEMENTS_LIMIT]:
        at = attempted_at(row, state)
        movements.append({"key": f"r{row.id}", "type": "REFUS", "label": "REFUSÉ", "heure": at.strftime("%H:%M:%S"),
                          "at": at.isoformat(timespec="seconds"), "matricule": state.get("matricule") or "", "name": "",
                          "source": state.get("source"), "detail": state.get("message"), "code": state.get("code")})
    movements.sort(key=lambda row: row["at"], reverse=True)
    refused_today = sum(1 for row, state in refusal_rows if attempted_at(row, state).date() == local.date())

    # Fenêtre de maintien du site : comptée depuis la fin THÉORIQUE de la vacation précédente.
    maintien = None
    if current is not None and board["previous"] is not None:
        tfin = current["scheduled_start"]
        opens, closes = tfin + counted_time.EXTRA_NO_ENTRY, tfin + counted_time.EXTRA_WINDOW_END
        if tfin <= local <= closes:
            maintien = {"previous": _slot_out(board["previous"]), "opens_at": opens.isoformat(), "closes_at": closes.isoformat(),
                        "opens": _hm(opens), "closes": _hm(closes), "state": "OPEN" if local >= opens else "UPCOMING"}

    absent = expected_ids - set(present) - excused
    return {
        "site_id": site_id, "site": site.name if site else "", "status": board["status"], "reason": board["reason"],
        "current": _slot_out(current), "next": _slot_out(board["next"]), "maintien": maintien,
        "kpi": {"expected": len(expected_ids) if current is not None else None, "present": len(present_rows),
                "absent": len(absent) if current is not None else None, "excused": len(excused & expected_ids),
                "maintien": sum(1 for row in present_rows if row["badge"] == "EN_MAINTIEN"), "anomalies": len(todo)},
        "activity": {"refused_today": refused_today},
        "present": present_rows, "todo": todo, "movements": movements[:MOVEMENTS_LIMIT],
        "permissions": {"manual_entry": bool(manual_entry)},
    }


def settings_grace() -> int:
    from app.core.config import settings

    return settings.attendance_unclosed_shift_grace_minutes


def overview_post(db: Session, site_ids: set[int], now: datetime, manual_entry: bool) -> dict[str, Any]:
    """Même modèle canonique pour les sites sélectionnés, sans état métier parallèle."""
    posts = [control_post(db, site_id, now, manual_entry=manual_entry) for site_id in sorted(site_ids)]
    present = {r["employee"]["id"]: {**r, "site": p["site"]} for p in posts for r in p["present"]}
    todo = [{**r, "site": p["site"]} for p in posts for r in p["todo"]]
    kpi = {key: (sum(p["kpi"][key] for p in posts) if all(p["kpi"].get(key) is not None for p in posts) else None)
           for key in ("expected", "absent", "excused")}
    kpi.update(present=len(present), maintien=sum(r["badge"] == "EN_MAINTIEN" for r in present.values()), anomalies=len(todo))
    return {"site": "Sites sélectionnés", "status": "OVERVIEW", "current": None, "next": None,
            "maintien": None, "kpi": kpi, "present": list(present.values()), "todo": todo,
            "movements": [], "activity": {"refused_today": sum(p["activity"]["refused_today"] for p in posts)},
            "permissions": {"manual_entry": manual_entry}}


def live(db: Session, site_ids: set[int] | None, *, after_id: int | None, after_refusal_id: int | None, now: datetime | None = None,
         manual_entry: bool = False) -> dict[str, Any]:
    """Nouveaux passages ACCEPTÉS (id > after_id ; sans curseur : le dernier seulement), refus
    récents, compteurs. Le PC interroge cette route toutes les ~2 s."""
    now = now or core._now_local()
    now_local = now.astimezone(core.TZ)
    # Rattrapage idempotent (aucun cron requis) : une anomalie par vacation restée sans sortie.
    if counted_time.detect_unclosed(db, site_ids, now_local):
        db.commit()
    stmt = _site_filter(select(AttendanceEvent).where(AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE))),
                        AttendanceEvent.site_id, site_ids)
    latest = db.execute(stmt.order_by(AttendanceEvent.id.desc()).limit(1)).scalar_one_or_none()
    if after_id is None:
        events = [latest] if latest is not None else []
    else:
        events = db.execute(stmt.where(AttendanceEvent.id > after_id).order_by(AttendanceEvent.id).limit(MAX_EVENTS)).scalars().all()
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_({e.employee_id for e in events}))).scalars()} if events else {}
    current = _last_scan_by_employee(db, set(employees), min(e.occurred_at for e in events)) if events else {}
    site_rows = {e.site_id for e in events if e.site_id} | {e.site_id for e in current.values() if e.site_id}
    sites = {s.id: s for s in db.execute(select(Site).where(Site.id.in_(site_rows))).scalars()} if site_rows else {}
    from app.modules.auth.models import AuditEvent
    from app.modules.attendance import deviations

    # Écart de rotation éventuel de chaque passage : affiché sur la fiche, le pointage reste accepté.
    rotation_alerts = deviations.alerts_for_events(db, [e.id for e in events])
    latest_refusal = db.execute(select(AuditEvent.id).where(AuditEvent.action.in_(ALL_REFUSAL_ACTIONS)).order_by(AuditEvent.id.desc()).limit(1)).scalar_one_or_none() or 0
    return {"latest_event_id": latest.id if latest is not None else 0,
            "events": [{**_event_out(e, employees.get(e.employee_id), current.get(e.employee_id), now_local, sites),
                        "rotation_alert": rotation_alerts.get(e.id)} for e in events],
            "latest_refusal_id": latest_refusal,
            "refusals": refusals(db, site_ids, after_refusal_id, now) if after_refusal_id is not None else [],
            "alerts": alerts(db, site_ids, now), "alert_labels": dict(ALERT_LABELS),
            # Poste de contrôle : seulement pour UN site (la vacation active est celle d'un site).
            "post": control_post(db, next(iter(site_ids)), now_local, manual_entry=manual_entry) if site_ids is not None and len(site_ids) == 1 else overview_post(db, site_ids, now_local, manual_entry) if site_ids is not None else None,
            "summary": summary(db, site_ids, now), **core.operational_clock(now_local)}
