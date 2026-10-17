"""Preserve current-main contract imports, badges and Emploi across the facial join."""
import os
from datetime import date, datetime
from pathlib import Path

import pytest
import sqlalchemy as sa

from tests.test_facial_device_authorizations_migration_pg import pg_database  # noqa: F401
from tests.test_pointeur_badges_merge_pg import seed_badges
from tests.test_pointeur_iron_emploi_merge_pg import alembic, ok, revisions, seed_emploi, snapshot

pytestmark = pytest.mark.skipif(not os.getenv('TEST_POSTGRES_ADMIN_URL'), reason='PostgreSQL jetable requis')


def test_current_main_contract_import_and_existing_rows_survive_join(pg_database):
    url, engine = pg_database
    baseline = Path(os.getenv('ATLAS_BADGES_MAIN_SOURCE', str(Path(__file__).resolve().parents[1])))
    ok(alembic(url, 'upgrade', '20261015_0002', repo=baseline))
    seed_emploi(engine)
    seed_badges(engine)
    from app.modules.drh.models import Contract, Employee
    from app.modules.drh.candidate_import_models import CandidateImportSession
    with engine.begin() as db:
        employee = db.execute(Employee.__table__.insert().values(
            code='FICTIVE-CONTRACT', first_name='Fictive', last_name='Import',
            society='Fictive', status='actif').returning(Employee.id)).scalar_one()
        contract = db.execute(Contract.__table__.insert().values(
            employee_id=employee, contract_type='CDD', position='Agent fictif',
            start_date=date(2026, 10, 14), end_date=date(2027, 10, 13),
            salary_net=40000, status='actif').returning(Contract.id)).scalar_one()
        db.execute(CandidateImportSession.__table__.insert().values(
            public_id='contract-fictive-resync', user_id=1, username='FICTIVE',
            file_name='fictive.xlsx', file_sha256='0' * 64, file_size=42,
            status='completed', expires_at=datetime(2026, 11, 1),
            completed_at=datetime(2026, 10, 14), workbook=None, plan=None,
            result={'rows': [{'employee_id': employee, 'contract_id': contract}]}))
    before = snapshot(engine)
    ok(alembic(url, 'upgrade', '20261019_0001'))
    after = snapshot(engine)
    assert revisions(engine) == {'20261019_0001'}
    assert set(after) == set(before) | {'facial_device_authorizations'}
    assert {table: after[table] for table in before} == before
    ok(alembic(url, 'upgrade', '20261019_0001'))
    assert snapshot(engine) == after
