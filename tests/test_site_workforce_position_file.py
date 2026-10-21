"""Fiche de position BEO — lecture seule, champ par champ, dans le périmètre société/site.

Société A : sites A1, A2 ; société C : site C1. Le compte BEO voit A1 seulement. Toute garde est
vérifiée sur la RÉPONSE JSON brute (une clé refusée ne doit jamais y figurer, même à null).
"""
import importlib.util
import json
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import select

from app.core.security import hash_password
from app.modules.auth.field_permissions import UserFieldPermission
from app.modules.auth.models import AuditEvent, User
from app.modules.drh.models import Contract, Employee, Sanction
from app.modules.ops.models import Assignment, Site
from app.modules.site_workforce import position_file
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

BEO_TEST_FIELDS = ["identity.last_name", "identity.first_name", "identity.employee_code", "assignment.site", "assignment.position"]
FORBIDDEN = ["identity.phone", "contract.salary", "identity.id_document", "contract.end_date"]
SECRET_PHONE = "0555123456"
SECRET_ID = "PIECE-998877"
SECRET_SALARY = 98765.0


@pytest.fixture()
def world(client, db, auth_headers):
    t = uuid.uuid4().hex[:6]
    socs = {k: f"SocPF{k} {t}" for k in "AC"}
    sites = {key: Site(name=f"PF{key} {t}", active=1, equipment_plan={"societe": socs[key[0]]}, client_name="Client PF")
             for key in ("A1", "A2", "C1")}
    db.add_all(sites.values()); db.flush()
    emps = {}
    for key, site in sites.items():
        emp = Employee(code=f"PF{key}{t}", first_name=f"Prenom{key}", last_name=f"Nom{t}{key}", society=socs[key[0]],
                       status="actif", phone=SECRET_PHONE, salary_net=SECRET_SALARY, position="AGENT DE SECURITE",
                       contract_type="CDD", recruit_date=date(2024, 3, 1), contract_end_date=date.today() + timedelta(days=200),
                       extra={"numeroPieceIdentite": SECRET_ID, "groupeSanguin": "O+", "iban": "DZ00SECRET"})
        db.add(emp); db.flush()
        db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="B", position="CARISTE",
                          start_date=date(2026, 3, 24), active=1, work_regime="NORMAL"))
        emps[key] = emp
    # Historique : une affectation close sur C1 pour l'employé A1, un contrat, une sanction.
    db.add(Assignment(employee_id=emps["A1"].id, site_id=sites["C1"].id, group_code="A", position="AGENT",
                      start_date=date(2025, 1, 1), end_date=date(2026, 3, 23), active=0))
    db.add(Contract(employee_id=emps["A1"].id, contract_type="CDD", position="CARISTE", start_date=date(2026, 3, 1),
                    end_date=date.today() + timedelta(days=400), salary_net=SECRET_SALARY, status="actif"))
    db.add(Sanction(employee_id=emps["A1"].id, infraction_date=date(2026, 1, 5), fault="FAUTE CONFIDENTIELLE",
                    sanction_type="Avertissement", suspension_days=0))
    db.commit()

    def account(name, site_keys=("A1",), societies="A", actions=("read", "create", "update", "validate"), modules=("site_workforce",)):
        u = User(username=f"{name}_{t}".upper(), full_name=name, role="charge_effectifs_site", access_level="H2",
                 authorized_societies=[socs[s] for s in societies], authorized_structures=[], authorized_modules=list(modules),
                 authorized_sites=[sites[k].id for k in site_keys], authorized_actions=list(actions),
                 password_hash=hash_password("pfpassword1"), is_active=True)
        db.add(u); db.commit()
        token = client.post("/api/auth/login", json={"username": u.username, "password": "pfpassword1"}).json()["access_token"]
        return u, {"Authorization": f"Bearer {token}"}

    def grant(user, fields):
        r = client.put(f"/api/auth/users/{user.id}/site-workforce/position-fields", headers=auth_headers, json={"fields": list(fields)})
        assert r.status_code == 200, r.text
        return r.json()

    return {"t": t, "socs": socs, "sites": {k: v.id for k, v in sites.items()}, "emps": {k: v.id for k, v in emps.items()},
            "account": account, "grant": grant}


