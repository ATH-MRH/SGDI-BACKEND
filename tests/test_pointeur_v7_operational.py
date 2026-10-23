"""Matrice réelle Attendance Core V7 : mêmes règles pour QR et facial, manuel habilité."""
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.attendance import core, live, situations
from app.modules.attendance.models import AttendanceAnomaly, AttendanceEvent
from app.modules.ops.models import DailyPresence
from tests.test_attendance_counted_time import _setup as _legacy_setup, _ts, ANCHOR, ACTOR
from app.modules.attendance import official
from app.modules.ops.models import Assignment, SiteRotation

def _setup(db, **kwargs):
    employee,site = _legacy_setup(db, **kwargs)
    model = official.ensure_fixed_model(db)
    db.scalar(select(Assignment).where(Assignment.employee_id==employee.id)).rotation_id=model.id
    db.scalar(select(SiteRotation).where(SiteRotation.site_id==site.id)).rotation_id=model.id
    db.commit()
    return employee,site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401


@pytest.mark.parametrize("group,start", [("A",6),("B",14),("C",22)])
@pytest.mark.parametrize("offset,accepted", [(-46,False),(-45,True),(0,True),(1,True),(29,True),(30,False)])
@pytest.mark.parametrize("source", ["QR","FACIAL"])
def test_official_entry_boundaries(db,group,start,offset,accepted,source):
    employee,site=_setup(db,group=group)
    at=_ts(ANCHOR,f"{start:02}:00")+timedelta(minutes=offset)
    if accepted:
        result=core.record_scan(db,employee=employee,source=source,actor=ACTOR,idempotency_key=None,now=at)
        assert result['action']=='arrivee'
        assert result['counted']['late_minutes']==max(0,offset)
        assert live.summary(db,{site.id},at)['present_now']==1
        if offset>0:
            late=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id==employee.id,AttendanceAnomaly.anomaly_type=='LATE'))
            assert late.details['late_minutes']==offset
    else:
        with pytest.raises(HTTPException) as error:
            core.record_scan(db,employee=employee,source=source,actor=ACTOR,idempotency_key=None,now=at)
        assert error.value.headers['X-Attendance-Code']==('EARLY_OUTSIDE_WINDOW' if offset<0 else 'LATE_ENTRY_REFUSED')
        assert db.scalar(select(DailyPresence).where(DailyPresence.employee_id==employee.id)) is None
        if offset>=30:
            event=db.scalar(select(AttendanceEvent).where(AttendanceEvent.employee_id==employee.id))
            assert event.event_type=='REFUSED_ENTRY'
            point=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id==employee.id))
            assert point.severity=='critical' and point.details['late_minutes']==30


@pytest.mark.parametrize("group,start", [("A",6),("B",14),("C",22)])
def test_manual_late_requires_permission_and_reason_and_uses_actual_time(db,group,start):
    employee,site=_setup(db,group=group)
    at=_ts(ANCHOR,f"{start:02}:00")+timedelta(minutes=34)
    with pytest.raises(HTTPException):
        core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=at)
    with pytest.raises(HTTPException) as denied:
        core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,now=at)
    assert denied.value.status_code==403
    with pytest.raises(HTTPException) as error:
        core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,now=at,manual_entry_allowed=True)
    assert error.value.status_code==422
    result=core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,now=at,
                           manual_entry_allowed=True,observation='Admission par le chef de poste')
    assert result['counted']['late_minutes']==34
    assert live.summary(db,{site.id},at)['present_now']==1
    types=set(db.scalars(select(AttendanceAnomaly.anomaly_type).where(AttendanceAnomaly.employee_id==employee.id)))
    assert {'LATE_ENTRY_REFUSED','LATE','MANUAL_POINTAGE'}<=types


def test_maintained_agent_stays_present_and_uses_frozen_official_end(db):
    employee,site=_setup(db,group='A')
    core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:00'))
    post=live.control_post(db,site.id,_ts(ANCHOR,'14:20'))
    assert post['kpi']['present']==post['kpi']['maintien']==1
    assert post['present'][0]['maintained_minutes']==20
    result=core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'14:25'))
    assert result['action']=='depart'
    assert live.control_post(db,site.id,_ts(ANCHOR,'14:26'))['present']==[]


def test_critical_workflow_is_sequential_audited_and_never_deletes_the_fact(db):
    employee,site=_setup(db,group='A')
    with pytest.raises(HTTPException):
        core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:30'))
    row=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id==employee.id))
    original_event=row.event_id
    with pytest.raises(HTTPException):
        situations.transition(db,row,target='ARCHIVED',reason='Contrôle terminé',responsible='PTG',actor=ACTOR)
    for state in situations.STATES[1:]:
        situations.transition(db,row,target=state,reason='Contrôle par le responsable',responsible='PTG',actor=ACTOR)
    db.commit()
    assert situations.view(row)['status']=='ARCHIVED'
    assert len(situations.view(row)['history'])==5
    assert db.get(AttendanceEvent,original_event).event_type=='REFUSED_ENTRY'


