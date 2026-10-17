"""Dérogation de préparation pour le fichier exact de 96 lignes, identité D + E.

Pas de paramètre de bypass exposé au client. Le premier téléversement du fichier
autorisé lie définitivement la dérogation à une session privée et à son empreinte.
Les champs fournis restent validés ; aucun service de création n'est appelé ici.
"""
from collections import Counter
from datetime import date, datetime, timezone
from types import MappingProxyType, SimpleNamespace
import re
import unicodedata

from fastapi import HTTPException
from sqlalchemy import DateTime, Integer, JSON, String, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from app.core.audit import append_audit
from app.core.scope_policy import society_key
from app.db.base import Base
from app.modules.drh import candidate_import as excel, dc_client_sites, service
from app.modules.drh.models import Candidate

BATCH_KEY = 'regularisation-exceptionnelle-igs-20261016-96'
SOCIETY = 'IRON GLOBAL SOLUTION'
# Les identités sont résolues dans les dossiers actuels, jamais sur des IDs historiques.
FILE_SHA256 = 'd93cdd49848390596b405bfa39efe7335d8af5deee352286966dae5280fb63d0'
EXPECTED_ROWS = 96
# Décision utilisateur du 17/10 : identité à vérifier, aucune préparation automatique.
# Dossier candidat -> employé homonyme préexistant, sans affirmer leur identité commune.
MANUAL_REVIEW_EXCLUSIONS = MappingProxyType({2312: 2244, 2313: 2248, 2317: 2252, 2324: 2249})
# D = nom, E = prénom sans en-tête ; les autres colonnes restent à leur place.
FILE_MAPPING = {'0':'reference', '1':'code', '2':'phone', '3':'name',
                '5':'start_date', '6':'end_date', '7':'position', '8':'client_site',
                '9':'contract_type', '10':'duration', '11':'trial', '12':'template_id',
                '13':'salary', '14':'payment', '15':'bank', '16':'iban'}
MATCH = 'MATCH CERTAIN'
REVIEW = 'À VÉRIFIER'
NOT_FOUND = 'CANDIDAT INTROUVABLE'

REASON = 'Régularisation exceptionnelle du lot importé'
STATUS = 'Préparé exceptionnellement'
MESSAGE = 'Dérogation exceptionnelle appliquée à ce lot uniquement.'
VALUE_FIELDS = ('start_date', 'end_date', 'position', 'client_site', 'contract_type',
                'duration', 'trial', 'template_id', 'salary', 'payment', 'bank', 'iban')


class ContractImportOneoffGrant(Base):
    __tablename__ = 'drh_contract_import_oneoff_grants'
    batch_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    # Sans FK : le journal exceptionnel doit survivre à la purge des sessions Excel.
    session_id: Mapped[str] = mapped_column(String(64), unique=True)
    file_sha256: Mapped[str] = mapped_column(String(64))
    authorized_by_user_id: Mapped[int] = mapped_column(Integer)
    authorized_by_username: Mapped[str] = mapped_column(String(120))
    authorized_at: Mapped[datetime] = mapped_column(DateTime)
    candidate_ids: Mapped[list] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(180))
    preparation: Mapped[dict] = mapped_column(JSON)


def bind_upload(db, user, session):
    """Réserver atomiquement une seule session pour les octets expressément autorisés."""
    if session.file_sha256 != FILE_SHA256 or society_key(session.workbook['society']) != society_key(SOCIETY):
        return
    bound = db.get(ContractImportOneoffGrant, BATCH_KEY)
    if bound:
        from app.modules.drh.contract_import_oneoff_reset import consume
        if consume(db, user, session, bound):
            return
        raise HTTPException(409, 'Dérogation déjà liée à une session ; réattribution interdite')
    db.add(ContractImportOneoffGrant(batch_key=BATCH_KEY, session_id=session.public_id,
        file_sha256=FILE_SHA256, authorized_by_user_id=user.id, authorized_by_username=user.username,
        authorized_at=datetime.now(timezone.utc).replace(tzinfo=None),
        candidate_ids=[], reason=REASON, preparation={}))
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, 'Dérogation déjà liée à une autre session') from exc
    append_audit(db, action='drh.contract.excel.oneoff.authorized', resource='contract_import_oneoff',
        resource_id=BATCH_KEY, user=user, society=SOCIETY, result='success', new_state={
            'session_id':session.public_id, 'file_sha256':FILE_SHA256,
            'candidate_ids':[], 'reason':REASON,
            'authorized_by_user_id':user.id, 'authorized_at':datetime.now(timezone.utc).isoformat()})


def grant_for(db, session):
    grant = db.get(ContractImportOneoffGrant, BATCH_KEY)
    if grant and grant.session_id == session.public_id:
        if (grant.file_sha256 != session.file_sha256 or session.file_sha256 != FILE_SHA256
                or (session.workbook and society_key(session.workbook['society']) != society_key(SOCIETY))):
            raise HTTPException(409, 'Le lot ne correspond plus à la dérogation autorisée')
        return grant
    return None


