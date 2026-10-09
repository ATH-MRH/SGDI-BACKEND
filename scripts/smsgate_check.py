"""Contrôle de la liaison ATLAS -> SMSGate, sans jamais afficher d'identifiant ni de code.

Lit les variables RECRUITMENT_SMSGATE_* de l'environnement (les mêmes que l'application).

    python -m scripts.smsgate_check status
    python -m scripts.smsgate_check register-webhooks https://atlas.example.com
    python -m scripts.smsgate_check send-test +213XXXXXXXXX
"""
import argparse
import secrets
import sys
import time

from app.modules.recruitment_sms_service import SMSProblem, normalize_phone
from app.modules.recruitment_smsgate import WEBHOOK_EVENTS, SMSGateClient, load_config

WEBHOOK_PATH = '/api/public/mobile/gateway/smsgate/webhook'
LABELS = {'accepted': 'accepté par la passerelle (pas encore envoyé)', 'processed': 'pris en charge par le téléphone',
          'sent': 'envoyé au réseau mobile', 'delivered': 'livré au destinataire', 'failed': 'échec'}


def status(client: SMSGateClient) -> int:
    devices = client.devices()
    if not devices:
        print("Serveur joignable et identifiants acceptés, mais aucun téléphone enregistré.")
        return 1
    for device in devices:
        marker = ' <- RECRUITMENT_SMSGATE_DEVICE_ID' if device.get('id') == client.config.device_id else ''
        print(f"Téléphone {device.get('id')} « {device.get('name') or ''} » — dernière connexion : {device.get('lastSeen')}{marker}")
        for sim in device.get('simCards') or []:
            print(f"    SIM n° {sim.get('simNumber')} — opérateur : {sim.get('carrierName') or '?'} — numéro : {sim.get('phoneNumber') or '?'}")
    if client.config.device_id and not client.healthy():
        print("Le téléphone indiqué par RECRUITMENT_SMSGATE_DEVICE_ID n'est pas enregistré sur ce serveur.")
        return 1
    print(f"SIM imposée par ATLAS : {client.config.sim_number or 'aucune (réglage de l’application Android)'}")
    print(f"Signature des webhooks : {'configurée' if client.config.webhook_key else 'non configurée (suivi par sondage uniquement)'}")
    return 0


def register_webhooks(client: SMSGateClient, base_url: str) -> int:
    if not base_url.startswith('https://'):
        print("L'adresse publique d'ATLAS doit commencer par https://")
        return 1
    failed = 0
    for event in WEBHOOK_EVENTS:
        code = client.register_webhook('atlas-recrutement-' + event.replace(':', '-'), base_url.rstrip('/') + WEBHOOK_PATH, event)
        print(f"{event} : {'enregistré' if code < 300 else f'refusé (HTTP {code})'}")
        failed += code >= 300
    return 1 if failed else 0


def send_test(client: SMSGateClient, raw_phone: str) -> int:
    try:
        phone = normalize_phone(raw_phone)
    except SMSProblem as exc:
        print(exc.message)
        return 1
    message_id = 'atlas-test-' + secrets.token_hex(8)
    reply = client.send(message_id, phone, 'IRON GLOBAL : test de la passerelle SMS ATLAS. Aucun code dans ce message.', 120)
    if reply.outcome != 'accepted':
        print(f"Non accepté par la passerelle : {reply.error}")
        return 1
    print("Accepté par la passerelle. Suivi pendant 90 secondes…")
    last = None
    for _ in range(30):
        time.sleep(3)
        state = client.state(message_id)
        if state.state and state.state != last:
            last = state.state
            print(f"  -> {LABELS.get(last, last)}{f' : {state.error}' if state.error else ''}")
        if last in ('delivered', 'failed'):
            break
    if last == 'sent':
        print("Envoyé, mais aucun accusé de livraison reçu dans le délai : vérifier la réception sur le téléphone destinataire.")
    return 0 if last in ('sent', 'delivered') else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('status')
    commands.add_parser('register-webhooks').add_argument('atlas_url')
    commands.add_parser('send-test').add_argument('phone')
    args = parser.parse_args()
    config = load_config()
    if config is None:
        print("Configuration SMSGate absente ou invalide : vérifier RECRUITMENT_SMSGATE_API_URL (https), _USERNAME et _PASSWORD.")
        return 2
    client = SMSGateClient(config)
    try:
        if args.command == 'status':
            return status(client)
        if args.command == 'register-webhooks':
            return register_webhooks(client, args.atlas_url)
        return send_test(client, args.phone)
    except Exception as exc:  # noqa: BLE001 — message court, sans détail susceptible de contenir un secret
        print(f"Échec de l'appel à SMSGate : {type(exc).__name__}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
