"""Real PostgreSQL publication, rollback, concurrency and historic facts."""
import os
from datetime import datetime,timedelta,date
from types import SimpleNamespace
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from fastapi import HTTPException
from tests.test_facial_device_authorizations_migration_pg import pg_database,alembic
from tests.test_central_rotation_engine import config
from app.modules.ops.models import Site,Assignment
from app.modules.rotations.models import RotationDraft,OfficialRotation
from app.modules.rotations import service

pytestmark=pytest.mark.skipif(not os.getenv('TEST_POSTGRES_ADMIN_URL'),reason='PostgreSQL jetable explicitement requis')
ACTOR=SimpleNamespace(id=None,username='Synthetic OPS',role='ops')


def prepare(engine):
    # Migrate the preexisting schema first, then install only the central revision.
    with Session(engine) as db:
        site=Site(name='Synthetic central rotations',active=1);db.add(site);db.flush()
        day=datetime.now(ZoneInfo('Africa/Algiers')).date()+timedelta(days=10)
        c=config('3X8',anchor=str(day))
        draft=RotationDraft(site_id=site.id,config=c,effective_from=day,reason='Synthetic migration test',created_by=ACTOR.username)
        db.add(draft)
        from app.modules.drh.models import Employee
        for g in 'ABCD':
            employee=Employee(code='CENTRAL-PG-'+g+str(site.id),first_name='Synthetic',last_name=g,status='actif')
            db.add(employee);db.flush()
            db.add(Assignment(employee_id=employee.id,site_id=site.id,group_code=g,start_date=day,active=1))
        db.commit();return site.id,draft.id,day


def test_migration_no_automatic_adoption_and_publication_restores_history(pg_database):
    url,engine=pg_database
    result=alembic(url,'upgrade','20261025_0001');assert result.returncode==0,result.stderr
    with engine.begin() as conn:
        sid=conn.execute(Site.__table__.insert().values(name='Synthetic historical',active=1).returning(Site.id)).scalar_one()
        before=conn.execute(sa.text('SELECT * FROM sites WHERE id=:id'),{'id':sid}).mappings().one()
    result=alembic(url,'upgrade','head');assert result.returncode==0,result.stderr
    with engine.connect() as conn:
        assert dict(conn.execute(sa.text('SELECT * FROM sites WHERE id=:id'),{'id':sid}).mappings().one())==dict(before)
        assert conn.scalar(sa.text('SELECT count(*) FROM official_rotation_configurations'))==0
    sid,did,day=prepare(engine)
    with Session(engine) as db:
        draft=db.get(RotationDraft,did)
        with pytest.raises(HTTPException):service.publish(db,draft,ACTOR,'x'*64)
        draft.simulation=service.simulate(db,draft);receipt=draft.simulation['context_hash'];db.commit()
        published=service.publish(db,draft,ACTOR,receipt);db.commit();pid=published.id
        assert service.publish(db,draft,ACTOR,receipt).id==pid
        assert service.configuration_at(db,sid,day-timedelta(days=1)) is None
        assert service.configuration_at(db,sid,day).id==pid
    with pytest.raises(sa.exc.DBAPIError):
        with engine.begin() as conn:conn.execute(sa.text("UPDATE official_rotation_configurations SET config='{}' WHERE id=:id"),{'id':pid})
    refused=alembic(url,'downgrade','20261025_0001')
    assert refused.returncode!=0 and 'publications officielles' in refused.stderr
    with engine.connect() as conn:assert conn.scalar(sa.text('SELECT count(*) FROM official_rotation_configurations'))==1


def test_stale_simulation_and_two_concurrent_publications(pg_database):
    url,engine=pg_database
    result=alembic(url,'upgrade','head');assert result.returncode==0,result.stderr
    sid,did,day=prepare(engine)
    with Session(engine) as db:
        a=db.get(RotationDraft,did)
        b=RotationDraft(site_id=sid,config=a.config,effective_from=day,reason='Concurrent draft',created_by=ACTOR.username)
        db.add(b);db.commit();bid=b.id
        a.simulation=service.simulate(db,a);b.simulation=service.simulate(db,b);db.commit()
    def publish_one(draft_id):
        with Session(engine) as db:
            draft=db.get(RotationDraft,draft_id)
            try:
                row=service.publish(db,draft,ACTOR,draft.simulation['context_hash']);db.commit();return row.id
            except HTTPException as e:
                db.rollback();return e.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(publish_one,[did,bid]))
    assert sum(r==409 for r in results)==1
    with engine.connect() as conn:assert conn.scalar(sa.text('SELECT count(*) FROM official_rotation_configurations'))==1


