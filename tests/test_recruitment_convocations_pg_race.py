"""IRON Emploi — convocations sur PostgreSQL réel : double clic, envois et arrivées simultanés.

SQLite sérialise les écritures ; ces tests ne tournent que si ATTENDANCE_PG_URL pointe vers une base PostgreSQL JETABLE.
Aucun envoi réel : le push reste désactivé et aucun e-mail n'est demandé.
"""
import os
import threading
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from tests.test_recruitment_jobs_pg_race import _space, pg  # noqa: F401 — même base, même client

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")
PARALLEL = 10
STAFF = "/api/drh/job-offers"


def _recruiter(client, Session, society):
    from app.core.security import hash_password
    from app.modules.auth.models import User

    username = f"rec_race_{uuid.uuid4().hex[:6]}"
    with Session() as db:
        db.add(User(username=username, email=f"{username}@test.com", full_name=username, role="recruteur", access_level="H3",
                    authorized_societies=[society], authorized_structures=[], authorized_modules=["recrute"],
                    password_hash=hash_password("testpass123"), validation_password_hash=hash_password("x"), is_active=True))
        db.commit()
    reply = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert reply.status_code == 200, reply.text
    return {"Authorization": "Bearer " + reply.json()["access_token"]}


def _application(client, Session):
    from app.modules.recruitment_jobs_models import RecruitmentCompany, RecruitmentJobOffer

    headers, account_id, offer_id = _space(Session)
    reply = client.post("/api/public/emploi/applications", headers=headers,
                        json={"offer_id": offer_id, "request_id": uuid.uuid4().hex[:16], "consent": True, "profile": {"wilaya": "Alger"}})
    assert reply.status_code == 201, reply.text
    with Session() as db:
        society = db.get(RecruitmentCompany, db.get(RecruitmentJobOffer, offer_id).company_id).society
    return reply.json()["application_id"], account_id, _recruiter(client, Session, society)


def _fire(action):
    barrier, replies = threading.Barrier(PARALLEL), []

    def run(i):
        barrier.wait()
        replies.append(action(i))

    threads = [threading.Thread(target=run, args=(i,)) for i in range(PARALLEL)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(60)
    return replies


def _when(**delta):
    from app.modules import recruitment_engage_service as engage

    return (engage.now_local() + timedelta(**delta)).replace(second=0, microsecond=0).isoformat()


def _count(Session, model, *where):
    with Session() as db:
        return db.scalar(select(func.count()).select_from(model).where(*where))


def test_double_click_creates_a_single_convocation_and_a_single_notification(pg):
    from app.modules.recruitment_engage_models import RecruitmentConvocationVersion, RecruitmentInterview, RecruitmentNotification

    client, Session = pg
    application_id, account_id, staff = _application(client, Session)
    body = {"starts_at": _when(days=2), "location": "Siège", "request_id": "double-clic-convocation-01"}
    replies = _fire(lambda i: client.post(f"{STAFF}/applications/{application_id}/interviews", headers=staff, json=body))
    assert {reply.status_code for reply in replies} == {201}, [reply.text for reply in replies]
    assert len({reply.json()["interview_id"] for reply in replies}) == 1
    interview_id = replies[0].json()["interview_id"]
    assert _count(Session, RecruitmentInterview, RecruitmentInterview.application_id == application_id) == 1
    assert _count(Session, RecruitmentConvocationVersion, RecruitmentConvocationVersion.interview_id == interview_id) == 1
    assert _count(Session, RecruitmentNotification, RecruitmentNotification.interview_id == interview_id) == 1


def test_parallel_sends_of_one_draft_issue_one_version(pg):
    from app.modules.recruitment_engage_models import RecruitmentConvocationVersion, RecruitmentNotification

    client, Session = pg
    application_id, account_id, staff = _application(client, Session)
    draft = client.post(f"{STAFF}/applications/{application_id}/interviews", headers=staff,
                        json={"starts_at": _when(days=3), "location": "Siège", "mode": "draft"})
    interview_id = draft.json()["interview_id"]
    replies = _fire(lambda i: client.post(f"{STAFF}/interviews/{interview_id}/send", headers=staff))
    assert {reply.status_code for reply in replies} == {200}, [reply.text for reply in replies]
    assert sum(reply.json()["channels"] == ["Convocation déjà envoyée."] for reply in replies) == PARALLEL - 1
    assert _count(Session, RecruitmentConvocationVersion, RecruitmentConvocationVersion.interview_id == interview_id) == 1
    assert _count(Session, RecruitmentNotification, RecruitmentNotification.interview_id == interview_id) == 1


def test_parallel_arrival_confirmations_record_one_arrival(pg):
    from app.modules import recruitment_engage_service as engage
    from app.modules.recruitment_engage_models import RecruitmentApplicationEvent, RecruitmentInterview

    client, Session = pg
    application_id, account_id, staff = _application(client, Session)
    later = engage.now_local() + timedelta(minutes=30)
    if later.date() != engage.now_local().date():
        pytest.skip("fin de journée : un entretien « aujourd’hui » n’est plus possible")
    sent = client.post(f"{STAFF}/applications/{application_id}/interviews", headers=staff,
                       json={"starts_at": later.replace(second=0, microsecond=0).isoformat(), "location": "Siège"})
    interview_id = sent.json()["interview_id"]
    replies = _fire(lambda i: client.post(f"{STAFF}/interviews/{interview_id}/arrival", headers=staff, json={"version": 1}))
    assert {reply.status_code for reply in replies} == {200}, [reply.text for reply in replies]
    with Session() as db:
        row = db.get(RecruitmentInterview, interview_id)
        assert row.arrived_at is not None and row.status == "proposed"
        assert db.scalar(select(func.count()).select_from(RecruitmentApplicationEvent).where(
            RecruitmentApplicationEvent.application_id == application_id, RecruitmentApplicationEvent.summary.like("Arrivée du candidat%"))) == 1


def test_postponement_racing_an_arrival_never_validates_the_old_date(pg):
    from app.modules.recruitment_engage_models import RecruitmentInterview

    client, Session = pg
    application_id, account_id, staff = _application(client, Session)
    from app.modules import recruitment_engage_service as engage
    later = engage.now_local() + timedelta(minutes=40)
    if later.date() != engage.now_local().date():
        pytest.skip("fin de journée : un entretien « aujourd’hui » n’est plus possible")
    interview_id = client.post(f"{STAFF}/applications/{application_id}/interviews", headers=staff,
                               json={"starts_at": later.replace(second=0, microsecond=0).isoformat(), "location": "Siège"}).json()["interview_id"]
    replies = _fire(lambda i: client.put(f"{STAFF}/interviews/{interview_id}", headers=staff, json={"starts_at": _when(days=4), "location": "Siège"})
                    if i % 2 else client.post(f"{STAFF}/interviews/{interview_id}/arrival", headers=staff, json={"version": 1}))
    assert {reply.status_code for reply in replies} <= {200, 409}, [reply.text for reply in replies]
    with Session() as db:
        row = db.get(RecruitmentInterview, interview_id)
        # Reporté en dernier : l'arrivée éventuelle sur l'ancienne date est effacée avec elle, jamais reportée sur la nouvelle.
        assert row.version >= 2 and row.arrived_at is None
