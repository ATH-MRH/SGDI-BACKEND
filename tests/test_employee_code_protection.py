"""Un matricule officiel n'est jamais modifié silencieusement.

Fiche employé (PUT), action dédiée « Modifier le matricule », import Excel (forme proposée
jamais appliquée d'office), repair-codes en deux temps, synchronisation historique."""
from io import BytesIO
import random
import string
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import func, select

from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User
from app.modules.drh import employee_code_policy as policy
from app.modules.drh.models import Employee
from app.modules.irongs import sql_bridge

IMPORT = "/api/drh/employee-import"
ACTOR = SimpleNamespace(id=None, username="TESTCODES")


def letters(size=6):
    return "".join(random.choices(string.ascii_uppercase, k=size))


@pytest.fixture
def system_headers(client):
    response = client.post("/api/auth/admin-system-login", json={"username": "testadmin", "password": "test-admin-password"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def employee(db):
    tag = letters()
    row = Employee(code=f"Q{random.randint(100, 999)}{tag}", first_name="PROTEGE", last_name=f"CODE{tag}", society=f"SOC CODE {tag}",
                   status="actif", phone="0550000000")
    db.add(row)
    db.commit()
    return row


def audits(db, action, resource_id=None):
    stmt = select(AuditEvent).where(AuditEvent.action == action)
    if resource_id is not None:
        stmt = stmt.where(AuditEvent.resource_id == str(resource_id))
    return db.scalars(stmt).all()


# ── Fiche employé ────────────────────────────────────────────────────────────────────────────
def test_editing_another_field_never_changes_the_matricule(client, auth_headers, db):
    tag = letters()
    row = Employee(code="A001" + tag, first_name="ZERO", last_name=f"PAD{tag}", society="SOC PAD", status="actif")
    db.add(row)
    db.commit()
    code = row.code
    response = client.put(f"/api/drh/employees/{row.id}", headers=auth_headers,
                          json={"code": code, "first_name": "ZERO", "last_name": f"PAD{tag}", "phone": "0661000000"})
    assert response.status_code == 200, response.text
    assert response.json()["code"] == code and response.json()["phone"] == "0661000000"
    # Une forme « normalisée » envoyée par un ancien écran est refusée, jamais appliquée.
    stale = client.put(f"/api/drh/employees/{row.id}", headers=auth_headers,
                       json={"code": "A01", "first_name": "ZERO", "last_name": f"PAD{tag}", "phone": "0662000000"})
    assert stale.status_code == 409 and "Modifier le matricule" in stale.text
    db.expire_all()
    assert db.get(Employee, row.id).code == code and db.get(Employee, row.id).phone == "0661000000"


def test_explicit_change_requires_reason_confirmation_and_is_audited(client, auth_headers, db, employee):
    url = f"/api/drh/employees/{employee.id}/matricule"
    old = employee.code
    assert client.patch(url, headers=auth_headers, json={"new_code": "N" + old, "reason": "Erreur de saisie"}).status_code == 422
    assert client.patch(url, headers=auth_headers, json={"new_code": "N" + old, "reason": "", "confirm": True}).status_code == 422
    assert client.patch(url, headers=auth_headers, json={"new_code": old, "reason": "Erreur de saisie", "confirm": True}).status_code == 422
    response = client.patch(url, headers=auth_headers, json={"new_code": "n" + old, "reason": "Erreur de saisie à l'embauche", "confirm": True})
    assert response.status_code == 200, response.text
    assert response.json()["code"] == "N" + old
    db.expire_all()
    row = db.get(Employee, employee.id)
    assert policy.is_protected(row) and row.extra["matriculeOfficiel"]["source"] == "modification_explicite"
    assert row.extra["matriculeHistorique"][-1]["ancien"] == old and row.extra["matriculeHistorique"][-1]["par"] == "testadmin"
    event = audits(db, "drh.employee.code_changed", employee.id)[-1]
    assert old in event.old_state and "N" + old in event.new_state and "Erreur de saisie" in event.new_state
    assert event.username == "testadmin" and event.created_at is not None


def test_explicit_change_collision_is_refused(client, auth_headers, db, employee):
    other = Employee(code="K" + employee.code, first_name="AUTRE", last_name="COLLISION", society=employee.society)
    db.add(other)
    db.commit()
    response = client.patch(f"/api/drh/employees/{employee.id}/matricule", headers=auth_headers,
                            json={"new_code": other.code, "reason": "Collision volontaire", "confirm": True})
    assert response.status_code == 409 and "déjà utilisé" in response.text
    db.expire_all()
    assert db.get(Employee, employee.id).code == employee.code


def test_explicit_change_without_permission_is_refused(client, db, employee):
    username = "REC" + letters(5)
    db.add(User(username=username, email=f"{username.lower()}@test.com", full_name="Recruteur", role="recruteur", access_level="H2",
                authorized_societies=[employee.society], authorized_modules=["drh", "recrute"], authorized_structures=[],
                password_hash=hash_password("pass-recruteur-1"), validation_password_hash=hash_password("x"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": username, "password": "pass-recruteur-1"}).json()["access_token"]
    response = client.patch(f"/api/drh/employees/{employee.id}/matricule", headers={"Authorization": f"Bearer {token}"},
                            json={"new_code": "Z" + employee.code, "reason": "Tentative non autorisée", "confirm": True})
    assert response.status_code == 403
    assert audits(db, "authorization.drh.employee.code_change", employee.id)
    db.expire_all()
    assert db.get(Employee, employee.id).code == employee.code


def test_legacy_synchronisation_cannot_rename_a_matricule(db, employee):
    with pytest.raises(HTTPException) as error:
        sql_bridge.upsert_employee(db, {"backendId": employee.id, "matricule": "X" + employee.code, "nom": employee.last_name})
    assert error.value.status_code == 409
    db.rollback()
    assert db.get(Employee, employee.id).code == employee.code


# ── Import Excel : forme proposée visible, jamais automatique ───────────────────────────────
def _upload(client, headers, rows, society):
    book = Workbook()
    sheet = book.active
    sheet.append(["Matricule", "Nom", "Prénom"])
    for row in rows:
        sheet.append(row)
    content = BytesIO()
    book.save(content)
    uploaded = client.post(IMPORT, params={"society": society}, headers=headers, files={"file": ("m.xlsx", content.getvalue())}).json()
    preview = client.post(f"{IMPORT}/{uploaded['session_id']}/preview", headers=headers,
                          json={"sheet": 0, "mapping": {"0": "code", "1": "last_name", "2": "first_name"}}).json()
    return uploaded["session_id"], preview


def test_import_proposes_normalized_matricule_without_applying_it(client, system_headers, db, employee):
    prefix = random.choice("EFGHJLMPRUVY")
    number = random.randint(300, 900)
    society = employee.society
    keep, adopt = f"{prefix}0{number}", f"{prefix}0{number + 1}"
    sid, preview = _upload(client, system_headers, [[keep, f"GARDE{letters()}", "Ali"], [adopt, f"FORME{letters()}", "Lina"]], society)
    rows = {row["row"]: row for row in preview["rows"]}
    for number_row, value in ((2, keep), (3, adopt)):
        row = rows[number_row]
        assert row["status"] == "review" and row["code_preview"] == value          # la valeur Excel est affichée telle quelle
        issue = next(i for i in row["issues"] if i["field"] == "code")
        assert issue["suggestions"] == [policy.canonical_code(value)] and "Conserver" in issue["accept_label"]
    # Ligne 2 : conserver la valeur Excel ; ligne 3 : adopter la forme proposée.
    keep_issue = next(i for i in rows[2]["issues"] if i["field"] == "code")
    client.post(f"{IMPORT}/{sid}/corrections", headers=system_headers, json={"row": 2, "accept": [keep_issue["accept"]]})
    result = client.post(f"{IMPORT}/{sid}/corrections", headers=system_headers,
                         json={"row": 3, "values": {"code": policy.canonical_code(adopt)}}).json()
    assert {row["row"]: row["status"] for row in result["rows"]} == {2: "ready", 3: "ready"}
    outcome = client.post(f"{IMPORT}/{sid}/confirm", headers=system_headers).json()
    assert outcome["counts"]["created"] == 2, outcome
    db.expire_all()
    kept = db.scalar(select(Employee).where(Employee.code == keep))
    adopted = db.scalar(select(Employee).where(Employee.code == policy.canonical_code(adopt)))
    assert kept and adopted and db.scalar(select(Employee).where(Employee.code == adopt)) is None
    assert kept.extra["matriculeOfficiel"]["choix"] == "conserve_excel" and kept.extra["matriculeOfficiel"]["source"] == "import_excel"
    assert adopted.extra["matriculeOfficiel"]["choix"] == "forme_proposee" and adopted.extra["matriculeOfficiel"]["valeurExcel"] == adopt
    assert kept.extra["importOrigin"]["matricule"]["formeProposee"] == policy.canonical_code(keep)
    assert policy.is_protected(kept) and policy.is_protected(adopted)


def test_import_proposal_is_withheld_when_already_taken(client, system_headers, db, employee):
    prefix = random.choice("EFGHJLMPRUVY")
    taken = f"{prefix}{random.randint(10, 99)}"
    if db.scalar(select(Employee).where(Employee.code == taken)) is None:
        db.add(Employee(code=taken, first_name="PRIS", last_name="DEJA", society=employee.society))
        db.commit()
    _, preview = _upload(client, system_headers, [[f"{taken[0]}0{taken[1:]}", f"PRIS{letters()}", "Nour"]], employee.society)
    issue = next(i for i in preview["rows"][0]["issues"] if i["field"] == "code")
    assert "suggestions" not in issue and "déjà utilisée" in issue["message"]


# ── repair-codes en deux temps ───────────────────────────────────────────────────────────────
def test_repair_preview_writes_nothing_and_excludes_protected(db, employee):
    employee.extra = {"matriculeOfficiel": policy.protection_record(employee.code, source="import_excel", by="test")}
    db.add(Employee(code="ZZ-" + letters(), first_name="HORS", last_name="SERIE" + letters(), society=employee.society))
    db.commit()
    before = [(row.id, row.code, row.extra) for row in db.scalars(select(Employee).order_by(Employee.id))]
    audit_count = db.scalar(select(func.count(AuditEvent.id)))
    plan = policy.repair_plan(db)
    db.expire_all()
    assert [(row.id, row.code, row.extra) for row in db.scalars(select(Employee).order_by(Employee.id))] == before
    assert db.scalar(select(func.count(AuditEvent.id))) == audit_count
    assert employee.id in {item["employee_id"] for item in plan["protected"]}
    assert employee.id not in {item["employee_id"] for item in plan["changes"]}
    assert all({"employee_id", "name", "society", "current", "proposed", "reason", "protected", "conflict"} <= set(item) for item in plan["changes"])


def test_repair_confirmation_is_audited_idempotent_and_keeps_protected(db, employee):
    employee.extra = {"matriculeOfficiel": policy.protection_record(employee.code, source="import_excel", by="test")}
    out_of_series = Employee(code="ZZ-" + letters(), first_name="HORS", last_name="SERIE" + letters(), society=employee.society)
    db.add(out_of_series)
    db.commit()
    plan = policy.repair_plan(db)
    planned = next(item for item in plan["changes"] if item["employee_id"] == out_of_series.id)
    result = policy.apply_repair(db, plan["plan_id"], actor=ACTOR)
    assert result["already_processed"] is False and result["counts"]["changed"] == plan["counts"]["code_changes"]
    db.expire_all()
    assert db.get(Employee, employee.id).code == employee.code                     # protégé : intact
    assert db.get(Employee, out_of_series.id).code == planned["proposed"]
    event = audits(db, "drh.employee.code_repaired", out_of_series.id)[-1]
    assert planned["current"] in event.old_state and planned["proposed"] in event.new_state
    again = policy.apply_repair(db, plan["plan_id"], actor=ACTOR)                # double confirmation
    assert again["already_processed"] is True and again["counts"] == result["counts"]
    assert len(audits(db, policy.REPAIR_AUDIT, plan["plan_id"])) == 1


def test_repair_refused_when_database_changed_since_preview(db, employee):
    plan = policy.repair_plan(db)
    db.add(Employee(code="ZZ-" + letters(), first_name="NOUVEAU", last_name="APRES" + letters(), society=employee.society))
    db.commit()
    with pytest.raises(HTTPException) as error:
        policy.apply_repair(db, plan["plan_id"], actor=ACTOR)
    assert error.value.status_code == 409 and "changé depuis l'aperçu" in error.value.detail


def test_repair_refused_on_collision(db, monkeypatch, employee):
    plan = policy.repair_plan(db)
    plan["counts"]["conflicts"] = 1
    monkeypatch.setattr(policy, "repair_plan", lambda _db: plan)
    codes = {row.id: row.code for row in db.scalars(select(Employee))}
    with pytest.raises(HTTPException) as error:
        policy.apply_repair(db, plan["plan_id"], actor=ACTOR)
    assert error.value.status_code == 409 and "Collision" in error.value.detail
    db.expire_all()
    assert {row.id: row.code for row in db.scalars(select(Employee))} == codes


def test_repair_routes_are_reserved_and_require_a_preview(client, auth_headers, system_headers):
    assert client.get("/api/drh/employees/repair-codes/plan", headers=auth_headers).status_code == 403
    assert client.post("/api/drh/employees/repair-codes", headers=auth_headers, json={"plan_id": "x" * 40}).status_code == 403
    plan = client.get("/api/drh/employees/repair-codes/plan", headers=system_headers)
    assert plan.status_code == 200 and {"plan_id", "changes", "protected", "counts"} <= set(plan.json())
    missing = client.post("/api/drh/employees/repair-codes", headers=system_headers)
    assert missing.status_code == 422 and "aperçu" in missing.text
    stale = client.post("/api/drh/employees/repair-codes", headers=system_headers, json={"plan_id": "0" * 40})
    assert stale.status_code == 409


@pytest.mark.parametrize("value,expected", [("A001", "A01"), ("A1", "A01"), ("X1", "X01"), ("A01", "A01"), ("Z900", "Z900"),
                                            ("B0123", "B123"), ("SEC-12", "SEC-12"), ("AB12", "AB12"), ("A000", "A000")])
def test_canonical_code_matches_the_screen_convention(value, expected):
    assert policy.canonical_code(value) == expected
