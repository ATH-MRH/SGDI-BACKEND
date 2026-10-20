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


# Lot 0 : synchroniser les requêtes après la recherche initiale de la pièce,
# avant le verrou de clé. Cette fenêtre existe avec de vrais rejeux réseau.
@pytest.mark.parametrize("amount", [100, 1190])
def test_parallel_replay_of_same_payment_is_idempotent(pg_sessionmaker, monkeypatch, amount):
    from app.modules.finance_models import CashEntry, Payment
    from app.modules.irongs import sql_bridge

    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    payment_id = f"replay_{uuid.uuid4().hex}"
    barrier = threading.Barrier(PARALLEL)
    serialize = sql_bridge._serialize

    def synchronized_serialize(db, key):
        barrier.wait(timeout=15)
        return serialize(db, key)

    monkeypatch.setattr(sql_bridge, "_serialize", synchronized_serialize)

    def replay(_i):
        with pg_sessionmaker() as db:
            saved = sql_bridge.upsert_finance(db, Payment, {
                "id": payment_id, "factureId": invoice_id, "montant": amount,
                "date": "2026-10-10", "mode": "Espèces",
            }, "paiements")
            db.commit()
            return saved

    results, errors = _race(replay)
    # Vérifier aussi l'absence de double encaissement même si des rejeux échouent.
    with pg_sessionmaker() as db:
        payments = db.execute(select(Payment).where(Payment.external_id == payment_id)).scalars().all()
        cash = db.execute(select(CashEntry).where(CashEntry.external_id == f"cs_{payment_id}")).scalars().all()
        assert len(payments) == len(cash) == 1
        assert payments[0].amount == cash[0].amount == amount
    assert errors == [None] * PARALLEL, errors
    assert {r["id"] for r in results} == {payment_id}


def test_pg_rounding_credit_remainder_and_advance_replay(pg_sessionmaker):
    from app.modules.finance_models import Advance, CashEntry, Payment
    from app.modules.irongs import sql_bridge

    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    payment = _settle(pg_sessionmaker, "paiements", invoice_id, "100,005")
    assert payment["montant"] == 100.01
    credit = _settle(pg_sessionmaker, "avoirs", invoice_id, "89,99")
    assert credit["montant"] == 89.99
    assert _settle(pg_sessionmaker, "paiements", invoice_id, 1000)["montant"] == 1000
    with pytest.raises(HTTPException) as exc:
        _settle(pg_sessionmaker, "paiements", invoice_id, "0,01")
    assert exc.value.status_code == 409
    with pg_sessionmaker() as db:
        assert sql_bridge.upsert_finance(db, Payment, payment, "paiements")["id"] == payment["id"]
        db.commit()
    advance = {"id": f"advance_{uuid.uuid4().hex}", "societe": SOC,
               "client": "CLIENT FICTIF LOT 0", "montant": "10,005", "mode": "Espèces"}
    for _ in range(2):
        with pg_sessionmaker() as db:
            assert sql_bridge.upsert_finance(db, Advance, advance, "avances")["montant"] == 10.01
            db.commit()
    with pg_sessionmaker() as db:
        cash = db.execute(select(CashEntry).where(CashEntry.external_id == f"cs_{advance['id']}")).scalars().all()
        assert len(cash) == 1 and cash[0].amount == 10.01


def test_pg_rollback_removes_payment_and_linked_cash(pg_sessionmaker):
    from app.modules.finance_models import CashEntry, Payment
    from app.modules.irongs import sql_bridge

    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    payment_id = f"rollback_{uuid.uuid4().hex}"
    with pg_sessionmaker() as db:
        sql_bridge.upsert_finance(db, Payment, {"id": payment_id, "factureId": invoice_id,
            "montant": 20, "mode": "Espèces"}, "paiements")
        db.rollback()
    with pg_sessionmaker() as db:
        assert db.execute(select(Payment).where(Payment.external_id == payment_id)).first() is None
        assert db.execute(select(CashEntry).where(CashEntry.external_id == f"cs_{payment_id}")).first() is None


