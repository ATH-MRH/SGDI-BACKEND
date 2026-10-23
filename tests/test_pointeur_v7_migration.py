"""Exécution future V7 : catalogue seul, aucune adoption ni réécriture historique."""
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


@pytest.mark.parametrize('phase',range(8))
@pytest.mark.parametrize('effective',['','2020-01-01','2099-01-01','today'])
def test_catalog_only_never_adopts_even_with_stale_effective_date(transition_db,monkeypatch,phase,effective):
    from app.modules.ops.models import RotationTemplate
    db=transition_db
    employee,site=_setup(db,group='A')
    today=datetime.now(ZoneInfo('Africa/Algiers')).date()
    db.scalar(select(SiteRotation)).start_date=today-timedelta(days=phase+1);db.commit()
    if effective:monkeypatch.setenv('ATLAS_V7_EFFECTIVE_DATE',today.isoformat() if effective=='today' else effective)
    else:monkeypatch.delenv('ATLAS_V7_EFFECTIVE_DATE',raising=False)
    tables=[Assignment.__table__,SiteRotation.__table__]
    before={t.name:[dict(r) for r in db.execute(select(t)).mappings()] for t in tables}
    assignment=db.scalar(select(Assignment));shift=official.shift_on(db,assignment,today)
    for _ in range(2):
        _upgrade(_module(),db)
        assert {t.name:[dict(r) for r in db.execute(select(t)).mappings()] for t in tables}==before
        assert official.shift_on(db,assignment,today)==shift
    assert db.scalar(select(RotationTemplate).where(RotationTemplate.code==_module().CODE)) is not None
