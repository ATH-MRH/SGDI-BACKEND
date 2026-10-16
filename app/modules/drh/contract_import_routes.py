"""API DRH de contractualisation Excel, sessions privées et société active obligatoire."""
import csv
from io import StringIO
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.auth.routes import is_admin_role
from app.modules.drh import candidate_import as excel, contract_import as importer
from app.modules.drh.routes import _effective_society_filter, _ensure_recruitment_access

router = APIRouter(prefix='/contracts/import')


def require(user):
    _ensure_recruitment_access(user)
    from app.modules.auth.dependencies import _normalized_module_keys
    if not is_admin_role(user.role):
        if user.authorized_modules is not None:
            allowed = 'drh' in _normalized_module_keys(user.authorized_modules)
        else:
            allowed = str(user.role).lower() in {'rh','drh'}
        if not allowed or not excel.user_can(user, 'create'):
            raise HTTPException(403, 'Contractualisation réservée aux comptes DRH autorisés à créer')


class PreviewIn(BaseModel):
    sheet: int = Field(ge=0, le=excel.MAX_SHEETS)
    mapping: dict[str, str | None]
    mode: Literal['dates','full'] = 'dates'
    precedence: Literal['excel','common'] = 'common'
    common: dict[str, Any] = Field(default_factory=dict)


@router.get('/config')
def config(user: User = Depends(current_user)):
    require(user)
    return {'fields': [{'key': key, 'label': label} for key, label in importer.FIELDS.items()], 'limits': excel.limits()}


@router.get('/template')
def template(mode: Literal['dates','full'] = 'dates', user: User = Depends(current_user)):
    require(user)
    return Response(importer.build_template(mode), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': 'attachment; filename="modele-contractualisation.xlsx"', 'Cache-Control': 'no-store'})


@router.post('')
async def upload(request: Request, society: str, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user)
    effective = _effective_society_filter(user, society)
    if not effective:
        raise HTTPException(422, 'Sélectionnez une société active')
    content = await file.read(excel.MAX_FILE_BYTES + 1)
    return importer.upload(db, user, file.filename or '', content, effective)


@router.post('/{session_id}/preview')
def preview(session_id: str, payload: PreviewIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user)
    session = importer.get_session(db, user, session_id, ('uploaded','previewed'))
    _effective_society_filter(user, session.workbook['society'])
    return importer.preview(db, user, session, payload.model_dump())


@router.post('/{session_id}/confirm')
def confirm(session_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user)
    session = importer.get_session(db, user, session_id)
    if session.workbook:
        _effective_society_filter(user, session.workbook['society'])
    return importer.confirm(db, user, session_id, request)


@router.post('/{session_id}/prepare')
def prepare(session_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user)
    session = importer.get_session(db, user, session_id, ('previewed','prepared'))
    if session.status == 'prepared':
        return session.result
    _effective_society_filter(user, session.workbook['society'])
    # Relire les valeurs et le statut des candidats avant l'enregistrement du snapshot.
    importer.preview(db, user, session, session.plan['config'])
    return importer.oneoff.save_preparation(db, user, session, request)


@router.get('/{session_id}/result')
def result(session_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user)
    session = importer.get_session(db, user, session_id, ('processing','completed','failed','prepared'))
    return {'status': session.status, **(session.result or {'rows': [], 'counts': {}})}


@router.post('/{session_id}/cancel')
def cancel(session_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user)
    session = importer.get_session(db, user, session_id, ('uploaded','previewed'))
    excel.cancel(db, session)
    return {'status': 'cancelled'}


@router.get('/{session_id}/report')
def report(session_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user)
    session = importer.get_session(db, user, session_id, ('previewed','processing','completed','failed','prepared'))
    rows = (session.result or (session.plan or {}).get('preview') or {}).get('rows', [])
    out = StringIO()
    writer = csv.writer(out, delimiter=';')
    preparation_only = bool((session.result or (session.plan or {}).get('preview') or {}).get('preparation_only'))
    writer.writerow(['Ligne','Candidat','Statut','Motif','Correspondance','Champs manquants'] + [importer.FIELDS[k] for k in importer.oneoff.VALUE_FIELDS] if preparation_only else ['Ligne','Candidat','Statut','Motif','Contrat','Numéro'])
    for row in rows:
        values = [str(row.get(key) or '') for key in ('row','candidate','status','reason','contract_id','reference')]
        if preparation_only:
            values = [str(row.get(k) or '') for k in ('row','candidate','status','reason')] + [row.get('match_status',''), ', '.join(row.get('missing_fields', []))]
            values += ['Non renseigné' if row['values'].get(k) is None else str(row['values'][k]) for k in importer.oneoff.VALUE_FIELDS]
        writer.writerow(["'" + v if v.lstrip().startswith(('=','+','-','@')) else v for v in values])
    return Response('\ufeff' + out.getvalue(), media_type='text/csv; charset=utf-8', headers={
        'Content-Disposition': 'attachment; filename="rapport-contractualisation.csv"', 'Cache-Control': 'no-store'})
