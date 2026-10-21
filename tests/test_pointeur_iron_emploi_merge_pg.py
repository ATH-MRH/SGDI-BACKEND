"""Real PostgreSQL joins from both frozen source histories without losing data.

All databases are disposable. ATLAS_SYNC_MAIN_SOURCE and ATLAS_SYNC_POINTER_SOURCE
may point to local git-archive exports of the exact source commits for stronger
baseline verification. Without exports, the candidate's unchanged parent revisions
are used. No production connections, keys or devices.
"""
import hashlib
import os
import subprocess
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory

from tests.test_facial_device_authorizations_migration_pg import pg_database  # noqa: F401

REPO = Path(__file__).resolve().parents[1]
MAIN, POINTER, MERGE = '20261016_0001', '20261017_0001', '20261018_0001'
pytestmark = pytest.mark.skipif(not os.getenv('TEST_POSTGRES_ADMIN_URL'), reason='PostgreSQL jetable requis')


def alembic(url, *args, repo=REPO):
    return subprocess.run([sys.executable, '-m', 'alembic', *args], cwd=repo,
                          env={**os.environ, 'DATABASE_URL': url, 'APP_ENV': 'test',
                               'JWT_SECRET': 'fictive-synchronized-migration-test-secret'},
                          capture_output=True, text=True, timeout=120)


def ok(result):
    assert result.returncode == 0, result.stdout + result.stderr


def snapshot(engine):
    """Exact fingerprint of every existing row, apart from the migration marker."""
    with engine.connect() as db:
        return {
            name: hashlib.sha256('\n'.join(db.execute(sa.text(
                f'SELECT row_to_json(t)::text FROM "{name}" AS t ORDER BY row_to_json(t)::text'
            )).scalars()).encode()).hexdigest()
            for name in sa.inspect(db).get_table_names() if name != 'alembic_version'
        }


def revisions(engine):
    with engine.connect() as db:
        return set(db.execute(sa.text('SELECT version_num FROM alembic_version')).scalars())


def seed_emploi(engine):
    from app.modules.drh.models import Candidate
    from app.modules.recruitment_jobs_models import (RecruitmentApplication, RecruitmentCandidateAccount,
                                                    RecruitmentCompany, RecruitmentJobOffer)
    from datetime import datetime
    from decimal import Decimal

    with engine.begin() as db:
        company = db.execute(RecruitmentCompany.__table__.insert().values(
            name='Fictive', society='Fictive', society_key='FICTIVE').returning(RecruitmentCompany.id)).scalar_one()
        offer = db.execute(RecruitmentJobOffer.__table__.insert().values(
            company_id=company, title='Agent fictif', salary_amount=Decimal('45000.00'),
            salary_period='monthly').returning(RecruitmentJobOffer.id)).scalar_one()
        candidate = db.execute(Candidate.__table__.insert().values(
            first_name='Fictive', last_name='Candidate', society='Fictive').returning(Candidate.id)).scalar_one()
        account = db.execute(RecruitmentCandidateAccount.__table__.insert().values(
            first_name='Fictive', last_name='Candidate', phone='+213555000001', candidate_id=candidate,
            last_activity_at=datetime(2026, 10, 1), settings={'notifications': False}).returning(RecruitmentCandidateAccount.id)).scalar_one()
        db.execute(RecruitmentApplication.__table__.insert().values(
            account_id=account, candidate_id=candidate, offer_id=offer,
            request_id='fictive-merge-application', status='shortlisted', stage='interview'))


def seed_pointer(engine):
    from app.modules.auth.models import User
    from app.modules.ops.models import Site
    from app.modules.biometrics.models import Camera, FacialDeviceAuthorization

    with engine.begin() as db:
        user = db.execute(User.__table__.insert().values(
            username='FICTIVE', full_name='Fictive', role='pointeur', password_hash='fictive',
            authorized_modules=['pointeur'], authorized_societies=['Fictive'], is_active=True).returning(User.id)).scalar_one()
        site = db.execute(Site.__table__.insert().values(name='Fictive', active=1).returning(Site.id)).scalar_one()
        camera = db.execute(Camera.__table__.insert().values(
            name='Fictive', manufacturer='Fictive', model='Fictive', adapter='DAHUA', society='Fictive',
            site_id=site, host='camera.example.invalid', active=False, facial_attendance_enabled=False).returning(Camera.id)).scalar_one()
        db.execute(FacialDeviceAuthorization.__table__.insert().values(user_id=user, camera_id=camera))


