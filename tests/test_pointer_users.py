"""Delegated pointer administration uses central users and deny-by-default scopes."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import date

import pytest
from sqlalchemy import select,func
from app.core.security import create_access_token,hash_password
from app.modules.auth.models import User,UserFeaturePermission,UserModulePermission,AuditEvent
from app.modules.ops.models import Site,Assignment
from app.modules.drh.models import Employee
from app.modules.attendance.models import AttendanceEvent
from tests.module_cleanup import purge_rows_created_by_this_module

API='/api/attendance/pointers'
SOC='IRON GLOBAL SOLUTION'
PASSWORD='Pointer-Test-12345'

def setup(db, features=('read','create','update')):
    tag=uuid.uuid4().hex[:8]
    sites=[Site(name='Pointer '+tag+str(i),active=1,equipment_plan={'societe':SOC if i<2 else 'OTHER'}) for i in range(3)]
    db.add_all(sites);db.flush()
    manager=User(username='PTG_MANAGER_'+tag,full_name='Responsable',role='agent',is_active=True,password_hash=hash_password(PASSWORD),authorized_modules=['pointage'],authorized_actions=['read','create','update'],authorized_societies=[SOC],authorized_sites=[s.id for s in sites[:2]],global_society_access=False)
    db.add(manager);db.flush()
    for action in features: db.add(UserFeaturePermission(user_id=manager.id,module_key='administration',feature_key='users',action_key=action))
    db.commit()
    return manager,sites,{'Authorization':'Bearer '+create_access_token(str(manager.id))}

def payload(site):
    return {'username':'PTG'+uuid.uuid4().hex[:9].upper(),'full_name':'Pointeur Oran','password':PASSWORD,'societies':[SOC],'site_ids':[site.id],'is_active':True}

def login(client,username):
    return client.post('/api/auth/login',headers={'Host':'pointeur.irongs.com'},json={'username':username,'password':PASSWORD})


def test_create_central_login_scope_audit_disable_and_system_admin(client,db,auth_headers):
    manager,sites,headers=setup(db);body=payload(sites[0])
    response=client.post(API,headers=headers,json=body);assert response.status_code==200,response.text
    pointer=response.json();uid=pointer['id']
    db.expire_all();user=db.get(User,uid)
    assert (user.role,user.access_level,user.authorized_modules,user.authorized_actions)==('pointeur','H2',['pointeur'],['read','create'])
    assert not user.global_society_access
    assert {(r.module_key,r.feature_key,r.action_key) for r in db.scalars(select(UserFeaturePermission).where(UserFeaturePermission.user_id==uid))}=={('attendance',f,a) for f in ('qr_scanning','manual_entry') for a in ('read','create')}
    assert any(row['id']==uid for row in client.get('/api/auth/users',headers=auth_headers).json())
    logged=login(client,user.username);assert logged.status_code==200,logged.text
    token={'Authorization':'Bearer '+logged.json()['access_token'],'Host':'pointeur.irongs.com'}
    assert [s['id'] for s in client.get('/api/portal/attendance-sites',headers=token).json()]==[sites[0].id]
    assert client.get('/api/portal/attendance-manual/search?q=Test&site_id='+str(sites[2].id),headers=token).status_code==403
    for endpoint in ('/api/drh/employees','/api/ops/sites','/api/materiel/articles','/api/auth/users',API):
        assert client.get(endpoint,headers=token).status_code==403,endpoint
    employee=Employee(code='PTR'+uuid.uuid4().hex[:8],first_name='Test',last_name='Pointer',society=SOC,status='actif')
    db.add(employee);db.flush();db.add(Assignment(employee_id=employee.id,site_id=sites[0].id,start_date=date(2026,1,1),active=1,group_code='A'));db.commit()
    qr=create_access_token(employee.code,claims={'attendance_qr':True,'employee_id':employee.id,'nonce':uuid.uuid4().hex},ttl_seconds=120)
    scan=client.post('/api/portal/attendance-qr/scan',headers=token,json={'token':qr,'site_id':sites[0].id});assert scan.status_code==201,scan.text
    db.expire_all();event=db.scalar(select(AttendanceEvent).where(AttendanceEvent.employee_id==employee.id))
    assert event.actor_user_id==uid and event.actor_label==user.username and event.site_id==sites[0].id
    changed=client.patch(API+'/'+str(uid),headers=headers,json={'full_name':'Pointeur multisite','site_ids':[s.id for s in sites[:2]]});assert changed.status_code==200,changed.text
    listing=client.get(API,headers=headers).json();assert listing['kpi']=={'total':1,'active':1,'disabled':0,'sites':2}
    assert listing['items'][0]['last_login']
    assert client.patch(API+'/'+str(uid),headers=headers,json={'is_active':False}).status_code==200
    assert login(client,user.username).status_code==401
    assert client.post('/api/portal/attendance-qr/scan',headers=token,json={'token':qr,'site_id':sites[0].id}).status_code==401
    assert client.get('/api/auth/me',headers=token).status_code==401
    assert client.patch('/api/auth/users/'+user.username,headers=auth_headers,json={'full_name':'Modifié depuis Administration','is_active':True}).status_code==200
    assert login(client,user.username).status_code==200
    assert client.patch('/api/auth/users/'+user.username,headers=auth_headers,json={'authorized_sites':[]}).status_code==422
    db.expire_all();assert db.get(AttendanceEvent,event.id)
    audits=list(db.scalars(select(AuditEvent).where(AuditEvent.resource_id==str(uid),AuditEvent.action.like('pointer_user.%'))))
    assert {r.action for r in audits}=={'pointer_user.created','pointer_user.updated','pointer_user.scope_changed','pointer_user.disabled'}
    assert all(r.user_id==manager.id and PASSWORD not in (r.new_state or '') for r in audits)


@pytest.mark.parametrize('extra',[{'authorized_modules':['drh']},{'role':'ADMIN'},{'authorized_actions':['admin']},{'global_society_access':True},{'access_level':'H5'}])
def test_payload_cannot_escalate(client,db,extra):
    _,sites,headers=setup(db);body=payload(sites[0]);body.update(extra)
    assert client.post(API,headers=headers,json=body).status_code==422


def test_scope_and_permissions_cannot_escalate(client,db):
    _,sites,headers=setup(db)
    for changes,code in [({'societies':[]},422),({'site_ids':[]},422),({'societies':['OTHER'],'site_ids':[sites[2].id]},403),({'site_ids':[sites[2].id]},403)]:
        body=payload(sites[0]);body.update(changes);assert client.post(API,headers=headers,json=body).status_code==code
    _,_,no_grants=setup(db,features=())
    assert client.get(API,headers=no_grants).status_code==403
    assert client.post(API,headers=no_grants,json=payload(sites[0])).status_code==403
    out=User(username='PTG_OUT_'+uuid.uuid4().hex[:8],full_name='Outside',role='pointeur',is_active=False,password_hash=hash_password(PASSWORD),authorized_societies=['OTHER'],authorized_sites=[sites[2].id],authorized_modules=['pointeur'],authorized_actions=['read','create'])
    db.add(out);db.commit()
    assert out.id not in [r['id'] for r in client.get(API,headers=headers).json()['items']]
    for body in ({'full_name':'Changed'},{'is_active':True},{'site_ids':[sites[0].id],'societies':[SOC]}):
        assert client.patch(API+'/'+str(out.id),headers=headers,json=body).status_code==404
    own=client.post(API,headers=headers,json=payload(sites[0])).json()
    assert client.patch(API+'/'+str(own['id']),headers=headers,json={'site_ids':[sites[2].id],'societies':['OTHER']}).status_code==403
    assert client.patch(API+'/'+str(own['id']),headers=headers,json={'authorized_actions':['admin']}).status_code==422
    _,_,creator=setup(db,features=('create',))
    assert client.get(API,headers=creator).status_code==403
    assert client.patch(API+'/'+str(own['id']),headers=creator,json={'is_active':False}).status_code==403


def test_concurrent_same_username_one_central_user(live_client,db):
    _,sites,headers=setup(db);body=payload(sites[0]);barrier=Barrier(2)
    def create():
        barrier.wait();return live_client.post(API,headers=headers,json=body).status_code
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:create(),range(2)))
    assert sorted(results)==[200,409]
    db.expire_all();assert db.scalar(select(func.count(User.id)).where(User.username==body['username']))==1
