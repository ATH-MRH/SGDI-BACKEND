"""Défauts reproduits lors de la revue DG : contrats métier, pas de mocks du Core."""
from datetime import timedelta
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from app.modules.attendance import core, live, situations, official
from app.modules.attendance.models import AttendanceAnomaly, AttendanceEvent
from app.modules.alerts.models import Alert,AlertEvidence
from app.modules.auth.models import AuditEvent
from app.modules.ops.models import Assignment, SiteRotation, DailyPresence
from tests.test_attendance_counted_time import ANCHOR, ACTOR, _ts
from tests.test_pointeur_v7_operational import _setup, clean_v7_audit_and_alerts
from tests.module_cleanup import purge_rows_created_by_this_module
from tests.test_pointeur_v7_migration import transition_db


def scan(db, employee, time, **kwargs):
    return core.record_scan(db, employee=employee, actor=ACTOR, idempotency_key=None,
                            now=_ts(ANCHOR,time), source=kwargs.pop('source','QR'), **kwargs)


@pytest.mark.parametrize('source',['QR','FACIAL'])
def test_extra_shift_inherits_v7_and_never_bypasses_late_or_early_exit(db,source):
    employee,site=_setup(db,group='A')
    scan(db,employee,'06:00');scan(db,employee,'14:00')
    with pytest.raises(HTTPException) as refused:
        scan(db,employee,'14:35',source=source)
    assert refused.value.headers['X-Attendance-Code']=='LATE_ENTRY_REFUSED'
    with pytest.raises(HTTPException) as denied:
        scan(db,employee,'14:35',source='MANUAL')
    assert denied.value.status_code==403
    with pytest.raises(HTTPException) as no_reason:
        scan(db,employee,'14:35',source='MANUAL',manual_entry_allowed=True)
    assert no_reason.value.status_code==422
    result=scan(db,employee,'14:35',source='MANUAL',manual_entry_allowed=True,observation='Relève supplémentaire autorisée')
    assert result['counted']['policy_version']==7
    assert result['counted']['late_minutes']==35
    with pytest.raises(HTTPException) as early:
        scan(db,employee,'15:00',source=source)
    assert early.value.headers['X-Attendance-Code']=='EARLY_EXIT_REFUSED'
    assert live.summary(db,{site.id},_ts(ANCHOR,'15:00'))['present_now']==1
    assert scan(db,employee,'22:00')['action']=='depart'


@pytest.mark.parametrize('group',list('ABCD'))
@pytest.mark.parametrize('source',['QR','FACIAL','MANUAL'])
def test_v7_without_anchor_refuses_entry_and_keeps_attempt_without_presence(db,group,source):
    employee,site=_setup(db,group=group)
    db.execute(delete(SiteRotation).where(SiteRotation.site_id==site.id));db.commit()
    with pytest.raises(HTTPException) as refused:
        scan(db,employee,'06:15',source=source,manual_entry_allowed=True,observation='Admission demandée')
    assert refused.value.status_code==409
    assert refused.value.headers['X-Attendance-Code']=='ROTATION_NOT_CONFIGURED'
    assert db.scalar(select(DailyPresence).where(DailyPresence.employee_id==employee.id)) is None
    event=db.scalar(select(AttendanceEvent).where(AttendanceEvent.employee_id==employee.id))
    assert event.event_type=='REFUSED_ENTRY'
    assert db.scalar(select(AuditEvent).where(AuditEvent.action=='attendance.rotation_not_configured',AuditEvent.resource_id==str(employee.id)))


