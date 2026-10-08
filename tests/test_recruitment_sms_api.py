import re

GATEWAY_KEY = 'test-gateway-key-long-enough-not-for-production'


def identity(phone='0551122334'):
    return {'first_name': 'Nadia', 'last_name': 'Mobile', 'phone': phone}


def candidate(**updates):
    payload = {**identity(), 'email': 'verified.mobile@example.com', 'desired_position': 'Agent de sécurité', 'consent': True}
    payload.update(updates)
    return payload


def test_mobile_disabled_does_not_generate_or_expose_a_code(client, monkeypatch):
    monkeypatch.setenv('RECRUITMENT_SMS_ENABLED', 'false')
    assert client.get('/api/public/mobile/config').json()['sms_available'] is False
    response = client.post('/api/public/mobile/request-code', json=identity())
    assert response.status_code == 503
    assert 'code' not in response.json()
    assert client.post('/api/public/mobile/gateway/poll').status_code == 403


def test_verified_mobile_flow_and_single_submission(client, auth_headers, monkeypatch):
    monkeypatch.setenv('RECRUITMENT_SMS_ENABLED', 'true')
    monkeypatch.setenv('RECRUITMENT_SMS_PROVIDER', 'poll')
    monkeypatch.setenv('RECRUITMENT_SMS_GATEWAY_KEY', GATEWAY_KEY)
    gateway_headers = {'X-SMS-Gateway-Key': GATEWAY_KEY}
    assert client.post('/api/public/mobile/gateway/poll', headers=gateway_headers).status_code == 200
    assert client.get('/api/public/mobile/config').json()['sms_available'] is True
    issued = client.post('/api/public/mobile/request-code', json=identity())
    assert issued.status_code == 202, issued.text
    assert 'code' not in issued.json()
    assert client.post('/api/public/mobile/candidates', json=candidate()).status_code == 401
    assert client.post('/api/public/mobile/gateway/poll', headers={'X-SMS-Gateway-Key': 'wrong'}).status_code == 403
    job = client.post('/api/public/mobile/gateway/poll', headers=gateway_headers).json()['job']
    code = re.search(r'\b\d{6}\b', job['message'])[0]
    ack = client.post('/api/public/mobile/gateway/ack', headers=gateway_headers, json={'job_id': job['id'], 'lease_token': job['lease_token'], 'sent': True})
    assert ack.status_code == 200
    verified = client.post('/api/public/mobile/verify-code', json={'challenge_id': issued.json()['challenge_id'], 'code': code})
    assert verified.status_code == 200, verified.text
    candidate_headers = {'Authorization': 'Bearer ' + verified.json()['access_token']}
    assert client.get('/api/auth/me', headers=candidate_headers).status_code == 401
    profile = client.get('/api/public/mobile/identity', headers=candidate_headers)
    assert profile.status_code == 200
    assert profile.json()['phone'] == '+213551122334'
    changed = client.post('/api/public/mobile/candidates', headers=candidate_headers, json=candidate(last_name='Autre'))
    assert changed.status_code == 422
    result = client.post('/api/public/mobile/candidates', headers=candidate_headers, json=candidate())
    assert result.status_code == 201, result.text
    repeated = client.post('/api/public/mobile/candidates', headers=candidate_headers, json=candidate())
    assert repeated.status_code == 201
    assert repeated.json()['reference'] == result.json()['reference']
    rows = client.get('/api/drh/candidates', headers=auth_headers).json()
    saved = [row for row in rows if row['email'] == 'verified.mobile@example.com']
    assert len(saved) == 1
    assert saved[0]['data']['telephoneVerifie'] is True
    assert saved[0]['phone'] == '+213551122334'


SMSGATE_ENV = {'RECRUITMENT_SMS_ENABLED': 'true', 'RECRUITMENT_SMS_PROVIDER': 'smsgate',
               'RECRUITMENT_SMSGATE_API_URL': 'https://sms.example.test/api/3rdparty/v1', 'RECRUITMENT_SMSGATE_USERNAME': 'gateway-user',
               'RECRUITMENT_SMSGATE_PASSWORD': 'test-only-password', 'RECRUITMENT_SMSGATE_WEBHOOK_SIGNING_KEY': 'test-only-signing-key'}


