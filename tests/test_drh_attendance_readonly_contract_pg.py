"""Contrat DRH lecture seule sur PostgreSQL réel, avec de vraies lignes à modifier.

Le compte DRH vise une présence, une anomalie et un site qui EXISTENT dans son périmètre : seul
le refus de module l'arrête, et les lignes restent inchangées. Le compte OPS, lui, modifie les
mêmes lignes.
"""
import os
import uuid
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Disposable PostgreSQL ATTENDANCE_PG_URL required")

SOC = "Iron Global Securite"
PASSWORD = "testpass123"
MODULE_REFUSALS = {"Module non autorise pour ce compte", "Pointage en lecture seule pour ce compte"}
ALL_ACTIONS = ["read", "create", "update", "validate", "delete", "export", "unlock", "admin"]


@pytest.fixture
def pg():
    from fastapi.testclient import TestClient

    import app.main
    from app.core.security import hash_password
    from app.db.base import Base
    from app.db.session import get_db
    from app.modules.attendance.models import AttendanceAnomaly
    from app.modules.auth.models import User
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment, DailyPresence, Site

    engine = create_engine(URL)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    tag = uuid.uuid4().hex[:10].upper()
    day = date(2031, 5, 6)
    with Session() as db:
        site = Site(name=f"Contrat PG {tag}", active=1, equipment_plan={"societe": SOC})
        employee = Employee(code=f"CPG{tag}", first_name="Contrat", last_name="Postgres", society=SOC, status="actif")
        db.add_all([site, employee])
        db.flush()
        presence = DailyPresence(presence_date=day, employee_id=employee.id, site_id=site.id, status="present",
                                 arrival_time="08:00")
        anomaly = AttendanceAnomaly(anomaly_type="MISSING_CHECKOUT", employee_id=employee.id, society=SOC,
                                    site_id=site.id, presence_date=day, message="Sortie manquante",
                                    dedupe_key=f"contrat-{tag}")
        db.add_all([
            presence, anomaly,
            Assignment(employee_id=employee.id, site_id=site.id, group_code="A", start_date=date(2031, 1, 1), active=1),
            User(username=f"drhpg{tag}", full_name="DRH large", role="drh", access_level="H3",
                 authorized_societies=[SOC], authorized_modules=["drh"], authorized_structures=["drh"],
                 authorized_actions=ALL_ACTIONS, password_hash=hash_password(PASSWORD), is_active=True),
            User(username=f"opspg{tag}", full_name="OPS", role="ops", access_level="H3",
                 authorized_societies=[SOC], authorized_modules=["ops"], authorized_structures=["ops"],
                 password_hash=hash_password(PASSWORD), is_active=True),
        ])
        db.commit()
        ids = {"site": site.id, "employee": employee.id, "code": employee.code, "presence": presence.id,
               "anomaly": anomaly.id, "day": day.isoformat(), "tag": tag}

    def override_get_db():
        with Session() as session:
            yield session

    previous = dict(app.main.app.dependency_overrides)
    app.main.app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app.main.app) as client:
            def login(prefix):
                response = client.post("/api/auth/login", json={"username": f"{prefix}{tag}", "password": PASSWORD})
                assert response.status_code == 200, response.text
                return {"Authorization": f"Bearer {response.json()['access_token']}"}

            yield client, Session, ids, login("drhpg"), login("opspg")
    finally:
        app.main.app.dependency_overrides.clear()
        app.main.app.dependency_overrides.update(previous)
        engine.dispose()


