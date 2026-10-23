"""Read models of the four rotation screens (OPS configuration, OPS planning, Pointeur, BEO).

Every number comes from the engine occurrences and the canonical expected population
(service.expected_population); the browser never computes a cycle. Read-only: no write,
no anomaly creation (critical points are persisted by the existing detection transaction)."""
from calendar import monthrange
from datetime import date, datetime, timedelta

from sqlalchemy import select

from app.modules.rotations.engine import occurrences, validate
from app.modules.rotations.service import (
    ACTIVE_EMPLOYEE_STATUSES, assignment_on, configuration_at, expected_population, occurrence_key,
)

SHIFT_LABELS = {'JOUR': 'Jour', 'NUIT': 'Nuit', 'MATIN': 'Matin', 'APRES_MIDI': 'Après-midi'}
SHIFT_ORDER = {'MATIN': 0, 'JOUR': 1, 'APRES_MIDI': 2, 'NUIT': 3}
REGIME_LABELS = {'3X8': '3×8', '24H48': '24h/48', '1/2': '1/2', '1/3': '1/3', 'NORMAL': 'Horaire normal', 'CUSTOM': 'Personnalisé'}
CRITICAL_TYPES = ('UNCOVERED_SHIFT', 'UNDERSTAFFED', 'CALENDAR_UNCONFIRMED')
COVERAGE_STATUS = {'COVERED': 'Couvert', 'ATTENTION': 'Attention', 'UNDERSTAFFED': 'Sous-effectif',
                   'UNCOVERED': 'Non couvert', 'CRITICAL': 'Critique'}


def is_night(shift):
    return shift == 'NUIT'


def hm(value):
    return datetime.fromisoformat(value).strftime('%H:%M') if isinstance(value, str) else value.strftime('%H:%M')


# ── Sites et libellés ───────────────────────────────────────────────────────────────────────
def site_options(db, user):
    """Sites autorisés avec libellés lisibles (structure, client, site) ; l'identifiant ne sert
    que de valeur technique et n'est jamais un libellé."""
    from app.modules.commercial.models import Client
    from app.modules.ops.models import Site
    from app.modules.ops.routes import _allowed_assignment_site_ids, _site_society
    allowed = _allowed_assignment_site_ids(db, user)
    stmt = select(Site).where(Site.active == 1).order_by(Site.name)
    if allowed is not None:
        stmt = stmt.where(Site.id.in_(allowed or {-1}))
    sites = list(db.scalars(stmt))
    clients = {c.id: c for c in db.scalars(select(Client).where(Client.id.in_({s.client_id for s in sites if s.client_id} or {-1})))}
    today = date.today()
    items = []
    for site in sites:
        client = clients.get(site.client_id)
        cfg = configuration_at(db, site.id, today)
        items.append({'id': site.id, 'name': site.name, 'structure': _site_society(site) or None,
                      'client': (client.name if client else None) or site.client_name or None,
                      'regime': cfg.config['regime'] if cfg else None, 'version': cfg.version if cfg else None})
    return items


def overview(db, user, site_ids):
    from app.modules.attendance.models import ANOMALY_OPEN, AttendanceAnomaly
    from app.modules.rotations.models import OfficialRotation, RotationDraft
    today = date.today()
    published = select(OfficialRotation.draft_id)
    return {'active_sites': len(site_ids),
            'active_regimes': sum(1 for sid in site_ids if configuration_at(db, sid, today) is not None),
            'critical_points': db.query(AttendanceAnomaly).filter(
                AttendanceAnomaly.site_id.in_(site_ids or {-1}), AttendanceAnomaly.status == ANOMALY_OPEN,
                AttendanceAnomaly.anomaly_type.in_(CRITICAL_TYPES)).count(),
            'drafts_to_validate': db.query(RotationDraft).filter(
                RotationDraft.site_id.in_(site_ids or {-1}), ~RotationDraft.id.in_(published)).count()}


# ── Vue mensuelle (aperçu d'un brouillon ou planning publié) ────────────────────────────────
def _population_index(db, site_id):
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment
    rows = list(db.scalars(select(Assignment).where(Assignment.site_id == site_id))) if site_id else []
    employees = {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_({a.employee_id for a in rows} or {-1})))}
    return rows, employees


