"""Feuilles de présence par rotation — Pointage & Planning intelligent V3, lot 1.

LE POINTAGE RÉEL EST UN FAIT : `attendance_events` reste le journal append-only, jamais
réécrit. La feuille est un REGROUPEMENT opérationnel de ces faits pour une rotation d'un site
(une ligne par employé) ; elle se contente de référencer les événements.

Règles (toutes paramétrées par site, `RotationSetting` — rien n'est codé en dur) :
- fenêtre d'une rotation : `first_shift_time` + k × `shift_minutes` (heure locale du site) ;
- une ARRIVÉE moins de `early_margin_minutes` avant le début d'une rotation appartient à
  cette rotation (prise de poste anticipée) ;
- une SORTIE est rattachée à la feuille de SON entrée (traverse la fin de rotation et minuit) ;
- une feuille dépassée passe à CLOSED sans dépendre d'un cron : rattrapage idempotent à
  chaque accès et à chaque événement, en plus du passage planifié ;
- CLOSED ⇒ ARCHIVED après `attendance_sheet_archive_after_hours` : une entrée restée sans
  sortie est alors constatée (DEPART_MANQUANT) ; l'événement brut n'est jamais touché.

Un site sans paramètres actifs n'a pas de feuille : comportement historique inchangé.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.attendance.models import (
    EVENT_ARRIVAL,
    EVENT_DEPARTURE,
    LINE_OUT,
    LINE_PRESENT,
    SHEET_ARCHIVED,
    SHEET_CLOSED,
    SHEET_OPEN,
    AttendanceEvent,
    AttendanceSheet,
    AttendanceSheetEvent,
    AttendanceSheetLine,
    RotationSetting,
)
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site

logger = logging.getLogger(__name__)

ANOMALY_MISSING_DEPARTURE = "DEPART_MANQUANT"
MINUTES_PER_DAY = 24 * 60
MIN_SHIFT_MINUTES = 60
_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


@dataclass(frozen=True)
class Window:
    """Fenêtre d'une rotation, en heure locale du site (timezone-aware)."""
    start: datetime
    end: datetime
    slot_index: int


# ── Paramètres ───────────────────────────────────────────────────────────────────────────
def validate_setting(first_shift_time: str, shift_minutes: int, groups_count: int, early_margin_minutes: int) -> None:
    """Refuse une configuration qui ne découpe pas la journée en rotations entières."""
    if not _HHMM.match(str(first_shift_time or "")):
        raise ValueError("Heure du premier poste invalide (format HH:MM)")
    if shift_minutes < MIN_SHIFT_MINUTES or MINUTES_PER_DAY % shift_minutes != 0:
        raise ValueError("La durée d'une rotation doit diviser 24 h (ex. 8 h, 12 h, 24 h)")
    if not 1 <= groups_count <= 26:
        raise ValueError("Nombre de groupes invalide")
    if not 0 <= early_margin_minutes < shift_minutes:
        raise ValueError("La marge d'arrivée anticipée doit être inférieure à la durée d'une rotation")


def default_setting() -> dict[str, Any]:
    """Valeurs INITIALES proposées (configuration applicative), jamais appliquées d'office."""
    shift = int(settings.attendance_rotation_default_shift_minutes)
    return {
        "first_shift_time": "06:00",
        "shift_minutes": shift,
        "groups_count": int(settings.attendance_rotation_default_groups),
        "early_margin_minutes": min(int(settings.attendance_sheet_early_margin_minutes), max(0, shift - 1)),
    }


def setting_for(db: Session, site_id: int | None) -> RotationSetting | None:
    if site_id is None or not settings.rotation_sheets_enabled:
        return None
    row = db.execute(select(RotationSetting).where(RotationSetting.site_id == site_id)).scalar_one_or_none()
    return row if row is not None and row.active else None


def setting_out(row: RotationSetting | None) -> dict[str, Any]:
    if row is None:
        return {"configured": False, **default_setting()}
    return {"configured": bool(row.active), "first_shift_time": row.first_shift_time, "shift_minutes": row.shift_minutes,
            "groups_count": row.groups_count, "early_margin_minutes": row.early_margin_minutes,
            "version": row.version, "updated_by": row.updated_by,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None}


