"""Upgrade an existing terminal table without losing referenced history."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_legacy_upgrade_preserves_history_and_enforces_live_uniqueness(tmp_path):
    engine = sa.create_engine('sqlite:///'+str(tmp_path/'legacy.sqlite'))
    file = Path(__file__).resolve().parents[1]/'migrations/versions/20261008_0001_terminal_soft_delete.py'
    spec = importlib.util.spec_from_file_location('terminal_migration',file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    with engine.begin() as db:
        db.execute(sa.text('CREATE TABLE biometric_terminals (id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, site_id INTEGER, name TEXT, revoked_at DATETIME, CONSTRAINT uq_biometric_terminals_site_name UNIQUE(site_id,name))'))
        db.execute(sa.text("INSERT INTO biometric_terminals VALUES(1,'trm_original',3,'SMARTPHONE HAMOUL 01','2026-10-03')"))
        db.execute(sa.text('CREATE TABLE history (id INTEGER PRIMARY KEY, terminal_id INTEGER REFERENCES biometric_terminals(id), proof TEXT)'))
        db.execute(sa.text("INSERT INTO history VALUES(1,1,'immutable attendance proof')"))
        with Operations.context(MigrationContext.configure(db)): module.upgrade()
        assert db.execute(sa.text('SELECT proof FROM history WHERE terminal_id=1')).scalar() == 'immutable attendance proof'
        assert db.execute(sa.text('SELECT deleted_at FROM biometric_terminals WHERE id=1')).scalar() is None
        with pytest.raises(sa.exc.IntegrityError): db.execute(sa.text("INSERT INTO biometric_terminals(id,public_id,site_id,name) VALUES(2,'trm_new',3,'SMARTPHONE HAMOUL 01')"))
        db.execute(sa.text("UPDATE biometric_terminals SET deleted_at=CURRENT_TIMESTAMP,deleted_by='ADMIN' WHERE id=1"))
        db.execute(sa.text("INSERT INTO biometric_terminals(id,public_id,site_id,name) VALUES(2,'trm_new',3,'SMARTPHONE HAMOUL 01')"))
        with pytest.raises(RuntimeError):
            with Operations.context(MigrationContext.configure(db)): module.downgrade()
        assert db.execute(sa.text('SELECT COUNT(*) FROM biometric_terminals')).scalar() == 2
