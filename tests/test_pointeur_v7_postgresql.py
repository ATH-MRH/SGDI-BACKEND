"""Adoption V7 peuplée et restauration réelles, bases PostgreSQL jetables uniquement."""
import os
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import shutil
import subprocess
import uuid
from types import SimpleNamespace
from fastapi import HTTPException

import pytest
from sqlalchemy import select,text,create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from tests.test_facial_device_authorizations_migration_pg import pg_database
from tests.test_pointeur_iron_emploi_merge_pg import alembic,ok,snapshot
from tests.test_attendance_counted_time import _setup,_ts
from app.modules.attendance import core,official,situations,live
from app.modules.attendance.models import AttendanceAnomaly
from app.modules.alerts.models import Alert
from app.modules.attendance.workspace import read_workspace
from app.modules.ops.models import SiteRotation,DailyPresence,Assignment,RotationTemplate

pytestmark=pytest.mark.skipif(not os.getenv('TEST_POSTGRES_ADMIN_URL'),reason='PostgreSQL jetable requis')


def restoration_metadata(engine):
    with engine.connect() as conn:
        constraints=list(conn.execute(text("SELECT r.relname,c.conname,pg_get_constraintdef(c.oid),c.convalidated,c.condeferrable,c.condeferred FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace JOIN pg_class r ON r.oid=c.conrelid WHERE n.nspname='public' ORDER BY 1,2")))
        canonical=[]
        quote=engine.dialect.identifier_preparer.quote
        for table,name,definition,*flags in constraints:
            if definition.startswith('CHECK '):
                # pg_dump/restore reparses CHECK expressions: e.g. a varchar[]→text[]
                # cast can be pushed to its literal elements. Compare both definitions
                # after PostgreSQL itself parses them, preserving validation flags.
                conn.exec_driver_sql(f'CREATE TEMP TABLE v7_restore_check (LIKE public.{quote(table)}) ON COMMIT DROP')
                conn.exec_driver_sql(f'ALTER TABLE v7_restore_check ADD CONSTRAINT canonical_check {definition}')
                definition=conn.scalar(text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='pg_temp.v7_restore_check'::regclass AND conname='canonical_check'"))
                conn.exec_driver_sql('DROP TABLE v7_restore_check')
            canonical.append((table,name,definition,*flags))
        return {
            'sequences': list(conn.execute(text("SELECT sequencename,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename"))),
            'constraints': canonical,
            'indexes': list(conn.execute(text("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname"))),
        }


def seed(db,phase):
    employee,site=_setup(db,group='A')
    cutoff=datetime.now(ZoneInfo('Africa/Algiers')).date()
    db.scalar(select(SiteRotation).where(SiteRotation.site_id==site.id)).start_date=cutoff-timedelta(days=phase+1)
    db.commit()
    return employee,site,cutoff


def test_unsafe_night_upgrade_is_atomic_and_keeps_old_head(pg_database,monkeypatch):
    url,engine=pg_database;ok(alembic(url,'upgrade','20261024_0001'))
    with Session(engine) as db:
        employee,site,cutoff=seed(db,4)
        night=official.official_shift(db,employee_id=employee.id,site_id=site.id,at=_ts(cutoff-timedelta(days=1),'22:00'))
        assert night['shift']=='NUIT'
    monkeypatch.setenv('ATLAS_V7_EFFECTIVE_DATE',cutoff.isoformat())
    before=snapshot(engine)
    preview=subprocess.run([os.sys.executable,'scripts/pointeur_v7_preflight.py','--effective-date',cutoff.isoformat()],
        env={**os.environ,'DATABASE_URL':url},capture_output=True,text=True)
    assert preview.returncode==1 and 'BLOCKED' in preview.stdout
    assert snapshot(engine)==before
    result=alembic(url,'upgrade','head')
    assert result.returncode!=0 and 'repos de transition inférieur à 8h' in result.stderr
    assert snapshot(engine)==before
    with engine.connect() as conn:
        assert conn.scalar(text('select version_num from alembic_version'))=='20261024_0001'


def test_safe_adoption_preserves_events_and_beo_and_restores_exactly(pg_database,monkeypatch,tmp_path):
    url,engine=pg_database;ok(alembic(url,'upgrade','20261024_0001'))
    with Session(engine) as db:
        employee,site,cutoff=seed(db,0)
        eid,sid=employee.id,site.id
        previous=cutoff-timedelta(days=1)
        for time in ['06:00','14:00']:
            core.record_scan(db,employee=employee,source='QR',actor=None,idempotency_key=None,now=_ts(previous,time))
        before_grid=read_workspace(db,site_ids={sid},month=previous.strftime('%Y-%m'))
        cell=next(c for c in before_grid['items'][0]['days'] if c['date']==previous.isoformat())
        assert cell['recorded'] and cell['presence_state']=='POINTE'
    before=snapshot(engine)
    before_metadata=restoration_metadata(engine)
    dump_bin=os.getenv('TEST_PG_DUMP_BIN') or shutil.which('pg_dump')
    restore_bin=os.getenv('TEST_PG_RESTORE_BIN') or shutil.which('pg_restore')
    assert dump_bin and restore_bin,'pg_dump et pg_restore requis pour la recette de restauration'
    target=make_url(url)
    env={**os.environ,'PGPASSWORD':target.password or ''}
    args=['-h',target.host,'-p',str(target.port or 5432),'-U',target.username]
    backup=tmp_path/'synthetic-pre-v7.dump'
    result=subprocess.run([dump_bin,*args,'-Fc','-f',str(backup),target.database],env=env,capture_output=True,text=True)
    assert result.returncode==0,result.stderr
    monkeypatch.setenv('ATLAS_V7_EFFECTIVE_DATE',cutoff.isoformat())
    preview=subprocess.run([os.sys.executable,'scripts/pointeur_v7_preflight.py','--effective-date',cutoff.isoformat()],
        env={**os.environ,'DATABASE_URL':url},capture_output=True,text=True)
    assert preview.returncode==0 and 'READY' in preview.stdout
    future=subprocess.run([os.sys.executable,'scripts/pointeur_v7_preflight.py','--effective-date',(cutoff+timedelta(days=8)).isoformat()],
        env={**os.environ,'DATABASE_URL':url},capture_output=True,text=True)
    assert future.returncode==0 and 'READY' in future.stdout
    assert snapshot(engine)==before
    ok(alembic(url,'upgrade','head'))
    after=snapshot(engine)
    changed={name for name in before if before[name]!=after[name]}
    assert changed=={'rotation_templates','assignments','site_rotations'}
    assert before['attendance_events']==after['attendance_events']
    assert before[DailyPresence.__tablename__]==after[DailyPresence.__tablename__]
    with Session(engine) as db:
        after_grid=read_workspace(db,site_ids={sid},month=previous.strftime('%Y-%m'))
        after_cell=next(c for c in after_grid['items'][0]['days'] if c['date']==previous.isoformat())
        assert after_cell==cell
        assert official.official_shift(db,employee_id=eid,site_id=sid,at=_ts(cutoff,'06:00'))['model']['code']==official.FIXED_MODEL_CODE
    ok(alembic(url,'upgrade','head'));assert snapshot(engine)==after
    denied=alembic(url,'downgrade','20261024_0001')
    assert denied.returncode!=0 and 'Downgrade refusé' in denied.stderr
    # Exercise the actual V7 Core and JSON workflow on PostgreSQL, not just DDL.
    with Session(engine) as db:
        from app.modules.drh.models import Employee
        employee=db.get(Employee,eid)
        actor=SimpleNamespace(id=None,username='PG-PTG')
        first=core.record_scan(db,employee=employee,source='QR',actor=actor,idempotency_key=None,now=_ts(cutoff,'06:00'))
        assert first['counted']['policy_version']==7
        with pytest.raises(HTTPException) as early:
            core.record_scan(db,employee=employee,source='QR',actor=actor,idempotency_key=None,now=_ts(cutoff,'13:59'))
        assert early.value.headers['X-Attendance-Code']=='EARLY_EXIT_REFUSED'
        assert live.summary(db,{sid},_ts(cutoff,'14:20'))['present_now']==1
        situations.detect_maintenance(db,{sid},_ts(cutoff,'14:20'));db.commit()
        point=db.scalar(select(AttendanceAnomaly).where(AttendanceAnomaly.dedupe_key==f"MAINTENANCE:{first['event_id']}"))
        situations.transition(db,point,target='TO_PROCESS',reason='Contrôle PostgreSQL',responsible='PG-PTG',actor=actor);db.commit()
        core.record_scan(db,employee=employee,source='QR',actor=actor,idempotency_key=None,now=_ts(cutoff,'15:00'))
        assert situations.view(point)['status']=='ARCHIVED'
        projections=list(db.scalars(select(Alert).where(Alert.dedup_key.in_([f'ATTENDANCE_SITUATION:{point.id}:OPS',f'ATTENDANCE_SITUATION:{point.id}:DRH']))))
        assert len(projections)==2 and all(a.status=='resolved' for a in projections)
        assert live.summary(db,{sid},_ts(cutoff,'15:01'))['present_now']==0
        # A wrong/obsolete model cannot reopen the old unconfigured fallback on an adopted site.
        assignment=db.scalar(select(Assignment).where(Assignment.employee_id==eid,Assignment.active==1))
        assignment.rotation_id=db.scalar(select(RotationTemplate.id).where(RotationTemplate.code==official.OFFICIAL_MODEL_CODE))
        db.commit()
        with pytest.raises(HTTPException) as unconfigured:
            core.record_scan(db,employee=employee,source='QR',actor=actor,idempotency_key=None,now=_ts(cutoff+timedelta(days=1),'06:00'))
        assert unconfigured.value.headers['X-Attendance-Code']=='ROTATION_NOT_CONFIGURED'
    restored_name='atlas_v7_restore_'+uuid.uuid4().hex[:12]
    admin=create_engine(make_url(os.environ['TEST_POSTGRES_ADMIN_URL']),isolation_level='AUTOCOMMIT')
    restored=None
    try:
        with admin.connect() as conn:conn.execute(text(f'CREATE DATABASE "{restored_name}"'))
        result=subprocess.run([restore_bin,*args,'-d',restored_name,'--exit-on-error',str(backup)],env=env,capture_output=True,text=True)
        assert result.returncode==0,result.stderr
        restored=create_engine(target.set(database=restored_name))
        assert snapshot(restored)==before
        restored_metadata=restoration_metadata(restored)
        for kind in before_metadata:
            if restored_metadata[kind]!=before_metadata[kind]:
                print('RESTORE_METADATA_DIFF',kind,'BEFORE_ONLY',set(before_metadata[kind])-set(restored_metadata[kind]),
                      'AFTER_ONLY',set(restored_metadata[kind])-set(before_metadata[kind]))
        assert restored_metadata==before_metadata
        with restored.connect() as conn:
            assert conn.scalar(text('select version_num from alembic_version'))=='20261024_0001'
        print(f'V7 migration idempotente ; restauration vérifiée : {len(before)} tables, séquences, contraintes, index ; historique BEO identique')
    finally:
        if restored is not None:restored.dispose()
        with admin.connect() as conn:conn.execute(text(f'DROP DATABASE IF EXISTS "{restored_name}" WITH (FORCE)'))
        admin.dispose()
