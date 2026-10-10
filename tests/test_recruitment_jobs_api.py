"""IRON Emploi : annonces publiques, gestion recruteur, espace candidat et candidatures."""
import base64
import re
import secrets
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.security import hash_password
from app.modules import recruitment_jobs_service as jobs
from app.modules.auth.models import User
from app.modules.drh.models import Candidate
from app.modules.recruitment_jobs_models import (
    RecruitmentApplication, RecruitmentCandidateAccount, RecruitmentCandidateSession, RecruitmentCompany, RecruitmentJobOffer,
)
from app.modules.recruitment_sms_models import RecruitmentSMSChallenge, RecruitmentSMSRate

GATEWAY_KEY = 'test-gateway-key-long-enough-not-for-production'
GATEWAY = {'X-SMS-Gateway-Key': GATEWAY_KEY}
PDF = base64.b64encode(b'%PDF-1.4 cv de test').decode()
PNG = base64.b64encode(b'\x89PNG\r\n\x1a\n image de test').decode()
JPG = base64.b64encode(b'\xff\xd8\xff image de test').decode()
SECURITE, SOLUTION = 'Iron Global Securite', 'Iron Global Solution'


@pytest.fixture(autouse=True)
def clean(db, monkeypatch):
    monkeypatch.setenv('RECRUITMENT_SMS_ENABLED', 'true')
    monkeypatch.setenv('RECRUITMENT_SMS_PROVIDER', 'poll')
    monkeypatch.setenv('RECRUITMENT_SMS_GATEWAY_KEY', GATEWAY_KEY)
    yield
    db.rollback()
    for model in (RecruitmentApplication, RecruitmentCandidateSession, RecruitmentCandidateAccount, RecruitmentJobOffer, RecruitmentCompany,
                  RecruitmentSMSChallenge, RecruitmentSMSRate):
        db.query(model).delete()
    db.query(Candidate).filter(Candidate.last_name.like('Emploi%')).delete(synchronize_session=False)
    db.query(User).filter(User.username.in_(['rec_securite', 'rec_solution', 'ops_sans_recrutement'])).delete(synchronize_session=False)
    db.commit()


def _login(client, db, username, societies, *, modules=('recrute',), role='recruteur'):
    if not db.query(User).filter(User.username == username).first():
        db.add(User(username=username, email=f'{username}@test.com', full_name=username, role=role, access_level='H3',
                    authorized_societies=societies, authorized_structures=[], authorized_modules=list(modules),
                    password_hash=hash_password('testpass123'), validation_password_hash=hash_password('x'), is_active=True))
        db.commit()
    response = client.post('/api/auth/login', json={'username': username, 'password': 'testpass123'})
    assert response.status_code == 200, response.text
    return {'Authorization': 'Bearer ' + response.json()['access_token']}


@pytest.fixture
def securite(client, db):
    return _login(client, db, 'rec_securite', [SECURITE])


@pytest.fixture
def solution(client, db):
    return _login(client, db, 'rec_solution', [SOLUTION])


def offer_body(**updates):
    body = {'society': SECURITE, 'title': 'Agent de sécurité', 'profession': 'Sécurité', 'wilaya': 'Alger', 'location': 'Hydra',
            'contract_type': 'CDI', 'positions': 3, 'missions': 'Surveiller le site.', 'profile': 'Rigueur et ponctualité.'}
    body.update(updates)
    return body


def publish(client, headers, **updates):
    created = client.post('/api/drh/job-offers', headers=headers, json=offer_body(**updates))
    assert created.status_code == 201, created.text
    published = client.post(f"/api/drh/job-offers/{created.json()['id']}/publish", headers=headers)
    assert published.status_code == 200, published.text
    return published.json()


def session(client, phone='0551122334', first_name='Nadia', last_name='Emploi'):
    """Parcours SMS réel (demande, passerelle, code) puis ouverture de l'espace candidat."""
    assert client.post('/api/public/mobile/gateway/poll', headers=GATEWAY).status_code == 200
    issued = client.post('/api/public/mobile/request-code', json={'first_name': first_name, 'last_name': last_name, 'phone': phone})
    assert issued.status_code == 202, issued.text
    job = client.post('/api/public/mobile/gateway/poll', headers=GATEWAY).json()['job']
    code = re.search(r'\b\d{6}\b', job['message'])[0]
    verified = client.post('/api/public/mobile/verify-code', json={'challenge_id': issued.json()['challenge_id'], 'code': code})
    assert verified.status_code == 200, verified.text
    opened = client.post('/api/public/emploi/session', headers={'Authorization': 'Bearer ' + verified.json()['access_token']})
    assert opened.status_code == 201, opened.text
    return {'Authorization': 'Bearer ' + opened.json()['session_token']}, verified.json()['access_token']


