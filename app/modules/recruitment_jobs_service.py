"""IRON Emploi : règles des annonces, des espaces candidats et des candidatures."""
import math
import secrets
import time
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.core.scope_policy import society_key
from app.modules.drh.models import Candidate
from app.modules.recruitment_jobs_models import (
    OFFER_CLOSED, OFFER_DRAFT, OFFER_PUBLISHED, RecruitmentApplication as Application, RecruitmentCandidateAccount as Account,
    RecruitmentCandidateSession as CandidateSession, RecruitmentCompany as Company, RecruitmentJobOffer as Offer,
)
from app.modules.recruitment_sms_service import digest

API_VERSION = 1
SESSION_TTL = 30 * 86400
MAX_SESSIONS = 5
CONTRACT_TYPES = ('CDI', 'CDD', 'CTA', 'Stage', 'Apprentissage', 'Autre')
# Logos de marque réellement présents dans app/static ; aucun autre chemin n'est accepté.
COMPANY_LOGOS = {'/static/iron-securite-logo.png': 'IRON Sécurité', '/static/iron-solution-logo.png': 'IRON Solution'}
# États d'une candidature à une annonce : (libellé, message affiché au candidat).
APPLICATION_STATES = {
    'received': ('Reçue', 'Votre candidature a bien été reçue par le service recrutement.'),
    'shortlisted': ('Présélectionnée', 'Votre candidature a été présélectionnée pour ce poste.'),
    'interview': ('Entretien', 'Votre candidature passe à l’étape de l’entretien. Le service recrutement vous contactera.'),
    'accepted': ('Retenue', 'Votre candidature a été retenue pour ce poste. Le service recrutement vous contactera pour la suite.'),
    'declined': ('Non retenue', 'Votre candidature n’a pas été retenue pour ce poste. Vos autres candidatures ne sont pas concernées.'),
}
PUBLISH_REQUIRED = (('title', 'Intitulé du poste'), ('wilaya', 'Wilaya'), ('contract_type', 'Type de contrat'),
                    ('missions', 'Missions'), ('profile', 'Profil recherché'))


def today() -> date:
    # Les dates limites se lisent à l'heure d'Alger (UTC+1, sans heure d'été).
    return (datetime.utcnow() + timedelta(hours=1)).date()


def text_key(value) -> str:
    return society_key(value).casefold()


# ── Annonces ────────────────────────────────────────────────────────────────

def open_filter():
    return (Offer.status == OFFER_PUBLISHED, or_(Offer.deadline.is_(None), Offer.deadline >= today()))


def is_open(offer: Offer) -> bool:
    return offer.status == OFFER_PUBLISHED and (offer.deadline is None or offer.deadline >= today())


def company_public(company: Company) -> dict:
    return {'id': company.id, 'name': company.name, 'sector': company.sector, 'city': company.city,
            'logo_url': company.logo_path if company.logo_path in COMPANY_LOGOS else None}


def offer_public(offer: Offer, company: Company, *, detail: bool = False) -> dict:
    """Vue publique d'une annonce : aucun champ interne (auteur, statut, compteurs)."""
    result = {'id': offer.id, 'title': offer.title, 'profession': offer.profession, 'wilaya': offer.wilaya, 'location': offer.location,
              'contract_type': offer.contract_type, 'positions': offer.positions, 'deadline': offer.deadline.isoformat() if offer.deadline else None,
              'published_at': offer.published_at.isoformat() if offer.published_at else None, 'company': company_public(company)}
    if detail:
        result.update(missions=offer.missions or '', profile=offer.profile or '', description=offer.description or '', reference=offer.reference)
    return result


def _open_offers(db: Session) -> list[tuple[Offer, Company]]:
    return db.execute(select(Offer, Company).join(Company, Company.id == Offer.company_id)
                      .where(*open_filter(), Company.is_active.is_(True))
                      .order_by(Offer.published_at.desc(), Offer.id.desc())).all()


