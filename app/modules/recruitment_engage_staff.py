"""IRON Emploi — traitement des candidatures par les recruteurs (recrute.irongs.com) :
tableau de bord, dossier, pièces, notes, échanges, entretiens, contrat, passage à la DRH, conseils."""
import base64
from datetime import date, datetime
from io import BytesIO
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, undefer

from app.core.audit import append_audit
from app.core.scope_policy import society_key, society_scope
from app.db.session import get_db
from app.modules import recruitment_convocation_pdf as pdf
from app.modules import recruitment_convocations as conv
from app.modules import recruitment_engage_service as engage
from app.modules import recruitment_jobs_service as jobs
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh import service as drh_service
from app.modules.drh.models import Candidate, ContractTemplate
from app.modules.drh.routes import _can_ventilate, _ensure_recruitment_access, _society_key
from app.modules.drh.schemas import DirectContractRequest
from app.modules.public_candidates import _public_candidate_state, candidate_reference
from app.modules.recruitment_engage_models import (
    CANDIDATE, INTERVIEW_CANCELLED, INTERVIEW_CONFIRMED, INTERVIEW_DONE, INTERVIEW_DRAFT, INTERVIEW_NO_SHOW, INTERVIEW_PROPOSED, RECRUITER,
    RecruitmentConvocationVersion as ConvocationVersion,
    RecruitmentApplicationContract as Contract, RecruitmentApplicationDocument as Document, RecruitmentApplicationEvent as Event,
    RecruitmentApplicationNote as Note, RecruitmentDocumentRequest as DocumentRequest, RecruitmentInterview as Interview,
    RecruitmentMessage as Message, RecruitmentTip as Tip,
)
from app.modules.recruitment_jobs_models import (
    RecruitmentApplication as Application, RecruitmentCompany as Company, RecruitmentJobOffer as Offer,
)

