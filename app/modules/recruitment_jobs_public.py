"""IRON Emploi — API publique : annonces ouvertes (sans connexion) et espace candidat (session SMS)."""
import base64
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, ValidationError, create_model
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, undefer

from app.core.candidate_cv import MAX_CV_BYTES, validate_cv
from app.core.config import settings
from app.db.session import get_db
from app.modules import recruitment_jobs_service as jobs
from app.modules import recruitment_sms_service as sms
from app.modules.public_candidates import (
    PublicCandidateIn, PublicCVIn, _gateway_connected, _mobile_token, _public_candidate_row, _public_candidate_state, _sms_call,
    candidate_reference, check_birth_date,
)
from app.modules.recruitment_jobs_models import (
    RecruitmentApplication as Application, RecruitmentCandidateAccount as Account, RecruitmentCompany as Company, RecruitmentJobOffer as Offer,
)

router = APIRouter()

# Le profil reprend les champs du formulaire de candidature, tous facultatifs tant qu'on ne postule pas.
_NOT_IN_PROFILE = {'cv', 'first_name', 'last_name', 'phone', 'photo_data', 'consent', 'company', 'society', 'desired_position'}
EmploiProfileIn = create_model(
    'EmploiProfileIn',
    desired_position=(Annotated[str | None, Field(default=None, max_length=150)], None),
    **{name: (field.annotation, field) for name, field in PublicCandidateIn.model_fields.items() if name not in _NOT_IN_PROFILE},
)


class EmploiPhotoIn(BaseModel):
    photo_data: Annotated[str, Field(max_length=2_000_000)]


