"""IRON Emploi — gestion des annonces par les recruteurs (recrute.irongs.com)."""
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.scope_policy import society_scope
from app.db.session import get_db
from app.modules import recruitment_jobs_service as jobs
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh.models import Candidate
from app.modules.drh.routes import _ensure_recruitment_access, _society_key, _ventilation_targets
from app.modules.public_candidates import _public_candidate_state
from app.modules.recruitment_jobs_models import (
    OFFER_CLOSED, OFFER_DRAFT, OFFER_PUBLISHED, RecruitmentApplication as Application, RecruitmentCompany as Company,
    RecruitmentJobOffer as Offer,
)

router = APIRouter(dependencies=[Depends(current_user)])

Text150 = Annotated[str | None, Field(default=None, max_length=150)]
LongText = Annotated[str | None, Field(default=None, max_length=6000)]


class OfferIn(BaseModel):
    society: Annotated[str, Field(min_length=1, max_length=150)]
    title: Annotated[str, Field(min_length=2, max_length=150)]
    profession: Text150
    wilaya: Annotated[str | None, Field(default=None, max_length=120)]
    location: Annotated[str | None, Field(default=None, max_length=200)]
    contract_type: Annotated[str | None, Field(default=None, max_length=40)]
    positions: Annotated[int, Field(default=1, ge=1, le=999)]
    missions: LongText
    profile: LongText
    description: LongText
    reference: Annotated[str | None, Field(default=None, max_length=60)]
    deadline: date | None = None

    @field_validator('profession', 'wilaya', 'location', 'contract_type', 'missions', 'profile', 'description', 'reference', mode='before')
    @classmethod
    def blank_is_none(cls, value):
        return (value.strip() or None) if isinstance(value, str) else value

    @field_validator('deadline', mode='before')
    @classmethod
    def empty_deadline(cls, value):
        return None if value == '' else value


class CompanyIn(BaseModel):
    name: Annotated[str, Field(min_length=2, max_length=150)]
    sector: Annotated[str | None, Field(default=None, max_length=120)]
    city: Annotated[str | None, Field(default=None, max_length=120)]
    description: Annotated[str | None, Field(default=None, max_length=4000)]
    website: Annotated[str | None, Field(default=None, max_length=200, pattern=r'^(https://[^\s]+)?$')]
    logo_path: Annotated[str | None, Field(default=None, max_length=200)]
    is_active: bool = True


def _recruiter(user: User = Depends(current_user)) -> User:
    _ensure_recruitment_access(user)
    return user


def _allowed_society(db: Session, user: User, society: str) -> str:
    """Libellé canonique de la société si elle est dans le périmètre du recruteur, sinon 403."""
    for label in _ventilation_targets(db, user):
        if _society_key(label) == _society_key(society):
            return label
    raise HTTPException(status_code=403, detail='Société non autorisée')


def _company_in_scope(user: User, company: Company | None) -> Company:
    # Hors périmètre ou inexistant : même refus, pour ne rien révéler des autres sociétés.
    if company is None or not society_scope(user).allows(company.society):
        raise HTTPException(status_code=404, detail='Introuvable.')
    return company


def _offer(db: Session, user: User, offer_id: int, *, lock: bool = False) -> tuple[Offer, Company]:
    stmt = select(Offer).where(Offer.id == offer_id)
    offer = db.scalar(stmt.with_for_update() if lock else stmt)
    if offer is None:
        raise HTTPException(status_code=404, detail='Introuvable.')
    return offer, _company_in_scope(user, db.get(Company, offer.company_id))


def _audit(db: Session, request: Request, user: User, action: str, offer: Offer, company: Company) -> None:
    append_audit(db, action=f'recruitment.job_offer.{action}', resource='job_offer', resource_id=offer.id, result='success',
                 user=user, request=request, society=company.society, new_state={'status': offer.status, 'title': offer.title})


def _apply(offer: Offer, payload: OfferIn, user: User) -> None:
    if payload.contract_type and payload.contract_type not in jobs.CONTRACT_TYPES:
        raise HTTPException(status_code=422, detail='Type de contrat inconnu.')
    for field in ('title', 'profession', 'wilaya', 'location', 'contract_type', 'positions', 'missions', 'profile', 'description', 'reference', 'deadline'):
        setattr(offer, field, getattr(payload, field))
    offer.title = offer.title.strip()
    offer.updated_by = user.username


