"""File push durable, réservée sous verrou PostgreSQL, indépendante de SMSGate.

Expo n'offre pas de clé d'idempotence : une réponse réseau perdue peut conduire à une
notification en double lors d'une reprise. Les notifications dans l'espace restent uniques.
Un reçu `ok` signifie accepté par FCM/APNs, jamais lu ni livré au téléphone.
"""
import asyncio
import json
import logging
import urllib.error
import urllib.request
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.modules.recruitment_engage_models import RecruitmentNotification as Notification, RecruitmentPushDevice as Device, RecruitmentPushDelivery as Delivery
from app.modules.recruitment_jobs_models import RecruitmentCandidateAccount as Account

SEND_URL = 'https://exp.host/--/api/v2/push/send'
RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'
MAX_ATTEMPTS = 4
RETRY_SECONDS = (15, 60, 300)
_task = None
logger = logging.getLogger('sgdi.recruitment.push')


def eligible(db, notification, device):
    from app.modules.recruitment_engage_service import push_settings, KIND_PREFERENCE
    account = db.get(Account, notification.account_id)
    return (account is not None and device is not None and device.account_id == account.id
            and (notification.kind == 'offer' or push_settings(account)[KIND_PREFERENCE.get(notification.kind, 'applications')]))


def enqueue(db, notifications):
    from app.modules.recruitment_engage_service import push_enabled
    if not push_enabled():
        return
    for notification in notifications:
        if notification is None:
            continue
        for device in db.scalars(select(Device).where(Device.account_id == notification.account_id)).all():
            if not eligible(db, notification, device):
                continue
            if db.scalar(select(Delivery.id).where(Delivery.notification_id == notification.id, Delivery.device_id == device.id)):
                continue
            try:
                with db.begin_nested():
                    db.add(Delivery(notification_id=notification.id, device_id=device.id))
                    db.flush()
            except IntegrityError:
                pass  # même notification/appareil mis en file par un autre appel


def post(url, payload):
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=5) as response:
        result = json.loads(response.read())
    if not isinstance(result, dict):
        raise ValueError('invalid_response')
    return result


def retry(row, now, code):
    row.error_code = code
    if row.attempts >= MAX_ATTEMPTS:
        row.state = 'failed'
    else:
        row.state = 'pending'
        row.next_at = now + timedelta(seconds=RETRY_SECONDS[min(row.attempts - 1, len(RETRY_SECONDS) - 1)])


def error_code(reply):
    # Stocker uniquement les codes documentés ; jamais un message pouvant contenir le jeton.
    details = reply.get('details')
    code = details.get('error') if isinstance(details, dict) else None
    allowed = {'DeviceNotRegistered', 'MessageTooBig', 'MessageRateExceeded', 'MismatchSenderId', 'InvalidCredentials'}
    return code if code in allowed else 'provider_error'


def reject(db, row, reply, now):
    code = error_code(reply)
    if code == 'MessageRateExceeded':
        retry(row, now, code)
    else:
        row.state, row.error_code = 'failed', code
    if code == 'DeviceNotRegistered' and row.device_id:
        device = db.get(Device, row.device_id)
        if device is not None:
            db.delete(device)


def dispatch(db, *, now=None, notification_ids=None):
    from app.modules.recruitment_engage_service import push_enabled, ANDROID_CHANNEL
    if not push_enabled():
        return 0
    now = now or datetime.utcnow()
    query = select(Delivery).where(Delivery.state == 'pending', Delivery.next_at <= now).order_by(Delivery.id)
    if notification_ids is not None:
        query = query.where(Delivery.notification_id.in_(notification_ids))
    rows = db.scalars(query.limit(100).with_for_update(skip_locked=True)).all()
    batch, selected = [], []
    for row in rows:
        notification, device = db.get(Notification, row.notification_id), db.get(Device, row.device_id) if row.device_id else None
        if notification is None or not eligible(db, notification, device):
            row.state, row.error_code = 'skipped', 'unregistered_or_disabled'
            continue
        if now - row.created_at >= timedelta(hours=24):
            row.state, row.error_code = 'failed', 'expired'
            continue
        row.attempts += 1
        selected.append(row)
        batch.append({'to': device.token, 'title': notification.title, 'body': notification.body, 'sound': 'default',
                      'priority': 'high', 'channelId': ANDROID_CHANNEL, 'ttl': max(1, int((row.created_at + timedelta(hours=24) - now).total_seconds())),
                      'data': {'notification_id': notification.id, 'kind': notification.kind, 'application_id': notification.application_id,
                               'interview_id': notification.interview_id, 'offer_id': notification.offer_id}})
    accepted = 0
    if selected:
        try:
            result = post(SEND_URL, batch)
            tickets = result.get('data')
            if not isinstance(tickets, list):
                tickets = []
            for index, row in enumerate(selected):
                ticket = tickets[index] if index < len(tickets) and isinstance(tickets[index], dict) else {}
                if ticket.get('status') == 'ok' and isinstance(ticket.get('id'), str) and 0 < len(ticket['id']) <= 100:
                    row.state, row.ticket_id, row.error_code = 'accepted', ticket['id'], None
                    row.next_at = now + timedelta(minutes=15)
                    accepted += 1
                elif ticket.get('status') == 'error':
                    reject(db, row, ticket, now)
                else:
                    retry(row, now, 'invalid_ticket')
        except Exception as exc:
            permanent = isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500 and exc.code != 429
            for row in selected:
                if permanent:
                    row.state, row.error_code = 'failed', 'http_rejected'
                else:
                    retry(row, now, 'transport_error')
            logger.warning('File push : %s', type(exc).__name__)
    db.commit()
    return accepted


def receipts(db, *, now=None):
    from app.modules.recruitment_engage_service import push_enabled
    if not push_enabled():
        return
    now = now or datetime.utcnow()
    rows = db.scalars(select(Delivery).where(Delivery.state == 'accepted', Delivery.next_at <= now)
                      .order_by(Delivery.id).limit(100).with_for_update(skip_locked=True)).all()
    if not rows:
        return
    try:
        result = post(RECEIPTS_URL, {'ids': [r.ticket_id for r in rows]})
        data = result.get('data') if isinstance(result.get('data'), dict) else {}
    except Exception as exc:
        logger.warning('Reçus push : %s', type(exc).__name__)
        data = {}
    for row in rows:
        receipt = data.get(row.ticket_id)
        if isinstance(receipt, dict) and receipt.get('status') == 'ok':
            row.state, row.error_code = 'provider_accepted', None
        elif isinstance(receipt, dict) and receipt.get('status') == 'error':
            reject(db, row, receipt, now)
        elif now - row.created_at >= timedelta(hours=23):
            row.state, row.error_code = 'unknown', 'receipt_unavailable'
        else:
            row.next_at = now + timedelta(minutes=5)
    db.commit()


def run_once():
    from app.db.session import SessionLocal
    with SessionLocal() as db:
        dispatch(db)
        receipts(db)


async def loop():
    while True:
        try:
            await asyncio.to_thread(run_once)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning('File push : %s', type(exc).__name__)
        await asyncio.sleep(5)


def start_worker():
    global _task
    from app.modules.recruitment_engage_service import push_enabled
    if push_enabled() and (_task is None or _task.done()):
        _task = asyncio.get_running_loop().create_task(loop())


def stop_worker():
    global _task
    if _task is not None:
        _task.cancel()
    _task = None
