"""IRON Emploi — espace candidat : messages, entretiens, alertes, notifications, préférences."""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules import recruitment_engage_service as engage
from app.modules import recruitment_jobs_service as jobs
from app.modules.recruitment_engage_models import (
    CANDIDATE, INTERVIEW_CANCELLED, INTERVIEW_CONFIRMED, INTERVIEW_PROPOSED, RecruitmentInterview as Interview, RecruitmentJobAlert as Alert,
    RecruitmentMessage as Message, RecruitmentNotification as Notification, RecruitmentPushDevice as PushDevice,
)
from app.modules.recruitment_jobs_models import (
    RecruitmentApplication as Application, RecruitmentCandidateAccount as Account, RecruitmentCompany as Company, RecruitmentJobOffer as Offer,
)
from app.core.candidate_cv import validate_cv
from app.modules.public_candidates import PublicCVIn
from app.modules.recruitment_jobs_public import _account

router = APIRouter()
ClientId = Annotated[str, Field(min_length=8, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')]


class MessageIn(BaseModel):
    body: Annotated[str, Field(min_length=1, max_length=2000)]
    client_id: ClientId


class AlertIn(BaseModel):
    wilaya: Annotated[str | None, Field(default=None, max_length=120)]
    profession: Annotated[str | None, Field(default=None, max_length=150)]
    contract_type: Annotated[str | None, Field(default=None, max_length=40)]
    company_id: int | None = None
    active: bool = True


class PushDeviceIn(BaseModel):
    token: Annotated[str, Field(min_length=10, max_length=200)]
    platform: Annotated[str, Field(pattern=r'^(ios|android)$')]


class SettingsIn(BaseModel):
    push: dict[str, bool]


def _own_applications(db: Session, account: Account) -> list[tuple[Application, Offer | None, Company | None]]:
    """Candidatures de l'espace, rattachées à son dossier actuel : la seule porte vers messages et entretiens."""
    if not account.candidate_id:
        return []
    return db.execute(select(Application, Offer, Company).outerjoin(Offer, Offer.id == Application.offer_id)
                      .outerjoin(Company, Company.id == Offer.company_id)
                      .where(Application.account_id == account.id, Application.candidate_id == account.candidate_id)
                      .order_by(Application.created_at.desc(), Application.id.desc())).all()


def _own_application(db: Session, account: Account, application_id: int) -> tuple[Application, Offer | None, Company | None]:
    for row in _own_applications(db, account):
        if row[0].id == application_id:
            return row
    # La candidature d'un autre candidat et une candidature inconnue répondent de la même façon.
    raise HTTPException(status_code=404, detail='Candidature introuvable.')


def _title(application: Application, offer: Offer | None) -> str:
    return (offer.title if offer else application.position) or 'Candidature'


# ── Messages ────────────────────────────────────────────────────────────────

@router.get('/conversations')
def emploi_conversations(account: Account = Depends(_account), db: Session = Depends(get_db)):
    rows = _own_applications(db, account)
    ids = [application.id for application, _, _ in rows]
    last, unread = engage.last_messages(db, ids), engage.unread_counts(db, ids, CANDIDATE)
    items = [{'application_id': application.id, 'kind': 'offer' if application.offer_id else 'spontaneous', 'title': _title(application, offer),
              'company': jobs.company_public(company) if company else None,
              'last_message': engage.message_out(last[application.id]) if application.id in last else None,
              'unread': unread.get(application.id, 0), 'submitted_at': engage.iso(application.created_at)}
             for application, offer, company in rows]
    items.sort(key=lambda item: (item['last_message'] or {}).get('created_at') or item['submitted_at'] or '', reverse=True)
    return {'items': items}


@router.get('/applications/{application_id}/messages')
def emploi_messages(application_id: int, account: Account = Depends(_account), db: Session = Depends(get_db)):
    application, offer, company = _own_application(db, account, application_id)
    engage.read_messages(db, application.id, CANDIDATE)
    db.commit()
    rows = db.scalars(select(Message).where(Message.application_id == application.id).order_by(Message.id)).all()
    return {'application_id': application.id, 'title': _title(application, offer), 'company': jobs.company_public(company) if company else None,
            'items': [engage.message_out(row) for row in rows]}


@router.post('/applications/{application_id}/messages', status_code=201)
def emploi_send_message(application_id: int, payload: MessageIn, response: Response, account: Account = Depends(_account),
                        db: Session = Depends(get_db)):
    application, _, _ = _own_application(db, account, application_id)
    row, created = engage.post_message(db, application, CANDIDATE, payload.body, payload.client_id)
    db.commit()
    if not created:
        response.status_code = 200
    return engage.message_out(row)


# ── Entretiens ──────────────────────────────────────────────────────────────

@router.get('/interviews')
def emploi_interviews(account: Account = Depends(_account), db: Session = Depends(get_db)):
    rows = {application.id: (application, offer, company) for application, offer, company in _own_applications(db, account)}
    interviews = db.scalars(select(Interview).where(Interview.application_id.in_(rows))).all() if rows else []
    items = [engage.interview_out(row, *rows[row.application_id]) for row in interviews]
    legacy = engage.legacy_convocation(jobs.dossier(db, account), interviews)
    if legacy:
        items.append(legacy)
    items.sort(key=lambda item: item['starts_at'])
    return {'items': items, 'timezone': engage.TIMEZONE, 'now': engage.now_local().isoformat(timespec='minutes')}


@router.post('/interviews/{interview_id}/confirm')
def emploi_confirm_interview(interview_id: int, account: Account = Depends(_account), db: Session = Depends(get_db)):
    row = db.scalar(select(Interview).where(Interview.id == interview_id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail='Entretien introuvable.')
    application, offer, company = _own_application(db, account, row.application_id)
    if row.status == INTERVIEW_CANCELLED:
        raise HTTPException(status_code=409, detail='Cet entretien a été annulé par le service recrutement.')
    if row.starts_at < engage.now_local():
        raise HTTPException(status_code=409, detail='Cet entretien est déjà passé.')
    if row.status == INTERVIEW_PROPOSED:
        row.status, row.confirmed_at = INTERVIEW_CONFIRMED, datetime.utcnow()
    db.commit()
    return engage.interview_out(row, application, offer, company)


# ── Alertes ─────────────────────────────────────────────────────────────────

def _alert_values(db: Session, payload: AlertIn) -> dict:
    values = {key: (value.strip() or None) if isinstance(value, str) else value for key, value in payload.model_dump().items()}
    if values['contract_type'] and values['contract_type'] not in jobs.CONTRACT_TYPES:
        raise HTTPException(status_code=422, detail='Type de contrat inconnu.')
    if values['company_id'] and not db.scalar(select(Company.id).where(Company.id == values['company_id'], Company.is_active.is_(True))):
        raise HTTPException(status_code=422, detail='Société inconnue.')
    if not any(values[key] for key in ('wilaya', 'profession', 'contract_type', 'company_id')):
        raise HTTPException(status_code=422, detail='Choisissez au moins un critère.')
    return values


def _alerts(db: Session, account: Account) -> list[dict]:
    rows = db.execute(select(Alert, Company).outerjoin(Company, Company.id == Alert.company_id)
                      .where(Alert.account_id == account.id).order_by(Alert.id.desc())).all()
    return [engage.alert_out(alert, company) for alert, company in rows]


def _alert(db: Session, account: Account, alert_id: int) -> Alert:
    row = db.scalar(select(Alert).where(Alert.id == alert_id, Alert.account_id == account.id))
    if row is None:
        raise HTTPException(status_code=404, detail='Alerte introuvable.')
    return row


@router.get('/alerts')
def emploi_alerts(account: Account = Depends(_account), db: Session = Depends(get_db)):
    return {'items': _alerts(db, account)}


@router.post('/alerts', status_code=201)
def emploi_create_alert(payload: AlertIn, account: Account = Depends(_account), db: Session = Depends(get_db)):
    if db.scalar(select(func.count()).select_from(Alert).where(Alert.account_id == account.id)) >= engage.MAX_ALERTS:
        raise HTTPException(status_code=409, detail=f'Vous avez atteint la limite de {engage.MAX_ALERTS} alertes. Supprimez-en une pour en créer une autre.')
    row = Alert(account_id=account.id, **_alert_values(db, payload))
    db.add(row)
    db.commit()
    return engage.alert_out(row, db.get(Company, row.company_id) if row.company_id else None)


@router.put('/alerts/{alert_id}')
def emploi_update_alert(alert_id: int, payload: AlertIn, account: Account = Depends(_account), db: Session = Depends(get_db)):
    row = _alert(db, account, alert_id)
    for key, value in _alert_values(db, payload).items():
        setattr(row, key, value)
    db.commit()
    return engage.alert_out(row, db.get(Company, row.company_id) if row.company_id else None)


@router.delete('/alerts/{alert_id}', status_code=204)
def emploi_delete_alert(alert_id: int, account: Account = Depends(_account), db: Session = Depends(get_db)):
    db.delete(_alert(db, account, alert_id))
    db.commit()
    return Response(status_code=204)


# ── Notifications ───────────────────────────────────────────────────────────

@router.get('/notifications')
def emploi_notifications(account: Account = Depends(_account), db: Session = Depends(get_db)):
    rows = db.scalars(select(Notification).where(Notification.account_id == account.id).order_by(Notification.id.desc()).limit(50)).all()
    return {'items': [engage.notification_out(row) for row in rows], 'unread': sum(1 for row in rows if row.read_at is None)}


@router.post('/notifications/read-all')
def emploi_read_all_notifications(account: Account = Depends(_account), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.account_id == account.id, Notification.read_at.is_(None)).values(read_at=datetime.utcnow()))
    db.commit()
    return {'unread': 0}


@router.post('/notifications/{notification_id}/read')
def emploi_read_notification(notification_id: int, account: Account = Depends(_account), db: Session = Depends(get_db)):
    row = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.account_id == account.id))
    if row is None:
        raise HTTPException(status_code=404, detail='Notification introuvable.')
    row.read_at = row.read_at or datetime.utcnow()
    db.commit()
    return engage.notification_out(row)


