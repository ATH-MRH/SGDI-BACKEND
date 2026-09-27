"""Revue finale Attendance V1 — sécurité des routes, cross-société, cross-site (suite permanente)."""
import re
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.main import app
from app.modules.attendance import core
from app.modules.attendance.models import AttendanceAnomaly, AttendanceEvent
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics.models import BiometricTemplate
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site
from tests.biometric_fakes import FakeFaceEngine
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC_A, SOC_B = "Iron Global Securite", "Sword Corporation"
DAY = date(2027, 6, 1)
ACTOR = SimpleNamespace(id=None, username="REVIEW")
PREFIXES = ("/api/attendance", "/api/biometrics", "/api/portal/attendance", "/api/portal/pointage",
            "/api/ops/pointage", "/api/site-workforce", "/api/irongs/collections")


def _tag():
    return uuid.uuid4().hex[:6].upper()


# ── 1. Aucune route Attendance/biométrie accessible anonymement ─────────────────────────
def test_every_attendance_route_refuses_anonymous_callers(client):
    checked = 0
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith(PREFIXES):
            continue
        concrete = re.sub(r"\{[^}]+\}", "1", path)
        for method in sorted(getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}):
            body = {"employee": {"matricule": "X"}, "matricule": "X", "token": "1|1"} if "/portal/pointage" in path else {}
            r = client.request(method, concrete, json=body)
            checked += 1
            assert r.status_code in (401, 403), f"{method} {path} → {r.status_code} sans authentification"
    assert checked >= 75


