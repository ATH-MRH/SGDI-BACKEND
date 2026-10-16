"""Contractualisation en lot : lecteur et sessions Excel partagés avec le recrutement.

Aperçu sans écriture métier ; confirmation atomique par candidat, résultat persisté
avec son contrat. Les sessions sont séparées par leur préfixe contract-.
"""
from collections import Counter
from datetime import date, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace
import hashlib
import logging
import re
import secrets

from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import select, update

from app.core.audit import append_audit
from app.core.scope_policy import society_key
from app.modules.drh import candidate_import as excel, contract_import_oneoff as oneoff, dc_client_sites, service
from app.modules.drh.candidate_import_models import CandidateImportSession
from app.modules.drh.models import Candidate, Employee

logger = logging.getLogger(__name__)
FIELDS = {
    'reference': 'Référence candidat', 'code': 'Code candidat', 'phone': 'Téléphone',
    'name': 'Nom + prénom', 'start_date': 'Date début', 'end_date': 'Date fin manuelle',
    'position': 'Poste / fonction', 'client_site': 'Client / site', 'contract_type': 'Type contrat',
    'duration': 'Durée', 'trial': 'Période d’essai', 'template_id': 'Modèle de contrat',
    'salary': 'Salaire', 'payment': 'Mode paiement', 'bank': 'Banque', 'iban': 'RIB / IBAN',
}
ALIASES = {excel.norm_key(v): k for k, v in FIELDS.items()}
ALIASES.update({excel.norm_key(k): k for k in FIELDS})
ALIASES.update({'id recrutement': 'reference', 'reference dossier': 'reference', 'date debut contrat': 'start_date'})


def describe(workbook):
    result = excel.describe_workbook(workbook)
    for sheet in result['sheets']:
        used = set()
        for column in sheet['columns']:
            key = ALIASES.get(excel.norm_key(column['header']))
            column['suggested'] = key if key not in used else None
            used.add(key)
    return result


def upload(db, user, file_name, content, society):
    try:
        workbook = excel.read_workbook(file_name, content)
    except excel.ImportFileError as exc:
        raise HTTPException(422, str(exc)) from exc
    excel.purge_sessions(db)
    scope, label = excel.scope_fingerprint(user)
    session = CandidateImportSession(public_id='contract-' + secrets.token_hex(24), user_id=user.id,
        username=user.username, scope_key=scope, scope_label=label, file_name=file_name[:255],
        file_sha256=hashlib.sha256(content).hexdigest(), file_size=len(content), status='uploaded',
        workbook={**workbook, 'society': society}, expires_at=datetime.utcnow() + timedelta(minutes=excel.SESSION_TTL_MINUTES))
    db.add(session)
    oneoff.bind_upload(db, user, session)
    db.commit()
    return {'session_id': session.public_id, **describe(workbook),
            'preparation_only_file':bool(oneoff.grant_for(db, session))}


def get_session(db, user, public_id, statuses=None):
    return excel.get_session(db, user, public_id, statuses=statuses, purpose='contracts')


