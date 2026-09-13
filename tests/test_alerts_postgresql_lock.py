"""Verrou consultatif PostgreSQL de l'orchestrateur alertes — validé contre un
VRAI PostgreSQL local jetable (jamais la base sgdi partagée, jamais la
production). Le reste de la suite tourne sur SQLite (voir tests/conftest.py),
où `_acquire_lock()` renvoie toujours True sans même tenter un verrou — ce
fichier est la SEULE couverture automatisée du chemin PostgreSQL réel de ce
mécanisme, exécutée dans un module Python indépendant qui redirige
temporairement (monkeypatch) app.modules.alerts.scheduler.engine/SessionLocal
vers une base Postgres jetable dédiée, sans toucher au binding SQLite du
reste de la suite.

Ignoré silencieusement (skip) si aucun PostgreSQL local n'est joignable.
"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

PG_HOST = os.environ.get("ALERTS_TEST_PG_HOST", "/tmp")
PG_USER = os.environ.get("ALERTS_TEST_PG_USER") or os.environ.get("USER") or "postgres"
PG_ADMIN_URL = f"postgresql+psycopg2://{PG_USER}@/postgres?host={PG_HOST}"


def _pg_available() -> bool:
    try:
        engine = create_engine(PG_ADMIN_URL)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _pg_available(),
    reason="PostgreSQL local indisponible : ce test ne compte que sur un vrai PostgreSQL, jamais SQLite.",
)


@pytest.fixture
def disposable_pg_url():
    """Base PostgreSQL jetable, nom unique, jamais la base sgdi partagée ; DROP
    garanti même si le test échoue."""
    admin_engine = create_engine(PG_ADMIN_URL, isolation_level="AUTOCOMMIT")
    dbname = f"alerts06a_locktest_{uuid.uuid4().hex[:12]}"
    with admin_engine.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{dbname}"'))
    url = f"postgresql+psycopg2://{PG_USER}@/{dbname}?host={PG_HOST}"
    try:
        yield url
    finally:
        with admin_engine.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)'))
        admin_engine.dispose()


@pytest.fixture
def scheduler_on_real_pg(disposable_pg_url, monkeypatch):
    """Redirige app.modules.alerts.scheduler vers le PostgreSQL jetable, sans
    toucher app.db.session (qui reste lié à SQLite pour le reste de la suite)."""
    import app.modules.alerts.scheduler as scheduler_module

    pg_engine = create_engine(disposable_pg_url, future=True)
    pg_session_local = sessionmaker(bind=pg_engine, autoflush=False, autocommit=False, future=True)
    monkeypatch.setattr(scheduler_module, "engine", pg_engine)
    monkeypatch.setattr(scheduler_module, "SessionLocal", pg_session_local)
    monkeypatch.setattr(scheduler_module, "_lock_conn", None)
    monkeypatch.setattr(scheduler_module, "_scheduler_task", None)
    assert pg_engine.dialect.name == "postgresql"
    try:
        yield scheduler_module, pg_engine
    finally:
        pg_engine.dispose()


def _raw_advisory_lock(engine, key, *, try_lock=True):
    conn = engine.connect()
    fn = "pg_try_advisory_lock" if try_lock else "pg_advisory_lock"
    got = conn.execute(text(f"SELECT {fn}(:k)"), {"k": key}).scalar()
    return conn, got


def test_instance_b_fails_closed_while_instance_a_holds_the_lock(scheduler_on_real_pg):
    scheduler_module, pg_engine = scheduler_on_real_pg

    # -- Instance A : connexion INDÉPENDANTE (simule un autre process/worker), obtient le verrou.
    conn_a, got_a = _raw_advisory_lock(pg_engine, scheduler_module._LOCK_KEY)
    try:
        assert got_a is True

        # -- Instance B : le mécanisme réel du scheduler tente le MÊME verrou.
        acquired_b = scheduler_module._acquire_lock()
        assert acquired_b is False, "B ne doit PAS obtenir le verrou tant que A le détient"
        assert scheduler_module._lock_conn is None, "aucune connexion dédiée gardée par B en cas d'échec"

        # -- start_scheduler() doit refuser de démarrer B (fail-closed) sans jamais
        # toucher asyncio (pas besoin d'event loop ici : le retour est anticipé).
        detector_calls = []
        scheduler_module.run_all_detectors = lambda: detector_calls.append(1) or {}
        scheduler_module.start_scheduler()
        assert scheduler_module._scheduler_task is None, "B ne doit lancer aucune boucle tant que le verrou est pris"
        assert detector_calls == [], "B ne doit exécuter aucun détecteur : le verrou n'a jamais été obtenu"
    finally:
        conn_a.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": scheduler_module._LOCK_KEY})
        conn_a.close()


def test_instance_b_acquires_lock_after_instance_a_releases(scheduler_on_real_pg):
    scheduler_module, pg_engine = scheduler_on_real_pg
    conn_a, got_a = _raw_advisory_lock(pg_engine, scheduler_module._LOCK_KEY)
    assert got_a is True

    assert scheduler_module._acquire_lock() is False  # A détient toujours le verrou

    # -- A libère explicitement (pg_advisory_unlock, déterministe — pas seulement
    # une fermeture de connexion dont le timing serait moins garanti).
    released = conn_a.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": scheduler_module._LOCK_KEY}).scalar()
    assert released is True
    conn_a.close()

    # -- B retente : doit maintenant réussir.
    acquired_b = scheduler_module._acquire_lock()
    assert acquired_b is True, "après libération par A, un nouvel essai de B doit réussir"
    assert scheduler_module._lock_conn is not None, "une connexion dédiée doit être conservée au succès"
    dedicated_conn = scheduler_module._lock_conn
    assert dedicated_conn is not conn_a, "la connexion de verrouillage doit être distincte de celle d'une autre instance"

    scheduler_module.stop_scheduler()


def test_stop_scheduler_releases_the_dedicated_connection(scheduler_on_real_pg):
    scheduler_module, pg_engine = scheduler_on_real_pg
    assert scheduler_module._acquire_lock() is True
    held_conn = scheduler_module._lock_conn
    assert held_conn is not None and not held_conn.closed

    scheduler_module.stop_scheduler()

    assert scheduler_module._lock_conn is None
    assert held_conn.closed, "stop_scheduler() doit fermer la connexion dédiée (et donc libérer le verrou de session)"

    # Preuve la plus forte : une AUTRE connexion peut maintenant obtenir le même verrou.
    probe = pg_engine.connect()
    try:
        got = probe.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": scheduler_module._LOCK_KEY}).scalar()
        assert got is True, "le verrou doit être réellement libéré après stop_scheduler()"
        probe.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": scheduler_module._LOCK_KEY})
    finally:
        probe.close()


def test_lock_error_is_fail_closed_not_fail_open(scheduler_on_real_pg, monkeypatch):
    """Si l'obtention du verrou lève une exception (incident PostgreSQL), le
    scheduler ne doit JAMAIS se comporter comme si le verrou était acquis."""
    scheduler_module, pg_engine = scheduler_on_real_pg

    class _BoomEngine:
        dialect = pg_engine.dialect

        def connect(self):
            raise RuntimeError("incident PostgreSQL simulé")

    monkeypatch.setattr(scheduler_module, "engine", _BoomEngine())
    assert scheduler_module._acquire_lock() is False, "une erreur sur le verrou lui-même doit être fail-closed"
    assert scheduler_module._lock_conn is None
