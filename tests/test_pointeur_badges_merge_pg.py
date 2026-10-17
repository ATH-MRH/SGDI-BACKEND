"""Lossless join from frozen main/Studio Badges and the pre-badges candidate."""
import os
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory

from tests.test_facial_device_authorizations_migration_pg import pg_database  # noqa: F401
from tests.test_pointeur_iron_emploi_merge_pg import alembic, ok, revisions, seed_emploi, seed_pointer, snapshot

REPO = Path(__file__).resolve().parents[1]
MAIN, POINTER, MERGE = '20261015_0002', '20261018_0001', '20261019_0001'
pytestmark = pytest.mark.skipif(not os.getenv('TEST_POSTGRES_ADMIN_URL'), reason='PostgreSQL jetable requis')


def seed_badges(engine):
    from app.modules.auth.models import User, UserFeaturePermission
    from app.modules.drh.models import Employee
    from app.modules.drh.badge_models import BadgeEvent, BadgeTemplate, EmployeeBadge

    with engine.begin() as db:
        user = db.execute(User.__table__.insert().values(username='BADGE-REVIEW', full_name='Fictive',
            role='drh', password_hash='fictive', is_active=True, authorized_modules=['drh'],
            authorized_societies=['Fictive']).returning(User.id)).scalar_one()
        db.execute(UserFeaturePermission.__table__.insert().values(user_id=user, module_key='drh', feature_key='badges', action_key='read'))
        employee = db.execute(Employee.__table__.insert().values(code='BADGE-REVIEW', first_name='Fictive',
            last_name='Employee', society='Fictive', status='actif').returning(Employee.id)).scalar_one()
        template = db.execute(BadgeTemplate.__table__.insert().values(name='Fictive', society='Fictive', width_mm=85.6,
            height_mm=54.0, design={'fictive': True}).returning(BadgeTemplate.id)).scalar_one()
        badge = db.execute(EmployeeBadge.__table__.insert().values(number='FICTIVE-01', employee_id=employee,
            template_id=template, society='Fictive', snapshot={'code': 'BADGE-REVIEW'}, design={'fictive': True},
            width_mm=85.6, height_mm=54.0).returning(EmployeeBadge.id)).scalar_one()
        db.execute(BadgeEvent.__table__.insert().values(action='FICTIVE_REVIEW', badge_id=badge, employee_id=employee,
            template_id=template, user_id=user, society='Fictive'))


def test_graph_preserves_every_parent_and_qualifies_facial_rollback():
    script = ScriptDirectory.from_config(Config(str(REPO / 'alembic.ini')))
    assert script.get_heads() == ['20261023_0001']
    assert set(script.get_revision('20261023_0001').down_revision) == {'20261022_0001', '20261017_0003'}
    assert set(script.get_revision('20261022_0001').down_revision) == {'20261021_0001', '20261017_0002'}
    assert set(script.get_revision('20261021_0001').down_revision) == {'20261020_0001', '20261016_0002'}
    assert set(script.get_revision('20261020_0001').down_revision) == {MERGE, '20261014_0005'}
    assert set(script.get_revision(MERGE).down_revision) == {MAIN, POINTER}
    assert set(script.get_revision(POINTER).down_revision) == {'20261016_0001', '20261017_0001'}
    assert script.get_revision(MAIN).down_revision == '20261015_0001'
    steps = script._downgrade_revs('20261017_0001@20261014_0001', MERGE)
    assert [s.revision.revision for s in steps] == [MERGE, POINTER, '20261017_0001']


def test_upgrade_from_badges_main_preserves_issued_badges_permissions_and_emploi(pg_database):
    url, engine = pg_database
    baseline = Path(os.getenv('ATLAS_BADGES_MAIN_SOURCE', str(REPO)))
    ok(alembic(url, 'upgrade', MAIN, repo=baseline))
    seed_emploi(engine)
    seed_badges(engine)
    before = snapshot(engine)
    ok(alembic(url, 'upgrade', MERGE))
    after = snapshot(engine)
    assert set(after) == set(before) | {'facial_device_authorizations'}
    assert {name: after[name] for name in before} == before
    assert revisions(engine) == {MERGE}
    ok(alembic(url, 'upgrade', MERGE))
    assert snapshot(engine) == after
    # Drop the EMPTY facial table only; issued badges and grants must remain.
    ok(alembic(url, 'downgrade', '20261017_0001@20261014_0001'))
    assert revisions(engine) == {MAIN} and snapshot(engine) == before
    ok(alembic(url, 'upgrade', MERGE))
    assert revisions(engine) == {MERGE} and snapshot(engine) == after


def test_upgrade_from_pointer_and_both_heads_preserves_facial_grants_and_badges(pg_database):
    url, engine = pg_database
    baseline = Path(os.getenv('ATLAS_BADGES_POINTER_SOURCE', str(REPO)))
    ok(alembic(url, 'upgrade', POINTER, repo=baseline))
    seed_pointer(engine)
    seed_emploi(engine)
    before = snapshot(engine)
    ok(alembic(url, 'upgrade', MAIN))
    assert revisions(engine) == {MAIN, POINTER}
    after = snapshot(engine)
    assert {name: after[name] for name in before} == before
    assert set(after) - set(before) == {'badge_templates', 'employee_badges', 'badge_events', 'badge_settings'}
    seed_badges(engine)
    populated = snapshot(engine)
    ok(alembic(url, 'upgrade', MERGE))
    assert revisions(engine) == {MERGE} and snapshot(engine) == populated
    ok(alembic(url, 'downgrade', POINTER))
    assert revisions(engine) == {MAIN, POINTER} and snapshot(engine) == populated
    ok(alembic(url, 'upgrade', MERGE))
    denied = alembic(url, 'downgrade', '20261017_0001@20261014_0001')
    assert denied.returncode != 0 and 'Downgrade refusé' in denied.stderr
    assert revisions(engine) == {MERGE} and snapshot(engine) == populated
    if baseline != REPO:
        main = Path(os.environ['ATLAS_BADGES_MAIN_SOURCE'])
        old = alembic(url, 'upgrade', 'head', repo=main)
        assert old.returncode != 0 and "Can't locate revision" in old.stdout + old.stderr
        assert revisions(engine) == {MERGE} and snapshot(engine) == populated