def apply(client, headers, offer_id=None, **updates):
    body = {'offer_id': offer_id, 'request_id': secrets.token_hex(12), 'consent': True, 'profile': {'wilaya': 'Alger'}}
    if offer_id is None:
        body['desired_position'] = 'Agent polyvalent'
    body.update(updates)
    return client.post('/api/public/emploi/applications', headers=headers, json=body)


# ── Annonces : brouillon, publication, clôture ───────────────────────────────

def test_draft_is_invisible_publicly_then_published_then_closed(client, securite):
    created = client.post('/api/drh/job-offers', headers=securite, json=offer_body())
    assert created.status_code == 201, created.text
    offer_id = created.json()['id']
    assert created.json()['status'] == 'draft'
    assert client.get('/api/public/emploi/offers').json()['items'] == []
    assert client.get(f'/api/public/emploi/offers/{offer_id}').status_code == 404
    assert client.get('/api/public/emploi/companies').json() == []
    assert client.get(f"/api/public/emploi/companies/{created.json()['company_id']}").status_code == 404

    assert client.post(f'/api/drh/job-offers/{offer_id}/publish', headers=securite).json()['status'] == 'published'
    listed = client.get('/api/public/emploi/offers').json()
    assert [item['id'] for item in listed['items']] == [offer_id]
    detail = client.get(f'/api/public/emploi/offers/{offer_id}').json()
    assert detail['missions'] == 'Surveiller le site.' and detail['company']['name'] == SECURITE
    # Aucune donnée interne dans la vue publique.
    assert not {'status', 'created_by', 'updated_by', 'applications', 'society'} & set(detail)
    assert client.get('/api/public/emploi/companies').json()[0]['open_offers'] == 1

    assert client.post(f'/api/drh/job-offers/{offer_id}/close', headers=securite).json()['status'] == 'closed'
    assert client.get('/api/public/emploi/offers').json()['total'] == 0
    assert client.get(f'/api/public/emploi/offers/{offer_id}').status_code == 404
    # La société reste présentée (elle a déjà publié), sans annonce ouverte.
    assert client.get(f"/api/public/emploi/companies/{created.json()['company_id']}").json()['offers'] == []


def test_incomplete_offer_cannot_be_published(client, securite):
    created = client.post('/api/drh/job-offers', headers=securite, json=offer_body(missions='', wilaya=None))
    refused = client.post(f"/api/drh/job-offers/{created.json()['id']}/publish", headers=securite)
    assert refused.status_code == 422 and 'Missions' in refused.json()['detail'] and 'Wilaya' in refused.json()['detail']
    past = client.post('/api/drh/job-offers', headers=securite, json=offer_body(deadline=(jobs.today() - timedelta(days=1)).isoformat()))
    assert client.post(f"/api/drh/job-offers/{past.json()['id']}/publish", headers=securite).status_code == 422
    assert client.post('/api/drh/job-offers', headers=securite, json=offer_body(contract_type='Inconnu')).status_code == 422


def test_expired_deadline_hides_the_offer_and_refuses_applications(client, db, securite):
    offer = publish(client, securite, deadline=jobs.today().isoformat())
    assert client.get('/api/public/emploi/offers').json()['total'] == 1
    db.get(RecruitmentJobOffer, offer['id']).deadline = jobs.today() - timedelta(days=1)
    db.commit()
    assert client.get('/api/public/emploi/offers').json()['total'] == 0
    assert client.get(f"/api/drh/job-offers/{offer['id']}", headers=securite).json()['effective_status'] == 'expired'
    headers, _ = session(client)
    assert apply(client, headers, offer['id']).status_code == 409


def test_search_and_filters(client, db, securite, solution):
    publish(client, securite)
    publish(client, securite, title='Chef d’équipe sécurité', wilaya='Oran', contract_type='CDD')
    publish(client, solution, society=SOLUTION, title='Cariste', profession='Logistique', wilaya='Oran', contract_type='CDD')
    client.post('/api/drh/job-offers', headers=securite, json=offer_body(title='Brouillon secret', wilaya='Blida'))

    def titles(**params):
        return sorted(item['title'] for item in client.get('/api/public/emploi/offers', params=params).json()['items'])

    assert len(titles()) == 3
    assert titles(q='securite') == ['Agent de sécurité', 'Chef d’équipe sécurité']          # sans accent
    assert titles(q='CARISTE oran') == ['Cariste']
    assert titles(wilaya='Oran') == ['Cariste', 'Chef d’équipe sécurité']
    assert titles(profession='Logistique') == ['Cariste']
    assert titles(contract_type='CDI') == ['Agent de sécurité']
    assert titles(q='secret') == []
    company_id = db.scalar(select(RecruitmentCompany.id).where(RecruitmentCompany.society == SOLUTION))
    assert titles(company_id=company_id) == ['Cariste']
    assert titles(wilaya='Oran', contract_type='CDD', profession='Sécurité') == ['Chef d’équipe sécurité']
    facets = client.get('/api/public/emploi/offers').json()['facets']
    assert facets['wilayas'] == ['Alger', 'Oran'] and 'Blida' not in facets['wilayas']
    assert facets['contract_types'] == ['CDI', 'CDD'] and len(facets['companies']) == 2
    paged = client.get('/api/public/emploi/offers', params={'page_size': 2, 'page': 2}).json()
    assert paged['total'] == 3 and paged['pages'] == 2 and len(paged['items']) == 1