def _keys(body):
    return {f["key"] for s in body["sections"] for f in s["fields"]}


# ── Catalogue ──────────────────────────────────────────────────────────────────────────
def test_catalog_is_served_to_admin_only_and_standard_never_sensitive(client, auth_headers, world):
    body = client.get("/api/auth/site-workforce/position-fields", headers=auth_headers).json()
    fields = [f for s in body["sections"] for f in s["fields"]]
    assert body["total"] == len(fields) == len(position_file.FIELDS)
    assert [s["key"] for s in body["sections"]] == ["identity", "assignment", "contract", "history"]
    assert all(not f["default"] for f in fields if f["sensitive"])
    assert set(body["standard_profile"]) == {f["key"] for f in fields if f["default"]}
    for sensitive in ("contract.salary", "contract.bank", "identity.blood_group", "history.sanctions",
                      "identity.phone", "identity.nin", "identity.id_document", "identity.address"):
        assert sensitive not in body["standard_profile"]
        assert next(f for f in fields if f["key"] == sensitive)["sensitive"] is True

    _, beo = world["account"]("pfcat")
    assert client.get("/api/auth/site-workforce/position-fields", headers=beo).status_code == 403


# ── Deny by default ───────────────────────────────────────────────────────────────────
def test_account_without_configuration_gets_no_business_field(client, auth_headers, world):
    user, beo = world["account"]("pfnone")
    admin_view = client.get(f"/api/auth/users/{user.id}/site-workforce/position-fields", headers=auth_headers).json()
    assert admin_view["fields"] == [] and admin_view["profile"] == "none"
    r = client.get(f"/api/site-workforce/positions/{world['emps']['A1']}", headers=beo)
    assert r.status_code == 200
    body = r.json()
    assert body["sections"] == [] and body["employee_id"] == world["emps"]["A1"]
    raw = r.text
    for secret in (SECRET_PHONE, SECRET_ID, "CARISTE", world["t"]):
        assert secret not in raw
    listing = client.get("/api/site-workforce/positions", headers=beo).json()
    assert listing["columns"] == [] and [i["fields"] for i in listing["items"]] == [{}]


# ── §35 BEO_TEST ──────────────────────────────────────────────────────────────────────
def test_only_granted_fields_are_returned_and_forbidden_keys_are_absent(client, world):
    user, beo = world["account"]("beo_test")
    world["grant"](user, BEO_TEST_FIELDS)
    r = client.get(f"/api/site-workforce/positions/{world['emps']['A1']}", headers=beo)
    assert r.status_code == 200
    body = r.json()
    assert _keys(body) == set(BEO_TEST_FIELDS)
    values = {f["key"]: f["value"] for s in body["sections"] for f in s["fields"]}
    assert values["assignment.position"] == "CARISTE" and values["assignment.site"].startswith("PFA1")
    assert {s["key"] for s in body["sections"]} == {"identity", "assignment"}  # contrat/historique absents
    raw = r.text
    for key in FORBIDDEN:
        assert key not in raw
    for secret in (SECRET_PHONE, SECRET_ID, str(SECRET_SALARY), "98765", "salary", "DZ00SECRET", "O+", "FAUTE"):
        assert secret not in raw


# ── §36 changement par l'administrateur ───────────────────────────────────────────────
def test_admin_changes_take_effect_on_reload_and_scope_stays_enforced(client, world):
    user, beo = world["account"]("pfchange")
    world["grant"](user, BEO_TEST_FIELDS + ["contract.end_date"])
    url = f"/api/site-workforce/positions/{world['emps']['A1']}"
    body = client.get(url, headers=beo).json()
    end = next(f for s in body["sections"] for f in s["fields"] if f["key"] == "contract.end_date")
    assert end["value"] == (date.today() + timedelta(days=400)).isoformat()  # max(employé, dernier contrat)

    world["grant"](user, [k for k in BEO_TEST_FIELDS if k != "assignment.site"] + ["contract.end_date"])
    body = client.get(url, headers=beo).json()
    assert "assignment.site" not in _keys(body) and "contract.end_date" in _keys(body)
    # Le champ Site n'est plus affiché, mais le périmètre site reste appliqué.
    assert client.get(f"/api/site-workforce/positions/{world['emps']['A2']}", headers=beo).status_code == 403


