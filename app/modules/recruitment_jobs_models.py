"""IRON Emploi : sociétés, annonces, espaces candidats et candidatures liées aux annonces."""
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.db.base import Base, TimestampMixin

OFFER_DRAFT, OFFER_PUBLISHED, OFFER_CLOSED = 'draft', 'published', 'closed'


class RecruitmentCompany(Base, TimestampMixin):
    """Société qui publie des annonces. `society` est le libellé ATLAS qui porte le périmètre
    des recruteurs ; `kind` prépare l'ouverture à des entreprises hors groupe."""
    __tablename__ = 'recruitment_companies'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    society: Mapped[str] = mapped_column(String(150))
    society_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(20), default='group', server_default='group')
    sector: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(String(200))
    logo_path: Mapped[str | None] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default='1')


class RecruitmentJobOffer(Base, TimestampMixin):
    __tablename__ = 'recruitment_job_offers'
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey('recruitment_companies.id'), index=True)
    title: Mapped[str] = mapped_column(String(150))
    profession: Mapped[str | None] = mapped_column(String(150), index=True)
    wilaya: Mapped[str | None] = mapped_column(String(120), index=True)
    location: Mapped[str | None] = mapped_column(String(200))
    contract_type: Mapped[str | None] = mapped_column(String(40), index=True)
    positions: Mapped[int] = mapped_column(Integer, default=1, server_default='1')
    missions: Mapped[str | None] = mapped_column(Text)
    profile: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    reference: Mapped[str | None] = mapped_column(String(60))
    deadline: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default=OFFER_DRAFT, server_default=OFFER_DRAFT, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by: Mapped[str | None] = mapped_column(String(100))
    updated_by: Mapped[str | None] = mapped_column(String(100))


class RecruitmentCandidateAccount(Base, TimestampMixin):
    """Espace candidat, identifié par un numéro de téléphone vérifié par SMS."""
    __tablename__ = 'recruitment_candidate_accounts'
    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    profile: Mapped[dict | None] = mapped_column(JSON)
    cv_meta: Mapped[dict | None] = mapped_column(JSON)
    # Contenus volumineux, jamais chargés par les listes.
    cv_content: Mapped[str | None] = deferred(mapped_column(Text))
    photo: Mapped[str | None] = deferred(mapped_column(Text))
    # Dossier du vivier recrutement rattaché à cet espace (un seul dossier par personne).
    candidate_id: Mapped[int | None] = mapped_column(ForeignKey('candidates.id', ondelete='SET NULL'), index=True)


class RecruitmentCandidateSession(Base):
    __tablename__ = 'recruitment_candidate_sessions'
    token_digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey('recruitment_candidate_accounts.id', ondelete='CASCADE'), index=True)
    created_at: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class RecruitmentApplication(Base):
    """Candidature d'un dossier à une annonce (`offer_id`) ou spontanée (`offer_id` NULL)."""
    __tablename__ = 'recruitment_applications'
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey('recruitment_candidate_accounts.id', ondelete='SET NULL'), index=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey('candidates.id', ondelete='CASCADE'), index=True)
    offer_id: Mapped[int | None] = mapped_column(ForeignKey('recruitment_job_offers.id'), index=True)
    position: Mapped[str | None] = mapped_column(String(150))
    # Identifiant fourni par l'application : un double clic ou une relance réseau ne crée qu'une candidature.
    request_id: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(20), default='mobile', server_default='mobile')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # État propre à cette candidature, décidé par le recruteur de l'annonce. Il ne vaut que pour
    # une candidature à une annonce : une candidature spontanée ou historique suit l'état du dossier.
    status: Mapped[str] = mapped_column(String(20), default='received', server_default='received', index=True)
    status_updated_at: Mapped[datetime | None] = mapped_column(DateTime)
    status_updated_by: Mapped[str | None] = mapped_column(String(100))
    __table_args__ = (
        UniqueConstraint('account_id', 'request_id', name='uq_recruitment_applications_request'),
        UniqueConstraint('candidate_id', 'offer_id', name='uq_recruitment_applications_candidate_offer'),
    )
