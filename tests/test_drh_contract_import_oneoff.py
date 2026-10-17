"""Fichier exact de 96 lignes, D + E, dossiers actuels et préparation sans création."""
import hashlib
import json
from datetime import date
from io import BytesIO
from types import SimpleNamespace

import pytest
from openpyxl import Workbook
from sqlalchemy import func, select

from app.modules.auth.models import AuditEvent
from app.modules.drh import contract_import_oneoff as oneoff
from app.modules.drh.models import Candidate, Contract, Document, Employee, GeneratedContract
from app.modules.drh.candidate_import_models import CandidateImportSession
from tests.test_drh_contract_excel_import import BASE, preview, setup_import, upload

HEADERS = ['Référence candidat','Code candidat','Téléphone','Nom + prénom',None,
           'Date début','Date fin manuelle','Poste / fonction','Client / site','Type contrat',
           'Durée','Période d’essai','Modèle de contrat','Salaire','Mode paiement','Banque','RIB / IBAN']


def workbook_bytes(rows):
    book=Workbook(); sheet=book.active; sheet.title='Contractualisation'; sheet.append(HEADERS)
    for row in rows:sheet.append(row)
    content=BytesIO();book.save(content)
    return content.getvalue()


def counts(db):
    return {model.__name__:db.scalar(select(func.count()).select_from(model))
            for model in (Candidate,Employee,Contract,GeneratedContract,Document)}


@pytest.fixture
def batch96(db,monkeypatch):
    monkeypatch.setattr(oneoff,'MANUAL_REVIEW_EXCLUSIONS',{})
    # IDs courants de test, volontairement sans lien avec 2309–2383.
    candidates=[Candidate(first_name=f'PRENOM{i}',last_name=f'NOM{i}',society=oneoff.SOCIETY,
        status='a_contractualiser',data={'avisDecision':'Favorable'}) for i in range(75)]
    db.add_all(candidates);db.commit()
    rows=[[None,None,None,c.last_name,c.first_name]+[None]*12 for c in candidates]
    rows += [[None,None,None,f'HORS{i}','PERIMETRE']+[None]*12 for i in range(20)]
    rows += [[None,None,None,'IDENTITE INSUFFISANTE',None]+[None]*12]
    def send(rows=rows,society=oneoff.SOCIETY,authorize=True):
        content=workbook_bytes(rows)
        if authorize:monkeypatch.setattr(oneoff,'FILE_SHA256',hashlib.sha256(content).hexdigest())
        response=client_ref[0].post(BASE,params={'society':society},headers=client_ref[1],
            files={'file':('modele-contractualisation (1).xlsx',content)})
        return response,content
    client_ref=[]
    yield candidates,rows,send,client_ref
    db.rollback()
    grant=db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY)
    if grant:db.delete(grant)
    for c in candidates:db.delete(c)
    db.commit()


def authorized(client,headers,batch96,**kwargs):
    candidates,rows,send,client_ref=batch96
    client_ref[:]=[client,headers]
    response,content=send(**kwargs)
    assert response.status_code==200,response.text
    return response.json()['session_id'],content