@router.get('/summary')
def emploi_summary(account: Account = Depends(_account), db: Session = Depends(get_db)):
    """Compteurs des pastilles de l'application."""
    ids = [application.id for application, _, _ in _own_applications(db, account)]
    upcoming = db.scalar(select(func.count()).select_from(Interview).where(
        Interview.application_id.in_(ids), Interview.status != INTERVIEW_CANCELLED, Interview.starts_at >= engage.now_local())) if ids else 0
    return {'unread_messages': sum(engage.unread_counts(db, ids, CANDIDATE).values()),
            'unread_notifications': db.scalar(select(func.count()).select_from(Notification).where(
                Notification.account_id == account.id, Notification.read_at.is_(None))),
            'upcoming_interviews': upcoming}


# ── Préférences et appareils ────────────────────────────────────────────────

@router.get('/me/settings')
def emploi_settings(account: Account = Depends(_account), db: Session = Depends(get_db)):
    devices = db.scalar(select(func.count()).select_from(PushDevice).where(PushDevice.account_id == account.id))
    # `push_available` : le serveur relaie réellement vers le service push ; sinon seules les notifications dans l'application existent.
    return {'push': engage.push_settings(account), 'push_available': engage.push_enabled(), 'devices': devices}


@router.put('/me/settings')
def emploi_save_settings(payload: SettingsIn, account: Account = Depends(_account), db: Session = Depends(get_db)):
    account.settings = {**(account.settings or {}), 'push': {kind: bool(payload.push.get(kind, True)) for kind in engage.PUSH_KINDS}}
    db.commit()
    return {'push': engage.push_settings(account)}


