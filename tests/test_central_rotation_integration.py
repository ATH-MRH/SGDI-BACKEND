"""Same published configuration through Core, OPS adapter and BEO workspace."""
from datetime import date,timedelta,datetime
import pytest
from fastapi import HTTPException
from sqlalchemy import delete,select
from app.modules.rotations.models import RotationDraft,OfficialRotation
from app.modules.rotations import service
from app.modules.attendance import core,official
from app.modules.attendance.models import AttendanceEvent
from app.modules.ops.models import Assignment
from tests.test_central_rotation_engine import config
from tests.test_attendance_counted_time import _setup,_ts,ANCHOR,ACTOR
from tests.test_attendance_api import _user
from tests.module_cleanup import purge_rows_created_by_this_module
from tests.test_pointeur_v7_operational import clean_v7_audit_and_alerts


@pytest.fixture(autouse=True)
def clean(db):
    yield
    db.rollback()
    db.execute(delete(OfficialRotation));db.execute(delete(RotationDraft));db.commit()


def adopt(db,employee,site,c):
    d=RotationDraft(site_id=site.id,effective_from=ANCHOR,reason='Synthetic approved configuration',created_by='test',config=c)
    db.add(d);db.flush()
    p=OfficialRotation(site_id=site.id,draft_id=d.id,effective_from=ANCHOR,version=1,config=c,
        simulation_hash='x'*64,published_by='test',reason=d.reason)
    db.add(p);db.commit();return p


@pytest.mark.parametrize('regime,group,start,end',[('3X8','A','05:00','13:00'),('24H48','A','08:00','17:00'),('1/2','B','19:00','07:00'),('1/3','A','08:00','17:00')])
def test_same_plan_for_ops_core_beo_and_frozen_departure(db,regime,group,start,end):
    from app.modules.ops.service import assignment_rotation_for_date
    from app.modules.attendance.workspace import read_workspace
    employee,site=_setup(db,group=group)
    c=config(regime,anchor=str(ANCHOR))
    if regime=='3X8':c['shifts']=[{'start':'05:00','end':'13:00'},{'start':'13:00','end':'21:00'},{'start':'21:00','end':'05:00'}]
    p=adopt(db,employee,site,c)
    plan=official.official_shift(db,employee_id=employee.id,site_id=site.id,at=_ts(ANCHOR,start))
    assert plan['configuration_id']==p.id and plan['scheduled_start'].strftime('%H:%M')==start
    a=db.scalar(select(Assignment).where(Assignment.employee_id==employee.id))
    assert assignment_rotation_for_date(db,a,site,None,ANCHOR)['start_time']==start
    arrival=core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,start))
    frozen=arrival['counted'];assert frozen['configuration_id']==p.id
    grid=read_workspace(db,site_ids={site.id},month=ANCHOR.strftime('%Y-%m'))
    assert grid['items'][0]['days'][ANCHOR.day-1]['recorded']
    finish=plan['scheduled_end']
    with pytest.raises(HTTPException) as early:
        core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=finish-timedelta(minutes=1))
    assert early.value.headers['X-Attendance-Code']=='EARLY_EXIT_REFUSED'
    result=core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=finish)
    assert result['action']=='depart' and result['counted']['scheduled_end']==frozen['scheduled_end']


def test_custom_refusal_threshold_and_zero_global_eight_hour_rule(db):
    employee,site=_setup(db,group='A')
    adopt(db,employee,site,config('3X8',anchor=str(ANCHOR),late_refusal_minutes=10,minimum_rest_minutes=600))
    with pytest.raises(HTTPException) as e:
        core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:10'))
    assert e.value.headers['X-Attendance-Code']=='LATE_ENTRY_REFUSED'
    event=db.scalar(select(AttendanceEvent).where(AttendanceEvent.employee_id==employee.id))
    assert event.data['counted']['policy']['minimum_rest_minutes']==600


def test_api_publication_requires_validate_scope_and_fresh_simulation(client,db):
    # Horaire normal : aucune vacation historique posté avant la date d'effet. Le test porte sur les
    # droits et la fraîcheur du reçu, pas sur la transition historique (testée ailleurs), et ne
    # dépend donc pas de la date du jour.
    employee,site=_setup(db,group='A',regime='NORMAL')
    headers=_user(client,db,sites=[site.id],modules=('ops',),actions=('read','create','validate'))
    from app.modules.drh.models import Employee
    import uuid
    for group in 'BCD':
        emp=Employee(code='CENTRAL-'+uuid.uuid4().hex[:12],first_name='Synthetic',last_name=group,status='actif')
        db.add(emp);db.flush()
        db.add(Assignment(employee_id=emp.id,site_id=site.id,group_code=group,start_date=date(2026,1,1),active=1))
    db.commit()
    day=core._now_local().date()+timedelta(days=14)
    body={'effective_from':str(day),'reason':'OPS simulation validée','config':config('3X8',anchor=str(day))}
    r=client.post(f'/api/ops/central-rotations/sites/{site.id}/drafts',headers=headers,json=body)
    assert r.status_code==200,r.text
    did=r.json()['id'];base=f'/api/ops/central-rotations/drafts/{did}'
    assert client.post(base+'/publish',headers=headers,json={'context_hash':'x'*64}).status_code==409
    sim=client.post(base+'/simulate',headers=headers,json={'days':30});assert sim.status_code==200,sim.text
    assert sim.json()['valid'],sim.text
    readonly=_user(client,db,sites=[site.id],modules=('ops',),actions=('read',))
    assert client.post(base+'/publish',headers=readonly,json={'context_hash':sim.json()['context_hash']}).status_code==403
    a=db.scalar(select(Assignment).where(Assignment.employee_id==employee.id));a.change_reason='Changed after simulation';a.end_date=day+timedelta(days=60);db.commit()
    assert client.post(base+'/publish',headers=headers,json={'context_hash':sim.json()['context_hash']}).status_code==409
    sim=client.post(base+'/simulate',headers=headers,json={'days':30}).json()
    published=client.post(base+'/publish',headers=headers,json={'context_hash':sim['context_hash']})
    assert published.status_code==200,published.text


