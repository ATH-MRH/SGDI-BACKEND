"""Passerelle SMS locale de l'environnement d'essai : elle reste à l'écoute pour que le serveur accepte
d'émettre des codes (il les refuse si aucune passerelle ne s'est manifestée depuis 90 secondes), et note
chaque code reçu dans un fichier local au lieu de l'envoyer. Elle n'existe pas en production (SMSGate)."""
import json, os, re, sys, time, urllib.request

port, log = sys.argv[1], sys.argv[2]
base = f'http://127.0.0.1:{port}/api/public/mobile/gateway/'


def call(path, body):
    request = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json', 'X-SMS-Gateway-Key': os.environ['RECRUITMENT_SMS_GATEWAY_KEY']})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read() or 'null')


while True:
    try:
        job = (call('poll', {}) or {}).get('job')
        if job:
            call('ack', {'job_id': job['id'], 'lease_token': job['lease_token'], 'sent': True})
            code = re.search(r'\b\d{6}\b', job['message'])
            with open(log, 'a') as out:
                out.write(f"{time.strftime('%H:%M:%S')}  {job.get('phone') or job.get('to') or ''}  code {code[0] if code else '?'}\n")
            continue
    except Exception:  # noqa: BLE001 — serveur arrêté ou en redémarrage : on réessaie
        pass
    time.sleep(3)