class _Gateway:
    def __init__(self):
        self.sent = []

    def send(self, message_id, phone, text, ttl):
        from app.modules.recruitment_smsgate import GatewayReply
        self.sent.append((message_id, text))
        return GatewayReply('accepted', 'accepted')


def _signed(client, event, message_id, key='test-only-signing-key', **payload):
    import hashlib, hmac, json, time
    body = json.dumps({'deviceId': 'device-1', 'event': event, 'id': 'evt-1', 'webhookId': 'hook-1', 'payload': {'messageId': message_id, **payload}}).encode()
    stamp = str(int(time.time()))
    headers = {'X-Timestamp': stamp, 'X-Signature': hmac.new(key.encode(), body + stamp.encode(), hashlib.sha256).hexdigest(), 'Content-Type': 'application/json'}
    return client.post('/api/public/mobile/gateway/smsgate/webhook', content=body, headers=headers)


def test_smsgate_stays_unavailable_until_fully_configured(client, monkeypatch):
    for name, value in SMSGATE_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv('RECRUITMENT_SMSGATE_PASSWORD', '')
    assert client.get('/api/public/mobile/config').json()['sms_available'] is False
    assert client.post('/api/public/mobile/request-code', json=identity('0661122334')).status_code == 503
    assert _signed(client, 'sms:sent', 'x' * 32).status_code == 403


def test_smsgate_flow_distinguishes_accepted_sent_and_delivered(client, db, monkeypatch):
    from app.core.config import settings
    from app.modules import recruitment_sms_service as sms
    for name, value in SMSGATE_ENV.items():
        monkeypatch.setenv(name, value)
    # L'ancien protocole poll/ack est fermé quand SMSGate est le fournisseur.
    monkeypatch.setenv('RECRUITMENT_SMS_GATEWAY_KEY', GATEWAY_KEY)
    assert client.post('/api/public/mobile/gateway/poll', headers={'X-SMS-Gateway-Key': GATEWAY_KEY}).status_code == 403
    sms.mark_gateway_healthy(db)
    assert client.get('/api/public/mobile/config').json()['sms_available'] is True
    issued = client.post('/api/public/mobile/request-code', json=identity('0662233445'))
    assert issued.status_code == 202, issued.text
    assert issued.json()['status'] == 'queued' and 'code' not in issued.json()
    challenge = {'challenge_id': issued.json()['challenge_id']}
    assert client.post('/api/public/mobile/code-status', json=challenge).json() == {'delivery': 'pending'}
    gateway = _Gateway()
    assert sms.dispatch_pending(db, settings.jwt_secret, gateway) == 1
    message_id, text = gateway.sent[0]
    code = re.search(r'\b\d{6}\b', text)[0]
    assert client.post('/api/public/mobile/code-status', json=challenge).json() == {'delivery': 'accepted'}
    assert code not in client.post('/api/public/mobile/code-status', json=challenge).text
    assert _signed(client, 'sms:sent', message_id, key='wrong-key').status_code == 403
    assert client.post('/api/public/mobile/code-status', json=challenge).json() == {'delivery': 'accepted'}
    assert _signed(client, 'sms:sent', message_id).json() == {'status': 'recorded'}
    assert client.post('/api/public/mobile/code-status', json=challenge).json() == {'delivery': 'sent'}
    assert _signed(client, 'sms:delivered', message_id).json() == {'status': 'recorded'}
    assert _signed(client, 'sms:sent', message_id).json() == {'status': 'ignored'}
    assert _signed(client, 'sms:received', message_id).json() == {'status': 'ignored'}
    assert client.post('/api/public/mobile/code-status', json=challenge).json() == {'delivery': 'delivered'}
    verified = client.post('/api/public/mobile/verify-code', json={**challenge, 'code': code})
    assert verified.status_code == 200, verified.text
    assert verified.json()['identity']['phone'] == '+213662233445'
    assert client.post('/api/public/mobile/code-status', json={'challenge_id': 'x' * 32}).status_code == 404
