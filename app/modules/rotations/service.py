"""One official resolver and transactional OPS publication boundary."""
import hashlib
import json
from datetime import date,datetime,timedelta
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from sqlalchemy import select,inspect
from app.core.audit import append_audit
from app.modules.ops.models import Assignment,Site
from app.modules.rotations.engine import occurrences,validate,ENGINE_VERSION,compatible
from app.modules.rotations.models import OfficialRotation,RotationDraft


def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()


def configuration_at(db,site_id,day):
    cache=db.info.setdefault('central_rotation_cache',{})
    if 'schema_ready' not in cache:
        cache['schema_ready']=inspect(db.connection()).has_table('official_rotation_configurations')
    if not cache['schema_ready']:
        return None
    key=('site',site_id)
    if key not in cache:
        cache[key]=list(db.scalars(select(OfficialRotation).where(OfficialRotation.site_id==site_id)
            .order_by(OfficialRotation.version.desc())))
    return next((p for p in cache[key] if p.effective_from<=day and (p.effective_to is None or day<p.effective_to)),None)


def context_hash(db,draft):
    # Include all assignments for employees at the site: changes on another site
    # invalidate the receipt too. Dated inactive rows remain historical evidence.
    ids=select(Assignment.employee_id).where(Assignment.site_id==draft.site_id)
    assignments=list(db.scalars(select(Assignment).where(Assignment.employee_id.in_(ids)).order_by(Assignment.id)))
    return fingerprint({'engine':ENGINE_VERSION,'draft':draft.id,'version':draft.version,'config':draft.config,
        'date':draft.effective_from,'assignments':[
            [a.id,a.employee_id,a.site_id,a.group_code,a.rotation_id,a.work_regime,a.active,a.start_date,a.end_date] for a in assignments],
        'published':[[p.id,p.version,p.effective_from,p.effective_to,p.config] for p in db.scalars(
            select(OfficialRotation).order_by(OfficialRotation.id))]})


def assignment_on(a,day):
    return a.start_date<=day and (a.end_date is None or a.end_date>=day) and (a.active==1 or a.end_date is not None)


ACTIVE_EMPLOYEE_STATUSES=('actif','active')


def occurrence_key(site_id,slot):
    """Identifiant canonique d'une occurrence, identique pour OPS, Pointeur, BEO et Core."""
    start=slot['start'] if isinstance(slot.get('start'),str) else (slot.get('start') or slot['scheduled_start']).isoformat()
    return f"{site_id}:{slot.get('configuration_id') or 'legacy'}:{start}"


def expected_population(db,site_id,slot,*,assignments=None,employees=None):
    """Population attendue CANONIQUE d'une occurrence publiée : affectations du site valides à la
    date de travail de l'occurrence (une nuit reste rattachée au jour où elle commence), du groupe
    de l'occurrence, employés actifs. Le régime de l'affectation n'intervient pas : c'est la
    configuration publiée du site qui fait foi. Seule source des attendus pour la simulation, les
    points critiques, le Pointeur et le BEO."""
    if slot.get('group') is None:return set()
    day=slot['work_date'];day=day if isinstance(day,date) else date.fromisoformat(str(day))
    rows=assignments if assignments is not None else list(db.scalars(select(Assignment).where(Assignment.site_id==site_id)))
    ids={a.employee_id for a in rows if a.site_id==site_id and assignment_on(a,day) and a.group_code==slot['group']}
    if employees is None:
        from app.modules.drh.models import Employee
        employees={e.id:e for e in db.scalars(select(Employee).where(Employee.id.in_(ids or {-1})))}
    return {i for i in ids if i in employees and str(employees[i].status or '').strip().lower() in ACTIVE_EMPLOYEE_STATUSES}