@router.put('/me/push-device')
def emploi_register_device(payload: PushDeviceIn, account: Account = Depends(_account), db: Session = Depends(get_db)):
    row = db.scalar(select(PushDevice).where(PushDevice.token == payload.token))
    if row is None:
        db.add(PushDevice(account_id=account.id, token=payload.token, platform=payload.platform))
    else:
        # Un téléphone qui change d'espace candidat ne reçoit plus les notifications du précédent.
        row.account_id, row.platform = account.id, payload.platform
    db.commit()
    return {'registered': True}


@router.delete('/me/push-device', status_code=204)
def emploi_unregister_devices(account: Account = Depends(_account), db: Session = Depends(get_db)):
    for row in db.scalars(select(PushDevice).where(PushDevice.account_id == account.id)).all():
        db.delete(row)
    db.commit()
    return Response(status_code=204)


# ── Retrait, pièces complémentaires, conseils ───────────────────────────────

@router.post('/applications/{application_id}/withdraw')
def emploi_withdraw(application_id: int, account: Account = Depends(_account), db: Session = Depends(get_db)):
    application, _, _ = _own_application(db, account, application_id)
    if application.outcome == 'favorable' and application.outcome_communicated_at:
        raise HTTPException(status_code=409, detail='Cette candidature a été retenue : contactez le service recrutement pour y renoncer.')
    if application.outcome == 'unfavorable' and application.outcome_communicated_at:
        raise HTTPException(status_code=409, detail='Cette candidature est déjà close.')
    if application.withdrawn_at is None:
        application.withdrawn_at, application.outcome = datetime.utcnow(), 'withdrawn'
        engage.set_visible_status(db, application, 'withdrawn', 'candidat')
        for row in db.scalars(select(Interview).where(Interview.application_id == application.id,
                                                      Interview.status.in_([INTERVIEW_PROPOSED, INTERVIEW_CONFIRMED]))).all():
            row.status, row.cancelled_at = INTERVIEW_CANCELLED, datetime.utcnow()
        engage.log_event(db, application, 'withdrawal', 'Candidature retirée par le candidat', 'candidat')
    db.commit()
    return {'withdrawn': True}


