"""IRON Emploi — convocations à un entretien : contenu figé par version, QR opaque, états, lecture du QR.

La convocation est l'entretien existant (`recruitment_interviews`) vu comme un document envoyé au
candidat : rien n'est dupliqué. Chaque envoi (premier envoi, report, modification du contenu imprimé)
crée une version avec son propre identifiant aléatoire, imprimé dans le QR ; la précédente est marquée
remplacée. Le QR ne donne accès à rien : il désigne une version, que seul un recruteur connecté et dans
son périmètre peut ouvrir.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.modules.recruitment_engage_models import (
    INTERVIEW_CANCELLED, INTERVIEW_CONFIRMED, INTERVIEW_DONE, INTERVIEW_DRAFT, INTERVIEW_NO_SHOW, INTERVIEW_PROPOSED,
    RecruitmentConvocationVersion as Version, RecruitmentInterview as Interview,
)

TIMEZONE = 'Africa/Algiers'
TOKEN_RE = re.compile(r'^[A-Za-z0-9_-]{32}$')
REFERENCE_RE = re.compile(r'^CONV-(\d{4})-(\d{6})(?:-V(\d{1,3}))?$')
# Mêmes critères (et même barème sur 10) que la grille d'entretien de la fiche du vivier (recrute.html).
CRITERIA = {
    'identite': 'Identité et complétude du dossier', 'coordonnees': 'Coordonnées et disponibilité',
    'profil': 'Profil et adéquation au poste', 'experience': 'Expérience professionnelle',
    'competences': 'Compétences et habilitations', 'motivation': 'Motivation et projet professionnel',
    'communication': 'Communication et présentation', 'contraintes': 'Disponibilité et contraintes opérationnelles',
}
# États affichés au candidat : lecture, réponse et résultat restent des données distinctes ; seul l'affichage les combine.
STATES = {
    'new': 'Nouvelle', 'viewed': 'Consultée', 'confirmed': 'Présence confirmée', 'rescheduled': 'Reportée',
    'cancelled': 'Annulée', 'done': 'Entretien réalisé', 'no_show': 'Absence constatée',
}
SENT_STATUSES = (INTERVIEW_PROPOSED, INTERVIEW_CONFIRMED)
# Champs imprimés : leur modification sur une convocation envoyée crée une nouvelle version.
PRINTED_FIELDS = ('starts_at', 'location', 'address', 'map_url', 'contact', 'contact_details', 'purpose', 'documents_to_bring', 'note', 'society')


def reference(interview: Interview) -> str:
    year = interview.created_at.year if interview.created_at else datetime.utcnow().year
    return f'CONV-{year}-{interview.id:06d}'


def application_reference(application) -> str:
    year = application.created_at.year if application.created_at else datetime.utcnow().year
    return f'CDT-{year}-{application.id:06d}'


def new_token() -> str:
    return secrets.token_urlsafe(24)                     # 32 caractères, 192 bits aléatoires


def qr_url(token: str) -> str:
    return f'{get_settings().recruitment_public_origin}/#convocation={token}'


def short(token: str | None) -> str:
    """Empreinte courte pour les journaux : jamais le jeton complet."""
    return f'{token[:4]}…' if token else ''


def scanned_code(text: str) -> tuple[str, str] | None:
    """Ce que désigne un QR lu ou une saisie : ('token', …) ou ('reference', …). Une adresse n'est acceptée
    que sur l'origine publique configurée ; elle n'est jamais suivie."""
    text = (text or '').strip()
    if TOKEN_RE.match(text):
        return 'token', text
    upper = text.upper().replace(' ', '')
    if REFERENCE_RE.match(upper):
        return 'reference', upper
    try:
        parts = urlsplit(text)
    except ValueError:
        return None
    origin = urlsplit(get_settings().recruitment_public_origin)
    if parts.scheme != 'https' or (parts.hostname or '').lower() != (origin.hostname or '').lower() or parts.port != origin.port:
        return None
    token = (parse_qs(parts.fragment).get('convocation') or [''])[0]
    return ('token', token) if TOKEN_RE.match(token) else None


def _clean(value) -> str | None:
    value = str(value or '').strip()
    return value or None


def snapshot(interview: Interview, application, offer, candidate, *, society_name: str | None, logo_path: str | None,
             dossier_reference: str) -> dict:
    """Contenu imprimé de la convocation, figé à l'envoi. Ni NIN, ni salaire, ni note interne, ni décision."""
    return {
        'society': society_name, 'logo_path': logo_path,
        'candidate': {'first_name': candidate.first_name or '', 'last_name': candidate.last_name or ''},
        'dossier_reference': dossier_reference, 'application_reference': application_reference(application), 'reference': reference(interview),
        'offer': {'title': offer.title, 'reference': _clean(offer.reference)} if offer else None,
        'position': (offer.title if offer else application.position) or '',
        'starts_at': interview.starts_at.isoformat(timespec='minutes'), 'timezone': TIMEZONE,
        'location': interview.location, 'address': _clean(interview.address), 'map_url': _clean(interview.map_url),
        'contact': _clean(interview.contact), 'contact_details': _clean(interview.contact_details),
        'purpose': _clean(interview.purpose), 'documents_to_bring': _clean(interview.documents_to_bring),
        'instructions': _clean(interview.note),
    }


