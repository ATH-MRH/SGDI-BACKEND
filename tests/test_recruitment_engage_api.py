"""IRON Emploi : traitement complet d'une candidature — pièces, étapes, convocation, décision, contrat,
passage à la DRH — et services de l'espace candidat (messages, entretiens, alertes, notifications)."""
import base64
from datetime import timedelta

import pytest

from app.modules import recruitment_engage_service as engage
from app.modules import recruitment_jobs_service as jobs
from app.modules.drh.models import Candidate, ContractTemplate, Employee
from app.modules.recruitment_engage_models import (
    RecruitmentApplicationDocument, RecruitmentInterview, RecruitmentJobAlert, RecruitmentNotification, RecruitmentPushDevice, RecruitmentTip,
)
from app.modules.recruitment_jobs_models import RecruitmentApplication
from tests.test_recruitment_jobs_api import (  # noqa: F401 — fixtures et aides partagées
    JPG, PDF, PNG, SECURITE, SOLUTION, _process, apply, clean, offer_body, publish, securite, session, solution,
)

API, STAFF = '/api/public/emploi', '/api/drh/job-offers'


@pytest.fixture(autouse=True)
def clean_tips(db):
    yield
    db.rollback()
    db.query(RecruitmentTip).delete()
    db.query(ContractTemplate).filter(ContractTemplate.code == 'TEST-EMPLOI').delete()
    db.commit()


