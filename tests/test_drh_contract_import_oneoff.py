"""Dérogation des 76 IDs fixes : snapshot uniquement, isolation et absence de créations."""
import json
from datetime import date

import pytest
from sqlalchemy import func, select

from app.modules.auth.models import AuditEvent
from app.modules.drh import contract_import, contract_import_oneoff as oneoff
from app.modules.drh.models import Candidate, Contract, Document, Employee, GeneratedContract
from app.modules.drh.candidate_import_models import CandidateImportSession
from tests.test_drh_contract_excel_import import BASE, preview, setup_import, upload


@pytest.fixture
def oneoff_batch(db):
    assert not db.scalars(select(Candidate).where(Candidate.id.in_(oneoff.CANDIDATE_IDS))).all()
    candidates=[Candidate(id=key,first_name='Test',last_name=f'LOT{key}',society=oneoff.SOCIETY,status='a_contractualiser',data={'avisDecision':'Favorable'}) for key in sorted(oneoff.CANDIDATE_IDS)]
    db.add_all(candidates);db.commit()
    yield candidates
    db.rollback()
    grant=db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY)
    if grant:db.delete(grant)
    for candidate in candidates:
        db.delete(candidate)
    db.commit()


def counts(db):
    return {model.__name__:db.scalar(select(func.count()).select_from(model)) for model in (Employee,Contract,GeneratedContract,Document)}


def exceptional_session(client,headers,candidates,start=''):
    return upload(client,headers,oneoff.SOCIETY,[[c.id,start] for c in candidates])


def test_exact_76_blank_rows_prepare_without_fake_data_or_creations(client,auth_headers,db,oneoff_batch):
    initial=counts(db)
    candidate_data={c.id:dict(c.data) for c in oneoff_batch}
    sid=exceptional_session(client,auth_headers,oneoff_batch)
    body=preview(client,auth_headers,sid,{})
    assert body['preparation_only'] and body['total']==76
    assert body['complete']==0 and body['prepared_missing']==76 and body['blocked']==0
    assert body['message']==oneoff.MESSAGE
    assert body['counts']=={oneoff.STATUS:76}
    assert all(all(v is None for v in r['values'].values()) for r in body['rows'])
    assert all(r['missing_fields']==list(oneoff.VALUE_FIELDS) for r in body['rows'])
    response=client.post(f'{BASE}/{sid}/prepare',headers=auth_headers)
    assert response.status_code==200,response.text
    result=response.json()
    assert result['created_contracts']==result['created_employees']==result['created_documents']==0
    assert all(all(v is None for v in r['values'].values()) for r in result['rows'])
    assert counts(db)==initial
    db.expire_all()
    assert {c.id:c.data for c in db.scalars(select(Candidate).where(Candidate.id.in_(oneoff.CANDIDATE_IDS))).all()}==candidate_data
    assert all(c.status=='a_contractualiser' for c in db.scalars(select(Candidate).where(Candidate.id.in_(oneoff.CANDIDATE_IDS))).all())
    session=db.scalar(select(CandidateImportSession).where(CandidateImportSession.public_id==sid))
    assert session.status=='prepared' and session.workbook is None
    assert client.post(f'{BASE}/{sid}/prepare',headers=auth_headers).json()==result
    assert client.post(f'{BASE}/{sid}/confirm',headers=auth_headers).status_code==409
    assert client.get(f'{BASE}/{sid}/result',headers=auth_headers).json()['status']=='prepared'
    csv=client.get(f'{BASE}/{sid}/report',headers=auth_headers)
    assert csv.status_code==200 and 'Non renseigné' in csv.text and oneoff.STATUS in csv.text


def test_audit_has_authorizer_session_every_candidate_and_missing_fields(client,auth_headers,db,oneoff_batch):
    sid=exceptional_session(client,auth_headers,oneoff_batch)
    preview(client,auth_headers,sid,{})
    grant=db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY)
    assert grant.session_id==sid and grant.authorized_by_user_id and grant.authorized_at
    assert grant.authorized_by_username=='testadmin'
    assert set(grant.candidate_ids)==oneoff.CANDIDATE_IDS and grant.reason==oneoff.REASON
    events=db.scalars(select(AuditEvent).where(AuditEvent.action=='drh.contract.excel.oneoff.prepared')).all()
    details=[json.loads(e.new_state) for e in events if json.loads(e.new_state)['session_id']==sid]
    assert len(details)==76 and {d['candidate_id'] for d in details}==oneoff.CANDIDATE_IDS
    assert all(d['reason']==oneoff.REASON and d['authorized_at'] and d['missing_fields']==list(oneoff.VALUE_FIELDS) for d in details)