# ── Périmètre : cross-site / cross-société / identifiants forgés ──────────────────────
def test_cross_site_and_cross_company_are_refused(client, world):
    user, beo = world["account"]("pfscope")
    world["grant"](user, position_file.STANDARD_PROFILE)
    e, s = world["emps"], world["sites"]
    assert client.get(f"/api/site-workforce/positions/{e['A1']}", headers=beo).status_code == 200
    assert client.get(f"/api/site-workforce/positions/{e['A2']}", headers=beo).status_code == 403  # même société, site non autorisé
    assert client.get(f"/api/site-workforce/positions/{e['C1']}", headers=beo).status_code == 403  # autre société
    assert client.get("/api/site-workforce/positions/99999999", headers=beo).status_code == 403   # inexistant : même réponse
    for params in ({"site_id": s["A2"]}, {"site_id": s["C1"]}, {"society": world["socs"]["C"]}):
        assert client.get(f"/api/site-workforce/positions/{e['A1']}", headers=beo, params=params).status_code == 403
        assert client.get("/api/site-workforce/positions", headers=beo, params=params).status_code == 403
    assert client.get(f"/api/site-workforce/positions/{e['C1']}/photo", headers=beo).status_code == 403
    ids = {i["employee_id"] for i in client.get("/api/site-workforce/positions", headers=beo, params={"page_size": 100}).json()["items"]}
    assert ids == {e["A1"]}


def test_history_is_read_from_canonical_assignments_without_confidential_fault(client, world):
    user, beo = world["account"]("pfhist")
    world["grant"](user, ["history.assignments", "history.sanctions", "history.contracts"])
    body = client.get(f"/api/site-workforce/positions/{world['emps']['A1']}", headers=beo).json()
    fields = {f["key"]: f for s in body["sections"] for f in s["fields"]}
    rows = fields["history.assignments"]["value"]
    assert [r["position"] for r in rows] == ["CARISTE", "AGENT"] and rows[1]["end_date"] == "2026-03-23"
    assert fields["history.sanctions"]["value"][0]["type"] == "Avertissement"
    assert "FAUTE CONFIDENTIELLE" not in json.dumps(body)
    assert "salary" not in json.dumps(fields["history.contracts"])


# ── Liste : recherche/filtre limités aux champs autorisés (aucun oracle) ──────────────
def test_list_search_never_uses_a_hidden_field(client, db, world):
    user, beo = world["account"]("pflist", site_keys=("A1", "A2"))
    world["grant"](user, ["identity.employee_code", "identity.status"])
    base = {"page_size": 100}
    # Nom non autorisé : une recherche par nom n'est pas appliquée (sinon elle révélerait le nom).
    body = client.get("/api/site-workforce/positions", headers=beo, params={**base, "q": f"Nom{world['t']}A2"}).json()
    assert body["filters"]["search"] is True and body["total"] == 0  # le code ne contient pas ce nom
    world["grant"](user, ["identity.status"])
    body = client.get("/api/site-workforce/positions", headers=beo, params={**base, "q": f"Nom{world['t']}A2"}).json()
    assert body["filters"]["search"] is False and body["total"] == 2
    body = client.get("/api/site-workforce/positions", headers=beo, params={**base, "status": "inexistant"}).json()
    assert body["total"] == 0 and body["filters"]["statuses"] == ["actif"]
    world["grant"](user, ["identity.employee_code", "assignment.site", "assignment.position"])
    body = client.get("/api/site-workforce/positions", headers=beo, params={**base, "q": f"PFA2{world['t']}"}).json()
    assert [i["employee_id"] for i in body["items"]] == [world["emps"]["A2"]]
    assert [c["key"] for c in body["columns"]] == ["identity.employee_code", "assignment.position", "assignment.site"]
    assert set(body["items"][0]["fields"]) == {"identity.employee_code", "assignment.position", "assignment.site"}


