"""Adoption datée des horaires fixes ; pas de réécriture des faits/plannings historiques."""
import importlib.util
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.modules.attendance import official
from app.modules.ops.models import Assignment, SiteRotation
from tests.test_attendance_counted_time import _setup


def test_adoption_preserves_history_is_idempotent_and_keeps_explicit_regimes(tmp_path):
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
            past=cutoff-timedelta(days=3)
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