def simulate(db,draft,days=30):
    if days not in (30,60,90):raise HTTPException(422,'Simulation 30/60/90 jours requise')
    result=occurrences(draft.config,draft.effective_from,days)
    rows=list(db.scalars(select(Assignment).where(Assignment.site_id==draft.site_id)))
    employee_ids={a.employee_id for a in rows}
    from app.modules.drh.models import Employee
    staff={e.id:e for e in db.scalars(select(Employee).where(Employee.id.in_(employee_ids or {-1})))}
    others=list(db.scalars(select(Assignment).where(Assignment.employee_id.in_(employee_ids or {-1}),Assignment.site_id!=draft.site_id)))
    for slot in result['slots']:
        day=date.fromisoformat(slot['work_date'])
        members=expected_population(db,draft.site_id,slot,assignments=rows,employees=staff)
        slot['employee_ids']=sorted(members);slot['planned_staff']=len(members)
        required=draft.config.get('required_staff',{}).get(slot['shift'],0)
        if type(required) is not int or required<0:raise HTTPException(422,'Effectif requis invalide')
        slot['required_staff']=required
        if slot['group'] is not None and len(members)<required:
            result['errors'].append({'code':'UNDERSTAFFED','label':'SOUS-EFFECTIF','slot':slot})
        for a in rows:
            if assignment_on(a,day) and a.group_code not in ('A','B','C','D'):
                result['errors'].append({'code':'UNKNOWN_GROUP','employee_id':a.employee_id,'date':day.isoformat()})
        for a in others:
            if a.employee_id not in members:continue
            # An unconfigured second assignment cannot be assumed harmless.
            if any(assignment_on(a,day+timedelta(days=i)) for i in (-1,0,1)):
                other=[];unknown=False
                for i in (-1,0,1):
                    other_day=day+timedelta(days=i)
                    if not assignment_on(a,other_day):continue
                    cfg=configuration_at(db,a.site_id,other_day)
                    if cfg is None:unknown=True;continue
                    other.extend(s for s in occurrences(cfg.config,other_day,1)['slots'] if s['group']==a.group_code)
                if unknown or not compatible(slot,other,draft.config['minimum_rest_minutes']):
                    result['errors'].append({'code':'EMPLOYEE_CONFLICT','employee_id':a.employee_id,'slot':slot})
    # A changed period must respect the last published/historical shift and real open facts.
    previous=configuration_at(db,draft.site_id,draft.effective_from-timedelta(days=1))
    if previous:
        past=occurrences(previous.config,draft.effective_from-timedelta(days=8),8)['slots']
        for slot in result['slots']:
            same=[s for s in past if s['group']==slot['group']]
            if not compatible(slot,same,max(previous.config['minimum_rest_minutes'],draft.config['minimum_rest_minutes'])):
                result['errors'].append({'code':'UNSAFE_TRANSITION','slot':slot})
    if previous is None:
        from app.modules.attendance import official
        for slot in result['slots']:
            if slot['work_date'] > str(draft.effective_from + timedelta(days=7)):
                break
            for eid in slot['employee_ids']:
                for delta in range(1,9):
                    old_day=draft.effective_from-timedelta(days=delta)
                    old_assignment=official.assignment_at(db,eid,draft.site_id,old_day)
                    if old_assignment is None:continue
                    old_plan=official.shift_on(db,old_assignment,old_day)
                    if old_plan.get('working'):
                        old_slot={'start':old_plan['scheduled_start'].isoformat(),'end':old_plan['scheduled_end'].isoformat()}
                        if not compatible(slot,[old_slot],draft.config['minimum_rest_minutes']):
                            result['errors'].append({'code':'UNSAFE_LEGACY_TRANSITION','employee_id':eid,'slot':slot})
    from app.modules.attendance.models import AttendanceEvent,EVENT_ARRIVAL,EVENT_DEPARTURE
    latest={}
    for e in db.scalars(select(AttendanceEvent).where(AttendanceEvent.employee_id.in_(employee_ids or {-1}),
            AttendanceEvent.event_type.in_([EVENT_ARRIVAL,EVENT_DEPARTURE])).order_by(AttendanceEvent.occurred_at.desc(),AttendanceEvent.id.desc())):
        latest.setdefault(e.employee_id,e)
    for slot in result['slots'][:12]:
        for eid in slot['employee_ids']:
            last=latest.get(eid)
            if last is None:continue
            if last.event_type==EVENT_ARRIVAL:
                # A future publication must remain possible while a site is staffed.
                # Check the frozen expected end now; Core rechecks actual closure
                # and rest when the future entry is really attempted.
                frozen=(last.data or {}).get('counted') or {}
                try:
                    expected_end=datetime.fromisoformat(frozen['scheduled_end'])
                    required=draft.config['minimum_rest_minutes']
                    earliest=max(expected_end,datetime.now(ZoneInfo(draft.config['timezone'])))+timedelta(minutes=required)
                    if datetime.fromisoformat(slot['start'])<earliest:
                        result['errors'].append({'code':'OPEN_SHIFT_TRANSITION','employee_id':eid})
                except (KeyError,TypeError,ValueError):
                    result['errors'].append({'code':'OPEN_SHIFT_TRANSITION','employee_id':eid})
            else:
                from app.modules.attendance.core import to_local
                if datetime.fromisoformat(slot['start'])-to_local(last.occurred_at)<timedelta(minutes=draft.config['minimum_rest_minutes']):
                    result['errors'].append({'code':'ACTUAL_REST_TRANSITION','employee_id':eid})
    result['valid']=not result['errors']
    c=draft.config
    calendar={'week_start':c['week_start'],'workdays':c['workdays'],'weekend':c['weekend'],
              'holidays':c['holidays'],'source':c['calendar_source'],'version':c['calendar_version']}
    return {**result,'days':days,'calendar':calendar,'context_hash':context_hash(db,draft)}