@pytest.mark.parametrize("change", [{"montant": 101}, {"mode": "Virement"},
    {"reference": "AUTRE"}, {"date": "2026-10-11"}, {"notes": "AUTRE"}, {"factureId": "different"}])
def test_pg_payment_key_rejects_different_content(pg_sessionmaker, change):
    from app.modules.finance_models import Payment
    from app.modules.irongs import sql_bridge

    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    first = _settle(pg_sessionmaker, "paiements", invoice_id, 100)
    with pg_sessionmaker() as db:
        with pytest.raises(HTTPException) as exc:
            sql_bridge.upsert_finance(db, Payment, {**first, **change}, "paiements")
        assert exc.value.status_code == 409


def test_pg_api_parallel_replay_permissions_and_scope(pg_sessionmaker):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.db.session import get_db
    from app.core.security import create_access_token
    from app.modules.auth.models import User
    from app.modules.finance_models import CashEntry, Payment

    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    def headers(societies, actions):
        with pg_sessionmaker() as db:
            user = User(username=f"lot0_{uuid.uuid4().hex}", full_name="TEST LOT 0",
                role="ops", access_level="H3", authorized_modules=["fac"],
                authorized_societies=societies, authorized_actions=actions,
                authorized_sites=[], authorized_structures=[], password_hash="TEST UNUSED", is_active=True)
            db.add(user); db.commit(); db.refresh(user)
            return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}
    allowed = headers([SOC], ["read", "create"])
    denied = headers([SOC], ["read"])
    other = headers(["Sword Corporation"], ["read", "create"])
    def get_test_db():
        with pg_sessionmaker() as db:
            yield db
    saved_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = get_test_db
    data = {"id": f"http_{uuid.uuid4().hex}", "factureId": invoice_id,
            "montant": 100, "mode": "Espèces", "date": "2026-10-10"}
    url = "/api/irongs/collections/paiements/items"
    try:
        with TestClient(app) as http:
            responses, errors = _race(lambda _i: http.post(url, json={"data": data}, headers=allowed))
            assert errors == [None] * PARALLEL, errors
            assert [r.status_code for r in responses] == [200] * PARALLEL
            assert all(r.json() == responses[0].json() for r in responses)
            assert http.post(url, json={"data": data}, headers=allowed).json() == responses[0].json()
            assert http.post(url, json={"data": {**data, "mode": "Virement"}}, headers=allowed).status_code == 409
            assert http.post(url, json={"data": data}, headers=denied).status_code == 403
            assert http.post(url, json={"data": {**data, "societe": "Sword Corporation"}}, headers=other).status_code == 403
        with pg_sessionmaker() as db:
            assert len(db.execute(select(Payment).where(Payment.external_id == data["id"])).scalars().all()) == 1
            assert len(db.execute(select(CashEntry).where(CashEntry.external_id == f"cs_{data['id']}")).scalars().all()) == 1
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved_overrides)


@pytest.mark.parametrize("unrelated", [False, True])
def test_pg_expected_unique_conflict_is_recovered_only_for_payment_key(pg_sessionmaker, monkeypatch, unrelated):
    from sqlalchemy.exc import IntegrityError
    from app.modules.finance_models import CashEntry, Payment
    from app.modules.irongs import sql_bridge

    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    item = {"id": f"legacy_{uuid.uuid4().hex}", "factureId": invoice_id,
            "montant": 100, "mode": "Espèces", "date": "2026-10-10"}
    original = sql_bridge._upsert_finance
    def writer(db, model, data, collection, *, internal=False):
        if model is not Payment:
            return original(db, model, data, collection, internal=internal)
        # Simule un writer ancien sans verrou de clé, validé après notre recherche.
        with pg_sessionmaker() as legacy_db:
            original(legacy_db, Payment, item, "paiements")
            legacy_db.commit()
        if unrelated:
            db.add(CashEntry(external_id=f"cs_{item['id']}"))
        else:
            db.add(Payment(external_id=item["id"]))
        db.flush()  # vraie violation d'unicité PostgreSQL
    monkeypatch.setattr(sql_bridge, "_upsert_finance", writer)
    with pg_sessionmaker() as db:
        if unrelated:
            with pytest.raises(IntegrityError):
                sql_bridge.upsert_finance(db, Payment, item, "paiements")
        else:
            assert sql_bridge.upsert_finance(db, Payment, item, "paiements")["id"] == item["id"]
        # Le rollback du savepoint conserve la transaction appelante utilisable.
        assert db.execute(select(Payment).where(Payment.external_id == item["id"])).scalar_one().amount == 100
        assert db.execute(select(CashEntry).where(CashEntry.external_id == f"cs_{item['id']}")).scalar_one().amount == 100
        db.commit()



