"""IRON Emploi : suivi de la dernière activité et aperçu des dossiers arrivés à échéance (lecture seule)."""
from datetime import date, datetime, timedelta

import pytest

from app.core.security import hash_password
from app.modules import recruitment_jobs_service as jobs
from app.modules import recruitment_retention as retention
from app.modules.auth.models import User
from app.modules.drh.models import Candidate, Employee
from app.modules.recruitment_engage_models import (
    RecruitmentConvocationVersion, RecruitmentInterview, RecruitmentMessage, RecruitmentNotification, RecruitmentPushDelivery, RecruitmentPushDevice,
)
from app.modules.recruitment_jobs_models import RecruitmentApplication, RecruitmentCandidateAccount, RecruitmentCandidateSession

TODAY = date(2030, 3, 15)
USERS = ['ret_global', 'ret_local', 'ret_ops']


@pytest.fixture(autouse=True)
def clean(db):
    yield
    db.rollback()
    for model in (RecruitmentConvocationVersion, RecruitmentInterview, RecruitmentPushDelivery, RecruitmentPushDevice, RecruitmentNotification, RecruitmentMessage, RecruitmentApplication, RecruitmentCandidateSession, RecruitmentCandidateAccount):
        db.query(model).delete()
    db.query(Employee).filter(Employee.code.like('RET-%')).delete(synchronize_session=False)
    db.query(Candidate).filter(Candidate.last_name.like('Retention%')).delete(synchronize_session=False)
    db.query(User).filter(User.username.in_(USERS)).delete(synchronize_session=False)
    db.commit()


def _login(client, db, username, *, global_access=False, modules=('recrute',)):
    db.add(User(username=username, email=f'{username}@test.com', full_name=username, role='recruteur', access_level='H3',
                authorized_societies=['Iron Global Securite'], authorized_structures=[], authorized_modules=list(modules),
                global_society_access=global_access, password_hash=hash_password('testpass123'),
                validation_password_hash=hash_password('x'), is_active=True))
    db.commit()
    response = client.post('/api/auth/login', json={'username': username, 'password': 'testpass123'})
    assert response.status_code == 200, response.text
    return {'Authorization': 'Bearer ' + response.json()['access_token']}


def _candidate(db, name, **fields):
    row = Candidate(first_name='Test', last_name=f'Retention {name}', phone='+213550000000', society='Iron Global Securite', **fields)
    db.add(row)
    db.flush()
    return row


def _application(db, candidate, request_id, **fields):
    row = RecruitmentApplication(candidate_id=candidate.id, request_id=request_id, position='Agent', **fields)
    db.add(row)
    db.flush()
    return row


def _account(db, phone, **fields):
    row = RecruitmentCandidateAccount(phone=phone, first_name='Test', last_name='Retention', profile={}, **fields)
    db.add(row)
    db.flush()
    return row


def test_months_before_handles_month_ends():
    assert retention.months_before(date(2030, 3, 15), 24) == date(2028, 3, 15)
    assert retention.months_before(date(2028, 2, 29), 24) == date(2026, 2, 28)
    assert retention.months_before(date(2030, 1, 31), 2) == date(2029, 11, 30)


