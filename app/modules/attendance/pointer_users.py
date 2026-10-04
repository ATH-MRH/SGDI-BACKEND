"""Scoped Pointage interface for central ATLAS pointer users; no parallel user store."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.audit import append_audit
from app.core.granular_permissions import is_global_administrator, load_feature_permissions, replace_explicit_permissions, replace_feature_permissions
from app.core.scope_policy import society_key, society_scope
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User, AuditEvent
from app.modules.auth.schemas import UserCreate, UserUpdate, ModulePermissionIn, FeaturePermissionIn
from app.modules.auth.service import create_user, update_user
from app.modules.ops.models import Site
from app.modules.ops.routes import _site_society

router = APIRouter(prefix='/pointers')


def grants(db, user):
    actions = {'read','create','update'}
    if is_global_administrator(user):
        granted = actions
    else:
        rows = load_feature_permissions(db,user.id)
        explicit = {r.action_key for r in rows if r.module_key=='administration' and r.feature_key=='users'}
        granted = actions if 'admin' in explicit else actions & explicit
    configured = set(user.authorized_actions or [])
    return granted & configured if configured and 'admin' not in configured else granted


def require(db,user,action):
    if action not in grants(db,user):
        raise HTTPException(403,'Permission Utilisateurs explicite requise')


def allowed_sites(db,user):
    scope = society_scope(user)
    explicit = set(user.authorized_sites or [])
    return [s for s in db.scalars(select(Site).order_by(Site.name))
            if scope.allows(_site_society(s)) and (not explicit or s.id in explicit)]


def scope_fits(target, sites):
    allowed = {s.id for s in sites}
    societies = {society_key(_site_society(s)) for s in sites}
    ids,keys = set(target.authorized_sites or []), {society_key(v) for v in target.authorized_societies or []}
    return bool(ids and keys) and not target.global_society_access and ids <= allowed and keys <= societies


def target_in_scope(db,user,user_id,lock=False):
    stmt = select(User).where(User.id==user_id)
    if lock: stmt=stmt.with_for_update().execution_options(populate_existing=True)
    target=db.scalar(stmt)
    if not target or str(target.role).lower()!='pointeur' or not scope_fits(target,allowed_sites(db,user)):
        raise HTTPException(404,'Pointeur introuvable')
    return target


def validate_scope(db,user,societies,site_ids):
    keys={society_key(v) for v in societies if society_key(v)}
    ids=set(site_ids)
    available=allowed_sites(db,user)
    by_id={s.id:s for s in available}
    labels={society_key(_site_society(s)):_site_society(s) for s in available if _site_society(s)}
    if not keys or not ids: raise HTTPException(422,'Sélectionnez au moins une société et un site')
    if not keys <= labels.keys() or not ids <= by_id.keys(): raise HTTPException(403,'Périmètre supérieur à celui du responsable Pointage')
    if any(society_key(_site_society(by_id[i])) not in keys for i in ids): raise HTTPException(422,'Chaque site doit appartenir à une société sélectionnée')
    return [labels[k] for k in sorted(keys)],sorted(ids)


def snapshot(target):
    return {'username':target.username,'full_name':target.full_name,'is_active':target.is_active,
            'societies':target.authorized_societies,'site_ids':target.authorized_sites,
            'role':target.role,'profile':target.access_level,'modules':target.authorized_modules,'actions':target.authorized_actions}


def output(db,target,sites):
    last=db.scalar(select(func.max(AuditEvent.created_at)).where(AuditEvent.user_id==target.id,AuditEvent.action=='auth.login',AuditEvent.result=='success'))
    return {'id':target.id,'username':target.username,'full_name':target.full_name,'email':target.email,
            'societies':target.authorized_societies,'site_ids':target.authorized_sites,
            'sites':[{'id':s.id,'name':s.name,'society':_site_society(s)} for s in sites if s.id in set(target.authorized_sites or [])],
            'is_active':target.is_active,'last_login':last.isoformat()+'Z' if last else None}


class PointerCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    full_name:str=Field(min_length=1,max_length=150)
    username:str=Field(min_length=3,max_length=80)
    email:EmailStr|None=None
    password:str=Field(min_length=8,max_length=256)
    societies:list[str]=Field(min_length=1)
    site_ids:list[int]=Field(min_length=1)
    is_active:bool=True

    @field_validator('full_name','username',mode='before')
    @classmethod
    def trim_identity(cls,value):
        return value.strip() if isinstance(value,str) else value


class PointerPatch(BaseModel):
    model_config=ConfigDict(extra='forbid')
    full_name:str|None=Field(None,min_length=1,max_length=150)
    societies:list[str]|None=Field(None,min_length=1)
    site_ids:list[int]|None=Field(None,min_length=1)
    is_active:bool|None=None

    @field_validator('full_name',mode='before')
    @classmethod
    def trim_name(cls,value):
        return value.strip() if isinstance(value,str) else value


@router.get('/capabilities')
def capabilities(db:Session=Depends(get_db),user:User=Depends(current_user)):
    actions=grants(db,user)
    sites=allowed_sites(db,user) if actions else []
    return {'actions':sorted(actions),'sites':[{'id':s.id,'name':s.name,'society':_site_society(s)} for s in sites],
            'societies':sorted({_site_society(s) for s in sites if _site_society(s)})}


@router.get('')
def list_pointers(db:Session=Depends(get_db),user:User=Depends(current_user)):
    require(db,user,'read'); sites=allowed_sites(db,user)
    users=[u for u in db.scalars(select(User).where(func.lower(User.role)=='pointeur').order_by(User.username)) if scope_fits(u,sites)]
    return {'items':[output(db,u,sites) for u in users],
            'kpi':{'total':len(users),'active':sum(u.is_active for u in users),'disabled':sum(not u.is_active for u in users),
                   'sites':len({i for u in users for i in u.authorized_sites})}}


@router.post('')
def add_pointer(payload:PointerCreate,request:Request,db:Session=Depends(get_db),user:User=Depends(current_user)):
    require(db,user,'create')
    societies,ids=validate_scope(db,user,payload.societies,payload.site_ids)
    try:
        target=create_user(db,UserCreate(username=payload.username,email=payload.email,full_name=payload.full_name.strip(),password=payload.password,
                           role='pointeur',access_level='H2',authorized_modules=['pointeur'],authorized_actions=['read','create'],
                           authorized_structures=['pointage'],authorized_societies=societies,authorized_sites=ids),commit=False)
        target.is_active=payload.is_active
        replace_explicit_permissions(db,user_id=target.id,permissions=[ModulePermissionIn(module_key='attendance',action_key=a) for a in ('read','create')],created_by_user_id=user.id)
        replace_feature_permissions(db,user_id=target.id,permissions=[FeaturePermissionIn(module_key='attendance',feature_key=feature,action_key=action) for feature in ('qr_scanning','manual_entry') for action in ('read','create')],created_by_user_id=user.id)
        append_audit(db,action='pointer_user.created',resource='user',resource_id=target.id,result='success',user=user,request=request,new_state=snapshot(target))
        db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409,'Identifiant ou email déjà utilisé') from None
    return output(db,target,allowed_sites(db,user))


@router.patch('/{user_id}')
def patch_pointer(user_id:int,payload:PointerPatch,request:Request,db:Session=Depends(get_db),user:User=Depends(current_user)):
    require(db,user,'update'); target=target_in_scope(db,user,user_id,lock=True)
    old=snapshot(target)
    societies,ids=validate_scope(db,user,payload.societies if payload.societies is not None else target.authorized_societies,
                               payload.site_ids if payload.site_ids is not None else target.authorized_sites)
    target=update_user(db,target,UserUpdate(full_name=payload.full_name.strip() if payload.full_name is not None else None,
                       is_active=payload.is_active,authorized_societies=societies,authorized_sites=ids),commit=False)
    new=snapshot(target)
    action='pointer_user.disabled' if old['is_active'] and not target.is_active else 'pointer_user.updated'
    append_audit(db,action=action,resource='user',resource_id=target.id,result='success',user=user,request=request,old_state=old,new_state=new)
    if old['societies']!=societies or old['site_ids']!=ids:
        append_audit(db,action='pointer_user.scope_changed',resource='user',resource_id=target.id,result='success',user=user,request=request,old_state=old,new_state=new)
    db.commit(); return output(db,target,allowed_sites(db,user))
