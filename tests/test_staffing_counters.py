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
