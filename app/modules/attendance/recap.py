"""Historique et récapitulatifs Attendance d'un salarié (lot 4).

Rien n'est stocké : tout est CALCULÉ à la demande depuis les sources existantes —
`attendance_events` (faits et instantanés comptabilisés), `attendance_anomalies`, l'audit (tentatives
refusées), le planning officiel et les affectations. Nombre de requêtes constant quelle que soit
la période (aucune requête par jour).

Le récapitulatif fournit des FAITS : il ne produit jamais d'appréciation (conduite, fraude,
sanction, avis, renouvellement). Une tentative refusée figure dans l'historique mais n'est jamais
additionnée comme temps de présence. La vacation supplémentaire porte un traitement
« À_QUALIFIER » : récupération ou paiement ne sont pas décidés ici.
Voir docs/attendance-employee-recap.md.
"""
from __future__ import annotations

import json
from calendar import monthrange
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.attendance import core, counted, official
from app.modules.attendance.models import (
    ANOMALY_DISMISSED,
    ANOMALY_OPEN,
    ANOMALY_RESOLVED,
    EVENT_ARRIVAL,
    EVENT_DEPARTURE,
    SOURCE_MANUAL,
    AttendanceAnomaly,
    AttendanceEvent,
)
from app.modules.auth.models import AuditEvent
from app.modules.drh.models import Contract, Employee
from app.modules.ops.models import Assignment, RotationTemplate, Site

TREATMENT_TO_QUALIFY = "A_QUALIFIER"               # récupération / paiement : décision humaine à venir
TREATMENT_LABELS = {TREATMENT_TO_QUALIFY: "À qualifier (récupération ou paiement)"}
REFUSAL_ACTIONS = tuple(f"attendance.{code.lower()}" for code in sorted(counted.REFUSALS))
RELIEF_ANOMALIES = (counted.ANOMALY_UNCLOSED,)     # anomalies de relève : vacation restée sans sortie
MAX_PERIOD_DAYS = 366 * 6


def month_bounds(month: str) -> tuple[date, date]:
    try:
        year, number = (int(part) for part in month.split("-"))
        return date(year, number, 1), date(year, number, monthrange(year, number)[1])
    except (ValueError, TypeError):
        raise ValueError("Mois invalide (AAAA-MM)") from None


def _hours(minutes: int) -> float:
    return round(minutes / 60, 2)


def _in_scope(site_id: int | None, site_ids: set[int] | None) -> bool:
    return site_ids is None or site_id in site_ids


# ── Sources (une requête chacune) ────────────────────────────────────────────────────────
def _planned(db: Session, employee_id: int, start: date, end: date, site_ids: set[int] | None) -> tuple[list[dict[str, Any]], int]:
    """Vacations PLANIFIÉES par le planning officiel sur la période (affectation en vigueur chaque
    jour). Renvoie aussi le nombre de jours postés dont la rotation n'est pas configurée."""
    assignments = db.execute(select(Assignment).where(
        Assignment.employee_id == employee_id, Assignment.start_date <= end,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= start),
    ).order_by(Assignment.active.desc(), Assignment.id.desc())).scalars().all()
    posted = [a for a in assignments if official.is_posted(a) and _in_scope(a.site_id, site_ids)]
    if not posted:
        return [], 0
    anchors = official.anchors_for(db, {a.site_id for a in posted})
    # Modèles gardés en mémoire pendant la projection : `shift_on` les relit sans nouvelle requête.
    models = db.execute(select(RotationTemplate).where(RotationTemplate.id.in_({a.rotation_id for a in posted if a.rotation_id} or {0}))).scalars().all()  # noqa: F841
    planned, unconfigured = [], 0
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        current = next((a for a in assignments if a.start_date <= day and (a.end_date is None or a.end_date >= day)), None)
        if current is None or current not in posted:
            continue
        plan = official.shift_on(db, current, day, anchors=anchors)
        if not plan["official"]:
            unconfigured += 1
        elif plan["working"]:
            planned.append({"date": day.isoformat(), "site_id": current.site_id, "group": plan["group"], "shift": plan["shift"],
                            "scheduled_start": plan["scheduled_start"].isoformat(), "scheduled_end": plan["scheduled_end"].isoformat()})
    return planned, unconfigured


