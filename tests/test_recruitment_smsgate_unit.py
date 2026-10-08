"""File d'envoi SMSGate : idempotence, relances bornées, états accepté / envoyé / livré."""
import hashlib
import hmac
import json
import re

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.base import Base
from app.modules import recruitment_sms_service as sms
from app.modules import recruitment_smsgate as smsgate
from app.modules.recruitment_sms_models import RecruitmentSMSChallenge as Challenge

SECRET = 'test-only-secret-not-for-production-1234567890'
NOW = 2000000000
ENV = {'RECRUITMENT_SMSGATE_API_URL': 'https://sms.example.test/api/3rdparty/v1', 'RECRUITMENT_SMSGATE_USERNAME': 'gateway-user',
       'RECRUITMENT_SMSGATE_PASSWORD': 'test-only-password'}


class FakeGateway:
    def __init__(self, *replies):
        self.replies, self.sent, self.states = list(replies), [], {}

    def send(self, message_id, phone, text, ttl):
        self.sent.append({'id': message_id, 'phone': phone, 'text': text, 'ttl': ttl})
        return self.replies.pop(0) if self.replies else smsgate.GatewayReply('accepted', 'accepted')

    def state(self, message_id):
        return self.states.get(message_id, smsgate.GatewayReply('retry', error='gateway_unreachable'))


@pytest.fixture
def db():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def request(db, phone='0550001122', now=NOW):
    return sms.request_code(db, SECRET, 'Nadia', 'Portail', phone, '127.0.0.1', now=now)


def row(db, challenge):
    db.expire_all()
    return db.get(Challenge, challenge['challenge_id'])


def configure(monkeypatch, **extra):
    for name in ('DEVICE_ID', 'SIM_NUMBER', 'PRIORITY', 'TIMEOUT_SECONDS', 'WEBHOOK_SIGNING_KEY', 'ALLOW_HTTP'):
        monkeypatch.delenv('RECRUITMENT_SMSGATE_' + name, raising=False)
    for name, value in {**ENV, **extra}.items():
        monkeypatch.setenv(name, value)
    return smsgate.load_config()


def test_configuration_requires_https_and_credentials(monkeypatch):
    assert configure(monkeypatch).api_url == ENV['RECRUITMENT_SMSGATE_API_URL']
    assert configure(monkeypatch, RECRUITMENT_SMSGATE_PASSWORD='') is None
    assert configure(monkeypatch, RECRUITMENT_SMSGATE_API_URL='http://sms.example.test/api/3rdparty/v1') is None
    assert configure(monkeypatch, RECRUITMENT_SMSGATE_API_URL='https://user:pass@sms.example.test/api') is None
    assert configure(monkeypatch, RECRUITMENT_SMSGATE_SIM_NUMBER='4') is None
    internal = configure(monkeypatch, RECRUITMENT_SMSGATE_API_URL='http://sms-gateway:3000/api/3rdparty/v1', RECRUITMENT_SMSGATE_ALLOW_HTTP='true')
    assert internal is not None and internal.priority == 100


def test_client_sends_idempotent_request_to_selected_sim(monkeypatch):
    config = configure(monkeypatch, RECRUITMENT_SMSGATE_DEVICE_ID='device-0000000000000001', RECRUITMENT_SMSGATE_SIM_NUMBER='2')
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(202, json={'id': 'msg-1', 'state': 'Pending', 'recipients': [{'phoneNumber': '+213550001122', 'state': 'Pending'}]})

    reply = smsgate.SMSGateClient(config, httpx.MockTransport(handler)).send('msg-1', '+213550001122', 'texte', 120)
    assert (reply.outcome, reply.state) == ('accepted', 'accepted')
    body = json.loads(seen[0].content)
    assert str(seen[0].url) == 'https://sms.example.test/api/3rdparty/v1/messages'
    assert seen[0].headers['authorization'].startswith('Basic ')
    assert body == {'id': 'msg-1', 'phoneNumbers': ['+213550001122'], 'textMessage': {'text': 'texte'}, 'ttl': 120,
                    'withDeliveryReport': True, 'priority': 100, 'deviceId': 'device-0000000000000001', 'simNumber': 2}