router = APIRouter(dependencies=[Depends(current_user)])
ClientId = Annotated[str, Field(min_length=8, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')]
HIRED_STATUSES = {'embauche', 'recrute', 'recrutee'}


def _recruiter(user: User = Depends(current_user)) -> User:
    _ensure_recruitment_access(user)
    return user


class Scope:
    """Candidature et tout ce qui s'y rattache, déjà contrôlée pour le recruteur."""
    def __init__(self, application: Application, offer: Offer | None, company: Company | None, candidate: Candidate):
        self.application, self.offer, self.company, self.candidate = application, offer, company, candidate

    @property
    def society(self) -> str | None:
        return self.company.society if self.company else self.candidate.society

    @property
    def title(self) -> str:
        return (self.offer.title if self.offer else self.application.position) or 'Candidature'


def _scope(db: Session, user: User, application_id: int, *, lock: bool = False) -> Scope:
    stmt = select(Application).where(Application.id == application_id)
    application = db.scalar(stmt.with_for_update() if lock else stmt)
    offer = db.get(Offer, application.offer_id) if application is not None and application.offer_id else None
    company = db.get(Company, offer.company_id) if offer else None
    candidate = db.get(Candidate, application.candidate_id) if application is not None else None
    # Candidature d'une annonce : périmètre société du recruteur. Spontanée : vivier commun du recrutement.
    # Hors périmètre ou inconnue : même réponse.
    if application is None or candidate is None or (company is not None and not society_scope(user).allows(company.society)):
        raise HTTPException(status_code=404, detail='Introuvable.')
    return Scope(application, offer, company, candidate)


def _audit(db: Session, request: Request, user: User, action: str, scope: Scope, **state) -> None:
    append_audit(db, action=f'recruitment.job_application.{action}', resource='job_application', resource_id=scope.application.id,
                 result='success', user=user, request=request, society=scope.society, new_state=state or None)


def _hired(candidate: Candidate) -> bool:
    return jobs.text_key(candidate.status) in HIRED_STATUSES


def _contracts(db: Session, ids: list[int]) -> dict[int, Contract]:
    return {row.application_id: row for row in db.scalars(select(Contract).where(Contract.application_id.in_(ids))).all()} if ids else {}


def _summary(scope: Scope, *, contract: Contract | None, unread: int = 0, next_interview: Interview | None = None,
             missing: int = 0, documents: int = 0) -> dict:
    a, visible = scope.application, jobs.application_state(scope.application)
    stage = 'hired' if _hired(scope.candidate) and a.outcome == 'favorable' else a.stage
    return {
        'id': a.id, 'reference': candidate_reference(scope.candidate), 'kind': 'offer' if a.offer_id else 'spontaneous', 'title': scope.title,
        'offer': {'id': scope.offer.id, 'title': scope.offer.title, 'wilaya': scope.offer.wilaya, 'status': jobs.staff_status(scope.offer)} if scope.offer else None,
        'society': scope.society, 'received_at': engage.iso(a.created_at),
        'candidate': {'id': scope.candidate.id, 'first_name': scope.candidate.first_name, 'last_name': scope.candidate.last_name,
                      'phone': scope.candidate.phone, 'wilaya': (scope.candidate.data or {}).get('wilaya') or ''},
        'stage': stage, 'stage_label': engage.STAGES[stage], 'outcome': a.outcome, 'outcome_label': engage.OUTCOMES[a.outcome],
        'outcome_communicated': a.outcome_communicated_at is not None, 'visible_state': {'code': visible['status'], 'label': visible['label']},
        'assigned_to': a.assigned_to, 'next_action': a.next_action, 'next_action_due': a.next_action_due.isoformat() if a.next_action_due else None,
        'contract_state': contract.state if contract else None, 'contract_label': engage.CONTRACT_STATES[contract.state] if contract else None,
        'unread_messages': unread, 'missing_documents': missing, 'documents': documents,
        'next_interview': {'id': next_interview.id, 'starts_at': engage.iso(next_interview.starts_at), 'status': next_interview.status} if next_interview else None,
    }


# ── Tableau de bord ─────────────────────────────────────────────────────────

BUCKETS = {
    'new': 'Nouvelles candidatures', 'review': 'Dossiers à examiner', 'shortlisted': 'Présélections', 'interviews': 'Entretiens à venir',
    'missing_documents': 'Pièces manquantes', 'decisions': 'Décisions en attente', 'contracts_prepare': 'Contrats à préparer',
    'contracts_sign': 'Contrats à signer', 'hired': 'Recrutements finalisés',
}


def _bucket_of(item: dict) -> set[str]:
    closed = item['outcome'] in ('unfavorable', 'withdrawn')
    found = set()
    if item['stage'] == 'hired':
        return {'hired'}
    if closed and item['outcome_communicated'] or item['outcome'] == 'withdrawn':
        return found
    if item['stage'] == 'received':
        found.add('new')
    if item['stage'] == 'review':
        found.add('review')
    if item['stage'] in ('shortlisted', 'convocation'):
        found.add('shortlisted')
    if item['next_interview']:
        found.add('interviews')
    if item['missing_documents']:
        found.add('missing_documents')
    if (item['stage'] == 'decision' and item['outcome'] == 'pending') or (item['outcome'] in ('favorable', 'unfavorable') and not item['outcome_communicated']):
        found.add('decisions')
    if item['outcome'] == 'favorable' and item['outcome_communicated'] and not item['contract_state']:
        found.add('contracts_prepare')
    if item['contract_state'] in ('prepared', 'sent'):
        found.add('contracts_sign')
    return found


@router.get('/workspace')
def workspace(society: str | None = None, offer_id: int | None = None, q: str | None = None, wilaya: str | None = None,
              assigned_to: str | None = None, stage: str | None = None, date_from: date | None = None, date_to: date | None = None,
              bucket: str | None = None, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope_policy = society_scope(user)
    rows = db.execute(select(Application, Offer, Company, Candidate).join(Candidate, Candidate.id == Application.candidate_id)
                      .outerjoin(Offer, Offer.id == Application.offer_id).outerjoin(Company, Company.id == Offer.company_id)
                      .order_by(Application.created_at.desc(), Application.id.desc())).all()
    scopes = [Scope(a, o, c, cand) for a, o, c, cand in rows if c is None or scope_policy.allows(c.society)]
    ids = [s.application.id for s in scopes]
    contracts, unread = _contracts(db, ids), engage.unread_counts(db, ids, RECRUITER)
    upcoming: dict[int, Interview] = {}
    for row in (db.scalars(select(Interview).where(Interview.application_id.in_(ids), Interview.status.in_([INTERVIEW_PROPOSED, INTERVIEW_CONFIRMED]),
                                                    Interview.starts_at >= engage.now_local()).order_by(Interview.starts_at.desc())).all() if ids else []):
        upcoming[row.application_id] = row
    missing = dict(db.execute(select(DocumentRequest.application_id, func.count()).where(
        DocumentRequest.application_id.in_(ids), DocumentRequest.status == 'requested').group_by(DocumentRequest.application_id)).all()) if ids else {}
    documents = dict(db.execute(select(Document.application_id, func.count()).where(Document.application_id.in_(ids))
                                .group_by(Document.application_id)).all()) if ids else {}
    items = [_summary(s, contract=contracts.get(s.application.id), unread=unread.get(s.application.id, 0),
                      next_interview=upcoming.get(s.application.id), missing=missing.get(s.application.id, 0),
                      documents=documents.get(s.application.id, 0)) for s in scopes]
    words = jobs.text_key(q).split()

    def keep(item: dict) -> bool:
        day = (item['received_at'] or '')[:10]
        haystack = jobs.text_key(' '.join(filter(None, [item['title'], item['candidate']['first_name'], item['candidate']['last_name'],
                                                          item['candidate']['phone'], item['reference']])))
        return ((not society or _society_key(item['society']) == _society_key(society)) and (not offer_id or (item['offer'] or {}).get('id') == offer_id)
                and (not wilaya or jobs.text_key((item['offer'] or {}).get('wilaya') or item['candidate']['wilaya']) == jobs.text_key(wilaya))
                and (not assigned_to or (item['assigned_to'] or '') == ('' if assigned_to == '__none__' else assigned_to))
                and (not stage or item['stage'] == stage) and (not date_from or day >= date_from.isoformat())
                and (not date_to or day <= date_to.isoformat()) and all(word in haystack for word in words))
    filtered = [item for item in items if keep(item)]
    for item in filtered:
        item['buckets'] = sorted(_bucket_of(item))
    counters = {key: sum(1 for item in filtered if key in item['buckets']) for key in BUCKETS}
    shown = [item for item in filtered if not bucket or bucket in item['buckets']]
    offers = {s.offer.id: {'id': s.offer.id, 'title': s.offer.title, 'society': s.company.society} for s in scopes if s.offer}
    return {'counters': [{'key': key, 'label': label, 'count': counters[key]} for key, label in BUCKETS.items()],
            'items': shown, 'total': len(filtered),
            'stages': [{'code': code, 'label': label} for code, label in engage.STAGES.items()],
            'outcomes': [{'code': code, 'label': label} for code, label in engage.OUTCOMES.items()],
            'filters': {'offers': sorted(offers.values(), key=lambda o: jobs.text_key(o['title'])),
                        'societies': sorted({item['society'] for item in items if item['society']}, key=jobs.text_key),
                        'wilayas': sorted({(item['offer'] or {}).get('wilaya') or item['candidate']['wilaya'] for item in items} - {'', None}, key=jobs.text_key),
                        'recruiters': sorted({item['assigned_to'] for item in items if item['assigned_to']} | {user.username})}}


# ── Dossier d'une candidature ───────────────────────────────────────────────

def _document_out(row: Document) -> dict:
    return {'id': row.id, 'kind': row.kind, 'label': row.label, 'name': row.name, 'mime_type': row.mime_type, 'size': row.size,
            'source': row.source, 'received_at': engage.iso(row.created_at)}


def _request_out(row: DocumentRequest) -> dict:
    return {'id': row.id, 'label': row.label, 'note': row.note, 'due': row.due.isoformat() if row.due else None, 'status': row.status,
            'created_by': row.created_by, 'created_at': engage.iso(row.created_at), 'received_at': engage.iso(row.received_at)}


def _interview_staff(row: Interview, versions: list[ConvocationVersion] | None = None) -> dict:
    versions = versions or []
    return {'id': row.id, 'starts_at': engage.iso(row.starts_at), 'timezone': engage.TIMEZONE, 'location': row.location, 'contact': row.contact,
            'note': row.note, 'status': row.status, 'confirmed_at': engage.iso(row.confirmed_at), 'cancelled_at': engage.iso(row.cancelled_at),
            'previous_starts_at': engage.iso(row.previous_starts_at), 'report': row.report, 'appreciation': row.appreciation,
            'created_by': row.created_by, 'past': row.starts_at < engage.now_local(),
            # Convocation : contenu, versions envoyées et trois suivis distincts (lecture, réponse, arrivée).
            'reference': conv.reference(row), 'society': row.society, 'address': row.address, 'map_url': row.map_url,
            'contact_details': row.contact_details, 'purpose': row.purpose, 'documents_to_bring': row.documents_to_bring,
            'version': row.version, 'sent_at': engage.iso(row.sent_at), 'sent_by': row.sent_by,
            'viewed_by_candidate': bool(row.version) and (row.viewed_version or 0) >= row.version,
            'candidate_state': None if row.status == INTERVIEW_DRAFT or not row.version else conv.candidate_state(row),
            'candidate_state_label': None if row.status == INTERVIEW_DRAFT or not row.version else conv.STATES[conv.candidate_state(row)],
            'arrived_at': engage.iso(row.arrived_at), 'arrived_by': row.arrived_by, 'assessment': row.assessment,
            'can_confirm_arrival': row.status in conv.SENT_STATUSES and bool(row.version) and row.arrived_at is None
                                   and row.starts_at.date() == engage.now_local().date(),
            'versions': [{'version': item.version, 'issued_at': engage.iso(item.issued_at), 'issued_by': item.issued_by,
                          'starts_at': item.snapshot.get('starts_at'), 'state': conv.version_state(row, item)} for item in versions]}


def _contract_out(row: Contract | None) -> dict | None:
    if row is None:
        return None
    return {'template_id': row.template_id, 'society': row.society, 'position': row.position, 'contract_type': row.contract_type,
            'start_date': row.start_date.isoformat() if row.start_date else None, 'end_date': row.end_date.isoformat() if row.end_date else None,
            'work_place': row.work_place, 'salary_net': row.salary_net, 'conditions': row.conditions, 'state': row.state,
            'state_label': engage.CONTRACT_STATES[row.state], 'prepared_by': row.prepared_by, 'sent_at': engage.iso(row.sent_at),
            'signed_on': row.signed_on.isoformat() if row.signed_on else None, 'signed_recorded_by': row.signed_recorded_by,
            'shared_with_candidate': row.shared_with_candidate}


def _convocation_defaults(db: Session, user: User, scope: Scope) -> dict:
    """Ce que le formulaire de convocation préremplit : uniquement des données existantes, jamais inventées."""
    policy = society_scope(user)
    companies = db.scalars(select(Company).where(Company.is_active.is_(True)).order_by(Company.name)).all()
    choices = [{'society': row.society, 'name': row.name, 'logo': row.logo_path in jobs.COMPANY_LOGOS} for row in companies if policy.allows(row.society)]
    fixed = scope.company
    return {
        'candidate': f'{(scope.candidate.last_name or "").upper()} {scope.candidate.first_name or ""}'.strip(),
        'dossier_reference': candidate_reference(scope.candidate), 'application_reference': conv.application_reference(scope.application),
        'offer': {'title': scope.offer.title, 'reference': scope.offer.reference} if scope.offer else None, 'position': scope.title,
        'society': fixed.society if fixed else (scope.candidate.society if scope.candidate.society and policy.allows(scope.candidate.society) else None),
        'society_name': fixed.name if fixed else None, 'society_fixed': fixed is not None, 'societies': [] if fixed else choices,
        'logo_available': bool(fixed and fixed.logo_path in jobs.COMPANY_LOGOS),
        'location': scope.offer.location if scope.offer and scope.offer.location else None,
        'contact': user.full_name or None, 'contact_details': user.email or None, 'purpose': f'Entretien — {scope.title}',
        'has_account': scope.application.account_id is not None, 'has_email': bool(scope.candidate.email), 'timezone': engage.TIMEZONE,
    }


def _dossier(db: Session, user: User, scope: Scope) -> dict:
    a, candidate = scope.application, scope.candidate
    data = candidate.data if isinstance(candidate.data, dict) else {}
    documents = db.scalars(select(Document).where(Document.application_id == a.id).order_by(Document.id)).all()
    requests = db.scalars(select(DocumentRequest).where(DocumentRequest.application_id == a.id).order_by(DocumentRequest.id.desc())).all()
    interviews = db.scalars(select(Interview).where(Interview.application_id == a.id).order_by(Interview.starts_at.desc())).all()
    versions: dict[int, list[ConvocationVersion]] = {}
    for item in db.scalars(select(ConvocationVersion).where(ConvocationVersion.interview_id.in_([row.id for row in interviews]))
                           .order_by(ConvocationVersion.version.desc())).all() if interviews else []:
        versions.setdefault(item.interview_id, []).append(item)
    contract = db.scalar(select(Contract).where(Contract.application_id == a.id))
    upcoming = next((row for row in reversed(interviews) if row.status in (INTERVIEW_PROPOSED, INTERVIEW_CONFIRMED) and row.starts_at >= engage.now_local()), None)
    summary = _summary(scope, contract=contract, unread=engage.unread_counts(db, [a.id], RECRUITER).get(a.id, 0), next_interview=upcoming,
                       missing=sum(1 for row in requests if row.status == 'requested'), documents=len(documents))
    # Pièce du dossier historique (CV saisi sur le dossier) : signalée, servie par la route DRH existante.
    legacy_cv = data.get('cv') if isinstance(data.get('cv'), dict) and data.get('_cv_content') else None
    others = db.execute(select(Application, Offer, Company).outerjoin(Offer, Offer.id == Application.offer_id)
                        .outerjoin(Company, Company.id == Offer.company_id)
                        .where(Application.candidate_id == candidate.id, Application.id != a.id).order_by(Application.id.desc())).all()
    scope_policy = society_scope(user)
    dossier_state = _public_candidate_state(candidate)
    private = {key for key in data if key.startswith('_')} | {'photo', 'cvUpload', 'auditTrail', 'remoteAddress', 'candidaturesEmploi'}
    profile = a.profile_snapshot or {'first_name': candidate.first_name, 'last_name': candidate.last_name, 'phone': candidate.phone,
                                     'email': candidate.email, 'desired_position': candidate.desired_position, 'data': data}
    return {
        **summary, 'message': a.message, 'source': a.source,
        'profile': {**{key: profile.get(key) for key in ('first_name', 'last_name', 'phone', 'email', 'desired_position')},
                    'society': candidate.society, 'status': candidate.status,
                    'data': {key: value for key, value in (profile.get('data') or {}).items() if key not in private}},
        'dossier_state': {'code': dossier_state['status'], 'label': dossier_state['label']},
        'documents': [_document_out(row) for row in documents],
        'dossier_cv': {**legacy_cv, 'candidate_id': candidate.id} if legacy_cv else None,
        'document_requests': [_request_out(row) for row in requests],
        'notes': [{'id': row.id, 'author': row.author, 'body': row.body, 'created_at': engage.iso(row.created_at)}
                  for row in db.scalars(select(Note).where(Note.application_id == a.id).order_by(Note.id.desc())).all()],
        'history': [{'kind': row.kind, 'summary': row.summary, 'actor': row.actor, 'at': engage.iso(row.at)}
                    for row in db.scalars(select(Event).where(Event.application_id == a.id).order_by(Event.id.desc()).limit(200)).all()],
        'interviews': [_interview_staff(row, versions.get(row.id)) for row in interviews],
        'convocation_defaults': _convocation_defaults(db, user, scope),
        'dossier_convocation': (data.get('derniereConvocation') if isinstance(data.get('derniereConvocation'), dict) else None),
        'contract': _contract_out(contract),
        'employee_id': data.get('convertedEmployeeId'), 'drh_transfer': data.get('drhTransfer'),
        'other_applications': [{'id': other.id, 'title': (offer.title if offer else other.position) or 'Candidature',
                                'kind': 'offer' if other.offer_id else 'spontaneous', 'stage_label': engage.STAGES[other.stage]}
                               for other, offer, company in others if company is None or scope_policy.allows(company.society)],
    }


@router.get('/applications/{application_id}')
def application_dossier(application_id: int, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    return _dossier(db, user, _scope(db, user, application_id))


class ProcessingIn(BaseModel):
    stage: Annotated[str | None, Field(default=None, max_length=20)]
    outcome: Annotated[str | None, Field(default=None, max_length=20)]
    communicate: bool = False
    assigned_to: Annotated[str | None, Field(default=None, max_length=100)]
    next_action: Annotated[str | None, Field(default=None, max_length=200)]
    next_action_due: date | None = None


@router.put('/applications/{application_id}/processing')
def update_processing(application_id: int, payload: ProcessingIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = _scope(db, user, application_id, lock=True)
    a, fields, notifications = scope.application, payload.model_fields_set, []
    if a.withdrawn_at and fields & {'stage', 'outcome', 'communicate'}:
        raise HTTPException(status_code=409, detail='Le candidat a retiré cette candidature : son traitement est clos.')
    if 'assigned_to' in fields and (payload.assigned_to or None) != a.assigned_to:
        a.assigned_to = (payload.assigned_to or '').strip() or None
        engage.log_event(db, a, 'assignment', f'Attribuée à {a.assigned_to}' if a.assigned_to else 'Attribution retirée', user.username)
    if fields & {'next_action', 'next_action_due'}:
        if 'next_action' in fields:
            a.next_action = (payload.next_action or '').strip() or None
        if 'next_action_due' in fields:
            a.next_action_due = payload.next_action_due
        engage.log_event(db, a, 'next_action', f'Prochaine action : {a.next_action or "aucune"}'
                         + (f' (échéance {a.next_action_due.isoformat()})' if a.next_action_due else ''), user.username)
    if payload.outcome is not None and payload.outcome != a.outcome:
        if payload.outcome not in ('pending', 'favorable', 'unfavorable'):
            raise HTTPException(status_code=422, detail='Résultat de décision inconnu.')
        if a.outcome_communicated_at and a.outcome == 'favorable' and db.scalar(select(Contract.id).where(Contract.application_id == a.id)):
            raise HTTPException(status_code=409, detail='Un contrat est déjà préparé pour cette candidature : la décision ne peut plus changer.')
        a.outcome, a.outcome_communicated_at = payload.outcome, None
        if payload.outcome != 'pending' and engage.STAGE_ORDER.index(a.stage) < engage.STAGE_ORDER.index('decision'):
            a.stage = 'decision'
        engage.log_event(db, a, 'decision', f'Décision interne : {engage.OUTCOMES[a.outcome]} (non communiquée)', user.username)
    if payload.communicate:
        # Décision interne et communication au candidat sont deux gestes distincts.
        if a.outcome not in ('favorable', 'unfavorable'):
            raise HTTPException(status_code=409, detail='Aucune décision à communiquer.')
        if a.outcome_communicated_at is None:
            a.outcome_communicated_at = datetime.utcnow()
            engage.log_event(db, a, 'communication', f'Décision communiquée au candidat : {engage.OUTCOMES[a.outcome]}', user.username)
            notifications.append(engage.set_visible_status(db, a, 'accepted' if a.outcome == 'favorable' else 'declined', user.username))
    if payload.stage is not None and payload.stage != a.stage:
        if payload.stage not in engage.STAGES:
            raise HTTPException(status_code=422, detail='Étape inconnue.')
        after_decision = engage.STAGE_ORDER.index(payload.stage) > engage.STAGE_ORDER.index('decision')
        if after_decision and not (a.outcome == 'favorable' and a.outcome_communicated_at):
            raise HTTPException(status_code=409, detail='Cette étape demande une décision favorable communiquée au candidat.')
        if payload.stage in ('signature', 'hired'):
            contract = db.scalar(select(Contract).where(Contract.application_id == a.id))
            if contract is None:
                raise HTTPException(status_code=409, detail='Préparez d’abord le contrat.')
            if payload.stage == 'hired' and not (contract.state == 'signed' and _hired(scope.candidate)):
                raise HTTPException(status_code=409, detail='Le recrutement effectif suit la signature du contrat et la création de la fiche employé par la DRH.')
        a.stage = payload.stage
        engage.log_event(db, a, 'stage', f'Étape : {engage.STAGES[a.stage]}', user.username)
        if a.stage in engage.STAGE_VISIBLE and not a.outcome_communicated_at:
            notifications.append(engage.set_visible_status(db, a, engage.STAGE_VISIBLE[a.stage], user.username))
    _audit(db, request, user, 'processing', scope, stage=a.stage, outcome=a.outcome, communicated=a.outcome_communicated_at is not None,
           assigned_to=a.assigned_to)
    db.commit()
    engage.send_push(db, notifications)
    return _dossier(db, user, scope)


class NoteIn(BaseModel):
    body: Annotated[str, Field(min_length=1, max_length=4000)]


@router.post('/applications/{application_id}/notes', status_code=201)
def add_note(application_id: int, payload: NoteIn, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = _scope(db, user, application_id)
    db.add(Note(application_id=scope.application.id, author=user.username, body=payload.body.strip()))
    engage.log_event(db, scope.application, 'note', 'Note interne ajoutée', user.username)
    db.commit()
    return _dossier(db, user, scope)


# ── Pièces jointes ──────────────────────────────────────────────────────────

@router.get('/applications/{application_id}/documents/{document_id}')
def read_document(application_id: int, document_id: int, request: Request, download: bool = False, db: Session = Depends(get_db),
                  user: User = Depends(_recruiter)):
    """Contenu d'une pièce, réservé aux recruteurs habilités sur la candidature : jamais de lien public."""
    scope = _scope(db, user, application_id)
    row = db.scalar(select(Document).options(undefer(Document.content)).where(Document.id == document_id, Document.application_id == scope.application.id))
    if row is None:
        raise HTTPException(status_code=404, detail='Pièce introuvable.')
    if row.mime_type not in ('application/pdf', 'image/jpeg', 'image/png'):
        raise HTTPException(status_code=415, detail='Format de pièce non pris en charge.')
    try:
        content = base64.b64decode(row.content or '', validate=True)
    except ValueError:
        content = b''
    if not content:
        raise HTTPException(status_code=410, detail='Le contenu de cette pièce est indisponible.')
    _audit(db, request, user, 'document_download' if download else 'document_view', scope, document_id=row.id)
    db.commit()
    extension = {'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png'}[row.mime_type]
    disposition = 'attachment' if download else 'inline'
    return Response(content=content, media_type=row.mime_type, headers={
        'Content-Disposition': f'{disposition}; filename="{row.kind}-{scope.application.id}-{row.id}.{extension}"',
        'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"})


class DocumentRequestIn(BaseModel):
    label: Annotated[str, Field(min_length=2, max_length=150)]
    note: Annotated[str | None, Field(default=None, max_length=400)]
    due: date | None = None


@router.post('/applications/{application_id}/document-requests', status_code=201)
def request_document(application_id: int, payload: DocumentRequestIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = _scope(db, user, application_id)
    if scope.application.withdrawn_at:
        raise HTTPException(status_code=409, detail='Le candidat a retiré cette candidature.')
    db.add(DocumentRequest(application_id=scope.application.id, label=payload.label.strip(), note=(payload.note or '').strip() or None,
                           due=payload.due, created_by=user.username))
    engage.log_event(db, scope.application, 'document_request', f'Pièce demandée : {payload.label.strip()}', user.username)
    notification = engage.notify(db, scope.application.account_id, 'application', 'Pièce complémentaire demandée',
                                 f'{scope.title} — {payload.label.strip()}', application_id=scope.application.id)
    _audit(db, request, user, 'document_request', scope, label=payload.label.strip())
    db.commit()
    engage.send_push(db, [notification])
    return _dossier(db, user, scope)


@router.post('/document-requests/{request_id}/cancel')
def cancel_document_request(request_id: int, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    row = db.get(DocumentRequest, request_id)
    scope = _scope(db, user, row.application_id if row else 0)
    if row.status == 'requested':
        row.status = 'cancelled'
        engage.log_event(db, scope.application, 'document_request', f'Demande de pièce annulée : {row.label}', user.username)
    db.commit()
    return _dossier(db, user, scope)


# ── Échanges ────────────────────────────────────────────────────────────────

class MessageIn(BaseModel):
    body: Annotated[str, Field(min_length=1, max_length=2000)]
    client_id: ClientId


def _messages(db: Session, scope: Scope) -> dict:
    rows = db.scalars(select(Message).where(Message.application_id == scope.application.id).order_by(Message.id)).all()
    return {'application_id': scope.application.id, 'title': scope.title,
            'candidate': f'{scope.candidate.last_name} {scope.candidate.first_name}'.strip(),
            'can_reach_candidate': scope.application.account_id is not None,
            'items': [{**engage.message_out(row), 'author': row.author} for row in rows]}


@router.get('/applications/{application_id}/messages')
def read_messages(application_id: int, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = _scope(db, user, application_id)
    engage.read_messages(db, scope.application.id, RECRUITER)
    db.commit()
    return _messages(db, scope)


@router.post('/applications/{application_id}/messages', status_code=201)
def send_message(application_id: int, payload: MessageIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = _scope(db, user, application_id)
    if scope.application.account_id is None:
        raise HTTPException(status_code=409, detail='Ce candidat n’a pas d’espace IRON Emploi : aucun message ne peut lui parvenir par l’application.')
    row, created = engage.post_message(db, scope.application, RECRUITER, payload.body, payload.client_id, author=user.username)
    notification = None
    if created:
        engage.log_event(db, scope.application, 'message', 'Message envoyé au candidat', user.username)
        notification = engage.notify(db, scope.application.account_id, 'message', 'Nouveau message du recrutement', f'{scope.title} — {row.body[:200]}',
                                     application_id=scope.application.id)
        _audit(db, request, user, 'message', scope)
    db.commit()
    engage.send_push(db, [notification])
    return _messages(db, scope)


# ── Convocations et entretiens ──────────────────────────────────────────────
# Une convocation est l'entretien de la candidature, envoyé au candidat sous forme de document avec QR.
# Brouillon : rien n'est envoyé ni visible du candidat. Chaque envoi crée une version (conv.issue).

MapUrl = Annotated[str | None, Field(default=None, max_length=400, pattern=r'^https://[^\s]+$')]


class InterviewIn(BaseModel):
    starts_at: datetime
    location: Annotated[str, Field(min_length=2, max_length=300)]
    contact: Annotated[str | None, Field(default=None, max_length=150)]
    note: Annotated[str | None, Field(default=None, max_length=1000)]
    send_email: bool = False
    # Convocation : tout est facultatif, pour garder compatibles les appels existants.
    request_id: ClientId | None = None
    mode: Annotated[str, Field(pattern=r'^(send|draft)$')] = 'send'
    society: Annotated[str | None, Field(default=None, max_length=150)]
    address: Annotated[str | None, Field(default=None, max_length=400)]
    map_url: MapUrl
    contact_details: Annotated[str | None, Field(default=None, max_length=200)]
    purpose: Annotated[str | None, Field(default=None, max_length=200)]
    documents_to_bring: Annotated[str | None, Field(default=None, max_length=1000)]


class InterviewOutcomeIn(BaseModel):
    attendance: Annotated[str, Field(pattern=r'^(present|absent)$')]
    report: Annotated[str | None, Field(default=None, max_length=6000)]
    appreciation: Annotated[str | None, Field(default=None, max_length=40)]
    # Grille d'entretien du vivier : mêmes critères, notes entières sur 10, toutes facultatives.
    scores: dict[str, int | None] | None = None


class ArrivalIn(BaseModel):
    version: Annotated[int, Field(ge=1)]


class ResolveIn(BaseModel):
    code: Annotated[str, Field(min_length=1, max_length=400)]


def _convocation_email(scope: Scope, row: Interview) -> str:
    """Canal e-mail existant des convocations, s'il est configuré. Retourne ce qui s'est réellement passé."""
    if not scope.candidate.email:
        return 'E-mail non envoyé : le candidat n’a pas d’adresse e-mail.'
    try:
        from app.modules.drh.convocation_email import send_candidate_convocation_email
        send_candidate_convocation_email(recipient=scope.candidate.email, candidate_name=f'{scope.candidate.first_name} {scope.candidate.last_name}'.strip(),
                                         date=row.starts_at.strftime('%d/%m/%Y'), time=row.starts_at.strftime('%H:%M'), location=row.location,
                                         purpose=f'Entretien — {scope.title}')
        return 'E-mail de convocation envoyé.'
    except Exception as exc:  # noqa: BLE001 — l'invitation reste enregistrée ; le canal indisponible est signalé
        return f'E-mail non envoyé : {str(exc)[:160] or type(exc).__name__}.'


def _interview_scope(db: Session, user: User, interview_id: int) -> tuple[Interview, Scope]:
    row = db.scalar(select(Interview).where(Interview.id == interview_id).with_for_update())
    scope = _scope(db, user, row.application_id if row else 0, lock=True)
    return row, scope


def _company_of(db: Session, society: str | None) -> Company | None:
    return db.scalar(select(Company).where(Company.society_key == society_key(society))) if society else None


def _convoking(db: Session, scope: Scope, row: Interview) -> tuple[str | None, str | None]:
    """Société qui convoque (dénomination) et son logo réel s'il existe ; jamais de logo de substitution."""
    company = scope.company or _company_of(db, row.society or scope.candidate.society)
    name = company.name if company else (row.society or scope.candidate.society)
    logo = company.logo_path if company is not None and company.logo_path in jobs.COMPANY_LOGOS else None
    return name, logo


def _content(db: Session, scope: Scope, row: Interview) -> dict:
    name, logo = _convoking(db, scope, row)
    return conv.snapshot(row, scope.application, scope.offer, scope.candidate, society_name=name, logo_path=logo,
                         dossier_reference=candidate_reference(scope.candidate))


def _apply_fields(row: Interview, payload: InterviewIn, scope: Scope, user: User) -> None:
    clean = lambda value: (value or '').strip() or None  # noqa: E731
    row.location, row.contact, row.note = payload.location.strip(), clean(payload.contact), clean(payload.note)
    row.address, row.map_url, row.contact_details = clean(payload.address), clean(payload.map_url), clean(payload.contact_details)
    row.purpose, row.documents_to_bring = clean(payload.purpose), clean(payload.documents_to_bring)
    # Candidature d'une annonce : la société est celle de l'annonce. Spontanée : société choisie, dans le périmètre.
    society = None if scope.company else clean(payload.society)
    if society and not society_scope(user).allows(society):
        raise HTTPException(status_code=422, detail='Société hors de votre périmètre.')
    row.society, row.updated_by = society, user.username


def _guarded(db: Session, action):
    """Émission refusée (caractère non imprimable…) : rien de la requête n'est gardé, pas même le brouillon créé."""
    try:
        return action()
    except HTTPException:
        db.rollback()
        raise


def _closed(a: Application) -> bool:
    return bool(a.withdrawn_at) or (a.outcome == 'unfavorable' and a.outcome_communicated_at is not None)


def _notice(db: Session, scope: Scope, row: Interview, title: str) -> object:
    # Texte court, visible sur l'écran verrouillé : ni lieu, ni heure, ni société ; le détail est dans l'application.
    return engage.notify(db, scope.application.account_id, 'interview', title, 'Ouvrez IRON Emploi pour consulter votre convocation.',
                         application_id=scope.application.id, interview_id=row.id)


def _send(db: Session, request: Request, user: User, scope: Scope, row: Interview, *, title: str = 'Convocation à un entretien') -> list:
    """Premier envoi d'une convocation : version 1, étape, état visible, notification. Le verrou est tenu."""
    a = scope.application
    if row.status == INTERVIEW_DRAFT:
        row.status = INTERVIEW_PROPOSED
    version = conv.issue(db, row, _content(db, scope, row), user.username)
    if engage.STAGE_ORDER.index(a.stage) < engage.STAGE_ORDER.index('convocation'):
        a.stage = 'convocation'
    engage.log_event(db, a, 'interview', f'Convocation {conv.reference(row)} envoyée (version {version.version}) pour le {engage.describe(row.starts_at)}', user.username)
    _audit(db, request, user, 'convocation_send', scope, interview_id=row.id, version=version.version, starts_at=row.starts_at.isoformat())
    return [engage.set_visible_status(db, a, 'interview', user.username) if not a.outcome_communicated_at else None, _notice(db, scope, row, title)]


def _channels(scope: Scope, row: Interview, notifications: list, db: Session, send_email: bool) -> list[str]:
    if scope.application.account_id:
        channels = ['Convocation enregistrée dans l’espace IRON Emploi du candidat.']
    else:
        channels = ['Ce dossier n’a pas d’espace IRON Emploi : la convocation n’y est pas reçue. Téléchargez le PDF pour la remettre au candidat'
                    + (', ou envoyez-la par e-mail.' if scope.candidate.email else '.')]
    if engage.send_push(db, notifications):
        channels.append('Notification push acceptée par le service d’envoi (la réception sur le téléphone n’est pas garantie).')
    if send_email:
        channels.append(_convocation_email(scope, row))
    return channels


@router.post('/applications/{application_id}/interviews', status_code=201)
def propose_interview(application_id: int, payload: InterviewIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = _scope(db, user, application_id, lock=True)
    a = scope.application
    if _closed(a):
        raise HTTPException(status_code=409, detail='Cette candidature est close : aucune convocation ne peut être envoyée.')
    starts_at = engage.check_interview_time(payload.starts_at)
    # Même requête rejouée (double clic, relance réseau) : la convocation déjà créée, sans nouvel envoi.
    if payload.request_id:
        existing = db.scalar(select(Interview).where(Interview.application_id == a.id, Interview.request_id == payload.request_id))
        if existing is not None:
            return {**_dossier(db, user, scope), 'interview_id': existing.id, 'channels': ['Convocation déjà enregistrée.']}
    # Même date et même heure déjà envoyées pour cette candidature : pas de doublon.
    existing = db.scalar(select(Interview).where(Interview.application_id == a.id, Interview.starts_at == starts_at,
                                                 Interview.status.notin_([INTERVIEW_CANCELLED, INTERVIEW_DRAFT])))
    if existing is not None and payload.mode == 'send':
        return {**_dossier(db, user, scope), 'interview_id': existing.id, 'channels': ['Invitation déjà enregistrée pour cette date.']}
    row = Interview(application_id=a.id, starts_at=starts_at, status=INTERVIEW_DRAFT, request_id=payload.request_id,
                    location=payload.location.strip(), created_by=user.username)
    _apply_fields(row, payload, scope, user)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:                                    # même requête arrivée en parallèle
        db.rollback()
        scope = _scope(db, user, application_id)
        existing = db.scalar(select(Interview).where(Interview.application_id == a.id, Interview.request_id == payload.request_id))
        return {**_dossier(db, user, scope), 'interview_id': existing.id if existing else None, 'channels': ['Convocation déjà enregistrée.']}
    if payload.mode == 'draft':
        engage.log_event(db, a, 'interview', f'Convocation {conv.reference(row)} préparée en brouillon (non envoyée)', user.username)
        _audit(db, request, user, 'convocation_draft', scope, interview_id=row.id)
        db.commit()
        return {**_dossier(db, user, scope), 'interview_id': row.id, 'channels': ['Brouillon enregistré : le candidat n’a pas été prévenu.']}
    notifications = _guarded(db, lambda: _send(db, request, user, scope, row))
    db.commit()
    return {**_dossier(db, user, scope), 'interview_id': row.id, 'channels': _channels(scope, row, notifications, db, payload.send_email)}


@router.post('/interviews/{interview_id}/send')
def send_convocation(interview_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    """Envoie un brouillon, ou émet le document d'un entretien antérieur aux convocations. Rejouer : sans effet."""
    row, scope = _interview_scope(db, user, interview_id)
    if row.status not in (INTERVIEW_DRAFT, *conv.SENT_STATUSES):
        raise HTTPException(status_code=409, detail='Cet entretien est clos : aucune convocation ne peut être envoyée.')
    if row.version:
        return {**_dossier(db, user, scope), 'interview_id': row.id, 'channels': ['Convocation déjà envoyée.']}
    if _closed(scope.application):
        raise HTTPException(status_code=409, detail='Cette candidature est close : aucune convocation ne peut être envoyée.')
    engage.check_interview_time(row.starts_at)
    notifications = _guarded(db, lambda: _send(db, request, user, scope, row))
    db.commit()
    return {**_dossier(db, user, scope), 'interview_id': row.id, 'channels': _channels(scope, row, notifications, db, False)}


@router.put('/interviews/{interview_id}')
def update_interview(interview_id: int, payload: InterviewIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    row, scope = _interview_scope(db, user, interview_id)
    if row.status in (INTERVIEW_CANCELLED, INTERVIEW_DONE, INTERVIEW_NO_SHOW):
        raise HTTPException(status_code=409, detail='Cet entretien est clos : proposez-en un nouveau.')
    starts_at = engage.check_interview_time(payload.starts_at)
    if row.status == INTERVIEW_DRAFT:                        # brouillon : modification silencieuse
        row.starts_at = starts_at
        _apply_fields(row, payload, scope, user)
        db.commit()
        return {**_dossier(db, user, scope), 'interview_id': row.id, 'channels': ['Brouillon modifié : le candidat n’a pas été prévenu.']}
    before = {field: getattr(row, field) for field in conv.PRINTED_FIELDS}
    moved = starts_at != row.starts_at
    if moved:
        # Report : l'ancienne date est conservée et le candidat doit confirmer à nouveau.
        row.previous_starts_at, row.starts_at, row.status, row.confirmed_at = row.starts_at, starts_at, INTERVIEW_PROPOSED, None
        row.arrived_at = row.arrived_by = None
    _apply_fields(row, payload, scope, user)
    changed = any(getattr(row, field) != value for field, value in before.items())
    notification = None
    if changed:
        label = 'reportée' if moved else 'modifiée'
        if row.version:
            version = _guarded(db, lambda: conv.issue(db, row, _content(db, scope, row), user.username))
            engage.log_event(db, scope.application, 'interview', f'Convocation {conv.reference(row)} {label} : version {version.version}, '
                             f'{engage.describe(starts_at)}', user.username)
        else:
            engage.log_event(db, scope.application, 'interview', f'Entretien {"reporté au" if moved else "modifié :"} {engage.describe(starts_at)}', user.username)
        notification = _notice(db, scope, row, f'Convocation {label}')
        _audit(db, request, user, 'interview_update', scope, interview_id=row.id, starts_at=starts_at.isoformat(), version=row.version, moved=moved)
    db.commit()
    channels = _channels(scope, row, [notification], db, payload.send_email) if changed else ['Aucun changement à communiquer.']
    return {**_dossier(db, user, scope), 'interview_id': row.id, 'channels': channels}


@router.post('/interviews/{interview_id}/cancel')
def cancel_interview(interview_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    row, scope = _interview_scope(db, user, interview_id)
    notification = None
    if row.status == INTERVIEW_DRAFT:                        # brouillon abandonné : personne à prévenir
        row.status, row.cancelled_at, row.updated_by = INTERVIEW_CANCELLED, datetime.utcnow(), user.username
        _audit(db, request, user, 'convocation_draft_cancel', scope, interview_id=row.id)
    elif row.status in (INTERVIEW_PROPOSED, INTERVIEW_CONFIRMED):
        row.status, row.cancelled_at, row.updated_by = INTERVIEW_CANCELLED, datetime.utcnow(), user.username
        conv.cancel_versions(db, row)
        engage.log_event(db, scope.application, 'interview', f'Entretien du {engage.describe(row.starts_at)} annulé'
                         + (f' (convocation {conv.reference(row)})' if row.version else ''), user.username)
        notification = engage.notify(db, scope.application.account_id, 'interview', 'Entretien annulé',
                                     'Une convocation a été annulée. Ouvrez IRON Emploi pour le détail.',
                                     application_id=scope.application.id, interview_id=row.id)
        _audit(db, request, user, 'interview_cancel', scope, interview_id=row.id, version=row.version)
    db.commit()
    engage.send_push(db, [notification])
    return _dossier(db, user, scope)


@router.get('/interviews/{interview_id}/convocation')
def convocation_document(interview_id: int, version: int | None = None, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    """PDF de la convocation pour le recruteur : version demandée (anciennes comprises), ou aperçu du brouillon."""
    row = db.get(Interview, interview_id)
    scope = _scope(db, user, row.application_id if row else 0)
    if row.status == INTERVIEW_DRAFT or not row.version:
        if version:
            raise HTTPException(status_code=404, detail='Version introuvable.')
        content = _content(db, scope, row)
        problems = conv.printable_problems(content)
        if problems:
            raise HTTPException(status_code=422, detail=f'Caractères impossibles à imprimer dans la convocation : {problems}. Corrigez la saisie.')
        data = pdf.render(content, version=0, issued_at=None, qr=None, draft=True)
        name = f'{conv.reference(row)}-apercu.pdf'
    else:
        item = db.scalar(select(ConvocationVersion).where(ConvocationVersion.interview_id == row.id,
                                                          ConvocationVersion.version == (version or row.version)))
        if item is None:
            raise HTTPException(status_code=404, detail='Version introuvable.')
        data = pdf.render(item.snapshot, version=item.version, issued_at=item.issued_at, qr=conv.qr_matrix(item.token))
        name = f'{conv.reference(row)}-V{item.version}.pdf'
    return Response(content=data, media_type='application/pdf', headers={
        'Content-Disposition': f'inline; filename="{name}"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


def _resolution(db: Session, scope: Scope, row: Interview, item: ConvocationVersion) -> dict:
    state = conv.version_state(row, item)
    shown = datetime.fromisoformat(item.snapshot['starts_at'])
    if state == 'active' and row.starts_at.date() < engage.now_local().date():
        state = 'past'
    warnings = {
        'superseded': f'Version {item.version} remplacée : la convocation en vigueur est la version {row.version}, '
                      f'pour le {engage.describe(row.starts_at)}. Ne validez pas l’ancienne date.',
        'cancelled': 'Cette convocation a été annulée : aucune présence ne peut être enregistrée.',
        'closed': 'Cet entretien est déjà clos (compte rendu enregistré).',
        'past': 'La date de cet entretien est passée.',
    }
    return {
        'state': state, 'warning': warnings.get(state), 'application_id': scope.application.id, 'interview_id': row.id,
        'reference': conv.reference(row), 'version': item.version, 'current_version': row.version,
        'summary': {'candidate': f'{(scope.candidate.last_name or "").upper()} {scope.candidate.first_name or ""}'.strip(), 'position': scope.title,
                    'society': item.snapshot.get('society'), 'starts_at': shown.isoformat(timespec='minutes'),
                    'current_starts_at': engage.iso(row.starts_at), 'timezone': engage.TIMEZONE, 'status': row.status,
                    'candidate_state': conv.candidate_state(row), 'candidate_state_label': conv.STATES[conv.candidate_state(row)],
                    'confirmed_by_candidate': row.confirmed_at is not None, 'arrived_at': engage.iso(row.arrived_at), 'arrived_by': row.arrived_by},
        'can_confirm_arrival': state == 'active' and row.arrived_at is None and row.starts_at.date() == engage.now_local().date(),
    }


@router.post('/convocations/resolve')
def resolve_convocation(payload: ResolveIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    """Ouvre la convocation désignée par un QR lu ou une référence saisie. Rien n'est enregistré, sinon la consultation."""
    parsed = conv.scanned_code(payload.code)
    if parsed is None:
        raise HTTPException(status_code=422, detail='QR code ou référence invalide : ce n’est pas une convocation de cet espace recrutement.')
    kind, value = parsed
    if kind == 'token':
        item = db.scalar(select(ConvocationVersion).where(ConvocationVersion.token == value))
        row = db.get(Interview, item.interview_id) if item else None
    else:
        year, number, version = conv.REFERENCE_RE.match(value).groups()
        row = db.get(Interview, int(number))
        if row is not None and (not row.created_at or row.created_at.year != int(year)):
            row = None
        item = db.scalar(select(ConvocationVersion).where(ConvocationVersion.interview_id == row.id,
                                                          ConvocationVersion.version == int(version or row.version or 0))) if row else None
    if row is None or item is None:
        raise HTTPException(status_code=404, detail='Convocation inconnue : aucun envoi ne correspond à ce code.')
    try:
        scope = _scope(db, user, row.application_id)
    except HTTPException:
        append_audit(db, action='recruitment.job_application.convocation_scan', resource='job_application', resource_id=row.application_id,
                     result='refused', user=user, request=request, new_state={'version_id': item.id, 'method': kind})
        db.commit()
        raise HTTPException(status_code=403, detail='Accès refusé : cette convocation ne relève pas de votre périmètre.')
    result = _resolution(db, scope, row, item)
    _audit(db, request, user, 'convocation_scan', scope, interview_id=row.id, version=item.version, state=result['state'], method=kind)
    db.commit()
    return result


@router.post('/interviews/{interview_id}/arrival')
def confirm_arrival(interview_id: int, payload: ArrivalIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    """Arrivée du candidat, constatée et confirmée explicitement par le recruteur. Ni résultat d'entretien, ni décision."""
    row, scope = _interview_scope(db, user, interview_id)
    if row.status not in conv.SENT_STATUSES:
        raise HTTPException(status_code=409, detail='Cette convocation n’est pas en vigueur : aucune arrivée ne peut être enregistrée.')
    if payload.version != row.version:
        raise HTTPException(status_code=409, detail=f'Version {payload.version} remplacée par la version {row.version} : vérifiez la nouvelle date.')
    if row.starts_at.date() != engage.now_local().date():
        raise HTTPException(status_code=409, detail=f'Cet entretien est prévu le {engage.describe(row.starts_at)} : l’arrivée se confirme le jour même.')
    if row.arrived_at is None:                                # rejouer : sans effet
        row.arrived_at, row.arrived_by = datetime.utcnow(), user.username
        engage.log_event(db, scope.application, 'interview', f'Arrivée du candidat confirmée (convocation {conv.reference(row)}, version {row.version})', user.username)
        _audit(db, request, user, 'convocation_arrival', scope, interview_id=row.id, version=row.version)
        db.commit()
    return {**_dossier(db, user, scope), 'interview_id': row.id}


@router.post('/interviews/{interview_id}/outcome')
def record_interview_outcome(interview_id: int, payload: InterviewOutcomeIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    """Présence ou absence, compte rendu, grille et appréciation : informations internes, jamais transmises au candidat."""
    row, scope = _interview_scope(db, user, interview_id)
    if row.status in (INTERVIEW_CANCELLED, INTERVIEW_DRAFT):
        raise HTTPException(status_code=409, detail='Cet entretien a été annulé.' if row.status == INTERVIEW_CANCELLED else 'Cette convocation n’a pas été envoyée.')
    if row.starts_at > engage.now_local():
        raise HTTPException(status_code=409, detail='Cet entretien n’a pas encore eu lieu : la présence s’enregistre après sa tenue.')
    if payload.attendance == 'absent' and row.arrived_at is not None:
        raise HTTPException(status_code=409, detail='L’arrivée du candidat a été confirmée : il ne peut pas être déclaré absent.')
    assessment = conv.clean_scores(payload.scores) if payload.attendance == 'present' else None
    row.status = INTERVIEW_DONE if payload.attendance == 'present' else INTERVIEW_NO_SHOW
    row.report, row.appreciation, row.updated_by = (payload.report or '').strip() or None, (payload.appreciation or '').strip() or None, user.username
    row.assessment = assessment
    if payload.attendance == 'present' and engage.STAGE_ORDER.index(scope.application.stage) < engage.STAGE_ORDER.index('interview'):
        scope.application.stage = 'interview'
    engage.log_event(db, scope.application, 'interview', 'Entretien réalisé : compte rendu enregistré' if payload.attendance == 'present'
                     else 'Candidat absent à l’entretien', user.username)
    _audit(db, request, user, 'interview_outcome', scope, interview_id=row.id, attendance=payload.attendance, graded=bool(assessment))
    db.commit()
    return _dossier(db, user, scope)


@router.get('/conversations')
def conversations(db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    """Candidatures ayant au moins un message, dans le périmètre du recruteur."""
    ids = db.scalars(select(Message.application_id).distinct()).all()
    items = []
    for application_id in ids:
        try:
            scope = _scope(db, user, application_id)
        except HTTPException:
            continue
        items.append((scope, application_id))
    last, unread = engage.last_messages(db, [i for _, i in items]), engage.unread_counts(db, [i for _, i in items], RECRUITER)
    result = [{'application_id': i, 'title': s.title, 'candidate': f'{s.candidate.last_name} {s.candidate.first_name}'.strip(),
               'last_message': engage.message_out(last[i]), 'unread': unread.get(i, 0)} for s, i in items if i in last]
    return {'items': sorted(result, key=lambda item: item['last_message']['created_at'], reverse=True)}


# ── Contrat et passage à la DRH ─────────────────────────────────────────────

class ContractIn(BaseModel):
    template_id: int | None = None
    position: Annotated[str, Field(min_length=2, max_length=150)]
    contract_type: Annotated[str, Field(min_length=2, max_length=80)]
    start_date: date | None = None
    end_date: date | None = None
    work_place: Annotated[str | None, Field(default=None, max_length=200)]
    salary_net: Annotated[float | None, Field(default=None, ge=0, le=100_000_000)]
    conditions: Annotated[str | None, Field(default=None, max_length=4000)]


class ContractStateIn(BaseModel):
    state: Annotated[str, Field(pattern=r'^(prepared|sent|signed)$')]
    signed_on: date | None = None
    share_with_candidate: bool | None = None


@router.get('/contract-templates')
def contract_templates(db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    """Modèles de contrat validés par la DRH (lecture seule pour le recrutement)."""
    return {'items': [{'id': row.id, 'title': row.title, 'contract_type': row.contract_type, 'position': row.position}
                      for row in db.scalars(select(ContractTemplate).where(ContractTemplate.active == 1).order_by(ContractTemplate.title)).all()]}


def _require_favorable(scope: Scope) -> None:
    if not (scope.application.outcome == 'favorable' and scope.application.outcome_communicated_at):
        raise HTTPException(status_code=409, detail='Le contrat se prépare après une décision favorable communiquée au candidat.')
    if not scope.society:
        raise HTTPException(status_code=409, detail='Société destinataire requise : ventilez le dossier avant de préparer le contrat.')


@router.put('/applications/{application_id}/contract')
def prepare_contract(application_id: int, payload: ContractIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = _scope(db, user, application_id, lock=True)
    _require_favorable(scope)
    if payload.start_date and payload.end_date and payload.end_date < payload.start_date:
        raise HTTPException(status_code=422, detail='La date de fin précède la date de début.')
    if payload.template_id and db.get(ContractTemplate, payload.template_id) is None:
        raise HTTPException(status_code=422, detail='Modèle de contrat inconnu.')
    # Un seul contrat par candidature : la préparation le crée, puis le met à jour.
    row = db.scalar(select(Contract).where(Contract.application_id == scope.application.id))
    if row is not None and row.state == 'signed':
        raise HTTPException(status_code=409, detail='Ce contrat est enregistré comme signé : il ne se modifie plus.')
    if row is None:
        row = Contract(application_id=scope.application.id, society=scope.society, prepared_by=user.username, state='prepared',
                       position=payload.position, contract_type=payload.contract_type)
        db.add(row)
    for field, value in payload.model_dump().items():
        setattr(row, field, value.strip() if isinstance(value, str) else value)
    if engage.STAGE_ORDER.index(scope.application.stage) < engage.STAGE_ORDER.index('contract'):
        scope.application.stage = 'contract'
    engage.log_event(db, scope.application, 'contract', f'Contrat préparé : {row.contract_type}, {row.position}', user.username)
    _audit(db, request, user, 'contract_prepare', scope, contract_type=row.contract_type, position=row.position)
    db.commit()
    return _dossier(db, user, scope)


@router.post('/applications/{application_id}/contract/preview')
def preview_contract(application_id: int, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    """Aperçu du contrat fusionné avec le modèle validé, par le service DRH existant : rien n'est créé."""
    scope = _scope(db, user, application_id)
    row = db.scalar(select(Contract).where(Contract.application_id == scope.application.id))
    if row is None:
        raise HTTPException(status_code=404, detail='Aucun contrat préparé.')
    if not row.template_id:
        raise HTTPException(status_code=422, detail='Choisissez un modèle de contrat validé pour obtenir l’aperçu.')
    data = scope.candidate.data if isinstance(scope.candidate.data, dict) else {}

    def day(value) -> date | None:
        try:
            return date.fromisoformat(str(value)[:10]) if value else None
        except ValueError:
            return None
    form = DirectContractRequest(
        template_id=row.template_id, contract_type=row.contract_type, first_name=scope.candidate.first_name, last_name=scope.candidate.last_name,
        birth_date=day(data.get('dateNaissance')), birth_place=data.get('lieuNaissance') or None, father_name=data.get('nomPere') or None,
        mother_name=data.get('nomMere') or None, nin=data.get('nin') or None, numero_cnas=data.get('numeroCnas') or None,
        phone=scope.candidate.phone, address=data.get('adresse') or None, start_date=row.start_date, end_date=row.end_date,
        work_place=row.work_place, wilaya=data.get('wilaya') or None, commune=data.get('commune') or None, salary_net=row.salary_net,
        salary_details=row.conditions, position=row.position, society=row.society)
    content, file_name, mime_type = drh_service.preview_contract_from_form(db, form)
    return StreamingResponse(BytesIO(content), media_type=mime_type, headers={
        'Content-Disposition': f'attachment; filename="{file_name}"', 'Cache-Control': 'no-store, private'})


@router.post('/applications/{application_id}/contract/state')
def set_contract_state(application_id: int, payload: ContractStateIn, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    scope = _scope(db, user, application_id, lock=True)
    row = db.scalar(select(Contract).where(Contract.application_id == scope.application.id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail='Aucun contrat préparé.')
    order = ['prepared', 'sent', 'signed']
    if row.state == 'signed' and payload.state != 'signed':
        raise HTTPException(status_code=409, detail='Ce contrat est enregistré comme signé.')
    notification = None
    if payload.state == 'signed':
        # La signature est constatée par le recruteur, avec sa date : jamais déduite d'une génération.
        if payload.signed_on is None or payload.signed_on > jobs.today():
            raise HTTPException(status_code=422, detail='Indiquez la date de signature (aujourd’hui au plus tard).')
        if row.state != 'signed':
            row.signed_on, row.signed_recorded_by, row.signed_recorded_at = payload.signed_on, user.username, datetime.utcnow()
            engage.log_event(db, scope.application, 'contract', f'Signature enregistrée (signé le {payload.signed_on.isoformat()})', user.username)
            scope.application.stage = 'signature'
    elif payload.state == 'sent' and row.state == 'prepared':
        row.sent_at = datetime.utcnow()
        engage.log_event(db, scope.application, 'contract', 'Contrat remis ou envoyé au candidat pour signature', user.username)
    if order.index(payload.state) >= order.index(row.state):
        row.state = payload.state
    if payload.share_with_candidate is not None and payload.share_with_candidate != row.shared_with_candidate:
        row.shared_with_candidate = payload.share_with_candidate
        if row.shared_with_candidate:
            notification = engage.notify(db, scope.application.account_id, 'application', 'Votre contrat est en préparation',
                                         f'{scope.title} — {row.contract_type}. Le service recrutement vous contactera pour la signature.',
                                         application_id=scope.application.id)
            engage.log_event(db, scope.application, 'contract', 'Informations du contrat partagées avec le candidat', user.username)
    _audit(db, request, user, 'contract_state', scope, state=row.state, signed_on=row.signed_on.isoformat() if row.signed_on else None)
    db.commit()
    engage.send_push(db, [notification])
    return _dossier(db, user, scope)


@router.post('/applications/{application_id}/transfer-drh')
def transfer_to_drh(application_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    """Passage à la DRH par le service existant (idempotent, sans création d'employé ni de contrat ici)."""
    scope = _scope(db, user, application_id, lock=True)
    _require_favorable(scope)
    contract = db.scalar(select(Contract).where(Contract.application_id == scope.application.id))
    if contract is None or contract.state != 'signed':
        raise HTTPException(status_code=409, detail='Enregistrez la signature du contrat avant de transmettre le dossier à la DRH.')
    # Le vivier n'est actualisé qu'au choix du dossier retenu, jamais par une autre candidature.
    candidate, target = drh_service._locked_candidate(db, scope.candidate.id), contract.society
    data = dict(candidate.data) if isinstance(candidate.data, dict) else {}
    if scope.application.profile_snapshot and not drh_service._candidate_left_recruitment(candidate):
        snapshot = scope.application.profile_snapshot
        technical = {'moduleOrigine', 'telephoneVerifie', 'sourceExterne', 'societeAffectationAutomatique',
                     'ficheCandidatTransmise', 'submittedAt', 'consentementCandidatAt'}
        personal = {key: value for key, value in snapshot.get('data', {}).items() if key not in technical}
        changed = any(data.get(key) != value for key, value in personal.items())
        data.update(personal)
        for key in ('first_name', 'last_name', 'phone', 'email', 'desired_position', 'expected_salary'):
            if key in snapshot:
                setattr(candidate, key, snapshot[key])
        documents = db.scalars(select(Document).options(undefer(Document.content)).where(
            Document.application_id == scope.application.id, Document.kind.in_(['cv', 'photo']))).all()
        data.pop('cv', None)
        data.pop('_cv_content', None)
        data['photo'] = ''
        for document in documents:
            if document.kind == 'cv':
                data['cv'] = {'name': document.name, 'mime_type': document.mime_type, 'size': document.size}
                data['_cv_content'] = document.content
            elif document.kind == 'photo':
                data['photo'] = f'data:{document.mime_type};base64,{document.content}'
        if changed:
            data['fichePositionValidee'], data['sectionValidations'] = False, {}
            data.pop('fichePositionValideeAt', None)
            data.pop('fichePositionValideeBy', None)
        candidate.data = data

    if not data.get('drhTransfer') or data['drhTransfer'].get('status') != 'done':
        if _society_key(candidate.society) != _society_key(target):
            if not _can_ventilate(db, user):
                raise HTTPException(status_code=403, detail='Permission de ventilation requise pour affecter le dossier à la société du contrat.')
            drh_service.ventilate_candidate(db, candidate.id, target, reason=f'Candidature retenue : {scope.title}', actor=user,
                                            context='iron_emploi', commit=False)
            db.flush()
        if not drh_service._candidate_decision_is_favorable(candidate.data if isinstance(candidate.data, dict) else {}):
            # La décision favorable prise sur la candidature est reportée sur le dossier, qui porte le circuit DRH.
            candidate.data = {**(candidate.data or {}), 'avisDecision': 'Favorable', 'avisDate': jobs.today().isoformat(), 'avisRecruteur': user.username,
                              'avisCommentaire': f'Décision favorable sur la candidature « {scope.title} » (IRON Emploi).'}
        db.flush()
    result = drh_service.transfer_candidate_to_drh(db, candidate.id, actor=user)
    scope = _scope(db, user, application_id)
    if not result.get('already_transferred'):
        engage.log_event(db, scope.application, 'drh', f'Dossier transmis à la DRH de {result.get("society")}', user.username)
        _audit(db, request, user, 'transfer_drh', scope, society=result.get('society'))
        db.commit()
    return {**_dossier(db, user, scope), 'transfer': result}


# ── Conseils emploi ─────────────────────────────────────────────────────────

class TipIn(BaseModel):
    title: Annotated[str, Field(min_length=3, max_length=150)]
    summary: Annotated[str, Field(min_length=3, max_length=300)]
    body: Annotated[str, Field(min_length=10, max_length=8000)]
    category: Annotated[str, Field(pattern=r'^(cv|entretien|candidature)$')] = 'candidature'
    minutes: Annotated[int, Field(ge=1, le=30)] = 3
    status: Annotated[str, Field(pattern=r'^(draft|published)$')] = 'draft'


def tip_out(row: Tip, *, staff: bool = False) -> dict:
    result = {'id': row.id, 'title': row.title, 'summary': row.summary, 'body': row.body, 'category': row.category, 'minutes': row.minutes,
              'updated_at': engage.iso(row.updated_at or row.created_at)}
    return {**result, 'status': row.status, 'updated_by': row.updated_by} if staff else result


@router.get('/tips')
def tips(db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    return {'items': [tip_out(row, staff=True) for row in db.scalars(select(Tip).order_by(Tip.id.desc())).all()]}


@router.post('/tips', status_code=201)
def create_tip(payload: TipIn, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    row = Tip(**payload.model_dump(), updated_by=user.username)
    db.add(row)
    db.commit()
    return tip_out(row, staff=True)


@router.put('/tips/{tip_id}')
def update_tip(tip_id: int, payload: TipIn, db: Session = Depends(get_db), user: User = Depends(_recruiter)):
    row = db.get(Tip, tip_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Introuvable.')
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    row.updated_by = user.username
    db.commit()
    return tip_out(row, staff=True)


@router.delete('/tips/{tip_id}', status_code=204)
def delete_tip(tip_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_recruitment_access(user, destructive=True)
    row = db.get(Tip, tip_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=204)
