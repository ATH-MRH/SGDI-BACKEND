"""Real scoped Core reads/writes: no UI-only scope, no second presence store."""
from datetime import date
import uuid
from sqlalchemy import event, select
from tests.test_site_workforce import _setup, _login_as, SOC_A, SOC_B
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401
from app.modules.auth.models import User
from app.modules.ops.models import Assignment, DailyPresence, Site
from app.modules.drh.models import Employee
from app.modules.attendance.models import AttendanceEvent, SOURCE_SITE_WORKFORCE
from app.core.audit import AuditEvent


def get(client, headers, month='2026-10', **params):
    return client.get('/api/site-workforce/attendance/workspace', headers=headers, params={'month': month, **params})


def test_shared_core_bidirectional_coherence_and_audit(client, db, auth_headers):
    c = _setup(db); h = _login_as(client, c, 'charge_a')
    body = {'employee_id': c['emp_a'].id, 'site_id': c['site_a'].id, 'presence_date': '2026-10-03', 'status': 'present'}
    saved = client.post('/api/site-workforce/attendance', headers=h, json=body)
    assert saved.status_code == 200, saved.text
    pid = saved.json()['id']
    beo = get(client, h).json()
    central = client.get('/api/attendance/workspace', headers=auth_headers, params={'month':'2026-10','site_id':c['site_a'].id}).json()
    assert beo['items'] == central['items']
    assert beo['summary'] == central['summary']
    assert beo['summary']['recorded'] == 1
    assert beo['items'][0]['days'][2]['code'] == 'P'
    result = client.patch(f'/api/attendance/presences/{pid}', headers=auth_headers, json={'status':'absent','reason':'Correction centrale'})
    assert result.status_code == 200, result.text
    assert get(client,h).json()['items'][0]['days'][2]['code'] == 'A'
    assert db.scalar(select(AttendanceEvent).where(AttendanceEvent.presence_id==pid, AttendanceEvent.source==SOURCE_SITE_WORKFORCE)).actor_user_id is not None
    audit = db.scalar(select(AuditEvent).where(AuditEvent.action=='site_workforce.attendance.upsert', AuditEvent.resource_id==f'{c["site_a"].id}:{pid}'))
    assert audit.user_id == db.scalar(select(User.id).where(User.username==c['charge_a'][0]))
    assert audit.society == SOC_A
    assert db.query(DailyPresence).filter_by(employee_id=c['emp_a'].id,presence_date=date(2026,10,3)).count() == 1


def test_scope_union_company_site_employee_idor(client, db):
    c=_setup(db); h=_login_as(client,c,'charge_a'); multi=_login_as(client,c,'multi')
    assert [r['employee_id'] for r in get(client,h).json()['items']] == [c['emp_a'].id]
    assert get(client,h,site_id=c['site_b'].id).status_code == 403
    assert get(client,h,society=SOC_B).status_code == 403
    assert get(client,h,employee_id=c['emp_b'].id).status_code == 404
    assert get(client,h,employee_id=c['emp_a'].id).status_code == 200
    assert {r['employee_id'] for r in get(client,multi).json()['items']} == {c['emp_a'].id,c['emp_b'].id}
    assert [r['employee_id'] for r in get(client,multi,society=SOC_B).json()['items']] == [c['emp_b'].id]
    # Same employee also present outside scope: no out-of-scope historical fact may leak.
    db.add(DailyPresence(employee_id=c['emp_a'].id,site_id=c['site_b'].id,presence_date=date(2026,10,7),status='maladie'))
    db.commit()
    day=get(client,h).json()['items'][0]['days'][6]
    assert day['presence_id'] is None and day['status']=='non_pointe'
    assert get(client,_login_as(client,c,'no_site')).status_code == 403


def test_permissions_closure_and_no_workflow_escalation(client, db):
    c=_setup(db); h=_login_as(client,c,'charge_a')
    user=db.scalar(select(User).where(User.username==c['charge_a'][0]));user.authorized_actions=['read'];db.commit()
    assert get(client,h).json()['permissions']['create'] is False
    body={'employee_id':c['emp_a'].id,'site_id':c['site_a'].id,'presence_date':'2026-10-04','status':'present'}
    assert client.post('/api/site-workforce/attendance',headers=h,json=body).status_code==403
    user.authorized_actions=['read','create','update','validate'];db.commit()
    assert client.post('/api/site-workforce/attendance',headers=h,json=body).status_code==200
    assert client.post('/api/site-workforce/attendance/close',headers=h,params={'presence_date':'2026-10-04'}).status_code==200
    user.authorized_actions=['read','create','update'];db.commit()
    body['status']='absent'
    assert client.post('/api/site-workforce/attendance',headers=h,json=body).status_code==409
    day=get(client,h).json()['items'][0]['days'][3]
    assert day['closed'] is True
    assert client.post(f'/api/site-workforce/attendance/{day["presence_id"]}/correct',headers=h,json={'status':'absent','reason':'Motif réel'}).status_code==403
    user.authorized_actions=[];db.commit()
    assert get(client,h).status_code==403
    assert client.post('/api/site-workforce/attendance',headers=h,json=body).status_code==403


def test_calendar_search_pagination_empty_and_query_budget(client, db):
    c=_setup(db);h=_login_as(client,c,'charge_a')
    for month,days in [('2028-02',29),('2027-02',28),('2026-04',30),('2026-10',31)]:
        r=get(client,h,month);assert r.status_code==200,r.text;assert len(r.json()['calendar'])==days
    assert get(client,h,'2026-13').status_code==422
    assert get(client,h,q='AMINE').json()['total']==1
    assert get(client,h,q='inconnu').json()['items']==[]
    assert get(client,h,employee_status='sortant').json()['summary']['agents']==0
    days=get(client,h).json()['calendar'];assert days[1]['weekend'] and days[2]['weekend'] and not days[3]['weekend']
    tag=uuid.uuid4().hex
    for n in range(150):
        e=Employee(code=f'PERF-{tag}-{n}',first_name=f'Agent {n}',last_name='Équipe',society=SOC_A,status='actif');db.add(e);db.flush()
        db.add(Assignment(employee_id=e.id,site_id=c['site_a'].id,start_date=date(2026,9,1),active=1))
    db.commit()
    queries=[]
    def count(*args):queries.append(args[2])
    event.listen(db.bind,'before_cursor_execute',count)
    try:r=get(client,h,q='equipe',page=2,page_size=25)
    finally:event.remove(db.bind,'before_cursor_execute',count)
    assert r.status_code==200,r.text
    d=r.json();assert d['total']==150 and len(d['items'])==25 and d['summary']['agents']==150
    assert len(queries)<35, len(queries)