@pytest.mark.parametrize('status,outcome', [(409, 'accepted'), (503, 'retry'), (429, 'retry'), (401, 'rejected'), (400, 'rejected')])
def test_client_maps_gateway_answers(monkeypatch, status, outcome):
    client = smsgate.SMSGateClient(configure(monkeypatch), httpx.MockTransport(lambda req: httpx.Response(status, json={'message': 'x'})))
    assert client.send('msg-1', '+213550001122', 'texte', 120).outcome == outcome


def test_client_timeout_is_an_unknown_outcome_and_health_needs_the_device(monkeypatch):
    def timeout(req):
        raise httpx.ReadTimeout('timeout', request=req)

    config = configure(monkeypatch, RECRUITMENT_SMSGATE_DEVICE_ID='device-1')
    assert smsgate.SMSGateClient(config, httpx.MockTransport(timeout)).send('m', '+213550001122', 't', 60) == smsgate.GatewayReply('retry', error='gateway_timeout')
    assert smsgate.SMSGateClient(config, httpx.MockTransport(timeout)).healthy() is False
    assert smsgate.SMSGateClient(config, httpx.MockTransport(lambda req: httpx.Response(200, json=[{'id': 'other'}]))).healthy() is False
    assert smsgate.SMSGateClient(config, httpx.MockTransport(lambda req: httpx.Response(200, json=[{'id': 'device-1'}]))).healthy() is True
    assert smsgate.SMSGateClient(config, httpx.MockTransport(lambda req: httpx.Response(401, json={}))).healthy() is False


def test_client_reads_message_state_and_device_error(monkeypatch):
    answer = {'id': 'm', 'state': 'Failed', 'recipients': [{'phoneNumber': '+213550001122', 'state': 'Failed', 'error': 'RESULT_ERROR_NO_SERVICE'}]}
    client = smsgate.SMSGateClient(configure(monkeypatch), httpx.MockTransport(lambda req: httpx.Response(200, json=answer)))
    assert client.state('m') == smsgate.GatewayReply('accepted', 'failed', 'RESULT_ERROR_NO_SERVICE')


def test_accepted_is_not_reported_as_sent_or_delivered(db):
    challenge = request(db)
    gateway = FakeGateway()
    assert sms.dispatch_pending(db, SECRET, gateway, now=NOW + 1) == 1
    saved = row(db, challenge)
    assert (saved.delivery_status, saved.accepted_at, saved.sent_at, saved.delivered_at) == ('accepted', NOW + 1, None, None)
    assert saved.sms_ciphertext == '' and saved.status == 'queued'
    assert sms.delivery_state(db, challenge['challenge_id']) == {'delivery': 'accepted'}
    job = gateway.sent[0]
    assert job['phone'] == '+213550001122' and job['ttl'] == sms.CODE_TTL - 1
    assert re.fullmatch(r'[0-9a-f]{32}', job['id']) and job['id'] != challenge['challenge_id']
    # Rien d'autre à envoyer : pas de second SMS pour la même demande.
    assert sms.dispatch_pending(db, SECRET, gateway, now=NOW + 60) == 0
    assert len(gateway.sent) == 1


