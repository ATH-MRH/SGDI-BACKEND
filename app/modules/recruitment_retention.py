"""IRON Emploi — durées de conservation : dossiers arrivés à échéance et aperçu de ce qu'une
suppression retirerait. LECTURE SEULE : ce module ne supprime ni ne modifie aucune donnée.

Durées fixées par la direction (notice de protection des données, version 2026-10-11) :
candidature non retenue, 24 mois après le refus ; espace candidat inactif, 24 mois après la
dernière activité ; dossier numérique d'une personne recrutée, 24 mois après son départ.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.auth.routes import is_admin_role
from app.modules.drh.models import Candidate, Employee
from app.modules.drh.routes import _ensure_recruitment_access
from app.modules.public_candidates import _identity_key, candidate_reference
from app.modules.recruitment_engage_models import (
    RecruitmentApplicationContract as Contract, RecruitmentApplicationDocument as Document, RecruitmentApplicationEvent as Event,
    RecruitmentApplicationNote as Note, RecruitmentConvocationVersion as ConvocationVersion, RecruitmentDocumentRequest as DocumentRequest,
    RecruitmentInterview as Interview,
    RecruitmentJobAlert as Alert, RecruitmentMessage as Message, RecruitmentNotification as Notification, RecruitmentPushDelivery as PushDelivery,
    RecruitmentPushDevice as PushDevice,
)
from app.modules.recruitment_jobs_models import (
    RecruitmentApplication as Application, RecruitmentCandidateAccount as Account, RecruitmentCandidateSession as CandidateSession,
)

RETENTION_MONTHS = 24
HIRED_STATUSES = {'embauche', 'recrute', 'recrutee'}
DEPARTED_STATUSES = {'sortant', 'demissionne', 'licencie'}
DEPARTURE_KEYS = ('dateSortie', 'exitDate')
MAX_ITEMS = 500
# Ce que la suppression d'un espace laisse au service recrutement, et pourquoi : affiché tel quel.
KEPT_WITH_APPLICATIONS = ('Les candidatures déjà transmises restent au service recrutement, détachées de l’espace, avec la copie '
                          'du profil envoyée avec chacune d’elles et leurs convocations. Supprimer l’espace ne les supprime pas : leur conservation '
                          'suit celle de la candidature (24 mois après un refus communiqué) ou du dossier de la personne recrutée.')

router = APIRouter(dependencies=[Depends(current_user)])


def months_before(day: date, months: int) -> date:
    """Même quantième `months` mois plus tôt ; un 29, 30 ou 31 absent du mois visé retombe sur son dernier jour."""
    index = day.year * 12 + day.month - 1 - months
    year, month = divmod(index, 12)
    month += 1
    last = (date(year + (month == 12), month % 12 + 1, 1) - date(year, month, 1)).days
    return date(year, month, min(day.day, last))


def _day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or '')[:10])
    except ValueError:
        return None


def _deadline(reference: date) -> dict:
    """Date qui fait courir le délai et jour où il est atteint, pour l'affichage."""
    return {'reference_on': reference.isoformat(), 'due_on': months_before(reference, -RETENTION_MONTHS).isoformat()}