def test_real_structure_96_split_names_prepares_only_recognized_without_business_writes(client,auth_headers,db,batch96):
    candidates,rows,_,_=batch96
    initial=counts(db);before={c.id:(c.first_name,c.last_name,c.status,dict(c.data)) for c in candidates}
    sid,content=authorized(client,auth_headers,batch96)
    # User mapping/mode/common must not drop source columns or fill blanks for this file.
    result=preview(client,auth_headers,sid,{'salary':'99999','start_date':'2026-10-16'})
    assert result['total']==96 and result['recognized']==75 and result['to_review']==1 and result['not_found']==20
    assert result['preparation_only'] and result['preparable']==75 and result['blocked']==0
    assert result['prepared_missing']==75
    matched=[r for r in result['rows'] if r['match_status']==oneoff.MATCH]
    assert {r['candidate_id'] for r in matched}=={c.id for c in candidates}
    assert len({r['candidate_id'] for r in matched})==75
    assert all(r['candidate']==f'{c.last_name} {c.first_name}' for r,c in zip(matched,candidates))
    assert all(all(v is None for v in r['values'].values()) for r in matched)
    assert client.post(f'{BASE}/{sid}/confirm',headers=auth_headers).status_code==409
    saved=client.post(f'{BASE}/{sid}/prepare',headers=auth_headers)
    assert saved.status_code==200,saved.text
    assert saved.json()['created_contracts']==saved.json()['created_employees']==saved.json()['created_documents']==0
    assert counts(db)==initial
    db.expire_all()
    assert {c.id:(c.first_name,c.last_name,c.status,c.data) for c in candidates}==before
    session=db.scalar(select(CandidateImportSession).where(CandidateImportSession.public_id==sid))
    assert session.status=='prepared' and session.workbook is None
    assert session.file_sha256==hashlib.sha256(content).hexdigest()
    grant=db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY)
    assert set(grant.candidate_ids)=={c.id for c in candidates}
    assert grant.authorized_by_username=='testadmin' and grant.authorized_at
    report=client.get(f'{BASE}/{sid}/report',headers=auth_headers)
    assert report.status_code==200 and 'MATCH CERTAIN' in report.text and 'Non renseigné' in report.text
    assert 'CANDIDAT INTROUVABLE' in report.text and 'À VÉRIFIER' in report.text
    events=db.scalars(select(AuditEvent).where(AuditEvent.action=='drh.contract.excel.oneoff.prepared')).all()
    detail=[json.loads(e.new_state) for e in events if json.loads(e.new_state)['session_id']==sid]
    assert len(detail)==192  # aperçu + revalidation à l'enregistrement, y compris exclusions
    assert {d['candidate_id'] for d in detail if d['match_status']==oneoff.MATCH}=={c.id for c in candidates}


def test_present_contract_fields_and_individual_dates_are_preserved(client,auth_headers,db,batch96,setup_import):
    from app.modules.commercial.models import Client
    _,_,common=setup_import
    dc=Client(name='CLIENT LOT',society=oneoff.SOCIETY,status='actif');db.add(dc);db.commit()
    candidates,rows,_,_=batch96
    for i,row in enumerate(rows[:75]):
        row[5]=date(2026,10,16+i%10);row[7]='CARISTE';row[8]=f'{dc.id}:';row[9]='CDD'
        row[12]=common['template_id'];row[13]=55000;row[14]='VIREMENT';row[15]='BANQUE';row[16]='001234'
    sid,_=authorized(client,auth_headers,batch96)
    body=preview(client,auth_headers,sid,{'salary':'99999','position':'FAUX'})
    matched=[r for r in body['rows'] if r['match_status']==oneoff.MATCH]
    assert body['blocked']==0 and body['recognized']==75
    for i,row in enumerate(matched):
        values=row['values']
        assert values['start_date']==date(2026,10,16+i%10).isoformat()
        assert values['position']=='CARISTE' and values['client_site']==f'{dc.id}:'
        assert values['salary']==55000 and values['contract_type']=='CDD' and values['iban']=='001234'
        assert values['payment']=='VIREMENT' and values['bank']=='BANQUE'
        assert values['end_date'] is None and values['duration'] is None and values['trial'] is None
    assert client.post(f'{BASE}/{sid}/confirm',headers=auth_headers).status_code==409


def candidate(first='KARIM',last='BELARBI BABOUA',**kwargs):
    return SimpleNamespace(id=99901,first_name=first,last_name=last,status='a_contractualiser',
        data={'avisDecision':'Favorable',**kwargs.pop('data',{})},phone=kwargs.pop('phone',None),**kwargs)


def test_name_normalization_and_empty_E_only_when_full_identity_unique():
    c=candidate(first='MOHAMED ACHOUR',last="HÀDJ-AM D'ORAN")
    cells=[None,None,None,"  hadj am  d’oran ",' mohamed  achour ']
    assert oneoff.match_row(cells,[c])['candidate_id']==c.id
    cells[3]="HADJ AM D'ORAN MOHAMED ACHOUR";cells[4]=None
    assert oneoff.match_row(cells,[c])['match_status']==oneoff.MATCH
    cells[3]="HADJ AM D'ORAN"
    assert oneoff.match_row(cells,[c])['match_status']==oneoff.REVIEW
    same=candidate(first=c.first_name,last=c.last_name);same.id=99902
    cells[3]="HADJ AM D'ORAN MOHAMED ACHOUR"
    assert oneoff.match_row(cells,[c,same])['match_status']==oneoff.REVIEW