def test_code_stays_verifiable_after_acceptance_and_keeps_its_limits(db):
    challenge = request(db)
    gateway = FakeGateway()
    sms.dispatch_pending(db, SECRET, gateway, now=NOW)
    code = re.search(r'\b\d{6}\b', gateway.sent[0]['text'])[0]
    with pytest.raises(sms.SMSProblem):
        sms.verify_code(db, SECRET, challenge['challenge_id'], code, now=NOW + sms.CODE_TTL)
    verified = sms.verify_code(db, SECRET, challenge['challenge_id'], code, now=NOW + 10)
    assert sms.identity(db, SECRET, verified['access_token'], now=NOW + 11).phone == '+213550001122'
    # Un accusé tardif ne rouvre pas le code et ne change pas l'état « vérifié ».
    assert sms.apply_gateway_state(db, gateway.sent[0]['id'], 'delivered', now=NOW + 12) is True
    assert row(db, challenge).status == 'verified'
    with pytest.raises(sms.SMSProblem):
        sms.verify_code(db, SECRET, challenge['challenge_id'], code, now=NOW + 13)


def test_retry_reuses_the_same_message_id_with_backoff(db):
    challenge = request(db)
    gateway = FakeGateway(smsgate.GatewayReply('retry', error='gateway_timeout'), smsgate.GatewayReply('accepted'))
    sms.dispatch_pending(db, SECRET, gateway, now=NOW)
    saved = row(db, challenge)
    assert (saved.delivery_status, saved.delivery_error, saved.next_attempt_at) == ('queued', 'gateway_timeout', NOW + 5)
    assert saved.sms_ciphertext != ''
    assert sms.dispatch_pending(db, SECRET, gateway, now=NOW + 4) == 0
    assert sms.dispatch_pending(db, SECRET, gateway, now=NOW + 5) == 1
    assert gateway.sent[0]['id'] == gateway.sent[1]['id']
    assert (row(db, challenge).delivery_status, row(db, challenge).send_attempts) == ('accepted', 2)


def test_attempts_are_bounded_then_marked_failed(db):
    challenge = request(db)
    gateway = FakeGateway(*[smsgate.GatewayReply('retry', error='gateway_http_503')] * 5)
    for offset in (0, 5, 20, 60, 120):
        sms.dispatch_pending(db, SECRET, gateway, now=NOW + offset)
    saved = row(db, challenge)
    assert len(gateway.sent) == sms.MAX_SEND_ATTEMPTS
    assert (saved.delivery_status, saved.delivery_error, saved.sms_ciphertext) == ('failed', 'gateway_http_503', '')
    assert sms.delivery_state(db, challenge['challenge_id']) == {'delivery': 'failed'}


def test_permanent_rejection_is_not_retried(db):
    challenge = request(db)
    gateway = FakeGateway(smsgate.GatewayReply('rejected', error='gateway_auth'))
    sms.dispatch_pending(db, SECRET, gateway, now=NOW)
    sms.dispatch_pending(db, SECRET, gateway, now=NOW + 30)
    assert len(gateway.sent) == 1
    assert (row(db, challenge).delivery_status, row(db, challenge).delivery_error) == ('failed', 'gateway_auth')


def test_interrupted_send_is_replayed_with_the_same_id_after_the_lease(db):
    challenge = request(db)

    class Crash(FakeGateway):
        def send(self, *args):
            super().send(*args)
            raise RuntimeError('worker tué pendant l’appel')

    crashed = Crash()
    with pytest.raises(RuntimeError):
        sms.dispatch_pending(db, SECRET, crashed, now=NOW)
    db.rollback()
    assert row(db, challenge).delivery_status == 'sending'
    gateway = FakeGateway()
    assert sms.dispatch_pending(db, SECRET, gateway, now=NOW + sms.SEND_LEASE) == 0
    assert sms.dispatch_pending(db, SECRET, gateway, now=NOW + sms.SEND_LEASE + 1) == 1
    # Même identifiant : si le premier appel avait abouti, SMSGate répond 409 et n'envoie rien de plus.
    assert gateway.sent[0]['id'] == crashed.sent[0]['id']
    assert row(db, challenge).delivery_status == 'accepted'


