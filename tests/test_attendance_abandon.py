"""Abandon : seuil serveur, atomicité, idempotence, RBAC, BRQ et nuit."""
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.attendance import abandon, core
from app.modules.attendance.models import AttendanceEvent, EVENT_ABANDON
from app.modules.alerts.models import Alert, AlertEvidence
from app.modules.auth.models import AuditEvent, User
from app.modules.ops.models import DailyPresence
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401
from tests.test_attendance_counted_time import ANCHOR, NEXT, _setup, _scan, _ts, _events, _tag

ACTOR = SimpleNamespace(id=None, username="POINTEUR", role="pointeur")


@pytest.fixture(scope="module", autouse=True)
def clean_created_alerts():
    # Les alertes référencent un source_id textuel, sans cascade employé.
    from sqlalchemy import delete, func
    from tests.conftest import TestSessionLocal
    with TestSessionLocal() as session:
        mark = session.scalar(select(func.max(Alert.id))) or 0
    yield
    with TestSessionLocal() as session:
        session.execute(delete(Alert).where(Alert.id > mark))
        session.commit()


def _record(db, emp, shift, at, **kwargs):
    return core.record_scan(db, employee=emp, source="MANUAL", actor=ACTOR, idempotency_key=None,
                           abandon_shift_id=shift, now=at, observation=kwargs.pop("observation", "Quitte le site"),
                           manual_entry_allowed=kwargs.pop("allowed", True), **kwargs)


def _started(db, **options):
    emp, site = _setup(db, **options)
    _scan(db, emp, ANCHOR, "22:00" if options.get("group") == "C" else "14:00")
    return emp, site, _events(db, emp)[-1].id


@pytest.mark.parametrize("departure,accepted,remaining", [
    ("21:00", True, 60), ("20:59", True, 61), ("21:01", False, 59),
    ("21:00:01", False, 59), ("22:01", False, None)])
def test_server_threshold(db, departure, accepted, remaining):
    emp, site, shift = _started(db)
    if accepted:
        result = _record(db, emp, shift, _ts(ANCHOR, departure))
        assert result["remaining_minutes"] == remaining
        events = _events(db, emp)
        assert [e.event_type for e in events] == ["ARRIVAL", "DEPARTURE", EVENT_ABANDON]
        presence = db.scalar(select(DailyPresence).where(DailyPresence.employee_id == emp.id))
        assert presence.status == "present" and presence.arrival_time == "P"
        assert core.to_local(events[0].occurred_at) == _ts(ANCHOR, "14:00")
        assert presence.data["_legacy"]["scanArrivee"] == "14:00:00"
        assert presence.departure_time == departure + ":00"
        assert events[1].data["counted"]["counted_end"] == result["actual_departure_at"]
    else:
        with pytest.raises(HTTPException) as exc:
            _record(db, emp, shift, _ts(ANCHOR, departure))
        assert exc.value.status_code == 409
        assert [e.event_type for e in _events(db, emp)] == ["ARRIVAL"]


def test_no_arrival_and_no_valid_vacation(db):
    emp, _ = _setup(db)
    with pytest.raises(HTTPException, match="prise de service"):
        abandon.context(db, emp, now=_ts(ANCHOR, "20:00"))
    emp, _ = _setup(db, linked=False)
    _scan(db, emp, ANCHOR, "14:00")
    with pytest.raises(HTTPException, match="vacation valide"):
        abandon.context(db, emp, now=_ts(ANCHOR, "20:00"))


@pytest.mark.parametrize("reason,allowed,code", [("   ", True, 422), ("Départ", False, 403)])
def test_core_permission_and_reason(db, reason, allowed, code):
    emp, _, shift = _started(db)
    with pytest.raises(HTTPException) as exc:
        _record(db, emp, shift, _ts(ANCHOR, "20:00"), observation=reason, allowed=allowed)
    assert exc.value.status_code == code
    assert len(_events(db, emp)) == 1


