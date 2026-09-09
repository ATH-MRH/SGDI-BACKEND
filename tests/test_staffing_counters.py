from datetime import date, timedelta

from app.modules.commercial.models import Client
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from app.modules.ui.service import _staffing_stats


def test_staffing_uses_commercial_contracts_and_distinct_current_ops_employees(db):
    today = date.today()
    society = 'STAFFING SOCIETY A'
    def customer(name, company=society, start=None, end=None, status='actif', required=5):
        row = Client(name=name, society=company, status=status,
                     contract_start=start or today-timedelta(days=10), contract_end=end,
                     data={'tech_sites':[{'totalEffectif':required}]})
        db.add(row); db.flush()
        return row
    active = customer('Active')
    other = customer('Other', company='STAFFING SOCIETY B', required=30)
    expired = customer('Expired', end=today-timedelta(days=1), required=50)
    customer('Future', start=today+timedelta(days=1), required=60)
    customer('Inactive', status='inactif', required=70)
    undated = customer('Undated', required=80)
    undated.contract_start = None
    def site(client, active_flag=1):
        row=Site(name='Site',client_id=client.id if client else None,active=active_flag,contractual_staff=999)
        db.add(row); db.flush(); return row
    s1,s2,sold,sother,sinactive,sunlinked=site(active),site(active),site(expired),site(other),site(active,0),site(None)
    def employee(code, status='actif', company=society):
        row=Employee(code=code,first_name='Test',last_name='Staff',society=company,status=status)
        db.add(row); db.flush(); return row
    def assign(emp, target, start=None, end=None, active_flag=1):
        db.add(Assignment(employee_id=emp.id,site_id=target.id,start_date=start or today,
                          end_date=end,active=active_flag))
    current=employee('STAFF-CURRENT'); assign(current,s1); assign(current,s2)
    leave=employee('STAFF-LEAVE','congé'); assign(leave,s1)
    assign(employee('STAFF-FORMER','sortant'),s1)
    assign(employee('STAFF-FUTURE'),s1,start=today+timedelta(days=1))
    assign(employee('STAFF-ENDED'),s1,end=today-timedelta(days=1))
    assign(employee('STAFF-INACTIVE'),s1,active_flag=0)
    assign(employee('STAFF-OLD-CONTRACT'),sold)
    assign(employee('STAFF-INACTIVE-SITE'),sinactive)
    assign(employee('STAFF-NO-LINK'),sunlinked)
    assign(employee('STAFF-OTHER-SOCIETY',company='STAFFING SOCIETY B'),s1)
    assign(employee('STAFF-OTHER',company='STAFFING SOCIETY B'),sother)
    db.flush()
    assert _staffing_stats(db,[society]) == {'contract':5,'actual':2,'gap':-3,'contracts':1}
    assert _staffing_stats(db,[]) == {'contract':0,'actual':0,'gap':0,'contracts':0}
    assert _staffing_stats(db,['STAFFING SOCIETY B'])['actual'] == 1
    active.data={'tech_sites':[{'totalEffectif':2}]}; db.flush()
    assert _staffing_stats(db,[society])['gap'] == 0
    active.data={'tech_sites':[{'totalEffectif':1}]}; db.flush()
    assert _staffing_stats(db,[society])['gap'] == 1


def test_dc_structured_contract_is_authority_over_legacy_site_totals(db):
    today = date.today()
    c = Client(name='DC Structured',society='DC STAFF TEST',status='actif',data={
        'tech_sites':[{'totalEffectif':999}], 'dc_contract_status':'valide',
        'dc_contract_sites':[{'key':'dc-one','rotation_start_date':today.isoformat(),'requirements':{'CARISTE':3,'APS':2}}]})
    db.add(c);db.flush()
    e = Employee(code='DC-STAFF-ONE',first_name='Test',last_name='Test',society=c.society,status='actif')
    db.add(e);db.flush()
    site = Site(name='DC Site',client_id=c.id,active=1,contractual_staff=999,equipment_plan={'dcContractSiteKey':'dc-one'})
    db.add(site);db.flush()
    db.add(Assignment(employee_id=e.id,site_id=site.id,start_date=today,active=1));db.flush()
    assert _staffing_stats(db,[c.society]) == {'contract':20,'actual':1,'gap':-19,'contracts':1}
    c.data={**c.data,'dc_contract_status':'brouillon'};db.flush()
    assert _staffing_stats(db,[c.society])['contract'] == 0
    assert _staffing_stats(db,[c.society])['actual'] == 0