def test_pg_concurrent_same_key_on_different_invoices_conflicts(pg_sessionmaker):
    from app.modules.finance_models import CashEntry, Payment
    from app.modules.irongs import sql_bridge

    invoices = [_create_draft(pg_sessionmaker) for _ in range(2)]
    for invoice_id in invoices:
        _validate(pg_sessionmaker, invoice_id)
    payment_id = f"collision_{uuid.uuid4().hex}"
    def submit(i):
        with pg_sessionmaker() as db:
            saved = sql_bridge.upsert_finance(db, Payment, {"id": payment_id,
                "factureId": invoices[i % 2], "montant": 100, "mode": "Espèces"}, "paiements")
            db.commit()
            return saved
    results, errors = _race(submit)
    assert len([r for r in results if r]) == PARALLEL // 2
    assert len([e for e in errors if e]) == PARALLEL // 2
    assert all(isinstance(e, HTTPException) and e.status_code == 409 for e in errors if e)
    with pg_sessionmaker() as db:
        assert len(db.execute(select(Payment).where(Payment.external_id == payment_id)).scalars().all()) == 1
        assert len(db.execute(select(CashEntry).where(CashEntry.external_id == f"cs_{payment_id}")).scalars().all()) == 1


def test_pg_payment_backend_id_cannot_rename_another_payment(pg_sessionmaker):
    from app.modules.finance_models import Payment
    from app.modules.irongs import sql_bridge

    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    first = _settle(pg_sessionmaker, "paiements", invoice_id, 100)
    second_id = f"independent_{uuid.uuid4().hex}"
    with pg_sessionmaker() as db:
        first_row = db.execute(select(Payment).where(Payment.external_id == first["id"])).scalar_one()
        second = sql_bridge.upsert_finance(db, Payment, {"id": second_id, "backendId": first_row.id,
            "factureId": invoice_id, "montant": 100, "mode": "Espèces"}, "paiements")
        db.commit()
        assert second["id"] == second_id
        assert db.execute(select(Payment).where(Payment.external_id == first["id"])).scalar_one().amount == 100


# ── Idempotence des autres pièces : avoirs, avances, caisse (et paiements) ────────────────

_MODELS = {"paiements": "Payment", "avoirs": "CreditNote", "avances": "Advance", "caisse": "CashEntry"}


def _piece(collection, piece_id, invoice_id, amount):
    if collection in ("paiements", "avoirs"):
        extra = {"mode": "Espèces"} if collection == "paiements" else {"motif": "Correction fictive"}
        return {"id": piece_id, "factureId": invoice_id, "montant": amount, "date": "2026-10-10", **extra}
    if collection == "avances":
        return {"id": piece_id, "societe": SOC, "client": "CLIENT FICTIF", "montant": amount, "date": "2026-10-10", "mode": "Espèces"}
    return {"id": piece_id, "societe": SOC, "type": "entree", "categorie": "Apport", "libelle": "Apport fictif",
            "montant": amount, "date": "2026-10-10", "mode": "Espèces"}


def _key_barrier(monkeypatch, collection, piece_id, parties=PARALLEL):
    """Synchronise les requêtes juste avant le verrou d'idempotence de CETTE pièce (fenêtre réelle
    d'un rejeu réseau) ; les autres verrous (numérotation des avoirs) ne sont pas retenus."""
    from app.modules.irongs import sql_bridge
    barrier, serialize = threading.Barrier(parties), sql_bridge._serialize
    key = sql_bridge._idempotency_lock(collection, piece_id)

    def synchronized(db, lock_key):
        if lock_key == key:
            barrier.wait(timeout=15)
        return serialize(db, lock_key)

    monkeypatch.setattr(sql_bridge, "_serialize", synchronized)


