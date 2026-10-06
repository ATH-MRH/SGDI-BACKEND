from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.modules.attendance import core
from app.modules.attendance.models import AttendanceEvent, EVENT_ABANDON, SOURCE_SYSTEM
from app.modules.auth.models import User
from app.modules.brq import service
from app.modules.ops.models import DailyPresence
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401
from tests.test_attendance_counted_time import ANCHOR, _scan, _setup, _ts


def _admin(db):
    return db.scalar(select(User).where(User.username == "testadmin"))


def test_situation_uses_planned_attendance_and_existing_abandon_event(db, monkeypatch):
    employee, site = _setup(db)
    _scan(db, employee, ANCHOR, "14:00")
    presence = db.scalar(select(DailyPresence).where(DailyPresence.employee_id == employee.id))
    assert presence.status == "present"

    event = AttendanceEvent(
        employee_id=employee.id,
        site_id=site.id,
        society=employee.society,
        presence_date=ANCHOR,
        event_type=EVENT_ABANDON,
        source=SOURCE_SYSTEM,
        occurred_at=core.to_utc_naive(_ts(ANCHOR, "21:00")),
        data={
            "actual_departure_at": _ts(ANCHOR, "21:00").isoformat(),
            "scheduled_end_at": _ts(ANCHOR, "22:00").isoformat(),
            "threshold_minutes": 60,
            "notifications": {},
        },
    )
    db.add(event)
    db.commit()
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "23:00"))

    report = service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id)
    result = service.situation(report)
    assert result["kpis"]["effectif_prevu"] == 1
    assert result["kpis"]["presents"] == 1
    assert result["kpis"]["abandons_poste"] == 1
    assert service.collection_items(report, "abandons-poste")[0]["abandon"]["threshold_minutes"] == 60


def test_exit_date_is_included_on_the_effective_day_and_excluded_after(db):
    employee, site = _setup(db)
    employee.status = "sortant"
    employee.extra = {"dateSortie": ANCHOR.isoformat()}
    db.commit()

    day_of_exit = service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id)
    assert day_of_exit["items"][0]["expected"] is True
    exited = next(item for item in day_of_exit["sortants"] if item["employee_id"] == employee.id)
    assert exited["state"] == "sortie_effective"

    next_day = service.build_report(db, _admin(db), day=date(2026, 10, 2), site_id=site.id)
    assert next_day["items"] == []


def test_undated_inactive_employee_is_not_reported_as_a_daily_exit(db):
    employee, site = _setup(db)
    employee.status = "inactif"
    db.commit()

    report = service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id)
    assert all(item["employee_id"] != employee.id for item in report["sortants"])


def test_exit_status_without_effective_date_is_listed_as_incomplete_not_effective(db):
    employee, site = _setup(db)
    employee.status = "sortant"
    db.commit()

    report = service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id)

    incomplete = next(item for item in report["sortants"] if item["employee_id"] == employee.id)
    assert incomplete["state"] == "incomplet"
    assert report["date"] == ANCHOR
    assert service.situation(report)["kpis"]["sortants"] == 0


def test_abandon_events_respect_the_authorized_society_scope(db):
    employee, site = _setup(db)
    site.equipment_plan = {}
    db.add(AttendanceEvent(
        employee_id=employee.id,
        site_id=site.id,
        society="Société non autorisée",
        presence_date=ANCHOR,
        occurred_at=core.to_utc_naive(_ts(ANCHOR, "21:00")),
        event_type=EVENT_ABANDON,
        source=SOURCE_SYSTEM,
        data={"actual_departure_at": _ts(ANCHOR, "21:00").isoformat()},
    ))
    db.commit()
    user = SimpleNamespace(
        authorized_sites=[],
        authorized_societies=[employee.society],
        global_society_access=False,
    )

    report = service.build_report(db, user, day=ANCHOR, site_id=site.id)

    assert report["abandon_events"] == []
    assert report["abandon_rows"] == []


def test_unknown_schedule_is_not_classified_as_absence(db, monkeypatch):
    employee, site = _setup(db, linked=False)
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "23:00"))
    report = service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id)
    assert report["items"][0]["state"] == "planning_non_defini"
    assert service.situation(report)["kpis"]["absents"] == 0


@pytest.mark.parametrize("path", [
    "/api/brq/situation",
    "/api/brq/presences",
    "/api/brq/absences",
    "/api/brq/abandons-poste",
    "/api/brq/sortants",
])
def test_brq_get_routes_are_mounted_and_module_scoped(client, auth_headers, restricted_headers, path):
    response = client.get(path, headers=auth_headers, params={"date": ANCHOR.isoformat()})
    assert response.status_code == 200, response.text
    assert response.json()["date"] == ANCHOR.isoformat()

    denied = client.get(path, headers=restricted_headers, params={"date": ANCHOR.isoformat()})
    assert denied.status_code == 403


def test_brq_export_is_read_only_export_action(client, auth_headers):
    response = client.get(
        "/api/brq/export",
        headers=auth_headers,
        params={"view": "situation", "date": ANCHOR.isoformat()},
    )
    assert response.status_code == 200, response.text
    assert response.json()["view"] == "situation"
    assert isinstance(response.json()["items"], list)
    assert client.post("/api/brq/export", headers=auth_headers).status_code == 405