def _shifts(db: Session, employee_id: int, start: date, end: date, site_ids: set[int] | None) -> list[dict[str, Any]]:
    """Vacations RÉALISÉES : chaque entrée et sa sortie, avec l'instantané comptabilisé figé au
    pointage. Rattachées à la journée où la vacation commence (une Nuit reste sur son jour)."""
    events = db.execute(select(AttendanceEvent).where(
        AttendanceEvent.employee_id == employee_id, AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)),
        AttendanceEvent.presence_date >= start - timedelta(days=1), AttendanceEvent.presence_date <= end + timedelta(days=1),
    ).order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars().all()
    rows: list[dict[str, Any]] = []
    opened: dict[str, Any] | None = None
    for event in events:
        local = core.to_local(event.occurred_at).isoformat(timespec="seconds")
        snapshot = counted.view(event.data) or {}
        if event.event_type == EVENT_ARRIVAL:
            opened = {
                "date": snapshot.get("work_date") or event.presence_date.isoformat(), "site_id": event.site_id,
                "group": snapshot.get("group"), "kind": snapshot.get("kind"), "kind_label": snapshot.get("kind_label"),
                "shift": snapshot.get("shift"), "shift_label": snapshot.get("shift_label"),
                "scheduled_start": snapshot.get("scheduled_start"), "scheduled_end": snapshot.get("scheduled_end"),
                "entry_status": snapshot.get("entry_status"), "entry_status_label": snapshot.get("entry_status_label"),
                "actual_entry": local, "actual_exit": None, "counted_start": snapshot.get("counted_start"),
                "counted_end": None, "counted_minutes": None, "entry_source": event.source, "exit_source": None,
                "entry_actor": event.actor_label or "", "manual": event.source == SOURCE_MANUAL, "reason": event.observation or "",
                "entry_event_id": event.id, "exit_event_id": None, "open": True,
                "treatment": TREATMENT_TO_QUALIFY if snapshot.get("kind") == counted.KIND_EXTRA else None,
            }
            rows.append(opened)
        elif opened is not None:
            opened.update({"actual_exit": local, "exit_source": event.source, "exit_event_id": event.id, "open": False,
                           "counted_end": snapshot.get("counted_end"), "counted_minutes": snapshot.get("counted_minutes"),
                           "manual": opened["manual"] or event.source == SOURCE_MANUAL})
            opened = None
    return [row for row in rows if start.isoformat() <= row["date"] <= end.isoformat() and _in_scope(row["site_id"], site_ids)]


def _anomalies(db: Session, employee_id: int, start: date, end: date, site_ids: set[int] | None) -> list[dict[str, Any]]:
    rows = db.execute(select(AttendanceAnomaly).where(
        AttendanceAnomaly.employee_id == employee_id, AttendanceAnomaly.presence_date >= start, AttendanceAnomaly.presence_date <= end,
    ).order_by(AttendanceAnomaly.presence_date, AttendanceAnomaly.id)).scalars().all()
    return [{"id": a.id, "date": a.presence_date.isoformat(), "type": a.anomaly_type, "severity": a.severity, "status": a.status,
             "message": a.message, "site_id": a.site_id, "event_id": a.event_id, "source": a.source,
             "resolution": a.resolution, "resolved_by": a.resolved_by,
             "resolved_at": core.to_local(a.resolved_at).isoformat(timespec="seconds") if a.resolved_at else None}
            for a in rows if _in_scope(a.site_id, site_ids)]


def _refusals(db: Session, employee: Employee, start: date, end: date, site_ids: set[int] | None) -> list[dict[str, Any]]:
    """Tentatives REFUSÉES (audit) : visibles dans l'historique, jamais comptées comme présence."""
    # L'audit est écrit au moment de la tentative : jamais avant elle. La date retenue est celle
    # de la tentative elle-même (heure réelle figée dans l'audit).
    since = core.to_utc_naive(datetime.combine(start - timedelta(days=1), time.min, core.TZ))
    rows = db.execute(select(AuditEvent).where(
        AuditEvent.action.in_(REFUSAL_ACTIONS), AuditEvent.resource == "attendance_event", AuditEvent.resource_id == str(employee.id),
        AuditEvent.result == "refused", AuditEvent.created_at >= since,
    ).order_by(AuditEvent.id)).scalars().all()
    out = []
    for row in rows:
        try:
            state = json.loads(row.new_state or "{}")
        except ValueError:
            continue
        # L'audit désigne l'employé par identifiant ET matricule : les deux doivent concorder.
        if state.get("matricule") not in (None, employee.code) or not _in_scope(state.get("site_id"), site_ids):
            continue
        at = state.get("actual_entry") or core.to_local(row.created_at).isoformat(timespec="seconds")
        if not start.isoformat() <= at[:10] <= end.isoformat():
            continue
        out.append({"id": row.id, "date": at[:10], "at": at,
                    "code": state.get("code"), "label": counted.ENTRY_STATUS_LABELS.get(state.get("code") or ""),
                    "message": state.get("message"), "source": state.get("source"), "site_id": state.get("site_id"),
                    "terminal": state.get("terminal"), "actor": row.username or "", "shift": state.get("shift"),
                    "scheduled_start": state.get("scheduled_start"), "recorded": False})
    return out


