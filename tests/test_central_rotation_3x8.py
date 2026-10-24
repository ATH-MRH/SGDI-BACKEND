"""3×8 simplifié (GO DG) : OPS saisit la date de début du cycle et les six horaires ; le planning
intelligent ATLAS calcule le reste (positions A/B/C/D, groupe OFF, calendrier continu, contrôles),
l'écrit dans la version datée, et OPS = Pointeur = BEO lisent les mêmes occurrences."""
import re
from datetime import date, timedelta

import pytest
from sqlalchemy import delete

from app.modules.attendance import core, live
from app.modules.rotations import views
from app.modules.rotations.engine import occurrences, validate
from app.modules.rotations.models import OfficialRotation, RotationDraft
from tests.test_attendance_api import _user
from tests.test_attendance_counted_time import ACTOR, ANCHOR, _setup, _ts
from tests.test_central_rotation_expected_population import purge, staff
from tests.test_central_rotation_integration import adopt
from tests.test_central_rotation_views import beo_headers

SHIFTS = [{'start': '06:00', 'end': '14:00'}, {'start': '14:00', 'end': '22:00'}, {'start': '22:00', 'end': '06:00'}]
POSITIONS = ('MATIN', 'APRES_MIDI', 'NUIT', 'OFF')


def minimal(anchor=ANCHOR, shifts=SHIFTS, **extra):
    """Exactement ce que l'écran OPS envoie en 3×8."""
    return {'regime': '3X8', 'timezone': 'Africa/Algiers', 'anchor': str(anchor), 'shifts': shifts, **extra}


def positions(plan):
    days = {}
    for slot in plan['slots']:
        days.setdefault(slot['work_date'], {})[slot['group']] = slot['shift']
    return {d: {g: groups.get(g, 'OFF') for g in 'ABCD'} for d, groups in days.items()}


@pytest.fixture(autouse=True)
def clean(db):
    yield
    db.rollback()
    db.execute(delete(OfficialRotation)); db.execute(delete(RotationDraft)); db.commit()


def test_cycle_date_and_six_hours_are_enough_and_everything_else_is_computed_and_traced():
    c = validate(minimal())
    assert c['phases'] == {'A': 0, 'B': 1, 'C': 2, 'D': 3} and c['days_per_position'] == 1
    assert (c['workdays'], c['weekend'], c['holidays']) == (list(range(7)), [], [])            # 7 j/7, fériés compris
    assert (c['night_start'], c['night_end']) == ('22:00', '06:00')                            # tirés de la vacation Nuit
    assert c['required_staff'] == {'MATIN': 1, 'APRES_MIDI': 1, 'NUIT': 1}
    assert c['calendar_valid_from'] == str(ANCHOR) and c['calendar_valid_until'] > '2035-01-01'
    assert 'workdays' in c['derived'] and 'night_start' in c['derived'] and 'shifts' not in c['derived']
    assert occurrences(c, ANCHOR, 1)['valid']


def test_explicit_values_of_an_existing_version_are_kept():
    c = validate(minimal(minimum_rest_minutes=600, required_staff={'MATIN': 3, 'APRES_MIDI': 3, 'NUIT': 2}))
    assert c['minimum_rest_minutes'] == 600 and c['required_staff']['NUIT'] == 2
    assert 'minimum_rest_minutes' not in c['derived'] and 'required_staff' not in c['derived']


def test_groups_rotate_matin_apres_midi_nuit_off_and_the_off_group_changes_every_day():
    days = positions(occurrences(validate(minimal()), ANCHOR, 12))
    first, second = days[str(ANCHOR)], days[str(ANCHOR + timedelta(days=1))]
    assert first == {'A': 'MATIN', 'B': 'APRES_MIDI', 'C': 'NUIT', 'D': 'OFF'}
    assert second == {'A': 'APRES_MIDI', 'B': 'NUIT', 'C': 'OFF', 'D': 'MATIN'}
    for g in 'ABCD':                                                                           # aucune rupture
        seq = [days[str(ANCHOR + timedelta(days=i))][g] for i in range(12)]
        start = POSITIONS.index(seq[0])
        assert seq == [POSITIONS[(start + i) % 4] for i in range(12)], g
    for groups in days.values():                                                               # 3 vacations + 1 OFF
        assert sorted(groups.values()) == sorted(POSITIONS)
    assert len({tuple(sorted(g for g, s in d.items() if s == 'OFF')) for d in days.values()}) == 4