def test_duplicate_and_durable_notifications_audit_brq(db):
    emp, site, shift = _started(db)
    result = _record(db, emp, shift, _ts(ANCHOR, "20:35"))
    retry = _record(db, emp, shift, _ts(ANCHOR, "22:30"))
    assert retry["duplicate"] and retry["event_id"] == result["event_id"]
    assert len(_events(db, emp)) == 3
    assert result["remaining_minutes"] == 85
    for audience in ("OPS", "DRH"):
        notification = result["notifications"][audience]
        alert = db.get(Alert, notification["alert_id"])
        assert notification["status"] == "CREATED" and alert.site_id == site.id
        assert "ABANDON DE POSTE" in alert.title and "Quitte le site" in alert.summary
        evidence = db.scalar(select(AlertEvidence).where(AlertEvidence.alert_id == alert.id))
        assert evidence.evidence_value_json["event_type"] == EVENT_ABANDON
    audit = db.scalar(select(AuditEvent).where(AuditEvent.action == "attendance.abandon_poste",
                                              AuditEvent.resource_id == str(result["event_id"])))
    state = json.loads(audit.new_state)
    assert state["shift_id"] == shift and state["remaining_minutes"] == 85
    assert state["observation"] == "Quitte le site" and state["recorded_by_role"] == "pointeur"
    from app.modules.attendance.routes import business_events
    admin = db.scalar(select(User).where(User.username == "testadmin"))
    brq = business_events(day=ANCHOR, employee_id=emp.id, society=emp.society, site_id=site.id,
                          page=1, page_size=50, db=db, user=admin)
    assert brq["total"] == 1 and brq["items"][0]["event_id"] == result["event_id"]
    assert business_events(day=NEXT, employee_id=emp.id, page=1, page_size=50, db=db, user=admin)["total"] == 0


def test_night_shift_uses_full_dates(db):
    emp, _, shift = _started(db, group="C")
    result = _record(db, emp, shift, _ts(NEXT, "04:30"))
    assert result["remaining_minutes"] == 90
    event = db.get(AttendanceEvent, result["event_id"])
    assert event.presence_date == ANCHOR
    assert result["actual_departure_at"].startswith(NEXT.isoformat())
    from app.modules.attendance.routes import business_events
    admin = db.scalar(select(User).where(User.username == "testadmin"))
    brq = business_events(day=NEXT, employee_id=emp.id, page=1, page_size=50, db=db, user=admin)
    assert brq["total"] == 1 and brq["items"][0]["presence_date"] == ANCHOR.isoformat()


def test_threshold_configurable_and_server_recalculates(db, monkeypatch):
    emp, _, shift = _started(db)
    ctx = abandon.context(db, emp, now=_ts(ANCHOR, "20:59"))
    assert ctx["applicable"]
    with pytest.raises(HTTPException):
        _record(db, emp, shift, _ts(ANCHOR, "21:01"))
    monkeypatch.setattr(core.settings, "attendance_abandon_threshold_minutes", 90)
    with pytest.raises(HTTPException):
        _record(db, emp, shift, _ts(ANCHOR, "20:31"))
    assert _record(db, emp, shift, _ts(ANCHOR, "20:30"))["threshold_minutes"] == 90


def test_wrong_shift_closed_presence_or_company(db):
    emp, site, shift = _started(db)
    with pytest.raises(HTTPException):
        _record(db, emp, shift+100, _ts(ANCHOR, "20:00"))
    site.equipment_plan = {"societe": "Autre société"}; db.commit()
    with pytest.raises(HTTPException, match="Société"):
        _record(db, emp, shift, _ts(ANCHOR, "20:00"))
    site.equipment_plan = {"societe": emp.society}
    presence = db.scalar(select(DailyPresence).where(DailyPresence.employee_id == emp.id))
    presence.closed_at = core.to_utc_naive(_ts(ANCHOR, "20:00")); db.commit()
    with pytest.raises(HTTPException, match="clôturée"):
        _record(db, emp, shift, _ts(ANCHOR, "20:00"))


def test_endpoint_validation_and_server_time(client, auth_headers, db, monkeypatch):
    emp, site, shift = _started(db)
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "20:35"))
    url = "/api/portal/attendance-manual/abandon"
    payload = {"employee_id": emp.id, "site_id": site.id, "society": emp.society,
               "shift_id": shift, "observation": "Départ constaté", "actual_departure_at": "1900-01-01T00:00:00"}
    assert client.post(url, json=payload).status_code == 401
    assert client.post(url, headers=auth_headers, json={**payload, "employee_id": 99999999}).status_code == 404
    assert client.post(url, headers=auth_headers, json={**payload, "observation": "  "}).status_code == 422
    assert client.post(url, headers=auth_headers, json={**payload, "society": "Autre"}).status_code == 409
    assert client.post(url, headers=auth_headers, json={**payload, "site_id": 99999999}).status_code == 409
    result = client.post(url, headers=auth_headers, json=payload)
    assert result.status_code == 201, result.text
    assert result.json()["actual_departure_at"] == _ts(ANCHOR, "20:35").isoformat()
    assert client.post(url, headers=auth_headers, json=payload).json()["duplicate"]


