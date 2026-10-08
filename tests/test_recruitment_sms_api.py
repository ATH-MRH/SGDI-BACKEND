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