# ── Synthèse (faits, aucune appréciation) ────────────────────────────────────────────────
def summarize(planned: list[dict], shifts: list[dict], anomalies: list[dict], refusals: list[dict], unconfigured_days: int = 0) -> dict[str, Any]:
    normal = [s for s in shifts if s["kind"] == counted.KIND_NORMAL]
    extra = [s for s in shifts if s["kind"] == counted.KIND_EXTRA]
    counted_rows = normal + extra
    normal_minutes = sum(s["counted_minutes"] or 0 for s in normal)
    extra_minutes = sum(s["counted_minutes"] or 0 for s in extra)
    by_code: dict[str, int] = {}
    for refusal in refusals:
        by_code[refusal["code"] or "?"] = by_code.get(refusal["code"] or "?", 0) + 1
    by_type: dict[str, int] = {}
    for anomaly in anomalies:
        by_type[anomaly["type"]] = by_type.get(anomaly["type"], 0) + 1
    treatments: dict[str, int] = {}
    for shift in extra:
        treatments[shift["treatment"]] = treatments.get(shift["treatment"], 0) + 1
    return {
        "planned_shifts": len(planned), "worked_shifts": len(normal), "unconfigured_days": unconfigured_days,
        "counted_minutes": normal_minutes, "counted_hours": _hours(normal_minutes),
        "early_arrivals": sum(1 for s in normal if s["scheduled_start"] and s["actual_entry"] < s["scheduled_start"]),
        "late_arrivals": by_type.get("LATE", 0),                      # retard = anomalie LATE existante (tolérance déjà définie)
        "early_exits": sum(1 for s in counted_rows if s["actual_exit"] and s["actual_exit"] < s["scheduled_end"]),
        "late_exits": sum(1 for s in counted_rows if s["actual_exit"] and s["actual_exit"] > s["scheduled_end"]),
        "extra_shifts": len(extra), "extra_counted_minutes": extra_minutes, "extra_counted_hours": _hours(extra_minutes),
        "extra_treatments": treatments,
        "other_presences": len(shifts) - len(counted_rows),            # présences hors travail posté (règles historiques)
        "open_shifts": sum(1 for s in shifts if s["open"]),
        "refused_attempts": len(refusals), "refused_by_code": by_code,
        "relief_anomalies": sum(by_type.get(kind, 0) for kind in RELIEF_ANOMALIES),
        "manual_entries": sum(1 for s in shifts if s["manual"]),
        "anomalies_total": len(anomalies), "anomalies_by_type": by_type,
        "anomalies_open": sum(1 for a in anomalies if a["status"] == ANOMALY_OPEN),
        "anomalies_resolved": sum(1 for a in anomalies if a["status"] == ANOMALY_RESOLVED),
        "anomalies_dismissed": sum(1 for a in anomalies if a["status"] == ANOMALY_DISMISSED),
        "regularisations": sum(1 for a in anomalies if a["status"] in (ANOMALY_RESOLVED, ANOMALY_DISMISSED)) + by_type.get("CORRECTION", 0),
    }