class EmploiApplicationIn(BaseModel):
    offer_id: int | None = None
    request_id: Annotated[str, Field(min_length=8, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')]
    desired_position: Annotated[str | None, Field(default=None, max_length=150)]
    message: Annotated[str | None, Field(default=None, max_length=1500)]
    consent: bool
    profile: EmploiProfileIn | None = None


def _account(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> Account:
    return jobs.account_from_token(db, settings.jwt_secret, _mobile_token(authorization))


def _save_profile(account: Account, payload) -> None:
    try:
        check_birth_date(payload.birth_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    account.profile = payload.model_dump(mode='json')


def _account_out(account: Account, *, has_photo: bool) -> dict:
    return {'first_name': account.first_name, 'last_name': account.last_name, 'phone': account.phone,
            'profile': account.profile or {}, 'cv': account.cv_meta, 'has_photo': has_photo,
            'created_at': account.created_at.isoformat() if account.created_at else None}


def _dossier_state(candidate) -> tuple[str, dict]:
    state = _public_candidate_state(candidate)
    state.pop('position', None)
    return state.pop('reference'), state


def _application_out(db: Session, application: Application, candidate, offer: Offer | None, company: Company | None) -> dict:
    reference, dossier_state = _dossier_state(candidate)
    # Candidature à une annonce : son propre état. Spontanée ou historique : l'état du dossier.
    result = {'id': application.id, 'kind': 'offer' if application.offer_id else 'spontaneous', 'position': application.position or '',
              'submitted_at': application.created_at.isoformat() if application.created_at else None, 'reference': reference,
              'state': jobs.application_state(application) if application.offer_id else dossier_state, 'offer': None}
    from app.modules import recruitment_engage_service as engage
    result.update(engage.candidate_extras(db, application))
    if offer is not None and company is not None:
        # Une annonce clôturée reste nommée dans le suivi du candidat, sans redevenir consultable.
        result['offer'] = {'id': offer.id, 'title': offer.title, 'company': jobs.company_public(company),
                           'wilaya': offer.wilaya, 'contract_type': offer.contract_type, 'open': jobs.is_open(offer)}
    return result


@router.get('/config')
def emploi_config(db: Session = Depends(get_db)):
    return {'version': jobs.API_VERSION, 'sms_available': _gateway_connected(db), 'cv_max_bytes': MAX_CV_BYTES,
            'cv_types': ['application/pdf', 'image/jpeg', 'image/png'], 'contract_types': list(jobs.CONTRACT_TYPES),
            'session_ttl': jobs.SESSION_TTL}


@router.get('/offers')
def emploi_offers(q: str | None = Query(default=None, max_length=100), wilaya: str | None = Query(default=None, max_length=120),
                  profession: str | None = Query(default=None, max_length=150), contract_type: str | None = Query(default=None, max_length=40),
                  company_id: int | None = None, page: int = Query(default=1, ge=1, le=10_000), page_size: int = Query(default=20, ge=1, le=50),
                  db: Session = Depends(get_db)):
    return jobs.list_public_offers(db, q=q, wilaya=wilaya, profession=profession, company_id=company_id, contract_type=contract_type,
                                   page=page, page_size=page_size)


@router.get('/offers/{offer_id}')
def emploi_offer(offer_id: int, db: Session = Depends(get_db)):
    return jobs.public_offer(db, offer_id)


@router.get('/companies')
def emploi_companies(db: Session = Depends(get_db)):
    return jobs.public_companies(db)


@router.get('/companies/{company_id}')
def emploi_company(company_id: int, db: Session = Depends(get_db)):
    return jobs.public_company(db, company_id)


@router.post('/session', status_code=201)
def emploi_open_session(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    """Échange l'accès court délivré par la validation SMS contre une session d'espace candidat."""
    challenge = _sms_call(sms.identity, db, settings.jwt_secret, _mobile_token(authorization))
    try:
        account, token = jobs.open_session(db, settings.jwt_secret, challenge)
    except IntegrityError:
        # Deux validations simultanées du même numéro : la seconde retrouve l'espace créé par la première.
        db.rollback()
        account, token = jobs.open_session(db, settings.jwt_secret, challenge)
    return {'session_token': token, 'expires_in': jobs.SESSION_TTL, 'account': _account_out(account, has_photo=False)}


@router.delete('/session', status_code=204)
def emploi_close_session(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    jobs.close_session(db, settings.jwt_secret, _mobile_token(authorization))
    return Response(status_code=204)


@router.get('/me')
def emploi_me(account: Account = Depends(_account), db: Session = Depends(get_db)):
    has_photo = bool(db.scalar(select(Account.id).where(Account.id == account.id, Account.photo.is_not(None))))
    return _account_out(account, has_photo=has_photo)


@router.delete('/me', status_code=204)
def emploi_delete_account(account: Account = Depends(_account), db: Session = Depends(get_db)):
    jobs.delete_account(db, account)
    return Response(status_code=204)


@router.put('/me/profile')
def emploi_save_profile(payload: EmploiProfileIn, account: Account = Depends(_account), db: Session = Depends(get_db)):
    _save_profile(account, payload)
    db.commit()
    return {'profile': account.profile}


@router.put('/me/cv')
def emploi_save_cv(payload: PublicCVIn, account: Account = Depends(_account), db: Session = Depends(get_db)):
    account.cv_meta, account.cv_content = validate_cv(payload.model_dump())
    db.commit()
    return {'cv': account.cv_meta}


@router.get('/me/cv')
def emploi_download_cv(account: Account = Depends(_account), db: Session = Depends(get_db)):
    content = db.scalar(select(Account.cv_content).where(Account.id == account.id))
    if not content or not account.cv_meta:
        raise HTTPException(status_code=404, detail='Aucun CV enregistré.')
    return Response(content=base64.b64decode(content), media_type=account.cv_meta['mime_type'],
                    headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment; filename="CV"'})


@router.delete('/me/cv', status_code=204)
def emploi_delete_cv(account: Account = Depends(_account), db: Session = Depends(get_db)):
    account.cv_meta, account.cv_content = None, None
    db.commit()
    return Response(status_code=204)


@router.put('/me/photo')
def emploi_save_photo(payload: EmploiPhotoIn, account: Account = Depends(_account), db: Session = Depends(get_db)):
    if not payload.photo_data.startswith('data:image/jpeg;base64,'):
        raise HTTPException(status_code=422, detail='Le format de la photo est invalide')
    account.photo = payload.photo_data
    db.commit()
    return {'has_photo': True}


@router.get('/me/photo')
def emploi_photo(account: Account = Depends(_account), db: Session = Depends(get_db)):
    photo = db.scalar(select(Account.photo).where(Account.id == account.id))
    if not photo:
        raise HTTPException(status_code=404, detail='Aucune photo enregistrée.')
    return {'photo_data': photo}


@router.delete('/me/photo', status_code=204)
def emploi_delete_photo(account: Account = Depends(_account), db: Session = Depends(get_db)):
    account.photo = None
    db.commit()
    return Response(status_code=204)


def _applications(db: Session, account: Account, application_id: int | None = None) -> list[dict]:
    stmt = (select(Application, Offer, Company).outerjoin(Offer, Offer.id == Application.offer_id).outerjoin(Company, Company.id == Offer.company_id)
            .where(Application.account_id == account.id).order_by(Application.created_at.desc(), Application.id.desc()))
    if application_id is not None:
        stmt = stmt.where(Application.id == application_id)
    candidate = jobs.dossier(db, account)
    # Dossier supprimé par le recrutement : ses candidatures disparaissent avec lui.
    return [_application_out(db, application, candidate, offer, company) for application, offer, company in db.execute(stmt).all()
            if candidate is not None and application.candidate_id == candidate.id]


@router.get('/applications')
def emploi_applications(account: Account = Depends(_account), db: Session = Depends(get_db)):
    candidate = jobs.dossier(db, account)
    dossier = None
    if candidate is not None:
        reference, state = _dossier_state(candidate)
        # Le dossier porte ce qui vaut pour la personne, quelle que soit l'annonce : une convocation, par exemple.
        dossier = {'reference': reference, 'state': state}
    return {'items': _applications(db, account), 'dossier': dossier}


@router.get('/applications/{application_id}')
def emploi_application(application_id: int, account: Account = Depends(_account), db: Session = Depends(get_db)):
    # Filtré par l'espace du demandeur : la candidature d'un autre candidat répond 404.
    rows = _applications(db, account, application_id)
    if not rows:
        raise HTTPException(status_code=404, detail='Candidature introuvable.')
    return rows[0]


def _received(db: Session, account: Account, application: Application, *, already: bool) -> dict:
    return {'status': 'received', 'application_id': application.id, 'reference': candidate_reference(jobs.dossier(db, account)),
            'already_applied': already}


@router.post('/applications', status_code=201)
def emploi_apply(payload: EmploiApplicationIn, request: Request, response: Response,
                 authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    # Verrou sur l'espace candidat : deux envois simultanés (double clic, relance) passent l'un après l'autre.
    account = jobs.account_from_token(db, settings.jwt_secret, _mobile_token(authorization), lock=True)
    if not payload.consent:
        raise HTTPException(status_code=422, detail='Le consentement est obligatoire')
    repeated = db.scalar(select(Application).where(Application.account_id == account.id, Application.request_id == payload.request_id))
    if repeated is not None and jobs.dossier(db, account) is not None:
        return _received(db, account, repeated, already=False)

    offer = company = None
    if payload.offer_id is not None:
        row = db.execute(select(Offer, Company).join(Company, Company.id == Offer.company_id).where(Offer.id == payload.offer_id)).first()
        # Contrôle fait ici, au moment de l'envoi : l'annonce a pu être clôturée depuis son affichage.
        if row is None or row[0].published_at is None or not row[1].is_active:
            raise HTTPException(status_code=404, detail='Cette annonce n’est plus disponible.')
        offer, company = row
        if not jobs.is_open(offer):
            raise HTTPException(status_code=409, detail='Cette annonce est clôturée et n’accepte plus de candidature.')
    if payload.profile is not None:
        _save_profile(account, payload.profile)
    profile = dict(account.profile or {})
    position = (offer.title if offer else (payload.desired_position or profile.get('desired_position') or '')).strip()
    if len(position) < 2:
        raise HTTPException(status_code=422, detail='Indiquez le poste souhaité.')

    candidate = jobs.dossier(db, account)
    if candidate is not None:
        existing = db.scalar(select(Application).where(Application.candidate_id == candidate.id,
                             Application.offer_id == offer.id if offer else Application.offer_id.is_(None)))
        if existing is not None:
            db.commit()
            response.status_code = 200
            return _received(db, account, existing, already=True)

    entry = {'offreId': offer.id if offer else None, 'poste': position, 'societe': company.society if company else '',
             'at': datetime.utcnow().isoformat()}
    full = db.execute(select(Account).options(undefer(Account.cv_content), undefer(Account.photo)).where(Account.id == account.id)
                      .execution_options(populate_existing=True)).scalar_one()
    try:
        if candidate is None:
            profile.pop('desired_position', None)
            try:
                form = PublicCandidateIn(**profile, first_name=account.first_name, last_name=account.last_name, phone=account.phone,
                                         desired_position=position, consent=True, photo_data=full.photo,
                                         cv=({**full.cv_meta, 'data_base64': full.cv_content} if full.cv_meta and full.cv_content else None))
            except ValidationError as exc:
                raise HTTPException(status_code=422, detail='Votre profil est incomplet ou invalide : ' + exc.errors()[0]['msg']) from exc
            try:
                candidate = _public_candidate_row(form, request, db, commit=False, verified=True,
                                                  extra_data={'sourceExterne': 'iron_emploi', 'candidaturesEmploi': [entry]})
            except HTTPException as exc:
                if exc.status_code == 409:
                    # Le message interne cite un numéro de dossier : il ne sort pas vers le public.
                    raise HTTPException(status_code=409, detail='Un dossier à votre nom existe déjà auprès du recrutement. '
                                        'Contactez le service recrutement pour le rattacher à votre espace candidat.') from exc
                raise
            account.candidate_id = candidate.id
        else:
            data = dict(candidate.data) if isinstance(candidate.data, dict) else {}
            data['candidaturesEmploi'] = [*(data.get('candidaturesEmploi') or [])[-49:], entry]
            data['auditTrail'] = [*(data.get('auditTrail') or [])[-99:],
                                  {'action': 'candidature_emploi', 'by': 'iron-emploi', 'at': entry['at'], 'offre': entry['offreId']}]
            # Le CV du dossier n'est pas remplacé : chaque candidature garde ses propres pièces (ci-dessous).
            candidate.data = data
        application = Application(account_id=account.id, candidate_id=candidate.id, offer_id=offer.id if offer else None,
                                  position=position, request_id=payload.request_id, source='mobile',
                                  message=(payload.message or '').strip() or None)
        db.add(application)
        db.flush()
        # Pièces figées à la réception, événement d'historique et accusé de réception dans l'espace du candidat.
        from app.modules import recruitment_engage_service as engage
        pieces = engage.snapshot_documents(db, application, full)
        engage.log_event(db, application, 'reception', f'Candidature reçue depuis IRON Emploi ({pieces} pièce(s) jointe(s))', 'candidat')
        engage.notify(db, account.id, 'application', 'Candidature reçue', f'{position} — votre candidature a bien été transmise au service recrutement.',
                      application_id=application.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail='Cette candidature a déjà été enregistrée. Consultez « Mes candidatures ».')
    except Exception:
        db.rollback()
        raise
    return _received(db, account, application, already=False)