def list_public_offers(db: Session, *, q=None, wilaya=None, profession=None, company_id=None, contract_type=None, page=1, page_size=20) -> dict:
    rows = _open_offers(db)
    facets = {
        'wilayas': sorted({o.wilaya for o, _ in rows if o.wilaya}, key=text_key),
        'professions': sorted({o.profession for o, _ in rows if o.profession}, key=text_key),
        'contract_types': [value for value in CONTRACT_TYPES if any(o.contract_type == value for o, _ in rows)],
        'companies': sorted(({'id': c.id, 'name': c.name} for c in {c.id: c for _, c in rows}.values()), key=lambda item: text_key(item['name'])),
    }
    words = text_key(q).split()
    def keep(offer: Offer, company: Company) -> bool:
        if wilaya and text_key(offer.wilaya) != text_key(wilaya):
            return False
        if profession and text_key(offer.profession) != text_key(profession):
            return False
        if contract_type and offer.contract_type != contract_type:
            return False
        if company_id and company.id != company_id:
            return False
        haystack = text_key(' '.join(filter(None, [offer.title, offer.profession, offer.wilaya, offer.location, company.name])))
        return all(word in haystack for word in words)
    kept = [(o, c) for o, c in rows if keep(o, c)]
    page_size = max(1, min(page_size, 50))
    pages = max(1, math.ceil(len(kept) / page_size))
    page = max(1, min(page, pages))
    return {'items': [offer_public(o, c) for o, c in kept[(page - 1) * page_size: page * page_size]],
            'total': len(kept), 'page': page, 'pages': pages, 'facets': facets}


def public_offer(db: Session, offer_id: int) -> dict:
    row = db.execute(select(Offer, Company).join(Company, Company.id == Offer.company_id)
                     .where(Offer.id == offer_id, *open_filter(), Company.is_active.is_(True))).first()
    if row is None:
        # Brouillon, clôturée, expirée ou inconnue : même réponse, rien ne distingue les cas.
        raise HTTPException(status_code=404, detail='Cette annonce n’est plus disponible.')
    return offer_public(row[0], row[1], detail=True)


def public_companies(db: Session) -> list[dict]:
    counts: dict[int, int] = {}
    companies: dict[int, Company] = {}
    for _, company in _open_offers(db):
        counts[company.id] = counts.get(company.id, 0) + 1
        companies[company.id] = company
    return sorted(({**company_public(c), 'open_offers': counts[c.id]} for c in companies.values()), key=lambda item: text_key(item['name']))


def public_company(db: Session, company_id: int) -> dict:
    company = db.get(Company, company_id)
    # Une société n'est présentée que si elle a déjà publié : un brouillon ne la révèle pas.
    if company is None or not company.is_active or not db.scalar(
            select(func.count()).select_from(Offer).where(Offer.company_id == company_id, Offer.published_at.is_not(None))):
        raise HTTPException(status_code=404, detail='Société introuvable.')
    offers = [offer_public(o, c) for o, c in _open_offers(db) if c.id == company_id]
    return {**company_public(company), 'description': company.description or '', 'website': company.website, 'offers': offers}


def company_for_society(db: Session, society: str) -> Company:
    key = society_key(society)
    company = db.scalar(select(Company).where(Company.society_key == key))
    if company is None:
        company = Company(name=society.strip(), society=society.strip(), society_key=key, kind='group', is_active=True)
        db.add(company)
        db.flush()
    return company


def ensure_publishable(offer: Offer) -> None:
    missing = [label for field, label in PUBLISH_REQUIRED if not str(getattr(offer, field) or '').strip()]
    if missing:
        raise HTTPException(status_code=422, detail='Avant publication, renseignez : ' + ', '.join(missing) + '.')
    if offer.contract_type not in CONTRACT_TYPES:
        raise HTTPException(status_code=422, detail='Type de contrat inconnu.')
    if offer.deadline and offer.deadline < today():
        raise HTTPException(status_code=422, detail='La date limite est dépassée. Modifiez-la ou retirez-la avant de publier.')


def staff_status(offer: Offer) -> str:
    """`expired` : publiée mais date limite dépassée, donc déjà invisible et fermée aux candidatures."""
    return 'expired' if offer.status == OFFER_PUBLISHED and not is_open(offer) else offer.status


def offer_staff(offer: Offer, company: Company, applications: int = 0) -> dict:
    return {**offer_public(offer, company, detail=True), 'society': company.society, 'company_id': company.id, 'status': offer.status,
            'effective_status': staff_status(offer), 'applications': applications,
            'closed_at': offer.closed_at.isoformat() if offer.closed_at else None,
            'created_at': offer.created_at.isoformat() if offer.created_at else None,
            'updated_at': offer.updated_at.isoformat() if offer.updated_at else None,
            'created_by': offer.created_by, 'updated_by': offer.updated_by}


def company_staff(company: Company) -> dict:
    return {'id': company.id, 'name': company.name, 'society': company.society, 'kind': company.kind, 'sector': company.sector,
            'city': company.city, 'description': company.description or '', 'website': company.website,
            'logo_path': company.logo_path, 'is_active': company.is_active}


def application_state(application: Application) -> dict:
    """État d'une candidature à une annonce, indépendant des autres candidatures du même dossier."""
    code = application.status if application.status in APPLICATION_STATES else 'received'
    label, message = APPLICATION_STATES[code]
    changed = application.status_updated_at or application.created_at
    return {'status': code, 'label': label, 'message': message, 'updated_at': changed.isoformat() if changed else None}