def test_expiring_or_replaced_codes_are_never_sent(db):
    first = request(db)
    second = request(db, now=NOW + sms.RESEND_DELAY)
    gateway = FakeGateway()
    assert sms.dispatch_pending(db, SECRET, gateway, now=NOW + sms.RESEND_DELAY) == 1
    assert row(db, first).delivery_status == 'queued' and row(db, first).status == 'expired'
    assert row(db, second).delivery_status == 'accepted'
    late = request(db, phone='0660001122')
    assert sms.dispatch_pending(db, SECRET, gateway, now=NOW + sms.CODE_TTL - sms.MIN_REMAINING) == 0
    assert (row(db, late).delivery_status, row(db, late).sms_ciphertext) == ('expired', '')
    assert len(gateway.sent) == 1


def test_tracking_only_moves_forward(db):
    challenge = request(db)
    gateway = FakeGateway()
    sms.dispatch_pending(db, SECRET, gateway, now=NOW)
    message_id = gateway.sent[0]['id']
    assert sms.track_deliveries(db, gateway, now=NOW + 1) == 0          # trop tôt pour réinterroger
    gateway.states[message_id] = smsgate.GatewayReply('accepted', 'accepted')
    assert sms.track_deliveries(db, gateway, now=NOW + 3) == 1
    assert row(db, challenge).delivery_status == 'accepted'
    gateway.states[message_id] = smsgate.GatewayReply('accepted', 'sent')
    sms.track_deliveries(db, gateway, now=NOW + 6)
    saved = row(db, challenge)
    assert (saved.delivery_status, saved.sent_at, saved.delivered_at) == ('sent', NOW + 6, None)
    assert sms.delivery_state(db, challenge['challenge_id']) == {'delivery': 'sent'}
    assert sms.apply_gateway_state(db, message_id, 'delivered', now=NOW + 9) is True
    assert sms.apply_gateway_state(db, message_id, 'sent', now=NOW + 10) is False      # événement rejoué
    assert sms.apply_gateway_state(db, message_id, 'failed', 'late', now=NOW + 11) is False
    saved = row(db, challenge)
    assert (saved.delivery_status, saved.sent_at, saved.delivered_at) == ('delivered', NOW + 6, NOW + 9)
    assert sms.track_deliveries(db, gateway, now=NOW + 60) == 0         # état final : plus de sondage
    assert sms.apply_gateway_state(db, 'unknown-message', 'sent', now=NOW) is False


def test_device_failure_is_recorded_and_tracking_stops_after_the_window(db):
    failed, silent = request(db), request(db, phone='0660001122')
    gateway = FakeGateway()
    sms.dispatch_pending(db, SECRET, gateway, now=NOW)
    gateway.states[gateway.sent[0]['id']] = smsgate.GatewayReply('accepted', 'failed', 'RESULT_ERROR_NO_SERVICE')
    sms.track_deliveries(db, gateway, now=NOW + 3)
    assert (row(db, failed).delivery_status, row(db, failed).delivery_error) == ('failed', 'RESULT_ERROR_NO_SERVICE')
    # Passerelle muette : l'état reste « accepté », jamais promu en envoyé ou livré.
    assert sms.track_deliveries(db, gateway, now=NOW + sms.TRACK_WINDOW) == 0
    assert row(db, silent).delivery_status == 'accepted'


def test_webhook_signature_and_replay_window():
    key, body, stamp = 'test-only-signing-key', b'{"event":"sms:sent"}', str(NOW)
    good = hmac.new(key.encode(), body + stamp.encode(), hashlib.sha256).hexdigest()
    assert smsgate.verify_webhook(key, body, stamp, good, NOW + 10) is True
    assert smsgate.verify_webhook(key, body + b' ', stamp, good, NOW) is False
    assert smsgate.verify_webhook('other-key', body, stamp, good, NOW) is False
    assert smsgate.verify_webhook(key, body, stamp, good, NOW + smsgate.WEBHOOK_TOLERANCE + 1) is False
    assert smsgate.verify_webhook(key, body, None, good, NOW) is False
    assert smsgate.verify_webhook('', body, stamp, good, NOW) is False