@pytest.mark.parametrize('first', ['2026-10-30', '2026-12-30', '2028-02-27'])
def test_month_year_and_leap_day_boundaries_keep_continuity(first):
    c = validate(minimal())
    start = date.fromisoformat(first)
    whole = occurrences(c, start, 6)
    for i in range(6):                                                                          # indépendant de la requête
        day = start + timedelta(days=i)
        assert occurrences(c, day, 1)['slots'] == [s for s in whole['slots'] if s['work_date'] == str(day)]
    days = positions(whole)
    for i in range(5):
        a, b = days[str(start + timedelta(days=i))], days[str(start + timedelta(days=i + 1))]
        assert all(POSITIONS[(POSITIONS.index(a[g]) + 1) % 4] == b[g] for g in 'ABCD')


def test_night_crosses_midnight_and_stays_attached_to_its_start_day():
    night = next(s for s in occurrences(validate(minimal()), '2026-12-31', 1)['slots'] if s['shift'] == 'NUIT')
    assert (night['work_date'], night['start'][:16], night['end'][:16]) == ('2026-12-31', '2026-12-31T22:00', '2027-01-01T06:00')


def test_custom_site_hours_keep_the_same_principle():
    hours = [{'start': '05:00', 'end': '13:00'}, {'start': '13:00', 'end': '21:00'}, {'start': '21:00', 'end': '05:00'}]
    plan = occurrences(validate(minimal(shifts=hours)), ANCHOR, 4)
    assert plan['valid']
    assert {(s['shift'], s['start'][11:16], s['end'][11:16]) for s in plan['slots']} == {('MATIN', '05:00', '13:00'), ('APRES_MIDI', '13:00', '21:00'), ('NUIT', '21:00', '05:00')}
    assert positions(plan)[str(ANCHOR)] == {'A': 'MATIN', 'B': 'APRES_MIDI', 'C': 'NUIT', 'D': 'OFF'}


@pytest.mark.parametrize('shifts,message', [
    ([{'start': '06:00', 'end': '14:00'}, {'start': '14:30', 'end': '22:30'}, {'start': '22:30', 'end': '06:00'}], 'dure 7 h 30'),
    ([{'start': '06:00', 'end': '14:00'}, {'start': '14:30', 'end': '22:30'}, {'start': '22:30', 'end': '06:30'}], 'Trou de 30 min entre la fin de la vacation Matin (14:00)'),
    ([{'start': '06:00', 'end': '14:00'}, {'start': '13:30', 'end': '21:30'}, {'start': '21:30', 'end': '05:30'}], 'Chevauchement de 30 min entre la vacation Matin'),
    ([{'start': '06:00', 'end': '14:00'}, {'start': '14:00', 'end': '22:00'}], 'Horaires des trois vacations requis'),
    ([{'start': '06:00', 'end': '06:00'}, {'start': '14:00', 'end': '22:00'}, {'start': '22:00', 'end': '06:00'}], 'vacation Matin est vide'),
])
def test_invalid_hours_are_explained_to_ops(shifts, message):
    with pytest.raises(ValueError, match=re.escape(message)):
        validate(minimal(shifts=shifts))


def test_other_regimes_still_require_their_own_parameters():
    from tests.test_central_rotation_engine import config
    for regime in ('24H48', '1/2', '1/3'):
        c = config(regime); c.pop('night_start')
        with pytest.raises(ValueError, match='complète'):
            validate(c)
        assert 'derived' not in validate(config(regime))