def application_counts(db: Session, offer_ids: list[int]) -> dict[int, int]:
    if not offer_ids:
        return {}
    return dict(db.execute(select(Application.offer_id, func.count()).where(Application.offer_id.in_(offer_ids)).group_by(Application.offer_id)).all())


# ── Espace candidat ─────────────────────────────────────────────────────────

def identity_key(first_name: str, last_name: str) -> tuple[str, ...]:
    """Nom et prénom comparés sans casse, accents ni ordre : « BENSALEM Amine » = « amine bensalem »."""
    return tuple(sorted(text_key(f'{first_name} {last_name}').split()))


def account_from_token(db: Session, secret: str, token: str, *, lock: bool = False, now: int | None = None) -> Account:
    now = int(time.time()) if now is None else now
    session = db.scalar(select(CandidateSession).where(CandidateSession.token_digest == digest(secret, 'emploi-session', token),
                                                       CandidateSession.expires_at > now))
    stmt = select(Account).where(Account.id == (session.account_id if session else -1))
    account = db.scalar(stmt.with_for_update() if lock else stmt)
    if account is None:
        raise HTTPException(status_code=401, detail='Votre session a expiré. Identifiez-vous à nouveau par SMS.')
    return account


def open_session(db: Session, secret: str, challenge, *, now: int | None = None) -> tuple[Account, str]:
    """Ouvre une session durable à partir d'une identité que le parcours SMS vient de vérifier."""
    now = int(time.time()) if now is None else now
    account = db.scalar(select(Account).where(Account.phone == challenge.phone).with_for_update())
    if account is None:
        account = Account(phone=challenge.phone, first_name=challenge.first_name, last_name=challenge.last_name, profile={})
        db.add(account)
        db.flush()
        _adopt_verified_dossiers(db, account)
    elif identity_key(account.first_name, account.last_name) != identity_key(challenge.first_name, challenge.last_name):
        # Un numéro réattribué ne doit pas ouvrir le dossier de son ancien titulaire.
        db.rollback()
        raise HTTPException(status_code=409, detail='Ce numéro est déjà associé à un espace candidat ouvert sous un autre nom. '
                            'Saisissez le nom et le prénom utilisés lors de votre première inscription, ou contactez le service recrutement.')
    token = secrets.token_urlsafe(40)
    db.add(CandidateSession(token_digest=digest(secret, 'emploi-session', token), account_id=account.id, created_at=now, expires_at=now + SESSION_TTL))
    db.flush()
    db.execute(delete(CandidateSession).where(CandidateSession.expires_at <= now))
    stale = db.scalars(select(CandidateSession.token_digest).where(CandidateSession.account_id == account.id)
                       .order_by(CandidateSession.created_at.desc(), CandidateSession.token_digest).offset(MAX_SESSIONS)).all()
    if stale:
        db.execute(delete(CandidateSession).where(CandidateSession.token_digest.in_(stale)))
    db.commit()
    return account, token


def _adopt_verified_dossiers(db: Session, account: Account) -> None:
    """Rattache les dossiers déjà déposés avec ce même téléphone vérifié par SMS (application précédente)."""
    rows = db.scalars(select(Candidate).where(Candidate.phone == account.phone).order_by(Candidate.id.desc())).all()
    for row in rows:
        data = row.data if isinstance(row.data, dict) else {}
        if data.get('telephoneVerifie') is not True or identity_key(row.first_name, row.last_name) != identity_key(account.first_name, account.last_name):
            continue
        if db.scalar(select(Application.id).where(Application.candidate_id == row.id)):
            continue
        account.candidate_id = row.id
        db.add(Application(account_id=account.id, candidate_id=row.id, offer_id=None, position=row.desired_position,
                           request_id=f'historique-{row.id}', source='historique', created_at=row.created_at or datetime.utcnow()))
        break


def close_session(db: Session, secret: str, token: str) -> None:
    db.execute(delete(CandidateSession).where(CandidateSession.token_digest == digest(secret, 'emploi-session', token)))
    db.commit()


def delete_account(db: Session, account: Account) -> None:
    """Supprime l'espace candidat et ses documents. Les candidatures déjà transmises restent
    au service recrutement, sans lien avec un espace."""
    db.execute(delete(CandidateSession).where(CandidateSession.account_id == account.id))
    for application in db.scalars(select(Application).where(Application.account_id == account.id)).all():
        application.account_id = None
    db.flush()
    db.delete(account)
    db.commit()


def dossier(db: Session, account: Account) -> Candidate | None:
    return db.get(Candidate, account.candidate_id) if account.candidate_id else None