# ── Permissions recruteur et isolation des sociétés ──────────────────────────

def test_recruiters_only_manage_offers_of_their_societies(client, db, securite, solution):
    offer = publish(client, securite)
    assert client.get('/api/drh/job-offers', headers=solution).json()['items'] == []
    for call in (client.get(f"/api/drh/job-offers/{offer['id']}", headers=solution),
                 client.put(f"/api/drh/job-offers/{offer['id']}", headers=solution, json=offer_body(society=SOLUTION)),
                 client.post(f"/api/drh/job-offers/{offer['id']}/close", headers=solution),
                 client.get(f"/api/drh/job-offers/{offer['id']}/applications", headers=solution),
                 client.put(f"/api/drh/job-offers/companies/{offer['company_id']}", headers=solution, json={'name': 'Piratée'})):
        assert call.status_code == 404, call.text
    assert client.post('/api/drh/job-offers', headers=solution, json=offer_body()).status_code == 403
    assert client.put(f"/api/drh/job-offers/{offer['id']}", headers=securite, json=offer_body(society=SOLUTION)).status_code == 403
    assert client.get(f"/api/public/emploi/offers/{offer['id']}").json()['title'] == 'Agent de sécurité'
    assert client.get('/api/drh/job-offers/meta', headers=solution).json()['societies'] == [SOLUTION]
    assert client.get('/api/drh/job-offers/companies', headers=solution).json()['items'] == []


def test_job_offer_management_requires_recruitment_access(client, db, restricted_headers):
    assert client.get('/api/drh/job-offers').status_code == 401
    assert client.post('/api/drh/job-offers', json=offer_body()).status_code == 401
    # Compte OPS de la même société, sans module recrutement.
    assert client.get('/api/drh/job-offers', headers=restricted_headers).status_code == 403
    assert client.post('/api/drh/job-offers', headers=restricted_headers, json=offer_body()).status_code == 403
    recruiter = _login(client, db, 'rec_securite', [SECURITE])
    draft = client.post('/api/drh/job-offers', headers=recruiter, json=offer_body()).json()
    # La suppression est réservée à la DRH ; un recruteur clôture.
    assert client.delete(f"/api/drh/job-offers/{draft['id']}", headers=recruiter).status_code == 403


def test_company_profile_is_edited_by_its_recruiters_and_shown_publicly(client, securite, auth_headers):
    offer = publish(client, securite)
    saved = client.put(f"/api/drh/job-offers/companies/{offer['company_id']}", headers=securite, json={
        'name': 'IRON Global Sécurité', 'sector': 'Sécurité privée', 'city': 'Alger', 'description': 'Présentation.',
        'logo_path': '/static/iron-securite-logo.png'})
    assert saved.status_code == 200, saved.text
    public = client.get(f"/api/public/emploi/companies/{offer['company_id']}").json()
    assert public['name'] == 'IRON Global Sécurité' and public['logo_url'] == '/static/iron-securite-logo.png' and len(public['offers']) == 1
    assert 'society' not in public and 'kind' not in public
    refused = client.put(f"/api/drh/job-offers/companies/{offer['company_id']}", headers=securite, json={'name': 'X2', 'logo_path': '/static/../secret.png'})
    assert refused.status_code == 422
    assert client.delete(f"/api/drh/job-offers/{offer['id']}", headers=auth_headers).status_code == 409      # publiée : clôturer, pas supprimer


# ── Espace candidat ──────────────────────────────────────────────────────────

def test_personal_endpoints_require_a_candidate_session(client, securite, auth_headers):
    for method, path in (('get', '/me'), ('get', '/applications'), ('get', '/applications/1'), ('get', '/me/cv'), ('delete', '/me')):
        assert getattr(client, method)('/api/public/emploi' + path).status_code == 401
        # Un jeton de recruteur n'est pas une session candidat.
        assert getattr(client, method)('/api/public/emploi' + path, headers=securite).status_code == 401
    assert client.post('/api/public/emploi/applications', json={'request_id': 'abcdefgh', 'consent': True}).status_code == 401
    assert client.post('/api/public/emploi/session').status_code == 401
    assert client.post('/api/public/emploi/session', headers=auth_headers).status_code == 401
    headers, sms_token = session(client)
    # Une session candidat n'ouvre aucune API interne ; l'accès court SMS n'est pas une session d'espace.
    assert client.get('/api/auth/me', headers=headers).status_code == 401
    assert client.get('/api/drh/job-offers', headers=headers).status_code == 401
    assert client.get('/api/public/emploi/me', headers={'Authorization': 'Bearer ' + sms_token}).status_code == 401
    assert client.get('/api/public/emploi/me', headers=headers).json()['phone'] == '+213551122334'