@pytest.mark.parametrize('group,start,end', [('A','06:00','14:00'),('B','14:00','22:00'),('C','22:00','06:00')])
@pytest.mark.parametrize('remaining,refused', [(31,True),(30,True),(29,True),(1,True),(0,False),(-45,False)])
def test_exit_boundary_never_changes_presence_on_refusal(db,group,start,end,remaining,refused):
    employee,site=_setup(db,group=group)
    core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,start))
    finish=_ts(ANCHOR,end)+(timedelta(days=1) if group=='C' else timedelta())
    at=finish-timedelta(minutes=remaining)
    if refused:
        with pytest.raises(HTTPException) as error:
            core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=at)
        assert error.value.headers['X-Attendance-Code']=='EARLY_EXIT_REFUSED'
        assert live.summary(db,{site.id},at)['present_now']==1
        assert db.scalar(select(AttendanceEvent).where(AttendanceEvent.employee_id==employee.id,AttendanceEvent.event_type=='REFUSED_EXIT'))
    else:
        result=core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=at)
        assert result['action']=='depart'
        assert live.summary(db,{site.id},at)['present_now']==0


def test_fixed_groups_never_rotate_and_d_remains_off(db):
    for group,shift in [('A','MATIN'),('B','APRES_MIDI'),('C','NUIT'),('D','OFF')]:
        employee,site=_setup(db,group=group)
        for offset in range(12):
            plan=official.official_shift(db,employee_id=employee.id,site_id=site.id,at=_ts(ANCHOR,'12:00')+timedelta(days=offset))
            assert plan['shift']==shift
            assert plan['working']==(group!='D')
            if group=='D':
                post=live.control_post(db,site.id,_ts(ANCHOR,'12:00')+timedelta(days=offset))
                assert all(r['employee']['id']!=employee.id for r in post['expected'])


def test_v7_abandon_available_even_one_minute_before_end_and_is_audited(db):
    from app.modules.attendance import abandon
    employee,site=_setup(db,group='A')
    first=core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:00'))
    context=abandon.context(db,employee,now=_ts(ANCHOR,'13:59'))
    assert context['applicable']
    result=core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,
        now=_ts(ANCHOR,'13:59'),abandon_shift_id=first['event_id'],manual_entry_allowed=True,observation='Départ constaté par le poste')
    assert result['action']=='abandon_poste'
    assert live.summary(db,{site.id},_ts(ANCHOR,'13:59'))['present_now']==0
    assert set(result['notifications'])=={'OPS','DRH'}


def test_maintenance_detection_deduplicates_and_exit_archives(db):
    employee,site=_setup(db,group='A')
    first=core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:00'))
    for minute in (20,25):
        situations.detect_maintenance(db,{site.id},_ts(ANCHOR,f'14:{minute}'))
    db.commit()
    row=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.dedupe_key==f"MAINTENANCE:{first['event_id']}"))
    assert row and row.status=='OPEN'
    core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'15:00'))
    assert row.status=='RESOLVED' and situations.view(row)['status']=='ARCHIVED'
    assert row.details['maintained_minutes']==60


def test_off_refusal_creates_no_absence_or_lateness_or_presence(db):
    employee,site=_setup(db,group='D')
    with pytest.raises(HTTPException) as error:
        core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:15'))
    assert error.value.headers['X-Attendance-Code']=='OFF_SCHEDULE_REFUSED'
    situations.detect_missing(db,{site.id},_ts(ANCHOR,'07:00'))
    assert db.scalar(select(DailyPresence).where(DailyPresence.employee_id==employee.id)) is None
    assert set(db.scalars(select(AttendanceAnomaly.anomaly_type).where(AttendanceAnomaly.employee_id==employee.id)))=={'OFF_SCHEDULE_REFUSED'}


def test_nonpointed_is_deduplicated_and_manual_entry_resolves_without_erasure(db):
    employee,site=_setup(db,group='A')
    for _ in range(2): situations.detect_missing(db,{site.id},_ts(ANCHOR,'06:30'))
    db.commit()
    row=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id==employee.id))
    assert row.anomaly_type=='ABSENT' and row.status=='OPEN'
    core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:34'),
                     manual_entry_allowed=True,observation='Admission avec justification')
    assert row.status=='RESOLVED'
    assert db.get(AttendanceAnomaly,row.id) is row


