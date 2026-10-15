"""Erreurs PostgreSQL répétées sans effet métier, relevées dans le journal de production.

1. Signature temps réel : une table absente de la liste surveillée (« prospects ») faisait échouer la
   requête groupée à chaque appel, puis la relecture table par table.
2. Signal de vie de la passerelle SMS : une insertion de la ligne unique à chaque passage, rattrapée
   sur violation de clé primaire.

Les deux cas se mesurent par le nombre d'erreurs remontées par la base (événement « handle_error ») :
il doit être nul en régime normal. Les tests PostgreSQL ne s'exécutent que si ATTENDANCE_PG_URL
désigne une base JETABLE."""
import os
import threading
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, delete, event, select, text
from sqlalchemy.orm import sessionmaker

import app.main as main
from app.modules import recruitment_sms_service as sms
from app.modules.recruitment_sms_models import RecruitmentSMSGateway as Gateway

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pg_only = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")


@contextmanager
def database_errors(engine):
    """Compte les erreurs SQL remontées par la base, et les requêtes exécutées."""
    seen = {"errors": [], "statements": []}

    def on_error(context):
        seen["errors"].append(str(context.original_exception).splitlines()[0])

    def on_execute(conn, cursor, statement, parameters, context, executemany):
        seen["statements"].append(statement)

    event.listen(engine, "handle_error", on_error)
    event.listen(engine, "before_cursor_execute", on_execute)
    try:
        yield seen
    finally:
        event.remove(engine, "handle_error", on_error)
        event.remove(engine, "before_cursor_execute", on_execute)


def _engine():
    return main.SessionLocal.kw["bind"]


def _signature_table_by_table(session_factory, tables):
    """Ancien calcul de repli (une requête par table, erreurs ignorées) : référence du format."""
    parts = []
    with session_factory() as db:
        for table_name in tables:
            try:
                row = db.execute(text(f"SELECT COUNT(*) AS c, MAX(updated_at) AS u, MAX(created_at) AS r FROM {table_name}")).mappings().one()
                parts.append(f"{table_name}:{row['c']}:{row['u'] or ''}:{row['r'] or ''}")
            except Exception:
                db.rollback()
    return "|".join(parts)


@pytest.fixture(autouse=True)
def fresh_tables_cache():
    cache = getattr(main, "_EVENTS_TABLES_CACHE", {})
    cache.clear()
    yield
    cache.clear()


# ── Signature temps réel ──────────────────────────────────────────────────────────────────
def test_events_signature_raises_no_database_error_and_runs_one_query(client):
    main._events_signature()                                    # établit la liste des tables
    with database_errors(_engine()) as seen:
        signature = main._events_signature()
    assert seen["errors"] == []
    assert len([s for s in seen["statements"] if "COUNT(*)" in s]) == 1     # une seule requête groupée
    assert signature


def test_events_signature_keeps_the_previous_format(client):
    tables = main._events_tables_present(main.SessionLocal(), ["employees", "candidates", "table_qui_n_existe_pas", "sites"])
    assert "table_qui_n_existe_pas" not in tables
    with main.SessionLocal() as db:
        present = main._events_tables_present(db, [
            "sgdi_records", "employees", "candidates", "contracts", "generated_contracts", "sites", "assignments",
            "daily_presence", "events", "stock_articles", "stock_movements", "stores", "suppliers", "employee_equipment",
            "material_assignments", "clients", "prospects", "invoices", "payments", "cash_entries", "ops_movements",
            "incidents", "advances", "credit_notes"])
    assert "prospects" not in present
    assert main._events_signature() == _signature_table_by_table(main.SessionLocal, present)


def test_events_signature_recovers_when_the_schema_changes(client):
    main._EVENTS_TABLES_CACHE["tables"] = ["employees", "table_supprimee_entre_temps"]
    assert "|employees:" in main._events_signature()                     # repli : la signature reste servie
    assert "tables" not in main._EVENTS_TABLES_CACHE                    # liste à refaire
    with database_errors(_engine()) as seen:
        main._events_signature()
    assert seen["errors"] == []


def test_events_signature_still_changes_on_write(client, auth_headers):
    before = main._events_signature()
    r = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "PGLOG001", "first_name": "E", "last_name": "Test", "society": "Iron Global Securite",
        "status": "actif", "contract_type": "CDD"})
    assert r.status_code in (200, 201), r.text
    assert main._events_signature() != before


# ── Signal de vie de la passerelle SMS ───────────────────────────────────────────────────
def test_gateway_heartbeat_creates_the_row_once_then_never_raises(db):
    db.execute(delete(Gateway)); db.commit()
    sms.mark_gateway_healthy(db, now=100)                               # première fois : insertion
    with database_errors(_engine()) as seen:
        for now in range(101, 111):
            sms.mark_gateway_healthy(db, now=now)
            sms.gateway_poll(db, "secret-fictif", now=now)
    assert seen["errors"] == []
    assert [(row.id, row.last_seen) for row in db.execute(select(Gateway)).scalars()] == [(1, 110)]


def test_gateway_heartbeat_keeps_working_after_the_row_was_removed(db):
    sms.mark_gateway_healthy(db, now=200)
    db.execute(delete(Gateway)); db.commit()
    sms.gateway_poll(db, "secret-fictif", now=201)
    assert db.execute(select(Gateway.last_seen)).scalars().all() == [201]


# ── PostgreSQL ───────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def PgSession():
    if not PG_URL:
        pytest.skip("ATTENDANCE_PG_URL non défini")
    from app.db.base import Base

    engine = create_engine(PG_URL, pool_size=12, max_overflow=0)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


@pg_only
def test_events_signature_on_postgres_raises_no_error(PgSession, monkeypatch):
    monkeypatch.setattr(main, "SessionLocal", PgSession)
    main._events_signature()
    with database_errors(PgSession.kw["bind"]) as seen:
        for _ in range(3):
            main._events_signature()
    assert seen["errors"] == []
    assert len([s for s in seen["statements"] if "COUNT(*)" in s]) == 3


@pg_only
def test_concurrent_gateway_heartbeats_on_postgres(PgSession):
    with PgSession() as db:
        db.execute(delete(Gateway)); db.commit()
    barrier, failures = threading.Barrier(10), []

    def beat(now):
        barrier.wait()
        try:
            with PgSession() as db:
                sms.mark_gateway_healthy(db, now=now)
        except Exception as exc:  # noqa: BLE001
            failures.append(exc)

    def run(values):
        threads = [threading.Thread(target=beat, args=(value,)) for value in values]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

    with database_errors(PgSession.kw["bind"]) as first:
        run(range(1000, 1010))                                          # table vide : premiers passages simultanés
    assert failures == []
    assert len(first["errors"]) <= 9                                    # au plus une course perdue par appel concurrent
    with PgSession() as db:
        assert db.execute(select(Gateway.id)).scalars().all() == [1]

    with database_errors(PgSession.kw["bind"]) as steady:
        run(range(2000, 2010))                                          # régime normal : la ligne existe
    assert failures == [] and steady["errors"] == []
    with PgSession() as db:
        assert db.execute(select(Gateway.id)).scalars().all() == [1]
        assert 2000 <= db.execute(select(Gateway.last_seen)).scalar_one() <= 2009