def test_application_to_an_offer_is_linked_to_that_offer(client, db, securite, solution):
    wanted = publish(client, securite)
    other = publish(client, securite, title='Chef d’équipe sécurité')
    headers, _ = session(client)
    assert client.put('/api/public/emploi/me/cv', headers=headers, json={'name': 'cv.pdf', 'mime_type': 'application/pdf', 'data_base64': PDF}).status_code == 200
    sent = apply(client, headers, wanted['id'], profile={'wilaya': 'Alger', 'email': 'nadia.emploi@example.com', 'availability': 'Immédiate'})
    assert sent.status_code == 201, sent.text
    assert re.fullmatch(r'CAND-\d{4}-\d{6}', sent.json()['reference']) and sent.json()['already_applied'] is False

    application = db.get(RecruitmentApplication, sent.json()['application_id'])
    assert application.offer_id == wanted['id'] and application.position == 'Agent de sécurité'
    candidate = db.get(Candidate, application.candidate_id)
    assert candidate.desired_position.casefold() == 'agent de sécurité' and candidate.phone == '+213551122334' and candidate.society is None
    assert candidate.data['telephoneVerifie'] is True and candidate.data['cv']['name'] == 'cv.pdf'
    assert candidate.data['candidaturesEmploi'][0]['offreId'] == wanted['id']

    received = client.get(f"/api/drh/job-offers/{wanted['id']}/applications", headers=securite).json()
    assert [item['candidate']['id'] for item in received['items']] == [candidate.id]
    assert received['items'][0]['candidate']['has_cv'] is True and received['offer']['applications'] == 1
    assert client.get(f"/api/drh/job-offers/{other['id']}/applications", headers=securite).json()['items'] == []
    assert {item['id']: item['applications'] for item in client.get('/api/drh/job-offers', headers=securite).json()['items']} == {wanted['id']: 1, other['id']: 0}
    # Le vivier reste commun : le dossier est visible du recrutement, la liste par annonce reste cloisonnée.
    assert client.get(f"/api/drh/job-offers/{wanted['id']}/applications", headers=solution).status_code == 404

    mine = client.get('/api/public/emploi/applications', headers=headers).json()['items']
    assert len(mine) == 1 and mine[0]['kind'] == 'offer' and mine[0]['offer']['id'] == wanted['id'] and mine[0]['offer']['open'] is True
    assert mine[0]['state']['status'] == 'received' and mine[0]['reference'] == sent.json()['reference']


def test_closed_offer_refuses_applications_at_submission_time(client, db, securite):
    offer = publish(client, securite)
    headers, _ = session(client)
    # L'annonce est clôturée après son affichage sur le téléphone.
    assert client.post(f"/api/drh/job-offers/{offer['id']}/close", headers=securite).status_code == 200
    refused = apply(client, headers, offer['id'])
    assert refused.status_code == 409 and 'clôturée' in refused.json()['detail']
    draft = client.post('/api/drh/job-offers', headers=securite, json=offer_body()).json()
    assert apply(client, headers, draft['id']).status_code == 404
    assert apply(client, headers, 987654).status_code == 404
    assert db.query(RecruitmentApplication).count() == 0 and db.query(Candidate).filter(Candidate.last_name.ilike('emploi')).count() == 0
    # Rouverte, elle accepte à nouveau.
    assert client.post(f"/api/drh/job-offers/{offer['id']}/publish", headers=securite).status_code == 200
    assert apply(client, headers, offer['id']).status_code == 201


def test_double_click_and_network_retry_create_a_single_application(client, db, securite):
    offer = publish(client, securite)
    headers, _ = session(client)
    first = apply(client, headers, offer['id'], request_id='same-request-0001')
    retried = apply(client, headers, offer['id'], request_id='same-request-0001')
    assert first.status_code == 201 and retried.status_code == 201
    assert retried.json()['application_id'] == first.json()['application_id'] and retried.json()['reference'] == first.json()['reference']
    # Nouvelle tentative avec un autre identifiant : toujours la même candidature.
    again = apply(client, headers, offer['id'])
    assert again.status_code == 200 and again.json()['already_applied'] is True
    assert again.json()['application_id'] == first.json()['application_id']
    assert db.query(RecruitmentApplication).count() == 1
    assert db.query(Candidate).filter(Candidate.last_name.ilike('emploi')).count() == 1