@pytest.mark.parametrize('kind',['MAINTENANCE','ABSENT'])
@pytest.mark.parametrize('state',['TO_PROCESS','VALIDATED'])
def test_automatic_resolution_after_take_charge_archives_and_audits_every_projection(db,kind,state):
    employee,site=_setup(db,group='A')
    if kind=='MAINTENANCE':
        scan(db,employee,'06:00');situations.detect_maintenance(db,{site.id},_ts(ANCHOR,'14:20'))
    else:
        situations.detect_missing(db,{site.id},_ts(ANCHOR,'06:30'))
    db.commit()
    row=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id==employee.id,AttendanceAnomaly.anomaly_type==kind))
    for target in situations.STATES[1:situations.STATES.index(state)+1]:
        situations.transition(db,row,target=target,reason='Prise en charge',responsible='Chef de poste',actor=ACTOR)
    db.commit()
    if kind=='MAINTENANCE':scan(db,employee,'15:00')
    else:scan(db,employee,'06:35',source='MANUAL',manual_entry_allowed=True,observation='Admission justifiée')
    assert row.status=='RESOLVED'
    view=situations.view(row)
    assert view['status']=='ARCHIVED'
    assert view['history'][-1]['from']==state
    assert view['history'][-1]['to']=='ARCHIVED'
    assert view['history'][-1]['automatic'] is True
    alerts=list(db.scalars(select(Alert).where(Alert.dedup_key.in_([f'ATTENDANCE_SITUATION:{row.id}:OPS',f'ATTENDANCE_SITUATION:{row.id}:DRH']))))
    assert len(alerts)==2 and all(a.status=='resolved' for a in alerts)
    audit=db.scalar(select(AuditEvent).where(AuditEvent.action=='attendance.situation.auto_resolve',AuditEvent.resource_id==str(row.id)))
    assert json.loads(audit.old_state)['status']==state
    assert json.loads(audit.new_state)['status']=='ARCHIVED'
    with pytest.raises(HTTPException):
        situations.transition(db,row,target='IN_PROGRESS',reason='Ne pas rouvrir',responsible='PTG',actor=ACTOR)


def test_beo_historical_closed_assignment_keeps_original_fact_and_scope(db,client):
    from app.modules.attendance.workspace import read_workspace
    from tests.test_attendance_api import _user
    employee,site=_setup(db,group='A')
    arrival=scan(db,employee,'06:00')
    old=db.scalar(select(Assignment).where(Assignment.employee_id==employee.id))
    old.active=0;old.end_date=ANCHOR
    db.add(Assignment(employee_id=employee.id,site_id=site.id,group_code='A',work_regime='POSTE_CONTINU',rotation_id=old.rotation_id,start_date=ANCHOR+timedelta(days=1),active=1))
    db.commit()
    grid=read_workspace(db,site_ids={site.id},month='2026-10')
    first=grid['items'][0]['days'][0]
    assert first['available'] and first['recorded'] and first['presence_state']=='POINTE'
    assert first['counted']['actual_entry']==_ts(ANCHOR,'06:00').isoformat()
    headers=_user(client,db,sites=[site.id],modules=('site_workforce',),actions=('read',))
    reply=client.get('/api/site-workforce/attendance/workspace?month=2026-10',headers=headers)
    assert reply.status_code==200,reply.text
    assert reply.json()['items'][0]['days'][0]['recorded']
    other,other_site=_setup(db,group='B')
    outside=_user(client,db,sites=[other_site.id],modules=('site_workforce',),actions=('read',))
    assert client.get(f'/api/site-workforce/attendance/workspace?month=2026-10&employee_id={employee.id}',headers=outside).status_code==404
    assert db.get(AttendanceEvent,arrival['event_id']).event_type=='ARRIVAL'


@pytest.mark.parametrize('source',['QR','FACIAL','MANUAL'])
def test_first_v7_night_checks_actual_rest_even_after_migration_preflight(db,source):
    from tests.test_attendance_counted_time import _setup as legacy_setup
    employee,site=legacy_setup(db,group='C',rotation_system='24h')
    core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(ANCHOR,'22:00'))
    tomorrow=ANCHOR+timedelta(days=1)
    core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=_ts(tomorrow,'15:00'))
    model=official.ensure_fixed_model(db)
    db.scalar(select(Assignment).where(Assignment.employee_id==employee.id)).rotation_id=model.id
    db.scalar(select(SiteRotation).where(SiteRotation.site_id==site.id)).rotation_id=model.id
    db.commit()
    with pytest.raises(HTTPException) as refused:
        core.record_scan(db,employee=employee,source=source,actor=ACTOR,idempotency_key=None,
            now=_ts(tomorrow,'22:00'),manual_entry_allowed=True,observation='Ne peut contourner le repos')
    assert refused.value.headers['X-Attendance-Code']=='V7_TRANSITION_REST_REQUIRED'
    # 8h real rest is met at 23h, but the >30min admission still needs permission/reason.
    result=core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,
        now=_ts(tomorrow,'23:00'),manual_entry_allowed=True,observation='Relève après repos vérifié')
    assert result['counted']['policy_version']==7 and result['counted']['late_minutes']==60


