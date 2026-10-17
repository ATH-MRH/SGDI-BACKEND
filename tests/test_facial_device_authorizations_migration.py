"""Migration additive des autorisations d'équipements faciaux : aucune ligne existante touchée."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

VERSIONS = Path(__file__).resolve().parents[1] / "migrations/versions"


def _module():
    spec = importlib.util.spec_from_file_location("facial_device_auth_migration", VERSIONS / "20261017_0001_facial_device_authorizations.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def test_upgrade_is_additive_idempotent_and_denies_by_default(tmp_path):
    module = _module()
    engine = sa.create_engine("sqlite:///" + str(tmp_path / "legacy.sqlite"))
    with engine.begin() as db:
        db.execute(sa.text("PRAGMA foreign_keys=ON"))
        db.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)"))
        db.execute(sa.text("CREATE TABLE biometric_terminals (id INTEGER PRIMARY KEY, name TEXT, paired_at DATETIME)"))
        db.execute(sa.text("CREATE TABLE cameras (id INTEGER PRIMARY KEY, name TEXT)"))
        db.execute(sa.text("INSERT INTO users VALUES(1,'PTG01')"))
        db.execute(sa.text("INSERT INTO biometric_terminals VALUES(1,'TAB HAMOUL 01','2026-10-03')"))
        db.execute(sa.text("INSERT INTO cameras VALUES(1,'CAM ENTREE')"))
        for _ in range(2):                                          # rejouable sans erreur
            with Operations.context(MigrationContext.configure(db)): module.upgrade()
        # Terminal déjà appairé : appairage conservé, aucune autorisation créée d'office.
        assert db.execute(sa.text("SELECT paired_at FROM biometric_terminals WHERE id=1")).scalar() == "2026-10-03"
        assert db.execute(sa.text("SELECT COUNT(*) FROM facial_device_authorizations")).scalar() == 0
        db.execute(sa.text("INSERT INTO facial_device_authorizations(user_id,terminal_id,created_at) VALUES(1,1,CURRENT_TIMESTAMP)"))
        db.execute(sa.text("INSERT INTO facial_device_authorizations(user_id,camera_id,created_at) VALUES(1,1,CURRENT_TIMESTAMP)"))
        with pytest.raises(sa.exc.IntegrityError):                  # doublon utilisateur × terminal
            with db.begin_nested(): db.execute(sa.text("INSERT INTO facial_device_authorizations(user_id,terminal_id,created_at) VALUES(1,1,CURRENT_TIMESTAMP)"))
        for bad in ("(1,1,1,CURRENT_TIMESTAMP)", "(1,NULL,NULL,CURRENT_TIMESTAMP)"):      # exactement UN équipement
            with pytest.raises(sa.exc.IntegrityError):
                with db.begin_nested(): db.execute(sa.text(f"INSERT INTO facial_device_authorizations(user_id,terminal_id,camera_id,created_at) VALUES{bad}"))
        # Downgrade : refusé tant que des autorisations existent (aucune perte silencieuse)…
        with pytest.raises(RuntimeError, match="Downgrade refusé"):
            with Operations.context(MigrationContext.configure(db)): module.downgrade()
        assert db.execute(sa.text("SELECT COUNT(*) FROM facial_device_authorizations")).scalar() == 2
        # … accepté une fois la table vidée, et rejouable.
        db.execute(sa.text("DELETE FROM facial_device_authorizations"))
        for _ in range(2):
            with Operations.context(MigrationContext.configure(db)): module.downgrade()
        assert not sa.inspect(db).has_table("facial_device_authorizations")
        assert db.execute(sa.text("SELECT COUNT(*) FROM biometric_terminals")).scalar() == 1


def test_revision_extends_the_single_head():
    module = _module()
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(Config(str(VERSIONS.parents[1] / "alembic.ini")))
    assert script.get_heads() == ["20261022_0001"]
    assert set(script.get_revision("20261022_0001").down_revision) == {"20261021_0001", "20261017_0002"}
    assert set(script.get_revision("20261021_0001").down_revision) == {"20261020_0001", "20261016_0002"}
    assert set(script.get_revision("20261020_0001").down_revision) == {"20261019_0001", "20261014_0005"}
    assert set(script.get_revision("20261019_0001").down_revision) == {"20261015_0002", "20261018_0001"}
    assert set(script.get_revision("20261018_0001").down_revision) == {"20261016_0001", module.revision}
    assert module.down_revision == "20261014_0001"



@pytest.mark.parametrize('defect', ['missing_column', 'wrong_type', 'missing_index', 'wrong_index', 'wrong_check', 'wrong_fk', 'missing_unique', 'missing_default'])
def test_existing_incomplete_table_is_rejected_without_modifying_data(tmp_path, defect):
    module = _module()
    engine = sa.create_engine('sqlite:///' + str(tmp_path / 'incomplete.sqlite'))
    with engine.begin() as db:
        for table in ('users', 'biometric_terminals', 'cameras'):
            db.execute(sa.text(f'CREATE TABLE {table} (id INTEGER PRIMARY KEY)'))
        with Operations.context(MigrationContext.configure(db)):
            module.upgrade()
        if defect == 'missing_index':
            db.execute(sa.text('DROP INDEX ix_facial_device_authorizations_user_id'))
        elif defect == 'wrong_index':
            db.execute(sa.text('DROP INDEX ix_facial_device_authorizations_user_id'))
            db.execute(sa.text('CREATE INDEX ix_facial_device_authorizations_user_id ON facial_device_authorizations(camera_id)'))
        else:
            ddl = db.execute(sa.text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:name"), {'name': module.TABLE}).scalar_one()
            changes = {
                'missing_column': ('granted_by VARCHAR(120),', ''),
                'wrong_type': ('granted_by VARCHAR(120)', 'granted_by VARCHAR(20)'),
                'wrong_check': ('(terminal_id IS NULL) <> (camera_id IS NULL)', '1=1'),
                'wrong_fk': ('REFERENCES users (id) ON DELETE CASCADE', 'REFERENCES cameras (id) ON DELETE CASCADE'),
                'missing_unique': ('CONSTRAINT uq_facial_device_auth_user_terminal UNIQUE (user_id, terminal_id),', ''),
                'missing_default': ('DEFAULT (CURRENT_TIMESTAMP)', ''),
            }
            old, new = changes[defect]
            assert old in ddl
            db.execute(sa.text('DROP TABLE facial_device_authorizations'))
            db.execute(sa.text(ddl.replace(old, new)))
            for column in ('user_id', 'terminal_id', 'camera_id'):
                db.execute(sa.text(f'CREATE INDEX ix_facial_device_authorizations_{column} ON facial_device_authorizations({column})'))
        db.execute(sa.text('INSERT INTO facial_device_authorizations(id,user_id,terminal_id,created_at) VALUES(1,1,1,CURRENT_TIMESTAMP)'))
        with pytest.raises(RuntimeError, match='préexistante incompatible'):
            with Operations.context(MigrationContext.configure(db)):
                module.upgrade()
        assert db.execute(sa.text('SELECT count(*) FROM facial_device_authorizations')).scalar_one() == 1
    engine.dispose()