def comparison_key(value):
    text = unicodedata.normalize('NFKD', str(value or '').casefold())
    return re.sub(r'[\W_]+', ' ', ''.join(c for c in text if not unicodedata.combining(c))).strip()


def preview_config(db, session, config):
    if not grant_for(db, session):
        return config
    if config['sheet'] != 0:
        raise HTTPException(422, 'Ce lot utilise uniquement la première feuille')
    layout = excel.sheet_layout(session.workbook['sheets'][0])
    if len(layout['data_rows']) != EXPECTED_ROWS:
        raise HTTPException(409, 'Le fichier autorisé doit contenir exactement 96 lignes')
    # Les valeurs de CE fichier priment ; aucune cellule vide n'est complétée.
    return {**config, 'mapping':dict(FILE_MAPPING), 'mode':'full', 'precedence':'excel', 'common':{}}


def match_row(cells, candidates, columns=()):
    """Comparaison seulement : ni les cellules, ni les dossiers ne sont modifiés."""
    def cell(index):
        return excel.cell_display(cells[index]) if index < len(cells) else ''
    name = ' '.join(v for v in (cell(3), cell(4)) if v).strip()
    result = {'candidate_id':None, 'candidate':name, 'match_status':NOT_FOUND,
              'status':NOT_FOUND, 'reason':'Aucun dossier actuellement à contractualiser dans la société active'}
    if not cell(3) or not comparison_key(name):
        return {**result, 'status':REVIEW, 'match_status':REVIEW, 'reason':'Identité absente ou insuffisante'}
    eligible = [c for c in candidates if c.status == 'a_contractualiser'
                and not (c.data or {}).get('convertedEmployeeId')]
    matches = [c for c in eligible if comparison_key(f'{c.last_name} {c.first_name}') == comparison_key(name)]
    if not matches:
        # Ne pas transformer un nom partiel en correspondance certaine.
        partial = any(comparison_key(c.last_name) == comparison_key(name) for c in eligible)
        if not cell(4) or partial:
            return {**result, 'status':REVIEW, 'match_status':REVIEW, 'reason':'Identité non vérifiée sans ambiguïté'}
        return result
    # Les références et contacts présents doivent corroborer l'identité, jamais la remplacer.
    for index, keys in ((0, ('referenceDossier','numeroDossier','reference')),
                        (1, ('codeCandidat','candidateCode','code'))):
        value = cell(index)
        if value:
            matches = [c for c in matches if comparison_key(value) in {
                comparison_key(v) for v in ([str(c.id), f'CAND-{c.id}'] if index == 0 else [])
                + [(c.data or {}).get(k) for k in keys] if v}]
            if not matches:
                return {**result, 'status':REVIEW, 'match_status':REVIEW, 'reason':'Conflit entre référence et identité'}
    if cell(2):
        phone = lambda value: re.sub(r'\D', '', str(value or ''))
        known = [c for c in matches if c.phone or (c.data or {}).get('telephone')]
        supported = [c for c in known if phone(cell(2)) == phone(c.phone or (c.data or {}).get('telephone'))]
        if known and not supported:
            return {**result, 'status':REVIEW, 'match_status':REVIEW, 'reason':'Conflit entre téléphone et identité'}
        # Une donnée inconnue ne peut pas éliminer un homonyme.
        matches = supported + [c for c in matches if c not in known]
    birth_columns = [c['index'] for c in columns if excel.norm_key(c['header']) in {'date de naissance','date naissance','birth date'}]
    for index in birth_columns:
        if cell(index):
            try:
                birth = excel._parse_date(cells[index])[0]
                known = [c for c in matches if (c.data or {}).get('dateNaissance')]
                supported = [c for c in known if excel._parse_date(c.data['dateNaissance'])[0] == birth]
            except (ValueError, excel._FieldError):
                return {**result, 'status':REVIEW, 'match_status':REVIEW, 'reason':'Date de naissance non vérifiable'}
            if known and not supported:
                return {**result, 'status':REVIEW, 'match_status':REVIEW, 'reason':'Conflit de date de naissance'}
            matches = supported + [c for c in matches if c not in known]
    if len(matches) != 1:
        return {**result, 'status':REVIEW, 'match_status':REVIEW, 'reason':'Plusieurs dossiers correspondent à cette identité'}
    candidate = matches[0]
    if candidate.id in MANUAL_REVIEW_EXCLUSIONS:
        return {**result, 'excluded_candidate_id': candidate.id,
                'status': REVIEW, 'match_status': REVIEW,
                'reason': 'Exclusion provisoire décidée : identité à vérifier avec un employé préexistant'}
    if not str(candidate.last_name or '').strip() or not str(candidate.first_name or '').strip():
        return {**result, 'status':REVIEW, 'match_status':REVIEW, 'reason':'Identité du dossier incomplète'}
    return {**result, 'candidate_id':candidate.id, 'candidate':f'{candidate.last_name} {candidate.first_name}',
            'status':'PRÊT', 'match_status':MATCH, 'reason':''}