def test_spontaneous_application_and_one_dossier_per_candidate(client, db, securite):
    headers, _ = session(client)
    assert apply(client, headers, desired_position=None, profile={}).status_code == 422                     # poste souhaité requis
    spontaneous = apply(client, headers)
    assert spontaneous.status_code == 201, spontaneous.text
    row = db.get(RecruitmentApplication, spontaneous.json()['application_id'])
    assert row.offer_id is None and row.position == 'Agent polyvalent'
    assert apply(client, headers).json()['already_applied'] is True
    # Postuler ensuite à une annonce complète le même dossier au lieu d'en créer un second.
    offer = publish(client, securite)
    linked = apply(client, headers, offer['id'])
    assert linked.status_code == 201 and linked.json()['reference'] == spontaneous.json()['reference']
    assert db.query(Candidate).filter(Candidate.last_name.ilike('emploi')).count() == 1
    candidate = db.get(Candidate, row.candidate_id)
    assert [entry['offreId'] for entry in candidate.data['candidaturesEmploi']] == [None, offer['id']]
    mine = client.get('/api/public/emploi/applications', headers=headers).json()['items']
    assert [item['kind'] for item in mine] == ['offer', 'spontaneous']
    assert apply(client, headers, consent=False).status_code == 422


def _process(client, headers, application_id, **fields):
    return client.put(f'/api/drh/job-offers/applications/{application_id}/processing', headers=headers, json=fields)


def test_each_offer_application_has_its_own_state(client, db, securite):
    first, second = publish(client, securite), publish(client, securite, title='Chef d’équipe sécurité')
    headers, _ = session(client)
    spontaneous = apply(client, headers).json()
    one, two = apply(client, headers, first['id']).json(), apply(client, headers, second['id']).json()
    # Un seul dossier et un seul profil, trois candidatures.
    assert one['reference'] == two['reference'] == spontaneous['reference']
    assert db.query(Candidate).filter(Candidate.last_name.ilike('emploi')).count() == 1 and db.query(RecruitmentCandidateAccount).count() == 1

    def states():
        items = client.get('/api/public/emploi/applications', headers=headers).json()['items']
        return {item['id']: item['state']['status'] for item in items}

    assert states() == {one['application_id']: 'received', two['application_id']: 'received', spontaneous['application_id']: 'review'}
    # Décision interne défavorable : tant qu'elle n'est pas communiquée, le candidat ne la voit pas.
    decided = _process(client, securite, one['application_id'], outcome='unfavorable')
    assert decided.status_code == 200, decided.text
    assert decided.json()['stage'] == 'decision' and decided.json()['outcome_communicated'] is False
    assert states()[one['application_id']] == 'received'
    assert _process(client, securite, one['application_id'], communicate=True).json()['visible_state']['code'] == 'declined'
    assert _process(client, securite, two['application_id'], stage='shortlisted').json()['visible_state']['code'] == 'shortlisted'
    # Le refus d'une candidature ne touche ni l'autre annonce, ni la candidature spontanée, ni le dossier.
    assert states() == {one['application_id']: 'declined', two['application_id']: 'shortlisted', spontaneous['application_id']: 'review'}
    candidate = db.get(Candidate, db.get(RecruitmentApplication, one['application_id']).candidate_id)
    assert candidate.status == 'nouvelle' and 'avisDecision' not in candidate.data

    detail = client.get(f"/api/public/emploi/applications/{one['application_id']}", headers=headers).json()
    assert detail['state']['label'] == 'Non retenue' and 'autres candidatures' in detail['state']['message'] and detail['state']['updated_at']
    by_offer = {offer['id']: client.get(f"/api/drh/job-offers/{offer['id']}/applications", headers=securite).json()['items'] for offer in (first, second)}
    assert [(row['state']['code'], row['dossier_state']['code']) for row in by_offer[first['id']]] == [('declined', 'review')]
    assert [(row['state']['code'], row['dossier_state']['code']) for row in by_offer[second['id']]] == [('shortlisted', 'review')]
    # Le traitement continue après la clôture de l'annonce, et reste visible du candidat.
    client.post(f"/api/drh/job-offers/{second['id']}/close", headers=securite)
    assert _process(client, securite, two['application_id'], outcome='favorable', communicate=True).status_code == 200
    closed = client.get(f"/api/public/emploi/applications/{two['application_id']}", headers=headers).json()
    assert closed['state']['status'] == 'accepted' and closed['offer']['open'] is False


