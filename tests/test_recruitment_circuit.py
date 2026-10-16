from tests.test_recruitment_jobs_api import clean, securite, solution, session, apply, publish, _process
API='/api/public/emploi'
STAFF='/api/drh/job-offers'

def test_audit_profile_second_application(client,securite):
    a=publish(client,securite)
    b=publish(client,securite,title='Autre poste')
    h,_=session(client)
    assert apply(client,h,a['id'],profile={'wilaya':'Alger','address':'Ancienne adresse'}).status_code==201
    assert client.put(API+'/me/profile',headers=h,json={'wilaya':'Oran','address':'Nouvelle adresse','privacy_consent':True,'privacy_version':'2026-10-11'}).status_code==200
    sent=apply(client,h,b['id'],profile={'wilaya':'Oran','address':'Nouvelle adresse'})
    assert sent.status_code==201
    mobile=client.get(API+'/me',headers=h).json()
    staff=client.get(f"{STAFF}/applications/{sent.json()['application_id']}",headers=securite).json()
    assert mobile['profile']['address']=='Nouvelle adresse'
    first=client.get(f"{STAFF}/applications/{client.get(API+'/applications',headers=h).json()['items'][-1]['id']}",headers=securite).json()
    assert first['profile']['data']['adresse']=='Ancienne adresse'
    assert staff['profile']['data']['adresse']=='Nouvelle adresse'

def test_audit_spontaneous_status_divergence(client,securite):
    h,_=session(client)
    sent=apply(client,h)
    i=sent.json()['application_id']
    result=_process(client,securite,i,outcome='unfavorable',communicate=True)
    assert result.status_code==200
    assert result.json()['visible_state']['code']=='declined'
    candidate=client.get(f'{API}/applications/{i}',headers=h).json()
    assert candidate['state']['status']=='declined'

def test_audit_cross_society_history_metadata(client,securite,solution):
    a=publish(client,securite)
    b=publish(client,solution,society='Iron Global Solution',title='Poste autre societe')
    h,_=session(client)
    i=apply(client,h,a['id']).json()['application_id']
    apply(client,h,b['id'])
    detail=client.get(f'{STAFF}/applications/{i}',headers=securite).json()
    assert detail['other_applications']==[]
    assert 'candidaturesEmploi' not in detail['profile']['data']
    page=client.get('/api/drh/candidates/page?mode=pool',headers=securite).json()
    for candidate in page['items']:
        assert 'candidaturesEmploi' not in (candidate.get('data') or {})
        assert all(event.get('action')!='candidature_emploi' for event in (candidate.get('data') or {}).get('auditTrail',[]) if isinstance(event,dict))



def test_legacy_dossier_history_is_filtered(client,db,securite,solution):
    from app.modules.recruitment_jobs_models import RecruitmentApplication
    h,_=session(client)
    a=publish(client,securite)
    i=apply(client,h,a['id']).json()['application_id']
    row=db.get(RecruitmentApplication,i)
    row.profile_snapshot=None
    db.commit()
    detail=client.get(f'{STAFF}/applications/{i}',headers=securite).json()
    assert 'candidaturesEmploi' not in detail['profile']['data']


def test_application_preserves_inline_profile_and_consent(client,securite):
    h,_=session(client)
    a=publish(client,securite)
    assert apply(client,h,a['id'],profile={'address':'Adresse transmise','wilaya':'Alger'}).status_code==201
    me=client.get(API+'/me',headers=h).json()
    assert me['profile']['address']=='Adresse transmise'
    assert me['privacy']['current'] is True


def test_selected_snapshot_reaches_drh_once(client,db,securite,auth_headers):
    from app.modules.recruitment_jobs_models import RecruitmentApplication
    from app.modules.drh.models import Candidate
    from app.modules.recruitment_jobs_service import today
    h,_=session(client)
    a=publish(client,securite)
    b=publish(client,securite,title='Autre poste')
    first=apply(client,h,a['id'],profile={'address':'Ancienne adresse','wilaya':'Alger'})
    chosen=apply(client,h,b['id'],profile={'address':'Adresse retenue','wilaya':'Oran'})
    i=chosen.json()['application_id']
    assert _process(client,securite,i,outcome='favorable',communicate=True).status_code==200
    assert client.put(f'{STAFF}/applications/{i}/contract',headers=securite,json={'position':'Autre poste','contract_type':'CDI'}).status_code==200
    assert client.post(f'{STAFF}/applications/{i}/contract/state',headers=securite,json={'state':'signed','signed_on':today().isoformat()}).status_code==200
    result=client.post(f'{STAFF}/applications/{i}/transfer-drh',headers=auth_headers)
    assert result.status_code==200,result.text
    candidate=db.get(Candidate,db.get(RecruitmentApplication,i).candidate_id)
    db.refresh(candidate)
    assert candidate.data['adresse']=='Adresse retenue' and candidate.data['avisDecision']=='Favorable'
    assert candidate.desired_position.casefold()=='autre poste'
    assert client.post(f'{STAFF}/applications/{i}/transfer-drh',headers=auth_headers).json()['transfer']['already_transferred'] is True
    assert db.get(RecruitmentApplication,first.json()['application_id']).profile_snapshot['data']['adresse']=='Ancienne adresse'
