#!/bin/sh
# Affiche le code SMS en attente dans l'environnement d'essai.
# Ici le serveur n'envoie aucun SMS : il met le message en file pour une passerelle locale
# (fournisseur « poll »), et ce script joue cette passerelle avec la clé locale. En production le
# fournisseur est SMSGate : cette file n'existe pas et cette clé n'y est pas valable.
. "$(dirname "$0")/common.sh"
. "$STATE/env"
"$PYTHON" - "$PORT" <<'PY'
import json, os, re, sys, time, urllib.request
base = f'http://127.0.0.1:{sys.argv[1]}/api/public/mobile/gateway/'
def call(path, body):
    request = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'X-SMS-Gateway-Key': os.environ['RECRUITMENT_SMS_GATEWAY_KEY']})
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read() or 'null')
for _ in range(20):
    job = (call('poll', {}) or {}).get('job')
    if job:
        call('ack', {'job_id': job['id'], 'lease_token': job['lease_token'], 'sent': True})
        print('Code pour', job.get('phone') or job.get('to') or 'le numéro demandé', ':', re.search(r'\b\d{6}\b', job['message'])[0])
        break
    time.sleep(0.5)
else:
    print('Aucun code en attente. Demandez d’abord le code dans l’application, puis relancez cette commande.')
PY
