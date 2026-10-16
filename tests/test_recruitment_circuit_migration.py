"""Montée d'une base existante, rejeu et retour de code sans perte d'instantanés."""
import sqlite3
from tests.test_recruitment_jobs_migration import _alembic


def test_circuit_migration_is_additive_and_replayable(tmp_path):
    path=tmp_path/'circuit.sqlite'
    url=f'sqlite:///{path}'
    previous='20261014_0005'
    revision='20261016_0002'
    _alembic(url,'upgrade',previous)
    # L'initialisation crée les modèles actuels ; retirer les additions pour simuler la production.
    with sqlite3.connect(path) as con:
        con.execute('DROP TABLE IF EXISTS recruitment_push_deliveries')
        con.execute('ALTER TABLE recruitment_applications DROP COLUMN profile_snapshot')
        con.execute("INSERT INTO candidates (first_name,last_name,status,created_at) VALUES ('Essai','Migration','nouvelle','2026-01-01')")
        con.execute("INSERT INTO recruitment_applications (candidate_id,request_id,created_at) VALUES (1,'migration-test','2026-01-01')")
    _alembic(url,'upgrade',revision)
    _alembic(url,'upgrade',revision)
    with sqlite3.connect(path) as con:
        assert con.execute('SELECT profile_snapshot FROM recruitment_applications').fetchone()==(None,)
        con.execute('UPDATE recruitment_applications SET profile_snapshot=?', ('{"first_name":"Essai"}',))
        assert con.execute('SELECT COUNT(*) FROM recruitment_push_deliveries').fetchone()==(0,)
    _alembic(url,'downgrade',previous)
    with sqlite3.connect(path) as con:
        assert con.execute('SELECT profile_snapshot FROM recruitment_applications').fetchone()==('{"first_name":"Essai"}',)
    _alembic(url,'upgrade',revision)
