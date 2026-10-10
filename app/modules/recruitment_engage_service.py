"""IRON Emploi : règles des messages, entretiens, alertes et notifications."""
import base64
import json
import logging
import os
import urllib.request
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules import recruitment_jobs_service as jobs
from app.modules.recruitment_engage_models import (
    CANDIDATE, INTERVIEW_CANCELLED, INTERVIEW_CONFIRMED, INTERVIEW_PROPOSED, RECRUITER, RecruitmentInterview as Interview,
    RecruitmentJobAlert as Alert, RecruitmentMessage as Message, RecruitmentNotification as Notification, RecruitmentPushDevice as PushDevice,
)
from app.modules.recruitment_jobs_models import (
    RecruitmentApplication as Application, RecruitmentCandidateAccount as Account, RecruitmentCompany as Company, RecruitmentJobOffer as Offer,
)

logger = logging.getLogger('sgdi.recruitment.engage')
TIMEZONE = 'Africa/Algiers'
MAX_ALERTS = 10
PUSH_KINDS = ('applications', 'messages', 'interviews', 'offers')
KIND_PREFERENCE = {'application': 'applications', 'message': 'messages', 'interview': 'interviews', 'offer': 'offers'}
EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'


def now_local() -> datetime:
    """Heure d'Alger (UTC+1, sans heure d'été), sans fuseau : celle des entretiens."""
    return datetime.utcnow() + timedelta(hours=1)


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


# ── Notifications ───────────────────────────────────────────────────────────

def push_settings(account: Account) -> dict:
    saved = (account.settings or {}).get('push') if isinstance(account.settings, dict) else None
    return {kind: bool((saved or {}).get(kind, True)) for kind in PUSH_KINDS}


def notify(db: Session, account_id: int | None, kind: str, title: str, body: str, *, application_id=None, interview_id=None, offer_id=None,
           dedup: str | None = None) -> Notification | None:
    """Enregistre une notification dans l'espace du candidat. Sans espace (candidature historique), rien."""
    if account_id is None:
        return None
    if dedup and db.scalar(select(Notification.id).where(Notification.account_id == account_id, Notification.dedup == dedup)):
        return None
    row = Notification(account_id=account_id, kind=kind, title=title[:160], body=body[:400], application_id=application_id,
                       interview_id=interview_id, offer_id=offer_id, dedup=dedup)
    db.add(row)
    db.flush()
    return row


def notification_out(row: Notification) -> dict:
    return {'id': row.id, 'kind': row.kind, 'title': row.title, 'body': row.body, 'application_id': row.application_id,
            'interview_id': row.interview_id, 'offer_id': row.offer_id, 'created_at': iso(row.created_at), 'read': row.read_at is not None}


def push_enabled() -> bool:
    return os.getenv('RECRUITMENT_PUSH_ENABLED', 'false').lower() == 'true'