def _writes(ids):
    movement = {"data": {"date": ids["day"], "agentId": ids["code"], "employee_id": ids["employee"],
                         "patch": {"heureArrivee": "A", "mouvementMotif": "contrat", "societe": SOC,
                                   "employee_id": ids["employee"], "agentBackendId": ids["employee"]}}}
    return [
        ("post", "/api/irongs/actions/save-presence-movement", movement),
        ("patch", f"/api/attendance/presences/{ids['presence']}", {"reason": "contrat readonly", "status": "absent"}),
        ("patch", f"/api/attendance/anomalies/{ids['anomaly']}", {"status": "RESOLVED", "resolution": "contrat readonly"}),
        ("post", "/api/attendance/close", {"presence_date": ids["day"], "site_id": ids["site"]}),
        ("post", f"/api/attendance/presences/{ids['presence']}/unlock", {"reason": "contrat readonly"}),
        ("put", f"/api/attendance/rotation-settings/{ids['site']}", {}),
        ("put", f"/api/attendance/rotation-learning/{ids['site']}", {}),
        ("post", f"/api/attendance/rotation-learning/{ids['site']}/rebuild", {}),
        ("post", "/api/attendance/rotation-deviations/999999/qualify", {}),
        ("post", f"/api/attendance/rotation-planning/{ids['site']}/decisions", {}),
        ("post", "/api/portal/attendance-qr/scan", {"token": "x"}),
        ("post", "/api/biometrics/cameras/999999/recognize", {}),
    ]


def _state(Session, ids):
    from app.modules.attendance.models import AttendanceAnomaly, AttendanceEvent
    from app.modules.irongs.models import SgdiRecord
    from app.modules.ops.models import DailyPresence, OpsMovement

    with Session() as db:
        presence = db.get(DailyPresence, ids["presence"])
        anomaly = db.get(AttendanceAnomaly, ids["anomaly"])
        return {
            "presence": (presence.status, presence.arrival_time, presence.departure_time, presence.closed_at, presence.notes),
            "anomaly": (anomaly.status, anomaly.resolution, anomaly.resolved_by),
            "events": db.query(AttendanceEvent).filter(AttendanceEvent.employee_id == ids["employee"]).count(),
            "movements": db.query(OpsMovement).filter(OpsMovement.employee_id == ids["employee"]).count(),
            "presences": db.query(DailyPresence).filter(DailyPresence.employee_id == ids["employee"]).count(),
            "legacy": db.query(SgdiRecord).filter(SgdiRecord.item_id.like(f"%{ids['code']}%")).count(),
        }


def test_drh_is_refused_on_real_rows_and_nothing_changes(pg):
    client, Session, ids, drh, _ops = pg
    before = _state(Session, ids)
    for method, url, body in _writes(ids):
        response = getattr(client, method)(url, headers=drh, json=body)
        assert response.status_code == 403 and response.json().get("detail") in MODULE_REFUSALS, \
            f"{method.upper()} {url} -> {response.status_code} {response.text[:200]}"
    assert _state(Session, ids) == before


def test_drh_still_reads_the_same_rows(pg):
    client, _Session, ids, drh, _ops = pg
    board = client.get(f"/api/attendance/board?presence_date={ids['day']}&site_id={ids['site']}", headers=drh)
    assert board.status_code == 200, board.text
    anomalies = client.get(f"/api/attendance/anomalies?site_id={ids['site']}", headers=drh)
    assert anomalies.status_code == 200, anomalies.text
    assert client.get(f"/api/attendance/employees/{ids['employee']}", headers=drh).status_code == 200
    assert client.get("/api/irongs/collections/feuillePresence", headers=drh).status_code == 200


def test_ops_writes_the_same_rows(pg):
    client, Session, ids, _drh, ops = pg
    before = _state(Session, ids)
    responses = []
    for method, url, body in _writes(ids):
        response = getattr(client, method)(url, headers=ops, json=body)
        assert not (response.status_code == 403 and response.json().get("detail") in MODULE_REFUSALS), \
            f"{method.upper()} {url} -> {response.text[:200]}"
        responses.append(response)
    after = _state(Session, ids)
    # Mouvement enregistré, présence corrigée, anomalie résolue : OPS écrit bien ces lignes.
    assert responses[0].status_code == 200 and responses[0].json()["data"]["item"]["heureArrivee"] == "A"
    assert after["legacy"] + after["movements"] + after["presences"] > before["legacy"] + before["movements"] + before["presences"]
    assert after["presence"][0] == "absent"
    assert after["anomaly"][0] == "RESOLVED" and after["anomaly"][2] == f"opspg{ids['tag']}"
