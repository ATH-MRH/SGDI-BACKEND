"""Reset admin borné : ancien import inutilisable, zéro création et un seul nouveau lien."""
from datetime import date, datetime, timedelta
import json
import uuid

import pytest
from sqlalchemy import select

from app.core.audit import append_audit
from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User
from app.modules.drh import contract_import_oneoff as oneoff
from app.modules.drh.candidate_import_models import CandidateImportSession
from app.modules.drh.models import Contract, Document, Employee, GeneratedContract
from tests.test_drh_contract_excel_import import BASE, preview
from tests.test_drh_contract_import_oneoff import authorized, batch96, counts

RESET = BASE + '/oneoff/reset'


def payload(sid, **changes):
    return {'society':oneoff.SOCIETY, 'file_sha256':oneoff.FILE_SHA256,
            'batch_key':oneoff.BATCH_KEY, 'old_session_id':sid, **changes}


def blocked_session(client, headers, db, batch96, *, cancel=True):
    sid, content = authorized(client, headers, batch96)
    assert preview(client, headers, sid, {})['recognized'] == 75
    if cancel:
        assert client.post(f'{BASE}/{sid}/cancel', headers=headers).status_code == 200
    return sid, content


def test_admin_reset_allows_one_new_upload_keeps_candidates_and_audits_old_and_new(client,auth_headers,db,batch96):
    sid,content=blocked_session(client,auth_headers,db,batch96)
    before=counts(db)
    original_ids=list(db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).candidate_ids)
    context=client.get(RESET+'-context',headers=auth_headers,params={k:v for k,v in payload(sid).items() if k!='old_session_id'})
    assert context.status_code==200 and context.json()['old_session_id']==sid and context.json()['can_reset']
    response=client.post(RESET,headers=auth_headers,json=payload(sid))
    assert response.status_code==200,response.text
    assert response.json()['old_session_id']==sid and response.json()['new_session_id'] is None
    assert client.post(f'{BASE}/{sid}/confirm',headers=auth_headers).status_code==410
    assert client.post(RESET,headers=auth_headers,json=payload(sid)).status_code==409
    new=client.post(BASE,headers=auth_headers,params={'society':oneoff.SOCIETY},files={'file':('same.xlsx',content)})
    assert new.status_code==200,new.text
    new_sid=new.json()['session_id']
    assert new_sid!=sid and new.json()['preparation_only_file']
    assert client.post(BASE,headers=auth_headers,params={'society':oneoff.SOCIETY},files={'file':('same.xlsx',content)}).status_code==409
    grant=db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY);db.refresh(grant)
    assert grant.session_id==new_sid and grant.candidate_ids==original_ids
    assert preview(client,auth_headers,new_sid,{})['recognized']==75
    assert client.post(f'{BASE}/{new_sid}/confirm',headers=auth_headers).status_code==409
    assert counts(db)==before
    events=db.scalars(select(AuditEvent).where(AuditEvent.action.in_(['drh.contract.excel.oneoff.reset','drh.contract.excel.oneoff.reset.rebound']))).all()
    details=[(e,json.loads(e.new_state)) for e in events if json.loads(e.new_state)['old_session_id']==sid]
    assert len(details)==2
    for event,detail in details:
        assert event.username=='testadmin' and detail['requested_by_user_id'] and detail['requested_at']
        assert detail['file_sha256']==oneoff.FILE_SHA256 and detail['society']==oneoff.SOCIETY
        assert detail['reason']=='Réinitialisation exceptionnelle du lot contractualisation Excel'
    assert next(d for e,d in details if e.action.endswith('rebound'))['new_session_id']==new_sid


@pytest.mark.parametrize('state', ['expired','failed','unusable','purged'])
def test_unusable_previous_session_can_be_reset(client,auth_headers,db,batch96,state):
    sid,_=blocked_session(client,auth_headers,db,batch96,cancel=False)
    old=db.scalar(select(CandidateImportSession).where(CandidateImportSession.public_id==sid))
    if state=='expired':old.expires_at=datetime.utcnow()-timedelta(minutes=1)
    elif state=='failed':old.status='failed'
    elif state=='unusable':old.workbook=None
    else:db.delete(old)
    db.commit()
    response=client.post(RESET,headers=auth_headers,json=payload(sid))
    assert response.status_code==200,response.text


@pytest.mark.parametrize('state', ['uploaded','previewed','processing'])
def test_active_or_processing_session_cannot_be_reset(client,auth_headers,db,batch96,state):
    sid,_=blocked_session(client,auth_headers,db,batch96,cancel=False)
    old=db.scalar(select(CandidateImportSession).where(CandidateImportSession.public_id==sid));old.status=state;db.commit()
    assert client.post(RESET,headers=auth_headers,json=payload(sid)).status_code==409
    assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid


@pytest.mark.parametrize('key', ['created_contracts','created_employees','created_documents'])
def test_any_creation_counter_refuses_reset(client,auth_headers,db,batch96,key):
    sid,_=blocked_session(client,auth_headers,db,batch96)
    old=db.scalar(select(CandidateImportSession).where(CandidateImportSession.public_id==sid));old.result={key:1};db.commit()
    assert client.post(RESET,headers=auth_headers,json=payload(sid)).status_code==409
    assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid


@pytest.mark.parametrize('kind', ['employee','contract','document','generated'])
def test_actual_business_rows_refuse_reset_even_with_zero_counters(client,auth_headers,db,batch96,kind):
    sid,_=blocked_session(client,auth_headers,db,batch96)
    candidate=batch96[0][0]
    created=[]
    if kind in {'employee','contract','generated'}:
        employee=Employee(code='RESET-'+uuid.uuid4().hex[:10],first_name='OTHER',last_name='TEST',society=oneoff.SOCIETY,
            extra={'sourceCandidateId':candidate.id} if kind!='generated' else {})
        db.add(employee);db.flush();created.append(employee)
        if kind=='contract':
            contract=Contract(employee_id=employee.id,contract_type='CDD',start_date=date(2026,1,1))
            db.add(contract);created.append(contract)
        if kind=='generated':
            document=GeneratedContract(employee_id=employee.id,reference=uuid.uuid4().hex,title='Test',contract_type='CDD',
                file_name='contrat.docx',mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',file_content=b'test',values={'session_id':sid})
            db.add(document);created.append(document)
    else:
        document=Document(owner_type='candidate',owner_id=candidate.id,label='Contrat signé',file_name='contrat.pdf')
        db.add(document);created.append(document)
    db.commit()
    try:
        response=client.post(RESET,headers=auth_headers,json=payload(sid))
        assert response.status_code==409,response.text
        assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid
    finally:
        for row in reversed(created):
            db.delete(row)
            db.flush()
        db.commit()


@pytest.mark.parametrize('change', [{'file_sha256':'0'*64},{'society':'AUTRE SOCIETE'},{'batch_key':'another-batch'},{'old_session_id':'contract-stale-session'}])
def test_other_file_society_batch_or_stale_session_is_refused(client,auth_headers,db,batch96,change):
    sid,_=blocked_session(client,auth_headers,db,batch96)
    assert client.post(RESET,headers=auth_headers,json=payload(sid,**change)).status_code==409
    assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid


def test_audited_creation_still_refuses_reset(client,auth_headers,db,batch96):
    sid,_=blocked_session(client,auth_headers,db,batch96)
    append_audit(db,action='drh.contract.excel.created',resource='contract_import',result='success',
        new_state={'session_id':sid,'candidate_id':batch96[0][0].id})
    db.commit()
    assert client.post(RESET,headers=auth_headers,json=payload(sid)).status_code==409


def test_another_explicit_admin_reset_is_required_for_a_second_rebinding(client,auth_headers,db,batch96):
    sid,content=blocked_session(client,auth_headers,db,batch96)
    assert client.post(RESET,headers=auth_headers,json=payload(sid)).status_code==200
    new=client.post(BASE,headers=auth_headers,params={'society':oneoff.SOCIETY},files={'file':('same.xlsx',content)}).json()['session_id']
    assert client.post(RESET,headers=auth_headers,json=payload(new)).status_code==409
    assert client.post(f'{BASE}/{new}/cancel',headers=auth_headers).status_code==200
    assert client.post(RESET,headers=auth_headers,json=payload(new)).status_code==200


@pytest.mark.parametrize('role,level', [('rh','H5'),('admin','H3')])
def test_permission_is_admin_H5_not_ordinary_DRH(client,auth_headers,db,batch96,role,level):
    sid,_=blocked_session(client,auth_headers,db,batch96)
    name='reset-'+uuid.uuid4().hex[:10]
    user=User(username=name,full_name='Reset test',password_hash=hash_password('testpass123'),role=role,access_level=level,
        authorized_modules=['drh'],authorized_actions=['read','create','admin'],authorized_societies=[oneoff.SOCIETY],is_active=True)
    db.add(user);db.commit()
    token=client.post('/api/auth/login',json={'username':name,'password':'testpass123'}).json()['access_token']
    headers={'Authorization':'Bearer '+token}
    assert not client.get(BASE+'/config',headers=headers).json()['oneoff_reset_allowed']
    assert client.post(RESET,headers=headers,json=payload(sid)).status_code==403
    assert client.get(RESET+'-context',headers=headers,params={k:v for k,v in payload(sid).items() if k!='old_session_id'}).status_code==403


def test_reset_rollback_keeps_old_binding_if_audit_fails(client,auth_headers,db,batch96,monkeypatch):
    from app.modules.drh import contract_import_oneoff_reset as resetting
    sid,_=blocked_session(client,auth_headers,db,batch96)
    def fail(*args,**kwargs):raise RuntimeError('audit unavailable')
    monkeypatch.setattr(resetting,'append_audit',fail)
    with pytest.raises(RuntimeError,match='audit unavailable'):
        client.post(RESET,headers=auth_headers,json=payload(sid))
    db.rollback();db.expire_all()
    assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid


def test_converted_candidate_refuses_reset_even_if_the_employee_was_removed(client,auth_headers,db,batch96):
    sid,_=blocked_session(client,auth_headers,db,batch96)
    batch96[0][0].status='embauche';db.commit()
    response=client.post(RESET,headers=auth_headers,json=payload(sid))
    assert response.status_code==409 and 'converti' in response.json()['detail']
    assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid


@pytest.fixture
def rh01_headers(client,db):
    user=User(username='RH01',full_name='RH01',password_hash=hash_password('testpass123'),
        role='cadre',access_level='H5',authorized_modules=['drh'],
        authorized_actions=['read','create'],authorized_societies=[oneoff.SOCIETY],is_active=True)
    db.add(user);db.commit()
    token=client.post('/api/auth/login',json={'username':'RH01','password':'testpass123'}).json()['access_token']
    yield {'Authorization':'Bearer '+token},user
    db.rollback()
    user.username='used-RH01-'+uuid.uuid4().hex[:10]
    db.commit()


def test_rh01_reset_is_narrow_audited_and_single_use(client,auth_headers,db,batch96,rh01_headers):
    headers,user=rh01_headers
    sid,content=blocked_session(client,auth_headers,db,batch96)
    before=counts(db)
    identity=(user.role,user.access_level,list(user.authorized_actions),list(user.authorized_modules))
    assert client.get(BASE+'/config',headers=headers).json()['oneoff_reset_allowed'] is True
    context=client.get(RESET+'-context',headers=headers,params={k:v for k,v in payload(sid).items() if k!='old_session_id'})
    assert context.status_code==200 and context.json()['can_reset']
    assert client.post(RESET,headers=headers,json=payload(sid)).status_code==200
    event=db.scalars(select(AuditEvent).where(AuditEvent.action=='drh.contract.excel.oneoff.reset')).all()[-1]
    details=json.loads(event.new_state)
    assert details['requested_by_user_id']==user.id and details['requested_by_username']=='RH01'
    assert details['requested_by_role']=='cadre' and details['requested_by_access_level']=='H5'
    assert details['reset_access_path']=='rh01_exception'
    assert details['reason']=='Réinitialisation exceptionnelle autorisée pour RH01'
    assert details['old_session_id']==sid and details['batch_key']==oneoff.BATCH_KEY
    assert details['file_sha256']==oneoff.FILE_SHA256 and details['society']==oneoff.SOCIETY
    assert details['requested_at']
    new=client.post(BASE,headers=headers,params={'society':oneoff.SOCIETY},files={'file':('same.xlsx',content)})
    assert new.status_code==200,new.text
    assert client.post(BASE,headers=headers,params={'society':oneoff.SOCIETY},files={'file':('same.xlsx',content)}).status_code==409
    assert counts(db)==before
    db.refresh(user)
    assert (user.role,user.access_level,user.authorized_actions,user.authorized_modules)==identity
    # L'exception locale ne donne aucun accès à l'administration des utilisateurs.
    assert client.get('/api/auth/users',headers=headers).status_code==403


@pytest.mark.parametrize('change', ['other_user','non_h5','other_society'])
def test_rh01_account_constraints_are_fail_closed(client,auth_headers,db,batch96,rh01_headers,change):
    headers,user=rh01_headers
    sid,_=blocked_session(client,auth_headers,db,batch96)
    if change=='other_user':user.username='OTHER-CADRE-H5'
    elif change=='non_h5':user.access_level='H4'
    else:user.authorized_societies=['SWORD CONSTRUCTION']
    db.commit()
    # Reconnexion après changement de username pour tester l'identité serveur actuelle.
    token=client.post('/api/auth/login',json={'username':user.username,'password':'testpass123'}).json()['access_token']
    headers={'Authorization':'Bearer '+token}
    assert client.get(BASE+'/config',headers=headers).json()['oneoff_reset_allowed'] is False
    assert client.post(RESET,headers=headers,json=payload(sid)).status_code==403


@pytest.mark.parametrize('changes', [
    {'society':'SWORD CONSTRUCTION'}, {'file_sha256':'f'*64}, {'batch_key':'other-batch'}])
def test_rh01_cannot_reset_other_scope(client,auth_headers,db,batch96,rh01_headers,changes):
    headers,_=rh01_headers
    sid,_=blocked_session(client,auth_headers,db,batch96)
    assert client.post(RESET,headers=headers,json=payload(sid,**changes)).status_code in {403,409}
    assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid


@pytest.mark.parametrize('key', ['created_contracts','created_employees','created_documents'])
def test_rh01_cannot_reset_after_business_creation(client,auth_headers,db,batch96,rh01_headers,key):
    headers,_=rh01_headers
    sid,_=blocked_session(client,auth_headers,db,batch96)
    old=db.scalar(select(CandidateImportSession).where(CandidateImportSession.public_id==sid))
    old.result={key:1};db.commit()
    assert client.post(RESET,headers=headers,json=payload(sid)).status_code==409
    assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid


@pytest.mark.parametrize('block', [None,'recent','source','session','contract','document','generated','equal_timestamp'])
def test_explicit_exclusions_only_ignore_old_unlinked_homonyms(client,auth_headers,db,batch96,monkeypatch,block):
    sid,content=blocked_session(client,auth_headers,db,batch96)
    grant=db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY)
    employees=[];other=[]
    try:
        for c in batch96[0][:4]:
            e=Employee(code='EXCLUDE-'+uuid.uuid4().hex[:10],first_name=c.first_name,last_name=c.last_name,
                society=oneoff.SOCIETY,extra={},created_at=grant.authorized_at-timedelta(days=30))
            db.add(e);employees.append(e)
        db.commit()
        exclusions={c.id:e.id for c,e in zip(batch96[0],employees)}
        monkeypatch.setattr(oneoff,'MANUAL_REVIEW_EXCLUSIONS',exclusions)
        e=employees[0]
        if block=='recent':e.created_at=grant.authorized_at+timedelta(seconds=1)
        elif block=='equal_timestamp':e.created_at=grant.authorized_at
        elif block=='source':e.extra={'sourceCandidateId':batch96[0][0].id}
        elif block=='session':e.extra={'contractImportSession':sid}
        elif block=='contract':other.append(Contract(employee_id=e.id,contract_type='CDD',start_date=date(2026,1,1)))
        elif block=='document':other.append(Document(owner_type='employee',owner_id=e.id,label='Contrat',file_name='contrat.pdf'))
        elif block=='generated':other.append(GeneratedContract(employee_id=e.id,reference=uuid.uuid4().hex,title='Test',contract_type='CDD',file_name='test.docx',mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',file_content=b'test',values={}))
        db.add_all(other);db.commit()
        before=counts(db)
        response=client.post(RESET,headers=auth_headers,json=payload(sid))
        assert response.status_code==(409 if block else 200),response.text
        if block:
            assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid
        else:
            uploaded=client.post(BASE,headers=auth_headers,params={'society':oneoff.SOCIETY},files={'file':('same.xlsx',content)})
            assert uploaded.status_code==200,uploaded.text
            new_sid=uploaded.json()['session_id']
            result=preview(client,auth_headers,new_sid,{})
            assert (result['recognized'],result['to_review'],result['not_found'],result['preparable'])==(71,5,20,71)
            bound=db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY);db.refresh(bound)
            assert len(bound.candidate_ids)==71 and set(bound.candidate_ids).isdisjoint(exclusions)
            assert all(r['status']==oneoff.REVIEW and r['candidate_id'] is None for r in result['rows'][:4])
            saved=client.post(f'{BASE}/{new_sid}/prepare',headers=auth_headers)
            assert saved.status_code==200,saved.text
            assert {r['candidate_id'] for r in saved.json()['rows'] if r['status']==oneoff.STATUS}.isdisjoint(exclusions)
            assert client.post(f'{BASE}/{new_sid}/confirm',headers=auth_headers).status_code==409
            assert client.post(BASE,headers=auth_headers,params={'society':oneoff.SOCIETY},files={'file':('same.xlsx',content)}).status_code==409
            events=db.scalars(select(AuditEvent).where(AuditEvent.action=='drh.contract.excel.oneoff.reset')).all()
            details=json.loads(events[-1].new_state)
            assert details['manual_review_candidate_ids']==sorted(exclusions)
        assert counts(db)==before
    finally:
        db.rollback()
        for obj in list(reversed(other))+list(reversed(employees)):
            db.delete(obj);db.flush()
        db.commit()