# ── RBAC : action read, module, administration ────────────────────────────────────────
def test_read_action_and_module_are_required(client, world):
    user, no_read = world["account"]("pfnoread", actions=("create",))
    world["grant"](user, position_file.STANDARD_PROFILE)
    assert client.get("/api/site-workforce/positions", headers=no_read).status_code == 403
    assert client.get(f"/api/site-workforce/positions/{world['emps']['A1']}", headers=no_read).status_code == 403
    _, drh_only = world["account"]("pfdrh", modules=("drh",))
    assert client.get(f"/api/site-workforce/positions/{world['emps']['A1']}", headers=drh_only).status_code == 403


def test_beo_cannot_read_or_raise_its_own_fields(client, world):
    user, beo = world["account"]("pfself")
    assert client.get(f"/api/auth/users/{user.id}/site-workforce/position-fields", headers=beo).status_code == 403
    r = client.put(f"/api/auth/users/{user.id}/site-workforce/position-fields", headers=beo,
                   json={"fields": list(position_file.FIELDS)})
    assert r.status_code == 403
    assert client.get(f"/api/site-workforce/positions/{world['emps']['A1']}", headers=beo).json()["sections"] == []


def test_admin_update_validates_keys_target_and_self(client, db, auth_headers, world):
    user, _ = world["account"]("pfvalid")
    r = client.put(f"/api/auth/users/{user.id}/site-workforce/position-fields", headers=auth_headers,
                   json={"fields": ["identity.first_name", "employee.salary_net"]})
    assert r.status_code == 422 and "employee.salary_net" in r.json()["detail"]
    assert db.scalars(select(UserFieldPermission).where(UserFieldPermission.user_id == user.id)).all() == []
    other, _ = world["account"]("pfother", modules=("drh",))
    assert client.put(f"/api/auth/users/{other.id}/site-workforce/position-fields", headers=auth_headers,
                      json={"fields": ["identity.first_name"]}).status_code == 422
    assert client.put("/api/auth/users/99999999/site-workforce/position-fields", headers=auth_headers,
                      json={"fields": []}).status_code == 404
    admin = db.scalar(select(User).where(User.username == "testadmin"))
    assert client.put(f"/api/auth/users/{admin.id}/site-workforce/position-fields", headers=auth_headers,
                      json={"fields": []}).status_code == 403


def test_admin_changes_are_audited_with_added_and_removed_fields(client, db, world):
    user, _ = world["account"]("pfaudit")
    world["grant"](user, ["identity.first_name", "identity.last_name"])
    out = world["grant"](user, ["identity.first_name", "contract.type"])
    assert out["fields"] == ["contract.type", "identity.first_name"] and out["profile"] == "custom"
    events = db.scalars(select(AuditEvent).where(AuditEvent.action == "site_workforce.position_fields.replace",
                                                 AuditEvent.resource_id == str(user.id), AuditEvent.result == "success")
                        .order_by(AuditEvent.id)).all()
    assert len(events) == 2 and events[-1].username == "testadmin"
    last = json.loads(events[-1].new_state)
    assert last["added"] == ["contract.type"] and last["removed"] == ["identity.last_name"]
    assert last["target_username"] == user.username
    assert world["grant"](user, position_file.STANDARD_PROFILE)["profile"] == "beo_standard"


