"""OPS authoring; shared read service stays independent of HTTP and UI."""
from datetime import date,datetime
from fastapi import APIRouter,Depends,HTTPException,Query,Request
from pydantic import BaseModel,Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.modules.auth.dependencies import current_user,user_holds_action
from app.modules.auth.models import User
from app.modules.ops.models import Site
from app.modules.ops.routes import _allowed_assignment_site_ids,_site_society,_ensure_society_allowed
from app.modules.rotations import engine,service
from app.modules.rotations.models import RotationDraft,OfficialRotation
from app.core.audit import append_audit

router=APIRouter()


def scope(db,user,site_id,action='read'):
    if not user_holds_action(user,action):raise HTTPException(403,'Action OPS non autorisée')
    site=db.get(Site,site_id)
    allowed=_allowed_assignment_site_ids(db,user)
    if not site or (allowed is not None and site_id not in allowed):raise HTTPException(404,'Site hors périmètre')
    _ensure_society_allowed(user,_site_society(site))
    return site


class DraftIn(BaseModel):
    effective_from:date
    reason:str=Field(min_length=3,max_length=2000)
    config:dict


class SimulationIn(BaseModel):
    days:int=30


class PublishIn(BaseModel):
    context_hash:str=Field(min_length=64,max_length=64)


def draft_for(db,user,draft_id,action):
    row=db.get(RotationDraft,draft_id)
    if not row:raise HTTPException(404,'Brouillon introuvable')
    scope(db,user,row.site_id,action)
    return row


def locked_site(db,site_id):
    if db.get_bind().dialect.name=='sqlite':
        conn=db.connection()
        if not conn.connection.driver_connection.in_transaction:conn.exec_driver_sql('BEGIN IMMEDIATE')
    db.execute(select(Site.id).where(Site.id==site_id).with_for_update()).scalar_one()


@router.get('/regimes')
def regimes(user:User=Depends(current_user)):
    return {'items':[{'code':r,'supported':r not in ('NORMAL','CUSTOM')} for r in engine.REGIMES],
            'engine_version':engine.ENGINE_VERSION,'weekday_convention':'Monday=0, Sunday=6'}


@router.post('/sites/{site_id}/drafts')
def create_draft(site_id:int,payload:DraftIn,request:Request,db:Session=Depends(get_db),user:User=Depends(current_user)):
    site=scope(db,user,site_id,'create')
    try:config=engine.validate(payload.config)
    except (ValueError,KeyError,TypeError) as e:raise HTTPException(422,str(e)) from e
    if not payload.reason.strip():raise HTTPException(422,'Motif obligatoire')
    row=RotationDraft(site_id=site_id,config=config,effective_from=payload.effective_from,
        reason=payload.reason.strip(),created_by=user.username)
    db.add(row);db.flush()
    append_audit(db,action='ops.rotations.draft',resource='rotation_draft',resource_id=row.id,result='success',
        user=user,request=request,society=_site_society(site),new_state=payload.model_dump(mode='json'))
    db.commit()
    return {'id':row.id,'version':row.version,'status':'DRAFT'}