def _roles(regime, config):
    day = f"{config.get('day_start', '')} – {config.get('day_end', '')}" if config.get('day_start') else ''
    if regime == '1/3':
        return {'A': f'Jours ouvrés uniquement (jour, {day})', 'B': 'Nuits / week-ends / jours fériés',
                'C': 'Nuits / week-ends / jours fériés', 'D': 'Nuits / week-ends / jours fériés'}
    if regime == '24H48':
        return {g: 'Jour → Nuit → OFF → OFF' for g in 'ABCD'}
    if regime == '1/2':
        return {g: 'Vacations de 12 h en alternance' for g in 'ABCD'}
    if regime == '3X8':
        return {g: 'Matin → Après-midi → Nuit → OFF' for g in 'ABCD'}
    return {}


def month_view(db, site_id, month, *, draft_config=None):
    """Grille d'un mois : par jour, vacations (groupe, horaires, effectifs planifiés et requis),
    groupes OFF, week-end, férié, points critiques ; indicateurs, résumé et contrôles. Avec
    `draft_config`, aperçu d'un brouillon non enregistré (aucune écriture)."""
    year, number = (int(part) for part in month.split('-'))
    first, days = date(year, number, 1), monthrange(year, number)[1]
    rows, employees = _population_index(db, site_id)
    out_days, planned, versions, configs = [], set(), set(), []
    totals = {'day_slots': 0, 'night_slots': 0, 'day_staff': 0, 'night_staff': 0, 'critical': 0}
    checks = {'a_night': 0, 'a_weekend': 0, 'a_holiday': 0, 'weekend_days': 0, 'weekend_covered': 0,
              'holiday_days': 0, 'holiday_covered': 0, 'a_workdays': 0, 'a_present': 0, 'rest': 0, 'uncovered': 0,
              'understaffed': 0, 'calendar': 0}
    for offset in range(days):
        day = first + timedelta(days=offset)
        published = None if draft_config is not None else configuration_at(db, site_id, day)
        config = draft_config if draft_config is not None else (published.config if published else None)
        if config is None:
            out_days.append({'date': day.isoformat(), 'weekday': day.weekday(), 'configured': False, 'slots': [],
                             'off_groups': [], 'weekend': day.weekday() >= 5, 'holiday': False, 'critical': []})
            continue
        configs.append(config)
        if published:
            versions.add(published.version)
        computed = occurrences(config, day, 1)
        weekend, holiday = day.weekday() in config['weekend'], day.isoformat() in config['holidays']
        critical = []
        for error in computed['errors']:
            if error['code'] == 'CALENDAR_UNCONFIRMED':
                critical.append({'code': 'CALENDAR_UNCONFIRMED', 'label': 'Calendrier non confirmé'}); checks['calendar'] += 1
            elif error['code'] == 'REST_OR_OVERLAP':
                critical.append({'code': 'REST_OR_OVERLAP', 'label': 'Repos insuffisant', 'shift': error['slot']['shift']}); checks['rest'] += 1
        slots = []
        for slot in sorted(computed['slots'], key=lambda s: SHIFT_ORDER.get(s['shift'], 9)):
            full = {**slot, 'configuration_id': published.id if published else None}
            members = expected_population(db, site_id, full, assignments=rows, employees=employees) if site_id else set()
            required = config['required_staff'].get(slot['shift'], 0)
            planned |= members
            night = is_night(slot['shift'])
            totals['night_slots' if night else 'day_slots'] += 1
            totals['night_staff' if night else 'day_staff'] += len(members)
            uncovered, short = slot['group'] is None, slot['group'] is not None and site_id is not None and len(members) < required
            if uncovered:
                critical.append({'code': 'UNCOVERED_SHIFT', 'label': 'VACATION NON COUVERTE', 'shift': slot['shift']}); checks['uncovered'] += 1
            elif short:
                critical.append({'code': 'UNDERSTAFFED', 'label': 'SOUS-EFFECTIF', 'shift': slot['shift']}); checks['understaffed'] += 1
            if slot['group'] == 'A' and config['regime'] == '1/3':
                checks['a_present'] += 1
                checks['a_night'] += night or slot['night_minutes'] > 0
                checks['a_weekend'] += weekend
                checks['a_holiday'] += holiday
            slots.append({'shift': slot['shift'], 'label': SHIFT_LABELS.get(slot['shift'], slot['shift']), 'group': slot['group'],
                          'start': hm(slot['start']), 'end': hm(slot['end']), 'replacement': slot['replacement'],
                          'planned_staff': len(members) if site_id else None, 'required_staff': required,
                          'occurrence_id': occurrence_key(site_id, full) if published else None})
        if config['regime'] == '1/3':
            checks['a_workdays'] += (not weekend and not holiday)
        if weekend:
            checks['weekend_days'] += 1
            checks['weekend_covered'] += all(s['group'] and s['group'] != 'A' for s in slots)
        if holiday:
            checks['holiday_days'] += 1
            checks['holiday_covered'] += all(s['group'] and s['group'] != 'A' for s in slots)
        totals['critical'] += len(critical)
        working = {s['group'] for s in slots if s['group']}
        out_days.append({'date': day.isoformat(), 'weekday': day.weekday(), 'configured': True, 'slots': slots,
                         'off_groups': [g for g in 'ABCD' if g not in working], 'weekend': weekend, 'holiday': holiday,
                         'critical': critical})
    config = configs[-1] if configs else None
    regime = config['regime'] if config else None
    rules = []
    if regime == '1/3':
        rules = [{'label': 'Aucun groupe A en nuit', 'ok': checks['a_night'] == 0},
                 {'label': 'Aucun groupe A le week-end', 'ok': checks['a_weekend'] == 0},
                 {'label': 'Aucun groupe A les jours fériés', 'ok': checks['a_holiday'] == 0},
                 {'label': 'Week-end couvert par B/C/D', 'ok': checks['weekend_covered'] == checks['weekend_days']},
                 {'label': 'Rotation conforme au cycle 1/3', 'ok': not (checks['rest'] or checks['uncovered'] or checks['calendar'])}]
    elif regime:
        rules = [{'label': 'Toutes les vacations couvertes', 'ok': checks['uncovered'] == 0},
                 {'label': 'Repos minimal respecté', 'ok': checks['rest'] == 0},
                 {'label': 'Calendrier confirmé', 'ok': checks['calendar'] == 0}]
    if regime and site_id:
        rules.append({'label': 'Effectifs requis atteints', 'ok': checks['understaffed'] == 0})
    timings = None
    if config:
        if regime == '3X8':
            timings = [{'shift': SHIFT_LABELS[k], 'start': s['start'], 'end': s['end']} for k, s in zip(('MATIN', 'APRES_MIDI', 'NUIT'), config['shifts'])]
        elif regime == '1/2':
            start = datetime.strptime(config['first_start'], '%H:%M')
            timings = [{'shift': 'Jour', 'start': start.strftime('%H:%M'), 'end': (start + timedelta(hours=12)).strftime('%H:%M')},
                       {'shift': 'Nuit', 'start': (start + timedelta(hours=12)).strftime('%H:%M'), 'end': start.strftime('%H:%M')}]
        else:
            timings = [{'shift': 'Jour', 'start': config['day_start'], 'end': config['day_end']},
                       {'shift': 'Nuit', 'start': config['night_shift_start'], 'end': config['night_shift_end']}]
    day_count = max(1, totals['day_slots']); night_count = max(1, totals['night_slots'])
    return {'month': month, 'site_id': site_id, 'configured': bool(configs), 'regime': regime,
            'regime_label': REGIME_LABELS.get(regime), 'versions': sorted(versions), 'days': out_days,
            'period': {'start': first.isoformat(), 'end': (first + timedelta(days=days - 1)).isoformat()},
            'kpis': {'planned_staff': len(planned) if site_id else None,
                     'day_average': round(totals['day_staff'] / day_count) if site_id else None,
                     'night_average': round(totals['night_staff'] / night_count) if site_id else None,
                     'day_slots': totals['day_slots'], 'night_slots': totals['night_slots'], 'critical_points': totals['critical']},
            'summary': {'roles': _roles(regime, config) if config else {}, 'timings': timings,
                        'minimum_rest_minutes': config['minimum_rest_minutes'] if config else None,
                        'coverage': {'day_staff_total': totals['day_staff'], 'night_staff_total': totals['night_staff'],
                                     'a_days': [checks['a_present'], checks['a_workdays']] if regime == '1/3' else None,
                                     'weekends': [checks['weekend_covered'], checks['weekend_days']],
                                     'holidays': [checks['holiday_covered'], checks['holiday_days']]},
                        'conflicts': checks['rest'], 'rules': rules}}


