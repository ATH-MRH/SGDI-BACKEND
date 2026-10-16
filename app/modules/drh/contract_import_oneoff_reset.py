"""Reset administratif borné : une autorisation consommable, jamais un bypass d'import."""
from datetime import datetime, timezone
import json
import secrets

from fastapi import HTTPException
from sqlalchemy import select, update

from app.core.audit import append_audit
from app.core.scope_policy import society_key
from app.modules.auth.models import AuditEvent
from app.modules.auth.routes import is_admin_role
from app.modules.drh import contract_import_oneoff as oneoff
from app.modules.drh.candidate_import_models import CandidateImportSession
from app.modules.drh.models import Candidate, Contract, Document, Employee, GeneratedContract

REASON = 'Réinitialisation exceptionnelle du lot contractualisation Excel'
MARKER = '_session_reset'
PREFIX = 'reset-'


def can_reset(user):
    return is_admin_role(user.role) and str(user.access_level or '').upper() == 'H5'


def require_admin(user):
    if not can_reset(user):
        raise HTTPException(403, 'Réinitialisation réservée aux administrateurs H5')


def _scope(society, file_sha256, batch_key):
    if (society_key(society) != society_key(oneoff.SOCIETY)
            or file_sha256 != oneoff.FILE_SHA256 or batch_key != oneoff.BATCH_KEY):
        raise HTTPException(409, 'Société, empreinte ou lot hors du périmètre exceptionnel')


def _has_creation(value):
    if isinstance(value, list):
        return any(_has_creation(item) for item in value)
    if not isinstance(value, dict):
        return False
    for key, item in value.items():
        if key in {'created_contracts','created_employees','created_documents','CRÉÉ'} and item not in (0, None, '0'):
            return True
        if key in {'contract_id','employee_id','document_id','generated_contract_id'} and item:
            return True
        if key == 'status' and item == 'CRÉÉ':
            return True
        if _has_creation(item):
            return True
    return False