def send_push(db: Session, rows: list[Notification | None]) -> int:
    """Relaie des notifications déjà enregistrées vers le service push d'Expo. Désactivé par défaut
    (RECRUITMENT_PUSH_ENABLED) ; un échec n'affecte jamais l'action qui a créé la notification."""
    rows = [row for row in rows if row is not None]
    if not rows or not push_enabled():
        return 0
    messages = []
    for row in rows:
        account = db.get(Account, row.account_id)
        if account is None or not push_settings(account)[KIND_PREFERENCE.get(row.kind, 'applications')]:
            continue
        for token in db.scalars(select(PushDevice.token).where(PushDevice.account_id == row.account_id)).all():
            messages.append({'to': token, 'title': row.title, 'body': row.body, 'sound': 'default',
                             'data': {'notification_id': row.id, 'kind': row.kind, 'application_id': row.application_id,
                                      'interview_id': row.interview_id, 'offer_id': row.offer_id}})
    if not messages:
        return 0
    try:
        request = urllib.request.Request(EXPO_PUSH_URL, data=json.dumps(messages).encode(), method='POST',
                                         headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        with urllib.request.urlopen(request, timeout=5):
            pass
    except Exception as exc:  # noqa: BLE001 — le push est un complément : jamais bloquant, jamais de contenu journalisé
        logger.warning('Envoi push non abouti : %s', type(exc).__name__)
        return 0
    return len(messages)


# ── Alertes ─────────────────────────────────────────────────────────────────

def alert_out(row: Alert, company: Company | None = None) -> dict:
    return {'id': row.id, 'wilaya': row.wilaya, 'profession': row.profession, 'contract_type': row.contract_type,
            'company_id': row.company_id, 'company': company.name if company else None, 'active': row.active, 'created_at': iso(row.created_at)}


def alert_matches(alert: Alert, offer: Offer) -> bool:
    return ((not alert.wilaya or jobs.text_key(alert.wilaya) == jobs.text_key(offer.wilaya))
            and (not alert.profession or jobs.text_key(alert.profession) == jobs.text_key(offer.profession))
            and (not alert.contract_type or alert.contract_type == offer.contract_type)
            and (not alert.company_id or alert.company_id == offer.company_id))


def notify_matching_alerts(db: Session, offer: Offer, company: Company) -> list[Notification]:
    """À la publication d'une annonce : une notification par candidat dont une alerte active correspond."""
    created = []
    for alert in db.scalars(select(Alert).where(Alert.active.is_(True))).all():
        if alert_matches(alert, offer):
            row = notify(db, alert.account_id, 'offer', 'Nouvelle offre pour vous',
                         f'« {offer.title} » chez {company.name} correspond à votre alerte.', offer_id=offer.id, dedup=f'offer:{offer.id}')
            if row is not None:
                created.append(row)
    return created


# ── Messages ────────────────────────────────────────────────────────────────

def message_out(row: Message) -> dict:
    return {'id': row.id, 'sender': row.sender, 'body': row.body, 'client_id': row.client_id, 'created_at': iso(row.created_at),
            'read': row.read_at is not None}


def post_message(db: Session, application: Application, sender: str, body: str, client_id: str, author: str | None = None) -> tuple[Message, bool]:
    """Enregistre un message. Rejoué avec le même `client_id`, il renvoie le message déjà enregistré."""
    body = body.strip()
    if not body:
        raise HTTPException(status_code=422, detail='Le message est vide.')
    where = (Message.application_id == application.id, Message.sender == sender, Message.client_id == client_id)
    existing = db.scalar(select(Message).where(*where))
    if existing is not None:
        return existing, False
    row = Message(application_id=application.id, sender=sender, author=author, body=body, client_id=client_id)
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        return db.scalar(select(Message).where(*where)), False
    return row, True


def read_messages(db: Session, application_id: int, reader: str) -> None:
    """Le lecteur marque comme lus les messages de l'autre partie."""
    other = RECRUITER if reader == CANDIDATE else CANDIDATE
    db.execute(update(Message).where(Message.application_id == application_id, Message.sender == other, Message.read_at.is_(None))
               .values(read_at=datetime.utcnow()))


def unread_counts(db: Session, application_ids: list[int], reader: str) -> dict[int, int]:
    if not application_ids:
        return {}
    other = RECRUITER if reader == CANDIDATE else CANDIDATE
    return dict(db.execute(select(Message.application_id, func.count()).where(
        Message.application_id.in_(application_ids), Message.sender == other, Message.read_at.is_(None)).group_by(Message.application_id)).all())


def last_messages(db: Session, application_ids: list[int]) -> dict[int, Message]:
    if not application_ids:
        return {}
    latest = select(func.max(Message.id)).where(Message.application_id.in_(application_ids)).group_by(Message.application_id)
    return {row.application_id: row for row in db.scalars(select(Message).where(Message.id.in_(latest))).all()}


# ── Entretiens ──────────────────────────────────────────────────────────────

def interview_out(row: Interview, application: Application, offer: Offer | None, company: Company | None) -> dict:
    return {'id': row.id, 'source': 'interview', 'application_id': application.id, 'position': (offer.title if offer else application.position) or '',
            'company': company.name if company else None, 'starts_at': iso(row.starts_at), 'timezone': TIMEZONE, 'location': row.location,
            'contact': row.contact, 'note': row.note, 'status': row.status, 'confirmed_at': iso(row.confirmed_at),
            'cancelled_at': iso(row.cancelled_at), 'updated_at': iso(row.updated_at or row.created_at), 'past': row.starts_at < now_local()}


def legacy_convocation(candidate, interviews: list[Interview]) -> dict | None:
    """Convocation saisie sur le dossier par le parcours recruteur existant. Elle n'est pas rattachée
    à une candidature ; elle est omise si une invitation enregistrée porte déjà la même date et heure."""
    data = candidate.data if candidate is not None and isinstance(candidate.data, dict) else {}
    convocation = data.get('derniereConvocation')
    if not isinstance(convocation, dict) or not convocation.get('date'):
        return None
    try:
        starts_at = datetime.fromisoformat(f"{str(convocation['date'])[:10]}T{str(convocation.get('heure') or '00:00')[:5]}")
    except ValueError:
        return None
    if any(row.status != INTERVIEW_CANCELLED and row.starts_at == starts_at for row in interviews):
        return None
    return {'id': None, 'source': 'dossier', 'application_id': None, 'position': candidate.desired_position or '', 'company': None,
            'starts_at': starts_at.isoformat(), 'timezone': TIMEZONE, 'location': str(convocation.get('lieu') or ''), 'contact': None, 'note': None,
            'status': 'dossier', 'confirmed_at': None, 'cancelled_at': None, 'updated_at': None, 'past': starts_at < now_local()}


def check_interview_time(starts_at: datetime) -> datetime:
    starts_at = starts_at.replace(tzinfo=None, second=0, microsecond=0)
    if starts_at < now_local() - timedelta(minutes=5):
        raise HTTPException(status_code=422, detail='La date de l’entretien est déjà passée.')
    return starts_at


def describe(starts_at: datetime) -> str:
    months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
    return f'{starts_at.day} {months[starts_at.month - 1]} {starts_at.year} à {starts_at:%H h %M}'



# ── Traitement d'une candidature ────────────────────────────────────────────
# Trois notions distinctes : l'étape de traitement, le résultat de la décision, l'état du contrat.
STAGES = {
    'received': 'Réception', 'review': 'Examen du dossier', 'shortlisted': 'Présélection', 'convocation': 'Convocation',
    'interview': 'Entretien', 'decision': 'Décision', 'hiring_file': 'Dossier d’embauche', 'contract': 'Préparation du contrat',
    'signature': 'Signature', 'hired': 'Recrutement effectif',
}
STAGE_ORDER = list(STAGES)
OUTCOMES = {'pending': 'En attente', 'favorable': 'Favorable', 'unfavorable': 'Non retenue', 'withdrawn': 'Retirée par le candidat'}
CONTRACT_STATES = {'prepared': 'Préparé', 'sent': 'Envoyé', 'signed': 'Signé'}
# Ce que l'étape interne laisse voir au candidat. Au-delà de l'entretien, seul un résultat communiqué change son suivi.
STAGE_VISIBLE = {'received': 'received', 'review': 'review', 'shortlisted': 'shortlisted', 'convocation': 'interview', 'interview': 'interview'}


def log_event(db: Session, application: Application, kind: str, summary: str, actor: str) -> None:
    from app.modules.recruitment_engage_models import RecruitmentApplicationEvent
    db.add(RecruitmentApplicationEvent(application_id=application.id, kind=kind, summary=summary[:400], actor=actor[:100]))


def set_visible_status(db: Session, application: Application, status: str, actor: str) -> Notification | None:
    """Change l'état vu par le candidat et le prévient. Sans changement, rien n'est envoyé."""
    if application.status == status:
        return None
    application.status, application.status_updated_at, application.status_updated_by = status, datetime.utcnow(), actor
    label, message = jobs.APPLICATION_STATES[status]
    if status == 'withdrawn':
        return None
    return notify(db, application.account_id, 'application', f'Candidature : {label}', f'{application.position or "Votre candidature"} — {message}',
                  application_id=application.id)


def snapshot_documents(db: Session, application: Application, account: Account) -> int:
    """Copie le CV et la photo du profil dans la candidature, tels qu'ils sont à l'envoi."""
    from app.modules.recruitment_engage_models import RecruitmentApplicationDocument as Document
    count = 0
    if account.cv_meta and account.cv_content:
        db.add(Document(application_id=application.id, kind='cv', label='CV', name=account.cv_meta['name'], mime_type=account.cv_meta['mime_type'],
                        size=account.cv_meta['size'], content=account.cv_content, source='candidature'))
        count += 1
    if account.photo and account.photo.startswith('data:image/jpeg;base64,'):
        content = account.photo.split(',', 1)[1]
        try:
            size = len(base64.b64decode(content, validate=True))
        except ValueError:
            size = 0
        if size:
            db.add(Document(application_id=application.id, kind='photo', label='Photo d’identité', name='photo.jpg', mime_type='image/jpeg',
                            size=size, content=content, source='candidature'))
            count += 1
    return count


def candidate_extras(db: Session, application: Application) -> dict:
    """Ce que le candidat voit de sa candidature en plus de son état : pièces transmises, pièces
    demandées, contrat explicitement partagé. Ni notes internes, ni décision non communiquée."""
    from app.modules.recruitment_engage_models import (
        RecruitmentApplicationContract as Contract, RecruitmentApplicationDocument as Document, RecruitmentDocumentRequest as DocumentRequest,
    )
    documents = db.scalars(select(Document).where(Document.application_id == application.id).order_by(Document.id)).all()
    requests = db.scalars(select(DocumentRequest).where(DocumentRequest.application_id == application.id, DocumentRequest.status != 'cancelled')
                          .order_by(DocumentRequest.id.desc())).all()
    contract = db.scalar(select(Contract).where(Contract.application_id == application.id, Contract.shared_with_candidate.is_(True)))
    closed = bool(application.withdrawn_at) or (application.outcome == 'unfavorable' and application.outcome_communicated_at is not None)
    return {
        'message': application.message, 'withdrawn': application.withdrawn_at is not None,
        'can_withdraw': not closed and not (application.outcome == 'favorable' and application.outcome_communicated_at is not None),
        'documents': [{'label': row.label, 'name': row.name, 'mime_type': row.mime_type, 'size': row.size, 'received_at': iso(row.created_at)} for row in documents],
        'document_requests': [{'id': row.id, 'label': row.label, 'note': row.note, 'due': row.due.isoformat() if row.due else None,
                               'status': row.status, 'received_at': iso(row.received_at)} for row in requests],
        'contract': {'position': contract.position, 'contract_type': contract.contract_type, 'state': contract.state,
                     'state_label': CONTRACT_STATES[contract.state], 'start_date': contract.start_date.isoformat() if contract.start_date else None,
                     'signed_on': contract.signed_on.isoformat() if contract.signed_on else None} if contract else None,
    }
