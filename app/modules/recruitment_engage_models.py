"""IRON Emploi : messages, entretiens, alertes, notifications et appareils des espaces candidats."""
from datetime import datetime

from datetime import date

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.db.base import Base, TimestampMixin

CANDIDATE, RECRUITER = 'candidate', 'recruiter'
INTERVIEW_PROPOSED, INTERVIEW_CONFIRMED, INTERVIEW_CANCELLED = 'proposed', 'confirmed', 'cancelled'
INTERVIEW_DONE, INTERVIEW_NO_SHOW = 'done', 'no_show'
# Convocation préparée par le recruteur et pas encore envoyée : jamais visible du candidat, jamais notifiée.
INTERVIEW_DRAFT = 'draft'


class RecruitmentMessage(Base):
    """Message d'une conversation ; une conversation = une candidature."""
    __tablename__ = 'recruitment_messages'
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey('recruitment_applications.id', ondelete='CASCADE'), index=True)
    sender: Mapped[str] = mapped_column(String(12))
    author: Mapped[str | None] = mapped_column(String(100))
    body: Mapped[str] = mapped_column(Text)
    # Identifiant fourni par l'émetteur : réessayer un envoi ne crée pas de doublon.
    client_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    __table_args__ = (UniqueConstraint('application_id', 'sender', 'client_id', name='uq_recruitment_messages_client'),)


class RecruitmentInterview(Base, TimestampMixin):
    """Invitation à un entretien pour une candidature. `starts_at` est une heure d'Alger."""
    __tablename__ = 'recruitment_interviews'
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey('recruitment_applications.id', ondelete='CASCADE'), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    location: Mapped[str] = mapped_column(String(300))
    contact: Mapped[str | None] = mapped_column(String(150))
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default=INTERVIEW_PROPOSED, server_default=INTERVIEW_PROPOSED, index=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Report : l'ancienne date est gardée pour l'historique et pour prévenir le candidat.
    previous_starts_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Compte rendu interne, jamais transmis au candidat.
    report: Mapped[str | None] = mapped_column(Text)
    appreciation: Mapped[str | None] = mapped_column(String(40))
    created_by: Mapped[str | None] = mapped_column(String(100))
    updated_by: Mapped[str | None] = mapped_column(String(100))
    # ── Convocation (document envoyé au candidat, avec QR) ──
    # Identifiant fourni par l'écran du recruteur : un double clic ou une relance réseau ne crée qu'une convocation.
    request_id: Mapped[str | None] = mapped_column(String(64))
    # Société qui convoque, quand la candidature n'est pas rattachée à une annonce (spontanée).
    society: Mapped[str | None] = mapped_column(String(150))
    address: Mapped[str | None] = mapped_column(String(400))
    map_url: Mapped[str | None] = mapped_column(String(400))
    contact_details: Mapped[str | None] = mapped_column(String(200))     # coordonnées professionnelles de l'interlocuteur
    purpose: Mapped[str | None] = mapped_column(String(200))
    documents_to_bring: Mapped[str | None] = mapped_column(Text)
    # Version envoyée en cours (0 : brouillon, ou entretien antérieur aux convocations avec QR).
    version: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    sent_by: Mapped[str | None] = mapped_column(String(100))
    # Trois notions distinctes : lecture par le candidat (version lue), sa réponse (`confirmed_at`), l'arrivée
    # constatée par le recruteur, et le résultat de l'entretien (`status` réalisé / absent, compte rendu).
    viewed_version: Mapped[int | None] = mapped_column(Integer)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime)
    arrived_by: Mapped[str | None] = mapped_column(String(100))
    # Grille d'entretien (mêmes critères que la fiche du vivier), interne.
    assessment: Mapped[dict | None] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint('application_id', 'request_id', name='uq_recruitment_interviews_request'),)


class RecruitmentConvocationVersion(Base):
    """Version envoyée d'une convocation : contenu figé et identifiant opaque du QR. Un report crée une
    nouvelle version ; l'ancienne reste identifiable (remplacée), jamais validable."""
    __tablename__ = 'recruitment_convocation_versions'
    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(ForeignKey('recruitment_interviews.id', ondelete='CASCADE'), index=True)
    version: Mapped[int] = mapped_column(Integer)
    # Identifiant aléatoire du QR (jamais un identifiant interne) ; il ne donne accès à rien sans session recruteur.
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    issued_by: Mapped[str | None] = mapped_column(String(100))
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    __table_args__ = (UniqueConstraint('interview_id', 'version', name='uq_recruitment_convocation_version'),)


class RecruitmentApplicationDocument(Base):
    """Pièce transmise pour une candidature. Copie figée à la réception : remplacer le CV du profil
    ne modifie pas ce qui a déjà été transmis."""
    __tablename__ = 'recruitment_application_documents'
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey('recruitment_applications.id', ondelete='CASCADE'), index=True)
    kind: Mapped[str] = mapped_column(String(20))                    # cv, photo, complement
    label: Mapped[str] = mapped_column(String(150))
    name: Mapped[str] = mapped_column(String(180))
    mime_type: Mapped[str] = mapped_column(String(40))
    size: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = deferred(mapped_column(Text))             # base64, jamais chargé par les listes
    source: Mapped[str] = mapped_column(String(20), default='candidature', server_default='candidature')
    request_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RecruitmentDocumentRequest(Base):
    """Pièce complémentaire demandée au candidat pour une candidature."""
    __tablename__ = 'recruitment_document_requests'
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey('recruitment_applications.id', ondelete='CASCADE'), index=True)
    label: Mapped[str] = mapped_column(String(150))
    note: Mapped[str | None] = mapped_column(String(400))
    due: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default='requested', server_default='requested', index=True)   # requested, received, cancelled
    created_by: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    received_at: Mapped[datetime | None] = mapped_column(DateTime)


