from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import event, select

from app.modules.attendance import core
from app.modules.attendance.models import AttendanceEvent, EVENT_ABANDON, SOURCE_SYSTEM
from app.modules.auth.models import User
from app.modules.brq import service
from app.modules.commercial.models import Client
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401
from tests.test_attendance_counted_time import ANCHOR, _scan, _setup, _ts


def _admin(db):
    return db.scalar(select(User).where(User.username == "testadmin"))


def _abandon(db, employee, site, at, *, threshold=60):
    event = AttendanceEvent(
        employee_id=employee.id,
        site_id=site.id,
        society=employee.society,
        presence_date=ANCHOR,
        event_type=EVENT_ABANDON,
        source=SOURCE_SYSTEM,
        occurred_at=core.to_utc_naive(at),
        data={
            "actual_departure_at": at.isoformat(),
            "scheduled_end_at": _ts(ANCHOR, "22:00").isoformat(),
            "threshold_minutes": threshold,
            "notifications": {},
        },
    )
    db.add(event)
    db.commit()
    return event


def test_situation_uses_planned_attendance_and_existing_abandon_event(db, monkeypatch):
    employee, site = _setup(db)
    _scan(db, employee, ANCHOR, "14:00")
    presence = db.scalar(select(DailyPresence).where(DailyPresence.employee_id == employee.id))
    assert presence.status == "present"

    _abandon(db, employee, site, _ts(ANCHOR, "21:00"))
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "23:00"))

    report = service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id)
    result = service.situation(report)
    assert result["kpis"]["effectif_prevu"] == 1
    assert result["kpis"]["presents"] == 1
    assert result["kpis"]["abandons_poste"] == 1
    assert result["kpis"]["effectif_disponible"] == 0
    assert result["kpis"]["couverture_pct"] == 0
    assert result["kpis"]["ecart"] == -1
    assert result["items"][0]["state"] == "present"
    assert result["items"][0]["available"] is False
    assert service.collection_items(report, "abandons-poste")[0]["abandon"]["threshold_minutes"] == 60


def test_sortants_report_skips_attendance_planning(db, monkeypatch):
    employee, site = _setup(db)
    employee.status = "sortant"
    employee.extra = {"dateSortie": ANCHOR.isoformat()}
    db.commit()

    def unexpected_planning(*_args, **_kwargs):
        pytest.fail("Le rapport sortants ne doit pas calculer le planning de présence")

    monkeypatch.setattr(core, "planned_day", unexpected_planning)
    report = service.build_report(
        db, _admin(db), day=ANCHOR, site_id=site.id, include_attendance=False,
    )

    assert report["items"] == []
    assert [item["employee_id"] for item in report["sortants"]] == [employee.id]


def test_non_sortant_report_skips_sortants_aggregation(db, monkeypatch):
    employee, site = _setup(db)
    monkeypatch.setattr(
        service, "_sortants",
        lambda *_args, **_kwargs: pytest.fail("Agrégation des sortants inutile pour cet écran"),
    )

    report = service.build_report(
        db, _admin(db), day=ANCHOR, site_id=site.id, include_sortants=False,
    )

    assert [item["employee_id"] for item in report["items"]] == [employee.id]
    assert report["sortants"] == []


def test_official_rotation_anchor_query_is_constant_for_multiple_assignments(db):
    employee, site = _setup(db)
    original_assignment = db.scalar(select(Assignment).where(Assignment.employee_id == employee.id))
    for index in range(4):
        additional = Employee(
            code=f"BRQ-PROFILE-{index}-{employee.code}",
            first_name="Profil",
            last_name=f"Employé {index}",
            society=employee.society,
            status="actif",
        )
        db.add(additional)
        db.flush()
        db.add(Assignment(
            employee_id=additional.id,
            site_id=site.id,
            rotation_id=original_assignment.rotation_id,
            group_code="B",
            start_date=original_assignment.start_date,
            active=1,
            work_regime=original_assignment.work_regime,
        ))
    db.commit()

    statements = []
    engine = db.get_bind()
    def count_site_rotation_query(_conn, _cursor, statement, _parameters, _context, _executemany):
        if "site_rotations" in statement.lower():
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", count_site_rotation_query)
    try:
        report = service.build_report(
            db, _admin(db), day=ANCHOR, site_id=site.id, include_sortants=False,
        )
    finally:
        event.remove(engine, "before_cursor_execute", count_site_rotation_query)

    assert len(report["items"]) == 5
    assert len(statements) == 1, (
        f"Expected one preloaded site rotation query for five posted assignments; got {len(statements)}"
    )


@pytest.mark.parametrize(("offset", "expected", "sortant"), [
    (-1, True, False),
    (0, False, True),
    (1, False, False),
])
def test_effective_exit_date_excludes_from_planned_and_lists_only_exact_day(db, offset, expected, sortant):
    employee, site = _setup(db)
    employee.status = "sortant"
    exit_day = date(2026, 10, 2)
    employee.extra = {"dateSortie": exit_day.isoformat()}
    db.commit()

    report = service.build_report(db, _admin(db), day=exit_day.fromordinal(exit_day.toordinal() + offset), site_id=site.id)
    row = next((item for item in report["items"] if item["employee_id"] == employee.id), None)
    assert (row is not None and row["expected"]) is expected
    exited = [item for item in report["sortants"] if item["employee_id"] == employee.id]
    assert bool(exited) is sortant
    if sortant:
        assert exited[0]["state"] == "sortie_effective"


