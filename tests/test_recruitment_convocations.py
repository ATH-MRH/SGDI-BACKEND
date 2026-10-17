"""IRON Emploi — convocations à un entretien : brouillon, envoi, document PDF, QR, scan, arrivée, report, annulation.

Le QR est toujours lu par un vrai décodeur (zxing-cpp) sur le rendu du PDF (pdfium) : ce qui est testé est ce
qu'imprime ou affiche le candidat, pas une valeur recopiée.
"""
import json
from datetime import timedelta

import pypdfium2 as pdfium
import pytest
import zxingcpp

from app.core.security import hash_password
from app.modules import recruitment_convocations as conv
from app.modules import recruitment_engage_service as engage
from app.modules import recruitment_push_worker as worker
from app.modules.auth.models import User
from app.modules.drh.models import Candidate
from app.modules.recruitment_engage_models import (
    RecruitmentConvocationVersion as Version, RecruitmentInterview as Interview, RecruitmentNotification as Notification,
    RecruitmentPushDelivery as Delivery, RecruitmentPushDevice as Device,
)
from app.modules.recruitment_jobs_models import RecruitmentApplication as Application
from tests.test_recruitment_jobs_api import (  # noqa: F401 — fixtures et aides partagées
    SECURITE, SOLUTION, _login, apply, clean, publish, securite, session, solution,
)