def period(db: Session, employee: Employee, start: date, end: date, *, site_ids: set[int] | None = None) -> dict[str, Any]:
    """Historique + synthèse d'un salarié sur [start, end]. `site_ids` restreint au périmètre de
    l'appelant (None = compte global)."""
    if end < start or (end - start).days > MAX_PERIOD_DAYS:
        raise ValueError("Période invalide")
    planned, unconfigured = _planned(db, employee.id, start, end, site_ids)
    shifts = _shifts(db, employee.id, start, end, site_ids)
    anomalies = _anomalies(db, employee.id, start, end, site_ids)
    refusals = _refusals(db, employee, start, end, site_ids)
    ids = {row["site_id"] for rows in (planned, shifts, anomalies, refusals) for row in rows if row["site_id"]}
    names = dict(db.execute(select(Site.id, Site.name).where(Site.id.in_(ids or {0}))).all())
    by_event: dict[int, list[dict[str, Any]]] = {}
    for anomaly in anomalies:
        anomaly["site"] = names.get(anomaly["site_id"], "")
        if anomaly["event_id"]:
            by_event.setdefault(anomaly["event_id"], []).append(anomaly)
    for row in (*planned, *refusals):
        row["site"] = names.get(row["site_id"], "")
    for shift in shifts:
        shift["site"] = names.get(shift["site_id"], "")
        shift["treatment_label"] = TREATMENT_LABELS.get(shift["treatment"] or "")
        linked = by_event.get(shift["entry_event_id"], []) + by_event.get(shift["exit_event_id"] or 0, [])
        shift["anomalies"] = [{"id": a["id"], "type": a["type"], "status": a["status"], "resolution": a["resolution"]} for a in linked]
    return {"employee_id": employee.id, "date_from": start.isoformat(), "date_to": end.isoformat(), "materialized": False,
            "summary": summarize(planned, shifts, anomalies, refusals, unconfigured),
            "planned": planned, "history": shifts, "refusals": refusals, "anomalies": anomalies}


def monthly(db: Session, employee: Employee, month: str, *, site_ids: set[int] | None = None) -> dict[str, Any]:
    start, end = month_bounds(month)
    return {"month": month, **period(db, employee, start, end, site_ids=site_ids)}


# ── Récapitulatif contractuel ────────────────────────────────────────────────────────────
def contract_period(db: Session, employee: Employee, contract_id: int | None = None) -> dict[str, Any]:
    """Période contractuelle RÉELLE (table `contracts`). Aucune date n'est inventée : sans contrat
    portant une date de début, le récapitulatif n'est pas calculable."""
    rows = db.execute(select(Contract).where(Contract.employee_id == employee.id).order_by(Contract.id)).scalars().all()
    if contract_id is not None:
        rows = [row for row in rows if row.id == contract_id]
    dated = [row for row in rows if row.start_date is not None]
    if not dated:
        return {"computable": False, "reason": "Aucun contrat avec une date de début fiable : récapitulatif contractuel non calculable"}
    contract = max(dated, key=lambda row: (str(row.status or "").strip().lower() == "actif", row.start_date, row.id))
    if contract.end_date is not None and contract.end_date < contract.start_date:
        return {"computable": False, "reason": "Dates de contrat incohérentes : récapitulatif contractuel non calculable"}
    return {"computable": True, "contract_id": contract.id, "contract_type": contract.contract_type, "status": contract.status,
            "start_date": contract.start_date, "end_date": contract.end_date, "open_ended": contract.end_date is None}


def contract(db: Session, employee: Employee, *, site_ids: set[int] | None = None, contract_id: int | None = None,
             today: date | None = None) -> dict[str, Any]:
    """Agrégation sur la période du contrat (début → fin / renouvellement ; contrat sans fin ou en
    cours : jusqu'à aujourd'hui), avec le détail mois par mois — une seule lecture des sources."""
    info = contract_period(db, employee, contract_id)
    if not info["computable"]:
        return {"employee_id": employee.id, **info}
    today = today or core._now_local().date()
    start = info["start_date"]
    end = min(info["end_date"] or today, today)
    out = {"employee_id": employee.id, **info, "start_date": start.isoformat(),
           "end_date": info["end_date"].isoformat() if info["end_date"] else None}
    if end < start:
        return {**out, "date_from": start.isoformat(), "date_to": None, "summary": summarize([], [], [], []), "months": []}
    data = period(db, employee, start, end, site_ids=site_ids)
    months = sorted({row["date"][:7] for key in ("planned", "history", "refusals", "anomalies") for row in data[key]})
    return {**out, "date_from": data["date_from"], "date_to": data["date_to"], "materialized": False, "summary": data["summary"],
            "months": [{"month": month, "summary": summarize(*([row for row in data[key] if row["date"][:7] == month]
                                                              for key in ("planned", "history", "anomalies", "refusals")))}
                       for month in months]}