def test_ops_and_legacy_creation_are_refused_even_to_admin(client, auth_headers):
    for url,payload in [('/api/ops/sites',{'name':'Forbidden independent site'}),
                        ('/api/irongs/collections/sites/items',{'data':{'nom':'Forbidden legacy site'}})]:
        result=client.post(url,headers=auth_headers,json=payload)
        assert result.status_code == 403, result.text
        assert 'Commercial' in result.json()['detail']


def test_commercial_republish_preserves_ops_rotation_and_map(client, auth_headers):
    customer=client.post('/api/commercial/clients',headers=auth_headers,json={'name':'DC OPS responsibilities','society':'Iron Global Securite','status':'actif'})
    assert customer.status_code == 200
    cid=customer.json()['id']
    payload={'status':'valide','sites':[{'key':'ops-owned','name':'Site DC OPS','rotation_start_date':'2020-01-01','requirements':{'APS':2}}]}
    published=client.put(f'/api/commercial/dc/clients/{cid}/contract',headers=auth_headers,json=payload)
    assert published.status_code == 200
    sid=published.json()['published_site_ids'][0]
    operations={'rotation_system':'24/48','equipment_plan':{'latitude':'36.7','longitude':'3.1','clientPortalRotation':{'system':'24/48','start_date':'2020-01-01'}}}
    changed=client.put(f'/api/ops/sites/{sid}',headers=auth_headers,json=operations)
    assert changed.status_code == 200, changed.text
    assert changed.json()['equipment_plan']['contractualReadOnly'] is True
    again=client.put(f'/api/commercial/dc/clients/{cid}/contract',headers=auth_headers,json=payload)
    assert again.status_code == 200
    assert again.json()['published_site_ids'] == [sid]
    from app.modules.ops.models import Site
    from app.db.session import get_db
    provider=client.app.dependency_overrides[get_db]()
    db=next(provider)
    try:
        db.expire_all(); site=db.get(Site,sid)
        assert site.rotation_system == '24/48'
        assert site.equipment_plan['clientPortalRotation']['system'] == '24/48'
        assert site.equipment_plan['latitude'] == '36.7'
        assert site.contractual_staff == 8
    finally:
        provider.close()


def test_legacy_site_save_preserves_dc_contract_and_ops_documents(db):
    from app.modules.irongs.sql_bridge import upsert_site
    s=Site(name='DC protected',contractual_staff=12,groups_count=4,equipment_plan={
        'contractualReadOnly':True,'contractualSource':'dc.irongs.com',
        'dcContractSiteKey':'protected','positionQuotas':{'APS':12}})
    db.add(s);db.flush()
    result=upsert_site(db,{'backendId':s.id,'nom':s.name,'effectifs':{'totalContractuel':999},
                           'contractualReadOnly':False,'positionQuotas':{'APS':999},
                           'documents':{'pv':{'title':'PV fermeture'}},'latitude':'36.7'})
    db.flush();db.expire_all();s=db.get(Site,s.id)
    assert s.contractual_staff == 12
    assert result['effectifs']['totalContractuel'] == 12
    assert s.equipment_plan['_legacy']['effectifs']['totalContractuel'] == 12
    assert s.equipment_plan['contractualReadOnly'] is True
    assert s.equipment_plan['positionQuotas'] == {'APS':12}
    assert s.equipment_plan['documents']['pv']['title'] == 'PV fermeture'
    assert s.equipment_plan['latitude'] == '36.7'
