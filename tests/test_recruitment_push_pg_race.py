"""IRON Emploi — file push sur PostgreSQL réel : workers concurrents, arrêt d'un worker, changements pendant un envoi.

SQLite sérialise les écritures et ignore FOR UPDATE ; ces tests ne tournent que si ATTENDANCE_PG_URL pointe vers une
base PostgreSQL JETABLE. Le service Expo est toujours simulé : un ticket accepté n'est jamais une preuve de
réception sur le téléphone.
"""
import os
import threading
import time
import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")

WORKERS = 6


class Stopped(BaseException):
    """Arrêt brutal d'un worker (processus tué, conteneur arrêté) : sa transaction n'est jamais validée."""


@pytest.fixture(scope="module")
def Session():
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(PG_URL, pool_size=WORKERS + 4, max_overflow=0)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


@pytest.fixture(autouse=True)
def push(monkeypatch):
    from app.modules import recruitment_push_worker as worker

    monkeypatch.setenv("RECRUITMENT_PUSH_ENABLED", "true")
    monkeypatch.setattr(worker, "post", lambda *args: pytest.fail("appel réseau réel vers Expo"))
    return worker


def _accepted(batch):
    return {"data": [{"status": "ok", "id": f"ticket-{uuid.uuid4().hex}"} for _ in batch]}


def _space(Session, *, devices=1, notifications=1):
    """Un espace, ses téléphones, et des notifications mises en file pour chacun. Renvoie (espace, [notifications])."""
    from app.modules import recruitment_engage_service as engage
    from app.modules.recruitment_engage_models import RecruitmentPushDevice as Device
    from app.modules.recruitment_jobs_models import RecruitmentCandidateAccount as Account

    tag = uuid.uuid4().hex
    with Session() as db:
        account = Account(phone=f"+2135{int(tag[:12], 16) % 10**8:08d}", first_name="Course", last_name="Push", profile={})
        db.add(account)
        db.flush()
        db.add_all([Device(account_id=account.id, token=f"ExponentPushToken[{tag[:12]}-{i}]", platform="android") for i in range(devices)])
        db.flush()
        ids = [engage.notify(db, account.id, "application", "Candidature", f"Mise à jour {i}").id for i in range(notifications)]
        db.commit()
        return account.id, ids


def _deliveries(Session, notification_ids):
    from app.modules.recruitment_engage_models import RecruitmentPushDelivery as Delivery

    with Session() as db:
        return db.scalars(select(Delivery).where(Delivery.notification_id.in_(notification_ids)).order_by(Delivery.id)).all()


