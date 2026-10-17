"""Disposable PostgreSQL: full Alembic upgrade, existing schema validation and rollback."""
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url

from tests.test_facial_device_authorizations_migration import _module

pytestmark = pytest.mark.skipif(not os.getenv('TEST_POSTGRES_ADMIN_URL'), reason='PostgreSQL jetable requis')
REPO = Path(__file__).resolve().parents[1]


@pytest.fixture
def pg_database():
    url = make_url(os.environ['TEST_POSTGRES_ADMIN_URL'])
    admin = sa.create_engine(url, isolation_level='AUTOCOMMIT')
    name = 'atlas_facial_migration_' + uuid.uuid4().hex[:12]
    with admin.connect() as db:
        db.execute(sa.text(f'CREATE DATABASE "{name}"'))
    target = url.set(database=name).render_as_string(hide_password=False)
    engine = sa.create_engine(target)
    try:
        yield target, engine
    finally:
        engine.dispose()
        with admin.connect() as db:
            db.execute(sa.text(f'DROP DATABASE "{name}"'))
        admin.dispose()


def alembic(url, *args):
    return subprocess.run([sys.executable, '-m', 'alembic', *args], cwd=REPO,
                          env={**os.environ, 'DATABASE_URL': url, 'APP_ENV': 'test',
                               'JWT_SECRET': 'fictive-facial-migration-test-secret'},
                          capture_output=True, text=True, timeout=120)


def test_full_upgrade_valid_existing_table_and_nonempty_downgrade(pg_database):
    url, engine = pg_database
    main = alembic(url, 'upgrade', '20261015_0002')
    assert main.returncode == 0, main.stdout + main.stderr
    with engine.connect() as db:
        before = set(sa.inspect(db).get_table_names())
    upgrade = alembic(url, 'upgrade', '20261019_0001')
    assert upgrade.returncode == 0, upgrade.stdout + upgrade.stderr
    with engine.begin() as db:
        assert set(sa.inspect(db).get_table_names()) == before | {_module().TABLE}
        _module()._validate_existing(sa.inspect(db))
        # A complete preexisting table is accepted without changing data.
        db.execute(sa.text("UPDATE alembic_version SET version_num='20261015_0002'"))
    again = alembic(url, 'upgrade', '20261019_0001')
    assert again.returncode == 0, again.stdout + again.stderr
    with engine.begin() as db:
        db.execute(sa.text("INSERT INTO users (username,full_name,role,password_hash,is_active,supervisor_read_only,global_society_access,created_at,updated_at) VALUES ('fictive','Fictive','pointeur','fictive',true,true,false,now(),now())"))
        user = db.execute(sa.text("SELECT id FROM users WHERE username='fictive'")).scalar_one()
        from app.modules.biometrics.models import Camera
        from app.modules.ops.models import Site
        site = db.execute(Site.__table__.insert().values(name="Fictive", active=1).returning(Site.id)).scalar_one()
        db.execute(Camera.__table__.insert().values(name="Fictive", manufacturer="Fictive", model="Fictive", site_id=site, society="Fictive", adapter="DAHUA", usage="ATTENDANCE",
                                                    host="camera.example.invalid", active=False, facial_attendance_enabled=False))
        camera = db.execute(sa.text("SELECT id FROM cameras WHERE name='Fictive'")).scalar_one()
        db.execute(sa.text('INSERT INTO facial_device_authorizations(user_id,camera_id) VALUES (:user,:camera)'), {'user': user, 'camera': camera})
    denied = alembic(url, 'downgrade', '20261017_0001@20261014_0001')
    assert denied.returncode != 0 and 'Downgrade refusé' in denied.stderr
    with engine.begin() as db:
        assert db.execute(sa.text('SELECT count(*) FROM facial_device_authorizations')).scalar_one() == 1
        assert db.execute(sa.text('SELECT version_num FROM alembic_version')).scalar_one() == '20261019_0001'
        db.execute(sa.text('DELETE FROM facial_device_authorizations'))
    rollback = alembic(url, 'downgrade', '20261017_0001@20261014_0001')
    assert rollback.returncode == 0, rollback.stdout + rollback.stderr
    with engine.connect() as db:
        assert set(sa.inspect(db).get_table_names()) == before


@pytest.mark.parametrize('ddl', [
    'ALTER TABLE facial_device_authorizations DROP COLUMN granted_by',
    'ALTER TABLE facial_device_authorizations ALTER COLUMN granted_by TYPE varchar(20)',
    'ALTER TABLE facial_device_authorizations ALTER COLUMN user_id DROP NOT NULL',
    'ALTER TABLE facial_device_authorizations DROP CONSTRAINT facial_device_authorizations_user_id_fkey',
    'ALTER TABLE facial_device_authorizations DROP CONSTRAINT uq_facial_device_auth_user_terminal',
    'ALTER TABLE facial_device_authorizations DROP CONSTRAINT ck_facial_device_auth_one_device',
    'DROP INDEX ix_facial_device_authorizations_camera_id',
    'ALTER TABLE facial_device_authorizations ALTER COLUMN created_at DROP DEFAULT',
    'ALTER TABLE facial_device_authorizations ALTER COLUMN id DROP DEFAULT',
    'ALTER TABLE facial_device_authorizations DROP CONSTRAINT ck_facial_device_auth_one_device; '
    'ALTER TABLE facial_device_authorizations ADD CONSTRAINT ck_facial_device_auth_one_device '
    'CHECK ((terminal_id IS NULL) <> (camera_id IS NULL)) NOT VALID',
])
def test_incomplete_table_cannot_advance_alembic_revision(pg_database, ddl):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    url, engine = pg_database
    with engine.begin() as db:
        for name in ('users', 'cameras', 'biometric_terminals'):
            db.execute(sa.text(f'CREATE TABLE {name}(id integer PRIMARY KEY)'))
            db.execute(sa.text(f'INSERT INTO {name} VALUES(1)'))
        db.execute(sa.text("CREATE TABLE alembic_version(version_num varchar(32) PRIMARY KEY)"))
        db.execute(sa.text("INSERT INTO alembic_version VALUES ('20261015_0002')"))
        with Operations.context(MigrationContext.configure(db)):
            _module().upgrade()
        db.execute(sa.text('INSERT INTO facial_device_authorizations(user_id,camera_id) VALUES(1,1)'))
        db.execute(sa.text(ddl))
    # Révision visée : la migration faciale elle-même (les autres branches exigent des tables que
    # cette base minimale n'a pas).
    refused = alembic(url, 'upgrade', '20261017_0001')
    assert refused.returncode != 0 and 'préexistante incompatible' in refused.stderr
    with engine.connect() as db:
        assert db.execute(sa.text('SELECT version_num FROM alembic_version')).scalar_one() == '20261015_0002'
        assert db.execute(sa.text('SELECT count(*) FROM facial_device_authorizations')).scalar_one() == 1