def _write(Session, collection, item):
    import app.modules.finance_models as fm
    from app.modules.irongs import sql_bridge
    with Session() as db:
        try:
            saved = sql_bridge.upsert_finance(db, getattr(fm, _MODELS[collection]), item, collection, creating=True)
            db.commit()
            return saved
        except Exception:
            db.rollback()
            raise


def _counts(Session, collection, piece_id):
    import app.modules.finance_models as fm
    model = getattr(fm, _MODELS[collection])
    with Session() as db:
        rows = db.execute(select(model).where(model.external_id == piece_id)).scalars().all()
        cash = db.execute(select(fm.CashEntry).where(fm.CashEntry.external_id == f"cs_{piece_id}")).scalars().all()
        return rows, cash


@pytest.mark.parametrize("collection", ["paiements", "avoirs", "avances", "caisse"])
def test_pg_eight_identical_requests_record_one_piece(pg_sessionmaker, monkeypatch, collection):
    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    piece_id = f"same_{collection}_{uuid.uuid4().hex}"
    _key_barrier(monkeypatch, collection, piece_id)
    results, errors = _race(lambda _i: _write(pg_sessionmaker, collection, _piece(collection, piece_id, invoice_id, 100)))
    assert errors == [None] * PARALLEL, errors
    assert {r["id"] for r in results} == {piece_id} and {r["montant"] for r in results} == {100.0}
    rows, cash = _counts(pg_sessionmaker, collection, piece_id)
    assert len(rows) == 1
    # Un seul mouvement associé : caisse pour paiement/avance en espèces ; aucun pour un avoir ;
    # pour la caisse, la pièce est elle-même le mouvement.
    assert len(cash) == {"paiements": 1, "avances": 1, "avoirs": 0, "caisse": 0}[collection]
    if collection == "avoirs":
        assert len({r["numero"] for r in results}) == 1


@pytest.mark.parametrize("collection", ["paiements", "avoirs", "avances", "caisse"])
def test_pg_same_key_different_content_conflicts(pg_sessionmaker, monkeypatch, collection):
    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)
    piece_id = f"diff_{collection}_{uuid.uuid4().hex}"
    _key_barrier(monkeypatch, collection, piece_id)
    results, errors = _race(lambda i: _write(pg_sessionmaker, collection, _piece(collection, piece_id, invoice_id, 10 + i)))
    accepted = [r for r in results if r]
    assert len(accepted) == 1, errors
    assert all(isinstance(e, HTTPException) and e.status_code == 409 for e in errors if e), errors
    rows, cash = _counts(pg_sessionmaker, collection, piece_id)
    assert len(rows) == 1 and rows[0].amount == accepted[0]["montant"]
    assert len(cash) == (1 if collection in ("paiements", "avances") else 0)


@pytest.mark.parametrize("collection", ["paiements", "avoirs", "avances", "caisse"])
def test_pg_distinct_keys_in_parallel_each_recorded_once(pg_sessionmaker, collection):
    invoice_id = _create_draft(pg_sessionmaker)
    _validate(pg_sessionmaker, invoice_id)  # TTC 1190 : 8 × 100 tient dans le reste dû
    ids = [f"distinct_{collection}_{i}_{uuid.uuid4().hex}" for i in range(PARALLEL)]
    results, errors = _race(lambda i: _write(pg_sessionmaker, collection, _piece(collection, ids[i], invoice_id, 100)))
    assert errors == [None] * PARALLEL, errors
    for piece_id in ids:
        rows, cash = _counts(pg_sessionmaker, collection, piece_id)
        assert len(rows) == 1
        assert len(cash) == (1 if collection in ("paiements", "avances") else 0)
    if collection == "avoirs":
        assert len({r["numero"] for r in results}) == PARALLEL