def test_application_processing_is_limited_to_recruiters_in_scope(client, db, securite, solution, restricted_headers):
    mine, theirs = publish(client, securite), publish(client, solution, society=SOLUTION, title='Cariste')
    headers, _ = session(client)
    one, two = apply(client, headers, mine['id']).json(), apply(client, headers, theirs['id']).json()
    spontaneous = apply(client, headers).json()
    path = f"/api/drh/job-offers/applications/{one['application_id']}/processing"
    assert client.put(path, json={'stage': 'review'}).status_code == 401
    assert client.put(path, headers=headers, json={'stage': 'review'}).status_code == 401                 # le candidat ne décide pas de son état
    assert client.put(path, headers=restricted_headers, json={'stage': 'review'}).status_code == 403      # compte sans accès recrutement
    assert client.put(path, headers=solution, json={'stage': 'review'}).status_code == 404                # autre société
    assert client.get(f"/api/drh/job-offers/applications/{one['application_id']}", headers=solution).status_code == 404
    assert _process(client, securite, one['application_id'], stage='gagné').status_code == 422
    assert _process(client, securite, one['application_id'], outcome='withdrawn').status_code == 422      # le retrait appartient au candidat
    assert _process(client, securite, two['application_id'], stage='review').status_code == 404
    assert _process(client, securite, 987654, stage='review').status_code == 404
    assert {row.id: row.stage for row in db.query(RecruitmentApplication).all()} == {
        one['application_id']: 'received', two['application_id']: 'received', spontaneous['application_id']: 'received'}
    # Le vivier des candidatures spontanées est commun au recrutement.
    assert _process(client, solution, spontaneous['application_id'], stage='review').json()['stage'] == 'review'
    assert _process(client, solution, two['application_id'], stage='shortlisted').json()['stage_label'] == 'Présélection'
    assert [state['code'] for state in client.get('/api/drh/job-offers/meta', headers=securite).json()['application_states']] == [
        'received', 'review', 'shortlisted', 'interview', 'accepted', 'declined', 'withdrawn']


def test_spontaneous_and_historical_applications_follow_the_dossier(client, db, securite):
    offer = publish(client, securite)
    headers, _ = session(client)
    spontaneous, linked = apply(client, headers).json(), apply(client, headers, offer['id']).json()
    candidate = db.get(Candidate, db.get(RecruitmentApplication, spontaneous['application_id']).candidate_id)
    candidate.data = {**candidate.data, 'derniereConvocation': {'date': '2026-11-02', 'heure': '10:00', 'lieu': 'Siège'}}
    db.commit()
    listing = client.get('/api/public/emploi/applications', headers=headers).json()
    by_id = {item['id']: item for item in listing['items']}
    # La candidature spontanée suit le dossier, comme avant ; la candidature à l'annonce garde son propre état.
    assert by_id[spontaneous['application_id']]['state']['status'] == 'invited'
    assert by_id[spontaneous['application_id']]['state']['convocation']['heure'] == '10:00'
    assert by_id[linked['application_id']]['state']['status'] == 'received' and 'convocation' not in by_id[linked['application_id']]['state']
    # La convocation, qui vaut pour la personne, reste donnée une fois au niveau du dossier.
    assert listing['dossier']['reference'] == spontaneous['reference'] and listing['dossier']['state']['convocation']['lieu'] == 'Siège'
    # Dossier supprimé par le recrutement : il disparaît du suivi, sans erreur.
    db.delete(candidate)
    db.commit()
    assert client.get('/api/public/emploi/applications', headers=headers).json() == {'items': [], 'dossier': None}


def test_candidates_are_isolated_from_each_other(client, db, securite):
    offer = publish(client, securite)
    nadia, _ = session(client)
    client.put('/api/public/emploi/me/profile', headers=nadia, json={'address': '1 rue de Nadia', 'nin': '109876543210987654'})
    client.put('/api/public/emploi/me/cv', headers=nadia, json={'name': 'nadia.pdf', 'mime_type': 'application/pdf', 'data_base64': PDF})
    sent = apply(client, nadia, offer['id'], profile={'address': '1 rue de Nadia'}).json()
    karim, _ = session(client, phone='0661122334', first_name='Karim', last_name='Emploi-Deux')
    me = client.get('/api/public/emploi/me', headers=karim).json()
    assert me['first_name'] == 'Karim' and me['profile'] == {} and me['cv'] is None
    assert client.get('/api/public/emploi/applications', headers=karim).json()['items'] == []
    assert client.get(f"/api/public/emploi/applications/{sent['application_id']}", headers=karim).status_code == 404
    assert client.get('/api/public/emploi/me/cv', headers=karim).status_code == 404
    assert client.put('/api/public/emploi/me/profile', headers=karim, json={'address': 'chez Karim'}).status_code == 200
    assert client.get('/api/public/emploi/me', headers=nadia).json()['profile']['address'] == '1 rue de Nadia'
    # Les API publiques n'exposent aucune donnée candidat.
    public = ' '.join(client.get(path).text for path in ('/api/public/emploi/offers', f"/api/public/emploi/offers/{offer['id']}",
                                                         '/api/public/emploi/companies', f"/api/public/emploi/companies/{offer['company_id']}",
                                                         '/api/public/emploi/config'))
    for secret in ('Nadia', 'Emploi', '551122334', 'rue de Nadia', '109876543210987654', 'nadia.pdf', 'applications'):
        assert secret not in public


