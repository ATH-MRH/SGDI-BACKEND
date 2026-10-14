"""Dérogation de préparation pour la liste figée des 76 dossiers du 11/10/2026.

Pas de paramètre de bypass exposé au client. Le premier aperçu de cette liste exacte
lie définitivement la dérogation à sa session et à l'empreinte du classeur.
Les champs fournis restent validés ; aucun service de création n'est appelé ici.
"""
from collections import Counter
from datetime import date, datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import DateTime, Integer, JSON, String, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from app.core.audit import append_audit
from app.core.scope_policy import society_key
from app.db.base import Base
from app.modules.drh import candidate_import as excel, dc_client_sites, service
from app.modules.drh.models import Candidate

BATCH_KEY = 'regularisation-exceptionnelle-igs-20261011-76'
SOCIETY = 'IRON GLOBAL SOLUTION'
# Références lues dans les actions DOM de la liste Contrats DRH, le 14/10/2026.
# Liste littérale : aucun critère dynamique « tous les candidats » / compteur / intervalle.
CANDIDATE_IDS = frozenset((
    2309, 2310, 2311, 2312, 2313, 2314, 2315, 2316, 2317, 2318,
    2319, 2320, 2321, 2322, 2323, 2324, 2325, 2326, 2327, 2328,
    2329, 2330, 2331, 2332, 2333, 2334, 2335, 2336, 2337, 2338,
    2339, 2340, 2341, 2342, 2343, 2344, 2345, 2346, 2347, 2348,
    2349, 2350, 2351, 2352, 2353, 2354, 2355, 2356, 2357, 2358,
    2359, 2360, 2361, 2362, 2363, 2364, 2365, 2366, 2367, 2368,
    2369, 2370, 2371, 2372, 2373, 2374, 2375, 2376, 2377, 2378,
    2379, 2380, 2381, 2382, 2383, 2384,
))
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


def grant_for(db, session):
    grant = db.get(ContractImportOneoffGrant, BATCH_KEY)
    if grant and grant.session_id == session.public_id:
        if grant.file_sha256 != session.file_sha256:
            raise HTTPException(409, 'Le classeur ne correspond plus à la dérogation autorisée')
        return grant
    return None


def is_exact_batch(session, normal):
    return (session.workbook and society_key(session.workbook['society']) == society_key(SOCIETY)
            and normal['total'] == len(CANDIDATE_IDS)
            and {row['candidate_id'] for row in normal['rows']} == CANDIDATE_IDS)


def deny_creation(db, session):
    ids = {row.get('candidate_id') for row in ((session.plan or {}).get('preview') or {}).get('rows', [])}
    if grant_for(db, session) or ((session.result or {}).get('preparation_only')) or ids & CANDIDATE_IDS:
        raise HTTPException(409, 'Création désactivée pour ce lot exceptionnel : préparation uniquement')


def prepare_preview(db, user, session, config, normal):
    """Chemin séparé uniquement pour la liste explicite ; l'analyse normale reste intacte."""
    bound = db.get(ContractImportOneoffGrant, BATCH_KEY)
    if bound and bound.session_id != session.public_id:
        return normal  # aucun nouvel import ne reçoit la dérogation
    if not is_exact_batch(session, normal):
        if bound:
            raise HTTPException(409, 'La correspondance ne contient plus les 76 candidats autorisés')
        return normal
    if bound and bound.file_sha256 != session.file_sha256:
        raise HTTPException(409, 'Empreinte du classeur différente du lot autorisé')

    from app.modules.drh.contract_import import FIELDS, duration_end
    layout = excel.sheet_layout(session.workbook['sheets'][config['sheet']])
    original = {row['row']: row for row in normal['rows']}
    options = dc_client_sites.list_client_site_options(db, session.workbook['society'])
    candidates = {c.id: c for c in db.scalars(select(Candidate).where(Candidate.id.in_(CANDIDATE_IDS))).all()}
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
        candidate = candidates[row['candidate_id']]
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
            row.update(status=original[number]['status'] if original[number]['status'] in {'DOUBLON','DÉJÀ CONTRACTUALISÉ'} else 'À CORRIGER', reason=str(exc.detail if isinstance(exc, HTTPException) else exc))
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
              'blocked': len(rows)-len(prepared), 'preparation_only': True, 'oneoff_batch': BATCH_KEY, 'message': MESSAGE}
    try:
        if not bound:
            bound = ContractImportOneoffGrant(batch_key=BATCH_KEY, session_id=session.public_id,
                file_sha256=session.file_sha256, authorized_by_user_id=user.id, authorized_by_username=user.username,
                authorized_at=datetime.now(timezone.utc).replace(tzinfo=None), candidate_ids=sorted(CANDIDATE_IDS), reason=REASON, preparation=result)
            db.add(bound)
            db.flush()  # PK unique : une seule session gagne même si deux aperçus sont simultanés
            append_audit(db, action='drh.contract.excel.oneoff.authorized', resource='contract_import_oneoff',
                resource_id=BATCH_KEY, user=user, society=SOCIETY, result='success', new_state={
                    'session_id': session.public_id, 'authorized_by_user_id': user.id, 'authorized_at': bound.authorized_at.isoformat(),
                    'candidate_ids': sorted(CANDIDATE_IDS), 'reason': REASON})
        else:
            bound.preparation = result
        # Une entrée par candidat évite la troncature du journal d'audit à 4 000 caractères.
        for row in rows:
            append_audit(db, action='drh.contract.excel.oneoff.prepared', resource='candidate', resource_id=row['candidate_id'],
                user=user, society=SOCIETY, result='success' if row['status'] == STATUS else 'refused', new_state={
                    'session_id': session.public_id, 'batch_key': BATCH_KEY, 'candidate_id': row['candidate_id'],
                    'missing_fields': row['missing_fields'], 'status': row['status'], 'reason': REASON,
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
    if preview.get('blocked'):
        raise HTTPException(422, 'Corrigez les valeurs invalides ; seules les cellules vides sont autorisées')
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
