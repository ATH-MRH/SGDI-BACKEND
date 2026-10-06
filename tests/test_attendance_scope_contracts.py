"""HTTP contracts and bounded compatibility for legacy explicit site grants."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.modules.attendance.models import AttendanceEvent
from app.modules.ops.models import Site
from app.modules.portal.routes import _attendance_selected_sites, search_employee_for_manual_attendance
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401
from tests.test_abandon_module_rbac import _account
from tests.test_attendance_counted_time import _setup


@pytest.mark.parametrize("serialized", [False, True])
def test_site_only_grant_does_not_grant_other_sites_of_the_same_society(db, serialized):
    employee, site = _setup(db)
    foreign, other = _setup(db)
    user = SimpleNamespace(authorized_societies=[], authorized_sites=[str(site.id) if serialized else site.id],
                           global_society_access=False, role="ops", access_level="H2")
    assert _attendance_selected_sites(db, user) == {site.id}
    assert _attendance_selected_sites(db, user, site.id, employee.society) == {site.id}
    assert {row["id"] for row in search_employee_for_manual_attendance(employee.code, site.id, db, user)} == {employee.id}
    assert search_employee_for_manual_attendance(foreign.code, None, db, user) == []
    for kwargs in ({"site_id": other.id}, {"society": "SWORD CORPORATION"}):
        with pytest.raises(HTTPException) as denied:
            _attendance_selected_sites(db, user, **kwargs)
        assert denied.value.status_code == 403


def test_empty_grants_do_not_imply_global_scope(db):
    _, site = _setup(db)
    user = SimpleNamespace(authorized_societies=[], authorized_sites=[], global_society_access=False,
                           role="ops", access_level="H2")
    assert _attendance_selected_sites(db, user) == set()
    with pytest.raises(HTTPException) as denied:
        _attendance_selected_sites(db, user, site.id)
    assert denied.value.status_code == 403


@pytest.mark.parametrize("action", ["present", "absent"])
def test_permission_code_is_specific_to_manual_permission_refusal(client, db, action):
    employee, site = _setup(db)
    foreign, other = _setup(db)
    user, headers = _account(db, employee, site, modules=["pointeur"], permission=False, role="ops")
    user.authorized_societies = []  # Historical explicit site grant, not global access.
    db.commit()
    endpoint = "/api/portal/attendance-manual/scan"
    payload = {"employee_id": employee.id, "site_id": site.id, "action": action}
    before = db.scalar(select(func.count(AttendanceEvent.id)))
    missing_auth = client.post(endpoint, json=payload)
    assert missing_auth.status_code == 401
    denied = client.post(endpoint, headers=headers, json=payload)
    assert denied.status_code == 403
    assert denied.headers["X-Attendance-Code"] == "MANUAL_ENTRY_REQUIRED"
    for injected in ({**payload, "site_id": other.id},
                     {**payload, "employee_id": foreign.id, "site_id": other.id},
                     {**payload, "society": "SWORD CORPORATION"}):
        forbidden = client.post(endpoint, headers=headers, json=injected)
        assert forbidden.status_code == 403
        assert "X-Attendance-Code" not in forbidden.headers
    user.authorized_modules = []
    db.commit()
    module_denied = client.post(endpoint, headers=headers, json=payload)
    assert module_denied.status_code == 403
    assert "X-Attendance-Code" not in module_denied.headers
    assert db.scalar(select(func.count(AttendanceEvent.id))) == before


def test_portrait_checks_requested_site_before_employee_existence(client, db):
    employee, site = _setup(db)
    _, other = _setup(db)
    user, headers = _account(db, employee, site, modules=["pointeur"], role="ops")
    user.authorized_societies = []
    db.commit()
    url = "/api/portal/attendance-employee/2147483647/portrait"
    assert client.get(url, headers=headers, params={"site_id": other.id}).status_code == 403
    assert client.get(url, headers=headers, params={"site_id": site.id}).status_code == 404


def test_site_without_society_does_not_create_a_legacy_society_grant(db):
    site = Site(name="Legacy unscoped site", active=1, equipment_plan={})
    db.add(site)
    db.flush()
    user = SimpleNamespace(authorized_societies=[], authorized_sites=[site.id], global_society_access=False,
                           role="ops", access_level="H2")
    assert _attendance_selected_sites(db, user) == set()
    with pytest.raises(HTTPException) as denied:
        _attendance_selected_sites(db, user, site.id)
    assert denied.value.status_code == 403