def _counts(db: Session, model, column, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    return dict(db.execute(select(column, func.count()).where(column.in_(ids)).group_by(column)).all())


def _snapshot_counts(db: Session, account_ids: list[int]) -> dict[int, int]:
    """Copies de profil des candidatures de ces espaces. Comptées en Python : un JSON `null` n'est pas une copie."""
    counts: dict[int, int] = {}
    if account_ids:
        for account_id, snapshot in db.execute(select(Application.account_id, Application.profile_snapshot)
                                               .where(Application.account_id.in_(account_ids))).all():
            if snapshot:
                counts[account_id] = counts.get(account_id, 0) + 1
    return counts


def _identity(candidate: Candidate | None) -> dict:
    if candidate is None:
        return {'name': 'Dossier introuvable', 'reference': None, 'society': None}
    return {'name': f'{candidate.last_name} {candidate.first_name}'.strip(), 'reference': candidate_reference(candidate), 'society': candidate.society}


def _declined_applications(db: Session, cutoff: date) -> list[dict]:
    """Candidatures dont le refus a été communiqué : la date communiquée fait courir le délai."""
    refused_at = func.coalesce(Application.outcome_communicated_at, Application.status_updated_at)
    rows = db.scalars(select(Application).where(Application.outcome == 'unfavorable', refused_at.is_not(None))
                      .order_by(refused_at, Application.id)).all()
    due = [row for row in rows if _day(row.outcome_communicated_at or row.status_updated_at) <= cutoff][:MAX_ITEMS]
    ids = [row.id for row in due]
    candidates = {row.id: row for row in db.scalars(select(Candidate).where(Candidate.id.in_({row.candidate_id for row in due}))).all()} if due else {}
    linked = {name: _counts(db, model, model.application_id, ids) for name, model in (
        ('documents', Document), ('messages', Message), ('interviews', Interview), ('notes', Note), ('events', Event),
        ('document_requests', DocumentRequest), ('contracts', Contract))}
    # Versions envoyées des convocations (contenu figé, QR) : elles partent avec leur entretien.
    linked['convocation_versions'] = dict(db.execute(
        select(Interview.application_id, func.count()).join(ConvocationVersion, ConvocationVersion.interview_id == Interview.id)
        .where(Interview.application_id.in_(ids)).group_by(Interview.application_id)).all()) if ids else {}
    return [{'application_id': row.id, 'candidate_id': row.candidate_id, 'position': row.position, 'offer_id': row.offer_id,
             **_identity(candidates.get(row.candidate_id)), **_deadline(_day(row.outcome_communicated_at or row.status_updated_at)),
             'refused_on': _day(row.outcome_communicated_at or row.status_updated_at).isoformat(),
             'basis': 'refus communiqué' if row.outcome_communicated_at else 'dernier changement d’état',
             # La copie du profil fait partie de la candidature : elle partirait avec elle.
             'would_delete': {'application': 1, 'profile_snapshot': int(bool(row.profile_snapshot)),
                              **{name: values.get(row.id, 0) for name, values in linked.items()}}} for row in due]


def _inactive_accounts(db: Session, cutoff: date) -> list[dict]:
    activity = func.coalesce(Account.last_activity_at, Account.updated_at, Account.created_at)
    rows = db.execute(select(Account.id, Account.first_name, Account.last_name, Account.last_activity_at, Account.updated_at, Account.created_at,
                             Account.cv_meta.is_not(None), Account.photo.is_not(None))
                      .where(activity < datetime.combine(cutoff, datetime.max.time())).order_by(activity, Account.id).limit(MAX_ITEMS)).all()
    ids = [row[0] for row in rows]
    snapshots = _snapshot_counts(db, ids)
    # Envois push encore en file : ils partent avec les notifications de l'espace.
    deliveries = dict(db.execute(select(Notification.account_id, func.count()).join(PushDelivery, PushDelivery.notification_id == Notification.id)
                                 .where(Notification.account_id.in_(ids)).group_by(Notification.account_id)).all()) if ids else {}
    convocations = dict(db.execute(select(Application.account_id, func.count()).join(Interview, Interview.application_id == Application.id)
                                   .where(Application.account_id.in_(ids), Interview.version > 0).group_by(Application.account_id)).all()) if ids else {}
    alerts, notifications, devices, sessions, kept = (
        _counts(db, model, column, ids) for model, column in ((Alert, Alert.account_id), (Notification, Notification.account_id),
                                                              (PushDevice, PushDevice.account_id), (CandidateSession, CandidateSession.account_id),
                                                              (Application, Application.account_id)))
    return [{'account_id': account_id, 'name': f'{last_name} {first_name}'.strip(), 'reference': None, 'society': None,
             **_deadline(_day(last_activity or updated_at or created_at)),
             'last_activity_on': _day(last_activity or updated_at or created_at).isoformat(),
             'basis': 'dernière activité' if last_activity else 'dernière modification du profil',
             'would_delete': {'account': 1, 'cv': int(has_cv), 'photo': int(has_photo), 'alerts': alerts.get(account_id, 0),
                              'notifications': notifications.get(account_id, 0), 'push_deliveries': deliveries.get(account_id, 0),
                              'push_devices': devices.get(account_id, 0), 'sessions': sessions.get(account_id, 0)},
             'would_keep': {'applications_detached': kept.get(account_id, 0), 'profile_snapshots': snapshots.get(account_id, 0),
                            'convocations': convocations.get(account_id, 0)},
             'would_keep_reason': KEPT_WITH_APPLICATIONS if kept.get(account_id, 0) else None}
            for account_id, first_name, last_name, last_activity, updated_at, created_at, has_cv, has_photo in rows]


def _dossiers(db: Session, cutoff: date) -> tuple[list[dict], list[dict], list[dict]]:
    """Dossiers du vivier : refusés hors candidature IRON Emploi, et personnes recrutées puis parties."""
    declined, departed, undated = [], [], []
    tracked = set(db.scalars(select(Application.candidate_id).where(Application.outcome == 'unfavorable')).all())
    for row in db.execute(select(Candidate).order_by(Candidate.id).execution_options(yield_per=200)).scalars():
        data = row.data if isinstance(row.data, dict) else {}
        entry = {'candidate_id': row.id, **_identity(row)}
        if _identity_key(row.status).lower() in HIRED_STATUSES:
            employee = db.get(Employee, int(data['convertedEmployeeId'])) if str(data.get('convertedEmployeeId') or '').isdigit() else None
            if employee is None or _identity_key(employee.status).lower() not in DEPARTED_STATUSES:
                continue
            extra = employee.extra if isinstance(employee.extra, dict) else {}
            left_on = next((day for day in (_day(extra.get(key)) for key in DEPARTURE_KEYS) if day), None)
            entry.update(employee_id=employee.id, employee_code=employee.code, employee_status=employee.status)
            if left_on is None:
                undated.append({**entry, 'reason': 'date de départ non enregistrée'})
            elif left_on <= cutoff:
                departed.append({**entry, **_deadline(left_on), 'left_on': left_on.isoformat(), 'basis': 'date de sortie de la fiche employé',
                                 'would_delete': {'candidate_dossier': 1}})
        elif _identity_key(data.get('avisDecision')).lower() == 'defavorable' and row.id not in tracked:
            refused_on = _day(data.get('avisDate'))
            if refused_on is None:
                undated.append({**entry, 'reason': 'date de l’avis défavorable non enregistrée'})
            elif refused_on <= cutoff:
                declined.append({**entry, **_deadline(refused_on), 'refused_on': refused_on.isoformat(), 'basis': 'date de l’avis défavorable',
                                 'would_delete': {'candidate_dossier': 1}})
    return declined[:MAX_ITEMS], departed[:MAX_ITEMS], undated[:MAX_ITEMS]


def retention_report(db: Session, today: date | None = None) -> dict:
    today = today or date.today()
    cutoff = months_before(today, RETENTION_MONTHS)
    applications, accounts = _declined_applications(db, cutoff), _inactive_accounts(db, cutoff)
    declined, departed, undated = _dossiers(db, cutoff)
    sections = {'declined_applications': applications, 'declined_dossiers': declined, 'inactive_accounts': accounts,
                'departed_recruits': departed, 'undated': undated}
    return {'generated_on': today.isoformat(), 'simulated': today != date.today(), 'retention_months': RETENTION_MONTHS,
            'due_before': cutoff.isoformat(), 'dry_run': True, 'limit': MAX_ITEMS,
            'counts': {name: len(items) for name, items in sections.items()}, **sections}


@router.get('')
def retention_due(as_of: date | None = Query(default=None), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Aperçu des dossiers arrivés à échéance. Réservé à un administrateur ou à un recruteur à périmètre global ;
    aucune suppression n'est proposée par l'API."""
    _ensure_recruitment_access(user)
    if not (is_admin_role(user.role) or getattr(user, 'global_society_access', False)):
        raise HTTPException(status_code=403, detail='Aperçu réservé à un administrateur ou à un recruteur à périmètre global')
    return retention_report(db, as_of)