def test_exit_without_effective_date_does_not_use_other_exit_fields(db):
    employee, site = _setup(db)
    employee.status = "sortant"
    employee.extra = {
        "finRelationAt": "2026-10-01",
        "departAt": "2026-10-01",
        "contract_end_date": "2026-10-01",
    }
    db.commit()

    report = service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id)

    incomplete = next(item for item in report["sortants"] if item["employee_id"] == employee.id)
    assert incomplete["state"] == "incomplet"
    assert report["date"] == ANCHOR
    assert incomplete["date_sortie"] is None
    assert service.situation(report)["kpis"]["sortants"] == 0


def test_inactive_employee_without_effective_exit_date_is_not_an_effective_sortant(db):
    employee, site = _setup(db)
    employee.status = "inactif"
    db.commit()
    report = service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id)
    assert all(item["employee_id"] != employee.id for item in report["sortants"])


def test_present_without_abandon_is_available_for_coverage(db, monkeypatch):
    employee, site = _setup(db)
    _scan(db, employee, ANCHOR, "14:00")
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "19:00"))

    result = service.situation(service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id))

    assert result["kpis"]["presents"] == 1
    assert result["kpis"]["effectif_disponible"] == 1
    assert result["kpis"]["couverture_pct"] == 100
    assert result["kpis"]["ecart"] == 0
    assert result["items"][0]["available"] is True


@pytest.mark.parametrize(("consultation_time", "available"), [
    ("19:00", True),
    ("20:35", False),
    ("21:00", False),
])
def test_abandon_changes_availability_at_its_actual_time_but_keeps_historical_presence(
    db, monkeypatch, consultation_time, available,
):
    employee, site = _setup(db)
    _scan(db, employee, ANCHOR, "14:00")
    _abandon(db, employee, site, _ts(ANCHOR, "20:35"))
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, consultation_time))

    result = service.situation(service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id))

    assert result["kpis"]["presents"] == 1
    assert result["kpis"]["abandons_poste"] == 1
    assert result["kpis"]["effectif_disponible"] == int(available)
    assert result["items"][0]["state"] == "present"
    assert result["items"][0]["available"] is available


def test_past_report_evaluates_availability_at_planned_shift_end(db, monkeypatch):
    employee, site = _setup(db)
    _scan(db, employee, ANCHOR, "14:00")
    _abandon(db, employee, site, _ts(ANCHOR, "20:35"))
    monkeypatch.setattr(core, "_now_local", lambda: _ts(date(2026, 10, 2), "08:00"))

    result = service.situation(service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id))

    assert result["kpis"]["presents"] == 1
    assert result["kpis"]["effectif_disponible"] == 0
    assert result["items"][0]["available"] is False


def test_multiple_abandons_on_one_site_are_aggregated_without_dropping_present_count(db, monkeypatch):
    employee, site = _setup(db)
    second_employee, second_site = _setup(db)
    second_assignment = db.scalar(select(Assignment).where(Assignment.employee_id == second_employee.id))
    second_assignment.site_id = site.id
    second_site.active = 0
    _scan(db, employee, ANCHOR, "14:00")
    _scan(db, second_employee, ANCHOR, "14:00")
    _abandon(db, employee, site, _ts(ANCHOR, "20:35"))
    _abandon(db, second_employee, site, _ts(ANCHOR, "21:00"))
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "23:00"))

    result = service.situation(service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id))

    assert result["kpis"]["effectif_prevu"] == 2
    assert result["kpis"]["presents"] == 2
    assert result["kpis"]["abandons_poste"] == 2
    assert result["kpis"]["effectif_disponible"] == 0
    assert result["kpis"]["couverture_pct"] == 0
    assert result["kpis"]["ecart"] == -2


def test_situation_provides_site_function_and_operational_sections(db, monkeypatch):
    employee, site = _setup(db)
    assignment = db.scalar(select(Assignment).where(Assignment.employee_id == employee.id))
    assignment.position = "Agent de sécurité"
    _scan(db, employee, ANCHOR, "14:00")
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "19:00"))
    db.commit()

    result = service.situation(service.build_report(db, _admin(db), day=ANCHOR, site_id=site.id))

    assert result["site_function"] == [{
        "site": site.name, "wilaya": site.wilaya or "", "fonction": "Agent de sécurité",
        "effectif_prevu": 1, "presents": 1, "absents": 0, "abandons_poste": 0,
        "effectif_disponible": 1,
    }]
    assert result["absence_items"] == []
    assert result["abandon_items"] == []
    assert result["sortant_items"] == []


def test_report_filters_by_real_client_site_function_and_planned_vacation(db):
    employee, site = _setup(db)
    assignment = db.scalar(select(Assignment).where(Assignment.employee_id == employee.id))
    assignment.position = "Agent de sécurité"
    client = Client(name=f"Client BRQ {employee.id}", society=employee.society, status="actif")
    db.add(client)
    db.flush()
    site.client_id = client.id
    db.commit()

    report = service.build_report(
        db, _admin(db), day=ANCHOR,
        client=client.name, site=site.name, fonction="Agent", vacation="14:00",
    )
    assert [item["employee_id"] for item in report["items"]] == [employee.id]
    assert report["items"][0]["client"] == client.name
    assert report["filters"]["client"] == client.name
    assert report["filters"]["site"] == site.name

    excluded = service.build_report(
        db, _admin(db), day=ANCHOR, site_id=site.id, fonction="Autre fonction",
    )
    assert excluded["items"] == []


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


def test_brq_export_route_is_not_registered(client, auth_headers):
    response = client.get(
        "/api/brq/export",
        headers=auth_headers,
        params={"view": "situation", "date": ANCHOR.isoformat()},
    )
    assert response.status_code == 404
