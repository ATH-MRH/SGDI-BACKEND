"""OTP candidat persistant et file SMS pour une passerelle Android privée (SMSGate)."""
import base64
import hashlib
import hmac
import re
import secrets
import time
from cryptography.fernet import Fernet
from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.modules.recruitment_sms_models import RecruitmentSMSChallenge as Challenge, RecruitmentSMSRate as Rate, RecruitmentSMSGateway as Gateway

CODE_TTL = 300
SESSION_TTL = 7200
RESEND_DELAY = 60
MAX_ATTEMPTS = 5
# File d'envoi SMSGate.
MAX_SEND_ATTEMPTS = 3
RETRY_DELAYS = (5, 15)
SEND_LEASE = 45          # au-delà, un envoi resté « sending » (worker tué) est rejoué avec le même identifiant
MIN_REMAINING = 15       # ne pas déposer un code qui expire dans moins de 15 s (ttl minimal SMSGate : 5 s)
TRACK_WINDOW = 900       # suivi envoyé/livré pendant 15 min après la demande, puis l'état reste tel quel
TRACK_INTERVAL = {'accepted': 3, 'processed': 3, 'sent': 15}
DELIVERY_RANK = {'queued': 0, 'sending': 1, 'accepted': 2, 'processed': 3, 'sent': 4, 'delivered': 5}


