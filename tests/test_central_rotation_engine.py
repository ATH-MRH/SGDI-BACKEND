"""Official business invariants, without a database or wall clock."""
from copy import deepcopy
from datetime import date,datetime,timedelta
import pytest
from app.modules.rotations.engine import occurrences,validate


def hm(value):
    return value[11:16]


def config(regime='1/3',**changes):
    value=dict(regime=regime,timezone='Africa/Algiers',anchor='2026-10-01',
        phases={'A':0,'B':0,'C':2,'D':1},minimum_rest_minutes=480,
        early_minutes=45,late_refusal_minutes=30,week_start=6,workdays=[6,0,1,2,3],weekend=[4,5],
        holidays=[],calendar_source='Synthetic OPS calendar',calendar_version='1',calendar_valid_from='2020-01-01',calendar_valid_until='2030-12-31',
        required_staff={'JOUR':1,'NUIT':1,'MATIN':1,'APRES_MIDI':1},night_start='21:00',night_end='05:00',
        day_start='08:00',day_end='16:30',night_shift_start='16:30',night_shift_end='08:00')   # référence DG de démonstration
    if regime in ('24H48','1/2','3X8'):value['phases']={'A':0,'B':1,'C':2,'D':3}
    if regime=='3X8':value.update(days_per_position=1,shifts=[{'start':'06:00','end':'14:00'},{'start':'14:00','end':'22:00'},{'start':'22:00','end':'06:00'}])
    if regime=='1/2':value['first_start']='07:00'
    return {**value,**changes}


@pytest.mark.parametrize('regime',['3X8','24H48','1/2','1/3'])
def test_cycles_are_query_independent_across_month_and_year(regime):
    c=config(regime)
    whole=occurrences(c,'2026-10-01',100)
    for d in ('2026-10-31','2026-11-01','2026-12-31','2027-01-01'):
        part=occurrences(c,d,1)
        assert part['slots']==[s for s in whole['slots'] if s['work_date']==d]
    assert whole['valid'],whole['errors'][:2]


def test_one_third_corrected_october_and_holiday_never_rotates_nights():
    c=config(holidays=['2026-10-15'])
    plan=occurrences(c,'2026-10-01',31)
    assert plan['valid']
    for s in plan['slots']:
        day=date.fromisoformat(s['work_date'])
        if s['shift']=='NUIT':assert s['group']=='BCD'[(day-date(2026,10,1)).days%3]
        if s['group']=='A':assert s['shift']=='JOUR' and day.weekday() not in (4,5) and day.isoformat() not in c['holidays']
        if s['work_date']=='2026-10-17':assert s['group']!='A'
    normal=occurrences(config(),'2026-10-15',1)
    assert next(s for s in normal['slots'] if s['shift']=='JOUR')['group']=='A'
    assert [s for s in plan['slots'] if s['shift']=='NUIT']==[s for s in occurrences(config(),'2026-10-01',31)['slots'] if s['shift']=='NUIT']


def test_uncovered_is_explicit_and_never_forces_a_conflicting_group():
    p=occurrences(config(minimum_rest_minutes=1441),'2026-10-02',2)
    assert not p['valid']
    assert all(s['group'] is None for s in p['slots'] if s['shift']=='JOUR')
    assert any(e['label']=='VACATION NON COUVERTE' for e in p['errors'])


def test_twelve_hour_order_and_midnight():
    p=occurrences(config('1/2'),'2026-10-01',3)
    assert [s['group'] for s in p['slots']]==list('ABCDAB')
    assert p['slots'][1]['end'].startswith('2026-10-02T07:00')
    assert p['slots'][1]['night_minutes']==480


def test_custom_three_shift_times_and_no_mutation():
    c=config('3X8',shifts=[{'start':'05:00','end':'13:00'},{'start':'13:00','end':'21:00'},{'start':'21:00','end':'05:00'}])
    before=deepcopy(c);p=occurrences(c,'2026-10-01',8)
    assert p['valid'] and len(p['slots'])==24 and c==before
    assert next(s for s in p['slots'] if s['group']=='A')['start'].endswith('05:00:00+01:00')


@pytest.mark.parametrize('patch',[{'minimum_rest_minutes':None},{'workdays':[0]},{'phases':{'A':0}}, {'late_refusal_minutes':0}])
def test_incomplete_configuration_fails_closed(patch):
    with pytest.raises((ValueError,KeyError)):validate(config(**patch))


