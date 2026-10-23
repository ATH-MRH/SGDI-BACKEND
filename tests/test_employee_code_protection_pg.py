"""Protection des matricules sous concurrence réelle PostgreSQL (verrous consultatifs)."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Disposable PostgreSQL ATTENDANCE_PG_URL required")


def test_parallel_repair_and_code_changes_never_collide():
    import app.main  # noqa: F401 (enregistre tous les modèles)
    from app.db.base import Base
    from app.modules.auth.models import AuditEvent
    from app.modules.drh import employee_code_policy as policy
    from app.modules.drh.models import Employee

    engine = create_engine(URL)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    tag = uuid.uuid4().hex[:8].upper()
    actor = SimpleNamespace(id=None, username="RACE")
    try:
        with Session() as db:
            protected = Employee(code=f"P{tag}", first_name="FIGE", last_name=f"OFFICIEL{tag}", society=f"SOC {tag}",
                                 extra={"matriculeOfficiel": policy.protection_record(f"P{tag}", source="import_excel", by="test")})
            loose = [Employee(code=f"L{tag}{i}", first_name="LIBRE", last_name=f"HORS{tag}{i}", society=f"SOC {tag}") for i in range(3)]
            db.add_all([protected, *loose])
            db.commit()
            protected_id, loose_ids = protected.id, [row.id for row in loose]
            plan = policy.repair_plan(db)

        def confirm(_):
            with Session() as db:
                return policy.apply_repair(db, plan["plan_id"], actor=actor)["already_processed"]

        with ThreadPoolExecutor(max_workers=4) as pool:
            outcomes = list(pool.map(confirm, range(4)))
        assert outcomes.count(False) == 1 and outcomes.count(True) == 3          # appliqué une seule fois
        with Session() as db:
            assert db.get(Employee, protected_id).code == f"P{tag}"
            assert db.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.action == policy.REPAIR_AUDIT,
                                                                     AuditEvent.resource_id == plan["plan_id"])) == 1
            codes = db.scalars(select(Employee.code)).all()
            assert len(codes) == len(set(codes))

        target = f"T{tag}"

        def change(employee_id):
            with Session() as db:
                try:
                    policy.change_code(db, db.get(Employee, employee_id), target, "Course concurrente", actor=actor)
                    return "ok"
                except HTTPException as exc:
                    return exc.status_code

        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(change, loose_ids))
        assert results.count("ok") == 1 and results.count(409) == 2              # un seul obtient le matricule
        with Session() as db:
            assert db.scalar(select(func.count(Employee.id)).where(Employee.code == target)) == 1
    finally:
        engine.dispose()
