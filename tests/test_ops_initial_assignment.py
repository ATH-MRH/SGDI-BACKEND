"""Effectif sans affectation → ordre de mouvement validé → affectation, en une transaction.

Données fictives uniquement.
"""
import uuid
from datetime import date, timedelta

import pytest

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, OpsMovement, Site

SOC = "Iron Global Solution"
OTHER = "Societe Fictive Autre"
PASSWORD = "testpass123"
URL = "/api/ops/movements/initial-assignment"


@pytest.fixture
def world(client, db):
    tag = uuid.uuid4().hex[:8].upper()
    site = Site(name=f"SITE TEST {tag}", active=1, client_name="CLIENT FICTIF", equipment_plan={"societe": SOC})
    inactive = Site(name=f"SITE FERME {tag}", active=0, equipment_plan={"societe": SOC})
    foreign = Site(name=f"SITE AUTRE {tag}", active=1, equipment_plan={"societe": OTHER})
    employees = {key: Employee(code=f"T{key.upper()}{tag}", first_name="Test", last_name=f"OPS {key}",
                               society=society, status=state, position="AGENT FICTIF",
                               extra={"_legacy": {"id": f"agt_{key}_{tag}"}})
                 for key, society, state in (("free", SOC, "actif"), ("free2", SOC, "actif"), ("out", SOC, "sortant"),
                                             ("susp", SOC, "suspendu"), ("other", OTHER, "actif"))}
    db.add_all([site, inactive, foreign, *employees.values()])
    db.flush()

    def user(prefix, **kw):
        values = dict(username=f"{prefix}{tag}".lower(), full_name="Compte test", role="ops", access_level="H3",
                      authorized_societies=[SOC], authorized_modules=["ops"], authorized_structures=["ops"],
                      password_hash=hash_password(PASSWORD), is_active=True)
        values.update(kw)
        db.add(User(**values))

    user("ops")
    user("reader", authorized_actions=["read"])
    user("drh", role="drh", authorized_modules=["drh"], authorized_structures=["drh"])
    user("sup", role="superviseur", supervisor_read_only=True)
    user("sitesonly", authorized_sites=[str(site.id)])
    db.commit()

    def login(prefix):
        r = client.post("/api/auth/login", json={"username": f"{prefix}{tag}".lower(), "password": PASSWORD})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    number = f"OD/OPS/{date.today().year}/{int(tag, 16) % 900000 + 100000}"
    return {"site": site, "inactive": inactive, "foreign": foreign, "emp": employees, "login": login, "tag": tag, "number": number}


def body(w, key="free", **kw):
    emp = w["emp"][key]
    payload = {"employee_id": emp.id, "site_id": w["site"].id, "effective_date": date.today().isoformat(),
               "agent_ref": emp.extra["_legacy"]["id"], "group_code": "B", "motif": "Affectation",
               "duree": "Définitif", "observation": "Observation fictive", "movement_number": w["number"]}
    payload.update(kw)
    return payload


def assignments(db, emp):
    db.expire_all()
    return db.query(Assignment).filter(Assignment.employee_id == emp.id).all()


def movements(db, emp):
    db.expire_all()
    return db.query(OpsMovement).filter(OpsMovement.employee_id == emp.id).all()


def test_movement_creates_the_linked_assignment(client, db, world):
    emp = world["emp"]["free"]
    r = client.post(URL, headers=world["login"]("ops"), json=body(world))
    assert r.status_code == 200, r.text
    data = r.json()
    [assignment] = assignments(db, emp)
    [movement] = movements(db, emp)
    assert (assignment.site_id, assignment.group_code, assignment.active, assignment.start_date) == (world["site"].id, "B", 1, date.today())
    assert assignment.position == "AGENT FICTIF"  # fonction DRH conservée
    assert movement.movement_number == data["movement"]["ordreMouvementNumero"]
    assert movement.data["assignment_id"] == assignment.id
    assert movement.data["_legacy"]["assignmentBackendId"] == assignment.id
    assert movement.data["_legacy"]["positionActuelle"] == "Sans affectation"
    assert movement.data["_legacy"]["mouvementDuree"] == "Définitif"
    assert movement.movement_reason == "Affectation" and movement.site_id == world["site"].id
    assert data["assignment"]["id"] == assignment.id and data["effective_today"] is True
    assert movement.movement_number in assignment.change_reason
    # L'employé n'est plus « sans affectation » dans la liste OPS.
    rows = client.get("/api/ops/employees", headers=world["login"]("ops")).json()
    row = next(x for x in rows if x.get("id") == emp.id)
    assert row["extra"]["_legacy"]["affectationCourante"]["siteBackendId"] == world["site"].id


def test_second_validation_is_refused_without_duplicate(client, db, world):
    h = world["login"]("ops")
    assert client.post(URL, headers=h, json=body(world)).status_code == 200
    again = client.post(URL, headers=h, json=body(world, movement_number=""))
    assert again.status_code == 409
    assert again.json()["detail"] == "Cet employé possède déjà une affectation active. Actualisez la liste."
    assert len(assignments(db, world["emp"]["free"])) == 1
    assert len(movements(db, world["emp"]["free"])) == 1


