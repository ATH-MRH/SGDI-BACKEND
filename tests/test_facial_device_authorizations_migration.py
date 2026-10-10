"""Migration additive des autorisations d'équipements faciaux : aucune ligne existante touchée."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

VERSIONS = Path(__file__).resolve().parents[1] / "migrations/versions"


def _module():
    spec = importlib.util.spec_from_file_location("facial_device_auth_migration", VERSIONS / "20261012_0001_facial_device_authorizations.py")
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
    revisions, parents = set(), set()
    for file in VERSIONS.glob("*.py"):
        text = file.read_text()
        for line in text.splitlines():
            if line.startswith("revision = "):
                revisions.add(line.split("=", 1)[1].strip().strip("\"'"))
            if line.startswith("down_revision = "):
                parents.add(line.split("=", 1)[1].strip().strip("\"'"))
    assert revisions - parents == {module.revision} and module.down_revision == "20261011_0001"
