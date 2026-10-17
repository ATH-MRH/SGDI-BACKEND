def test_oneoff_migration_roundtrip_affects_only_its_table():
    import importlib.util
    from pathlib import Path
    from sqlalchemy import create_engine, inspect, text
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path=Path(__file__).resolve().parents[1]/'migrations/versions/20261014_0005_contract_import_oneoff.py'
    spec=importlib.util.spec_from_file_location('oneoff_migration',path)
    migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
    engine=create_engine('sqlite:///:memory:')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE untouched (id INTEGER PRIMARY KEY)'))
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            migration.upgrade()  # rejouable si le bootstrap a déjà créé les modèles
            assert set(inspect(conn).get_table_names())=={'untouched','drh_contract_import_oneoff_grants'}
            assert any(c['column_names']==['session_id'] for c in inspect(conn).get_unique_constraints('drh_contract_import_oneoff_grants'))
            migration.downgrade()
            assert inspect(conn).get_table_names()==['untouched']
    engine.dispose()



import hashlib
from datetime import datetime
import pytest
from sqlalchemy import func, select
from app.modules.drh import contract_import as importer, contract_import_history as history
from app.modules.drh.models import Candidate, Employee, Contract, GeneratedContract, Document
from app.modules.drh.candidate_import_models import CandidateImportSession
from tests.test_drh_contract_excel_import import BASE, setup_import, upload, preview


def business_counts(db):
    return {m.__name__:db.scalar(select(func.count()).select_from(m))
            for m in (Candidate,Employee,Contract,GeneratedContract,Document)}


@pytest.fixture
def archived(db,client,auth_headers,setup_import):
    society,candidates,common=setup_import
    from io import BytesIO
    from openpyxl import Workbook
    book=Workbook();book.active.append(['Référence candidat','Date début'])
    book.active.append([candidates[0].id,'2026-10-17'])
    stream=BytesIO();book.save(stream);content=stream.getvalue()
    response=client.post(BASE,params={'society':society},headers=auth_headers,files={'file':('history.xlsx',content)})
    assert response.status_code==200
    sid=response.json()['session_id']
    assert preview(client,auth_headers,sid,common)['counts']=={'PRÊT':1}
    session=db.scalar(select(CandidateImportSession).where(CandidateImportSession.public_id==sid))
    result={'total':1,'preparation_only':True,'created_contracts':0,'created_employees':0,'created_documents':0,
            'rows':[{'row':2,'candidate_id':candidates[0].id,'candidate':'ARCHIVE TEST','status':'Préparé exceptionnellement',
                     'match_status':'MATCH CERTAIN','reason':'','missing_fields':['salary'],
                     'values':{k:None for k in history.VALUE_FIELDS}}]}
    grant=history.ContractImportOneoffGrant(batch_key='historical-test',session_id=sid,file_sha256=session.file_sha256,
        authorized_by_user_id=session.user_id,authorized_by_username=session.username,authorized_at=datetime.utcnow(),
        candidate_ids=[candidates[0].id],reason='Préparation historique',preparation=result)
    db.add(grant);db.commit()
    session._test_content=content
    session._test_society=society
    yield session,grant,result
    db.rollback()
    db.delete(grant);db.commit()


@pytest.mark.parametrize('state',['previewed','prepared','lost_flag','another_session_same_file'])
def test_archived_preparation_never_creates_even_after_feature_removal(client,auth_headers,db,archived,monkeypatch,state):
    session,grant,result=archived
    if state=='prepared':
        session.status='prepared';session.result=result;session.workbook=None;session.plan=None
    elif state=='lost_flag':
        grant.session_id='contract-historical-other';session.result={};grant.file_sha256='a'*64
        session.plan={**session.plan,'preview':{**session.plan['preview'],'preparation_only':True}}
    elif state=='another_session_same_file':
        grant.session_id='contract-historical-other'
    db.commit()
    before=business_counts(db)
    def forbidden(*args,**kwargs):pytest.fail('Aucun service de création ne doit être appelé')
    monkeypatch.setattr(importer.service,'recruit_candidate',forbidden)
    monkeypatch.setattr(importer.service,'generate_contract',forbidden)
    response=client.post(f'{BASE}/{session.public_id}/confirm',headers=auth_headers)
    assert response.status_code==409,response.text
    assert business_counts(db)==before


def test_archived_snapshot_report_and_audit_are_retained(client,auth_headers,db,archived):
    from app.core.audit import append_audit
    from app.modules.auth.models import AuditEvent
    session,grant,result=archived
    session.status='prepared';session.result=result;session.plan=None;session.workbook=None
    append_audit(db,action='drh.contract.excel.oneoff.saved',resource='contract_import_oneoff',resource_id=grant.batch_key,
                 user=None,society='HISTORICAL',result='success',new_state={'session_id':session.public_id})
    db.commit()
    before=business_counts(db);snapshot=dict(grant.preparation)
    report=client.get(f'{BASE}/{session.public_id}/report',headers=auth_headers)
    assert report.status_code==200 and 'ARCHIVE TEST' in report.text and 'Non renseigné' in report.text
    assert client.get(f'{BASE}/{session.public_id}/result',headers=auth_headers).json()['preparation_only']
    assert db.scalar(select(AuditEvent.id).where(AuditEvent.resource_id==grant.batch_key))
    db.refresh(grant)
    assert grant.preparation==snapshot and business_counts(db)==before


def test_archived_exact_file_cannot_be_uploaded_again(db,client,auth_headers,archived):
    from fastapi import HTTPException
    session,grant,_=archived
    with pytest.raises(HTTPException) as exc:history.reject_archived_file(db,session.file_sha256)
    assert exc.value.status_code==409
    # La protection est issue des archives, sans empreinte spéciale codée en dur.
    history.reject_archived_file(db,hashlib.sha256(b'another file').hexdigest())
    before=business_counts(db)
    response=client.post(BASE,params={'society':session._test_society},headers=auth_headers,
        files={'file':('history.xlsx',session._test_content)})
    assert response.status_code==409 and 'archivé' in response.text
    assert business_counts(db)==before


def test_temporary_endpoints_and_capability_have_been_removed(client,auth_headers):
    config=client.get(BASE+'/config',headers=auth_headers)
    assert config.status_code==200 and set(config.json())=={'fields','limits'}
    assert client.get(BASE+'/oneoff/reset-context',headers=auth_headers).status_code==404
    assert client.post(BASE+'/oneoff/reset',json={},headers=auth_headers).status_code==404
    assert client.post(BASE+'/contract-test/prepare',headers=auth_headers).status_code==404


def test_normal_missing_fields_and_dc_alias_still_block(client,auth_headers,db,setup_import):
    society,candidates,common=setup_import
    before=business_counts(db)
    sid=upload(client,auth_headers,society,[[candidates[0].id,'2026-10-17']])
    result=preview(client,auth_headers,sid,{**common,'position':''})
    assert result['counts']=={'DONNÉE MANQUANTE':1} and not result.get('preparation_only')
    result=preview(client,auth_headers,sid,{**common,'client_site':'DHL ORAN  SOLUTION'})
    assert result['rows'][0]['status']=='À CORRIGER'
    assert 'Client / site DC' in result['rows'][0]['reason']
    assert business_counts(db)==before