def test_uncovered_cannot_be_published(pg_database):
    url,engine=pg_database
    result=alembic(url,'upgrade','head');assert result.returncode==0,result.stderr
    sid,did,day=prepare(engine)
    with Session(engine) as db:
        d=db.get(RotationDraft,did)
        d.config=config(minimum_rest_minutes=1441,anchor=str(day))
        d.simulation=service.simulate(db,d);db.commit()
        assert not d.simulation['valid'] and any(e['code']=='UNCOVERED_SHIFT' for e in d.simulation['errors'])
        with pytest.raises(HTTPException):service.publish(db,d,ACTOR,d.simulation['context_hash'])
        assert db.scalar(sa.select(sa.func.count()).select_from(OfficialRotation))==0


def test_postgresql_real_core_uses_published_snapshot_and_custom_threshold(pg_database):
    url,engine=pg_database
    result=alembic(url,'upgrade','head');assert result.returncode==0,result.stderr
    sid,did,day=prepare(engine)
    from app.modules.attendance import core
    from app.modules.drh.models import Employee
    with Session(engine) as db:
        d=db.get(RotationDraft,did);d.config={**d.config,'late_refusal_minutes':12}
        d.simulation=service.simulate(db,d);db.commit()
        p=service.publish(db,d,ACTOR,d.simulation['context_hash']);db.commit()
        a=db.scalar(sa.select(Assignment).where(Assignment.site_id==sid,Assignment.group_code=='A'))
        employee=db.get(Employee,a.employee_id)
        at=datetime.combine(day,datetime.min.time(),ZoneInfo('Africa/Algiers'))+timedelta(hours=6)
        with pytest.raises(HTTPException) as denied:
            core.record_scan(db,employee=employee,source='QR',actor=ACTOR,idempotency_key=None,now=at+timedelta(minutes=12))
        assert denied.value.headers['X-Attendance-Code']=='LATE_ENTRY_REFUSED'
        response=core.record_scan(db,employee=employee,source='MANUAL',actor=ACTOR,idempotency_key=None,
            now=at+timedelta(minutes=12),manual_entry_allowed=True,observation='Admission synthétique motivée')
        assert response['counted']['configuration_id']==p.id
        assert response['counted']['late_minutes']==12


def test_incomplete_preexisting_configuration_table_cannot_advance_head(pg_database):
    url,engine=pg_database
    result=alembic(url,'upgrade','head');assert result.returncode==0,result.stderr
    with engine.begin() as conn:
        conn.execute(sa.text('ALTER TABLE rotation_configuration_drafts DROP COLUMN reason'))
        conn.execute(sa.text("UPDATE alembic_version SET version_num='20261025_0001'"))
    refused=alembic(url,'upgrade','head')
    assert refused.returncode!=0 and 'préexistant incompatible' in refused.stderr
    with engine.connect() as conn:assert conn.scalar(sa.text('SELECT version_num FROM alembic_version'))=='20261025_0001'


def test_dump_restore_preserves_published_configurations_and_exact_planning(pg_database,tmp_path):
    import subprocess,shutil,uuid
    from sqlalchemy.engine import make_url
    from tests.test_pointeur_iron_emploi_merge_pg import snapshot
    from app.modules.rotations.engine import occurrences
    url,engine=pg_database
    result=alembic(url,'upgrade','head');assert result.returncode==0,result.stderr
    sid,did,day=prepare(engine)
    with Session(engine) as db:
        d=db.get(RotationDraft,did);d.simulation=service.simulate(db,d);db.commit()
        p=service.publish(db,d,ACTOR,d.simulation['context_hash']);db.commit()
        expected=occurrences(p.config,day,90)
    before=snapshot(engine)
    target=make_url(url);args=['-h',target.host,'-p',str(target.port),'-U',target.username]
    env={**os.environ,'PGPASSWORD':target.password or ''};backup=tmp_path/'central-synthetic.dump'
    dump=shutil.which('pg_dump');restore=shutil.which('pg_restore');assert dump and restore
    subprocess.run([dump,*args,'-Fc','-f',str(backup),target.database],env=env,check=True,capture_output=True)
    name='atlas_central_restore_'+uuid.uuid4().hex[:10]
    admin=sa.create_engine(os.environ['TEST_POSTGRES_ADMIN_URL'],isolation_level='AUTOCOMMIT');restored=None
    try:
        with admin.connect() as conn:conn.execute(sa.text(f'CREATE DATABASE "{name}"'))
        subprocess.run([restore,*args,'--exit-on-error','-d',name,str(backup)],env=env,check=True,capture_output=True)
        restored=sa.create_engine(target.set(database=name))
        assert snapshot(restored)==before
        with Session(restored) as db:
            config_row=service.configuration_at(db,sid,day)
            assert occurrences(config_row.config,day,90)==expected
            assert db.scalar(sa.text('SELECT version_num FROM alembic_version'))=='20261026_0001'
        with pytest.raises(sa.exc.DBAPIError):
            with restored.begin() as conn:conn.execute(sa.text('DELETE FROM official_rotation_configurations'))
    finally:
        if restored is not None:restored.dispose()
        with admin.connect() as conn:conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
