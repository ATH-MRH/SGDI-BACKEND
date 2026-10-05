"""La permission fine ne réactive jamais un module de pointage révoqué."""
import pytest
from sqlalchemy import func, select

from app.core.security import create_access_token, hash_password
from app.modules.attendance import core
from app.modules.attendance.models import AttendanceEvent
from app.modules.auth.models import User, UserFeaturePermission
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401
from tests.test_attendance_abandon import _started, clean_created_alerts  # noqa: F401
from tests.test_attendance_counted_time import ANCHOR, _setup, _tag, _ts


def _account(db, emp, site, *, modules, permission=True, role="pointeur", global_access=False):
    user = User(username="PTG" + str(int(_tag(), 16)), full_name="RBAC test", role=role,
                access_level="H2", is_active=True, supervisor_read_only=False,
                password_hash=hash_password("test-rbac-password"), authorized_modules=modules,
                authorized_societies=[emp.society], authorized_sites=[site.id],
                authorized_structures=["pointage"], global_society_access=global_access)
    db.add(user); db.flush()
    if permission:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance",
                                    feature_key="manual_entry", action_key="create"))
    db.commit()
    return user, {"Authorization": "Bearer " + create_access_token(subject=str(user.id))}


@pytest.mark.parametrize("host", ["pointage.irongs.com", "pointeur.irongs.com", "atlas.irongs.com"])
@pytest.mark.parametrize("modules", [[], ["drh"], ["attendance"]])
@pytest.mark.parametrize("action", ["abandon", "present", "absent"])
def test_module_revoked_with_fine_permission_denies_all_manual_writes(client, db, monkeypatch, host, modules, action):
    emp, site, shift = _started(db)
    _, headers = _account(db, emp, site, modules=modules)
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "20:35"))
    payload = {"employee_id": emp.id, "site_id": site.id, "shift_id": shift,
               "observation": "Motif RBAC", "action": action}
    before = db.scalar(select(func.count(AttendanceEvent.id)))
    endpoint = "abandon" if action == "abandon" else "scan"
    response = client.post("/api/portal/attendance-manual/" + endpoint,
                           headers={**headers, "Host": host}, json=payload)
    assert response.status_code == 403, response.text
    assert db.scalar(select(func.count(AttendanceEvent.id))) == before


@pytest.mark.parametrize("suffix", ["search", "context", "abandon/context"])
def test_revoked_module_also_denies_manual_reads(client, db, suffix):
    emp, site, _ = _started(db)
    _, headers = _account(db, emp, site, modules=[])
    response = client.get("/api/portal/attendance-manual/" + suffix, headers=headers,
                          params={"employee_id": emp.id, "site_id": site.id, "q": emp.code})
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("modules,host", [(["pointage"], "pointage.irongs.com"),
                                         (["pointeur"], "pointeur.irongs.com"),
                                         (None, "pointeur.irongs.com")])
@pytest.mark.parametrize("role", ["pointeur", "ops", "drh"])
def test_authorized_module_permission_and_scope_allow_abandon(client, db, monkeypatch, modules, host, role):
    emp, site, shift = _started(db)
    _, headers = _account(db, emp, site, modules=modules, role=role)
    headers["Host"] = host
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "20:35"))
    response = client.post("/api/portal/attendance-manual/abandon", headers=headers,
                           json={"employee_id": emp.id, "site_id": site.id, "shift_id": shift, "observation": "Motif"})
    assert response.status_code == 201, response.text


def test_module_without_fine_permission_denies_abandon(client, db):
    emp, site, shift = _started(db)
    _, headers = _account(db, emp, site, modules=["pointage"], permission=False)
    response = client.post("/api/portal/attendance-manual/abandon", headers=headers,
                           json={"employee_id": emp.id, "site_id": site.id, "shift_id": shift, "observation": "Motif"})
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("scope", ["site", "society"])
def test_authorized_module_and_permission_do_not_bypass_scope(client, db, scope):
    emp, site, shift = _started(db)
    _, other_site = _setup(db)
    user, headers = _account(db, emp, site, modules=["pointage"])
    if scope == "site":
        user.authorized_sites = [other_site.id]
    else:
        user.authorized_societies = ["Autre société"]
    db.commit()
    response = client.post("/api/portal/attendance-manual/abandon", headers=headers,
                           json={"employee_id": emp.id, "site_id": site.id, "shift_id": shift, "observation": "Motif"})
    assert response.status_code == 403, response.text


def test_global_admin_keeps_canonical_exception(client, db, monkeypatch):
    emp, site, shift = _started(db)
    user, headers = _account(db, emp, site, modules=[], permission=False, role="admin", global_access=True)
    user.authorized_societies = []; user.authorized_sites = []; db.commit()
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "20:35"))
    response = client.post("/api/portal/attendance-manual/abandon", headers={**headers, "Host": "pointeur.irongs.com"},
                           json={"employee_id": emp.id, "site_id": site.id, "shift_id": shift, "observation": "Motif admin"})
    assert response.status_code == 201, response.text


def test_unauthenticated_abandon_still_requires_authentication(client):
    assert client.post("/api/portal/attendance-manual/abandon", json={}).status_code == 401


@pytest.mark.parametrize("action", ["present", "absent"])
def test_authorized_manual_present_and_absent_still_work(client, db, monkeypatch, action):
    emp, site = _setup(db)
    _, headers = _account(db, emp, site, modules=["pointage"])
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "20:35"))
    response = client.post("/api/portal/attendance-manual/scan", headers=headers,
                           json={"employee_id": emp.id, "site_id": site.id, "action": action})
    assert response.status_code == 201, response.text
    assert response.json()["action"] == ("arrivee" if action == "present" else "absent")


def test_legacy_without_any_module_access_is_denied(client, db):
    emp, site, shift = _started(db)
    user, headers = _account(db, emp, site, modules=None)
    user.username = "UNKNOWN" + _tag(); user.authorized_structures = []; db.commit()
    response = client.post("/api/portal/attendance-manual/abandon", headers=headers,
                           json={"employee_id": emp.id, "site_id": site.id, "shift_id": shift, "observation": "Motif"})
    assert response.status_code == 403, response.text


def test_existing_token_does_not_keep_a_revoked_module(client, db, monkeypatch):
    emp, site, shift = _started(db)
    user, headers = _account(db, emp, site, modules=["pointage"])
    headers["Host"] = "pointage.irongs.com"
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "20:35"))
    url = "/api/portal/attendance-manual/abandon"
    params = {"employee_id": emp.id, "site_id": site.id}
    assert client.get(url + "/context", headers=headers, params=params).status_code == 200
    user.authorized_modules = []; db.commit()
    assert client.get(url + "/context", headers=headers, params=params).status_code == 403
    response = client.post(url, headers=headers,
                           json={**params, "shift_id": shift, "observation": "Motif"})
    assert response.status_code == 403, response.text


def test_admin_without_global_access_still_needs_fine_permission(client, db):
    emp, site, shift = _started(db)
    _, headers = _account(db, emp, site, modules=[], permission=False, role="admin", global_access=False)
    response = client.post("/api/portal/attendance-manual/abandon", headers=headers,
                           json={"employee_id": emp.id, "site_id": site.id, "shift_id": shift, "observation": "Motif"})
    assert response.status_code == 403, response.text