class SMSProblem(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message
        super().__init__(message)


def normalize_phone(value: str) -> str:
    phone = re.sub(r'[\s().-]', '', value.strip())
    if re.fullmatch(r'0[567]\d{8}', phone):
        return '+213' + phone[1:]
    if phone.startswith('00213'):
        phone = '+' + phone[2:]
    if not re.fullmatch(r'\+213[567]\d{8}', phone):
        raise SMSProblem(422, 'Renseignez un numéro mobile algérien valide (05, 06 ou 07).')
    return phone


def digest(secret: str, kind: str, value: str) -> str:
    return hmac.new(secret.encode(), f'{kind}:{value}'.encode(), hashlib.sha256).hexdigest()


def cipher(secret: str) -> Fernet:
    return Fernet(base64.urlsafe_b64encode(hmac.new(secret.encode(), b'recruitment-sms-encryption-v1', hashlib.sha256).digest()))


def rate(db: Session, secret: str, kind: str, value: str, maximum: int, now: int):
    key = f'{kind}:{now // 3600}:' + digest(secret, 'rate', value)
    try:
        with db.begin_nested():
            db.add(Rate(key=key, count=0, expires_at=(now // 3600 + 1) * 3600))
            db.flush()
    except IntegrityError:
        pass
    result = db.execute(update(Rate).where(Rate.key == key, Rate.count < maximum).values(count=Rate.count + 1))
    if not result.rowcount:
        db.rollback()
        raise SMSProblem(429, 'Trop de demandes. Réessayez plus tard.')


def request_code(db: Session, secret: str, first_name: str, last_name: str, raw_phone: str, ip: str, *, now: int | None = None) -> dict:
    now = int(time.time()) if now is None else now
    phone = normalize_phone(raw_phone)
    first_name, last_name = first_name.strip(), last_name.strip()
    if not 2 <= len(first_name) <= 100 or not 2 <= len(last_name) <= 100:
        raise SMSProblem(422, 'Renseignez votre nom et prénom (au moins deux caractères).')
    # Les mises à jour atomiques des compteurs sérialisent les demandes concurrentes.
    rate(db, secret, 'phone', phone, 5, now)
    rate(db, secret, 'ip', ip, 20, now)
    latest = db.scalar(select(Challenge).where(Challenge.phone == phone).order_by(Challenge.created_at.desc()).limit(1))
    if latest and latest.created_at > now - RESEND_DELAY:
        db.rollback()
        raise SMSProblem(429, 'Attendez 60 secondes avant de demander un nouveau code.')
    # Un renvoi invalide les anciens codes non vérifiés, sans invalider un dossier déjà ouvert.
    db.execute(update(Challenge).where(Challenge.phone == phone, Challenge.token_digest.is_(None)).values(status='expired', sms_ciphertext=''))
    challenge_id, code = secrets.token_urlsafe(24), f'{secrets.randbelow(1_000_000):06d}'
    row = Challenge(id=challenge_id, phone=phone, first_name=first_name, last_name=last_name,
                    code_digest=digest(secret, 'code', f'{challenge_id}:{code}'),
                    sms_ciphertext=cipher(secret).encrypt(f'IRON GLOBAL : votre code de validation est {code}. Valable 5 minutes. Ne le partagez pas.'.encode()).decode(),
                    created_at=now, expires_at=now + CODE_TTL, attempts=0, status='queued', lease_until=0, send_attempts=0,
                    # Identifiant d'idempotence côté passerelle ; dérivé pour ne pas y exposer le challenge.
                    gateway_message_id=digest(secret, 'smsgate', challenge_id)[:32], delivery_status='queued')
    db.add(row)
    # Purge au fil des demandes ; aucun code ou identité n'est conservé indéfiniment ici.
    db.execute(delete(Challenge).where(Challenge.created_at < now - 86400))
    db.execute(delete(Rate).where(Rate.expires_at < now - 3600))
    db.commit()
    return {'challenge_id': row.id, 'expires_in': CODE_TTL, 'resend_after': RESEND_DELAY, 'status': 'queued', 'phone': phone}


def verify_code(db: Session, secret: str, challenge_id: str, code: str, *, now: int | None = None) -> dict:
    now = int(time.time()) if now is None else now
    # L'incrément conditionnel évite de dépasser cinq essais, même avec plusieurs workers.
    result = db.execute(update(Challenge).where(Challenge.id == challenge_id, Challenge.expires_at > now,
                         Challenge.status.in_(['queued', 'leased', 'sent']), Challenge.token_digest.is_(None),
                         Challenge.attempts < MAX_ATTEMPTS).values(attempts=Challenge.attempts + 1))
    if not result.rowcount:
        db.rollback()
        raise SMSProblem(400, 'Code expiré ou trop d’essais. Demandez un nouveau code.')
    row = db.get(Challenge, challenge_id, populate_existing=True)
    expected = digest(secret, 'code', f'{challenge_id}:{code}')
    if not re.fullmatch(r'\d{6}', code) or not hmac.compare_digest(row.code_digest, expected):
        db.commit()
        raise SMSProblem(400, 'Code incorrect.')
    token = secrets.token_urlsafe(40)
    row.token_digest, row.token_expires_at = digest(secret, 'session', token), now + SESSION_TTL
    row.status, row.sms_ciphertext = 'verified', ''
    db.commit()
    return {'access_token': token, 'expires_in': SESSION_TTL, 'identity': {'first_name': row.first_name, 'last_name': row.last_name, 'phone': row.phone}}


def identity(db: Session, secret: str, token: str, *, now: int | None = None, lock: bool = False) -> Challenge:
    now = int(time.time()) if now is None else now
    stmt = select(Challenge).where(Challenge.token_digest == digest(secret, 'session', token), Challenge.token_expires_at > now,
                                   Challenge.status.in_(['verified', 'submitted']))
    if lock:
        stmt = stmt.with_for_update()
    row = db.scalar(stmt)
    if row is None:
        raise SMSProblem(401, 'Votre accès candidat a expiré. Vérifiez à nouveau votre téléphone.')
    return row


def gateway_poll(db: Session, secret: str, *, now: int | None = None) -> dict:
    now = int(time.time()) if now is None else now
    try:
        with db.begin_nested():
            db.add(Gateway(id=1, last_seen=now))
            db.flush()
    except IntegrityError:
        pass
    db.execute(update(Gateway).where(Gateway.id == 1).values(last_seen=now))
    row = db.scalar(select(Challenge).where(Challenge.expires_at > now, Challenge.send_attempts < 3,
                    ((Challenge.status == 'queued') | ((Challenge.status == 'leased') & (Challenge.lease_until < now))))
                    .order_by(Challenge.created_at).with_for_update(skip_locked=True).limit(1))
    if row is None:
        db.commit()
        return {'job': None}
    lease = secrets.token_urlsafe(24)
    row.status, row.lease_digest, row.lease_until = 'leased', digest(secret, 'lease', lease), now + 60
    row.send_attempts += 1
    job = {'id': row.id, 'lease_token': lease, 'phone': row.phone, 'message': cipher(secret).decrypt(row.sms_ciphertext.encode()).decode(), 'expires_at': row.expires_at}
    db.commit()
    return {'job': job}


def gateway_ack(db: Session, secret: str, job_id: str, lease_token: str, sent: bool, *, now: int | None = None):
    now = int(time.time()) if now is None else now
    row = db.scalar(select(Challenge).where(Challenge.id == job_id).with_for_update())
    if row is None or not row.lease_digest or not hmac.compare_digest(row.lease_digest, digest(secret, 'lease', lease_token)):
        raise SMSProblem(404, 'Envoi introuvable.')
    # Accusé idempotent ; ne remet pas en file un code déjà validé par le candidat.
    if row.status == 'leased':
        row.status = 'sent' if sent else ('queued' if row.send_attempts < 3 and row.expires_at > now else 'failed')
        if sent:
            row.sms_ciphertext, row.delivery_status, row.sent_at = '', 'sent', now
        elif row.status == 'failed':
            row.delivery_status, row.delivery_error = 'failed', 'gateway_failed'
    db.commit()
    return {'status': 'acknowledged'}


def delivery_state(db: Session, challenge_id: str) -> dict:
    """État d'acheminement visible du candidat. « accepted » ne vaut ni envoi ni livraison."""
    row = db.get(Challenge, challenge_id)
    if row is None:
        raise SMSProblem(404, 'Demande introuvable.')
    public = {'queued': 'pending', 'sending': 'pending', 'processed': 'accepted', 'expired': 'failed'}
    return {'delivery': public.get(row.delivery_status, row.delivery_status)}


def mark_gateway_healthy(db: Session, *, now: int | None = None):
    now = int(time.time()) if now is None else now
    try:
        with db.begin_nested():
            db.add(Gateway(id=1, last_seen=now))
            db.flush()
    except IntegrityError:
        pass
    db.execute(update(Gateway).where(Gateway.id == 1).values(last_seen=now))
    db.commit()


def _abandon(row: Challenge, error: str):
    # `status` n'est pas touché : la validité du code ne dépend que de l'expiration et des essais.
    row.delivery_status, row.delivery_error, row.sms_ciphertext = 'failed', error[:120], ''


def dispatch_pending(db: Session, secret: str, gateway, *, now: int | None = None, limit: int = 5) -> int:
    """Dépose les codes en attente auprès de SMSGate. Sûr avec plusieurs workers : chaque envoi
    est réservé (« sending ») et validé en base avant l'appel réseau, puis rejoué au besoin avec
    le même identifiant de message, que SMSGate refuse en double (409)."""
    now = int(time.time()) if now is None else now
    pending = (Challenge.status == 'queued', Challenge.gateway_message_id.is_not(None))
    lost = and_(Challenge.delivery_status == 'sending', Challenge.lease_until < now)
    # Code trop proche de l'expiration : on n'envoie pas un SMS inutilisable.
    db.execute(update(Challenge).where(*pending, Challenge.expires_at <= now + MIN_REMAINING, or_(Challenge.delivery_status == 'queued', lost))
               .values(delivery_status='expired', delivery_error='code_expired', sms_ciphertext=''))
    db.execute(update(Challenge).where(*pending, lost, Challenge.send_attempts >= MAX_SEND_ATTEMPTS)
               .values(delivery_status='failed', delivery_error='gateway_outcome_unknown', sms_ciphertext=''))
    rows = db.scalars(select(Challenge).where(
        *pending, Challenge.expires_at > now + MIN_REMAINING, Challenge.send_attempts < MAX_SEND_ATTEMPTS,
        or_(and_(Challenge.delivery_status == 'queued', Challenge.next_attempt_at <= now), lost))
        .order_by(Challenge.created_at).with_for_update(skip_locked=True).limit(limit)).all()
    jobs = []
    for row in rows:
        row.delivery_status, row.lease_until = 'sending', now + SEND_LEASE
        row.send_attempts += 1
        jobs.append((row.id, row.gateway_message_id, row.phone, cipher(secret).decrypt(row.sms_ciphertext.encode()).decode(), row.expires_at - now))
    db.commit()
    for challenge_id, message_id, phone, text, ttl in jobs:
        reply = gateway.send(message_id, phone, text, ttl)
        row = db.scalar(select(Challenge).where(Challenge.id == challenge_id).with_for_update())
        if row is None or row.delivery_status != 'sending':
            db.commit()
            continue
        if reply.outcome == 'accepted':
            state = reply.state if reply.state in DELIVERY_RANK else 'accepted'
            row.delivery_status, row.delivery_error, row.sms_ciphertext = state, None, ''
            row.accepted_at, row.status_checked_at = now, now
            if state in ('sent', 'delivered'):
                row.sent_at = now
            if state == 'delivered':
                row.delivered_at = now
        elif reply.outcome == 'retry' and row.send_attempts < MAX_SEND_ATTEMPTS:
            delay = RETRY_DELAYS[min(row.send_attempts, len(RETRY_DELAYS)) - 1]
            row.delivery_status, row.delivery_error, row.next_attempt_at = 'queued', (reply.error or 'gateway_error')[:120], now + delay
        else:
            _abandon(row, reply.error or 'gateway_error')
        db.commit()
    return len(jobs)


def apply_gateway_state(db: Session, message_id: str, state: str, error: str | None = None, *, now: int | None = None) -> bool:
    """Applique un état remonté par SMSGate (sondage ou webhook). Ne fait qu'avancer :
    un événement rejoué ou arrivé en retard ne fait jamais régresser le suivi."""
    now = int(time.time()) if now is None else now
    row = db.scalar(select(Challenge).where(Challenge.gateway_message_id == message_id).with_for_update())
    current = row.delivery_status if row is not None else 'queued'
    # Un échec supposé (issue inconnue, expiration) cède devant une preuve d'envoi ou de livraison.
    rank = 1 if current in ('failed', 'expired') and state in ('sent', 'delivered') else DELIVERY_RANK.get(current, 9)
    if current == 'queued' or (state == 'failed' and current in ('delivered', 'failed', 'expired')) or (
            state != 'failed' and DELIVERY_RANK.get(state, 0) <= rank):
        db.rollback()
        return False
    if state == 'failed':
        row.delivery_status, row.delivery_error, row.sms_ciphertext = 'failed', (error or 'gateway_failed')[:120], ''
    else:
        row.delivery_status, row.delivery_error, row.sms_ciphertext = state, None, ''
        row.accepted_at = row.accepted_at or now
        if state in ('sent', 'delivered'):
            row.sent_at = row.sent_at or now
        if state == 'delivered':
            row.delivered_at = now
    db.commit()
    return True


def track_deliveries(db: Session, gateway, *, now: int | None = None, limit: int = 10) -> int:
    """Interroge SMSGate sur les SMS acceptés mais pas encore livrés (complément des webhooks)."""
    now = int(time.time()) if now is None else now
    due = or_(*[and_(Challenge.delivery_status == state, Challenge.status_checked_at <= now - interval) for state, interval in TRACK_INTERVAL.items()])
    rows = db.scalars(select(Challenge).where(Challenge.gateway_message_id.is_not(None), Challenge.created_at > now - TRACK_WINDOW, due)
                      .order_by(Challenge.status_checked_at).with_for_update(skip_locked=True).limit(limit)).all()
    message_ids = [row.gateway_message_id for row in rows]
    for row in rows:
        row.status_checked_at = now
    db.commit()
    for message_id in message_ids:
        reply = gateway.state(message_id)
        if reply.outcome == 'accepted' and reply.state:
            apply_gateway_state(db, message_id, reply.state, reply.error, now=now)
    return len(message_ids)