def duration_end(start, duration):
    """Même report de mois que Date.setMonth dans le formulaire existant."""
    match = re.fullmatch(r'(\d+)\s*(m|mois|d|j|jours?)', str(duration).strip().lower())
    if not match or not 0 < int(match[1]) <= 1200:
        raise ValueError('Durée invalide : utiliser 12m, 6m ou 30d')
    count = int(match[1])
    if match[2] in {'m', 'mois'}:
        month = start.year * 12 + start.month - 1 + count
        return date(month // 12, month % 12 + 1, 1) + timedelta(days=start.day - 1)
    return start + timedelta(days=count)


def identify(candidates, values):
    # Ne jamais retomber sur un nom si une référence explicite est inconnue.
    for key in ('reference', 'code', 'phone', 'name'):
        value = str(values.get(key) or '').strip()
        if not value:
            continue
        def keys(c):
            data = c.data or {}
            if key == 'reference':
                return [str(c.id), f'CAND-{c.id}', data.get('referenceDossier'), data.get('numeroDossier'), data.get('reference')]
            if key == 'code':
                return [data.get('codeCandidat'), data.get('candidateCode'), data.get('code')]
            if key == 'phone':
                return [c.phone, data.get('telephone')]
            return [f'{c.last_name} {c.first_name}', f'{c.first_name} {c.last_name}']
        norm = (lambda x: re.sub(r'\D', '', str(x or ''))) if key == 'phone' else excel.norm_key
        matches = [c for c in candidates if any(norm(k) == norm(value) for k in keys(c) if k)]
        return matches
    return []


def analyze(db, user, session, config):
    workbook = session.workbook
    if not workbook:
        raise HTTPException(409, 'Classeur indisponible')
    index = config['sheet']
    if not 0 <= index < len(workbook['sheets']):
        raise HTTPException(422, 'Feuille invalide')
    layout = excel.sheet_layout(workbook['sheets'][index])
    if not layout['importable']:
        raise HTTPException(422, layout['reason'])
    mapping = config['mapping']
    valid_indexes = {str(c['index']) for c in layout['columns']}
    if any(k not in valid_indexes or (v and v not in FIELDS) for k, v in mapping.items()):
        raise HTTPException(422, 'Correspondance invalide')
    fields = [v for v in mapping.values() if v]
    if len(fields) != len(set(fields)):
        raise HTTPException(422, 'Un champ ne peut correspondre à plusieurs colonnes')
    if 'start_date' not in fields or not set(fields) & {'reference', 'code', 'phone', 'name'}:
        raise HTTPException(422, 'Identifiant candidat et date début obligatoires')
    if config['mode'] not in {'dates', 'full'} or config['precedence'] not in {'excel', 'common'}:
        raise HTTPException(422, 'Mode ou priorité invalide')
    society = workbook['society']
    candidates = [c for c in db.scalars(select(Candidate)).all() if society_key(c.society) == society_key(society)]
    options = dc_client_sites.list_client_site_options(db, society)
    linked = {str(value) for value in db.scalars(select(Employee.extra['sourceCandidateId'].as_string())).all() if value is not None}
    exceptional = oneoff.grant_for(db, session)
    rows = []
    for number, cells in layout['data_rows']:
        raw = {key: cells[int(col)] if int(col) < len(cells) else '' for col, key in mapping.items() if key}
        values = {k: excel.cell_display(v) for k, v in raw.items()}
        if config['mode'] == 'dates':
            raw = {k: v for k, v in raw.items() if k in {'reference', 'code', 'phone', 'name', 'start_date', 'end_date'}}
            values = {k: v for k, v in values.items() if k in raw}
        common = {k: v for k, v in config['common'].items() if k in FIELDS and k not in {'reference','code','phone','name','start_date','end_date'} and v is not None and str(v).strip()}
        merged = {**common, **{k: v for k, v in values.items() if v}} if config['precedence'] == 'excel' else {**values, **common}
        row = {'row': number, 'status': 'PRÊT', 'reason': '', 'candidate_id': None, 'candidate': '', 'values': merged}
        if exceptional:
            row.update(oneoff.match_row(cells, candidates, layout['columns']))
            matches = [c for c in candidates if c.id == row['candidate_id']]
            if not matches:
                rows.append(row)
                continue
        else:
            matches = identify(candidates, values)
        if len(matches) != 1:
            row.update(status='À VÉRIFIER' if matches else 'CANDIDAT INTROUVABLE', reason='Plusieurs candidats correspondent' if matches else 'Aucun candidat dans la société active')
        else:
            c = matches[0]
            row.update(candidate_id=c.id, candidate=f'{c.last_name} {c.first_name}')
            if str(c.id) in linked or c.status == 'embauche' or (c.data or {}).get('convertedEmployeeId'):
                row.update(status='DÉJÀ CONTRACTUALISÉ', reason='Un employé est déjà lié au dossier')
            elif c.status != 'a_contractualiser' or not service._candidate_decision_is_favorable(c.data or {}):
                row.update(status='À CORRIGER', reason='Dossier non transmis ou décision non favorable')
        try:
            if not values.get('start_date'):
                raise ValueError('Date début manquante')
            parsed_start, warning = excel._parse_date(raw['start_date'], birth_date=False)
            row['warnings'] = [warning] if warning else []
            start = date.fromisoformat(parsed_start)
            merged['start_date'] = start.isoformat()
            if not merged.get('position') or not merged.get('contract_type') or not merged.get('template_id') or not merged.get('client_site'):
                if row['status'] == 'PRÊT':
                    row.update(status='DONNÉE MANQUANTE', reason='Poste, type, modèle et client/site obligatoires')
                raise ValueError(row['reason'] or 'Données contractuelles manquantes')
            typ = str(merged['contract_type']).upper()
            if typ not in {'CDD', 'CDI', 'CIDD', 'CTA', 'APPRENTISSAGE'}:
                raise ValueError('Type de contrat invalide')
            merged['contract_type'] = typ
            end = date.fromisoformat(excel._parse_date(raw['end_date'], birth_date=False)[0]) if values.get('end_date') else (duration_end(start, merged.get('duration', '')) if typ != 'CDI' else None)
            if end and end < start:
                raise ValueError('Date fin antérieure à la date début')
            merged['end_date'] = end.isoformat() if end else None
            merged['salary'] = float(str(merged.get('salary') or '0').replace(',', '.').replace(' ', ''))
            if not 0 <= merged['salary'] < 1e12:
                raise ValueError('Salaire invalide')
            trial = str(merged.get('trial') or {'CDI':'90d','CDD':'30d','CIDD':'45d'}.get(typ,'30d'))
            merged['trial_end_date'] = (start if trial in {'0','0d'} else duration_end(start, trial if not trial.isdigit() else trial+'d')).isoformat()
            selection = [o for o in options if excel.norm_key(o['label']) == excel.norm_key(merged['client_site']) or str(merged['client_site']) == f"{o['dc_client_id']}:{o['dc_site_id'] or ''}"]
            if len(selection) != 1:
                raise ValueError('Client / site DC invalide ou ambigu')
            option = selection[0]
            merged['dc_link'] = dc_client_sites.resolve_contract_selection(db, dc_client_id=option['dc_client_id'], dc_site_id=option['dc_site_id'], society=society)
            merged['template_id'] = int(merged['template_id'])
            template = service.find_contract_template(db, SimpleNamespace(template_id=merged['template_id']), None)
            if str(template.contract_type).upper() != typ:
                raise ValueError('Le modèle ne correspond pas au type de contrat')
            if values.get('iban') and isinstance(raw.get('iban'), dict) and 'n' in raw['iban']:
                raise ValueError('RIB / IBAN numérique : saisir la cellule Excel au format texte pour conserver les zéros')
        except (ValueError, TypeError, HTTPException, excel._FieldError) as exc:
            if row['status'] == 'PRÊT':
                row.update(status='À CORRIGER', reason=str(exc.detail if isinstance(exc, HTTPException) else exc))
        rows.append(row)
    duplicate_ids = {key for key, count in Counter(r['candidate_id'] for r in rows if r['candidate_id']).items() if count > 1}
    for row in rows:
        if row['candidate_id'] in duplicate_ids:
            row.update(status='DOUBLON', reason='Plusieurs lignes pour ce candidat : aucune ne sera créée')
    return {'rows': rows, 'counts': dict(Counter(r['status'] for r in rows)), 'total': len(rows)}


def preview(db, user, session, config):
    config = oneoff.preview_config(db, session, config)
    result = analyze(db, user, session, config)
    result = oneoff.prepare_preview(db, user, session, config, result)
    session.plan = {'config': config, 'preview': result}
    session.status = 'previewed'
    db.commit()
    return result


def confirm(db, user, session_id, request):
    session = get_session(db, user, session_id, ('previewed', 'completed', 'prepared'))
    oneoff.deny_creation(db, session)
    if session.status == 'completed':
        return session.result
    # CAS empêche deux confirmations simultanées, avant la première écriture métier.
    claimed = db.execute(update(CandidateImportSession).where(CandidateImportSession.id == session.id, CandidateImportSession.status == 'previewed').values(status='processing'))
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, 'Import déjà en cours')
    config = session.plan['config']
    approved = {r['row']: r for r in session.plan['preview']['rows'] if r['status'] == 'PRÊT'}
    db.commit()
    try:
        fresh = analyze(db, user, session, config)
    except Exception:
        session.status = 'previewed'
        db.commit()
        raise
    results = []
    pending = [{k: row.get(k) for k in ('row', 'candidate_id', 'candidate')} | {'status': 'NON CRÉÉ', 'reason': 'Traitement en attente ou interrompu'} for row in fresh['rows']]
    def snapshot(done):
        by_row = {row['row']: row for row in done}
        current = [by_row.get(row['row'], row) for row in pending]
        return {'rows': current, 'counts': dict(Counter(row['status'] for row in current)), 'total': len(current)}
    session.result = snapshot(results)
    db.commit()
    society = session.workbook['society']
    for row in fresh['rows']:
        result = {k: row.get(k) for k in ('row', 'candidate_id', 'candidate', 'status', 'reason')}
        if row['status'] == 'PRÊT' and row['row'] not in approved:
            result.update(status='NON CRÉÉ', reason='Cette ligne n’était pas prête lors de la vérification')
        elif row['status'] == 'PRÊT' and (row['values'] != approved[row['row']]['values'] or row['candidate_id'] != approved[row['row']]['candidate_id']):
            result.update(status='NON CRÉÉ', reason='Les valeurs ont changé depuis la vérification')
        elif row['status'] == 'PRÊT':
            try:
                v = row['values']
                # Cette écriture conditionnelle réserve le candidat jusqu’au commit de la
                # ligne, y compris sur SQLite où FOR UPDATE est ignoré. Une confirmation
                # concurrente ne peut plus recruter le dossier une seconde fois.
                claimed_candidate = db.execute(update(Candidate).where(
                    Candidate.id == row['candidate_id'], Candidate.status == 'a_contractualiser',
                ).values(status='a_contractualiser').execution_options(synchronize_session=False))
                if claimed_candidate.rowcount != 1:
                    raise HTTPException(409, 'Le candidat n’est plus disponible pour la contractualisation')
                locked = service._locked_candidate(db, row['candidate_id'])
                db.refresh(locked)
                if society_key(locked.society) != society_key(society):
                    raise HTTPException(409, 'La société du candidat a changé : relancez la vérification')
                v['dc_link'] = dc_client_sites.resolve_contract_selection(db, dc_client_id=v['dc_link']['dc_client_id'], dc_site_id=v['dc_link']['dc_site_id'], society=society)
                employee = service.recruit_candidate(db, row['candidate_id'], user.username,
                    allow_idempotent=False, commit=False, create_initial_contract=False,
                    employee_values={'society': society, 'position': v['position'], 'recruit_date': date.fromisoformat(v['start_date']),
                        'contract_type': v['contract_type'], 'contract_end_date': v['end_date'],
                        'trial_end_date': date.fromisoformat(v['trial_end_date']), 'salary_net': v['salary']})
                employee.extra = {**(employee.extra or {}), 'modePaiement': v.get('payment'), 'banque': v.get('bank'), 'rib': v.get('iban'), 'dureeContrat': v.get('duration')}
                generated = service.generate_contract(db, SimpleNamespace(employee_id=employee.id, template_id=v['template_id'],
                    contract_type=v['contract_type'], position=v['position'], function=v['position'],
                    start_date=employee.recruit_date, end_date=employee.contract_end_date, salary_net=v['salary'],
                    values={'DUREE_CONTRAT': v.get('duration', ''), 'CLIENT': v['client_site'], 'MODE_PAIEMENT': v.get('payment',''), 'BANQUE': v.get('bank',''), 'RIB': v.get('iban','')},
                    output_format='docx', dc_link=v['dc_link']), user, commit=False)
                locked.data = {**(locked.data or {}), 'convertedContractId': generated.contract_id, 'contractReference': generated.reference, 'contractImportSession': session_id}
                append_audit(db, action='drh.contract.excel.created', resource='contract', resource_id=generated.contract_id,
                    user=user, request=request, society=society, result='success', new_state={'candidate_id': row['candidate_id'], 'session_id': session_id, 'row': row['row'], 'reference': generated.reference})
                result.update(status='CRÉÉ', reason='', contract_id=generated.contract_id, reference=generated.reference)
                session.result = snapshot(results + [result])
                db.commit()
            except Exception as exc:
                db.rollback()
                logger.exception('Contract import row %s failed', row['row'])
                result.update(status='ÉCHEC', reason=str(exc.detail) if isinstance(exc, HTTPException) else 'Création échouée ; aucune modification conservée pour cette ligne')
        results.append(result)
        session.result = snapshot(results)
        db.commit()
    session.status, session.workbook, session.plan = 'completed', None, None
    session.completed_at = datetime.utcnow()
    db.commit()
    return session.result


def build_template(mode):
    book = Workbook()
    sheet = book.active
    sheet.title = 'Contractualisation'
    keys = ['reference','start_date'] if mode == 'dates' else list(FIELDS)
    sheet.append([FIELDS[k] for k in keys])
    sheet.freeze_panes = 'A2'
    for col in sheet.columns:
        sheet.column_dimensions[col[0].column_letter].width = 25
    out = BytesIO()
    book.save(out)
    return out.getvalue()