def publish(db,draft,actor,receipt,request=None):
    # All official writers lock the site, not just the draft (two different drafts race).
    db.execute(select(Site.id).where(Site.id==draft.site_id).with_for_update()).scalar_one()
    from app.modules.drh.models import Employee
    ids=select(Assignment.employee_id).where(Assignment.site_id==draft.site_id)
    list(db.scalars(select(Employee).where(Employee.id.in_(ids)).order_by(Employee.id).with_for_update()))
    db.refresh(draft)
    existing=db.scalar(select(OfficialRotation).where(OfficialRotation.draft_id==draft.id))
    if existing:return existing
    if not draft.simulation or not draft.simulation.get('valid') or receipt!=draft.simulation.get('context_hash'):
        raise HTTPException(409,'Simulation valide préalable requise')
    if context_hash(db,draft)!=receipt:raise HTTPException(409,'Simulation périmée : simuler à nouveau')
    today=datetime.now(ZoneInfo(draft.config['timezone'])).date()
    if draft.effective_from<=today:raise HTTPException(409,'Publication future uniquement, sans réécriture du passé')
    checked=simulate(db,draft,draft.simulation['days'])
    if not checked['valid']:raise HTTPException(409,'Publication bloquée par les erreurs de simulation')
    last=db.scalar(select(OfficialRotation).where(OfficialRotation.site_id==draft.site_id).order_by(OfficialRotation.version.desc()))
    if last and last.effective_from>=draft.effective_from:raise HTTPException(409,'Période future déjà publiée : révision explicite requise')
    old=last.config if last else None
    if last:
        last.effective_to=draft.effective_from
        db.flush()
    row=OfficialRotation(site_id=draft.site_id,draft_id=draft.id,version=(last.version+1 if last else 1),
        effective_from=draft.effective_from,config=draft.config,simulation_hash=receipt,
        published_by=actor.username,reason=draft.reason)
    db.add(row);db.flush()
    from app.modules.ops.routes import _site_society
    append_audit(db,action='ops.rotations.publish',resource='official_rotation_configuration',resource_id=row.id,
        user=actor,request=request,result='success',society=_site_society(db.get(Site,row.site_id)),
        old_state=old,new_state={'site_id':row.site_id,'version':row.version,'config':row.config,
            'effective_from':str(row.effective_from),'reason':row.reason,'role':actor.role,'simulation_hash':receipt})
    return row


