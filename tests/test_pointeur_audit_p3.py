"""Audit pointeur.irongs.com — P3 : entrées mal typées, libellés du flux (non-régression)."""
import uuid
from datetime import date, timedelta

import pytest

from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "IRON GLOBAL SOLUTION"


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _employee_on_site(db):
    site = Site(name=f"P3 {_tag()}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    employee = Employee(code=f"P3{_tag()}", first_name="Agent", last_name="Test", society=SOC, status="actif")
    db.add(employee); db.flush()
    db.add(Assignment(employee_id=employee.id, site_id=site.id, start_date=date.today() - timedelta(days=30), active=1))
    db.commit()
    return employee, site


@pytest.mark.parametrize("site_id", [{"id": 1}, [1], "abc", True, 1.5])
def test_malformed_site_id_is_a_clean_422_never_a_500(client, auth_headers, db, site_id):
    employee, _site = _employee_on_site(db)
    response = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": employee.id, "site_id": site_id})
    assert response.status_code == 422, (site_id, response.status_code, response.text)


def test_valid_site_id_as_text_is_still_accepted(client, auth_headers, db):
    employee, site = _employee_on_site(db)
    response = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": employee.id, "site_id": str(site.id)})
    assert response.status_code == 201, response.text


def test_feed_exit_type_is_only_set_on_departures(client, auth_headers, db):
    employee, site = _employee_on_site(db)
    assert client.post("/api/portal/attendance-manual/scan", headers=auth_headers,
                       json={"employee_id": employee.id, "site_id": site.id}).status_code == 201
    rows = [row for row in client.get("/api/portal/attendance-feed", headers=auth_headers, params={"site_id": site.id}).json()
            if row["employee_id"] == employee.id]
    assert rows and rows[0]["action"] == "arrivee" and rows[0]["exit_type"] == ""


def test_absence_observation_is_bounded_like_scan_observations(client, auth_headers, db):
    employee, site = _employee_on_site(db)
    response = client.post("/api/portal/attendance-manual/scan", headers=auth_headers,
                           json={"employee_id": employee.id, "site_id": site.id, "action": "absent", "observation": "x" * 5000})
    assert response.status_code == 201, response.text
    row = db.query(DailyPresence).filter(DailyPresence.employee_id == employee.id).one()
    assert len(row.notes or "") <= 500