def test_identity_contact_reference_and_birth_conflicts_never_auto_match():
    c=candidate(phone='0550123456',data={'dateNaissance':'1998-09-04'})
    row=[None,None,'0770123456','BELARBI BABOUA','KARIM']
    assert oneoff.match_row(row,[c])['match_status']==oneoff.REVIEW
    row[2]=None;row[0]='99999'
    assert oneoff.match_row(row,[c])['match_status']==oneoff.REVIEW
    row[0]=str(c.id);row += [None]*12;row.append('1998-09-05')
    columns=[{'index':17,'header':'Date de naissance'}]
    assert oneoff.match_row(row,[c],columns)['match_status']==oneoff.REVIEW
    row[17]='1998-09-04'
    assert oneoff.match_row(row,[c],columns)['candidate_id']==c.id


def test_candidate_must_be_currently_pending_without_existing_employee():
    c=candidate();row=[None,None,None,c.last_name,c.first_name]
    c.status='embauche'
    assert oneoff.match_row(row,[c])['match_status']==oneoff.NOT_FOUND
    c.status='a_contractualiser';c.data={'convertedEmployeeId':12345}
    assert oneoff.match_row(row,[c])['match_status']==oneoff.NOT_FOUND


def test_duplicates_are_excluded_without_silent_deduplication(client,auth_headers,db,batch96):
    _,rows,_,_=batch96;rows[1]=list(rows[0])
    sid,_=authorized(client,auth_headers,batch96)
    body=preview(client,auth_headers,sid,{})
    assert body['recognized']==73 and body['to_review']==3 and body['not_found']==20
    assert body['counts']['DOUBLON']==2


def test_new_session_cannot_rebind_and_another_file_gets_no_exception(client,auth_headers,db,batch96):
    sid,content=authorized(client,auth_headers,batch96)
    repeated=client.post(BASE,params={'society':oneoff.SOCIETY},headers=auth_headers,
        files={'file':('same.xlsx',content)})
    assert repeated.status_code==409
    second=upload(client,auth_headers,oneoff.SOCIETY,[[c.id,''] for c in batch96[0]])
    result=preview(client,auth_headers,second,{})
    assert not result.get('preparation_only')
    assert client.post(f'{BASE}/{second}/prepare',headers=auth_headers).status_code==409
    assert db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY).session_id==sid


def test_wrong_society_does_not_receive_exception(client,auth_headers,db,batch96):
    sid,_=authorized(client,auth_headers,batch96,society='OTHER')
    assert not db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY)
    assert client.post(f'{BASE}/{sid}/prepare',headers=auth_headers).status_code==409


def test_revalidation_excludes_changed_identity_without_substituting_an_id(client,auth_headers,db,batch96):
    candidates,_,_,_=batch96
    sid,_=authorized(client,auth_headers,batch96)
    assert preview(client,auth_headers,sid,{})['recognized']==75
    candidates[0].status='embauche';db.commit()
    result=preview(client,auth_headers,sid,{})
    assert result['recognized']==74 and result['to_review']==2
    assert result['rows'][0]['candidate_id'] is None
    assert 'changé' in result['rows'][0]['reason']


@pytest.mark.parametrize('column,value', [(8,'DC INEXISTANT'),(12,'99999999'),(13,-1),(9,'INCONNU'),(10,'invalide')])
def test_present_invalid_fields_still_block_saving(client,auth_headers,db,batch96,column,value):
    batch96[1][0][column]=value
    sid,_=authorized(client,auth_headers,batch96)
    body=preview(client,auth_headers,sid,{})
    assert body['blocked']==1 and body['recognized']==75
    before=counts(db)
    assert client.post(f'{BASE}/{sid}/prepare',headers=auth_headers).status_code==422
    assert counts(db)==before


def test_hash_society_and_session_are_checked_each_time(client,auth_headers,db,batch96):
    from fastapi import HTTPException
    sid,_=authorized(client,auth_headers,batch96)
    session=db.scalar(select(CandidateImportSession).where(CandidateImportSession.public_id==sid))
    original=session.file_sha256;session.file_sha256='0'*64
    with pytest.raises(HTTPException):oneoff.grant_for(db,session)
    session.file_sha256=original;session.workbook={**session.workbook,'society':'OTHER'}
    with pytest.raises(HTTPException):oneoff.grant_for(db,session)
    db.rollback()


def test_unrelated_normal_import_retains_required_fields(client,auth_headers,db,setup_import):
    society,candidates,common=setup_import
    sid=upload(client,auth_headers,society,[[candidates[0].id,'2026-10-16']])
    body=preview(client,auth_headers,sid,{**common,'position':''})
    assert body['counts']=={'DONNÉE MANQUANTE':1}
    assert not body.get('preparation_only')
    assert client.post(f'{BASE}/{sid}/prepare',headers=auth_headers).status_code==409