def deny_creation(db, session):
    # Une ancienne session dérogatoire reste non créatrice après changement de fichier autorisé.
    bound = db.scalar(select(ContractImportOneoffGrant).where(ContractImportOneoffGrant.session_id == session.public_id))
    if bound or ((session.result or {}).get('preparation_only')) or session.file_sha256 == FILE_SHA256:
        raise HTTPException(409, 'Création désactivée pour ce lot exceptionnel : préparation uniquement')


def prepare_preview(db, user, session, config, normal):
    """Chemin séparé pour le fichier exact ; les validateurs normaux restent intacts."""
    bound = grant_for(db, session)
    if not bound:
        return normal
    from app.modules.drh.contract_import import duration_end
    layout = excel.sheet_layout(session.workbook['sheets'][config['sheet']])
    original = {row['row']: row for row in normal['rows']}
    options = dc_client_sites.list_client_site_options(db, session.workbook['society'])
    candidates = {c.id:c for c in db.scalars(select(Candidate)).all()
                  if society_key(c.society) == society_key(SOCIETY)}
    previous = {r['row']:r.get('candidate_id') for r in bound.preparation.get('rows', [])}
    for number, row in original.items():
        if previous and row.get('candidate_id') != previous.get(number):
            row.update(candidate_id=None, match_status=REVIEW, status=REVIEW,
                       reason='La correspondance a changé depuis la première vérification ; ligne exclue')
        if row['status'] in {'DOUBLON','DÉJÀ CONTRACTUALISÉ'}:
            row['match_status'] = REVIEW
    rows = []
    for number, cells in layout['data_rows']:
        raw = {key: cells[int(col)] if int(col) < len(cells) else None for col, key in config['mapping'].items() if key}
        supplied = {k: excel.cell_display(v) or None for k, v in raw.items()}
        if config['mode'] == 'dates':
            supplied = {k: v for k, v in supplied.items() if k in {'reference','code','phone','name','start_date','end_date'}}
        common = {k: v for k, v in config['common'].items() if k in VALUE_FIELDS and k not in {'start_date','end_date'} and v is not None and str(v).strip()}
        merged = ({**common, **{k: v for k, v in supplied.items() if v is not None}}
                  if config['precedence'] == 'excel' else {**supplied, **common})
        values = {key: merged.get(key) if merged.get(key) is not None and str(merged[key]).strip() else None for key in VALUE_FIELDS}
        row = {**original[number], 'values': values, 'status': STATUS, 'reason': '', 'warnings': [], 'preparation_only': True}
        candidate = candidates.get(row['candidate_id'])
        typ = None
        try:
            if original[number]['status'] in {'DOUBLON','DÉJÀ CONTRACTUALISÉ','CANDIDAT INTROUVABLE','À VÉRIFIER'}:
                raise ValueError(original[number]['reason'])
            if candidate.status != 'a_contractualiser' or not service._candidate_decision_is_favorable(candidate.data or {}):
                raise ValueError('Dossier non transmis ou décision non favorable')
            for key in ('start_date','end_date'):
                if values[key] is not None:
                    values[key], warning = excel._parse_date(raw[key], birth_date=False)
                    if warning:
                        row['warnings'].append(warning)
            if values['start_date'] and values['end_date'] and values['end_date'] < values['start_date']:
                raise ValueError('Date fin antérieure à la date début')
            typ = str(values['contract_type']).upper() if values['contract_type'] else None
            if typ and typ not in {'CDD','CDI','CIDD','CTA','APPRENTISSAGE'}:
                raise ValueError('Type de contrat invalide')
            values['contract_type'] = typ
            for key in ('duration','trial'):
                if values[key] is not None:
                    text = str(values[key])
                    if key == 'trial' and text in {'0','0d'}:
                        continue
                    duration_end(date(2000,1,1), text+'d' if key == 'trial' and text.isdigit() else text)
            if values['salary'] is not None:
                values['salary'] = float(str(values['salary']).replace(',', '.').replace(' ', ''))
                if not 0 <= values['salary'] < 1e12:
                    raise ValueError('Salaire invalide')
            if values['client_site'] is not None:
                selection = [o for o in options if excel.norm_key(o['label']) == excel.norm_key(values['client_site']) or str(values['client_site']) == f"{o['dc_client_id']}:{o['dc_site_id'] or ''}"]
                if len(selection) != 1:
                    raise ValueError('Client / site DC invalide ou ambigu')
                option = selection[0]
                dc_client_sites.resolve_contract_selection(db, dc_client_id=option['dc_client_id'], dc_site_id=option['dc_site_id'], society=session.workbook['society'])
            if values['template_id'] is not None:
                values['template_id'] = int(values['template_id'])
                template = service.find_contract_template(db, SimpleNamespace(template_id=values['template_id']), None)
                if typ and str(template.contract_type).upper() != typ:
                    raise ValueError('Le modèle ne correspond pas au type de contrat')
            if values['iban'] is not None and isinstance(raw.get('iban'), dict) and 'n' in raw['iban']:
                raise ValueError('RIB / IBAN numérique : saisir la cellule Excel au format texte pour conserver les zéros')
        except (ValueError, TypeError, HTTPException, excel._FieldError) as exc:
            row.update(status=original[number]['status'] if original[number]['status'] in {'DOUBLON','DÉJÀ CONTRACTUALISÉ',REVIEW,NOT_FOUND} else 'À CORRIGER', reason=str(exc.detail if isinstance(exc, HTTPException) else exc))
        row['missing_fields'] = [key for key in VALUE_FIELDS if values[key] is None]
        required = ['start_date','position','contract_type','template_id','client_site']
        if typ != 'CDI' and values['end_date'] is None:
            required.append('duration')
        row['required_missing_fields'] = [key for key in required if values[key] is None]
        rows.append(row)

    prepared = [row for row in rows if row['status'] == STATUS]
    result = {'rows': rows, 'counts': dict(Counter(r['status'] for r in rows)), 'total': len(rows),
              'complete': sum(not r['required_missing_fields'] for r in prepared),
              'prepared_missing': sum(bool(r['required_missing_fields']) for r in prepared),
              'recognized':sum(r.get('match_status') == MATCH for r in rows),
              'to_review':sum(r.get('match_status') == REVIEW for r in rows),
              'not_found':sum(r.get('match_status') == NOT_FOUND for r in rows),
              'preparable':len(prepared),
              'blocked':sum(r.get('match_status') == MATCH and r['status'] != STATUS for r in rows), 'preparation_only': True, 'oneoff_batch': BATCH_KEY, 'message': MESSAGE}
    try:
        if not previous:
            bound.candidate_ids = sorted({r['candidate_id'] for r in rows if r.get('match_status') == MATCH})
        bound.preparation = result
        # Une entrée par candidat évite la troncature du journal d'audit à 4 000 caractères.
        for row in rows:
            append_audit(db, action='drh.contract.excel.oneoff.prepared', resource='candidate' if row['candidate_id'] else 'contract_import_row', resource_id=row['candidate_id'] or f"{session.public_id}:{row['row']}",
                user=user, society=SOCIETY, result='success' if row['status'] == STATUS else 'refused', new_state={
                    'session_id': session.public_id, 'batch_key': BATCH_KEY, 'candidate_id': row['candidate_id'],
                    'excluded_candidate_id': row.get('excluded_candidate_id'),
                    'missing_fields': row['missing_fields'], 'status': row['status'], 'match_status':row.get('match_status'), 'reason': REASON,
                    'authorized_by_user_id': bound.authorized_by_user_id, 'authorized_at': bound.authorized_at.isoformat()})
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, 'Dérogation déjà liée à une autre session : aucun changement enregistré') from exc
    return result