def preview(db, site_id, config, month):
    """Aperçu d'un brouillon (aucune écriture) : validation du moteur puis vue mensuelle."""
    return month_view(db, site_id, month, draft_config=validate(config))


# ── Couverture terrain (BEO) ────────────────────────────────────────────────────────────────
def _legacy_occurrences(db, site_id, day):
    """Occurrences d'un site non adopté par le moteur central : cycle V7 historique ancré."""
    from app.modules.attendance import official
    from app.modules.ops.models import RotationTemplate
    anchors = official.anchors_for(db, {site_id})
    models = list(db.scalars(select(RotationTemplate).where(RotationTemplate.id.in_({a.rotation_id for a in anchors} or {-1}),
                                                            RotationTemplate.official == 1, RotationTemplate.active == 1)))
    out = []
    for rotation in models:
        try:
            official.validate_model(rotation)
        except ValueError:
            continue
        anchor = official._anchor_among(anchors, site_id, rotation.id, day)
        if anchor is None:
            continue
        for group in rotation.group_offsets:
            slot = official._cycle_slot(rotation, anchor, group, day)
            if slot['scheduled_start'] is None:
                continue
            out.append({'shift': slot['shift'], 'group': group, 'work_date': day.isoformat(),
                        'start': slot['scheduled_start'].isoformat(), 'end': slot['scheduled_end'].isoformat(),
                        'configuration_id': None, 'configuration_version': None, 'regime': 'V7',
                        'required_staff': None, 'late_minutes': 30, 'rotation_id': rotation.id})
    return out


