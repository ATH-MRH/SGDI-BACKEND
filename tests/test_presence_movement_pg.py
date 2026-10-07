"""Mouvement de personnel sur PostgreSQL réel : l'ordre est relu depuis une NOUVELLE session.

Chaque requête utilise sa propre session, comme en production : un succès de l'API qui ne
serait pas validé en base disparaît à la fermeture de la session et fait échouer ces tests.
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

SOC = "Iron Global Securite"
PASSWORD = "testpass123"
DAY = "2031-06-10"


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
        site = Site(name=f"Mouvement PG {tag}", active=1, equipment_plan={"societe": SOC})
        employee = Employee(code=f"MPG{tag}", first_name="Mouvement", last_name="Postgres", society=SOC, status="actif")
        db.add_all([
            site, employee,
            User(username=f"opsmv{tag}", full_name="OPS mouvement", role="ops", access_level="H3",
                 authorized_societies=[SOC], authorized_modules=["ops"], authorized_structures=["ops"],
                 password_hash=hash_password(PASSWORD), is_active=True),
            User(username=f"drhmv{tag}", full_name="DRH", role="drh", access_level="H3",
                 authorized_societies=[SOC], authorized_modules=["drh"], authorized_structures=["drh"],
                 password_hash=hash_password(PASSWORD), is_active=True),
        ])
        db.commit()
        ids = {"employee": employee.id, "code": employee.code, "site": site.id, "tag": tag}

    def override_get_db():
        with Session() as session:
            yield session

    previous = dict(app.main.app.dependency_overrides)
    app.main.app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app.main.app, raise_server_exceptions=False) as client:
            def login(prefix):
                response = client.post("/api/auth/login", json={"username": f"{prefix}{tag}", "password": PASSWORD})
                assert response.status_code == 200, response.text
                return {"Authorization": f"Bearer {response.json()['access_token']}"}

            yield client, Session, ids, login("opsmv"), login("drhmv")
    finally:
        app.main.app.dependency_overrides.clear()
        app.main.app.dependency_overrides.update(previous)
        engine.dispose()


def _body(ids, **patch):
    return {"data": {"date": DAY, "agentId": ids["code"], "employee_id": ids["employee"], "patch": {
        "heureArrivee": "P", "mouvementMotif": "renfort", "mouvementType": "MUTATION", "societe": SOC,
        "employee_id": ids["employee"], "agentBackendId": ids["employee"], "siteBackendId": ids["site"], **patch}}}


def _persisted(Session, ids):
    """Relit l'ordre et la ligne de présence depuis une session neuve."""
    from app.modules.irongs.models import SgdiRecord
    from app.modules.ops.models import OpsMovement

    with Session() as db:
        movements = db.query(OpsMovement).filter(OpsMovement.employee_id == ids["employee"]).all()
        lines = db.query(SgdiRecord).filter(SgdiRecord.collection == "feuillePresence",
                                            SgdiRecord.item_id == f"fpq_{DAY}_{ids['code']}").all()
        return ([(m.id, m.movement_date, m.movement_type, m.movement_reason, m.site_id, m.society) for m in movements],
                [row.data for row in lines])


def test_movement_is_persisted_before_success_is_returned(pg):
    client, Session, ids, ops, _drh = pg
    saved = client.post("/api/irongs/actions/save-presence-movement", headers=ops, json=_body(ids))
    assert saved.status_code == 200, saved.text
    movements, lines = _persisted(Session, ids)
    assert movements == [(movements[0][0], date(2031, 6, 10), "MUTATION", "renfort", ids["site"], SOC)]
    assert len(lines) == 1 and lines[0]["heureArrivee"] == "P"
    # Le succès renvoie l'ordre réellement enregistré, identifiant SQL compris.
    assert saved.json()["data"]["movement"]["backendId"] == movements[0][0]
    listed = client.get("/api/irongs/collections/opsMouvements", headers=ops).json()["data"]
    assert [m["backendId"] for m in listed if m.get("agentBackendId") == ids["employee"]] == [movements[0][0]]


def test_same_movement_saved_twice_keeps_one_order(pg):
    client, Session, ids, ops, _drh = pg
    first = client.post("/api/irongs/actions/save-presence-movement", headers=ops, json=_body(ids))
    second = client.post("/api/irongs/actions/save-presence-movement", headers=ops, json=_body(ids, mouvementMotif="renfort confirmé"))
    assert first.status_code == 200 and second.status_code == 200, second.text
    movements, lines = _persisted(Session, ids)
    assert len(movements) == 1 and movements[0][3] == "renfort confirmé"
    assert len(lines) == 1
    assert second.json()["data"]["movement"]["backendId"] == first.json()["data"]["movement"]["backendId"]


def test_concurrent_saves_of_the_same_movement_keep_one_order(pg):
    client, Session, ids, ops, _drh = pg
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(
            lambda _: client.post("/api/irongs/actions/save-presence-movement", headers=ops, json=_body(ids)), range(4)))
    assert [r.status_code for r in responses] == [200, 200, 200, 200], [r.text[:200] for r in responses]
    movements, lines = _persisted(Session, ids)
    assert len(movements) == 1 and len(lines) == 1
    assert {r.json()["data"]["movement"]["backendId"] for r in responses} == {movements[0][0]}


def test_failed_movement_rolls_back_the_presence_line_and_reports_the_error(pg, monkeypatch):
    client, Session, ids, ops, _drh = pg
    from app.modules.irongs import sql_bridge

    def broken(db, name, item):
        raise RuntimeError("écriture du mouvement impossible")

    monkeypatch.setattr(sql_bridge, "upsert_item", broken)
    failed = client.post("/api/irongs/actions/save-presence-movement", headers=ops, json=_body(ids))
    assert failed.status_code == 500
    assert _persisted(Session, ids) == ([], [])


def test_refused_or_invalid_movement_persists_nothing(pg):
    client, Session, ids, ops, drh = pg
    refused = client.post("/api/irongs/actions/save-presence-movement", headers=drh, json=_body(ids))
    assert refused.status_code == 403
    invalid = client.post("/api/irongs/actions/save-presence-movement", headers=ops, json={"data": {"patch": {"mouvementMotif": "x"}}})
    assert invalid.status_code == 422
    assert _persisted(Session, ids) == ([], [])