@router.put('/document-requests/{request_id}')
def emploi_fulfil_document_request(request_id: int, payload: PublicCVIn, account: Account = Depends(_account), db: Session = Depends(get_db)):
    """Dépôt d'une pièce demandée par le recrutement : PDF, JPG ou PNG, mêmes contrôles que le CV."""
    from app.modules.recruitment_engage_models import RecruitmentApplicationDocument as Document, RecruitmentDocumentRequest as DocumentRequest
    row = db.scalar(select(DocumentRequest).where(DocumentRequest.id == request_id).with_for_update())
    application, _, _ = _own_application(db, account, row.application_id if row else 0)
    if row.status != 'requested':
        raise HTTPException(status_code=409, detail='Cette pièce a déjà été transmise ou n’est plus demandée.')
    meta, content = validate_cv(payload.model_dump())
    db.add(Document(application_id=application.id, kind='complement', label=row.label, name=meta['name'], mime_type=meta['mime_type'],
                    size=meta['size'], content=content, source='complement', request_id=row.id))
    row.status, row.received_at = 'received', datetime.utcnow()
    engage.log_event(db, application, 'document', f'Pièce reçue : {row.label}', 'candidat')
    db.commit()
    return {'status': 'received'}


@router.get('/tips')
def emploi_tips(db: Session = Depends(get_db)):
    """Conseils publiés par le recrutement : contenu éditorial, sans connexion."""
    from app.modules.recruitment_engage_models import RecruitmentTip as Tip
    rows = db.scalars(select(Tip).where(Tip.status == 'published').order_by(Tip.id.desc())).all()
    return {'items': [{'id': row.id, 'title': row.title, 'summary': row.summary, 'body': row.body, 'category': row.category,
                       'minutes': row.minutes} for row in rows]}