def _legacy_population(db, site_id, slot):
    from app.modules.attendance import official
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment
    day = date.fromisoformat(slot['work_date'])
    ids = set(db.scalars(select(Assignment.employee_id).where(
        Assignment.site_id == site_id, Assignment.active == 1, Assignment.work_regime == official.REGIME_POSTE_CONTINU,
        Assignment.group_code == slot['group'], Assignment.start_date <= day,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= day))))
    return {e.id for e in db.scalars(select(Employee).where(Employee.id.in_(ids or {-1})))
            if str(e.status or '').strip().lower() in ACTIVE_EMPLOYEE_STATUSES}


def site_occurrences(db, site_id, day):
    """Occurrences officielles d'un site pour une date de travail : planning central publié si
    le site l'a adopté, sinon cycle V7 historique ; liste vide si aucun planning officiel."""
    cfg = configuration_at(db, site_id, day)
    if cfg is None:
        return _legacy_occurrences(db, site_id, day)
    return [{**slot, 'configuration_id': cfg.id, 'configuration_version': cfg.version, 'regime': cfg.config['regime'],
             'required_staff': cfg.config['required_staff'].get(slot['shift']), 'late_minutes': cfg.config['late_refusal_minutes']}
            for slot in occurrences(cfg.config, day, 1)['slots']]