API, STAFF = '/api/public/emploi', '/api/drh/job-offers'
FORM = {'location': 'Siège IRON Global Sécurité', 'address': 'Zone industrielle, lot 12\nRouïba, Alger', 'contact': 'Mme Benali',
        'contact_details': 'recrutement@exemple.dz', 'purpose': 'Entretien de recrutement', 'documents_to_bring': 'Pièce d’identité\nCV',
        'note': 'Présentez-vous 15 minutes avant.', 'map_url': 'https://maps.example.org/?q=Rouiba'}


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Aucun envoi réel : ni push Expo, ni e-mail."""
    monkeypatch.setattr(worker, 'post', lambda *args: pytest.fail('appel réseau réel vers Expo'))


def when(days=2, hour=10, minute=0):
    return (engage.now_local() + timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)


def convoke(client, headers, application_id, *, mode='send', days=2, request_id=None, **fields):
    body = {**FORM, 'starts_at': when(days).isoformat(), 'mode': mode, **fields}
    if request_id:
        body['request_id'] = request_id
    return client.post(f'{STAFF}/applications/{application_id}/interviews', headers=headers, json=body)


def setup_application(client, securite, **profile):
    offer = publish(client, securite)
    headers, _ = session(client)
    application_id = apply(client, headers, offer['id'], profile={'wilaya': 'Alger', **profile}).json()['application_id']
    return headers, application_id, offer


def decode_pdf(data: bytes) -> tuple[str, list[str]]:
    document = pdfium.PdfDocument(data)
    text = '\n'.join(page.get_textpage().get_text_range() for page in document)
    codes = [code.text for page in document for code in zxingcpp.read_barcodes(page.render(scale=200 / 72).to_pil())]
    return text, codes


def candidate_notifications(client, headers):
    return [n for n in client.get(f'{API}/notifications', headers=headers).json()['items'] if n['kind'] == 'interview']


def test_draft_is_never_seen_by_the_candidate_then_sending_creates_version_one(client, db, securite):
    headers, application_id, _ = setup_application(client, securite)
    draft = convoke(client, securite, application_id, mode='draft', request_id='draft-request-0001')
    assert draft.status_code == 201, draft.text
    interview_id = draft.json()['interview_id']
    staff = next(i for i in draft.json()['interviews'] if i['id'] == interview_id)
    assert staff['status'] == 'draft' and staff['version'] == 0 and staff['versions'] == [] and staff['candidate_state'] is None
    # Brouillon : invisible et non notifié côté candidat, aucune étape modifiée.
    assert client.get(f'{API}/interviews', headers=headers).json()['items'] == []
    assert client.get(f'{API}/interviews/{interview_id}', headers=headers).status_code == 404
    assert client.get(f'{API}/interviews/{interview_id}/convocation', headers=headers).status_code == 404
    assert candidate_notifications(client, headers) == [] and draft.json()['stage'] == 'received'
    assert client.get(f'{API}/summary', headers=headers).json()['upcoming_interviews'] == 0
    # Modifier le brouillon reste silencieux ; son aperçu PDF n'a pas encore de QR.
    edited = client.put(f'{STAFF}/interviews/{interview_id}', headers=securite, json={**FORM, 'starts_at': when(3).isoformat(), 'location': 'Annexe Hydra'})
    assert edited.status_code == 200 and candidate_notifications(client, headers) == []
    preview = client.get(f'{STAFF}/interviews/{interview_id}/convocation', headers=securite)
    assert preview.status_code == 200 and preview.headers['content-type'] == 'application/pdf'
    text, codes = decode_pdf(preview.content)
    assert 'BROUILLON' in text and 'Annexe Hydra' in text and codes == []
    # Envoi : version 1, notification à ce seul candidat, état « nouvelle ».
    sent = client.post(f'{STAFF}/interviews/{interview_id}/send', headers=securite)
    assert sent.status_code == 200, sent.text
    staff = next(i for i in sent.json()['interviews'] if i['id'] == interview_id)
    assert staff['status'] == 'proposed' and staff['version'] == 1 and [v['state'] for v in staff['versions']] == ['active']
    assert sent.json()['stage'] == 'convocation' and staff['candidate_state'] == 'new'
    items = client.get(f'{API}/interviews', headers=headers).json()['items']
    assert [(i['id'], i['convocation']['state'], i['convocation']['version']) for i in items] == [(interview_id, 'new', 1)]
    notes = candidate_notifications(client, headers)
    assert [(n['title'], n['interview_id']) for n in notes] == [('Convocation à un entretien', interview_id)]
    # Écran verrouillé : ni lieu, ni heure, ni société dans le texte de la notification.
    assert 'Hydra' not in notes[0]['body'] and 'IRON' not in notes[0]['body'].replace('IRON Emploi', '')
    # Renvoyer : sans effet (pas de seconde version, pas de seconde notification).
    assert client.post(f'{STAFF}/interviews/{interview_id}/send', headers=securite).json()['channels'] == ['Convocation déjà envoyée.']
    assert db.query(Version).filter(Version.interview_id == interview_id).count() == 1 and len(candidate_notifications(client, headers)) == 1


def test_double_click_and_network_retry_create_one_convocation(client, db, securite):
    headers, application_id, _ = setup_application(client, securite)
    first = convoke(client, securite, application_id, request_id='retry-request-0001')
    again = convoke(client, securite, application_id, request_id='retry-request-0001', days=5)      # relance, même requête
    assert first.status_code == again.status_code == 201 and first.json()['interview_id'] == again.json()['interview_id']
    assert db.query(Interview).filter(Interview.application_id == application_id).count() == 1
    assert db.query(Version).count() == 1 and len(candidate_notifications(client, headers)) == 1


def test_candidate_reads_confirms_and_downloads_a_pdf_whose_qr_opens_the_right_interview(client, db, securite):
    headers, application_id, offer = setup_application(client, securite)
    candidate = db.get(Candidate, db.get(Application, application_id).candidate_id)
    candidate.data = {**(candidate.data or {}), 'nin': '109876543210987654', 'salaireSouhaite': '95000'}
    db.commit()
    client.post(f'{STAFF}/applications/{application_id}/notes', headers=securite, json={'body': 'NOTE-INTERNE confidentielle'})
    interview_id = convoke(client, securite, application_id).json()['interview_id']
    detail = client.get(f'{API}/interviews/{interview_id}', headers=headers).json()
    assert detail['convocation']['state'] == 'new' and detail['convocation']['reference'].startswith('CONV-') and detail['checked_at']
    assert detail['convocation']['address'].startswith('Zone industrielle') and detail['convocation']['qr']        # QR dessinable hors ligne
    assert 'report' not in detail and 'appreciation' not in detail and 'assessment' not in json.dumps(detail)
    viewed = client.post(f'{API}/interviews/{interview_id}/viewed', headers=headers).json()
    assert viewed['convocation']['state'] == 'viewed' and viewed['convocation']['viewed'] is True
    assert client.get(f'{STAFF}/applications/{application_id}', headers=securite).json()['interviews'][0]['viewed_by_candidate'] is True
    confirmed = client.post(f'{API}/interviews/{interview_id}/confirm', headers=headers).json()
    assert confirmed['status'] == 'confirmed' and confirmed['convocation']['state'] == 'confirmed'
    document = client.get(f'{API}/interviews/{interview_id}/convocation', headers=headers)
    assert document.status_code == 200 and document.headers['content-type'] == 'application/pdf'
    assert 'attachment' in document.headers['content-disposition'] and document.headers['cache-control'] == 'no-store'
    text, codes = decode_pdf(document.content)
    version = db.query(Version).filter(Version.interview_id == interview_id).one()
    assert codes == [conv.qr_url(version.token)] and codes[0].startswith('https://recrute.irongs.com/#convocation=')
    for expected in ('Convocation à un entretien', 'Présentez cette convocation à votre arrivée.', detail['convocation']['reference'],
                     'heure d’Alger', 'Rouïba', 'Pièce d’identité', 'EMPLOI NADIA', offer['title']):
        assert expected.casefold() in text.casefold(), expected
    for secret in ('109876543210987654', '95000', 'NOTE-INTERNE', str(application_id) + '#'):
        assert secret not in text and secret not in codes[0]
    # QR sans donnée lisible : l'origine publique et l'identifiant aléatoire de la version, rien d'autre.
    assert codes[0] == f'https://recrute.irongs.com/#convocation={version.token}' and conv.TOKEN_RE.match(version.token)
    assert 'nadia' not in codes[0].lower() and 'emploi' not in codes[0].lower()
    # Le QR du document ouvre, pour un recruteur connecté, la bonne candidature et le bon entretien.
    opened = client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': codes[0]})
    assert opened.status_code == 200, opened.text
    assert (opened.json()['state'], opened.json()['application_id'], opened.json()['interview_id']) == ('active', application_id, interview_id)
    assert opened.json()['summary']['confirmed_by_candidate'] is True and opened.json()['summary']['candidate'].casefold() == 'emploi nadia'


def test_scan_without_session_out_of_scope_unknown_or_invalid_reveals_nothing(client, db, securite, solution):
    headers, application_id, _ = setup_application(client, securite)
    interview_id = convoke(client, securite, application_id).json()['interview_id']
    token = db.query(Version).filter(Version.interview_id == interview_id).one().token
    url = conv.qr_url(token)
    anonymous = client.post(f'{STAFF}/convocations/resolve', json={'code': url})
    assert anonymous.status_code == 401 and 'Nadia' not in anonymous.text
    outside = client.post(f'{STAFF}/convocations/resolve', headers=solution, json={'code': url})       # autre société
    assert outside.status_code == 403 and 'Nadia' not in outside.text and 'EMPLOI' not in outside.text
    assert client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': conv.qr_url(conv.new_token())}).status_code == 404
    for wrong in ('https://evil.example.com/#convocation=' + token, 'http://recrute.irongs.com/#convocation=' + token, 'bonjour', token[:-1]):
        assert client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': wrong}).status_code == 422, wrong
    # Le candidat (session de l'application) n'ouvre rien côté recruteur ; un autre candidat ne voit rien.
    assert client.post(f'{STAFF}/convocations/resolve', headers=headers, json={'code': url}).status_code == 401
    other, _ = session(client, phone='0661122334', first_name='Karim', last_name='Emploi-Deux')
    for method, path in (('get', ''), ('get', '/convocation'), ('post', '/viewed'), ('post', '/confirm')):
        assert getattr(client, method)(f'{API}/interviews/{interview_id}{path}', headers=other).status_code == 404, path
    # Recherche manuelle par référence imprimée, avec ou sans version.
    reference = client.get(f'{API}/interviews/{interview_id}', headers=headers).json()['convocation']['reference']
    assert client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': reference.lower()}).json()['interview_id'] == interview_id
    assert client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': f'{reference}-V1'}).json()['version'] == 1
    assert client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': f'{reference}-V9'}).status_code == 404
    # Le scan ne modifie rien ; il est journalisé sans le jeton complet.
    row = db.get(Interview, interview_id)
    db.refresh(row)
    assert row.status == 'proposed' and row.arrived_at is None and row.report is None
    from app.modules.auth.models import AuditEvent
    logs = db.query(AuditEvent).filter(AuditEvent.action == 'recruitment.job_application.convocation_scan').all()
    assert {log.result for log in logs} == {'success', 'refused'} and all(token not in json.dumps(log.new_state or {}) for log in logs)


def test_postponement_supersedes_the_old_qr_and_arrival_is_explicit_idempotent_and_never_a_decision(client, db, securite):
    headers, application_id, _ = setup_application(client, securite)
    interview_id = convoke(client, securite, application_id).json()['interview_id']
    assert client.post(f'{API}/interviews/{interview_id}/confirm', headers=headers).status_code == 200
    first = db.query(Version).filter(Version.interview_id == interview_id, Version.version == 1).one().token
    # Report à aujourd'hui, plus tard dans la journée : nouvelle version, ancien QR obsolète, candidat prévenu.
    later = (engage.now_local() + timedelta(minutes=90)).replace(second=0, microsecond=0)
    if later.date() != engage.now_local().date():
        pytest.skip('fin de journée : le report « aujourd’hui » n’est pas possible à cette heure')
    moved = client.put(f'{STAFF}/interviews/{interview_id}', headers=securite, json={**FORM, 'starts_at': later.isoformat()})
    assert moved.status_code == 200, moved.text
    staff = moved.json()['interviews'][0]
    assert staff['version'] == 2 and [v['state'] for v in staff['versions']] == ['active', 'superseded'] and staff['status'] == 'proposed'
    mine = client.get(f'{API}/interviews/{interview_id}', headers=headers).json()
    assert mine['convocation']['state'] == 'rescheduled' and mine['convocation']['previous_starts_at'] and mine['convocation']['can_confirm']
    assert [n['title'] for n in candidate_notifications(client, headers)] == ['Convocation reportée', 'Convocation à un entretien']
    old = client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': conv.qr_url(first)}).json()
    assert old['state'] == 'superseded' and 'Ne validez pas l’ancienne date' in old['warning'] and old['can_confirm_arrival'] is False
    assert client.post(f'{STAFF}/interviews/{interview_id}/arrival', headers=securite, json={'version': 1}).status_code == 409
    current = client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': conv.qr_url(
        db.query(Version).filter(Version.interview_id == interview_id, Version.version == 2).one().token)}).json()
    assert current['state'] == 'active' and current['can_confirm_arrival'] is True
    # Arrivée confirmée : enregistrée une fois, auditée ; aucun résultat, aucune décision.
    arrived = client.post(f'{STAFF}/interviews/{interview_id}/arrival', headers=securite, json={'version': 2})
    again = client.post(f'{STAFF}/interviews/{interview_id}/arrival', headers=securite, json={'version': 2})
    assert arrived.status_code == again.status_code == 200
    staff = arrived.json()['interviews'][0]
    assert staff['arrived_by'] == 'rec_securite' and staff['arrived_at'] == again.json()['interviews'][0]['arrived_at']
    assert staff['status'] == 'proposed' and arrived.json()['outcome'] == 'pending' and arrived.json()['stage'] == 'convocation'
    assert arrived.json()['contract_state'] is None and arrived.json()['drh_transfer'] is None
    assert sum('Arrivée du candidat confirmée' in h['summary'] for h in again.json()['history']) == 1
    # Compte rendu : jamais avant l'heure ; puis présent avec la grille commune, jamais « absent » après une arrivée.
    assert client.post(f'{STAFF}/interviews/{interview_id}/outcome', headers=securite, json={'attendance': 'present'}).status_code == 409
    row = db.get(Interview, interview_id)
    row.starts_at = engage.now_local() - timedelta(minutes=5)
    db.commit()
    assert client.post(f'{STAFF}/interviews/{interview_id}/outcome', headers=securite, json={'attendance': 'absent'}).status_code == 409
    assert client.post(f'{STAFF}/interviews/{interview_id}/outcome', headers=securite,
                       json={'attendance': 'present', 'scores': {'inconnu': 4}}).status_code == 422
    report = client.post(f'{STAFF}/interviews/{interview_id}/outcome', headers=securite, json={
        'attendance': 'present', 'appreciation': 'Favorable', 'report': 'Bon échange', 'scores': {'profil': 8, 'motivation': 6, 'communication': None}})
    assert report.status_code == 200, report.text
    staff = report.json()['interviews'][0]
    assert staff['status'] == 'done' and staff['assessment'] == {'scores': {'profil': 8, 'motivation': 6}, 'scale': 10, 'average': 7.0,
                                                                  'criteria': list(conv.CRITERIA)}
    assert report.json()['outcome'] == 'pending'                                                         # pas de décision automatique
    mine = client.get(f'{API}/interviews/{interview_id}', headers=headers).json()
    assert mine['convocation']['state'] == 'done' and 'Bon échange' not in json.dumps(mine) and 'profil' not in json.dumps(mine)
    assert client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': f"{mine['convocation']['reference']}"}).json()['state'] == 'closed'


def test_cancellation_is_visible_everywhere_and_withdraws_confirmation(client, db, securite):
    headers, application_id, _ = setup_application(client, securite)
    interview_id = convoke(client, securite, application_id).json()['interview_id']
    token = db.query(Version).filter(Version.interview_id == interview_id).one().token
    assert client.post(f'{STAFF}/interviews/{interview_id}/cancel', headers=securite).status_code == 200
    mine = client.get(f'{API}/interviews/{interview_id}', headers=headers).json()
    assert mine['convocation']['state'] == 'cancelled' and mine['convocation']['can_confirm'] is False and 'qr' not in mine['convocation']
    assert client.post(f'{API}/interviews/{interview_id}/confirm', headers=headers).status_code == 409
    assert client.get(f'{API}/interviews/{interview_id}/convocation', headers=headers).status_code == 409
    scanned = client.post(f'{STAFF}/convocations/resolve', headers=securite, json={'code': conv.qr_url(token)}).json()
    assert scanned['state'] == 'cancelled' and scanned['can_confirm_arrival'] is False
    assert client.post(f'{STAFF}/interviews/{interview_id}/arrival', headers=securite, json={'version': 1}).status_code == 409
    assert [n['title'] for n in candidate_notifications(client, headers)] == ['Entretien annulé', 'Convocation à un entretien']
    # Les versions restent consultables par le recruteur (historique), avec leur état.
    assert client.get(f'{STAFF}/interviews/{interview_id}/convocation?version=1', headers=securite).status_code == 200
    staff = client.get(f'{STAFF}/applications/{application_id}', headers=securite).json()['interviews'][0]
    assert [v['state'] for v in staff['versions']] == ['cancelled'] and 'annulé' in staff['candidate_state_label'].lower()


def test_one_identity_several_applications_each_convocation_stays_on_its_application(client, db, securite, solution):
    offer = publish(client, securite)
    other_offer = publish(client, solution, society=SOLUTION, title='Cariste')
    headers, _ = session(client)
    first = apply(client, headers, offer['id']).json()['application_id']
    second = apply(client, headers, other_offer['id']).json()['application_id']
    spontaneous = apply(client, headers).json()['application_id']
    assert len({db.get(Application, i).candidate_id for i in (first, second, spontaneous)}) == 1           # une seule identité
    interview_id = convoke(client, securite, first).json()['interview_id']
    assert client.get(f'{STAFF}/applications/{second}', headers=solution).json()['stage'] == 'received'
    assert client.get(f'{API}/applications/{second}', headers=headers).json()['state']['status'] == 'received'
    # Spontanée : la société qui convoque est choisie dans le périmètre du recruteur ; jamais hors périmètre.
    assert convoke(client, securite, spontaneous, society=SOLUTION).status_code == 422
    defaults = client.get(f'{STAFF}/applications/{spontaneous}', headers=securite).json()['convocation_defaults']
    assert defaults['society_fixed'] is False and [c['society'] for c in defaults['societies']] == [SECURITE]
    spontaneous_id = convoke(client, securite, spontaneous, society=SECURITE).json()['interview_id']
    scanned = client.post(f'{STAFF}/convocations/resolve', headers=securite, json={
        'code': conv.qr_url(db.query(Version).filter(Version.interview_id == spontaneous_id).one().token)}).json()
    assert (scanned['application_id'], scanned['interview_id']) == (spontaneous, spontaneous_id)
    assert {i['application_id'] for i in client.get(f'{API}/interviews', headers=headers).json()['items']} == {first, spontaneous}
    assert interview_id != spontaneous_id


def test_historical_dossier_without_space_is_told_and_gets_a_pdf_without_any_account_created(client, db, securite):
    headers, application_id, _ = setup_application(client, securite)
    application = db.get(Application, application_id)
    application.account_id = None                                                                       # dossier sans espace candidat
    db.commit()
    accounts_before = db.execute(__import__('sqlalchemy').text('select count(*) from recruitment_candidate_accounts')).scalar()
    sent = convoke(client, securite, application_id)
    assert sent.status_code == 201 and 'n’a pas d’espace IRON Emploi' in sent.json()['channels'][0]
    assert sent.json()['convocation_defaults']['has_account'] is False
    assert db.query(Notification).filter(Notification.interview_id == sent.json()['interview_id']).count() == 0
    assert client.get(f"{STAFF}/interviews/{sent.json()['interview_id']}/convocation", headers=securite).status_code == 200
    assert db.execute(__import__('sqlalchemy').text('select count(*) from recruitment_candidate_accounts')).scalar() == accounts_before


def test_read_only_recruiter_sees_but_cannot_send_change_or_confirm(client, db, securite):
    headers, application_id, _ = setup_application(client, securite)
    interview_id = convoke(client, securite, application_id).json()['interview_id']
    db.add(User(username='rec_lecture', email='rec_lecture@test.com', full_name='Lecture', role='recruteur', access_level='H3',
                authorized_societies=[SECURITE], authorized_structures=[], authorized_modules=['recrute'], authorized_actions=['read'],
                password_hash=hash_password('testpass123'), validation_password_hash=hash_password('x'), is_active=True))
    db.commit()
    token = client.post('/api/auth/login', json={'username': 'rec_lecture', 'password': 'testpass123'}).json()['access_token']
    reader = {'Authorization': f'Bearer {token}'}
    try:
        assert client.get(f'{STAFF}/applications/{application_id}', headers=reader).status_code == 200
        assert client.get(f'{STAFF}/interviews/{interview_id}/convocation', headers=reader).status_code == 200
        # Lire un QR est une consultation : permis en lecture seule, mais sans pouvoir confirmer l'arrivée.
        token = db.query(Version).filter(Version.interview_id == interview_id).one().token
        scanned = client.post(f'{STAFF}/convocations/resolve', headers=reader, json={'code': conv.qr_url(token)})
        assert scanned.status_code == 200 and scanned.json()['interview_id'] == interview_id
        for path, body in ((f'/applications/{application_id}/interviews', {**FORM, 'starts_at': when(4).isoformat()}),
                           (f'/interviews/{interview_id}/send', None), (f'/interviews/{interview_id}/cancel', None),
                           (f'/interviews/{interview_id}/arrival', {'version': 1}),
                           (f'/interviews/{interview_id}/outcome', {'attendance': 'present'})):
            assert client.post(f'{STAFF}{path}', headers=reader, json=body).status_code == 403, path
        assert client.put(f'{STAFF}/interviews/{interview_id}', headers=reader, json={**FORM, 'starts_at': when(4).isoformat()}).status_code == 403
    finally:
        db.query(User).filter(User.username == 'rec_lecture').delete()
        db.commit()


def test_unprintable_characters_stop_the_sending_instead_of_printing_squares(client, db, securite):
    headers, application_id, _ = setup_application(client, securite)
    refused = convoke(client, securite, application_id, location='Salle 漢字')
    assert refused.status_code == 422 and '漢' in refused.json()['detail']
    assert db.query(Interview).filter(Interview.application_id == application_id).count() == 0           # rien d'envoyé, rien d'enregistré
    assert candidate_notifications(client, headers) == []


def test_a_failing_push_never_cancels_a_sent_convocation_and_targets_only_this_candidate(client, db, securite, monkeypatch):
    headers, application_id, _ = setup_application(client, securite)
    other, _ = session(client, phone='0661122334', first_name='Karim', last_name='Emploi-Deux')
    client.put(f'{API}/me/push-device', headers=headers, json={'token': 'ExponentPushToken[nadia-convocation]', 'platform': 'android'})
    client.put(f'{API}/me/push-device', headers=other, json={'token': 'ExponentPushToken[karim-convocation]', 'platform': 'android'})
    monkeypatch.setenv('RECRUITMENT_PUSH_ENABLED', 'true')

    def down(*args):
        raise TimeoutError()
    monkeypatch.setattr(worker, 'post', down)
    sent = convoke(client, securite, application_id)
    assert sent.status_code == 201 and not any('push' in line.lower() for line in sent.json()['channels'])
    interview_id = sent.json()['interview_id']
    assert client.get(f'{API}/interviews/{interview_id}', headers=headers).json()['convocation']['state'] == 'new'
    # Convocation et changement d'état de la candidature : en file pour le seul téléphone de ce candidat, reprise programmée.
    queued = db.query(Delivery).all()
    assert queued and all(row.state == 'pending' and row.attempts == 1 for row in queued)
    assert {db.get(Device, row.device_id).token for row in queued} == {'ExponentPushToken[nadia-convocation]'}
    assert interview_id in {db.get(Notification, row.notification_id).interview_id for row in queued}


def test_legacy_interview_without_version_can_receive_its_document_once(client, db, securite):
    headers, application_id, _ = setup_application(client, securite)
    legacy = Interview(application_id=application_id, starts_at=when(3), location='Siège', status='proposed', created_by='ancien')
    db.add(legacy)
    db.commit()
    item = client.get(f'{API}/interviews', headers=headers).json()['items'][0]
    assert item['id'] == legacy.id and item['convocation'] is None                                       # ancien entretien : pas de document
    sent = client.post(f'{STAFF}/interviews/{legacy.id}/send', headers=securite)
    assert sent.status_code == 200 and sent.json()['interviews'][0]['version'] == 1
    assert client.get(f'{API}/interviews/{legacy.id}/convocation', headers=headers).status_code == 200