def _check_business(db, grant, session):
    """Ne pas se fier aux seuls compteurs : relire snapshots, liens métier et audit."""
    snapshots = [grant.preparation, session.result if session else None, session.plan if session else None]
    if any(_has_creation(value) for value in snapshots):
        raise HTTPException(409, 'Création métier détectée : reset interdit')
    ids = set(grant.candidate_ids or [])
    for value in snapshots:
        if isinstance(value, dict):
            preview = value.get('preview', value)
            ids.update(r['candidate_id'] for r in preview.get('rows', []) if r.get('candidate_id'))
    candidates = db.scalars(select(Candidate)).all()
    for candidate in candidates:
        data = candidate.data or {}
        if candidate.id in ids or data.get('contractImportSession') == grant.session_id:
            ids.add(candidate.id)
            if candidate.status == 'embauche' or data.get('convertedEmployeeId') or data.get('convertedContractId'):
                raise HTTPException(409, 'Dossier déjà converti : reset interdit')
    # Le recrutement normal verrouille ces mêmes lignes ; un reset ne contourne pas une conversion en cours.
    if ids:
        db.scalars(select(Candidate).where(Candidate.id.in_(ids)).with_for_update()).all()
    names = {oneoff.comparison_key(f'{c.last_name} {c.first_name}') for c in candidates if c.id in ids}
    file_names = set()
    if session and session.workbook:
        for sheet in session.workbook.get('sheets', []):
            for _, cells in oneoff.excel.sheet_layout(sheet)['data_rows']:
                if len(cells) > 4:
                    file_names.add(oneoff.comparison_key(' '.join(oneoff.excel.cell_display(v) for v in cells[3:5])))
    linked_employee_ids = set()
    keys = {str(key) for key in ids}
    for employee in db.scalars(select(Employee)).all():
        data = employee.extra or {}
        name = oneoff.comparison_key(f'{employee.last_name} {employee.first_name}')
        same_society = society_key(employee.society) == society_key(oneoff.SOCIETY)
        recent_file_identity = (same_society and name in file_names
                                and (employee.created_at is None or employee.created_at >= grant.authorized_at))
        if (str(data.get('sourceCandidateId')) in keys or data.get('contractImportSession') == grant.session_id
                or (same_society and name in names) or recent_file_identity):
            linked_employee_ids.add(employee.id)
    if linked_employee_ids:
        if db.scalar(select(Contract.id).where(Contract.employee_id.in_(linked_employee_ids)).limit(1)):
            raise HTTPException(409, 'Contrat lié au lot : reset interdit')
        if db.scalar(select(GeneratedContract.id).where(GeneratedContract.employee_id.in_(linked_employee_ids)).limit(1)):
            raise HTTPException(409, 'Document contractuel lié au lot : reset interdit')
        raise HTTPException(409, 'Employé lié au lot : reset interdit')
    # Des références métier dans un snapshot restent bloquantes, même si un objet a été supprimé.
    for event in db.scalars(select(AuditEvent).where(AuditEvent.new_state.contains(grant.session_id))).all():
        try:
            details = json.loads(event.new_state)
        except (TypeError, ValueError):
            raise HTTPException(409, 'Audit de session non vérifiable : reset interdit')
        if _has_creation(details) or (event.result == 'success' and event.action.endswith(('.created','.create','.generated','.recruited'))):
            raise HTTPException(409, 'Création métier auditée : reset interdit')
    # Un document récent lié au candidat peut être contractuel : en cas de doute, refus.
    for document in db.scalars(select(Document)).all():
        linked = document.owner_type == 'candidate' and document.owner_id in ids
        session_link = session and document.owner_type in {'contract_import','contract_import_session'} and document.owner_id == session.id
        contractual = 'contrat' in f'{document.label or ""} {document.file_name or ""}'.casefold()
        if (linked and (contractual or (document.created_at is None or document.created_at >= grant.authorized_at))) or session_link:
            raise HTTPException(409, 'Document lié au lot : reset interdit')
    # Les liens contractuels sont normalement portés par les employés / snapshots déjà vérifiés.
    # Les traces explicites de session des documents générés restent un garde supplémentaire.
    for generated_values in db.scalars(select(GeneratedContract.values)).all():
        values = generated_values or {}
        if values.get('contractImportSession') == grant.session_id or values.get('session_id') == grant.session_id:
            raise HTTPException(409, 'Document contractuel généré : reset interdit')


def _check_old(db, grant):
    if grant.file_sha256 != oneoff.FILE_SHA256:
        raise HTTPException(409, 'Empreinte de la liaison différente du lot autorisé')
    if grant.session_id.startswith(PREFIX):
        raise HTTPException(409, 'Une nouvelle réservation est déjà autorisée ; reset supplémentaire interdit')
    session = db.scalar(select(CandidateImportSession).where(CandidateImportSession.public_id == grant.session_id).with_for_update())
    if session:
        if session.file_sha256 != oneoff.FILE_SHA256 or (session.workbook and society_key(session.workbook['society']) != society_key(oneoff.SOCIETY)):
            raise HTTPException(409, 'Ancienne session hors périmètre')
        if session.status == 'processing':
            raise HTTPException(409, 'Session en traitement : reset interdit')
        expired = session.expires_at <= datetime.now(timezone.utc).replace(tzinfo=None)
        unusable = session.status in {'cancelled','expired','failed'} or expired or session.workbook is None
        if not unusable:
            raise HTTPException(409, 'Ancienne session encore utilisable : annulez-la avant le reset')
    elif not (grant.preparation or {}).get('preparation_only'):
        raise HTTPException(409, 'Session purgée sans preuve suffisante de préparation seule')
    _check_business(db, grant, session)
    return session