def test_minimal_draft_simulation_publication_and_new_dated_version_without_rewriting(db, client):
    anchor_employee, site = _setup(db, group='A', regime='NORMAL')
    for g in 'BCD':
        staff(db, site, g)
    db.commit()
    headers = _user(client, db, sites=[site.id], modules=('ops',), actions=('read', 'create', 'validate'))
    day = core._now_local().date() + timedelta(days=10)
    base = f'/api/ops/central-rotations/sites/{site.id}'
    preview = client.post('/api/ops/central-rotations/preview', headers=headers, json={'site_id': site.id, 'month': str(day)[:7], 'config': minimal(day)})
    assert preview.status_code == 200, preview.text
    assert preview.json()['config']['days_per_position'] == 1 and preview.json()['calendar']['week_start'] == 0
    draft = client.post(base + '/drafts', headers=headers, json={'effective_from': str(day), 'reason': 'Configuration 3×8 — planning intelligent ATLAS', 'config': minimal(day)})
    assert draft.status_code == 200, draft.text
    sim = client.post(f"/api/ops/central-rotations/drafts/{draft.json()['id']}/simulate", headers=headers, json={'days': 30}).json()
    assert sim['valid'], sim['errors'][:3]
    assert len(sim['slots']) == 90 and {s['shift'] for s in sim['slots']} == {'MATIN', 'APRES_MIDI', 'NUIT'}
    v1 = client.post(f"/api/ops/central-rotations/drafts/{draft.json()['id']}/publish", headers=headers, json={'context_hash': sim['context_hash']})
    assert v1.status_code == 200, v1.text
    # Nouveaux horaires = nouvelle version datée ; la première reste intacte.
    later, hours = day + timedelta(days=20), [{'start': '05:00', 'end': '13:00'}, {'start': '13:00', 'end': '21:00'}, {'start': '21:00', 'end': '05:00'}]
    d2 = client.post(base + '/drafts', headers=headers, json={'effective_from': str(later), 'reason': 'Nouveaux horaires', 'config': minimal(day, shifts=hours)}).json()
    sim2 = client.post(f"/api/ops/central-rotations/drafts/{d2['id']}/simulate", headers=headers, json={'days': 30}).json()
    assert sim2['valid'], sim2['errors'][:3]
    assert client.post(f"/api/ops/central-rotations/drafts/{d2['id']}/publish", headers=headers, json={'context_hash': sim2['context_hash']}).status_code == 200
    history = client.get(base + '/history', headers=headers).json()['items']
    assert [h['version'] for h in history] == [1, 2] and history[0]['config']['shifts'] == SHIFTS and history[1]['config']['shifts'] == hours
    assert history[0]['effective_to'] == str(later)
    purge(db, site.id)


def test_simulation_errors_are_labelled_for_ops(db):
    from app.modules.ops.models import Assignment
    from app.modules.rotations import service
    anchor_employee, site = _setup(db, group='A', regime='NORMAL')
    db.add(Assignment(employee_id=anchor_employee.id, site_id=site.id, group_code='Z', start_date=ANCHOR, active=1)); db.commit()
    draft = RotationDraft(site_id=site.id, effective_from=ANCHOR, reason='Test', created_by='test', config=validate(minimal()))
    db.add(draft); db.flush()
    errors = service.simulate(db, draft, 30)['errors']
    unknown = next(e for e in errors if e['code'] == 'UNKNOWN_GROUP')
    assert unknown['label'] == 'Affectation hors des groupes A/B/C/D' and anchor_employee.code in unknown['employee']
    assert all(e['label'] for e in errors)
    db.rollback(); purge(db, site.id)


def test_ops_pointeur_and_beo_read_the_same_3x8_night_occurrence(db, client, monkeypatch):
    anchor_employee, site = _setup(db, group='A', regime='NORMAL')
    team = {g: [staff(db, site, g), staff(db, site, g)] for g in 'BCD'}
    db.commit()
    published = adopt(db, anchor_employee, site, validate(minimal()))
    at = _ts(ANCHOR + timedelta(days=1), '02:00')                                                 # Nuit C du 01/10, 22:00 → 06:00
    core.record_scan(db, employee=team['C'][0], source='QR', actor=ACTOR, idempotency_key=None, now=_ts(ANCHOR, '22:05'))
    post = live.control_post(db, site.id, at)
    month = views.month_view(db, site.id, '2026-10')
    ops = next(s for s in month['days'][0]['slots'] if s['shift'] == 'NUIT')
    monkeypatch.setattr(core, '_now_local', lambda: at)
    beo = client.get('/api/site-workforce/attendance/coverage', headers=beo_headers(client, db, site)).json()
    row = next(r for r in beo['rows'] if r['site_id'] == site.id)
    assert (beo['date'], beo['shift']) == (str(ANCHOR), 'NUIT')                                 # vacation en cours
    assert ops['group'] == post['current']['group'] == row['group'] == 'C'
    assert ops['occurrence_id'] == post['current']['occurrence_id'] == row['occurrence_id'] == f"{site.id}:{published.id}:{_ts(ANCHOR, '22:00').isoformat()}"
    assert (ops['start'], ops['end']) == (row['start'], row['end']) == ('22:00', '06:00')
    assert ops['planned_staff'] == post['kpi']['expected'] == row['expected'] == 2
    assert post['kpi']['present'] == row['present'] == 1
    assert month['days'][0]['off_groups'] == ['D']
    purge(db, site.id)