# ── Fenêtre de rotation (fonction pure) ──────────────────────────────────────────────────
def window_at(setting: RotationSetting, at_local: datetime, *, arrival: bool = False) -> Window:
    """Rotation contenant `at_local`. Pour une ARRIVÉE, la marge d'anticipation avance la
    frontière : 13 h 10 pour un poste à 14 h 00 (marge 60 min) ⇒ rotation 14 h–22 h."""
    hour, minute = (int(part) for part in setting.first_shift_time.split(":"))
    moment = at_local + timedelta(minutes=setting.early_margin_minutes if arrival else 0)
    day_start = datetime.combine(moment.date(), time(hour, minute), tzinfo=at_local.tzinfo)
    if moment < day_start:
        day_start -= timedelta(days=1)
    slot = int((moment - day_start).total_seconds() // 60) // setting.shift_minutes
    start = day_start + timedelta(minutes=slot * setting.shift_minutes)
    return Window(start=start, end=start + timedelta(minutes=setting.shift_minutes), slot_index=slot)


# ── Création idempotente ─────────────────────────────────────────────────────────────────
def _get_or_create_sheet(db: Session, site: Site, setting: RotationSetting, window: Window, source: str) -> AttendanceSheet:
    from app.modules.attendance import core
    from app.modules.ops.routes import _site_society

    start_utc = core.to_utc_naive(window.start)
    lookup = select(AttendanceSheet).where(AttendanceSheet.site_id == site.id, AttendanceSheet.window_start == start_utc)
    sheet = db.execute(lookup).scalar_one_or_none()
    if sheet is not None:
        return sheet
    sheet = AttendanceSheet(
        society=_site_society(site) or None, site_id=site.id, window_start=start_utc,
        window_end=core.to_utc_naive(window.end), local_date=window.start.date(), slot_index=window.slot_index,
        status=SHEET_OPEN, source=source, planning_version=setting.version,
    )
    try:
        with db.begin_nested():
            db.add(sheet)
            db.flush()
        return sheet
    except IntegrityError:
        # Créée en parallèle par un autre pointage : la contrainte unique garantit UNE feuille.
        return db.execute(lookup).scalar_one()


def _get_or_create_line(db: Session, sheet: AttendanceSheet, employee_id: int, declared_group: str | None) -> AttendanceSheetLine:
    lookup = select(AttendanceSheetLine).where(AttendanceSheetLine.sheet_id == sheet.id, AttendanceSheetLine.employee_id == employee_id)
    line = db.execute(lookup).scalar_one_or_none()
    if line is not None:
        return line
    line = AttendanceSheetLine(sheet_id=sheet.id, employee_id=employee_id, declared_group=declared_group or None,
                               state=LINE_PRESENT, events_count=0)
    try:
        with db.begin_nested():
            db.add(line)
            db.flush()
        return line
    except IntegrityError:
        return db.execute(lookup).scalar_one()


# ── Clôture / archivage (idempotents, sans dépendre d'un cron) ───────────────────────────
def close_due(db: Session, now_utc: datetime, site_ids: set[int] | list[int] | None = None, closed_by: str = "system") -> int:
    """OPEN ⇒ CLOSED pour toute feuille dont la fenêtre est terminée. Un seul UPDATE
    conditionnel : rejouable et sûr en concurrence (jamais deux clôtures d'une même feuille)."""
    statement = (update(AttendanceSheet)
                 .where(AttendanceSheet.status == SHEET_OPEN, AttendanceSheet.window_end <= now_utc)
                 .values(status=SHEET_CLOSED, closed_at=now_utc, closed_by=closed_by))
    if site_ids is not None:
        statement = statement.where(AttendanceSheet.site_id.in_(list(site_ids)))
    return int(db.execute(statement.execution_options(synchronize_session=False)).rowcount or 0)


def archive_due(db: Session, now_utc: datetime, site_ids: set[int] | list[int] | None = None) -> int:
    """CLOSED ⇒ ARCHIVED après le délai configuré ; les entrées restées sans sortie sont
    constatées (DEPART_MANQUANT). Les événements bruts ne sont pas modifiés."""
    limit = now_utc - timedelta(hours=max(1, int(settings.attendance_sheet_archive_after_hours)))
    due = select(AttendanceSheet.id).where(AttendanceSheet.status == SHEET_CLOSED, AttendanceSheet.window_end <= limit)
    if site_ids is not None:
        due = due.where(AttendanceSheet.site_id.in_(list(site_ids)))
    ids = list(db.execute(due).scalars().all())
    if not ids:
        return 0
    archived = db.execute(
        update(AttendanceSheet).where(AttendanceSheet.id.in_(ids), AttendanceSheet.status == SHEET_CLOSED)
        .values(status=SHEET_ARCHIVED, archived_at=now_utc).execution_options(synchronize_session=False)
    ).rowcount or 0
    db.execute(
        update(AttendanceSheetLine)
        .where(AttendanceSheetLine.sheet_id.in_(ids), AttendanceSheetLine.state == LINE_PRESENT,
               AttendanceSheetLine.last_exit_at.is_(None), AttendanceSheetLine.anomaly.is_(None))
        .values(anomaly=ANOMALY_MISSING_DEPARTURE, updated_at=now_utc).execution_options(synchronize_session=False)
    )
    return int(archived)


def maintain(db: Session, now: datetime | None = None, site_ids: set[int] | list[int] | None = None,
             *, ensure_current: bool = True, source: str = "ACCESS") -> dict[str, int]:
    """Rattrapage complet : clôt et archive ce qui est dû, puis s'assure que la feuille de la
    rotation en cours existe pour chaque site configuré du périmètre. Idempotent."""
    from app.modules.attendance import core

    local = (now or datetime.now(core.TZ)).astimezone(core.TZ)
    now_utc = core.to_utc_naive(local)
    closed = close_due(db, now_utc, site_ids)
    archived = archive_due(db, now_utc, site_ids)
    created = 0
    if ensure_current and settings.rotation_sheets_enabled:
        query = select(RotationSetting).where(RotationSetting.active == 1)
        if site_ids is not None:
            query = query.where(RotationSetting.site_id.in_(list(site_ids)))
        for setting in db.execute(query).scalars().all():
            site = db.get(Site, setting.site_id)
            if site is None or not site.active:
                continue
            before = db.execute(select(func.count(AttendanceSheet.id)).where(AttendanceSheet.site_id == site.id)).scalar_one()
            _get_or_create_sheet(db, site, setting, window_at(setting, local), source)
            after = db.execute(select(func.count(AttendanceSheet.id)).where(AttendanceSheet.site_id == site.id)).scalar_one()
            created += int(after) - int(before)
    # Planning intelligent (lot 2) : une feuille clôturée devient une observation du modèle du
    # site. Fait ICI (accès, orchestrateur), jamais dans le chemin du pointage ; sans effet tant
    # que l'apprentissage n'est pas activé explicitement.
    from app.modules.attendance import learning
    learning.learn_pending(db, site_ids)
    return {"closed": closed, "archived": archived, "created": created}


def run_scheduled_maintenance() -> dict[str, int]:
    """Passage planifié (orchestrateur) : complément du rattrapage à l'accès, jamais la seule
    garantie de clôture."""
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        result = maintain(db, source="SCHEDULER")
        db.commit()
        return result


# ── Rattachement d'un événement ──────────────────────────────────────────────────────────
def attach_event(db: Session, *, event: AttendanceEvent, employee: Employee, site: Site | None,
                 assignment: Assignment | None, now: datetime) -> AttendanceSheetLine | None:
    """Reflète un événement ARRIVÉE/DÉPART dans la feuille de sa rotation. L'employé est déjà
    verrouillé par Attendance Core : ses lignes ne sont jamais mises à jour en parallèle."""
    from app.modules.attendance import core

    if site is None or event.event_type not in (EVENT_ARRIVAL, EVENT_DEPARTURE):
        return None
    setting = setting_for(db, site.id)
    if setting is None:
        return None
    if db.get(AttendanceSheetEvent, event.id) is not None:
        return None                                                   # déjà rattaché (rejouable)
    local = now.astimezone(core.TZ)
    now_utc = core.to_utc_naive(local)
    close_due(db, now_utc, [site.id])

    line: AttendanceSheetLine | None = None
    if event.event_type == EVENT_DEPARTURE:
        # La sortie ferme la ligne de SON entrée, même si la rotation est terminée entre-temps.
        line = db.execute(
            select(AttendanceSheetLine).join(AttendanceSheet, AttendanceSheet.id == AttendanceSheetLine.sheet_id)
            .where(AttendanceSheetLine.employee_id == employee.id, AttendanceSheetLine.state == LINE_PRESENT,
                   AttendanceSheet.site_id == site.id, AttendanceSheet.status != SHEET_ARCHIVED)
            .order_by(AttendanceSheetLine.first_entry_at.desc(), AttendanceSheetLine.id.desc()).limit(1)
        ).scalar_one_or_none()
    if line is None:
        window = window_at(setting, local, arrival=event.event_type == EVENT_ARRIVAL)
        sheet = _get_or_create_sheet(db, site, setting, window, "EVENT")
        line = _get_or_create_line(db, sheet, employee.id, assignment.group_code if assignment else None)

    if event.event_type == EVENT_ARRIVAL:
        if line.first_entry_at is None:
            line.first_entry_at = event.occurred_at
        line.state = LINE_PRESENT
    else:
        line.last_exit_at = event.occurred_at
        line.state = LINE_OUT
        line.anomaly = None if line.anomaly == ANOMALY_MISSING_DEPARTURE else line.anomaly
    line.events_count = int(line.events_count or 0) + 1
    line.last_event_id = event.id
    line.updated_at = now_utc
    db.add(AttendanceSheetEvent(event_id=event.id, sheet_id=line.sheet_id, line_id=line.id))
    db.flush()
    return line


def attach_event_safely(db: Session, **kwargs: Any) -> AttendanceSheetLine | None:
    """Jamais bloquant : le fait est déjà enregistré par Attendance Core. Une erreur de feuille
    est annulée dans son point de sauvegarde et journalisée ; le pointage est validé quand même."""
    try:
        with db.begin_nested():
            return attach_event(db, **kwargs)
    except Exception:  # noqa: BLE001 — isolation volontaire du chemin critique de pointage
        logger.exception("Feuille de présence : rattachement impossible (pointage conservé)")
        return None


# ── Lecture ──────────────────────────────────────────────────────────────────────────────
def _hms(value: datetime | None) -> str:
    from app.modules.attendance import core
    return core.to_local(value).strftime("%H:%M:%S") if value else ""


def sheet_out(db: Session, sheet: AttendanceSheet, *, counts: bool = True) -> dict[str, Any]:
    from app.modules.attendance import core

    start, end = core.to_local(sheet.window_start), core.to_local(sheet.window_end)
    out: dict[str, Any] = {
        "id": sheet.id, "site_id": sheet.site_id, "society": sheet.society or "", "status": sheet.status,
        "date": sheet.local_date.isoformat(), "slot_index": sheet.slot_index,
        "start": start.strftime("%H:%M"), "end": end.strftime("%H:%M"),
        "window_start": start.isoformat(), "window_end": end.isoformat(),
        "label": f"{start.strftime('%H:%M')} – {end.strftime('%H:%M')}",
        "expected_group": sheet.expected_group, "source": sheet.source, "planning_version": sheet.planning_version,
        "closed_at": core.to_local(sheet.closed_at).isoformat() if sheet.closed_at else None,
        "closed_by": sheet.closed_by,
        "archived_at": core.to_local(sheet.archived_at).isoformat() if sheet.archived_at else None,
    }
    if counts:
        rows = db.execute(select(AttendanceSheetLine.state, AttendanceSheetLine.declared_group, AttendanceSheetLine.anomaly)
                          .where(AttendanceSheetLine.sheet_id == sheet.id)).all()
        groups: dict[str, int] = {}
        for _state, group, _anomaly in rows:
            if group:
                groups[group] = groups.get(group, 0) + 1
        out.update({
            "lines_count": len(rows),
            "present_count": sum(1 for state, _g, _a in rows if state == LINE_PRESENT),
            "out_count": sum(1 for state, _g, _a in rows if state == LINE_OUT),
            "anomalies_count": sum(1 for _s, _g, anomaly in rows if anomaly),
            # Groupe OBSERVÉ = groupe déclaré majoritaire des présents (explicable ; l'apprentissage
            # des groupes relève des lots suivants). None tant qu'aucun groupe n'est déclaré.
            "observed_group": max(sorted(groups), key=lambda name: groups[name]) if groups else None,
            "groups": groups,
        })
    return out


def lines_out(db: Session, sheet: AttendanceSheet) -> list[dict[str, Any]]:
    from app.modules.attendance import core

    site = db.get(Site, sheet.site_id)
    site_name = (site.name or site.indicatif or "") if site else ""
    rows = db.execute(
        select(AttendanceSheetLine, Employee).join(Employee, Employee.id == AttendanceSheetLine.employee_id)
        .where(AttendanceSheetLine.sheet_id == sheet.id)
        .order_by(AttendanceSheetLine.first_entry_at.desc().nullslast(), AttendanceSheetLine.id.desc())
    ).all()
    out = []
    for line, employee in rows:
        card = core._employee_card(employee, site_name)
        out.append({
            "id": line.id, "employee_id": employee.id, "matricule": employee.code,
            "name": f"{employee.last_name or ''} {employee.first_name or ''}".strip(),
            "fonction": employee.position or "", "site": site_name, "photo": card.get("photo", ""),
            "first_entry": _hms(line.first_entry_at), "last_exit": _hms(line.last_exit_at),
            "state": line.state, "events_count": line.events_count, "declared_group": line.declared_group,
            "anomaly": line.anomaly,
        })
    return out


def line_events_out(db: Session, sheet: AttendanceSheet) -> dict[int, list[dict[str, Any]]]:
    """Événements BRUTS rattachés à la feuille, par ligne (historique complet, dans l'ordre)."""
    rows = db.execute(
        select(AttendanceSheetEvent.line_id, AttendanceEvent)
        .join(AttendanceEvent, AttendanceEvent.id == AttendanceSheetEvent.event_id)
        .where(AttendanceSheetEvent.sheet_id == sheet.id).order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
    ).all()
    out: dict[int, list[dict[str, Any]]] = {}
    for line_id, event in rows:
        out.setdefault(line_id, []).append({
            "id": event.id, "type": "ENTREE" if event.event_type == EVENT_ARRIVAL else "SORTIE",
            "heure": _hms(event.occurred_at), "source": event.source, "actor": event.actor_label or "",
        })
    return out


def active_view(db: Session, site_id: int, now: datetime | None = None) -> dict[str, Any]:
    """Feuille ACTIVE d'un site (rotation en cours) + arrivées anticipées de la rotation
    suivante. Effectue le rattrapage de clôture avant de lire."""
    from app.modules.attendance import core

    local = (now or datetime.now(core.TZ)).astimezone(core.TZ)
    setting = setting_for(db, site_id)
    if setting is None:
        return {"configured": False, "site_id": site_id, "sheet": None, "next": None, "server_time": local.isoformat()}
    site = db.get(Site, site_id)
    maintain(db, local, [site_id])
    current = window_at(setting, local)
    sheet = _get_or_create_sheet(db, site, setting, current, "ACCESS")
    upcoming = db.execute(
        select(AttendanceSheet).where(AttendanceSheet.site_id == site_id,
                                      AttendanceSheet.window_start == core.to_utc_naive(current.end))
    ).scalar_one_or_none()
    next_out = None
    if upcoming is not None:
        next_lines = lines_out(db, upcoming)
        if next_lines:
            next_out = {**sheet_out(db, upcoming), "lines": next_lines}
    return {"configured": True, "site_id": site_id, "setting": setting_out(setting),
            "sheet": {**sheet_out(db, sheet), "lines": lines_out(db, sheet)}, "next": next_out,
            "server_time": local.isoformat()}
