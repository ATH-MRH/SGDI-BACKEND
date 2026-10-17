"""Migration 20261017_0002 (convocations) : additive, rejouable ; la descente ne retire que les brouillons.

Le test PostgreSQL reproduit le schéma de production d'avant la révision (colonnes et table absentes), avec un
entretien déjà envoyé, puis monte, rejoue, descend et remonte.
"""
import os
import sqlite3
import uuid

import pytest

from tests.test_recruitment_jobs_migration import _alembic

REVISION, PREVIOUS = '20261017_0002', '20261016_0002'
PG_URL = os.getenv('ATTENDANCE_PG_URL')
NEW_COLUMNS = ('request_id', 'society', 'address', 'map_url', 'contact_details', 'purpose', 'documents_to_bring', 'version', 'sent_at',
               'sent_by', 'viewed_version', 'arrived_at', 'arrived_by', 'assessment')


def test_sqlite_upgrade_is_replayable_and_downgrade_only_removes_drafts(tmp_path):
    path = tmp_path / 'convocations.sqlite'
    url = f'sqlite:///{path}'
    _alembic(url, 'upgrade', REVISION)
    _alembic(url, 'upgrade', REVISION)                                    # rejouable
    with sqlite3.connect(path) as con:
        columns = {row[1] for row in con.execute('PRAGMA table_info(recruitment_interviews)')}
        assert set(NEW_COLUMNS) <= columns
        con.execute("INSERT INTO candidates (first_name, last_name, status, created_at) VALUES ('Essai', 'Migration', 'nouvelle', '2026-01-01')")
        con.execute("INSERT INTO recruitment_applications (candidate_id, request_id, created_at) VALUES (1, 'migration-test', '2026-01-01')")
        for status in ('proposed', 'draft'):
            con.execute("INSERT INTO recruitment_interviews (application_id, starts_at, location, status, version, created_at, updated_at) "
                        f"VALUES (1, '2026-11-02 10:00', 'Siège', '{status}', {1 if status == 'proposed' else 0}, '2026-10-17', '2026-10-17')")
        con.execute("INSERT INTO recruitment_convocation_versions (interview_id, version, token, snapshot, issued_at) "
                    "VALUES (1, 1, 'migration-token-0123456789abcdefghij', '{}', '2026-10-17')")
    _alembic(url, 'downgrade', PREVIOUS)
    with sqlite3.connect(path) as con:
        assert con.execute('SELECT status FROM recruitment_interviews ORDER BY id').fetchall() == [('proposed',)]
        assert con.execute('SELECT COUNT(*) FROM recruitment_convocation_versions').fetchone() == (1,)      # versions envoyées conservées
    _alembic(url, 'upgrade', REVISION)


@pytest.mark.skipif(not PG_URL, reason='Disposable PostgreSQL ATTENDANCE_PG_URL required')
def test_postgresql_upgrade_from_production_schema_keeps_existing_interviews():
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    name = f'atlas_convocations_{uuid.uuid4().hex[:10]}'
    admin = create_engine(PG_URL, isolation_level='AUTOCOMMIT')
    with admin.connect() as con:
        con.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(PG_URL).set(database=name).render_as_string(hide_password=False)
    engine = create_engine(url)
    try:
        _alembic(url, 'upgrade', PREVIOUS)
        with engine.begin() as con:
            # Schéma de production d'avant la révision : ni table des versions, ni colonnes, ni contrainte.
            con.execute(text('DROP TABLE IF EXISTS recruitment_convocation_versions'))
            con.execute(text('ALTER TABLE recruitment_interviews DROP CONSTRAINT IF EXISTS uq_recruitment_interviews_request'))
            for column in NEW_COLUMNS:
                con.execute(text(f'ALTER TABLE recruitment_interviews DROP COLUMN IF EXISTS {column}'))
            con.execute(text("INSERT INTO candidates (first_name, last_name, status, created_at) VALUES ('Essai', 'Migration', 'nouvelle', now())"))
            candidate = con.execute(text('SELECT max(id) FROM candidates')).scalar()
            con.execute(text("INSERT INTO recruitment_applications (candidate_id, request_id, created_at, status, stage, outcome, source) "
                             f"VALUES ({candidate}, 'migration-pg', now(), 'interview', 'convocation', 'pending', 'mobile')"))
            application = con.execute(text('SELECT max(id) FROM recruitment_applications')).scalar()
            con.execute(text("INSERT INTO recruitment_interviews (application_id, starts_at, location, status, confirmed_at, created_at, updated_at) "
                             f"VALUES ({application}, '2026-11-02 10:00', 'Siège', 'confirmed', now(), now(), now())"))
        _alembic(url, 'upgrade', 'head')
        _alembic(url, 'upgrade', 'head')
        with engine.connect() as con:
            assert con.execute(text("SELECT status, version, confirmed_at IS NOT NULL FROM recruitment_interviews")).fetchall() == [('confirmed', 0, True)]
            assert con.execute(text("SELECT to_regclass('recruitment_convocation_versions') IS NOT NULL")).scalar() is True
            assert con.execute(text("SELECT COUNT(*) FROM pg_constraint WHERE conname = 'uq_recruitment_interviews_request'")).scalar() == 1
        with engine.begin() as con:
            con.execute(text("INSERT INTO recruitment_interviews (application_id, starts_at, location, status, version, created_at, updated_at) "
                             f"VALUES ({application}, '2026-11-03 10:00', 'Siège', 'draft', 0, now(), now())"))
        _alembic(url, 'downgrade', PREVIOUS)
        with engine.connect() as con:
            assert con.execute(text('SELECT status FROM recruitment_interviews')).scalars().all() == ['confirmed']
            assert con.execute(text("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'recruitment_interviews' "
                                    "AND column_name = 'arrived_at'")).scalar() == 1                       # colonnes conservées
        _alembic(url, 'upgrade', 'head')
        assert _alembic(url, 'current').split()[:1] == [REVISION]
        _alembic(url, 'downgrade', '20261008_0001')                                                         # descente complète possible
    finally:
        engine.dispose()
        with admin.connect() as con:
            con.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