def employee_shift(db,assignment,day):
    """None means the site has not adopted central planning at that date."""
    cfg=configuration_at(db,assignment.site_id,day)
    if cfg is None:return None
    from app.modules.attendance.official import _base,STATUS_OFFICIAL,STATUS_NOT_CONFIGURED
    out=_base(assignment,assignment.employee_id,assignment.site_id,STATUS_NOT_CONFIGURED)
    out.update(configuration_id=cfg.id,configuration_version=cfg.version,policy=cfg.config,
        model={'id':cfg.id,'code':'CENTRAL:'+cfg.config['regime'],'name':cfg.config['regime'],
               'version':cfg.version,'cycle_length':None,'anchor_date':date.fromisoformat(cfg.config['anchor'])},
        work_date=day,regime=cfg.config['regime'],group=assignment.group_code)
    if assignment.group_code not in ('A','B','C','D'):return {**out,'reason':'Groupe inconnu dans le planning publié'}
    computed=occurrences(cfg.config,day,1)
    if any(e['code']=='CALENDAR_UNCONFIRMED' for e in computed['errors']):
        return {**out,'reason':'Calendrier non confirmé à cette date'}
    slots=computed['slots']
    selected=[s for s in slots if s['group']==assignment.group_code]
    if not selected:return {**out,'status':STATUS_OFFICIAL,'official':True,'working':False,'in_progress':False,'shift':'OFF','shift_label':'OFF','normal_minutes':0}
    slot=selected[0]
    a,b=datetime.fromisoformat(slot['start']),datetime.fromisoformat(slot['end'])
    return {**out,'status':STATUS_OFFICIAL,'official':True,'working':True,'shift':slot['shift'],
        'shift_label':slot['shift'],'scheduled_start':a,'scheduled_end':b,'normal_minutes':int((b-a).total_seconds()//60)}


# Transaction-local memoization avoids N+1 lookups in BEO/workspaces. Never a
# module singleton: writes and transaction completion invalidate both hits/misses.
from sqlalchemy import event
from sqlalchemy.orm import Session
@event.listens_for(Session,'after_flush')
def clear_after_write(session,context):
    session.info.pop('central_rotation_cache',None)

@event.listens_for(Session,'after_transaction_end')
def clear_after_transaction(session,transaction):
    session.info.pop('central_rotation_cache',None)


def sync_critical_points(db,site_ids,now):
    """Published planning findings reuse AttendanceAnomaly, never a parallel store.

    Invoked by the existing operational detection transaction, not by read-only
    BEO endpoints. Simulation errors remain draft findings, not production facts.
    """
    from app.modules.attendance.models import AttendanceAnomaly
    from app.modules.attendance import situations
    from app.modules.ops.routes import _site_society
    ids=site_ids if site_ids is not None else set(db.scalars(select(OfficialRotation.site_id)))
    for sid in ids:
        cfg=configuration_at(db,sid,now.date())
        if cfg is None:continue
        computed=occurrences(cfg.config,now.date(),1)
        if any(e['code']=='CALENDAR_UNCONFIRMED' for e in computed['errors']):
            key=f'OFFICIAL:{cfg.id}:{now.date()}:CALENDAR_UNCONFIRMED'
            if not db.scalar(select(AttendanceAnomaly.id).where(AttendanceAnomaly.dedupe_key==key)):
                point=AttendanceAnomaly(anomaly_type='CALENDAR_UNCONFIRMED',severity='critical',status='OPEN',site_id=sid,
                    society=_site_society(db.get(Site,sid)),presence_date=now.date(),source='SYSTEM',dedupe_key=key,
                    message='CALENDRIER NON CONFIRMÉ',details={'policy_version':7,'configuration_id':cfg.id})
                db.add(point);db.flush();situations.publish(db,point)
            continue
        rows=list(db.scalars(select(Assignment).where(Assignment.site_id==sid)))
        from app.modules.attendance import core,live
        from app.modules.ops.models import DailyPresence
        from app.modules.drh.models import Employee
        ids={a.employee_id for a in rows}
        last=live._latest_scans(db,employee_ids=ids) if ids else {}
        excused=set(db.execute(select(DailyPresence.employee_id,DailyPresence.presence_date).where(
            DailyPresence.employee_id.in_(ids or {-1}),DailyPresence.status.in_(live.EXCUSED_STATUSES))).all())
        employees={e.id:e for e in db.scalars(select(Employee).where(Employee.id.in_(ids or {-1})))}
        for delta in (-1,0):
            work_day=now.date()+timedelta(days=delta)
            active_cfg=configuration_at(db,sid,work_day)
            if active_cfg is None:continue
            for expected in occurrences(active_cfg.config,work_day,1)['slots']:
                start,end=datetime.fromisoformat(expected['start']),datetime.fromisoformat(expected['end'])
                if not start+timedelta(minutes=active_cfg.config['late_refusal_minutes'])<=now<end:continue
                members=expected_population(db,sid,expected,assignments=rows,employees=employees)
                for eid in members:
                    employee=employees[eid]
                    if (eid,work_day) in excused:continue
                    event=last.get(eid)
                    snapshot=((event.data or {}).get('counted') or {}) if event else {}
                    if event and event.site_id==sid and snapshot.get('scheduled_start')==expected['start']:continue
                    key=f"ABSENT:{eid}:{sid}:{expected['start']}"
                    core.raise_anomaly(db,anomaly_type='ABSENT',severity='warning',employee=employee,site_id=sid,
                        presence_date=work_day,source='SYSTEM',dedupe_key=key,message='Non pointé sur la vacation officielle',
                        details={'policy_version':7,'configuration_id':active_cfg.id,'group':expected['group'],
                                 'scheduled_start':expected['start'],'scheduled_end':expected['end']})
        for slot in occurrences(cfg.config,now.date(),1)['slots']:
            members=expected_population(db,sid,slot,assignments=rows,employees=employees)
            required=cfg.config.get('required_staff',{}).get(slot['shift'],0)
            code='UNCOVERED_SHIFT' if slot['group'] is None else ('UNDERSTAFFED' if len(members)<required else None)
            if code is None:continue
            key=f"OFFICIAL:{cfg.id}:{slot['start']}:{code}"
            if db.scalar(select(AttendanceAnomaly.id).where(AttendanceAnomaly.dedupe_key==key)):continue
            point=AttendanceAnomaly(anomaly_type=code,severity='critical',status='OPEN',site_id=sid,
                society=_site_society(db.get(Site,sid)),presence_date=now.date(),source='SYSTEM',dedupe_key=key,
                message='VACATION NON COUVERTE' if code=='UNCOVERED_SHIFT' else 'SOUS-EFFECTIF',
                details={'policy_version':7,'configuration_id':cfg.id,'configuration_version':cfg.version,
                         'slot':slot,'planned_staff':len(members),'required_staff':required})
            db.add(point);db.flush();situations.publish(db,point)