def test_employee_assigned_meanwhile_by_another_path_is_refused(client, db, world, auth_headers):
    emp = world["emp"]["free"]
    other = client.post("/api/ops/assignments", headers=auth_headers, json={
        "employee_id": emp.id, "site_id": world["site"].id, "group_code": "A", "start_date": date.today().isoformat()})
    assert other.status_code == 200, other.text
    r = client.post(URL, headers=world["login"]("ops"), json=body(world))
    assert r.status_code == 409
    assert len(assignments(db, emp)) == 1 and movements(db, emp) == []


def test_movement_number_stays_unique(client, db, world):
    h = world["login"]("ops")
    number = world["number"]
    first = client.post(URL, headers=h, json=body(world, movement_number=number))
    second = client.post(URL, headers=h, json=body(world, key="free2", movement_number=number))
    assert first.status_code == 200 and second.status_code == 200, second.text
    n1 = first.json()["movement"]["ordreMouvementNumero"]
    n2 = second.json()["movement"]["ordreMouvementNumero"]
    assert n1 == number and n2 != number and n2.startswith(f"OD/OPS/{date.today().year}/")
    # Le premier ordre n'a pas été écrasé par le second.
    assert movements(db, world["emp"]["free"])[0].movement_number == number


def test_future_date_plans_the_assignment_without_making_it_current(client, db, world):
    emp = world["emp"]["free"]
    h = world["login"]("ops")
    future = (date.today() + timedelta(days=5)).isoformat()
    r = client.post(URL, headers=h, json=body(world, effective_date=future))
    assert r.status_code == 200, r.text
    assert r.json()["effective_today"] is False
    [assignment] = assignments(db, emp)
    assert assignment.start_date.isoformat() == future and assignment.active == 1
    # Liste OPS : toujours sans affectation aujourd'hui…
    rows = client.get("/api/ops/employees", headers=h).json()
    rows = rows.get("items", rows) if isinstance(rows, dict) else rows
    row = next(x for x in rows if x.get("id") == emp.id or x.get("backendId") == emp.id)
    assert not row.get("current_site_id") and not (row.get("extra") or {}).get("_legacy", {}).get("affectationCourante", {}).get("siteName")
    # … mais une seconde affectation planifiée est un doublon.
    assert client.post(URL, headers=h, json=body(world)).status_code == 409


def test_past_date_is_refused(client, db, world):
    r = client.post(URL, headers=world["login"]("ops"), json=body(world, effective_date=(date.today() - timedelta(days=1)).isoformat()))
    assert r.status_code == 422
    assert assignments(db, world["emp"]["free"]) == []


@pytest.mark.parametrize("key,expected", [("out", 422), ("susp", 422)])
def test_outgoing_or_suspended_employee_is_refused(client, db, world, key, expected):
    r = client.post(URL, headers=world["login"]("ops"), json=body(world, key=key))
    assert r.status_code == expected
    assert assignments(db, world["emp"][key]) == [] and movements(db, world["emp"][key]) == []


def test_inactive_site_is_refused(client, db, world):
    r = client.post(URL, headers=world["login"]("ops"), json=body(world, site_id=world["inactive"].id))
    assert r.status_code == 422
    assert assignments(db, world["emp"]["free"]) == []


def test_scope_employee_site_and_society(client, db, world):
    h = world["login"]("ops")
    # Employé d'une autre société.
    assert client.post(URL, headers=h, json=body(world, key="other")).status_code == 403
    # Site d'une autre société.
    assert client.post(URL, headers=h, json=body(world, site_id=world["foreign"].id)).status_code == 403
    # Compte limité à des sites : l'employé sans affectation n'est pas dans son périmètre.
    assert client.post(URL, headers=world["login"]("sitesonly"), json=body(world)).status_code == 403
    assert assignments(db, world["emp"]["free"]) == [] and assignments(db, world["emp"]["other"]) == []


def test_permissions(client, db, world):
    assert client.post(URL, headers=world["login"]("reader"), json=body(world)).status_code == 403
    assert client.post(URL, headers=world["login"]("drh"), json=body(world)).status_code == 403
    assert client.post(URL, headers=world["login"]("sup"), json=body(world)).status_code == 403
    assert client.post(URL, json=body(world)).status_code in (401, 403)
    assert assignments(db, world["emp"]["free"]) == []


def test_invalid_group_or_reference_is_refused(client, db, world):
    h = world["login"]("ops")
    assert client.post(URL, headers=h, json=body(world, group_code="Z")).status_code == 422
    assert client.post(URL, headers=h, json=body(world, agent_ref="agt_quelqu_un_d_autre")).status_code == 422
    assert assignments(db, world["emp"]["free"]) == []


def test_failure_after_the_movement_rolls_everything_back(client, db, world, monkeypatch):
    from app.modules.ops import service

    def broken(db_, data):
        raise RuntimeError("affectation impossible")

    monkeypatch.setattr(service, "create_assignment_no_commit", broken)
    with pytest.raises(RuntimeError):
        client.post(URL, headers=world["login"]("ops"), json=body(world))
    db.rollback()
    emp = world["emp"]["free"]
    assert assignments(db, emp) == [] and movements(db, emp) == []