def coverage(db, site_ids, day, *, now, shift_kind='', group='', sites=None, photo_allowed=False):
    """Couverture terrain par site et par vacation pour une date de travail. Attendus = population
    canonique de l'occurrence ; présents = arrivées rattachées à CETTE occurrence (horaire figé
    par le Core) ; absences seulement après le seuil de refus."""
    from app.modules.attendance import live
    from app.modules.attendance.models import ANOMALY_OPEN, EVENT_ARRIVAL, AttendanceAnomaly, AttendanceEvent
    from app.modules.drh.models import Employee
    from app.modules.ops.models import DailyPresence, Site
    sites = sites or {s.id: s for s in db.scalars(select(Site).where(Site.id.in_(site_ids or {-1})))}
    since = datetime.combine(day - timedelta(days=1), datetime.min.time())
    from app.modules.attendance import core
    arrivals = list(db.scalars(select(AttendanceEvent).where(
        AttendanceEvent.site_id.in_(site_ids or {-1}), AttendanceEvent.event_type == EVENT_ARRIVAL,
        AttendanceEvent.occurred_at >= since, AttendanceEvent.occurred_at < datetime.combine(day + timedelta(days=2), datetime.min.time()))))
    by_occurrence = {}
    for event in arrivals:
        snapshot = (event.data or {}).get('counted') or {}
        if snapshot.get('scheduled_start'):
            by_occurrence.setdefault((event.site_id, snapshot['scheduled_start']), {})[event.employee_id] = (event, snapshot)
    latest = live._latest_scans(db, site_ids=set(site_ids), since=core.to_utc_naive(now - core.OPEN_24H_CYCLE_MAX)) if site_ids else {}
    excused = set(db.execute(select(DailyPresence.employee_id).where(
        DailyPresence.site_id.in_(site_ids or {-1}), DailyPresence.presence_date == day,
        DailyPresence.status.in_(live.EXCUSED_STATUSES))).scalars())
    rows, unplanned = [], []
    totals = {'expected': 0, 'present': 0, 'late': 0, 'maintained': 0, 'absent': 0}
    for sid in sorted(site_ids, key=lambda i: (sites[i].name if i in sites else '', i)):
        slots = site_occurrences(db, sid, day)
        if not slots:
            unplanned.append({'site_id': sid, 'site': sites[sid].name if sid in sites else None}); continue
        for slot in slots:
            if shift_kind and (shift_kind == 'NUIT') != is_night(slot['shift']):
                continue
            if group and slot['group'] != group:
                continue
            expected = (expected_population(db, sid, slot) if slot['configuration_id'] else _legacy_population(db, sid, slot))
            start, end = datetime.fromisoformat(slot['start']), datetime.fromisoformat(slot['end'])
            attended = by_occurrence.get((sid, slot['start']), {})
            present = set(attended)                 # arrivées rattachées par le Core à CETTE occurrence
            late = {eid for eid in present if (attended[eid][1].get('late_minutes') or 0) > 0}
            maintained = {eid for eid in present if now > end and latest.get(eid) is not None
                          and latest[eid].event_type == EVENT_ARRIVAL and latest[eid].id == attended[eid][0].id}
            started = now >= start + timedelta(minutes=slot['late_minutes'] or 0)
            absent = (expected - present - excused) if started else set()
            required = slot['required_staff'] if slot['required_staff'] is not None else len(expected)
            if slot['group'] is None:
                state = 'UNCOVERED'
            elif len(expected) < required:
                state = 'UNDERSTAFFED'
            elif started and expected and not present:
                state = 'CRITICAL'
            elif started and len(present) < required:
                state = 'UNDERSTAFFED'
            elif started and len(present) < len(expected):
                state = 'ATTENTION'
            else:
                state = 'COVERED'
            measured = len(present) if now >= start else None
            rows.append({'site_id': sid, 'site': sites[sid].name if sid in sites else None,
                         'occurrence_id': occurrence_key(sid, slot), 'shift': slot['shift'],
                         'shift_label': SHIFT_LABELS.get(slot['shift'], slot['shift']), 'group': slot['group'],
                         'work_date': slot['work_date'], 'start': hm(slot['start']), 'end': hm(slot['end']),
                         'regime': slot['regime'], 'regime_label': REGIME_LABELS.get(slot['regime'], slot['regime']),
                         'configuration_version': slot['configuration_version'],
                         'expected': len(expected), 'required': required, 'present': measured,
                         'gap': (measured - len(expected)) if measured is not None else None,
                         'late': len(late), 'maintained': len(maintained), 'absent': len(absent),
                         'status': state, 'status_label': COVERAGE_STATUS[state], 'started': now >= start})
            totals['expected'] += len(expected); totals['present'] += len(present); totals['late'] += len(late)
            totals['maintained'] += len(maintained); totals['absent'] += len(absent)
    anomalies = list(db.scalars(select(AttendanceAnomaly).where(
        AttendanceAnomaly.site_id.in_(site_ids or {-1}), AttendanceAnomaly.status == ANOMALY_OPEN,
        AttendanceAnomaly.presence_date >= day - timedelta(days=1), AttendanceAnomaly.presence_date <= day)
        .order_by(AttendanceAnomaly.id.desc()).limit(200)))
    people = {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_({a.employee_id for a in anomalies if a.employee_id} or {-1})))}
    labels = {**live.ALERT_LABELS, 'LATE': 'Retard', 'ABANDON_POSTE': 'Abandon de poste', 'ABSENT': 'Absence',
              'UNDERSTAFFED': 'Sous-effectif', 'UNCOVERED_SHIFT': 'Vacation non couverte'}
    critical = [{'id': a.id, 'type': a.anomaly_type, 'label': labels.get(a.anomaly_type, a.anomaly_type),
                 'site_id': a.site_id, 'site': sites[a.site_id].name if a.site_id in sites else None,
                 'employee': ({'id': a.employee_id, 'name': f"{people[a.employee_id].last_name}, {people[a.employee_id].first_name}",
                               'matricule': people[a.employee_id].code} if a.employee_id in people else None),
                 'detail': _critical_detail(a), 'severity': a.severity,
                 'status_label': 'Critique' if a.severity == 'critical' else 'Investigation' if a.anomaly_type in ('REENTRY', 'CORRECTION', 'OFF_SCHEDULE') else 'Ouvert'}
                for a in anomalies]
    return {'date': day.isoformat(), 'shift': shift_kind or None, 'group': group or None, 'rows': rows,
            'unplanned_sites': unplanned, 'critical_points': critical,
            'watch': watch_list(db, site_ids, day, sites=sites, photo_allowed=photo_allowed),
            'kpis': {**totals, 'critical_points': len(critical)},
            'total': {'expected': totals['expected'], 'present': sum(r['present'] or 0 for r in rows),
                      'gap': sum(r['gap'] or 0 for r in rows if r['gap'] is not None),
                      'status_label': COVERAGE_STATUS['UNDERSTAFFED'] if any(r['status'] in ('UNDERSTAFFED', 'CRITICAL', 'UNCOVERED') for r in rows)
                      else COVERAGE_STATUS['ATTENTION'] if any(r['status'] == 'ATTENTION' for r in rows) else COVERAGE_STATUS['COVERED']}}