def test_concurrent_workers_never_send_the_same_row(Session, push, monkeypatch):
    """Six workers en même temps sur 250 envois : chacun part une fois, aucun n'est pris par deux workers."""
    _, notifications = _space(Session, devices=250)
    sent, guard, active = [], threading.Lock(), {"now": 0, "max": 0}

    def slow_post(url, batch):
        with guard:
            active["now"] += 1
            active["max"] = max(active["max"], active["now"])
        time.sleep(0.3)                                    # requête lente : les autres workers réservent pendant ce temps
        with guard:
            sent.extend((message["to"], message["data"]["notification_id"]) for message in batch)
            active["now"] -= 1
        return _accepted(batch)

    monkeypatch.setattr(push, "post", slow_post)
    barrier, errors = threading.Barrier(WORKERS), []

    def run():
        try:
            barrier.wait()
            for _ in range(4):
                with Session() as db:
                    push.dispatch(db, notification_ids=notifications)
        except Exception as exc:  # noqa: BLE001 — remonté par l'assertion
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(WORKERS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(60)
    assert errors == [] and not any(thread.is_alive() for thread in threads)
    assert len(sent) == 250 and len(set(sent)) == 250, "chaque envoi exactement une fois"
    assert active["max"] >= 2, "les envois se sont réellement chevauchés"
    rows = _deliveries(Session, notifications)
    assert {(row.state, row.attempts) for row in rows} == {("accepted", 1)}


def test_rows_of_a_stopped_worker_are_taken_over_by_another(Session, push, monkeypatch):
    """Pendant l'envoi d'un worker, ses lignes restent à lui ; s'il s'arrête avant de valider, elles redeviennent
    disponibles sans tentative comptée et un autre worker les envoie."""
    _, notifications = _space(Session, devices=3)
    inside, release, outcome = threading.Event(), threading.Event(), []

    def stuck(url, batch):
        inside.set()
        release.wait(20)
        raise Stopped()

    monkeypatch.setattr(push, "post", stuck)

    def first():
        try:
            with Session() as db:
                push.dispatch(db, notification_ids=notifications)
        except Stopped:
            outcome.append("arrêté")

    thread = threading.Thread(target=first)
    thread.start()
    assert inside.wait(20)
    taken = []
    monkeypatch.setattr(push, "post", lambda url, batch: taken.extend(batch) or _accepted(batch))
    with Session() as db:
        assert push.dispatch(db, notification_ids=notifications) == 0 and taken == [], "lignes réservées : jamais prises deux fois"
    release.set()
    thread.join(20)
    assert outcome == ["arrêté"]
    assert {(row.state, row.attempts) for row in _deliveries(Session, notifications)} == {("pending", 0)}
    with Session() as db:
        assert push.dispatch(db, notification_ids=notifications) == 3
    assert len(taken) == 3
    assert {(row.state, row.attempts) for row in _deliveries(Session, notifications)} == {("accepted", 1)}


@pytest.mark.parametrize("change", ["suppression de l'espace", "désinscription du téléphone", "changement d'espace"])
def test_a_change_during_a_send_waits_for_it_and_nothing_leaves_afterwards(Session, push, monkeypatch, change):
    """Le changement attend la fin de l'envoi en cours (déjà parti, il ne se rappelle pas) ; une fois le changement
    validé, plus rien de cet espace ne part vers ce téléphone."""
    from app.modules import recruitment_jobs_service as jobs
    from app.modules.recruitment_engage_models import RecruitmentPushDevice as Device
    from app.modules.recruitment_jobs_models import RecruitmentCandidateAccount as Account

    account_id, (current, later) = _space(Session, notifications=2)
    other_id, _ = _space(Session, devices=0, notifications=0) if change == "changement d'espace" else (None, [])
    inside, release, done = threading.Event(), threading.Event(), threading.Event()

    def holding(url, batch):
        inside.set()
        release.wait(20)
        return _accepted(batch)

    monkeypatch.setattr(push, "post", holding)

    def send():
        with Session() as db:
            push.dispatch(db, notification_ids=[current])

    def apply_change():
        with Session() as db:
            if change == "suppression de l'espace":
                jobs.delete_account(db, db.get(Account, account_id))
            elif change == "désinscription du téléphone":
                for device in db.scalars(select(Device).where(Device.account_id == account_id)).all():
                    db.delete(device)
                db.commit()
            else:
                for device in db.scalars(select(Device).where(Device.account_id == account_id)).all():
                    device.account_id = other_id
                db.commit()
        done.set()

    sender = threading.Thread(target=send)
    sender.start()
    assert inside.wait(20)
    changer = threading.Thread(target=apply_change)
    changer.start()
    time.sleep(1.0)
    assert not done.is_set(), "le changement attend la fin de l'envoi en cours"
    release.set()
    sender.join(20)
    changer.join(20)
    assert done.is_set()
    monkeypatch.setattr(push, "post", lambda *args: pytest.fail(f"{change} : envoi après le changement"))
    with Session() as db:
        assert push.dispatch(db, notification_ids=[later]) == 0
    remaining = _deliveries(Session, [later])
    if change == "suppression de l'espace":
        assert remaining == []                                                   # partie avec les notifications
    else:
        assert [row.state for row in remaining] == ["skipped"]