# ── 2. Deux sociétés, plusieurs sites, un utilisateur par périmètre ─────────────────────
@pytest.fixture()
def world(client, db, monkeypatch):
    monkeypatch.setattr(settings, "biometric_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", Fernet.generate_key().decode())
    engine_module.set_engine(FakeFaceEngine())
    a1 = Site(name=f"A1 {_tag()}", active=1, equipment_plan={"societe": SOC_A})
    a2 = Site(name=f"A2 {_tag()}", active=1, equipment_plan={"societe": SOC_A})
    b1 = Site(name=f"B1 {_tag()}", active=1, equipment_plan={"societe": SOC_B})
    db.add_all([a1, a2, b1]); db.flush()
    emps = {}
    for key, site, soc in (("a1", a1, SOC_A), ("a2", a2, SOC_A), ("b1", b1, SOC_B)):
        e = Employee(code=f"RV{key.upper()}{_tag()}", first_name=key, last_name="Review", society=soc, status="actif")
        db.add(e); db.flush()
        db.add(Assignment(employee_id=e.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
        emps[key] = e
    db.commit()
    for key, site in (("a1", a1), ("a2", a2), ("b1", b1)):
        core.record_day_status(db, employee=emps[key], site_id=site.id, day=DAY, status="absent", source="MANUAL", actor=ACTOR)
    db.commit()
    biometric = [("biometric_status", "read"), ("biometric_enrollment", "create"), ("biometric_enrollment", "update"),
                 ("biometric_admin", "validate"), ("biometric_admin", "admin")]

    def user(societies, sites, modules=("pointage", "drh"), actions=("read", "create", "update", "validate", "unlock"),
             features=biometric, role="ops"):
        username = f"rv{_tag()}"
        u = User(username=username, full_name=username, role=role, access_level="H3", authorized_societies=list(societies),
                 authorized_sites=list(sites), authorized_structures=[], authorized_modules=list(modules),
                 authorized_actions=list(actions), password_hash=hash_password("reviewpass1"), is_active=True)
        db.add(u); db.flush()
        for f, a in features:
            db.add(UserFeaturePermission(user_id=u.id, module_key="attendance", feature_key=f, action_key=a))
        db.commit()
        token = client.post("/api/auth/login", json={"username": username, "password": "reviewpass1"}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    model = client.post("/api/biometrics/camera-models", headers=user([SOC_A, SOC_B], [], role="ops"), json={
        "manufacturer": "DAHUA", "model": f"Rev {_tag()}", "adapter": "DAHUA"}).json()
    admin_all = user([SOC_A, SOC_B], [])
    cams = {k: client.post("/api/biometrics/cameras", headers=admin_all, json={
        "name": f"CAM-{k}-{_tag()}", "camera_model_id": model["id"], "site_id": s.id, "host": "10.0.0.9",
        "usage": "ATTENDANCE_AND_ENROLLMENT"}).json()["id"] for k, s in (("a1", a1), ("b1", b1))}
    presences = {k: db.execute(select(DailyPresence).where(DailyPresence.employee_id == emps[k].id)).scalar_one().id for k in emps}
    anomalies = {k: db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == emps[k].id)).scalar_one().id for k in emps}
    yield SimpleNamespace(sites={"a1": a1.id, "a2": a2.id, "b1": b1.id}, emps={k: v.id for k, v in emps.items()},
                          presences=presences, anomalies=anomalies, cams=cams, user=user)
    engine_module.set_engine(None)


def test_cross_company_and_cross_site_zero_leak(client, db, world):
    w = world
    site_a1 = w.user([SOC_A], [w.sites["a1"]])          # un site de la société A
    company_a = w.user([SOC_A], [])                     # toute la société A
    # Tableau / anomalies : jamais d'employé hors périmètre
    ids_site = {r["employee_id"] for r in client.get(f"/api/attendance/board?presence_date={DAY}&page_size=200", headers=site_a1).json()["items"]}
    ids_comp = {r["employee_id"] for r in client.get(f"/api/attendance/board?presence_date={DAY}&page_size=200", headers=company_a).json()["items"]}
    assert w.emps["a1"] in ids_site and not {w.emps["a2"], w.emps["b1"]} & ids_site
    assert {w.emps["a1"], w.emps["a2"]} <= ids_comp and w.emps["b1"] not in ids_comp
    for h, forbidden in ((site_a1, ("a2", "b1")), (company_a, ("b1",))):
        listed = {a["employee_id"] for a in client.get("/api/attendance/anomalies?status=&page_size=200", headers=h).json()["items"]}
        assert not {w.emps[k] for k in forbidden} & listed
        for k in forbidden:
            assert client.get(f"/api/attendance/board?site_id={w.sites[k]}", headers=h).status_code == 403
            assert client.get(f"/api/attendance/employees/{w.emps[k]}", headers=h).status_code == 404            # événements / Employé 360
            assert client.patch(f"/api/attendance/presences/{w.presences[k]}", headers=h, json={"reason": "fuite ?", "status": "present"}).status_code == 404
            assert client.post(f"/api/attendance/presences/{w.presences[k]}/unlock", headers=h, json={"reason": "fuite ?"}).status_code == 404
            assert client.patch(f"/api/attendance/anomalies/{w.anomalies[k]}", headers=h, json={"status": "RESOLVED", "resolution": "fuite ?"}).status_code == 404
            assert client.post("/api/attendance/close", headers=h, json={"presence_date": str(DAY), "site_id": w.sites[k]}).status_code == 403
            assert client.get(f"/api/biometrics/employees/{w.emps[k]}", headers=h).status_code == 404            # consentement / état
            assert client.post(f"/api/biometrics/employees/{w.emps[k]}/consent", headers=h, json={
                "status": "contract_confirmed", "source": "EMPLOYMENT_CONTRACT", "proof_reference": "x", "notice_version": "2026-09-v1"}).status_code == 404
            assert client.post(f"/api/biometrics/employees/{w.emps[k]}/enroll", headers=h, json={}).status_code == 404
    assert client.post(f"/api/biometrics/cameras/{w.cams['b1']}/recognize", headers=company_a, json={}).status_code == 404
    assert client.post(f"/api/biometrics/cameras/{w.cams['b1']}/test", headers=company_a).status_code == 404
    assert client.get(f"/api/biometrics/cameras/{w.cams['b1']}/preview.jpg", headers=company_a).status_code == 404
    assert w.cams["b1"] not in {c["id"] for c in client.get("/api/biometrics/cameras", headers=company_a).json()}
    # Aucune écriture n'a eu lieu : chaque journée hors périmètre est intacte
    db.expire_all()
    for k in ("a2", "b1"):
        row = db.get(DailyPresence, w.presences[k])
        assert row.status == "absent" and row.closed_at is None
    assert db.scalar(select(func.count(BiometricTemplate.id)).where(BiometricTemplate.employee_id.in_(w.emps.values()))) == 0


def test_wrong_module_and_missing_action_are_refused(client, world):
    w = world
    finance = w.user([SOC_A], [w.sites["a1"]], modules=("finances",))
    for url in ("/api/attendance/board", "/api/attendance/anomalies", f"/api/attendance/employees/{w.emps['a1']}", "/api/biometrics/cameras"):
        assert client.get(url, headers=finance).status_code == 403, url
    beo_only = w.user([SOC_A], [w.sites["a1"]], modules=("site_workforce",))
    assert client.get("/api/attendance/board", headers=beo_only).status_code == 403
    reader = w.user([SOC_A], [w.sites["a1"]], actions=("read",), features=())
    assert client.patch(f"/api/attendance/presences/{w.presences['a1']}", headers=reader, json={"reason": "sans droit", "status": "present"}).status_code == 403
    assert client.post("/api/attendance/close", headers=reader, json={"presence_date": str(DAY), "site_id": w.sites["a1"]}).status_code == 403
    assert client.post(f"/api/biometrics/employees/{w.emps['a1']}/enroll", headers=reader, json={}).status_code == 403


def test_beo_stays_on_its_single_site(client, db, world):
    w = world
    username = f"ce{_tag()}"
    db.add(User(username=username, full_name=username, role="charge_effectifs_site", access_level="H2",
                authorized_societies=[SOC_A], authorized_sites=[w.sites["a1"]], authorized_structures=[],
                authorized_modules=["site_workforce"], authorized_actions=["read", "create", "update", "validate"],
                password_hash=hash_password("reviewpass1"), is_active=True))
    db.commit()
    h = {"Authorization": f"Bearer {client.post('/api/auth/login', json={'username': username, 'password': 'reviewpass1'}).json()['access_token']}"}
    for k in ("a2", "b1"):
        assert client.post("/api/site-workforce/attendance", headers=h, json={"employee_id": w.emps[k], "presence_date": str(DAY), "status": "present"}).status_code == 403
        assert client.post(f"/api/site-workforce/attendance/{w.presences[k]}/correct", headers=h, json={"status": "present", "reason": "x"}).status_code == 404
    ids = {e["employee_id"] for e in client.get(f"/api/site-workforce/attendance?presence_date={DAY}", headers=h).json()["entries"]}
    assert ids == {w.emps["a1"]}
    # Écriture BEO via Attendance Core, jamais de seconde journée
    before = db.scalar(select(func.count(DailyPresence.id)).where(DailyPresence.employee_id == w.emps["a1"]))
    assert client.post("/api/site-workforce/attendance", headers=h, json={"employee_id": w.emps["a1"], "presence_date": str(DAY), "status": "present"}).status_code == 200
    assert db.scalar(select(func.count(DailyPresence.id)).where(DailyPresence.employee_id == w.emps["a1"])) == before == 1
    assert db.execute(select(AttendanceEvent.source).where(AttendanceEvent.employee_id == w.emps["a1"]).order_by(AttendanceEvent.id.desc())).scalars().first() == "SITE_WORKFORCE"