def test_new_session_even_same_candidates_keeps_normal_required_fields(client,auth_headers,db,oneoff_batch):
    sid=exceptional_session(client,auth_headers,oneoff_batch)
    assert preview(client,auth_headers,sid,{})['preparation_only']
    second=exceptional_session(client,auth_headers,oneoff_batch)
    normal=preview(client,auth_headers,second,{})
    assert not normal.get('preparation_only')
    assert normal['counts']=={'À CORRIGER':76}
    assert client.post(f'{BASE}/{second}/prepare',headers=auth_headers).status_code==409
    assert client.post(f'{BASE}/{second}/confirm',headers=auth_headers).status_code==409
    assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid


def test_unrelated_candidates_keep_exact_normal_rules(client,auth_headers,db,setup_import):
    society,candidates,common=setup_import
    sid=upload(client,auth_headers,society,[[candidates[0].id,'2026-10-15']])
    normal=preview(client,auth_headers,sid,{**common,'position':''})
    assert normal['counts']=={'DONNÉE MANQUANTE':1}
    assert not normal.get('preparation_only')
    assert not db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY)
    assert client.post(f'{BASE}/{sid}/prepare',headers=auth_headers).status_code==409


@pytest.mark.parametrize('key,value', [('client_site','DC INEXISTANT'),('template_id','99999999'),('salary','-1'),('contract_type','INCONNU'),('duration','invalide')])
def test_nonblank_invalid_values_still_block_preparation(client,auth_headers,db,oneoff_batch,key,value):
    sid=exceptional_session(client,auth_headers,oneoff_batch)
    result=preview(client,auth_headers,sid,{key:value})
    assert result['blocked']==76
    assert result['counts']=={'À CORRIGER':76}
    initial=counts(db)
    assert client.post(f'{BASE}/{sid}/prepare',headers=auth_headers).status_code==422
    assert counts(db)==initial


def test_subset_never_activates_waiver(client,auth_headers,db,oneoff_batch):
    sid=exceptional_session(client,auth_headers,oneoff_batch[:1])
    result=preview(client,auth_headers,sid,{})
    assert not result.get('preparation_only') and result['counts']=={'À CORRIGER':1}
    assert not db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY)


def test_missing_optional_values_are_not_defaulted_when_required_values_are_present(client,auth_headers,db,oneoff_batch,setup_import):
    society,candidates,common=setup_import
    from app.modules.commercial.models import Client
    dc=Client(name='CLIENT LOT',society=oneoff.SOCIETY,status='actif')
    db.add(dc);db.commit()
    sid=exceptional_session(client,auth_headers,oneoff_batch,'2026-10-15')
    result=preview(client,auth_headers,sid,{**common,'client_site':f'{dc.id}:'})
    assert result['complete']==76 and result['prepared_missing']==0
    assert all(r['values']['end_date'] is None and r['values']['trial'] is None and r['values']['bank'] is None and r['values']['iban'] is None for r in result['rows'])
    assert all('trial_end_date' not in r['values'] for r in result['rows'])
    assert client.post(f'{BASE}/{sid}/confirm',headers=auth_headers).status_code==409


def test_blank_salary_stays_null_with_other_required_values_present(client,auth_headers,db,oneoff_batch,setup_import):
    society,candidates,common=setup_import
    from app.modules.commercial.models import Client
    dc=Client(name='CLIENT LOT',society=oneoff.SOCIETY,status='actif');db.add(dc);db.commit()
    sid=exceptional_session(client,auth_headers,oneoff_batch,'2026-10-15')
    result=preview(client,auth_headers,sid,{**common,'salary':'','client_site':f'{dc.id}:'})
    assert all(r['values']['salary'] is None for r in result['rows'])


def test_common_dates_do_not_fill_empty_individual_cells(client,auth_headers,db,oneoff_batch):
    sid=exceptional_session(client,auth_headers,oneoff_batch)
    result=preview(client,auth_headers,sid,{'start_date':'2026-10-15','end_date':'2027-10-15'})
    assert result['prepared_missing']==76
    assert all(r['values']['start_date'] is None and r['values']['end_date'] is None for r in result['rows'])


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