def _critical_detail(anomaly):
    """Détail lisible d'un point critique de couverture : vacation et effectif planifié/requis."""
    details = anomaly.details if isinstance(anomaly.details, dict) else {}
    slot = details.get('slot') if isinstance(details.get('slot'), dict) else None
    if anomaly.anomaly_type in ('UNDERSTAFFED', 'UNCOVERED_SHIFT') and slot:
        label = f"Service {SHIFT_LABELS.get(slot.get('shift'), slot.get('shift'))} {hm(slot['start'])} – {hm(slot['end'])}"
        if anomaly.anomaly_type == 'UNCOVERED_SHIFT':
            return f'{label} : aucun groupe admissible'
        missing = int(details.get('required_staff') or 0) - int(details.get('planned_staff') or 0)
        return f"{label} : {missing} poste(s) non couvert(s) ({details.get('planned_staff')}/{details.get('required_staff')} planifiés)"
    return anomaly.message


def watch_list(db, site_ids, day, *, sites, photo_allowed=False):
    """Employés à surveiller sur 7 jours : retards répétés, abandon de poste, pointage incohérent."""
    from app.modules.attendance.models import AttendanceAnomaly
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment
    rows = list(db.scalars(select(AttendanceAnomaly).where(
        AttendanceAnomaly.site_id.in_(site_ids or {-1}), AttendanceAnomaly.employee_id.is_not(None),
        AttendanceAnomaly.presence_date >= day - timedelta(days=6), AttendanceAnomaly.presence_date <= day,
        AttendanceAnomaly.anomaly_type.in_(('LATE', 'ABANDON_POSTE', 'REENTRY', 'CORRECTION', 'OFF_SCHEDULE_REFUSED')))))
    issues = {}
    for row in rows:
        entry = issues.setdefault(row.employee_id, {'late': 0, 'abandon': None, 'incoherent': 0, 'site_id': row.site_id})
        if row.anomaly_type == 'LATE':
            entry['late'] += 1
        elif row.anomaly_type == 'ABANDON_POSTE':
            entry['abandon'] = row.presence_date
        else:
            entry['incoherent'] += 1
    flagged = {eid: v for eid, v in issues.items() if v['late'] >= 2 or v['abandon'] or v['incoherent']}
    people = {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_(flagged or {-1})))}
    groups = {a.employee_id: a.group_code for a in db.scalars(select(Assignment).where(
        Assignment.employee_id.in_(flagged or {-1}), Assignment.site_id.in_(site_ids or {-1}))) if assignment_on(a, day)}
    from app.modules.ops.employee_photos import canonical_photos
    photos = canonical_photos(db, set(people)) if photo_allowed and people else {}
    out = []
    for eid, v in flagged.items():
        if eid not in people:
            continue
        e = people[eid]
        if v['abandon']:
            kind, label = 'abandon', f"Abandon de poste ({v['abandon'].strftime('%d/%m')})"
        elif v['late'] >= 2:
            kind, label = 'late', f"{v['late']} retards cette semaine"
        else:
            kind, label = 'incoherent', 'Pointage incohérent'
        out.append({'id': eid, 'name': f'{e.last_name}, {e.first_name}', 'matricule': e.code, 'group': groups.get(eid),
                    'site': sites[v['site_id']].name if v['site_id'] in sites else None, 'kind': kind, 'label': label,
                    'photo_url': f'/api/site-workforce/positions/{eid}/photo' if photos.get(eid) else None})
    return sorted(out, key=lambda r: ({'abandon': 0, 'late': 1, 'incoherent': 2}[r['kind']], r['name']))[:12]