def test_v7_refused_fact_is_identical_in_beo_ops_drh_and_brq(db,client):
    from tests.test_attendance_api import _user
    from app.modules.attendance import recap
    from app.modules.attendance.routes import business_events
    from app.modules.auth.models import User
    employee,site=_setup(db,group='D')
    db.execute(delete(SiteRotation).where(SiteRotation.site_id==site.id));db.commit()
    with pytest.raises(HTTPException):scan(db,employee,'06:15')
    fact=db.scalar(select(AttendanceEvent).where(AttendanceEvent.employee_id==employee.id))
    point=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.event_id==fact.id))
    assert point.anomaly_type=='ROTATION_NOT_CONFIGURED'
    assert any(r['code']=='ROTATION_NOT_CONFIGURED' for r in live.control_post(db,site.id,_ts(ANCHOR,'06:16'))['todo'])
    assert recap._refusals(db,employee,ANCHOR,ANCHOR,{site.id})[0]['code']=='ROTATION_NOT_CONFIGURED'
    headers=_user(client,db,sites=[site.id],modules=('site_workforce',),actions=('read',))
    response=client.get('/api/site-workforce/attendance/situations',headers=headers)
    assert response.status_code==200
    assert any(r['id']==point.id and r['event_id']==fact.id for r in response.json()['items'])
    alerts=list(db.scalars(select(Alert).where(Alert.dedup_key.in_([f'ATTENDANCE_SITUATION:{point.id}:OPS',f'ATTENDANCE_SITUATION:{point.id}:DRH']))))
    assert len(alerts)==2 and all(a.source_type=='employee' and a.source_id==str(employee.id) for a in alerts)
    for alert in alerts:
        evidence=db.scalar(select(AlertEvidence).where(AlertEvidence.alert_id==alert.id))
        assert evidence.evidence_value_json['id']==point.id
        assert evidence.evidence_value_json['event_id']==fact.id
    admin=db.scalar(select(User).where(User.username=='testadmin'))
    events=business_events(day=ANCHOR,employee_id=employee.id,event_type='REFUSED_ENTRY',page=1,page_size=50,db=db,user=admin)
    assert events['total']==1 and events['items'][0]['event_id']==fact.id
    assert events['items'][0]['details']['code']==point.anomaly_type


@pytest.mark.parametrize('group',['A','D'])
def test_v7_downgrade_cannot_discard_catalog_when_only_frozen_facts_remain(transition_db,group):
    db=transition_db
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from tests.test_pointeur_v7_migration import _module
    employee,site=_setup(db,group=group)
    if group=='A':
        first=scan(db,employee,'06:00')
        fact_id=first['event_id']
    else:
        with pytest.raises(HTTPException):scan(db,employee,'06:00')
        fact_id=db.scalar(select(AttendanceEvent.id).where(AttendanceEvent.employee_id==employee.id))
    frozen=dict(db.get(AttendanceEvent,fact_id).data)
    db.execute(delete(Assignment).where(Assignment.employee_id==employee.id))
    db.execute(delete(SiteRotation).where(SiteRotation.site_id==site.id));db.commit()
    with Operations.context(MigrationContext.configure(db.connection())):
        with pytest.raises(RuntimeError,match='Downgrade refusé'):_module().downgrade()
    assert db.get(AttendanceEvent,fact_id).data==frozen


@pytest.mark.parametrize('linked',[False,True])
def test_obsolete_model_on_an_adopted_v7_site_cannot_restore_unconfigured_fallback(db,linked):
    employee,site=_setup(db,group='A')
    old=official.ensure_official_model(db)
    db.scalar(select(Assignment).where(Assignment.employee_id==employee.id)).rotation_id=old.id
    if linked:db.add(SiteRotation(site_id=site.id,rotation_id=old.id,start_date=ANCHOR,active=1))
    db.commit()
    with pytest.raises(HTTPException) as refused:
        core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,
            now=_ts(ANCHOR+timedelta(days=2),'14:15'))
    assert refused.value.headers['X-Attendance-Code']=='ROTATION_NOT_CONFIGURED'
    assert db.scalar(select(DailyPresence).where(DailyPresence.employee_id==employee.id)) is None