def test_report_lists_only_what_is_due_and_deletes_nothing(db):
    old, recent = datetime(2028, 3, 15, 9), datetime(2028, 3, 16, 9)
    due = _application(db, _candidate(db, 'A'), 'ret-due', outcome='unfavorable', outcome_communicated_at=old,
                       profile_snapshot={'first_name': 'Test', 'data': {'adresse': 'Adresse figée A'}})
    db.add(RecruitmentMessage(application_id=due.id, sender='recruiter', body='Bonjour', client_id='ret-message-1', created_at=old))
    # Convocation reportée une fois : deux versions envoyées, qui partiraient avec la candidature.
    convoked = RecruitmentInterview(application_id=due.id, starts_at=old, location='Siège', status='cancelled', version=2)
    db.add(convoked)
    db.flush()
    db.add_all([RecruitmentConvocationVersion(interview_id=convoked.id, version=n, token=f'retention-token-{n}-0123456789abcdefg', snapshot={})
                for n in (1, 2)])
    _application(db, _candidate(db, 'B'), 'ret-recent', outcome='unfavorable', outcome_communicated_at=recent)
    _application(db, _candidate(db, 'C'), 'ret-pending', outcome='pending', status_updated_at=old)
    _application(db, _candidate(db, 'D'), 'ret-favorable', outcome='favorable', outcome_communicated_at=old)

    idle = _account(db, '+213550000001', last_activity_at=old, cv_meta={'name': 'cv.pdf'})
    notification = RecruitmentNotification(account_id=idle.id, kind='offers', title='Offre', body='Nouvelle offre', dedup='ret-1', created_at=old)
    device = RecruitmentPushDevice(account_id=idle.id, token='ExponentPushToken[retention]', platform='android')
    db.add_all([notification, device])
    db.flush()
    db.add(RecruitmentPushDelivery(notification_id=notification.id, device_id=device.id))
    # Une candidature transmise avec sa copie du profil, et une ancienne sans copie (JSON null) : seule la première compte.
    kept_application = _application(db, _candidate(db, 'E'), 'ret-kept', account_id=idle.id,
                                    profile_snapshot={'first_name': 'Test', 'data': {'adresse': 'Adresse figée E'}})
    db.add_all([RecruitmentInterview(application_id=kept_application.id, starts_at=old, location='Siège', status='done', version=1),
                RecruitmentInterview(application_id=kept_application.id, starts_at=old, location='Siège', status='draft', version=0)])
    _application(db, _candidate(db, 'E2'), 'ret-kept-legacy', account_id=idle.id, profile_snapshot=None)
    _account(db, '+213550000002', last_activity_at=recent)

    _candidate(db, 'F', data={'avisDecision': 'Défavorable', 'avisDate': '2027-06-01'})
    _candidate(db, 'G', data={'avisDecision': 'Défavorable'})
    _candidate(db, 'H', data={'avisDecision': 'Défavorable', 'avisDate': '2029-06-01'})
    for code, status, extra in (('RET-1', 'demissionne', {'dateSortie': '2027-01-10'}), ('RET-2', 'sortant', {}), ('RET-3', 'actif', {'dateSortie': '2020-01-01'})):
        employee = Employee(code=code, first_name='Test', last_name='Retention', society='Iron Global Securite', status=status, extra=extra)
        db.add(employee)
        db.flush()
        _candidate(db, code, status='embauche', data={'convertedEmployeeId': employee.id})
    db.commit()
    before = {model.__tablename__: db.query(model).count() for model in (
        Candidate, Employee, RecruitmentApplication, RecruitmentCandidateAccount, RecruitmentMessage, RecruitmentNotification)}

    report = retention.retention_report(db, TODAY)
    # La base de test est partagée : seuls les dossiers créés ici sont contrôlés.
    mine = lambda section: [item for item in report[section] if item['name'].startswith('Retention ')]  # noqa: E731

    assert report['dry_run'] is True and report['due_before'] == '2028-03-15' and report['retention_months'] == 24
    assert [item['application_id'] for item in report['declined_applications']] == [due.id]
    assert report['declined_applications'][0]['would_delete'] == {
        'application': 1, 'profile_snapshot': 1, 'documents': 0, 'messages': 1, 'interviews': 1, 'notes': 0, 'events': 0, 'document_requests': 0, 'contracts': 0,
        'convocation_versions': 2}
    assert report['declined_applications'][0]['basis'] == 'refus communiqué'
    application = report['declined_applications'][0]
    assert (application['name'], application['society'], application['reference_on'], application['due_on']) == (
        'Retention A Test', 'Iron Global Securite', '2028-03-15', '2030-03-15')
    assert report['simulated'] is True and retention.retention_report(db)['simulated'] is False
    # L'aperçu ne porte que des identités, des dates et des décomptes : ni téléphone, ni contenu de pièce ou de message.
    assert 'Bonjour' not in str(report) and '+21355' not in str(report) and 'cv.pdf' not in str(report) and 'Adresse figée' not in str(report)
    assert [item['account_id'] for item in report['inactive_accounts']] == [idle.id]
    account = report['inactive_accounts'][0]
    assert account['would_delete'] == {'account': 1, 'cv': 1, 'photo': 0, 'alerts': 0, 'notifications': 1, 'push_deliveries': 1, 'push_devices': 1,
                                       'sessions': 0}
    # Les copies du profil restent avec les candidatures transmises, et la raison est donnée.
    # Seule la convocation envoyée compte ; le brouillon jamais envoyé n'est pas une convocation conservée.
    assert account['would_keep'] == {'applications_detached': 2, 'profile_snapshots': 1, 'convocations': 1} and account['basis'] == 'dernière activité'
    assert account['would_keep_reason'] == retention.KEPT_WITH_APPLICATIONS and '24 mois après un refus communiqué' in account['would_keep_reason']
    assert (account['reference_on'], account['due_on']) == ('2028-03-15', '2030-03-15')
    assert [item['name'] for item in mine('declined_dossiers')] == ['Retention F Test']
    assert [(item['name'], item['employee_code']) for item in mine('departed_recruits')] == [('Retention RET-1 Test', 'RET-1')]
    assert sorted(item['reason'] for item in mine('undated')) == ['date de départ non enregistrée', 'date de l’avis défavorable non enregistrée']
    assert report['counts'] == {name: len(report[name]) for name in ('declined_applications', 'declined_dossiers', 'inactive_accounts', 'departed_recruits', 'undated')}
    after = {model.__tablename__: db.query(model).count() for model in (
        Candidate, Employee, RecruitmentApplication, RecruitmentCandidateAccount, RecruitmentMessage, RecruitmentNotification)}
    assert after == before