def test_reassigned_number_does_not_open_the_previous_owner_space(client, db):
    session(client)
    db.query(RecruitmentSMSChallenge).delete()
    db.query(RecruitmentSMSRate).delete()
    db.commit()
    client.post('/api/public/mobile/gateway/poll', headers=GATEWAY)
    issued = client.post('/api/public/mobile/request-code', json={'first_name': 'Autre', 'last_name': 'Personne', 'phone': '0551122334'})
    job = client.post('/api/public/mobile/gateway/poll', headers=GATEWAY).json()['job']
    token = client.post('/api/public/mobile/verify-code', json={'challenge_id': issued.json()['challenge_id'],
                        'code': re.search(r'\b\d{6}\b', job['message'])[0]}).json()['access_token']
    assert client.post('/api/public/emploi/session', headers={'Authorization': 'Bearer ' + token}).status_code == 409
    # Même personne, nom et prénom inversés, casse et accents différents : acceptée.
    db.query(RecruitmentSMSChallenge).delete()
    db.query(RecruitmentSMSRate).delete()
    db.commit()
    headers, _ = session(client, first_name='EMPLOI', last_name='nadia')
    assert client.get('/api/public/emploi/me', headers=headers).json()['first_name'] == 'Nadia'


def test_profile_and_documents_are_reused_and_cv_formats_are_kept(client, db, securite):
    headers, _ = session(client)
    profile = {'email': 'nadia.reuse@example.com', 'wilaya': 'Alger', 'commune': 'Hydra', 'languages': ['Arabe', 'Français'],
               'experience': [{'society': 'ACME', 'position': 'Agent', 'start_date': '2020-01-01', 'end_date': '2022-01-01'}],
               'birth_date': '1990-05-04', 'children_count': 2}
    assert client.put('/api/public/emploi/me/profile', headers=headers, json=profile).status_code == 200
    assert client.put('/api/public/emploi/me/profile', headers=headers, json={'birth_date': '2015-01-01'}).status_code == 422       # moins de 19 ans
    for name, mime, content in (('cv.pdf', 'application/pdf', PDF), ('cv.jpg', 'image/jpeg', JPG), ('cv.png', 'image/png', PNG)):
        saved = client.put('/api/public/emploi/me/cv', headers=headers, json={'name': name, 'mime_type': mime, 'data_base64': content})
        assert saved.status_code == 200 and saved.json()['cv'] == {'name': name, 'mime_type': mime, 'size': len(base64.b64decode(content))}
        download = client.get('/api/public/emploi/me/cv', headers=headers)
        assert download.content == base64.b64decode(content) and download.headers['content-type'].startswith(mime)
    assert client.put('/api/public/emploi/me/cv', headers=headers, json={'name': 'cv.exe', 'mime_type': 'application/x-msdownload', 'data_base64': PDF}).status_code == 422
    assert client.put('/api/public/emploi/me/cv', headers=headers, json={'name': 'cv.pdf', 'mime_type': 'application/pdf', 'data_base64': PNG}).status_code == 422
    photo = 'data:image/jpeg;base64,' + JPG
    assert client.put('/api/public/emploi/me/photo', headers=headers, json={'photo_data': photo}).status_code == 200
    assert client.put('/api/public/emploi/me/photo', headers=headers, json={'photo_data': 'data:image/png;base64,' + PNG}).status_code == 422
    me = client.get('/api/public/emploi/me', headers=headers).json()
    assert me['profile']['commune'] == 'Hydra' and me['cv']['name'] == 'cv.png' and me['has_photo'] is True
    assert 'cv_content' not in me and 'photo' not in me

    # La candidature reprend le profil enregistré, sans le renvoyer.
    offer = publish(client, securite)
    sent = client.post('/api/public/emploi/applications', headers=headers, json={'offer_id': offer['id'], 'request_id': 'reuse-profile-01', 'consent': True})
    assert sent.status_code == 201, sent.text
    candidate = db.get(Candidate, db.get(RecruitmentApplication, sent.json()['application_id']).candidate_id)
    assert candidate.email == 'nadia.reuse@example.com' and candidate.data['commune'] == 'Hydra' and candidate.data['langues'] == ['Arabe', 'Français']
    assert candidate.data['experience'][0]['societe'] == 'ACME' and candidate.data['cv']['mime_type'] == 'image/png'
    assert candidate.data['photo'] and candidate.data['photo'] != photo                                   # photo stockée par le circuit existant
    # Remplacer le CV du profil ne modifie ni le dossier, ni la pièce déjà transmise : la candidature suivante porte la nouvelle.
    client.put('/api/public/emploi/me/cv', headers=headers, json={'name': 'nouveau.pdf', 'mime_type': 'application/pdf', 'data_base64': PDF})
    later = apply(client, headers)
    assert later.status_code == 201
    db.refresh(candidate)
    assert candidate.data['cv']['name'] == 'cv.png'
    sent_documents = {row['id']: [doc['name'] for doc in row['documents']] for row in client.get('/api/public/emploi/applications', headers=headers).json()['items']}
    assert sent_documents == {sent.json()['application_id']: ['cv.png', 'photo.jpg'], later.json()['application_id']: ['nouveau.pdf', 'photo.jpg']}
    assert client.delete('/api/public/emploi/me/cv', headers=headers).status_code == 204
    assert client.get('/api/public/emploi/me', headers=headers).json()['cv'] is None