def test_one_third_day_cannot_contain_regulatory_night_work():
    with pytest.raises(ValueError,match='aucune minute'):
        validate(config(day_start='04:00',day_end='16:00',night_shift_start='16:00',night_shift_end='04:00'))


def test_unconfirmed_calendar_blocks_simulation_without_resetting_the_night_cycle():
    p=occurrences(config(calendar_valid_until='2026-10-01'),'2026-10-02',1)
    assert not p['valid'] and any(e['code']=='CALENDAR_UNCONFIRMED' for e in p['errors'])


# ── Arbitrage DG du 24/10/2026 ────────────────────────────────────────────────────────────────
def test_week_start_is_explicit_validated_and_carried_by_each_occurrence():
    missing=config();missing.pop('week_start')
    with pytest.raises(ValueError,match='Début de semaine'):occurrences(missing,'2026-10-01',1)
    with pytest.raises(ValueError,match='Début de semaine'):occurrences(config(week_start=7),'2026-10-01',1)
    with pytest.raises(ValueError,match='Jours ouvrés du groupe A'):occurrences(config(workdays=[],weekend=list(range(7))),'2026-10-01',1)
    plan=occurrences(config(),'2026-10-01',14)
    # Semaine du site : dimanche → samedi (week_start=6), jamais lundi implicite.
    assert {s['work_date']:s['week'] for s in plan['slots']}['2026-10-08']=='2026-10-04'
    assert {date.fromisoformat(s['week']).weekday() for s in plan['slots']}=={6}


def test_one_third_weekend_and_holiday_day_shift_exists_and_is_covered_by_bcd():
    """A : jours ouvrés (dimanche → jeudi) non fériés, jamais nuit/week-end/férié ; la vacation de
    jour existe le week-end et les jours fériés et revient à B, C ou D sans décaler le cycle de nuit ;
    aucun groupe ne fait Jour + Nuit avec chevauchement ou repos insuffisant."""
    c=config(holidays=['2026-10-13'])
    plan=occurrences(c,'2026-10-01',61)
    assert plan['valid'],plan['errors'][:2]
    by_day={}
    for s in plan['slots']:by_day.setdefault(s['work_date'],{})[s['shift']]=s
    assert all(set(v)=={'JOUR','NUIT'} for v in by_day.values())          # occurrences quotidiennes Jour + Nuit
    for d,v in by_day.items():
        day=date.fromisoformat(d);working=day.weekday() in c['workdays'] and d not in c['holidays']
        assert (v['JOUR']['group']=='A')==working,d
        if not working:assert v['JOUR']['group'] in 'BCD' and v['JOUR']['replacement'],d
        assert v['NUIT']['group']=='BCD'[(day-date(2026,10,1)).days%3],d  # nuit jamais décalée
        assert v['JOUR']['group']!=v['NUIT']['group'],d
        assert (hm(v['JOUR']['start']),hm(v['JOUR']['end']))==('08:00','16:30')
    assert by_day['2026-10-04']['JOUR']['group']=='A'                     # dimanche ouvré
    assert by_day['2026-10-02']['JOUR']['group']!='A' and by_day['2026-10-03']['JOUR']['group']!='A'  # vendredi, samedi
    assert by_day['2026-10-13']['JOUR']['group']!='A'                     # férié
    for g in 'BCD':
        mine=sorted((s for s in plan['slots'] if s['group']==g),key=lambda s:s['start'])
        for a,b in zip(mine,mine[1:]):
            gap=datetime.fromisoformat(b['start'])-datetime.fromisoformat(a['end'])
            assert gap.total_seconds()>=c['minimum_rest_minutes']*60,(g,a['start'],b['start'])


def test_monday_week_site_is_configurable_too():
    c=config(week_start=0,workdays=[0,1,2,3,4],weekend=[5,6])
    plan={(s['work_date'],s['shift']):s for s in occurrences(c,'2026-10-01',14)['slots']}
    assert plan[('2026-10-05','JOUR')]['group']=='A' and plan[('2026-10-04','JOUR')]['group'] in 'BCD'
    assert plan[('2026-10-04','JOUR')]['week']=='2026-09-28'