def save_preparation(db, user, session, request):
    grant = grant_for(db, session)
    preview = (session.plan or {}).get('preview') or {}
    if not grant or not preview.get('preparation_only'):
        raise HTTPException(409, 'Cette session n’a pas de dérogation de préparation')
    if preview.get('blocked') or not preview.get('preparable'):
        raise HTTPException(422, 'Corrigez les valeurs invalides ; seules les cellules vides sont autorisées')
    prepared_ids = {r['candidate_id'] for r in preview.get('rows', []) if r['status'] == STATUS}
    if not prepared_ids or not prepared_ids <= set(grant.candidate_ids):
        raise HTTPException(409, 'La préparation dépasse les candidats reconnus autorisés pour cette session')
    # Snapshot uniquement : aucun Candidate, Employee, Contract, GeneratedContract ou Document écrit.
    session.result = {**preview, 'saved_at': datetime.now(timezone.utc).isoformat(), 'created_contracts': 0, 'created_employees': 0, 'created_documents': 0}
    session.status = 'prepared'
    grant.preparation = session.result
    append_audit(db, action='drh.contract.excel.oneoff.saved', resource='contract_import_oneoff', resource_id=BATCH_KEY,
        user=user, request=request, society=SOCIETY, result='success', new_state={'session_id':session.public_id,'reason':REASON,'total':preview['total'],'created_contracts':0,'created_employees':0,'created_documents':0})
    session.workbook = None
    session.plan = None
    db.commit()
    return session.result
