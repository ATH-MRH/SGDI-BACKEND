"""Affectation par ordre de mouvement sur PostgreSQL réel : validations simultanées.

Chaque requête a sa propre session, comme en production. Données fictives uniquement.
"""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Disposable PostgreSQL ATTENDANCE_PG_URL required")

SOC = "Iron Global Solution"
PASSWORD = "testpass123"
ROUTE = "/api/ops/movements/initial-assignment"


@pytest.fixture
def pg():
    from fastapi.testclient import TestClient

    import app.main
    from app.core.security import hash_password
    from app.db.base import Base
    from app.db.session import get_db
    from app.modules.auth.models import User
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Site

    engine = create_engine(URL)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    tag = uuid.uuid4().hex[:10].upper()
    with Session() as db:
        site = Site(name=f"OM PG {tag}", active=1, equipment_plan={"societe": SOC})
        employees = [Employee(code=f"OMPG{i}{tag}", first_name="Test", last_name=f"Concurrence {i}",
                              society=SOC, status="actif") for i in range(3)]
        db.add_all([site, *employees, User(
            username=f"opsom{tag}".lower(), full_name="OPS test", role="ops", access_level="H3",
            authorized_societies=[SOC], authorized_modules=["ops"], authorized_structures=["ops"],
            password_hash=hash_password(PASSWORD), is_active=True)])
        db.commit()
        ids = {"site": site.id, "employees": [(e.id, e.code) for e in employees], "tag": tag}

    def override_get_db():
        with Session() as session:
            yield session

    previous = dict(app.main.app.dependency_overrides)
    app.main.app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app.main.app, raise_server_exceptions=False) as client:
            r = client.post("/api/auth/login", json={"username": f"opsom{tag}".lower(), "password": PASSWORD})
            assert r.status_code == 200, r.text
            yield client, Session, ids, {"Authorization": f"Bearer {r.json()['access_token']}"}
    finally:
        app.main.app.dependency_overrides.clear()
        app.main.app.dependency_overrides.update(previous)
        engine.dispose()


def _body(ids, index, number):
    emp_id, code = ids["employees"][index]
    return {"employee_id": emp_id, "site_id": ids["site"], "effective_date": date.today().isoformat(),
            "agent_ref": code, "group_code": "A", "motif": "Affectation", "movement_number": number}


def _rows(Session, emp_id):
    from app.modules.ops.models import Assignment, OpsMovement
    with Session() as db:
        return (db.query(Assignment).filter(Assignment.employee_id == emp_id, Assignment.active == 1).count(),
                [m.movement_number for m in db.query(OpsMovement).filter(OpsMovement.employee_id == emp_id)])


def test_simultaneous_validations_create_one_order_and_one_assignment(pg):
    client, Session, ids, headers = pg
    number = f"OD/OPS/{date.today().year}/{int(ids['tag'], 16) % 900000 + 100000}"
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _: client.post(ROUTE, headers=headers, json=_body(ids, 0, number)), range(4)))
    codes = sorted(r.status_code for r in responses)
    assert codes == [200, 409, 409, 409], [r.text[:200] for r in responses]
    assert _rows(Session, ids["employees"][0][0]) == (1, [number])


def test_simultaneous_orders_with_the_same_number_get_distinct_numbers(pg):
    client, Session, ids, headers = pg
    number = f"OD/OPS/{date.today().year}/{int(ids['tag'], 16) % 900000 + 100000}"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda i: client.post(ROUTE, headers=headers, json=_body(ids, i + 1, number)), range(2)))
    assert [r.status_code for r in responses] == [200, 200], [r.text[:200] for r in responses]
    numbers = [r.json()["movement"]["ordreMouvementNumero"] for r in responses]
    assert len(set(numbers)) == 2 and number in numbers
    for i, n in ((1, numbers[0]), (2, numbers[1])):
        assert _rows(Session, ids["employees"][i][0]) == (1, [n])