def when(days=2, hour=10):
    return (engage.now_local() + timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


def held(db, interview_id):
    """L'entretien a eu lieu : sa date est ramenée dans le passé."""
    db.get(RecruitmentInterview, interview_id).starts_at = engage.now_local() - timedelta(hours=1)
    db.commit()


def candidate_with_documents(client):
    headers, _ = session(client)
    assert client.put(f'{API}/me/cv', headers=headers, json={'name': 'cv.pdf', 'mime_type': 'application/pdf', 'data_base64': PDF}).status_code == 200
    assert client.put(f'{API}/me/photo', headers=headers, json={'photo_data': 'data:image/jpeg;base64,' + JPG}).status_code == 200
    return headers


def notifications(client, headers):
    return client.get(f'{API}/notifications', headers=headers).json()


def test_full_recruitment_journey_from_mobile_application_to_drh(client, db, securite, solution, auth_headers):
    offer = publish(client, securite)
    headers = candidate_with_documents(client)
    sent = apply(client, headers, offer['id'], message='Disponible immédiatement.', profile={'wilaya': 'Alger', 'birth_date': '1990-05-04', 'address': '1 rue du Test'})
    assert sent.status_code == 201, sent.text
    app_id = sent.json()['application_id']
    assert [n['title'] for n in notifications(client, headers)['items']] == ['Candidature reçue']

    # ── Réception et pièces jointes dans recrute.irongs.com
    board = client.get(f'{STAFF}/workspace', headers=securite).json()
    assert {c['key']: c['count'] for c in board['counters']}['new'] == 1 and board['items'][0]['id'] == app_id and board['items'][0]['documents'] == 2
    dossier = client.get(f'{STAFF}/applications/{app_id}', headers=securite).json()
    assert dossier['reference'] == sent.json()['reference'] and dossier['kind'] == 'offer' and dossier['offer']['id'] == offer['id']
    assert dossier['message'] == 'Disponible immédiatement.' and dossier['stage'] == 'received' and dossier['received_at']
    assert dossier['profile']['data']['adresse'] == '1 rue du Test' and dossier['profile']['phone'] == '+213551122334'
    assert '_cv_content' not in dossier['profile']['data'] and 'photo' not in dossier['profile']['data']
    assert [(d['kind'], d['name'], d['mime_type'], d['size'], d['source']) for d in dossier['documents']] == [
        ('cv', 'cv.pdf', 'application/pdf', len(base64.b64decode(PDF)), 'candidature'),
        ('photo', 'photo.jpg', 'image/jpeg', len(base64.b64decode(JPG)), 'candidature')]
    assert all(d['received_at'] for d in dossier['documents']) and dossier['history'][-1]['kind'] == 'reception'
    pdf, image = dossier['documents']
    viewed = client.get(f"{STAFF}/applications/{app_id}/documents/{pdf['id']}", headers=securite)
    assert viewed.status_code == 200 and viewed.content == base64.b64decode(PDF) and viewed.headers['content-type'] == 'application/pdf'
    assert viewed.headers['content-disposition'].startswith('inline') and 'no-store' in viewed.headers['cache-control']
    assert viewed.headers['x-content-type-options'] == 'nosniff'
    downloaded = client.get(f"{STAFF}/applications/{app_id}/documents/{image['id']}", headers=securite, params={'download': 1})
    assert downloaded.content == base64.b64decode(JPG) and downloaded.headers['content-disposition'].startswith('attachment')
    # Aucun lien public : sans session recruteur habilitée, la pièce n'existe pas.
    path = f"{STAFF}/applications/{app_id}/documents/{pdf['id']}"
    assert client.get(path).status_code == 401 and client.get(path, headers=headers).status_code == 401
    assert client.get(path, headers=solution).status_code == 404
    assert client.get(f'{STAFF}/applications/{app_id}/documents/999999', headers=securite).status_code == 404
    # Remplacer le CV du profil ne change pas la pièce transmise.
    client.put(f'{API}/me/cv', headers=headers, json={'name': 'autre.png', 'mime_type': 'image/png', 'data_base64': PNG})
    assert client.get(path, headers=securite).content == base64.b64decode(PDF)
    # Contenu perdu ou invalide : erreur explicite, pas de fichier vide.
    broken = db.get(RecruitmentApplicationDocument, image['id'])
    broken.content = ''
    db.commit()
    assert client.get(f"{STAFF}/applications/{app_id}/documents/{image['id']}", headers=securite).status_code == 410

    # ── Examen, attribution, note interne, présélection
    updated = _process(client, securite, app_id, stage='review', assigned_to='rec_securite', next_action='Appeler le candidat',
                       next_action_due=(jobs.today() + timedelta(days=1)).isoformat())
    assert updated.status_code == 200 and updated.json()['assigned_to'] == 'rec_securite' and updated.json()['next_action'] == 'Appeler le candidat'
    assert client.post(f'{STAFF}/applications/{app_id}/notes', headers=securite, json={'body': 'NOTE-INTERNE profil solide'}).status_code == 201
    assert _process(client, securite, app_id, stage='shortlisted').json()['visible_state']['code'] == 'shortlisted'
    assert client.get(f'{API}/applications/{app_id}', headers=headers).json()['state']['status'] == 'shortlisted'

    # ── Convocation liée à la candidature, confirmation, report
    proposed = client.post(f'{STAFF}/applications/{app_id}/interviews', headers=securite,
                           json={'starts_at': when().isoformat(), 'location': 'Siège, Hydra', 'contact': 'Mme Test', 'send_email': True})
    assert proposed.status_code == 201, proposed.text
    assert proposed.json()['stage'] == 'convocation' and any('E-mail non envoyé' in line for line in proposed.json()['channels'])
    again = client.post(f'{STAFF}/applications/{app_id}/interviews', headers=securite, json={'starts_at': when().isoformat(), 'location': 'Siège, Hydra'})
    assert again.status_code == 201 and db.query(RecruitmentInterview).count() == 1                       # double clic : pas de doublon
    mine = client.get(f'{API}/interviews', headers=headers).json()
    interview = mine['items'][0]
    assert mine['timezone'] == 'Africa/Algiers' and interview['application_id'] == app_id and interview['status'] == 'proposed'
    assert interview['location'] == 'Siège, Hydra' and interview['contact'] == 'Mme Test' and interview['position'] == 'Agent de sécurité'
    assert client.post(f"{API}/interviews/{interview['id']}/confirm", headers=headers).json()['status'] == 'confirmed'
    assert client.get(f'{STAFF}/applications/{app_id}', headers=securite).json()['interviews'][0]['status'] == 'confirmed'
    moved = client.put(f"{STAFF}/interviews/{interview['id']}", headers=securite, json={'starts_at': when(3, 14).isoformat(), 'location': 'Siège, Hydra'})
    assert moved.status_code == 200 and moved.json()['interviews'][0]['previous_starts_at'] == when().isoformat()
    assert client.get(f'{API}/interviews', headers=headers).json()['items'][0]['status'] == 'proposed'    # report : à confirmer de nouveau
    assert client.post(f"{API}/interviews/{interview['id']}/confirm", headers=headers).json()['status'] == 'confirmed'
    assert [n['title'] for n in notifications(client, headers)['items'] if n['kind'] == 'interview'] == ['Entretien reporté', 'Entretien proposé']

    # ── Entretien : présence et compte rendu (internes)
    early = client.post(f"{STAFF}/interviews/{interview['id']}/outcome", headers=securite, json={'attendance': 'present'})
    assert early.status_code == 409                                                                       # pas de compte rendu avant l'entretien
    held(db, interview['id'])
    done = client.post(f"{STAFF}/interviews/{interview['id']}/outcome", headers=securite,
                       json={'attendance': 'present', 'report': 'COMPTE-RENDU-CONFIDENTIEL très bon', 'appreciation': 'Favorable'})
    assert done.status_code == 200 and done.json()['interviews'][0]['status'] == 'done' and done.json()['stage'] == 'interview'

    # ── Décision : interne d'abord, communiquée ensuite
    assert client.put(f'{STAFF}/applications/{app_id}/contract', headers=securite, json={'position': 'Agent', 'contract_type': 'CDI'}).status_code == 409
    decided = _process(client, securite, app_id, outcome='favorable')
    assert decided.json()['stage'] == 'decision' and decided.json()['outcome_communicated'] is False
    assert client.get(f'{API}/applications/{app_id}', headers=headers).json()['state']['status'] == 'interview'
    assert _process(client, securite, app_id, stage='hiring_file').status_code == 409                    # pas avant la communication
    assert _process(client, securite, app_id, communicate=True, stage='hiring_file').json()['stage'] == 'hiring_file'
    assert client.get(f'{API}/applications/{app_id}', headers=headers).json()['state']['status'] == 'accepted'

    # ── Pièces complémentaires
    asked = client.post(f'{STAFF}/applications/{app_id}/document-requests', headers=securite, json={'label': 'Extrait de naissance', 'note': 'Original récent'})
    assert asked.status_code == 201 and asked.json()['missing_documents'] == 1
    detail = client.get(f'{API}/applications/{app_id}', headers=headers).json()
    request_id = detail['document_requests'][0]['id']
    assert detail['document_requests'][0]['label'] == 'Extrait de naissance' and detail['document_requests'][0]['status'] == 'requested'
    refused = client.put(f'{API}/document-requests/{request_id}', headers=headers, json={'name': 'x.exe', 'mime_type': 'application/x-msdownload', 'data_base64': PDF})
    assert refused.status_code == 422
    assert client.put(f'{API}/document-requests/{request_id}', headers=headers, json={'name': 'extrait.png', 'mime_type': 'image/png', 'data_base64': PNG}).status_code == 200
    assert client.put(f'{API}/document-requests/{request_id}', headers=headers, json={'name': 'extrait.png', 'mime_type': 'image/png', 'data_base64': PNG}).status_code == 409
    dossier = client.get(f'{STAFF}/applications/{app_id}', headers=securite).json()
    assert dossier['missing_documents'] == 0 and dossier['document_requests'][0]['status'] == 'received'
    complement = dossier['documents'][-1]
    assert (complement['kind'], complement['label'], complement['source'], complement['mime_type']) == ('complement', 'Extrait de naissance', 'complement', 'image/png')
    assert client.get(f"{STAFF}/applications/{app_id}/documents/{complement['id']}", headers=securite).content == base64.b64decode(PNG)

    # ── Contrat : préparé, remis, signature enregistrée — jamais signé automatiquement
    terms = {'position': 'Agent de sécurité', 'contract_type': 'CDI', 'start_date': (jobs.today() + timedelta(days=10)).isoformat(), 'salary_net': 45000, 'work_place': 'Alger'}
    prepared = client.put(f'{STAFF}/applications/{app_id}/contract', headers=securite, json=terms)
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()['contract']['state'] == 'prepared' and prepared.json()['contract']['signed_on'] is None and prepared.json()['stage'] == 'contract'
    assert client.post(f'{STAFF}/applications/{app_id}/contract/preview', headers=securite).status_code == 422       # modèle validé requis
    assert client.post(f'{STAFF}/applications/{app_id}/transfer-drh', headers=auth_headers).status_code == 409        # pas avant la signature
    assert client.post(f'{STAFF}/applications/{app_id}/contract/state', headers=securite, json={'state': 'sent', 'share_with_candidate': True}).json()['contract']['state'] == 'sent'
    assert client.post(f'{STAFF}/applications/{app_id}/contract/state', headers=securite, json={'state': 'signed'}).status_code == 422
    signed = client.post(f'{STAFF}/applications/{app_id}/contract/state', headers=securite, json={'state': 'signed', 'signed_on': jobs.today().isoformat()})
    assert signed.json()['contract']['state'] == 'signed' and signed.json()['contract']['signed_recorded_by'] == 'rec_securite' and signed.json()['stage'] == 'signature'
    assert client.put(f'{STAFF}/applications/{app_id}/contract', headers=securite, json=terms).status_code == 409
    shared = client.get(f'{API}/applications/{app_id}', headers=headers).json()['contract']
    assert shared == {'position': 'Agent de sécurité', 'contract_type': 'CDI', 'state': 'signed', 'state_label': 'Signé', 'start_date': terms['start_date'],
                      'signed_on': jobs.today().isoformat()}

    # ── Rattachement DRH par le circuit existant : idempotent, sans employé créé ici
    employees = db.query(Employee).count()
    assert client.post(f'{STAFF}/applications/{app_id}/transfer-drh', headers=securite).status_code == 403            # affectation de société : permission de ventilation
    transferred = client.post(f'{STAFF}/applications/{app_id}/transfer-drh', headers=auth_headers)
    assert transferred.status_code == 200, transferred.text
    assert transferred.json()['transfer']['already_transferred'] is False and transferred.json()['drh_transfer']['status'] == 'done'
    repeated = client.post(f'{STAFF}/applications/{app_id}/transfer-drh', headers=auth_headers)
    assert repeated.status_code == 200 and repeated.json()['transfer']['already_transferred'] is True
    candidate = db.get(Candidate, db.get(RecruitmentApplication, app_id).candidate_id)
    db.refresh(candidate)
    assert candidate.status == 'a_contractualiser' and jobs.text_key(candidate.society) == jobs.text_key(SECURITE)
    assert db.query(Employee).count() == employees and db.query(Candidate).filter(Candidate.last_name.ilike('emploi')).count() == 1
    assert _process(client, securite, app_id, stage='hired').status_code == 409                          # effectif = fiche employé créée par la DRH
    counters = {c['key']: c['count'] for c in client.get(f'{STAFF}/workspace', headers=securite).json()['counters']}
    assert counters['new'] == 0 and counters['contracts_sign'] == 0 and counters['missing_documents'] == 0

    # ── Rien d'interne n'atteint le candidat
    everything = ' '.join(client.get(f'{API}{path}', headers=headers).text for path in
                          ('/applications', f'/applications/{app_id}', '/interviews', '/notifications', '/conversations', '/me'))
    for secret in ('NOTE-INTERNE', 'COMPTE-RENDU-CONFIDENTIEL', 'rec_securite', 'Appeler le candidat', 'appreciation', 'assigned_to'):
        assert secret not in everything
    kinds = [event['kind'] for event in client.get(f'{STAFF}/applications/{app_id}', headers=securite).json()['history']]
    assert {'reception', 'assignment', 'note', 'stage', 'interview', 'decision', 'communication', 'document_request', 'document', 'contract', 'drh'} <= set(kinds)


def test_contract_preview_uses_the_validated_template_service(client, db, securite, monkeypatch):
    offer = publish(client, securite)
    headers = candidate_with_documents(client)
    app_id = apply(client, headers, offer['id']).json()['application_id']
    _process(client, securite, app_id, outcome='favorable', communicate=True)
    template = ContractTemplate(code='TEST-EMPLOI', title='CDI agent (test)', contract_type='CDI', file_name='modele-test.docx', docx_content=b'test')
    db.add(template)
    db.commit()
    assert [t['title'] for t in client.get(f'{STAFF}/contract-templates', headers=securite).json()['items'] if t['id'] == template.id] == ['CDI agent (test)']
    assert client.put(f'{STAFF}/applications/{app_id}/contract', headers=securite, json={'position': 'Agent', 'contract_type': 'CDI', 'template_id': 987654}).status_code == 422
    client.put(f'{STAFF}/applications/{app_id}/contract', headers=securite, json={'position': 'Agent', 'contract_type': 'CDI', 'template_id': template.id})
    seen = {}

    def fake(db_, form):
        seen.update(template_id=form.template_id, name=form.last_name, society=form.society, position=form.position)
        return b'DOCX', 'apercu.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    monkeypatch.setattr('app.modules.recruitment_engage_staff.drh_service.preview_contract_from_form', fake)
    preview = client.post(f'{STAFF}/applications/{app_id}/contract/preview', headers=securite)
    assert preview.status_code == 200 and preview.content == b'DOCX' and 'apercu.docx' in preview.headers['content-disposition']
    assert seen == {'template_id': template.id, 'name': 'EMPLOI', 'society': SECURITE, 'position': 'Agent'}
    # Un aperçu ne vaut ni contrat signé, ni employé.
    assert client.get(f'{STAFF}/applications/{app_id}', headers=securite).json()['contract']['state'] == 'prepared'


def test_refusal_withdrawal_postponement_and_absence(client, db, securite):
    first, second, third = publish(client, securite), publish(client, securite, title='Chef d’équipe sécurité'), publish(client, securite, title='Rondier')
    headers, _ = session(client)
    one, two, three = (apply(client, headers, offer['id']).json()['application_id'] for offer in (first, second, third))

    # Refus communiqué : plus de convocation possible, les autres candidatures continuent.
    _process(client, securite, one, outcome='unfavorable', communicate=True)
    assert client.post(f'{STAFF}/applications/{one}/interviews', headers=securite, json={'starts_at': when().isoformat(), 'location': 'Siège'}).status_code == 409
    assert client.post(f'{API}/applications/{one}/withdraw', headers=headers).status_code == 409            # déjà close : rien à retirer
    # Absence à l'entretien, puis entretien supplémentaire.
    client.post(f'{STAFF}/applications/{two}/interviews', headers=securite, json={'starts_at': when().isoformat(), 'location': 'Siège'})
    interview = client.get(f'{API}/interviews', headers=headers).json()['items'][0]
    held(db, interview['id'])
    absent = client.post(f"{STAFF}/interviews/{interview['id']}/outcome", headers=securite, json={'attendance': 'absent'})
    assert absent.json()['interviews'][0]['status'] == 'no_show' and absent.json()['stage'] == 'convocation'
    assert client.put(f"{STAFF}/interviews/{interview['id']}", headers=securite, json={'starts_at': when(4).isoformat(), 'location': 'Siège'}).status_code == 409
    extra = client.post(f'{STAFF}/applications/{two}/interviews', headers=securite, json={'starts_at': when(5).isoformat(), 'location': 'Siège'})
    assert len(extra.json()['interviews']) == 2
    assert client.post(f'{STAFF}/applications/{two}/interviews', headers=securite, json={'starts_at': when(-3).isoformat(), 'location': 'Siège'}).status_code == 422
    # Annulation par le recruteur : le candidat est prévenu et ne peut plus confirmer.
    new_id = extra.json()['interviews'][0]['id']
    assert client.post(f'{STAFF}/interviews/{new_id}/cancel', headers=securite).json()['interviews'][0]['status'] == 'cancelled'
    assert client.post(f'{API}/interviews/{new_id}/confirm', headers=headers).status_code == 409
    assert 'Entretien annulé' in [n['title'] for n in client.get(f'{API}/notifications', headers=headers).json()['items']]
    # Retrait par le candidat : entretien à venir annulé, traitement clos côté recruteur.
    client.post(f'{STAFF}/applications/{three}/interviews', headers=securite, json={'starts_at': when(6).isoformat(), 'location': 'Siège'})
    assert client.post(f'{API}/applications/{three}/withdraw', headers=headers).json() == {'withdrawn': True}
    detail = client.get(f'{API}/applications/{three}', headers=headers).json()
    assert detail['state']['status'] == 'withdrawn' and detail['withdrawn'] is True and detail['can_withdraw'] is False
    dossier = client.get(f'{STAFF}/applications/{three}', headers=securite).json()
    assert dossier['outcome'] == 'withdrawn' and dossier['interviews'][0]['status'] == 'cancelled'
    assert _process(client, securite, three, stage='review').status_code == 409
    assert client.post(f'{STAFF}/applications/{three}/document-requests', headers=securite, json={'label': 'Pièce'}).status_code == 409
    # Une candidature retenue ne se retire pas d'un simple appui.
    _process(client, securite, two, outcome='favorable', communicate=True)
    assert client.post(f'{API}/applications/{two}/withdraw', headers=headers).status_code == 409
    states = {item['id']: item['state']['status'] for item in client.get(f'{API}/applications', headers=headers).json()['items']}
    assert states == {one: 'declined', two: 'accepted', three: 'withdrawn'}


def test_messages_are_private_to_the_candidate_and_recruiters_in_scope(client, db, securite, solution):
    offer = publish(client, securite)
    nadia, _ = session(client)
    app_id = apply(client, nadia, offer['id']).json()['application_id']
    spontaneous = apply(client, nadia).json()['application_id']
    karim, _ = session(client, phone='0661122334', first_name='Karim', last_name='Emploi-Deux')
    body = {'body': 'Bonjour, je suis disponible.', 'client_id': 'msg-candidat-0001'}
    first = client.post(f'{API}/applications/{app_id}/messages', headers=nadia, json=body)
    retried = client.post(f'{API}/applications/{app_id}/messages', headers=nadia, json=body)                 # relance réseau : pas de doublon
    assert first.status_code == 201 and retried.status_code == 200 and retried.json()['id'] == first.json()['id']
    assert client.post(f'{API}/applications/{app_id}/messages', headers=nadia, json={'body': '   ', 'client_id': 'msg-vide-0001'}).status_code == 422
    # Ni un autre candidat, ni un recruteur d'une autre société, ni un anonyme.
    for call in (client.get(f'{API}/applications/{app_id}/messages', headers=karim), client.post(f'{API}/applications/{app_id}/messages', headers=karim, json=body),
                 client.get(f'{STAFF}/applications/{app_id}/messages', headers=solution),
                 client.post(f'{STAFF}/applications/{app_id}/messages', headers=solution, json=body)):
        assert call.status_code == 404
    assert client.get(f'{API}/applications/{app_id}/messages').status_code == 401
    assert client.get(f'{STAFF}/applications/{app_id}/messages', headers=nadia).status_code == 401
    assert client.get(f'{STAFF}/conversations', headers=solution).json()['items'] == []
    inbox = client.get(f'{STAFF}/conversations', headers=securite).json()['items']
    assert [(c['application_id'], c['unread'], c['candidate']) for c in inbox] == [(app_id, 1, 'EMPLOI NADIA')]
    thread = client.get(f'{STAFF}/applications/{app_id}/messages', headers=securite).json()
    assert [m['body'] for m in thread['items']] == ['Bonjour, je suis disponible.'] and thread['can_reach_candidate'] is True
    assert client.get(f'{STAFF}/conversations', headers=securite).json()['items'][0]['unread'] == 0
    reply = {'body': 'Merci, nous revenons vers vous.', 'client_id': 'msg-recruteur-0001'}
    assert client.post(f'{STAFF}/applications/{app_id}/messages', headers=securite, json=reply).status_code == 201
    client.post(f'{STAFF}/applications/{app_id}/messages', headers=securite, json=reply)
    conversations = client.get(f'{API}/conversations', headers=nadia).json()['items']
    assert [(c['application_id'], c['unread'], c['kind']) for c in conversations] == [(app_id, 1, 'offer'), (spontaneous, 0, 'spontaneous')]
    assert conversations[0]['last_message']['body'] == 'Merci, nous revenons vers vous.'
    assert client.get(f'{API}/summary', headers=nadia).json()['unread_messages'] == 1
    messages = client.get(f'{API}/applications/{app_id}/messages', headers=nadia).json()['items']
    assert [(m['sender'], m['body']) for m in messages] == [('candidate', 'Bonjour, je suis disponible.'), ('recruiter', 'Merci, nous revenons vers vous.')]
    assert 'author' not in messages[1] and messages[0]['read'] is True                                    # le nom du recruteur n'est pas transmis
    assert client.get(f'{API}/summary', headers=nadia).json()['unread_messages'] == 0
    assert [n['kind'] for n in client.get(f'{API}/notifications', headers=nadia).json()['items']].count('message') == 1
    # Candidature spontanée : vivier commun, tout recruteur habilité peut répondre.
    assert client.post(f'{STAFF}/applications/{spontaneous}/messages', headers=solution, json=reply).status_code == 201


def test_alerts_create_notifications_for_matching_new_offers(client, db, securite, solution):
    headers, _ = session(client)
    other, _ = session(client, phone='0661122334', first_name='Karim', last_name='Emploi-Deux')
    assert client.post(f'{API}/alerts', headers=headers, json={}).status_code == 422
    assert client.post(f'{API}/alerts', headers=headers, json={'contract_type': 'Inconnu'}).status_code == 422
    created = client.post(f'{API}/alerts', headers=headers, json={'wilaya': 'Oran', 'profession': 'Logistique'})
    assert created.status_code == 201 and created.json()['active'] is True
    alert_id = created.json()['id']
    paused = client.post(f'{API}/alerts', headers=headers, json={'wilaya': 'Alger', 'active': False}).json()
    client.post(f'{API}/alerts', headers=other, json={'contract_type': 'CDI'})
    assert client.put(f'{API}/alerts/{alert_id}', headers=other, json={'wilaya': 'Blida'}).status_code == 404
    assert client.delete(f'{API}/alerts/{alert_id}', headers=other).status_code == 404
    publish(client, securite)                                                                              # Alger, Sécurité, CDI
    assert [n['kind'] for n in client.get(f'{API}/notifications', headers=headers).json()['items']] == []  # alerte Alger désactivée
    assert [n['kind'] for n in client.get(f'{API}/notifications', headers=other).json()['items']] == ['offer']
    match = publish(client, solution, society=SOLUTION, title='Cariste', profession='Logistique', wilaya='Oran', contract_type='CDD')
    offers = [n for n in client.get(f'{API}/notifications', headers=headers).json()['items'] if n['kind'] == 'offer']
    assert len(offers) == 1 and offers[0]['offer_id'] == match['id'] and offers[0]['read'] is False and 'Cariste' in offers[0]['body']
    # Clôturée puis republiée : la même annonce ne notifie pas deux fois.
    client.post(f"{STAFF}/{match['id']}/close", headers=solution)
    client.post(f"{STAFF}/{match['id']}/publish", headers=solution)
    assert len([n for n in client.get(f'{API}/notifications', headers=headers).json()['items'] if n['kind'] == 'offer']) == 1
    # Activation, modification, lecture, suppression.
    assert client.put(f"{API}/alerts/{paused['id']}", headers=headers, json={'wilaya': 'Alger', 'active': True}).json()['active'] is True
    assert client.get(f'{API}/summary', headers=headers).json()['unread_notifications'] == 1
    assert client.post(f"{API}/notifications/{offers[0]['id']}/read", headers=headers).json()['read'] is True
    assert client.post(f"{API}/notifications/{offers[0]['id']}/read", headers=other).status_code == 404
    assert client.get(f'{API}/summary', headers=headers).json()['unread_notifications'] == 0
    assert client.post(f'{API}/notifications/read-all', headers=other).json() == {'unread': 0}
    assert client.delete(f'{API}/alerts/{alert_id}', headers=headers).status_code == 204
    assert [a['id'] for a in client.get(f'{API}/alerts', headers=headers).json()['items']] == [paused['id']]
    for _ in range(engage.MAX_ALERTS - 1):
        assert client.post(f'{API}/alerts', headers=headers, json={'wilaya': 'Oran'}).status_code == 201
    assert client.post(f'{API}/alerts', headers=headers, json={'wilaya': 'Oran'}).status_code == 409


def test_historical_dossier_convocation_is_kept_and_never_duplicated(client, db, securite):
    offer = publish(client, securite)
    headers, _ = session(client)
    app_id = apply(client, headers, offer['id']).json()['application_id']
    candidate = db.get(Candidate, db.get(RecruitmentApplication, app_id).candidate_id)
    slot = when()
    candidate.data = {**candidate.data, 'derniereConvocation': {'date': slot.date().isoformat(), 'heure': '10:00', 'lieu': 'Siège historique'}}
    db.commit()
    items = client.get(f'{API}/interviews', headers=headers).json()['items']
    # Convocation du dossier : conservée, signalée comme telle, rattachée à aucune annonce.
    assert [(i['source'], i['application_id'], i['location'], i['id']) for i in items] == [('dossier', None, 'Siège historique', None)]
    assert client.get(f'{STAFF}/applications/{app_id}', headers=securite).json()['dossier_convocation']['lieu'] == 'Siège historique'
    # La même date proposée sur la candidature : une seule ligne pour le candidat.
    client.post(f'{STAFF}/applications/{app_id}/interviews', headers=securite, json={'starts_at': slot.isoformat(), 'location': 'Siège'})
    items = client.get(f'{API}/interviews', headers=headers).json()['items']
    assert [(i['source'], i['application_id']) for i in items] == [('interview', app_id)]
    assert client.get(f'{API}/summary', headers=headers).json()['upcoming_interviews'] == 1


def test_tips_are_managed_by_recruiters_and_only_published_ones_are_public(client, db, securite, restricted_headers):
    tip = {'title': 'Préparer son entretien', 'summary': 'Les points à revoir la veille.', 'body': 'La veille\n- Relisez l’annonce', 'category': 'entretien'}
    assert client.post(f'{STAFF}/tips', json=tip).status_code == 401
    assert client.post(f'{STAFF}/tips', headers=restricted_headers, json=tip).status_code == 403
    created = client.post(f'{STAFF}/tips', headers=securite, json=tip)
    assert created.status_code == 201 and created.json()['status'] == 'draft'
    assert client.get(f'{API}/tips').json() == {'items': []}                                              # un brouillon n'est pas public
    published = client.put(f"{STAFF}/tips/{created.json()['id']}", headers=securite, json={**tip, 'status': 'published'})
    assert published.json()['status'] == 'published' and published.json()['updated_by'] == 'rec_securite'
    public = client.get(f'{API}/tips').json()['items']
    assert [(t['title'], t['category']) for t in public] == [('Préparer son entretien', 'entretien')] and 'updated_by' not in public[0] and 'status' not in public[0]
    assert client.delete(f"{STAFF}/tips/{created.json()['id']}", headers=securite).status_code == 403     # suppression réservée à la DRH


def test_push_is_off_by_default_and_devices_follow_the_signed_in_space(client, db, securite, monkeypatch):
    headers, _ = session(client)
    other, _ = session(client, phone='0661122334', first_name='Karim', last_name='Emploi-Deux')
    settings = client.get(f'{API}/me/settings', headers=headers).json()
    assert settings == {'push': {'applications': True, 'messages': True, 'interviews': True, 'offers': True}, 'push_available': False, 'devices': 0}
    assert client.put(f'{API}/me/push-device', headers=headers, json={'token': 'ExponentPushToken[test-device-1]', 'platform': 'web'}).status_code == 422
    assert client.put(f'{API}/me/push-device', headers=headers, json={'token': 'ExponentPushToken[test-device-1]', 'platform': 'ios'}).status_code == 200
    assert client.put(f'{API}/me/settings', headers=headers, json={'push': {'messages': False}}).json()['push']['messages'] is False
    calls = []
    monkeypatch.setattr(engage.urllib.request, 'urlopen', lambda request, timeout: calls.append(request) or (_ for _ in ()).throw(AssertionError('appel réseau')))
    row = db.query(RecruitmentNotification).first() or engage.notify(db, db.query(RecruitmentPushDevice).first().account_id, 'application', 'T', 'B')
    db.commit()
    assert engage.send_push(db, [row]) == 0 and calls == []                                               # désactivé : aucun appel sortant
    # Le téléphone passe à un autre espace : il ne reçoit plus pour le précédent.
    client.put(f'{API}/me/push-device', headers=other, json={'token': 'ExponentPushToken[test-device-1]', 'platform': 'android'})
    assert client.get(f'{API}/me/settings', headers=headers).json()['devices'] == 0 and client.get(f'{API}/me/settings', headers=other).json()['devices'] == 1
    # Déconnexion d'un téléphone : lui seul est retiré, les autres appareils de l'espace restent.
    client.put(f'{API}/me/push-device', headers=other, json={'token': 'ExponentPushToken[test-device-2]', 'platform': 'ios'})
    assert client.delete(f'{API}/me/push-device', headers=other, params={'token': 'ExponentPushToken[test-device-1]'}).status_code == 204
    assert client.get(f'{API}/me/settings', headers=other).json()['devices'] == 1
    assert client.delete(f'{API}/me/push-device', headers=other).status_code == 204
    assert client.get(f'{API}/me/settings', headers=other).json()['devices'] == 0
    # Suppression de l'espace : alertes, notifications et appareils disparaissent avec lui.
    client.post(f'{API}/alerts', headers=headers, json={'wilaya': 'Oran'})
    assert client.delete(f'{API}/me', headers=headers).status_code == 204
    assert db.query(RecruitmentJobAlert).count() == 0 and db.query(RecruitmentNotification).count() == 0


def test_workspace_counters_and_filters(client, db, securite, solution):
    first, second = publish(client, securite), publish(client, securite, title='Chef d’équipe sécurité', wilaya='Oran')
    cariste = publish(client, solution, society=SOLUTION, title='Cariste', wilaya='Oran')
    nadia, _ = session(client)
    karim, _ = session(client, phone='0661122334', first_name='Karim', last_name='Emploi-Deux')
    a1, a2 = apply(client, nadia, first['id']).json()['application_id'], apply(client, nadia, second['id']).json()['application_id']
    a3, a4 = apply(client, karim, first['id']).json()['application_id'], apply(client, karim, cariste['id']).json()['application_id']
    spontaneous = apply(client, karim).json()['application_id']
    _process(client, securite, a1, stage='review', assigned_to='rec_securite')
    _process(client, securite, a2, stage='shortlisted')
    client.post(f'{STAFF}/applications/{a2}/interviews', headers=securite, json={'starts_at': when().isoformat(), 'location': 'Siège'})
    _process(client, securite, a3, outcome='favorable')
    client.post(f'{STAFF}/applications/{a1}/document-requests', headers=securite, json={'label': 'Diplôme'})

    def board(headers=securite, **params):
        data = client.get(f'{STAFF}/workspace', headers=headers, params=params).json()
        return {c['key']: c['count'] for c in data['counters']}, [item['id'] for item in data['items']], data

    counters, ids, data = board()
    # Société Sécurité : ses annonces et le vivier spontané ; jamais la candidature de l'autre société.
    assert sorted(ids) == sorted([a1, a2, a3, spontaneous]) and a4 not in ids
    assert counters == {'new': 1, 'review': 1, 'shortlisted': 1, 'interviews': 1, 'missing_documents': 1, 'decisions': 1,
                        'contracts_prepare': 0, 'contracts_sign': 0, 'hired': 0}
    assert [c['label'] for c in data['counters']][:3] == ['Nouvelles candidatures', 'Dossiers à examiner', 'Présélections']
    assert board(bucket='decisions')[1] == [a3] and board(bucket='interviews')[1] == [a2] and board(bucket='missing_documents')[1] == [a1]
    assert board(offer_id=first['id'])[1] == [a3, a1] and board(wilaya='Oran')[1] == [a2] and board(stage='review')[1] == [a1]
    assert board(assigned_to='rec_securite')[1] == [a1] and sorted(board(assigned_to='__none__')[1]) == sorted([a2, a3, spontaneous])
    assert board(q='karim')[1] == [spontaneous, a3] and board(q='chef nadia')[1] == [a2]
    assert board(date_from=(jobs.today() + timedelta(days=2)).isoformat())[1] == [] and len(board(date_to=jobs.today().isoformat())[1]) == 4
    assert sorted(board(headers=solution)[1]) == sorted([a4, spontaneous])
    assert board(society=SOLUTION)[1] == []
    # Favorable communiqué sans contrat : « contrats à préparer » ; contrat préparé : « à signer ».
    _process(client, securite, a3, communicate=True)
    assert board()[0]['contracts_prepare'] == 1 and board()[0]['decisions'] == 0
    client.put(f'{STAFF}/applications/{a3}/contract', headers=securite, json={'position': 'Agent', 'contract_type': 'CDI'})
    assert board()[0]['contracts_prepare'] == 0 and board()[0]['contracts_sign'] == 1
    assert client.get(f'{STAFF}/workspace').status_code == 401 and client.get(f'{STAFF}/workspace', headers=nadia).status_code == 401
