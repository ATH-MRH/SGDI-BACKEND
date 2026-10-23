"""Synthetic facts only: server scope, canonical counts and Core integration."""
from datetime import timedelta
from sqlalchemy import select, event
from app.modules.attendance import core, live
from app.modules.attendance.models import AttendanceEvent, AttendanceAnomaly
from app.modules.site_workforce.attendance_live import read_live
from app.modules.site_workforce.security import build_scope
from app.modules.auth.models import User
from app.modules.ops.models import Assignment, DailyPresence
from tests.test_site_workforce import _setup, _login_as, SOC_B
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401


def setup(db, client):
    c = _setup(db)
    h = _login_as(client, c, 'charge_a')
    user = db.scalar(select(User).where(User.username == c['charge_a'][0]))
    return c, h, build_scope(db, user)


def scan(db, c, employee='emp_a', when=None):
    r = core.record_scan(db, employee=c[employee], source='QR', actor=None,
                         idempotency_key=None, now=when or core._now_local())
    db.flush()
    return r


def test_real_core_entry_exit_non_divergence_and_daily(client, db):
    c,h,scope = setup(db,client)
    now = core._now_local().replace(hour=12, minute=0, second=0, microsecond=0)
    scan(db,c,when=now-timedelta(hours=3))
    first = read_live(db,scope,now=now)
    assert first['events'][0]['movement'] == 'ARRIVAL'
    assert first['summary']['present_now'] == 1
    assert first['summary']['entries_today'] == 1
    for k,v in live.summary(db,set(scope.selected),now).items():
        assert first['summary'][k] == v
    scan(db,c,when=now-timedelta(hours=1))
    second = read_live(db,scope,now=now)
    assert [e['movement'] for e in second['events']] == ['DEPARTURE','ARRIVAL']
    assert second['summary']['present_now'] == 0
    assert second['summary']['exits_today'] == 1
    assert db.scalar(select(DailyPresence).where(DailyPresence.employee_id==c['emp_a'].id)).status == 'present'
    assert read_live(db,scope,employee_id=c['emp_a'].id,now=now)['events'] == second['events']
    for k,v in live.summary(db,set(scope.selected),now).items():
        assert second['summary'][k] == v


def test_http_scope_idor_no_data_leak_and_no_cache(client,db):
    c,h,scope=setup(db,client)
    scan(db,c);scan(db,c,'emp_b')
    r=client.get('/api/site-workforce/attendance/live',headers=h)
    assert r.status_code==200,r.text
    assert r.headers['cache-control']=='no-store, private'
    assert {e['employee']['id'] for e in r.json()['events']}=={c['emp_a'].id}
    assert SOC_B not in r.text and c['emp_b'].code not in r.text
    for params in ({'site_id':c['site_b'].id},{'society':SOC_B},{'employee_id':c['emp_b'].id}):
        assert client.get('/api/site-workforce/attendance/live',headers=h,params=params).status_code in (403,404)
    assert client.get('/api/site-workforce/attendance/live',headers=_login_as(client,c,'no_site')).status_code==403
    user=db.scalar(select(User).where(User.username==c['charge_a'][0]));user.authorized_actions=['update'];db.flush()
    assert client.get('/api/site-workforce/attendance/live',headers=h).status_code==403


def test_filters_anomalies_history_and_pagination(client,db):
    c,h,scope=setup(db,client);now=core._now_local().replace(hour=14)
    for i in range(6):
        db.add(AttendanceEvent(employee_id=c['emp_a'].id,site_id=c['site_a'].id,presence_date=now.date(),
                              occurred_at=core.to_utc_naive(now-timedelta(minutes=10-i)),
                              event_type='ARRIVAL' if i%2==0 else 'DEPARTURE',source='QR'))
    db.flush()
    first=read_live(db,scope,now=now,limit=2);second=read_live(db,scope,now=now,limit=2,before_id=first['next_before_id'])
    assert len(first['events'])==2 and len(second['events'])==2
    assert not {e['id'] for e in first['events']}&{e['id'] for e in second['events']}
    assert first['events'][0]['occurred_at']>second['events'][0]['occurred_at']
    eid=first['events'][0]['id']
    db.add(AttendanceAnomaly(employee_id=c['emp_a'].id,site_id=c['site_a'].id,presence_date=now.date(),event_id=eid,
                             anomaly_type='LATE',severity='warning',status='OPEN',message='Retard synthétique',dedupe_key=f'live-{eid}'));db.flush()
    assert len(read_live(db,scope,now=now,event_status='anomaly')['events'])==1
    assert read_live(db,scope,now=now)['summary']['late']==1
    assert read_live(db,scope,now=now,q='alpha')['events']
    assert not read_live(db,scope,now=now,q='introuvable')['events']
    assert not read_live(db,scope,now=now,group='B')['events']
    assert not read_live(db,scope,now=now,method='FACIAL')['events']
    assert all(e['movement']=='ARRIVAL' for e in read_live(db,scope,now=now,movement='ARRIVAL')['events'])
    assert read_live(db,scope,now=now)['permissions']=={'write':False}