@pytest.mark.parametrize('source',['QR','FACIAL','MANUAL'])
def test_change_to_off_cannot_reopen_previous_extra_slot(db,source):
    employee,site=_setup(db,group='A')
    scan(db,employee,'06:00');scan(db,employee,'14:00')
    db.scalar(select(Assignment).where(Assignment.employee_id==employee.id)).group_code='D';db.commit()
    with pytest.raises(HTTPException) as refused:
        scan(db,employee,'14:35',source=source,manual_entry_allowed=True,observation='Ne dispense pas du planning')
    assert refused.value.headers['X-Attendance-Code']=='OFF_SCHEDULE_REFUSED'
    assert db.scalar(select(AttendanceEvent).where(AttendanceEvent.employee_id==employee.id,AttendanceEvent.event_type=='ARRIVAL').order_by(AttendanceEvent.id.desc())).data['counted']['group']=='A'


@pytest.mark.parametrize('source',['QR','FACIAL'])
def test_first_extra_after_legacy_shift_uses_current_v7_policy_without_rewriting_history(db,source):
    from tests.test_attendance_counted_time import _setup as legacy_setup
    employee,site=legacy_setup(db,group='C')
    first=scan(db,employee,'22:00')
    # Early legacy abandon gives >8h actual rest by 06:35. The V7 lateness/exit
    # guards must still apply to the extra slot from 06h to 14h after adoption.
    scan(db,employee,'22:20',source='MANUAL',manual_entry_allowed=True,
         observation='Départ historique constaté',abandon_shift_id=first['event_id'])
    tomorrow=ANCHOR+timedelta(days=1)
    old=db.scalar(select(Assignment).where(Assignment.employee_id==employee.id))
    old.active=0;old.end_date=ANCHOR
    model=official.ensure_fixed_model(db)
    db.add(Assignment(employee_id=employee.id,site_id=site.id,group_code='C',work_regime='POSTE_CONTINU',rotation_id=model.id,start_date=tomorrow,active=1))
    db.scalar(select(SiteRotation).where(SiteRotation.site_id==site.id)).end_date=ANCHOR
    db.add(SiteRotation(site_id=site.id,rotation_id=model.id,start_date=tomorrow,active=1));db.commit()
    with pytest.raises(HTTPException) as refused:
        core.record_scan(db,employee=employee,source=source,actor=ACTOR,idempotency_key=None,now=_ts(tomorrow,'06:35'))
    assert refused.value.headers['X-Attendance-Code']=='LATE_ENTRY_REFUSED'
    result=core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,now=_ts(tomorrow,'06:35'),manual_entry_allowed=True,observation='Relève supplémentaire validée')
    assert result['counted']['policy_version']==7 and result['counted']['late_minutes']==35
    assert db.get(AttendanceEvent,first['event_id']).data['counted']['policy_version']==1
    with pytest.raises(HTTPException) as early:
        core.record_scan(db,employee=employee,source=source,actor=ACTOR,idempotency_key=None,now=_ts(tomorrow,'07:00'))
    assert early.value.headers['X-Attendance-Code']=='EARLY_EXIT_REFUSED'


@pytest.mark.parametrize('regime',[None,'NORMAL'])
@pytest.mark.parametrize('previous_shift',[False,True])
def test_v7_catalog_or_closed_shift_does_not_change_explicit_normal_or_legacy_regime(db,regime,previous_shift):
    employee,site=_setup(db,group='A')
    if previous_shift:
        scan(db,employee,'06:00');scan(db,employee,'14:00')
    assignment=db.scalar(select(Assignment).where(Assignment.employee_id==employee.id))
    assignment.work_regime=regime;assignment.group_code='D';db.commit()
    # The dated site has a V7 model, but only explicit POSTE_CONTINU uses its rules.
    result=scan(db,employee,'14:35')
    assert result['action']=='arrivee' and result.get('counted') is None
