"""Transfert DRH V7 : idempotence sous concurrence réelle (verrou de ligne PostgreSQL)."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Disposable PostgreSQL ATTENDANCE_PG_URL required")


def test_parallel_transfers_and_hires_produce_one_transfer_and_one_employee():
    import app.main  # noqa: F401 (enregistre tous les modèles)
    from app.db.base import Base
    from app.modules.auth.models import AuditEvent
    from app.modules.drh import service
    from app.modules.drh.models import Candidate, Employee

    engine = create_engine(URL)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    tag = uuid.uuid4().hex[:10].upper()
    with Session() as db:
        row = Candidate(first_name="Course", last_name=f"V7{tag}", society=f"SOCIETE {tag}", status="nouvelle",
                        desired_position="AGENT", data={"avisDecision": "Favorable"})
        db.add(row); db.commit(); cid = row.id
    actor = SimpleNamespace(id=None, username="RACE")

    def transfer(_):
        with Session() as db:
            return service.transfer_candidate_to_drh(db, cid, actor=actor)["already_transferred"]

    def hire(_):
        with Session() as db:
            return service.recruit_candidate(db, cid, username="RACE").id

    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(pool.map(transfer, range(8)))
        assert outcomes.count(False) == 1 and outcomes.count(True) == 7        # un seul transfert effectif
        with ThreadPoolExecutor(max_workers=6) as pool:
            employees = set(pool.map(hire, range(6)))
        assert len(employees) == 1                                              # jamais deux employés
        with Session() as db:
            assert db.scalar(select(func.count(AuditEvent.id)).where(
                AuditEvent.action == "recruitment.candidate.drh_transfer", AuditEvent.resource_id == str(cid))) == 1
            assert db.scalar(select(func.count(Employee.id)).where(Employee.society == f"SOCIETE {tag}")) == 1
            assert db.get(Candidate, cid).data["drhTransfer"]["key"] == f"candidate-{cid}"
    finally:
        engine.dispose()