def test_existing_dossier_conflict_does_not_leak_internal_details(client, db, auth_headers):
    created = client.post('/api/drh/candidates', headers=auth_headers, json={'first_name': 'Autre', 'last_name': 'Emploi-Interne', 'email': 'deja@example.com',
                                                                             'desired_position': 'Agent', 'status': 'nouvelle', 'data': {}})
    assert created.status_code == 200, created.text
    headers, _ = session(client)
    refused = apply(client, headers, profile={'email': 'deja@example.com'})
    assert refused.status_code == 409 and 'dossier n°' not in refused.json()['detail'] and 'email' not in refused.json()['detail'].lower()
    assert db.query(RecruitmentApplication).count() == 0


def test_session_logout_expiry_and_account_deletion(client, db, securite):
    offer = publish(client, securite)
    headers, _ = session(client)
    sent = apply(client, headers, offer['id']).json()
    assert client.delete('/api/public/emploi/session', headers=headers).status_code == 204
    assert client.get('/api/public/emploi/me', headers=headers).status_code == 401

    db.query(RecruitmentSMSChallenge).delete()
    db.query(RecruitmentSMSRate).delete()
    db.commit()
    headers, _ = session(client)
    assert len(client.get('/api/public/emploi/applications', headers=headers).json()['items']) == 1         # l'espace retrouve ses candidatures
    db.query(RecruitmentCandidateSession).update({'expires_at': 1})
    db.commit()
    assert client.get('/api/public/emploi/me', headers=headers).status_code == 401

    db.query(RecruitmentSMSChallenge).delete()
    db.query(RecruitmentSMSRate).delete()
    db.commit()
    headers, _ = session(client)
    assert client.delete('/api/public/emploi/me', headers=headers).status_code == 204
    assert client.get('/api/public/emploi/me', headers=headers).status_code == 401
    assert db.query(RecruitmentCandidateAccount).count() == 0 and db.query(RecruitmentCandidateSession).count() == 0
    # La candidature déjà transmise reste au recrutement.
    kept = client.get(f"/api/drh/job-offers/{offer['id']}/applications", headers=securite).json()['items']
    assert [item['application_id'] for item in kept] == [sent['application_id']]


def test_previous_app_flow_still_works_and_its_dossier_is_adopted(client, db, auth_headers):
    """Parcours actuellement en production : code SMS puis dépôt direct, sans espace candidat."""
    client.post('/api/public/mobile/gateway/poll', headers=GATEWAY)
    issued = client.post('/api/public/mobile/request-code', json={'first_name': 'Nadia', 'last_name': 'Emploi', 'phone': '0551122334'})
    job = client.post('/api/public/mobile/gateway/poll', headers=GATEWAY).json()['job']
    token = client.post('/api/public/mobile/verify-code', json={'challenge_id': issued.json()['challenge_id'],
                        'code': re.search(r'\b\d{6}\b', job['message'])[0]}).json()['access_token']
    legacy = {'Authorization': 'Bearer ' + token}
    body = {'first_name': 'Nadia', 'last_name': 'Emploi', 'phone': '0551122334', 'desired_position': 'Agent de sécurité', 'consent': True,
            'cv': {'name': 'cv.png', 'mime_type': 'image/png', 'data_base64': PNG}}
    deposited = client.post('/api/public/mobile/candidates', headers=legacy, json=body)
    assert deposited.status_code == 201, deposited.text
    assert client.post('/api/public/mobile/candidates', headers=legacy, json=body).json()['reference'] == deposited.json()['reference']
    assert client.get('/api/public/candidates/form-config').json()['version'] == 4
    # Le même téléphone vérifié ouvre ensuite un espace : le dossier déjà déposé y apparaît.
    opened = client.post('/api/public/emploi/session', headers=legacy)
    assert opened.status_code == 201, opened.text
    mine = client.get('/api/public/emploi/applications', headers={'Authorization': 'Bearer ' + opened.json()['session_token']}).json()['items']
    assert len(mine) == 1 and mine[0]['kind'] == 'spontaneous' and mine[0]['reference'] == deposited.json()['reference']
    # Dossier historique : son suivi reste celui du dossier.
    assert mine[0]['state']['status'] == 'review' and mine[0]['state']['label'] == 'En cours d’étude'
    assert db.query(Candidate).filter(Candidate.last_name.ilike('emploi')).count() == 1