@router.post('/drafts/{draft_id}/simulate')
def simulate_draft(draft_id:int,payload:SimulationIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    row=draft_for(db,user,draft_id,'read');locked_site(db,row.site_id)
    result=service.simulate(db,row,payload.days)
    row.simulation=result;db.commit()
    return result


@router.post('/drafts/{draft_id}/publish')
def publish_draft(draft_id:int,payload:PublishIn,request:Request,db:Session=Depends(get_db),user:User=Depends(current_user)):
    row=draft_for(db,user,draft_id,'validate');locked_site(db,row.site_id)
    result=service.publish(db,row,user,payload.context_hash,request)
    db.commit()
    return {'id':result.id,'version':result.version,'effective_from':result.effective_from,'status':'PUBLISHED'}


@router.get('/sites/{site_id}/history')
def history(site_id:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
    scope(db,user,site_id)
    return {'items':[{'id':p.id,'version':p.version,'effective_from':p.effective_from,'effective_to':p.effective_to,
        'config':p.config,'reason':p.reason,'published_by':p.published_by,'published_at':p.published_at}
        for p in db.scalars(select(OfficialRotation).where(OfficialRotation.site_id==site_id).order_by(OfficialRotation.version))]}


@router.get('/sites/{site_id}/planning')
def planning(site_id:int,start:date,days:int=30,db:Session=Depends(get_db),user:User=Depends(current_user)):
    scope(db,user,site_id)
    if not 1<=days<=90:raise HTTPException(422,'Horizon de 1 à 90 jours requis')
    from datetime import timedelta
    slots=[];missing=[]
    for n in range(days):
        day=start+timedelta(days=n);cfg=service.configuration_at(db,site_id,day)
        if cfg is None:missing.append(str(day));continue
        slots += [{**s,'configuration_id':cfg.id,'configuration_version':cfg.version} for s in engine.occurrences(cfg.config,day,1)['slots']]
    return {'site_id':site_id,'slots':slots,'unconfigured_dates':missing,'engine_version':engine.ENGINE_VERSION}


class GroupChangeIn(BaseModel):
    effective_from:date
    group:str=Field(pattern='^[ABCD]$')
    reason:str=Field(min_length=3,max_length=2000)


@router.post('/assignments/{assignment_id}/change-group')
def change_group(assignment_id:int,payload:GroupChangeIn,request:Request,db:Session=Depends(get_db),user:User=Depends(current_user)):
    from app.modules.ops.models import Assignment
    from datetime import timedelta
    from types import SimpleNamespace
    from zoneinfo import ZoneInfo
    old=db.get(Assignment,assignment_id)
    if old is None:raise HTTPException(404,'Affectation introuvable')
    site=scope(db,user,old.site_id,'validate');locked_site(db,old.site_id)
    from app.modules.drh.models import Employee
    db.execute(select(Employee.id).where(Employee.id==old.employee_id).with_for_update()).scalar_one()
    db.refresh(old)
    cfg=service.configuration_at(db,old.site_id,payload.effective_from)
    if cfg is None:raise HTTPException(409,'Configuration officielle requise à la date d’effet')
    today=datetime.now(ZoneInfo(cfg.config['timezone'])).date()
    if payload.effective_from<=today or payload.effective_from<=old.start_date:
        raise HTTPException(409,'Changement futur uniquement')
    if old.end_date is not None and old.end_date<payload.effective_from:
        raise HTTPException(409,'Affectation déjà close à cette date')
    if not payload.reason.strip():raise HTTPException(422,'Motif obligatoire')
    old_end=old.end_date
    old.end_date=payload.effective_from-timedelta(days=1)
    new=Assignment(employee_id=old.employee_id,site_id=old.site_id,group_code=payload.group,
        rotation_id=old.rotation_id,work_regime=old.work_regime,position=old.position,
        start_date=payload.effective_from,end_date=old_end,active=1,change_reason=payload.reason.strip())
    db.add(new);db.flush()
    preview=service.simulate(db,SimpleNamespace(id=0,version=cfg.version,site_id=old.site_id,
        effective_from=payload.effective_from,config=cfg.config),30)
    if not preview['valid']:
        db.rollback();raise HTTPException(409,{'message':'Changement incompatible avec le planning officiel','errors':preview['errors']})
    append_audit(db,action='ops.rotations.change_group',resource='assignment',resource_id=new.id,user=user,request=request,
        result='success',society=_site_society(site),old_state={'id':old.id,'group':old.group_code,'end':str(old_end)},
        new_state={'id':new.id,'group':new.group_code,'effective_from':str(new.start_date),'reason':new.change_reason})
    db.commit()
    return {'id':new.id,'previous_id':old.id,'effective_from':new.start_date,'group':new.group_code}


@router.get('/sites/{site_id}/drafts')
def list_drafts(site_id:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
    scope(db,user,site_id)
    published=select(OfficialRotation.draft_id)
    return {'items':[{'id':d.id,'version':d.version,'config':d.config,'effective_from':d.effective_from,
        'reason':d.reason,'created_by':d.created_by,'created_at':d.created_at}
        for d in db.scalars(select(RotationDraft).where(RotationDraft.site_id==site_id,~RotationDraft.id.in_(published)).order_by(RotationDraft.id.desc()).limit(100))]}


# ── Lecture des écrans OPS (configuration et planning) ─────────────────────────────────────
from app.modules.rotations import views


@router.get('/sites')
def site_list(db:Session=Depends(get_db),user:User=Depends(current_user)):
    if not user_holds_action(user,'read'):raise HTTPException(403,'Action OPS non autorisée')
    return {'items':views.site_options(db,user)}


@router.get('/overview')
def overview(db:Session=Depends(get_db),user:User=Depends(current_user)):
    if not user_holds_action(user,'read'):raise HTTPException(403,'Action OPS non autorisée')
    return views.overview(db,user,[s['id'] for s in views.site_options(db,user)])


class PreviewIn(BaseModel):
    site_id:int|None=None
    month:str=Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    config:dict


@router.post('/preview')
def preview(payload:PreviewIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    """Aperçu d'un brouillon non enregistré : aucune écriture."""
    if payload.site_id is not None:scope(db,user,payload.site_id)
    elif not user_holds_action(user,'read'):raise HTTPException(403,'Action OPS non autorisée')
    try:return views.preview(db,payload.site_id,payload.config,payload.month)
    except (ValueError,KeyError,TypeError) as e:raise HTTPException(422,str(e)) from e


@router.get('/sites/{site_id}/month')
def month(site_id:int,month:str=Query(pattern=r'^\d{4}-(0[1-9]|1[0-2])$'),db:Session=Depends(get_db),user:User=Depends(current_user)):
    site=scope(db,user,site_id)
    return {**views.month_view(db,site_id,month),'site':{'id':site.id,'name':site.name}}