def test_workflow_api_requires_scope_and_validation_right(client,db):
    from tests.test_attendance_api import _user, _site
    employee,site=_setup(db,group='A')
    other=_site(db)
    with pytest.raises(HTTPException):
        core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:30'))
    row=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id==employee.id))
    url=f'/api/attendance/anomalies/{row.id}/workflow'
    body={'status':'TO_PROCESS','reason':'Prise en charge au poste','responsible':'Chef de poste'}
    readonly=_user(client,db,sites=[site.id],actions=('read',))
    assert client.patch(url,headers=readonly,json=body).status_code==403
    outside=_user(client,db,sites=[other.id],actions=('read','update','validate'))
    assert client.patch(url,headers=outside,json=body).status_code==404
    allowed=_user(client,db,sites=[site.id],actions=('read','update','validate'))
    response=client.patch(url,headers=allowed,json=body)
    assert response.status_code==200,response.text
    assert response.json()['status']=='TO_PROCESS'
    assert client.patch(url,headers=allowed,json=body).status_code==409


@pytest.fixture(scope='module',autouse=True)
def clean_v7_audit_and_alerts():
    # Les audits/alertes n'ont pas de cascade employé : ne rien laisser aux modules suivants.
    from sqlalchemy import delete,func
    from app.modules.auth.models import AuditEvent
    from app.modules.alerts.models import Alert
    from tests.conftest import TestSessionLocal
    with TestSessionLocal() as session:
        marks={model:session.scalar(select(func.max(model.id))) or 0 for model in (AuditEvent,Alert)}
    yield
    with TestSessionLocal() as session:
        for model,mark in marks.items():session.execute(delete(model).where(model.id>mark))
        session.commit()


def test_beo_reads_the_same_points_with_strict_scope_and_no_write(client,db):
    from tests.test_attendance_api import _user
    from sqlalchemy import func
    first,site=_setup(db,group='A')
    second,other=_setup(db,group='A')
    for employee in (first,second):
        with pytest.raises(HTTPException):
            core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:30'))
    headers=_user(client,db,sites=[site.id],modules=('site_workforce',),actions=('read',))
    counts=lambda:(db.scalar(select(func.count(AttendanceEvent.id))),db.scalar(select(func.count(AttendanceAnomaly.id))))
    before=counts()
    response=client.get('/api/site-workforce/attendance/situations',headers=headers)
    assert response.status_code==200,response.text
    assert {r['employee_id'] for r in response.json()['items']}=={first.id}
    assert all(r['site_id']==site.id for r in response.json()['items'])
    assert counts()==before
    assert client.get('/api/site-workforce/attendance/situations',headers=headers,params={'site_id':other.id}).status_code==403


def test_prolonged_maintenance_stays_present_until_an_actual_exit(db):
    employee,site=_setup(db,group='A')
    core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:00'))
    later=_ts(ANCHOR,'06:00')+timedelta(hours=40)
    assert live.summary(db,{site.id},later)['present_now']==1
    assert live.control_post(db,site.id,later)['present'][0]['badge']=='EN_MAINTIEN'
    result=core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=later)
    assert result['action']=='depart'
    assert result['counted']['counted_minutes']==480
    assert live.summary(db,{site.id},later)['present_now']==0


def test_v7_situation_projects_once_to_ops_and_drh_and_closes_with_treatment(db):
    from app.modules.alerts.models import Alert
    employee,site=_setup(db,group='A')
    for _ in range(2):
        with pytest.raises(HTTPException):
            core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'06:30'))
    row=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id==employee.id))
    projections=list(db.scalars(select(Alert).where(Alert.dedup_key.in_([f'ATTENDANCE_SITUATION:{row.id}:OPS',f'ATTENDANCE_SITUATION:{row.id}:DRH']))))
    assert len(projections)==2 and all(p.site_id==site.id and p.status=='open' for p in projections)
    for state in situations.STATES[1:]:
        situations.transition(db,row,target=state,reason='Traitement documenté par le responsable',responsible='PTG',actor=ACTOR)
    db.commit()
    assert all(p.status=='resolved' for p in projections)


def test_night_late_manual_after_midnight_uses_the_previous_work_day(db):
    employee,site=_setup(db,group='C')
    tomorrow=ANCHOR+timedelta(days=1)
    with pytest.raises(HTTPException):
        core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(tomorrow,'00:20'))
    result=core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,
        now=_ts(tomorrow,'00:34'),manual_entry_allowed=True,observation='Admission justifiée après minuit')
    assert result['counted']['work_date']==ANCHOR.isoformat()
    assert result['counted']['late_minutes']==154
    out=core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(tomorrow,'06:00'))
    assert out['counted']['counted_minutes']==326
    assert db.scalar(select(DailyPresence).where(DailyPresence.employee_id==employee.id)).presence_date==ANCHOR
