"""IRON Emploi — envois simultanés réels sur PostgreSQL (verrou de l'espace candidat + contraintes uniques).

SQLite sérialise les écritures et ne peut pas reproduire la course ; ce test s'exécute
uniquement si ATTENDANCE_PG_URL pointe vers une base PostgreSQL JETABLE.
"""
import os
import threading
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")

PARALLEL = 10


@pytest.fixture(scope="module")
def pg():
    from app.db.base import Base
    from app.db.session import get_db
    from app.main import app

    engine = create_engine(PG_URL, pool_size=PARALLEL + 2, max_overflow=0)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def per_request_session():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = per_request_session
    with TestClient(app) as client:
        yield client, Session
    app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def _space(Session, *, published=True):
    """Un espace candidat avec sa session, et une annonce ouverte."""
    from datetime import datetime

    from app.core.config import settings
    from app.modules.recruitment_jobs_models import (
        RecruitmentCandidateAccount, RecruitmentCandidateSession, RecruitmentCompany, RecruitmentJobOffer,
    )
    from app.modules.recruitment_sms_service import digest

    tag, token = uuid.uuid4().hex[:8], uuid.uuid4().hex * 2
    with Session() as db:
        company = RecruitmentCompany(name=f"Race {tag}", society=f"Race {tag}", society_key=f"RACE {tag.upper()}")
        account = RecruitmentCandidateAccount(phone="+2135" + str(uuid.uuid4().int)[:8], first_name="Course", last_name=f"Race{tag}", profile={})
        db.add_all([company, account]); db.flush()
        offer = RecruitmentJobOffer(company_id=company.id, title="Agent", wilaya="Alger", contract_type="CDI", missions="m", profile="p",
                                    status="published" if published else "closed", published_at=datetime.utcnow())
        db.add(offer)
        db.add(RecruitmentCandidateSession(token_digest=digest(settings.jwt_secret, "emploi-session", token), account_id=account.id,
                                           created_at=int(time.time()), expires_at=int(time.time()) + 3600))
        db.commit()
        return {"Authorization": "Bearer " + token}, account.id, offer.id


def _fire(client, headers, body_for):
    barrier, replies = threading.Barrier(PARALLEL), []

    def worker(i):
        barrier.wait()
        replies.append(client.post("/api/public/emploi/applications", headers=headers, json=body_for(i)))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(PARALLEL)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return replies


def _counts(Session, account_id):
    from app.modules.drh.models import Candidate
    from app.modules.recruitment_jobs_models import RecruitmentApplication, RecruitmentCandidateAccount

    with Session() as db:
        account = db.get(RecruitmentCandidateAccount, account_id)
        return (db.scalar(select(func.count()).select_from(RecruitmentApplication).where(RecruitmentApplication.account_id == account_id)),
                db.scalar(select(func.count()).select_from(Candidate).where(Candidate.last_name == account.last_name.upper())))


def test_double_click_same_request_creates_one_application(pg):
    client, Session = pg
    headers, account_id, offer_id = _space(Session)
    replies = _fire(client, headers, lambda i: {"offer_id": offer_id, "request_id": "double-clic-0001", "consent": True})
    assert {reply.status_code for reply in replies} == {201}, [reply.text for reply in replies]
    assert len({reply.json()["application_id"] for reply in replies}) == 1
    assert _counts(Session, account_id) == (1, 1)


def test_parallel_retries_with_new_request_ids_create_one_application_and_one_dossier(pg):
    client, Session = pg
    headers, account_id, offer_id = _space(Session)
    replies = _fire(client, headers, lambda i: {"offer_id": offer_id, "request_id": f"relance-{i:04d}-{uuid.uuid4().hex[:8]}", "consent": True})
    assert sorted(reply.status_code for reply in replies) == [200] * (PARALLEL - 1) + [201], [reply.text for reply in replies]
    assert len({reply.json()["application_id"] for reply in replies}) == 1
    assert _counts(Session, account_id) == (1, 1)


def test_closed_offer_refuses_every_parallel_submission(pg):
    client, Session = pg
    headers, account_id, offer_id = _space(Session, published=False)
    replies = _fire(client, headers, lambda i: {"offer_id": offer_id, "request_id": f"cloture-{i:04d}-{uuid.uuid4().hex[:8]}", "consent": True})
    assert {reply.status_code for reply in replies} == {409}
    assert _counts(Session, account_id) == (0, 0)
