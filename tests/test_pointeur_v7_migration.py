"""Adoption datée des horaires fixes ; pas de réécriture des faits/plannings historiques."""
import importlib.util
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
import pytest

from app.db.base import Base
from app.modules.attendance import official
from app.modules.ops.models import Assignment, SiteRotation
from tests.test_attendance_counted_time import _setup


def test_adoption_preserves_history_is_idempotent_and_keeps_explicit_regimes(tmp_path,monkeypatch):
    path=Path(__file__).parents[1]/'migrations/versions/20261025_0001_pointeur_fixed_groups.py'
    spec=importlib.util.spec_from_file_location('v7_migration',path)
    migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
    engine=create_engine('sqlite:///'+str(tmp_path/'v7.sqlite'))
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            employee,site=_setup(db,group='A')
            old=db.scalar(select(Assignment).where(Assignment.employee_id==employee.id))
            old_id,old_model=old.id,old.rotation_id
            cutoff=datetime.now(ZoneInfo('Africa/Algiers')).date()
            monkeypatch.setenv('ATLAS_V7_EFFECTIVE_DATE',cutoff.isoformat())
            db.scalar(select(SiteRotation)).start_date=cutoff-timedelta(days=1)
            db.commit()
            past=cutoff-timedelta(days=1)
            historical=official.shift_on(db,old,past)
            for _ in range(2):
                with Operations.context(MigrationContext.configure(db.connection())): migration.upgrade()
                db.commit();db.expire_all()
            rows=db.scalars(select(Assignment).where(Assignment.employee_id==employee.id).order_by(Assignment.id)).all()
            assert len(rows)==2
            assert rows[0].id==old_id and rows[0].rotation_id==old_model and rows[0].end_date==cutoff-timedelta(days=1)
            assert rows[1].start_date==cutoff and rows[1].active==1
            assert official.shift_on(db,rows[0],past)['shift']==historical['shift']
            assert official.shift_on(db,rows[1],cutoff)['shift']=='MATIN'
            assert len(db.scalars(select(SiteRotation).where(SiteRotation.site_id==site.id)).all())==2
    finally:
        engine.dispose()


def _module():
    path=Path(__file__).parents[1]/'migrations/versions/20261025_0001_pointeur_fixed_groups.py'
    spec=importlib.util.spec_from_file_location('v7_transition_migration',path)
    migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
    return migration


@pytest.fixture
def transition_db(tmp_path):
    engine=create_engine('sqlite:///'+str(tmp_path/'transition.sqlite'))
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    engine.dispose()


def _upgrade(migration,db):
    with Operations.context(MigrationContext.configure(db.connection())):
        migration.upgrade()
    db.commit();db.expire_all()


def test_populated_migration_requires_explicit_date_before_any_write(transition_db,monkeypatch):
    from sqlalchemy import func
    from app.modules.ops.models import RotationTemplate
    db=transition_db
    employee,site=_setup(db,group='A')
    monkeypatch.delenv('ATLAS_V7_EFFECTIVE_DATE',raising=False)
    with pytest.raises(RuntimeError,match='ATLAS_V7_EFFECTIVE_DATE'):
        _upgrade(_module(),db)
    assert db.scalar(select(func.count()).select_from(RotationTemplate))==1
    assert len(db.scalars(select(Assignment)).all())==1
    assert db.scalar(select(Assignment)).active==1


@pytest.mark.parametrize('phase,safe',[(0,True),(1,True),(2,True),(3,True),(4,False),(5,False),(6,True),(7,True)])
def test_transition_refuses_night_then_morning_without_rest(transition_db,monkeypatch,phase,safe):
    db=transition_db
    employee,site=_setup(db,group='A')
    cutoff=datetime.now(ZoneInfo('Africa/Algiers')).date()
    anchor=db.scalar(select(SiteRotation))
    anchor.start_date=cutoff-timedelta(days=phase+1)
    db.commit()
    monkeypatch.setenv('ATLAS_V7_EFFECTIVE_DATE',cutoff.isoformat())
    migration=_module()
    if not safe:
        with pytest.raises(RuntimeError,match='repos de transition inférieur à 8h'):
            _upgrade(migration,db)
        assert db.scalar(select(Assignment)).active==1
        assert len(db.scalars(select(Assignment)).all())==1
        return
    _upgrade(migration,db)
    rows=db.scalars(select(Assignment).order_by(Assignment.id)).all()
    assert len(rows)==2
    old=official.shift_on(db,rows[0],cutoff-timedelta(days=1))
    new=official.shift_on(db,rows[1],cutoff)
    if old['working']:
        assert new['scheduled_start']-old['scheduled_end']>=timedelta(hours=8)
    _upgrade(migration,db)
    assert len(db.scalars(select(Assignment)).all())==2


@pytest.mark.parametrize('offset',[-1,1])
def test_transition_cannot_be_implicitly_retroactive_or_future(transition_db,monkeypatch,offset):
    db=transition_db;_setup(db,group='A')
    cutoff=datetime.now(ZoneInfo('Africa/Algiers')).date()
    monkeypatch.setenv('ATLAS_V7_EFFECTIVE_DATE',(cutoff+timedelta(days=offset)).isoformat())
    with pytest.raises(RuntimeError,match='jour local'):
        _upgrade(_module(),db)
    assert len(db.scalars(select(Assignment)).all())==1
