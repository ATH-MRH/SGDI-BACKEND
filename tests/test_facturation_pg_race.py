"""Facturation — courses réelles sur PostgreSQL (verrous de ligne et verrous consultatifs).

SQLite sérialise les écritures et ne peut pas reproduire ces courses ; ce test s'exécute
uniquement si FACTURATION_PG_URL pointe vers une base PostgreSQL JETABLE, par exemple :
    FACTURATION_PG_URL=postgresql+psycopg2://user@localhost/atlas_fac_race pytest tests/test_facturation_pg_race.py
"""
import os
import threading
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("FACTURATION_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="FACTURATION_PG_URL non défini (base PostgreSQL jetable requise)")

PARALLEL = 8
SOC = "Iron Global Securite"


@pytest.fixture(scope="module")
def pg_sessionmaker():
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(PG_URL, pool_size=PARALLEL + 2, max_overflow=0)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


def _race(fn, count=PARALLEL):
    barrier = threading.Barrier(count)
    results, errors = [None] * count, [None] * count

    def run(index):
        barrier.wait()
        try:
            results[index] = fn(index)
        except Exception as exc:  # noqa: BLE001 — chaque issue est examinée par le test
            errors[index] = exc

    threads = [threading.Thread(target=run, args=(i,)) for i in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    return results, errors


def _create_draft(Session):
    from app.modules.finance_models import Invoice
    from app.modules.irongs import sql_bridge

    item = {"id": f"fc_race_{uuid.uuid4().hex[:10]}", "statut": "brouillon", "societe": SOC, "client": "COURSE",
            "date": "2026-10-01", "lignes": [{"type": "article", "designation": "AGENT", "unite": "Jour", "nbr": 1,
                                             "qte": 1, "prixUnitHT": 1000}]}
    with Session() as db:
        sql_bridge.upsert_finance(db, Invoice, item, "factures")
        db.commit()
    return item["id"]


def _validate(Session, item_id):
    from app.modules.irongs import sql_bridge

    with Session() as db:
        try:
            return sql_bridge.validate_invoice(db, item_id)
        except Exception:
            db.rollback()
            raise


def test_parallel_validations_of_one_draft_give_one_number(pg_sessionmaker):
    item_id = _create_draft(pg_sessionmaker)
    results, errors = _race(lambda _i: _validate(pg_sessionmaker, item_id))
    assert errors == [None] * PARALLEL, errors
    assert len({r["numero"] for r in results}) == 1


def test_parallel_validations_of_distinct_drafts_get_consecutive_numbers(pg_sessionmaker):
    ids = [_create_draft(pg_sessionmaker) for _ in range(PARALLEL)]
    results, errors = _race(lambda i: _validate(pg_sessionmaker, ids[i]))
    assert errors == [None] * PARALLEL, errors
    seqs = sorted(int(r["numero"][3:7]) for r in results)
    assert seqs == list(range(seqs[0], seqs[0] + PARALLEL))


def _settle(Session, model_name, invoice_id, amount):
    from app.modules.finance_models import CreditNote, Payment
    from app.modules.irongs import sql_bridge

    model = Payment if model_name == "paiements" else CreditNote
    item = {"id": f"race_{uuid.uuid4().hex[:10]}", "factureId": invoice_id, "date": "2026-10-10", "montant": amount, "mode": "Espèces"}
    with Session() as db:
        try:
            saved = sql_bridge.upsert_finance(db, model, item, model_name)
            db.commit()
            return saved
        except HTTPException:
            db.rollback()
            raise


def test_parallel_payments_never_exceed_the_invoice_total(pg_sessionmaker):
    from app.modules.finance_models import CashEntry, Payment

    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)  # TTC 1190
    results, errors = _race(lambda _i: _settle(pg_sessionmaker, "paiements", invoice_id, 400))
    accepted = [r for r in results if r]
    assert len(accepted) == 2, errors
    assert all(isinstance(e, HTTPException) and e.status_code == 409 for e in errors if e)
    with pg_sessionmaker() as db:
        amounts = db.execute(select(Payment.amount).where(Payment.invoice_external_id == invoice_id)).scalars().all()
        assert sum(amounts) == 800
        cash = db.execute(select(CashEntry).where(CashEntry.external_id.in_([f"cs_{r['id']}" for r in accepted]))).scalars().all()
        assert len(cash) == 2


def test_parallel_credit_notes_get_distinct_numbers(pg_sessionmaker):
    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    results, errors = _race(lambda _i: _settle(pg_sessionmaker, "avoirs", invoice_id, 10))
    assert errors == [None] * PARALLEL, errors
    numbers = [r["numero"] for r in results]
    assert len(set(numbers)) == PARALLEL
