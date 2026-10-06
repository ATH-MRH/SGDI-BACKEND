"""Périmètre Société + Site : données isolées, aucune connexion production."""
from types import SimpleNamespace
from datetime import date
import pytest
from fastapi import HTTPException
from app.modules.portal.routes import _attendance_selected_sites, attendance_sites, search_employee_for_manual_attendance
from app.modules.ops.models import Site, Assignment
from app.modules.drh.models import Employee


def test_two_societies_intersect_sites_and_scope_before_search_limit(db):
    sites=[]
    for society in ('IRON GLOBAL SÉCURITÉ','IRON GLOBAL SOLUTION','SWORD CORPORATION'):
        s=Site(name='DUAL '+society,active=1,equipment_plan={'societe':society});db.add(s);db.flush();sites.append(s)
    user=SimpleNamespace(authorized_societies=['IRON GLOBAL SÉCURITÉ','IRON GLOBAL SOLUTION'],authorized_sites=[s.id for s in sites],global_society_access=False,role='ops',access_level='H1')
    assert _attendance_selected_sites(db,user)=={s.id for s in sites[:2]}
    assert {s['society'] for s in attendance_sites(db,user)}==set(user.authorized_societies)
    assert _attendance_selected_sites(db,user,society='IRON GLOBAL SOLUTION')=={sites[1].id}
    for kwargs in ({'society':'SWORD CORPORATION'},{'site_id':sites[2].id},{'society':'IRON GLOBAL SOLUTION','site_id':sites[0].id}):
        with pytest.raises(HTTPException) as error:_attendance_selected_sites(db,user,**kwargs)
        assert error.value.status_code==403
    employees=[]
    for i in range(12):
        emp=Employee(code=f'DUAL_{i}',first_name='Agent',last_name=f'Dual{i:02d}',society='SWORD CORPORATION',status='actif');db.add(emp);db.flush();employees.append(emp)
        db.add(Assignment(employee_id=emp.id,site_id=sites[2].id,active=1,start_date=date(2026,1,1)))
    for i,s in enumerate(sites[:2]):
        emp=Employee(code=f'DUAL_OK{i}',first_name='Agent',last_name='DualZZ',society=user.authorized_societies[i],status='actif');db.add(emp);db.flush();employees.append(emp)
        db.add(Assignment(employee_id=emp.id,site_id=s.id,active=1,start_date=date(2026,1,1)))
    db.flush()
    assert len(search_employee_for_manual_attendance('Dual',None,db,user,None))==2
    assert len(search_employee_for_manual_attendance('Dual',None,db,user,'IRON GLOBAL SOLUTION'))==1
    db.rollback()


def test_http_injected_society_is_denied_on_every_read_endpoint(client, db):
    from app.modules.auth.models import User
    from app.core.security import create_access_token
    site=Site(name='DUAL HTTP',active=1,equipment_plan={'societe':'IRON GLOBAL SOLUTION'})
    db.add(site);db.flush()
    user=User(username='DUAL_HTTP_FIXTURE',password_hash='unused',full_name='Fixture',role='ops',is_active=True,
              authorized_modules=['pointeur'],authorized_societies=['IRON GLOBAL SOLUTION'],authorized_sites=[site.id],
              authorized_structures=['pointage'],global_society_access=False)
    db.add(user);db.flush()
    headers={'Authorization':'Bearer '+create_access_token(subject=str(user.id))}
    for route in ('sites','feed','live','sheet','staffing','alerts','anomalies','manual/search'):
        response=client.get('/api/portal/attendance-'+route,params={'society':'SWORD CORPORATION','q':'Dual'},headers=headers)
        assert response.status_code==403,(route,response.text)
    db.rollback()


def test_daily_summary_is_computed_before_event_limit(db):
    from datetime import datetime,timedelta
    from app.modules.attendance.models import AttendanceEvent,EVENT_ARRIVAL,EVENT_DEPARTURE
    from app.modules.portal.routes import attendance_feed
    site=Site(name='DUAL DAILY',active=1,equipment_plan={'societe':'IRON GLOBAL SOLUTION'});db.add(site);db.flush()
    emp=Employee(code='DUAL_DAILY',first_name='Fixture',last_name='Daily',society='IRON GLOBAL SOLUTION',status='actif');db.add(emp);db.flush()
    start=datetime(2026,10,6,7,0)
    for i in range(222):
        db.add(AttendanceEvent(employee_id=emp.id,society=emp.society,site_id=site.id,presence_date=date(2026,10,6),
               occurred_at=start+timedelta(seconds=i),event_type=EVENT_ARRIVAL if i%2==0 else EVENT_DEPARTURE,
               source='MANUAL',data={}))
    db.flush()
    user=SimpleNamespace(authorized_societies=[emp.society],authorized_sites=[site.id],global_society_access=False,role='ops',access_level='H1')
    data=attendance_feed(date='2026-10-06',include_daily=True,limit=200,db=db,user=user)
    assert len(data['events'])==200
    assert data['events_limited'] is True
    assert len(data['daily'])==1
    assert data['daily'][0]['arrival']=='08:00:00'
    assert data['daily'][0]['departure']=='08:03:41'
    assert data['daily'][0]['status']=='Sorti'
    db.rollback()


def test_company_filter_changes_real_feed_present_rows_and_counters(db, monkeypatch):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.modules.attendance import core
    from app.modules.attendance.models import AttendanceEvent,EVENT_ARRIVAL
    from app.modules.portal.routes import attendance_feed,attendance_live
    societies=['IRON GLOBAL SÉCURITÉ','IRON GLOBAL SOLUTION']
    now=datetime(2026,10,6,15,0,tzinfo=ZoneInfo('Africa/Algiers'))
    monkeypatch.setattr(core,'_now_local',lambda:now)
    sites=[];employees=[]
    for i,soc in enumerate(societies):
        site=Site(name=f'DUAL LIVE {i}',active=1,equipment_plan={'societe':soc});db.add(site);db.flush();sites.append(site)
        emp=Employee(code=f'DUAL_LIVE{i}',first_name='Fixture',last_name='Agent',society=soc,status='actif');db.add(emp);db.flush();employees.append(emp)
        db.add(Assignment(employee_id=emp.id,site_id=site.id,active=1,start_date=date(2026,1,1)))
        db.add(AttendanceEvent(employee_id=emp.id,society=soc,site_id=site.id,presence_date=now.date(),
            occurred_at=core.to_utc_naive(now),event_type=EVENT_ARRIVAL,source='MANUAL',data={}))
    db.flush()
    user=SimpleNamespace(id=None,username='FIXTURE',authorized_societies=societies,authorized_sites=[s.id for s in sites],global_society_access=False,role='ops',access_level='H1')
    for i,soc in enumerate(societies):
        feed=attendance_feed(date='2026-10-06',society=soc,include_daily=True,db=db,user=user)
        assert {r['employee_id'] for r in feed['daily']}=={employees[i].id}
        state=attendance_live(society=soc,db=db,user=user)
        assert state['summary']['present_now']==1
        assert {r['employee']['id'] for r in state['post']['present']}=={employees[i].id}
    state=attendance_live(db=db,user=user)
    assert state['summary']['present_now']==2
    assert state['post']['kpi']['present']==2
    assert {r['employee']['id'] for r in state['post']['present']}=={e.id for e in employees}
    db.rollback()