@router.get('/meta')
def job_offers_meta(db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    return {'societies': _ventilation_targets(db, user), 'contract_types': list(jobs.CONTRACT_TYPES),
            'logos': [{'path': path, 'label': label} for path, label in jobs.COMPANY_LOGOS.items()]}


@router.get('')
def job_offers(db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = society_scope(user)
    rows = [(offer, company) for offer, company in db.execute(
        select(Offer, Company).join(Company, Company.id == Offer.company_id).order_by(Offer.id.desc())).all() if scope.allows(company.society)]
    counts = jobs.application_counts(db, [offer.id for offer, _ in rows])
    return {'items': [jobs.offer_staff(offer, company, counts.get(offer.id, 0)) for offer, company in rows]}


@router.post('', status_code=201)
def create_job_offer(payload: OfferIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    company = jobs.company_for_society(db, _allowed_society(db, user, payload.society))
    offer = Offer(company_id=company.id, status=OFFER_DRAFT, created_by=user.username, title=payload.title)
    _apply(offer, payload, user)
    db.add(offer)
    db.flush()
    _audit(db, request, user, 'create', offer, company)
    db.commit()
    return jobs.offer_staff(offer, company)


@router.get('/companies')
def job_companies(db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = society_scope(user)
    return {'items': [jobs.company_staff(row) for row in db.scalars(select(Company).order_by(Company.name)).all() if scope.allows(row.society)]}


@router.put('/companies/{company_id}')
def update_job_company(company_id: int, payload: CompanyIn, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    company = _company_in_scope(user, db.get(Company, company_id))
    if payload.logo_path and payload.logo_path not in jobs.COMPANY_LOGOS:
        raise HTTPException(status_code=422, detail='Logo inconnu.')
    for field, value in payload.model_dump().items():
        setattr(company, field, (value.strip() or None) if isinstance(value, str) and field != 'name' else value)
    company.name = payload.name.strip()
    db.commit()
    return jobs.company_staff(company)


@router.get('/{offer_id}')
def job_offer(offer_id: int, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    offer, company = _offer(db, user, offer_id)
    return jobs.offer_staff(offer, company, jobs.application_counts(db, [offer.id]).get(offer.id, 0))


@router.put('/{offer_id}')
def update_job_offer(offer_id: int, payload: OfferIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    offer, company = _offer(db, user, offer_id, lock=True)
    if _society_key(payload.society) != _society_key(company.society):
        if jobs.application_counts(db, [offer.id]):
            raise HTTPException(status_code=409, detail='Cette annonce a déjà reçu des candidatures : sa société ne peut plus changer.')
        company = jobs.company_for_society(db, _allowed_society(db, user, payload.society))
        offer.company_id = company.id
    _apply(offer, payload, user)
    if offer.status == OFFER_PUBLISHED:
        # Une annonce en ligne doit rester complète.
        jobs.ensure_publishable(offer)
    _audit(db, request, user, 'update', offer, company)
    db.commit()
    return jobs.offer_staff(offer, company, jobs.application_counts(db, [offer.id]).get(offer.id, 0))


@router.post('/{offer_id}/publish')
def publish_job_offer(offer_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    offer, company = _offer(db, user, offer_id, lock=True)
    jobs.ensure_publishable(offer)
    if not company.is_active:
        raise HTTPException(status_code=409, detail='La fiche de cette société est désactivée.')
    if offer.status != OFFER_PUBLISHED:
        offer.status, offer.published_at, offer.closed_at, offer.updated_by = OFFER_PUBLISHED, datetime.utcnow(), None, user.username
        _audit(db, request, user, 'publish', offer, company)
    db.commit()
    return jobs.offer_staff(offer, company, jobs.application_counts(db, [offer.id]).get(offer.id, 0))


@router.post('/{offer_id}/close')
def close_job_offer(offer_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    offer, company = _offer(db, user, offer_id, lock=True)
    if offer.status == OFFER_DRAFT:
        raise HTTPException(status_code=409, detail='Un brouillon ne se clôture pas : il n’a jamais été publié.')
    if offer.status != OFFER_CLOSED:
        offer.status, offer.closed_at, offer.updated_by = OFFER_CLOSED, datetime.utcnow(), user.username
        _audit(db, request, user, 'close', offer, company)
    db.commit()
    return jobs.offer_staff(offer, company, jobs.application_counts(db, [offer.id]).get(offer.id, 0))


@router.delete('/{offer_id}', status_code=204)
def delete_job_offer(offer_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_recruitment_access(user, destructive=True)
    offer, company = _offer(db, user, offer_id, lock=True)
    if offer.status != OFFER_DRAFT or jobs.application_counts(db, [offer.id]):
        raise HTTPException(status_code=409, detail='Seul un brouillon sans candidature peut être supprimé. Clôturez l’annonce à la place.')
    _audit(db, request, user, 'delete', offer, company)
    db.delete(offer)
    db.commit()


@router.get('/{offer_id}/applications')
def job_offer_applications(offer_id: int, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    offer, company = _offer(db, user, offer_id)
    rows = db.execute(select(Application, Candidate).join(Candidate, Candidate.id == Application.candidate_id)
                      .where(Application.offer_id == offer.id).order_by(Application.created_at.desc(), Application.id.desc())).all()
    items = []
    for application, candidate in rows:
        state = _public_candidate_state(candidate)
        items.append({'application_id': application.id, 'applied_at': application.created_at.isoformat() if application.created_at else None,
                      'candidate': {'id': candidate.id, 'first_name': candidate.first_name, 'last_name': candidate.last_name,
                                    'phone': candidate.phone, 'society': candidate.society, 'status': candidate.status,
                                    'has_cv': bool((candidate.data or {}).get('cv'))},
                      'state': {'code': state['status'], 'label': state['label']}})
    return {'offer': jobs.offer_staff(offer, company, len(items)), 'items': items}