class RecruitmentApplicationNote(Base):
    """Note interne du recrutement : invisible du candidat, absente de toute API publique."""
    __tablename__ = 'recruitment_application_notes'
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey('recruitment_applications.id', ondelete='CASCADE'), index=True)
    author: Mapped[str] = mapped_column(String(100))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RecruitmentApplicationEvent(Base):
    """Historique daté des actions sur une candidature (interne)."""
    __tablename__ = 'recruitment_application_events'
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey('recruitment_applications.id', ondelete='CASCADE'), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    summary: Mapped[str] = mapped_column(String(400))
    actor: Mapped[str] = mapped_column(String(100))
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RecruitmentApplicationContract(Base, TimestampMixin):
    """Préparation et suivi du contrat d'une candidature retenue. La signature est une information
    saisie par le recrutement : aucun contrat n'est considéré signé automatiquement."""
    __tablename__ = 'recruitment_application_contracts'
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey('recruitment_applications.id', ondelete='CASCADE'), unique=True)
    template_id: Mapped[int | None] = mapped_column(Integer)
    society: Mapped[str] = mapped_column(String(150))
    position: Mapped[str] = mapped_column(String(150))
    contract_type: Mapped[str] = mapped_column(String(80))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    work_place: Mapped[str | None] = mapped_column(String(200))
    salary_net: Mapped[float | None] = mapped_column(Float)
    conditions: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(20), default='prepared', server_default='prepared', index=True)   # prepared, sent, signed
    prepared_by: Mapped[str | None] = mapped_column(String(100))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    signed_on: Mapped[date | None] = mapped_column(Date)
    signed_recorded_by: Mapped[str | None] = mapped_column(String(100))
    signed_recorded_at: Mapped[datetime | None] = mapped_column(DateTime)
    shared_with_candidate: Mapped[bool] = mapped_column(Boolean, default=False, server_default='0')


class RecruitmentTip(Base, TimestampMixin):
    """Conseil emploi : contenu éditorial géré par le recrutement, distinct des annonces."""
    __tablename__ = 'recruitment_tips'
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(150))
    summary: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(20), default='candidature', server_default='candidature')   # cv, entretien, candidature
    minutes: Mapped[int] = mapped_column(Integer, default=3, server_default='3')
    status: Mapped[str] = mapped_column(String(20), default='draft', server_default='draft', index=True)
    updated_by: Mapped[str | None] = mapped_column(String(100))


class RecruitmentJobAlert(Base, TimestampMixin):
    """Critères enregistrés par un candidat : une nouvelle annonce correspondante crée une notification."""
    __tablename__ = 'recruitment_job_alerts'
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey('recruitment_candidate_accounts.id', ondelete='CASCADE'), index=True)
    wilaya: Mapped[str | None] = mapped_column(String(120))
    profession: Mapped[str | None] = mapped_column(String(150))
    contract_type: Mapped[str | None] = mapped_column(String(40))
    company_id: Mapped[int | None] = mapped_column(ForeignKey('recruitment_companies.id', ondelete='CASCADE'))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default='1')


class RecruitmentNotification(Base):
    __tablename__ = 'recruitment_notifications'
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey('recruitment_candidate_accounts.id', ondelete='CASCADE'), index=True)
    kind: Mapped[str] = mapped_column(String(20))            # application, message, interview, offer
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(String(400))
    application_id: Mapped[int | None] = mapped_column(Integer)
    interview_id: Mapped[int | None] = mapped_column(Integer)
    offer_id: Mapped[int | None] = mapped_column(Integer)
    # Clé d'unicité facultative : une même annonce ne notifie un candidat qu'une fois.
    dedup: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    __table_args__ = (UniqueConstraint('account_id', 'dedup', name='uq_recruitment_notifications_dedup'),)


class RecruitmentPushDevice(Base, TimestampMixin):
    __tablename__ = 'recruitment_push_devices'
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey('recruitment_candidate_accounts.id', ondelete='CASCADE'), index=True)
    token: Mapped[str] = mapped_column(String(200), unique=True)
    platform: Mapped[str] = mapped_column(String(12))


class RecruitmentPushDelivery(Base):
    """File persistante par notification/appareil ; aucun contenu ni jeton dupliqué."""
    __tablename__ = 'recruitment_push_deliveries'
    id: Mapped[int] = mapped_column(primary_key=True)
    notification_id: Mapped[int] = mapped_column(ForeignKey('recruitment_notifications.id', ondelete='CASCADE'), index=True)
    device_id: Mapped[int | None] = mapped_column(ForeignKey('recruitment_push_devices.id', ondelete='SET NULL'), index=True)
    state: Mapped[str] = mapped_column(String(24), default='pending', index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ticket_id: Mapped[str | None] = mapped_column(String(100))
    error_code: Mapped[str | None] = mapped_column(String(80))
    __table_args__ = (UniqueConstraint('notification_id', 'device_id', name='uq_recruitment_push_delivery'),)