def context(db, user, society, file_sha256, batch_key):
    require_admin(user)
    _scope(society, file_sha256, batch_key)
    grant = db.get(oneoff.ContractImportOneoffGrant, oneoff.BATCH_KEY)
    if not grant:
        raise HTTPException(404, 'Aucune liaison one-off à réinitialiser')
    result = {'old_session_id':grant.session_id, 'file_sha256':grant.file_sha256,
              'society':oneoff.SOCIETY, 'batch_key':oneoff.BATCH_KEY, 'can_reset':False}
    try:
        _check_old(db, grant)
        result['can_reset'] = True
    except HTTPException as exc:
        result['reason'] = exc.detail
    return result


def reset(db, user, request, *, society, file_sha256, batch_key, old_session_id):
    require_admin(user)
    _scope(society, file_sha256, batch_key)
    grant = db.scalar(select(oneoff.ContractImportOneoffGrant).where(oneoff.ContractImportOneoffGrant.batch_key == oneoff.BATCH_KEY).with_for_update())
    if not grant or grant.session_id != old_session_id:
        raise HTTPException(409, 'La liaison a changé : rechargez le contexte avant toute action')
    session = _check_old(db, grant)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    marker = {'old_session_id':old_session_id, 'new_session_id':None, 'available':True,
              'requested_by_user_id':user.id, 'requested_by_username':user.username,
              'requested_at':now.isoformat(), 'reason':REASON}
    released_id = PREFIX + secrets.token_hex(24)
    previous = {'session_id':grant.session_id, 'authorized_by_user_id':grant.authorized_by_user_id}
    changed = db.execute(update(oneoff.ContractImportOneoffGrant).where(
        oneoff.ContractImportOneoffGrant.batch_key == oneoff.BATCH_KEY,
        oneoff.ContractImportOneoffGrant.session_id == old_session_id,
        oneoff.ContractImportOneoffGrant.file_sha256 == oneoff.FILE_SHA256,
    ).values(session_id=released_id, preparation={**(grant.preparation or {}), MARKER:marker},
        authorized_by_user_id=user.id, authorized_by_username=user.username, authorized_at=now)
      .execution_options(synchronize_session=False))
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, 'Reset concurrent refusé : aucune liaison modifiée')
    if session:
        session.status, session.workbook, session.plan = 'cancelled', None, None
    append_audit(db, action='drh.contract.excel.oneoff.reset', resource='contract_import_oneoff',
        resource_id=oneoff.BATCH_KEY, user=user, request=request, society=oneoff.SOCIETY, result='success',
        old_state=previous, new_state={**marker, 'file_sha256':oneoff.FILE_SHA256, 'society':oneoff.SOCIETY})
    db.commit()
    return {'status':'reset', 'old_session_id':old_session_id, 'new_session_id':None,
            'message':'Liaison libérée pour un seul nouveau téléversement du même fichier exact.'}


def consume(db, user, session, grant):
    marker = (grant.preparation or {}).get(MARKER) or {}
    if not grant.session_id.startswith(PREFIX) or marker.get('available') is not True:
        return False
    updated = {**marker, 'available':False, 'new_session_id':session.public_id}
    changed = db.execute(update(oneoff.ContractImportOneoffGrant).where(
        oneoff.ContractImportOneoffGrant.batch_key == oneoff.BATCH_KEY,
        oneoff.ContractImportOneoffGrant.session_id == grant.session_id,
        oneoff.ContractImportOneoffGrant.file_sha256 == oneoff.FILE_SHA256,
    ).values(session_id=session.public_id, preparation={**grant.preparation, MARKER:updated})
      .execution_options(synchronize_session=False))
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, 'La réservation exceptionnelle a déjà été consommée')
    append_audit(db, action='drh.contract.excel.oneoff.reset.rebound', resource='contract_import_oneoff',
        resource_id=oneoff.BATCH_KEY, user=user, society=oneoff.SOCIETY, result='success',
        new_state={**updated, 'file_sha256':oneoff.FILE_SHA256, 'society':oneoff.SOCIETY})
    db.expire(grant)
    return True