# ── Lecture seule ─────────────────────────────────────────────────────────────────────
def test_position_file_exposes_no_write_route_and_writes_nothing(client, db, world):
    from app.main import app
    writes = [(r.path, r.methods) for r in app.routes if "/site-workforce/positions" in getattr(r, "path", "")
              and set(r.methods or ()) - {"GET", "HEAD"}]
    assert writes == []
    user, beo = world["account"]("pfro")
    world["grant"](user, position_file.FIELDS)
    emp_id = world["emps"]["A1"]
    before = db.get(Employee, emp_id).updated_at
    counts = {m: db.scalar(select(sa.func.count()).select_from(m)) for m in (Employee, Assignment, Contract, Sanction)}
    body = client.get(f"/api/site-workforce/positions/{emp_id}", headers=beo).json()
    assert body["read_only"] is True and _keys(body) == set(position_file.FIELDS)
    for method in ("put", "patch", "delete", "post"):
        assert getattr(client, method)(f"/api/site-workforce/positions/{emp_id}", headers=beo).status_code in (404, 405)
    db.expire_all()
    assert db.get(Employee, emp_id).updated_at == before
    assert counts == {m: db.scalar(select(sa.func.count()).select_from(m)) for m in (Employee, Assignment, Contract, Sanction)}


def test_photo_requires_the_photo_field(client, world):
    user, beo = world["account"]("pfphoto")
    world["grant"](user, ["identity.first_name"])
    assert client.get(f"/api/site-workforce/positions/{world['emps']['A1']}/photo", headers=beo).status_code == 404


# ── Migration : additive, preset BEO Standard explicite pour les comptes existants ────
def _migration():
    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "20261024_0001_user_field_permissions.py"
    spec = importlib.util.spec_from_file_location("mig_user_field_permissions", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_snapshot_matches_standard_profile():
    assert set(_migration().BEO_STANDARD_FIELDS) == set(position_file.STANDARD_PROFILE)


def test_migration_seeds_existing_beo_accounts_only_and_rolls_back(tmp_path):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'mig.db'}")
    meta = sa.MetaData()
    users = sa.Table("users", meta, sa.Column("id", sa.Integer, primary_key=True), sa.Column("authorized_modules", sa.JSON))
    meta.create_all(engine)
    with engine.begin() as conn:
        conn.execute(users.insert(), [{"id": 1, "authorized_modules": ["site_workforce"]}, {"id": 2, "authorized_modules": ["drh"]},
                                      {"id": 3, "authorized_modules": None}, {"id": 4, "authorized_modules": ["ops", "SITE_WORKFORCE"]}])
        mig = _migration()
        mig.op = Operations(MigrationContext.configure(conn))
        mig.upgrade()
        rows = conn.execute(sa.text("SELECT user_id, field_key FROM user_field_permissions")).all()
        assert {uid for uid, _ in rows} == {1, 4}
        assert {k for uid, k in rows if uid == 1} == set(position_file.STANDARD_PROFILE)
        mig.downgrade()
        assert "user_field_permissions" not in sa.inspect(conn).get_table_names()


def test_migration_accepts_table_created_by_initial_create_all_and_is_idempotent(tmp_path):
    """Base vierge : la migration initiale (create_all) a déjà créé la table ; une sélection
    existante n'est jamais écrasée et le seed ne crée aucun doublon."""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'mig2.db'}")
    UserFieldPermission.metadata.create_all(engine, tables=[User.__table__, UserFieldPermission.__table__])
    with engine.begin() as conn:
        conn.execute(User.__table__.insert(), [
            {"id": 1, "username": "A", "full_name": "A", "password_hash": "x", "authorized_modules": ["site_workforce"]},
            {"id": 2, "username": "B", "full_name": "B", "password_hash": "x", "authorized_modules": ["site_workforce"]},
        ])
        conn.execute(UserFieldPermission.__table__.insert(), [{"user_id": 2, "module_key": "site_workforce", "resource_key": "position_file",
                                                              "field_key": "identity.first_name", "created_at": date.today()}])
        mig = _migration()
        mig.op = Operations(MigrationContext.configure(conn))
        mig.upgrade()
        mig.upgrade()
        rows = conn.execute(sa.text("SELECT user_id, field_key FROM user_field_permissions")).all()
        assert len([r for r in rows if r[0] == 1]) == len(position_file.STANDARD_PROFILE)
        assert [k for uid, k in rows if uid == 2] == ["identity.first_name"]
