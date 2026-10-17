"""Migration 20261017_0003 (code officiel des sites) : additive, rejouable, aucune valeur déduite ; la descente garde les codes.

Le test PostgreSQL reproduit le schéma de production d'avant la révision (colonne absente) avec un site muni d'un
indicatif radio, puis monte, rejoue, descend et remonte.
"""
import os
import sqlite3
import uuid

import pytest

from tests.test_recruitment_jobs_migration import _alembic

REVISION, PREVIOUS = '20261017_0003', '20261017_0002'
PG_URL = os.getenv('ATTENDANCE_PG_URL')


def test_sqlite_upgrade_is_replayable_and_downgrade_keeps_the_codes(tmp_path):
    path = tmp_path / 'sites.sqlite'
    url = f'sqlite:///{path}'
    _alembic(url, 'upgrade', REVISION)
    _alembic(url, 'upgrade', REVISION)                                    # rejouable
    with sqlite3.connect(path) as con:
        assert 'official_code' in {row[1] for row in con.execute('PRAGMA table_info(sites)')}
        con.execute("INSERT INTO sites (name, indicatif, official_code, contractual_staff, day_staff, night_staff, weekend_staff, holiday_staff, groups_count, active, created_at) "
                    "VALUES ('HANGAR', 'RACHID (HAROUN-HICHEM)', 'ETP/DF/H01', 0, 0, 0, 0, 0, 0, 1, '2026-10-17')")
    _alembic(url, 'downgrade', PREVIOUS)
    with sqlite3.connect(path) as con:
        assert con.execute('SELECT indicatif, official_code FROM sites').fetchall() == [('RACHID (HAROUN-HICHEM)', 'ETP/DF/H01')]
    _alembic(url, 'upgrade', REVISION)


@pytest.mark.skipif(not PG_URL, reason='Disposable PostgreSQL ATTENDANCE_PG_URL required')
def test_postgresql_upgrade_from_production_schema_keeps_sites_untouched():
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    name = f'atlas_site_code_{uuid.uuid4().hex[:10]}'
    admin = create_engine(PG_URL, isolation_level='AUTOCOMMIT')
    with admin.connect() as con:
        con.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(PG_URL).set(database=name).render_as_string(hide_password=False)
    engine = create_engine(url)
    try:
        _alembic(url, 'upgrade', PREVIOUS)
        with engine.begin() as con:
            con.execute(text('DROP INDEX IF EXISTS ix_sites_official_code'))
            con.execute(text('ALTER TABLE sites DROP COLUMN IF EXISTS official_code'))       # schéma de production d'avant
            con.execute(text("INSERT INTO sites (name, indicatif, contractual_staff, day_staff, night_staff, weekend_staff, holiday_staff, groups_count, active, created_at) "
                             "VALUES ('HANGAR', 'RACHID (HAROUN-HICHEM)', 0, 0, 0, 0, 0, 0, 1, now())"))
        _alembic(url, 'upgrade', 'head')
        _alembic(url, 'upgrade', 'head')
        with engine.connect() as con:
            assert con.execute(text('SELECT name, indicatif, official_code FROM sites')).fetchall() == [('HANGAR', 'RACHID (HAROUN-HICHEM)', None)]
            assert con.execute(text("SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'ix_sites_official_code'")).scalar() == 1
        with engine.begin() as con:
            con.execute(text("UPDATE sites SET official_code = 'ETP/DF/H01'"))
        _alembic(url, 'downgrade', PREVIOUS)
        with engine.connect() as con:
            assert con.execute(text('SELECT official_code FROM sites')).scalar() == 'ETP/DF/H01'      # codes conservés
        _alembic(url, 'upgrade', 'head')
    finally:
        engine.dispose()
        with admin.connect() as con:
            con.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