def test_notifications_failure_rolls_back_departure_and_business_event(db, monkeypatch):
    emp, _, shift = _started(db)
    from app.modules.alerts import repository
    real = repository.ensure_rule_catalog
    def fail(db, **options):
        real(db, **options)
        raise RuntimeError("Notification indisponible")
    monkeypatch.setattr(repository, "ensure_rule_catalog", fail)
    with pytest.raises(RuntimeError):
        _record(db, emp, shift, _ts(ANCHOR, "20:35"))
    db.rollback()
    assert [e.event_type for e in _events(db, emp)] == ["ARRIVAL"]
    presence = db.scalar(select(DailyPresence).where(DailyPresence.employee_id == emp.id))
    assert not presence.departure_time
    monkeypatch.setattr(repository, "ensure_rule_catalog", real)
    assert _record(db, emp, shift, _ts(ANCHOR, "20:36"))["success"]


def test_rbac_real_feature_grant_and_scoped_reads(client, db, monkeypatch):
    from app.core.security import create_access_token, hash_password
    from app.core.granular_permissions import replace_feature_permissions
    from app.modules.auth.schemas import FeaturePermissionIn
    from app.modules.attendance.routes import business_events
    emp, site, shift = _started(db)
    _other, other_site = _setup(db)
    user = User(username="AB"+_tag(), full_name="Pointeur test", role="pointeur", access_level="H2", is_active=True,
                supervisor_read_only=False,
                password_hash=hash_password("testpass123"), authorized_societies=[emp.society],
                authorized_sites=[other_site.id], authorized_modules=["pointeur"], authorized_structures=["pointage"])
    db.add(user); db.commit()
    headers = {"Authorization": "Bearer "+create_access_token(subject=str(user.id))}
    monkeypatch.setattr(core, "_now_local", lambda: _ts(ANCHOR, "20:35"))
    payload = {"employee_id": emp.id, "site_id": site.id, "shift_id": shift, "observation": "Motif"}
    url = "/api/portal/attendance-manual/abandon"
    assert client.post(url, headers=headers, json=payload).status_code == 403
    replace_feature_permissions(db, user_id=user.id, permissions=[FeaturePermissionIn(
        module_key="attendance", feature_key="manual_entry", action_key="create")], created_by_user_id=None)
    db.commit()
    assert client.post(url, headers=headers, json=payload).status_code == 403
    user.authorized_sites=[site.id]; db.commit()
    result = client.post(url, headers=headers, json=payload)
    assert result.status_code == 201, result.text
    # Même société, autre site : aucune fuite par lecture BRQ ni cockpit.
    user.role="ops"; user.authorized_modules=["ops"]; user.authorized_structures=["ops"]
    user.authorized_sites=[other_site.id]; db.commit()
    scoped = business_events(employee_id=emp.id, page=1, page_size=50, db=db, user=user)
    assert scoped["total"] == 0
    from app.modules.alerts.routes import list_alerts
    from app.modules.alerts.rules import ABANDON_RULES
    for audience, role in (("OPS", "ops"), ("DRH", "drh")):
        user.role=role; user.authorized_modules=[role]; user.authorized_structures=[role]; user.authorized_sites=[site.id]; db.commit()
        response = client.get("/api/alerts", headers=headers, params={"module": role, "rule_key": ABANDON_RULES[audience]})
        assert response.status_code == 200, response.text
        assert any(row["id"] == result.json()["notifications"][audience]["alert_id"] for row in response.json()["items"])


def test_parallel_confirmations_create_one_departure_one_abandon(db):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from tests.conftest import TestSessionLocal
    from app.modules.drh.models import Employee
    emp, _, shift = _started(db)
    employee_id = emp.id
    barrier = Barrier(2)
    def confirm():
        with TestSessionLocal() as session:
            employee = session.get(Employee, employee_id)
            barrier.wait(timeout=10)
            return _record(session, employee, shift, _ts(ANCHOR, "20:35"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: confirm(), range(2)))
    assert sorted(r["duplicate"] for r in results) == [False, True]
    assert results[0]["event_id"] == results[1]["event_id"]
    db.expire_all()
    assert [e.event_type for e in _events(db, emp)] == ["ARRIVAL", "DEPARTURE", EVENT_ABANDON]


def test_arrival_before_planned_start_is_not_a_started_shift(db):
    emp, _ = _setup(db)
    _scan(db, emp, ANCHOR, "13:40")
    shift = _events(db, emp)[-1].id
    with pytest.raises(HTTPException, match="non commencée"):
        _record(db, emp, shift, _ts(ANCHOR, "13:50"))
    assert len(_events(db, emp)) == 1


def test_expired_assignment_refused(db):
    from datetime import timedelta
    emp, _, shift = _started(db)
    assignment = core.active_assignment(db, emp.id)
    assignment.end_date = ANCHOR - timedelta(days=1); db.commit()
    with pytest.raises(HTTPException, match="Affectation non valide"):
        _record(db, emp, shift, _ts(ANCHOR, "20:35"))