def printable_problems(content: dict) -> str:
    """Caractères qu'aucune police du document ne sait dessiner : la convocation n'est alors pas émise,
    plutôt que d'imprimer des carrés illisibles."""
    from app.modules.drh import badge_text

    seen: list[str] = []

    def walk(value):
        if isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, str):
            for char in badge_text.unsupported(value):
                if char not in seen:
                    seen.append(char)
    walk({key: value for key, value in content.items() if key not in ('logo_path', 'map_url')})
    return ''.join(seen)


def current_version(db: Session, interview: Interview) -> Version | None:
    if not interview.version:
        return None
    return db.scalar(select(Version).where(Version.interview_id == interview.id, Version.version == interview.version))


def issue(db: Session, interview: Interview, content: dict, actor: str) -> Version:
    """Nouvelle version envoyée : la précédente est marquée remplacée. L'appelant tient le verrou de l'entretien."""
    problems = printable_problems(content)
    if problems:
        raise HTTPException(status_code=422, detail=f'Caractères impossibles à imprimer dans la convocation : {problems}. Corrigez la saisie.')
    now = datetime.utcnow()
    db.execute(update(Version).where(Version.interview_id == interview.id, Version.superseded_at.is_(None), Version.cancelled_at.is_(None))
               .values(superseded_at=now))
    interview.version = (interview.version or 0) + 1
    if interview.sent_at is None:
        interview.sent_at, interview.sent_by = now, actor
    row = Version(interview_id=interview.id, version=interview.version, token=new_token(), snapshot=content, issued_at=now, issued_by=actor)
    db.add(row)
    db.flush()
    return row


def cancel_versions(db: Session, interview: Interview) -> None:
    db.execute(update(Version).where(Version.interview_id == interview.id, Version.cancelled_at.is_(None), Version.superseded_at.is_(None))
               .values(cancelled_at=datetime.utcnow()))


def candidate_state(interview: Interview) -> str:
    if interview.status == INTERVIEW_CANCELLED:
        return 'cancelled'
    if interview.status == INTERVIEW_DONE:
        return 'done'
    if interview.status == INTERVIEW_NO_SHOW:
        return 'no_show'
    if interview.status == INTERVIEW_CONFIRMED:
        return 'confirmed'
    if interview.previous_starts_at and (interview.viewed_version or 0) < (interview.version or 0):
        return 'rescheduled'
    if interview.version and (interview.viewed_version or 0) >= interview.version:
        return 'viewed'
    return 'new'


def version_state(interview: Interview, row: Version) -> str:
    """État d'une version présentée au scan : active, remplacée, annulée, ou entretien clos."""
    if row.cancelled_at or interview.status == INTERVIEW_CANCELLED:
        return 'cancelled'
    if row.version != interview.version or row.superseded_at:
        return 'superseded'
    if interview.status in (INTERVIEW_DONE, INTERVIEW_NO_SHOW):
        return 'closed'
    return 'active'


def qr_matrix(token: str) -> list[str]:
    from app.modules.drh.badge_design import qr_matrix as matrix

    return matrix(qr_url(token))


def clean_scores(raw: dict | None) -> dict | None:
    if not raw:
        return None
    scores = {}
    for key, value in raw.items():
        if key not in CRITERIA:
            raise HTTPException(status_code=422, detail='Critère d’entretien inconnu.')
        if value is None:
            continue
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 10:
            raise HTTPException(status_code=422, detail='Chaque note est un entier de 0 à 10.')
        scores[key] = value
    if not scores:
        return None
    return {'scores': scores, 'scale': 10, 'average': round(sum(scores.values()) / len(scores), 2), 'criteria': list(CRITERIA)}


def is_draft(interview: Interview) -> bool:
    return interview.status == INTERVIEW_DRAFT