def test_out_of_scope_agent_at_allowed_site_is_excluded(client,db):
    c,h,scope=setup(db,client);now=core._now_local()
    db.add(AttendanceEvent(employee_id=c['emp_b'].id,site_id=c['site_a'].id,presence_date=now.date(),
                          occurred_at=core.to_utc_naive(now),event_type='ARRIVAL',source='QR'));db.flush()
    data=read_live(db,scope,now=now)
    assert not data['events'] and data['summary']['entries_today']==0
    assert data['summary']['present_now']==0


def test_multi_site_union_and_read_has_no_writes(client,db):
    c,h,_=setup(db,client);scan(db,c);scan(db,c,'emp_b')
    user=db.scalar(select(User).where(User.username==c['multi'][0]));scope=build_scope(db,user)
    statements=[]
    def capture(conn,cursor,statement,*args):statements.append(statement)
    event.listen(db.bind,'before_cursor_execute',capture)
    try:data=read_live(db,scope)
    finally:event.remove(db.bind,'before_cursor_execute',capture)
    assert {e['site_id'] for e in data['events']}==set(scope.selected)
    assert not any(s.lstrip().upper().startswith(('INSERT','UPDATE','DELETE')) for s in statements)
    assert len(statements)<25,len(statements)


def test_non_pointed_population_and_timezone(client,db):
    c,h,scope=setup(db,client)
    data=read_live(db,scope,population='not_clocked')
    assert data['summary']['not_clocked']==1
    assert data['agents'][0]['id']==c['emp_a'].id
    assert data['generated_at'].endswith('+01:00')


def test_photos_follow_existing_field_permission(client,db,monkeypatch):
    from app.modules.site_workforce import position_file
    c,h,scope=setup(db,client)
    c['emp_a'].extra={'photo':'data:image/png;base64,c3ludGhldGlj'};db.flush();scan(db,c)
    monkeypatch.setattr(position_file,'allowed_fields',lambda *args:frozenset())
    denied=client.get('/api/site-workforce/attendance/live',headers=h)
    assert denied.status_code==200,denied.text
    assert denied.json()['events'][0]['employee']['photo_url'] is None
    assert 'c3ludGhldGlj' not in denied.text
    monkeypatch.setattr(position_file,'allowed_fields',lambda *args:frozenset({'identity.photo'}))
    allowed=client.get('/api/site-workforce/attendance/live',headers=h)
    assert allowed.json()['events'][0]['employee']['photo_url'].startswith('/api/site-workforce/positions/')
    assert 'c3ludGhldGlj' not in allowed.text


def test_invalid_filters_and_foreign_cursor_rejected(client,db):
    c,h,scope=setup(db,client);scan(db,c);scan(db,c,'emp_b')
    for params in ({'limit':1000},{'movement':'FORGED'},{'population':'FORGED'},{'event_status':'FORGED'}):
        assert client.get('/api/site-workforce/attendance/live',headers=h,params=params).status_code==422
    other=db.scalar(select(AttendanceEvent.id).where(AttendanceEvent.employee_id==c['emp_b'].id))
    assert client.get('/api/site-workforce/attendance/live',headers=h,params={'before_id':other}).status_code==404


def test_population_query_count_does_not_grow_with_agents(client,db):
    from app.modules.drh.models import Employee
    c,h,scope=setup(db,client)
    for i in range(150):
        e=Employee(code=f'BEOLIVE-{c["tag"]}-{i}',first_name='Synthétique',last_name=f'Agent {i}',status='actif')
        db.add(e);db.flush()
        db.add(Assignment(employee_id=e.id,site_id=c['site_a'].id,start_date=core._now_local().date(),group_code='A',active=1))
    db.flush();queries=[]
    def capture(conn,cursor,statement,*args):queries.append(statement)
    event.listen(db.bind,'before_cursor_execute',capture)
    try:data=read_live(db,scope,population='not_clocked')
    finally:event.remove(db.bind,'before_cursor_execute',capture)
    assert data['summary']['employees']==151
    assert len(data['agents'])==50 and data['next_before_id'] is not None
    assert len(queries)<25,len(queries)