def test_saved_rows_cannot_exceed_the_session_authorized_candidates(client,auth_headers,db,batch96):
    sid,_=authorized(client,auth_headers,batch96)
    assert preview(client,auth_headers,sid,{})['recognized']==75
    grant=db.get(oneoff.ContractImportOneoffGrant,oneoff.BATCH_KEY)
    grant.candidate_ids=[];db.commit()
    before=counts(db)
    assert client.post(f'{BASE}/{sid}/prepare',headers=auth_headers).status_code==409
    assert counts(db)==before


def test_old_preparation_grant_stays_non_creating_after_authorized_file_changes(client,auth_headers,db,setup_import):
    from datetime import datetime
    society,candidates,common=setup_import
    sid=upload(client,auth_headers,society,[[candidates[0].id,'2026-10-16']])
    assert preview(client,auth_headers,sid,common)['counts']=={'PRÊT':1}
    grant=oneoff.ContractImportOneoffGrant(batch_key='historical-test-preparation',session_id=sid,
        file_sha256='0'*64,authorized_by_user_id=1,authorized_by_username='testadmin',
        authorized_at=datetime.now(),candidate_ids=[candidates[0].id],reason=oneoff.REASON,preparation={})
    db.add(grant);db.commit()
    try:
        before=counts(db)
        assert client.post(f'{BASE}/{sid}/confirm',headers=auth_headers).status_code==409
        assert counts(db)==before
    finally:
        db.delete(grant);db.commit()


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


@pytest.mark.parametrize('valid_target', [True, False])
def test_confirmed_dhl_mapping_keeps_original_and_validates_dc(client,auth_headers,db,batch96,monkeypatch,valid_target):
    from app.modules.commercial.models import Client
    from app.modules.drh import dc_client_sites
    dc=Client(name='DHL FORWARDING ALGERIE',society=oneoff.SOCIETY,status='actif')
    db.add(dc);db.commit()
    # Le client réel est ID 11 ; ne pas imposer cet ID dans la base partagée des tests.
    original_options=dc_client_sites.list_client_site_options
    original_resolve=dc_client_sites.resolve_contract_selection
    def options(db,society):
        return [{**o,'dc_client_id':11 if o['dc_client_id']==dc.id else o['dc_client_id']} for o in original_options(db,society)] if valid_target else []
    def resolve(db,**kwargs):
        assert kwargs['dc_client_id']==11 and kwargs['dc_site_id'] is None
        return {**original_resolve(db,**{**kwargs,'dc_client_id':dc.id}),'dc_client_id':11}
    monkeypatch.setattr(dc_client_sites,'list_client_site_options',options)
    monkeypatch.setattr(dc_client_sites,'resolve_contract_selection',resolve)
    batch96[1][0][8]='DHL ORAN  SOLUTION'
    before=counts(db)
    sid,_=authorized(client,auth_headers,batch96)
    result=preview(client,auth_headers,sid,{})
    row=result['rows'][0]
    assert row['values']['client_site']=='DHL ORAN  SOLUTION'
    assert result['blocked']==(0 if valid_target else 1)
    if valid_target:
        assert row['resolved_client_site']=={'dc_client_id':11,'dc_site_id':None,'dc_client_site_label':'DHL FORWARDING ALGERIE'}
        assert client.post(f'{BASE}/{sid}/confirm',headers=auth_headers).status_code==409
        events=db.scalars(select(AuditEvent).where(AuditEvent.action=='drh.contract.excel.oneoff.prepared')).all()
        assert any('DHL ORAN  SOLUTION' in e.new_state and 'resolved_client_site' in e.new_state for e in events)
    assert counts(db)==before


def test_confirmed_dhl_alias_is_not_available_to_normal_import(client,auth_headers,db,setup_import):
    society,candidates,common=setup_import
    initial=counts(db)
    sid=upload(client,auth_headers,society,[[candidates[0].id,'2026-10-17']])
    result=preview(client,auth_headers,sid,{**common,'client_site':'DHL ORAN  SOLUTION'})
    assert not result.get('preparation_only')
    assert result['rows'][0]['status']=='À CORRIGER'
    assert 'Client / site DC' in result['rows'][0]['reason']
    assert counts(db)==initial