def test_published_coverage_points_are_canonical_and_deduplicated(db,client):
    from app.modules.attendance.models import AttendanceAnomaly
    from app.modules.alerts.models import Alert
    from app.modules.rotations.service import sync_critical_points
    employee,site=_setup(db,group='A')
    adopt(db,employee,site,config('3X8',anchor=str(ANCHOR)))
    sync_critical_points(db,{site.id},_ts(ANCHOR,'06:20'));db.commit()
    sync_critical_points(db,{site.id},_ts(ANCHOR,'06:21'));db.commit()
    rows=list(db.scalars(select(AttendanceAnomaly).where(AttendanceAnomaly.site_id==site.id,AttendanceAnomaly.anomaly_type=='UNDERSTAFFED')))
    assert len(rows)==2 and all(row.employee_id is None for row in rows)
    for row in rows:
        alerts=list(db.scalars(select(Alert).where(Alert.dedup_key.in_([f'ATTENDANCE_SITUATION:{row.id}:OPS',f'ATTENDANCE_SITUATION:{row.id}:DRH']))))
        assert len(alerts)==2 and all(a.source_type=='site' and a.source_id==str(site.id) for a in alerts)
    headers=_user(client,db,sites=[site.id],modules=('site_workforce',),actions=('read',))
    reply=client.get('/api/site-workforce/attendance/situations',headers=headers)
    assert reply.status_code==200,reply.text
    assert {r.id for r in rows}<={item['id'] for item in reply.json()['items']}



def test_report_minutes_use_published_twelve_hour_duration(db):
    employee,site=_setup(db,group='A')
    adopt(db,employee,site,config('1/2',anchor=str(ANCHOR)))
    assignment=db.scalar(select(Assignment).where(Assignment.employee_id==employee.id))
    assert core.authorized_work_minutes(db,assignment,site,ANCHOR)==720


def test_missing_follows_the_published_threshold_and_is_resolved_by_actual_arrival(db):
    from app.modules.attendance import situations
    from app.modules.attendance.models import AttendanceAnomaly
    employee,site=_setup(db,group='A')
    adopt(db,employee,site,config('3X8',anchor=str(ANCHOR),late_refusal_minutes=12))
    situations.detect_missing(db,{site.id},_ts(ANCHOR,'06:11'));db.commit()
    assert not db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id==employee.id,AttendanceAnomaly.anomaly_type=='ABSENT'))
    situations.detect_missing(db,{site.id},_ts(ANCHOR,'06:12'));db.commit()
    point=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id==employee.id,AttendanceAnomaly.anomaly_type=='ABSENT'))
    assert point and point.details['configuration_id']
    core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,
        now=_ts(ANCHOR,'06:13'),manual_entry_allowed=True,observation='Admission motivée après le seuil du site')
    assert situations.view(point)['status']=='ARCHIVED'


def test_future_simulation_does_not_require_an_empty_operating_site(db):
    from types import SimpleNamespace
    employee,site=_setup(db,group='A')
    core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:00'))
    future=core._now_local().date()+timedelta(days=14)
    draft=SimpleNamespace(id=0,version=1,site_id=site.id,effective_from=future,config=config('3X8',anchor=str(future)))
    result=service.simulate(db,draft,30)
    assert not any(e['code']=='OPEN_SHIFT_TRANSITION' for e in result['errors'])


def test_inactive_employee_never_satisfies_required_coverage(db):
    from types import SimpleNamespace
    employee,site=_setup(db,group='A')
    employee.status='inactif';db.commit()
    future=core._now_local().date()+timedelta(days=14)
    draft=SimpleNamespace(id=0,version=1,site_id=site.id,effective_from=future,config=config('3X8',anchor=str(future)))
    result=service.simulate(db,draft,30)
    assert all(employee.id not in s['employee_ids'] for s in result['slots'])
    assert any(e['code']=='UNDERSTAFFED' for e in result['errors'])