def test_endpoint_is_read_only_and_reserved_to_global_recruiters(client, db):
    _account(db, '+213550000003', last_activity_at=datetime(2020, 1, 1))
    db.commit()
    url = '/api/drh/recruitment-retention'
    assert client.get(url).status_code == 401 and 'counts' not in client.get(url).text
    assert client.get(url, headers=_login(client, db, 'ret_ops', modules=('ops',))).status_code == 403
    local = client.get(url, headers=_login(client, db, 'ret_local'))
    assert local.status_code == 403 and 'périmètre global' in local.json()['detail'] and set(local.json()) == {'detail'}
    headers = _login(client, db, 'ret_global', global_access=True)
    response = client.get(url, headers=headers, params={'as_of': '2030-03-15'})
    assert response.status_code == 200 and response.json()['counts']['inactive_accounts'] == 1 and response.json()['dry_run'] is True
    for method in (client.post, client.put, client.delete):
        assert method(url, headers=headers).status_code == 405
    assert db.query(RecruitmentCandidateAccount).count() == 1


def test_using_the_space_dates_the_last_activity_once_a_day_without_touching_updated_at(db):
    account = _account(db, '+213550000004')
    db.commit()
    token = 'jeton-de-session-de-test'
    db.add(RecruitmentCandidateSession(token_digest=jobs.digest('secret', 'emploi-session', token), account_id=account.id, created_at=0, expires_at=2**31 - 1))
    db.commit()
    assert account.last_activity_at is None and account.updated_at is None

    found = jobs.account_from_token(db, 'secret', token)
    first = found.last_activity_at
    assert first is not None and found.updated_at is None

    assert jobs.account_from_token(db, 'secret', token, lock=True).last_activity_at == first      # même journée : pas de réécriture
    account.last_activity_at = first - timedelta(days=2)
    db.commit()
    assert jobs.account_from_token(db, 'secret', token).last_activity_at > first - timedelta(seconds=1)