def test_join_graph_has_one_head_and_preserves_both_parents():
    script = ScriptDirectory.from_config(Config(str(REPO / 'alembic.ini')))
    assert script.get_heads() == ['20261024_0001']
    assert script.get_revision('20261024_0001').down_revision == '20261023_0001'
    assert set(script.get_revision('20261023_0001').down_revision) == {'20261022_0001', '20261017_0003'}
    assert set(script.get_revision('20261022_0001').down_revision) == {'20261021_0001', '20261017_0002'}
    assert set(script.get_revision('20261021_0001').down_revision) == {'20261020_0001', '20261016_0002'}
    assert set(script.get_revision('20261020_0001').down_revision) == {'20261019_0001', '20261014_0005'}
    assert set(script.get_revision('20261019_0001').down_revision) == {MERGE, '20261015_0002'}
    assert set(script.get_revision(MERGE).down_revision) == {MAIN, POINTER}
    assert script.get_revision(POINTER).down_revision == '20261014_0001'
    assert script.get_revision(MAIN).down_revision == '20261014_0004'


def test_upgrade_from_populated_current_main_preserves_emploi_and_rollback(pg_database):
    url, engine = pg_database
    baseline = Path(os.getenv('ATLAS_SYNC_MAIN_SOURCE', str(REPO)))
    ok(alembic(url, 'upgrade', MAIN, repo=baseline))
    seed_emploi(engine)
    before = snapshot(engine)
    ok(alembic(url, 'upgrade', MERGE))
    after = snapshot(engine)
    assert set(after) == set(before) | {'facial_device_authorizations'}
    assert {name: after[name] for name in before} == before
    assert revisions(engine) == {MERGE}
    ok(alembic(url, 'upgrade', MERGE))  # Already-applied parents do not replay.
    assert snapshot(engine) == after
    ok(alembic(url, 'downgrade', '20261017_0001@20261014_0001'))  # Facial branch only.
    assert revisions(engine) == {MAIN} and snapshot(engine) == before
    ok(alembic(url, 'upgrade', MERGE))
    assert snapshot(engine) == after


def test_upgrade_from_populated_pointer_and_both_heads_is_lossless(pg_database):
    url, engine = pg_database
    baseline = Path(os.getenv('ATLAS_SYNC_POINTER_SOURCE', str(REPO)))
    ok(alembic(url, 'upgrade', POINTER, repo=baseline))
    seed_pointer(engine)
    before = snapshot(engine)
    # Complete just the missing IRON Emploi branch, preserving the facial marker.
    ok(alembic(url, 'upgrade', MAIN))
    assert revisions(engine) == {MAIN, POINTER}
    assert {name: snapshot(engine)[name] for name in before} == before
    seed_emploi(engine)
    both = snapshot(engine)
    ok(alembic(url, 'upgrade', MERGE))
    assert revisions(engine) == {MERGE} and snapshot(engine) == both
    # Undo just the no-op join: both parent markers and every row remain intact.
    ok(alembic(url, 'downgrade', MAIN))
    assert revisions(engine) == {MAIN, POINTER} and snapshot(engine) == both
    ok(alembic(url, 'upgrade', MERGE))
    assert revisions(engine) == {MERGE} and snapshot(engine) == both
    # A full schema rollback to main must refuse to discard actual grants.
    denied = alembic(url, 'downgrade', '20261017_0001@20261014_0001')
    assert denied.returncode != 0 and 'Downgrade refusé' in denied.stderr
    assert revisions(engine) == {MERGE} and snapshot(engine) == both
    # The historical main image cannot run its startup migrations on this marker.
    if baseline != REPO:
        main_source = Path(os.environ['ATLAS_SYNC_MAIN_SOURCE'])
        old = alembic(url, 'upgrade', 'head', repo=main_source)
        assert old.returncode != 0 and "Can't locate revision" in old.stderr
        assert revisions(engine) == {MERGE} and snapshot(engine) == both
