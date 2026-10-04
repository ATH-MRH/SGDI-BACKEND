"""Socle officiel du travail posté 24h/24 (lot 0) : régime explicite porté par l'affectation,
modèle 3x8 continu 2/2/2/2, source officielle `official.official_shift`."""
import importlib.util
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.modules.attendance import core, deviations, official
from app.modules.attendance.models import DECISION_PERMANENT, AttendanceAnomaly, RotationGroup, RotationMembership
from app.modules.auth.models import AuditEvent
from app.modules.drh.models import Employee
from app.modules.irongs import sql_bridge
from app.modules.ops import service as ops_service
from app.modules.ops.models import Assignment, DailyPresence, RotationTemplate, Site, SiteRotation
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

TZ = ZoneInfo("Africa/Algiers")
SOC = "Iron Global Securite"
ANCHOR = date(2026, 10, 1)                       # J1 du groupe A sur le site de test
CYCLE = ["MATIN", "MATIN", "APRES_MIDI", "APRES_MIDI", "NUIT", "NUIT", "OFF", "OFF"]


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db, *, linked=True, rotation_system=None):
    site = Site(name=f"Site posté {_tag()}", active=1, equipment_plan={"societe": SOC}, rotation_system=rotation_system)
    db.add(site); db.flush()
    if linked:
        db.add(SiteRotation(site_id=site.id, rotation_id=official.ensure_official_model(db).id, start_date=ANCHOR, active=1))
        db.flush()
    return site


def _employee(db):
    emp = Employee(code=f"OS{_tag()}", first_name="Test", last_name="Posté", society=SOC, status="actif")
    db.add(emp); db.flush()
    return emp


def _assign(db, emp, site, *, regime=None, group="A", start=date(2026, 1, 1), rotation=None):
    model = official.ensure_official_model(db)
    row = Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=start, active=1, work_regime=regime,
                     rotation_id=rotation.id if rotation else (model.id if regime == official.REGIME_POSTE_CONTINU else None))
    db.add(row); db.flush()
    return row


def _posted(db, group="A", site=None):
    site = site or _site(db)
    emp = _employee(db)
    row = _assign(db, emp, site, regime=official.REGIME_POSTE_CONTINU, group=group)
    db.commit()
    return emp, site, row


def _at(day, hhmm):
    return datetime.combine(day, datetime.strptime(hhmm, "%H:%M").time(), TZ)


def _shift(db, emp, site, day, hhmm="12:00"):
    return official.official_shift(db, employee_id=emp.id, site_id=site.id, at=_at(day, hhmm))


# ── Cycle (fonctions pures) ──────────────────────────────────────────────────────────────
def test_official_cycle_is_2_2_2_2_with_480_minute_shifts():
    assert [official.shift_of(day) for day in official.OFFICIAL_CYCLE_DAYS] == CYCLE
    assert official.SHIFT_TIMES == {"MATIN": ("06:00", "14:00"), "APRES_MIDI": ("14:00", "22:00"), "NUIT": ("22:00", "06:00")}
    for day in official.OFFICIAL_CYCLE_DAYS:
        if official.shift_of(day) != "OFF":
            assert (official._minutes(day["end_time"]) - official._minutes(day["start_time"])) % 1440 == 480


def test_group_offsets_are_derived_from_the_coverage_property():
    """Recherche exhaustive : les seuls décalages couvrant chaque vacation sont 2 / 4 / 6 jours
    (dans n'importe quel ordre) pour les trois autres groupes ; ceux du modèle en font partie."""
    found = official.compatible_offsets()
    assert len(found) == 6
    assert all(sorted(offsets.values()) == [0, 2, 4, 6] for offsets in found)
    assert official.OFFICIAL_GROUP_OFFSETS in found
    assert not official.covers_continuously(official.OFFICIAL_CYCLE_DAYS, {"A": 0, "B": 1, "C": 2, "D": 3})
    assert not official.covers_continuously(official.OFFICIAL_CYCLE_DAYS, {"A": 0, "B": 2, "C": 4, "D": 4})


def test_migration_seeds_the_same_model_as_the_service():
    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "20261009_0001_assignment_work_regime.py"
    spec = importlib.util.spec_from_file_location("lot0_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.CYCLE_DAYS == official.OFFICIAL_CYCLE_DAYS
    assert migration.GROUP_OFFSETS == official.OFFICIAL_GROUP_OFFSETS
    assert (migration.MODEL_CODE, migration.MODEL_NAME) == (official.OFFICIAL_MODEL_CODE, official.OFFICIAL_MODEL_NAME)


# ── A / B : cycle du groupe A ────────────────────────────────────────────────────────────
def test_a_group_a_full_cycle_over_8_days(db):
    emp, site, _ = _posted(db, "A")
    plans = [_shift(db, emp, site, ANCHOR + timedelta(days=i)) for i in range(8)]
    assert [p["shift"] for p in plans] == CYCLE
    assert [p["cycle_day"] for p in plans] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert [p["normal_minutes"] for p in plans] == [480] * 6 + [0, 0]
    morning = plans[0]
    assert (morning["scheduled_start"], morning["scheduled_end"]) == (_at(ANCHOR, "06:00"), _at(ANCHOR, "14:00"))
    assert plans[2]["scheduled_start"] == _at(ANCHOR + timedelta(days=2), "14:00")
    assert all(p["regime"] == "POSTE_CONTINU" and p["group"] == "A" and p["official"] for p in plans)
    assert morning["model"]["code"] == official.OFFICIAL_MODEL_CODE and morning["model"]["version"] == 1
    assert morning["model"]["anchor_date"] == ANCHOR


def test_b_day_9_repeats_day_1(db):
    emp, site, _ = _posted(db, "A")
    for i in range(8):
        first, again = _shift(db, emp, site, ANCHOR + timedelta(days=i)), _shift(db, emp, site, ANCHOR + timedelta(days=i + 8))
        assert (again["shift"], again["cycle_day"]) == (first["shift"], first["cycle_day"])
    assert _shift(db, emp, site, ANCHOR + timedelta(days=8))["cycle_day"] == 1


# ── C : couverture par les quatre groupes ────────────────────────────────────────────────
def test_c_four_groups_cover_every_day_over_several_cycles(db):
    site = _site(db)
    people = {group: _posted(db, group, site)[0] for group in official.GROUPS}
    for i in range(40):                                               # cinq cycles complets
        day = ANCHOR + timedelta(days=i)
        shifts = {group: _shift(db, emp, site, day)["shift"] for group, emp in people.items()}
        assert sorted(shifts.values()) == ["APRES_MIDI", "MATIN", "NUIT", "OFF"], (day, shifts)
    assert {g: _shift(db, e, site, ANCHOR)["shift"] for g, e in people.items()} == {"A": "MATIN", "B": "APRES_MIDI", "C": "NUIT", "D": "OFF"}


def test_c_every_instant_has_exactly_one_group_on_duty(db):
    site = _site(db)
    people = [_posted(db, group, site)[0] for group in official.GROUPS]
    moment, end = _at(ANCHOR + timedelta(days=1), "06:00"), _at(ANCHOR + timedelta(days=17), "06:00")
    while moment < end:
        on_duty = [p for p in (official.official_shift(db, employee_id=e.id, site_id=site.id, at=moment) for e in people) if p["in_progress"]]
        assert len(on_duty) == 1, moment
        moment += timedelta(hours=1, minutes=7)


# ── D : la Nuit traverse minuit ──────────────────────────────────────────────────────────
def test_d_night_shift_crosses_midnight_as_one_shift(db):
    emp, site, _ = _posted(db, "A")
    night = ANCHOR + timedelta(days=4)                                # J5 : première Nuit
    before, after = _shift(db, emp, site, night, "23:30"), _shift(db, emp, site, night + timedelta(days=1), "03:00")
    for plan in (before, after):
        assert plan["shift"] == "NUIT" and plan["cycle_day"] == 5 and plan["work_date"] == night
        assert plan["scheduled_start"] == _at(night, "22:00") and plan["scheduled_end"] == _at(night + timedelta(days=1), "06:00")
        assert plan["normal_minutes"] == 480 and plan["in_progress"] is True
    assert (plan := _shift(db, emp, site, night, "21:48"))["cycle_day"] == 5 and plan["in_progress"] is False
    # 06:00 : la Nuit de J5 est finie ; la journée civile suivante porte la Nuit de J6 (22:00).
    second = _shift(db, emp, site, night + timedelta(days=1), "06:00")
    assert second["cycle_day"] == 6 and second["scheduled_start"] == _at(night + timedelta(days=1), "22:00")
    # Fin de la seconde Nuit puis repos : 03:00 appartient encore à J6, 10:00 est le OFF de J7.
    assert _shift(db, emp, site, night + timedelta(days=2), "03:00")["cycle_day"] == 6
    assert _shift(db, emp, site, night + timedelta(days=2), "10:00")["shift"] == "OFF"


def test_off_day_is_explicit_not_unknown(db):
    emp, site, _ = _posted(db, "A")
    plan = _shift(db, emp, site, ANCHOR + timedelta(days=6))
    assert plan["status"] == "OFFICIAL" and plan["shift"] == "OFF" and plan["working"] is False
    assert plan["normal_minutes"] == 0 and plan["scheduled_start"] is None and plan["scheduled_end"] is None
    assert plan["cycle_day"] == 7 and plan["in_progress"] is False


# ── E / F / G / H : régimes ──────────────────────────────────────────────────────────────
def test_e_posted_employee_gets_the_official_planning_everywhere(db):
    emp, site, row = _posted(db, "B")
    plan = _shift(db, emp, site, ANCHOR)
    assert (plan["regime"], plan["regime_label"], plan["shift"]) == ("POSTE_CONTINU", "Travail posté 24h/24", "APRES_MIDI")
    # Les lecteurs historiques lisent la même vérité (cycle ancré par site, pas par date d'affectation).
    assert core.planned_day(db, row, site, ANCHOR) == {"known": True, "on": True, "period": "apres_midi", "start_time": "14:00", "end_time": "22:00"}
    assert core.planned_day(db, row, site, ANCHOR + timedelta(days=4))["on"] is False
    assert core.authorized_work_minutes(db, row, site, ANCHOR) == 480
    rot = ops_service.assignment_rotation_for_date(db, row, site, db.get(RotationTemplate, row.rotation_id), ANCHOR + timedelta(days=2))
    assert (rot["on"], rot["period"], rot["cycle_day"]) == (True, "nuit", 5)


def test_f_normal_regime_is_not_handled_by_the_3x8_engine(db):
    site, emp = _site(db), _employee(db)
    row = _assign(db, emp, site, regime=official.REGIME_NORMAL, group="A")
    db.commit()
    plan = _shift(db, emp, site, ANCHOR)
    assert plan["status"] == "NORMAL" and plan["regime"] == "NORMAL" and plan["official"] is False
    assert plan["shift"] is None and plan["group"] is None and plan["scheduled_start"] is None and plan["normal_minutes"] is None
    assert official.legacy_rotation(db, row, ANCHOR) is None


def test_g_legacy_assignment_keeps_its_behaviour(db):
    site, emp = _site(db, linked=False, rotation_system="3x8"), _employee(db)
    row = _assign(db, emp, site, group="B", start=ANCHOR)
    db.commit()
    plan = _shift(db, emp, site, ANCHOR)
    assert plan["status"] == "LEGACY" and plan["regime"] is None and plan["official"] is False and plan["shift"] is None
    for i in range(8):                                                # moteur historique 1/1/1/1, strictement inchangé
        day = ANCHOR + timedelta(days=i)
        legacy = ops_service.rotation_for_date("3x8", "B", day, ANCHOR)
        assert ops_service.assignment_rotation_for_date(db, row, site, None, day) == legacy
        assert core.planned_day(db, row, site, day)["period"] == legacy["period"]
    assert core.authorized_work_minutes(db, row, site, ANCHOR) == 480
    template = RotationTemplate(code=f"R{_tag()}", name="Historique", cycle_length=1, active=1, group_offsets={},
                                cycle_days=[{"status": "travail", "start_time": "07:00", "end_time": "19:00"}])
    db.add(template); db.flush()
    row.rotation_id = template.id
    assert core.planned_day(db, row, site, ANCHOR)["start_time"] == "07:00"
    assert core.authorized_work_minutes(db, row, site, ANCHOR) == 720


def test_h_group_code_alone_never_activates_posted_regime(db):
    site = _site(db, rotation_system="3x8")                            # modèle officiel pourtant en service sur le site
    for group in official.GROUPS:
        emp = _employee(db)
        row = _assign(db, emp, site, group=group)
        plan = _shift(db, emp, site, ANCHOR)
        assert plan["status"] == "LEGACY" and plan["official"] is False and not official.is_posted(row)
    # Même avec le modèle officiel référencé : sans régime explicite, rien n'est activé.
    emp = _employee(db)
    row = _assign(db, emp, site, group="A", rotation=official.ensure_official_model(db))
    assert _shift(db, emp, site, ANCHOR)["status"] == "LEGACY" and official.legacy_rotation(db, row, ANCHOR) is None


def test_posted_assignment_requires_explicit_group_and_model_in_database(db):
    site, emp = _site(db), _employee(db)
    db.commit()
    for values in ({"group_code": "A", "rotation_id": None}, {"group_code": "E", "rotation_id": official.ensure_official_model(db).id}):
        db.add(Assignment(employee_id=emp.id, site_id=site.id, start_date=ANCHOR, active=1, work_regime="POSTE_CONTINU", **values))
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, start_date=ANCHOR, active=1, work_regime="3X8"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_no_assignment_and_unanchored_site_are_reported_not_guessed(db):
    emp, site, _ = _posted(db, "A")
    other = _site(db, linked=False)
    db.commit()
    assert official.official_shift(db, employee_id=emp.id, site_id=other.id, at=_at(ANCHOR, "12:00"))["status"] == "NO_ASSIGNMENT"
    before = _shift(db, emp, site, ANCHOR - timedelta(days=3))        # avant la mise en service du modèle sur le site
    assert before["status"] == "ROTATION_NOT_CONFIGURED" and before["official"] is False and before["shift"] is None
    assert before["regime"] == "POSTE_CONTINU" and before["group"] == "A"
    assert core.planned_day(db, db.get(Assignment, before["assignment_id"]), site, ANCHOR - timedelta(days=3))["known"] is False


def test_naive_datetime_is_site_local_time(db):
    emp, site, _ = _posted(db, "A")
    naive = official.official_shift(db, employee_id=emp.id, site_id=site.id, at=datetime(2026, 10, 1, 13, 59))
    assert naive["shift"] == "MATIN" and naive["in_progress"] is True
    utc = official.official_shift(db, employee_id=emp.id, site_id=site.id, at=datetime(2026, 10, 1, 13, 30, tzinfo=ZoneInfo("UTC")))
    assert utc["in_progress"] is False                                # 14:30 à Alger : la vacation du Matin est terminée


# ── I : le Planning intelligent n'écrit jamais l'officiel ────────────────────────────────
def test_i_intelligent_planning_never_changes_the_official_regime(db):
    emp, site, row = _posted(db, "A")
    db.add(RotationGroup(site_id=site.id, label="B"))
    db.flush()
    before = [_shift(db, emp, site, ANCHOR + timedelta(days=i)) for i in range(8)]
    deviations.decide(db, site_id=site.id, employee_id=emp.id, kind=DECISION_PERMANENT, group="B",
                      start=core.to_utc_naive(_at(ANCHOR, "00:00")), end=None, reason="Observé avec le groupe B",
                      user=SimpleNamespace(id=None, username="OPS"))
    db.commit(); db.refresh(row)
    membership = db.execute(select(RotationMembership).where(RotationMembership.employee_id == emp.id)).scalar_one()
    assert membership.confirmed_group == "B"                          # l'observation est conservée…
    assert (row.work_regime, row.group_code, row.rotation_id) == ("POSTE_CONTINU", "A", official.ensure_official_model(db).id)
    assert [_shift(db, emp, site, ANCHOR + timedelta(days=i)) for i in range(8)] == before   # …l'officiel est intact
    model = official.ensure_official_model(db)
    assert model.group_offsets == official.OFFICIAL_GROUP_OFFSETS and model.version == 1


def test_legacy_screens_cannot_overwrite_a_posted_group(db):
    emp, site, row = _posted(db, "C")
    sql_bridge.sync_assignment_from_agent(db, emp, {"affectationCourante": {"siteBackendId": site.id, "groupe": "A"}})
    sql_bridge.upsert_assignment(db, {"backendId": row.id, "employee_id": emp.id, "site_id": site.id, "groupe": "A"})
    db.flush(); db.refresh(row)
    assert (row.work_regime, row.group_code) == ("POSTE_CONTINU", "C")
    legacy_emp = _employee(db)
    legacy = _assign(db, legacy_emp, site, group="B")
    sql_bridge.upsert_assignment(db, {"backendId": legacy.id, "employee_id": legacy_emp.id, "site_id": site.id, "groupe": "D"})
    assert legacy.group_code == "D" and legacy.work_regime is None


def test_scan_of_posted_employee_uses_official_planning_without_false_anomaly(db):
    emp, site, _ = _posted(db, "A")
    core.record_scan(db, employee=emp, source="QR", actor=SimpleNamespace(id=None, username="PTG"), idempotency_key=f"k-{_tag()}",
                     now=_at(ANCHOR, "05:48"))
    core.record_scan(db, employee=emp, source="QR", actor=SimpleNamespace(id=None, username="PTG"), idempotency_key=f"k-{_tag()}",
                     now=_at(ANCHOR + timedelta(days=6), "08:00"))     # J7 : OFF
    types = [a.anomaly_type for a in db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == emp.id)
                                                .order_by(AttendanceAnomaly.id)).scalars()]
    assert types == ["OFF_SCHEDULE"]


# ── API (interface Affectation à venir) ──────────────────────────────────────────────────
def _payload(emp, site, **extra):
    return {"employee_id": emp.id, "site_id": site.id, "start_date": "2026-01-01", **extra}


def test_api_creates_posted_assignment_only_when_fully_explicit(client, db, auth_headers):
    site, emp = _site(db), _employee(db)
    model = official.ensure_official_model(db)
    db.commit()
    posted = {"work_regime": "POSTE_CONTINU", "rotation_id": model.id}
    missing_group = client.post("/api/ops/assignments", headers=auth_headers, json=_payload(emp, site, **posted))
    assert missing_group.status_code == 422 and "explicitement" in missing_group.json()["detail"]
    assert client.post("/api/ops/assignments", headers=auth_headers, json=_payload(emp, site, **posted, group_code="E")).status_code == 422
    no_model = client.post("/api/ops/assignments", headers=auth_headers, json=_payload(emp, site, work_regime="POSTE_CONTINU", group_code="B"))
    assert no_model.status_code == 422 and "modèle" in no_model.json()["detail"]
    assert client.post("/api/ops/assignments", headers=auth_headers, json=_payload(emp, site, work_regime="3X8", group_code="B")).status_code == 422

    created = client.post("/api/ops/assignments", headers=auth_headers, json=_payload(emp, site, **posted, group_code="B"))
    assert created.status_code == 200, created.text
    body = created.json()
    assert (body["work_regime"], body["group_code"], body["rotation_id"]) == ("POSTE_CONTINU", "B", model.id)
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "ops.assignment.work_regime",
                                                AuditEvent.resource_id == str(body["id"]))).scalars().all()
    assert len(audit) == 1

    shift = client.get(f"/api/attendance/official-shift?employee_id={emp.id}&site_id={site.id}&at=2026-10-01T15:00:00", headers=auth_headers)
    assert shift.status_code == 200, shift.text
    out = shift.json()
    assert (out["regime"], out["group"], out["shift"], out["normal_minutes"], out["cycle_day"]) == ("POSTE_CONTINU", "B", "APRES_MIDI", 480, 3)
    assert out["scheduled_start"] == "2026-10-01T14:00:00+01:00" and out["scheduled_end"] == "2026-10-01T22:00:00+01:00"
    assert out["model"]["code"] == official.OFFICIAL_MODEL_CODE and out["in_progress"] is True

    # Changement de groupe explicite : validé et audité ; retirer le modèle est refusé.
    patched = client.patch(f"/api/ops/assignments/{body['id']}", headers=auth_headers, json={"group_code": "D"})
    assert patched.status_code == 200 and patched.json()["group_code"] == "D"
    assert client.patch(f"/api/ops/assignments/{body['id']}", headers=auth_headers, json={"rotation_id": None}).status_code == 422
    assert client.patch(f"/api/ops/assignments/{body['id']}", headers=auth_headers, json={"group_code": "Z"}).status_code == 422
    link = db.execute(select(SiteRotation).where(SiteRotation.site_id == site.id)).scalar_one()
    assert client.delete(f"/api/ops/site-rotations/{link.id}", headers=auth_headers).status_code == 409


def test_api_posted_assignment_can_be_prepared_before_the_site_is_anchored(client, db, auth_headers):
    site, emp = _site(db, linked=False, rotation_system="3x8"), _employee(db)
    model = official.ensure_official_model(db)
    db.commit()
    payload = _payload(emp, site, work_regime="POSTE_CONTINU", group_code="B", rotation_id=model.id)
    # L'explicite reste obligatoire : sans groupe ou sans modèle, refus même en préparation.
    assert client.post("/api/ops/assignments", headers=auth_headers, json={k: v for k, v in payload.items() if k != "group_code"}).status_code == 422
    assert client.post("/api/ops/assignments", headers=auth_headers, json={k: v for k, v in payload.items() if k != "rotation_id"}).status_code == 422
    created = client.post("/api/ops/assignments", headers=auth_headers, json=payload)
    assert created.status_code == 200, created.text
    assert (created.json()["work_regime"], created.json()["group_code"], created.json()["rotation_id"]) == ("POSTE_CONTINU", "B", model.id)

    url = f"/api/attendance/official-shift?employee_id={emp.id}&site_id={site.id}&at=2026-10-01T15:00:00"
    out = client.get(url, headers=auth_headers).json()
    assert out["status"] == "ROTATION_NOT_CONFIGURED" and out["official"] is False and "non configurée" in out["reason"]
    assert (out["regime"], out["group"], out["model"]["code"]) == ("POSTE_CONTINU", "B", official.OFFICIAL_MODEL_CODE)
    for key in ("shift", "shift_label", "working", "in_progress", "work_date", "cycle_day", "scheduled_start", "scheduled_end", "normal_minutes"):
        assert out[key] is None, key
    assert out["model"]["anchor_date"] is None

    # Un gabarit NON officiel reste soumis à la règle historique (rotation active sur le site).
    template = RotationTemplate(code=f"R{_tag()}", name="Historique", cycle_length=7, active=1, group_offsets={"A": 0},
                                cycle_days=[{"status": "travail"}] * 7)
    db.add(template); db.commit()
    assert client.post("/api/ops/assignments", headers=auth_headers, json=_payload(emp, site, rotation_id=template.id)).status_code == 400

    # Dès que le site est ancré, le planning officiel s'applique sans toucher à l'affectation.
    linked = client.post("/api/ops/site-rotations", headers=auth_headers,
                         json={"site_id": site.id, "rotation_id": model.id, "start_date": ANCHOR.isoformat()})
    assert linked.status_code == 201, linked.text
    out = client.get(url, headers=auth_headers).json()
    assert (out["status"], out["shift"], out["cycle_day"], out["model"]["anchor_date"]) == ("OFFICIAL", "APRES_MIDI", 3, ANCHOR.isoformat())


def test_unanchored_posted_assignment_triggers_no_posted_computation(db):
    site, emp = _site(db, linked=False, rotation_system="24/48"), _employee(db)
    row = _assign(db, emp, site, regime=official.REGIME_POSTE_CONTINU, group="A", start=ANCHOR)
    db.commit()
    model = db.get(RotationTemplate, row.rotation_id)
    for i in range(8):
        day = ANCHOR + timedelta(days=i)
        plan = _shift(db, emp, site, day)
        assert plan["status"] == "ROTATION_NOT_CONFIGURED" and plan["shift"] is None and plan["scheduled_start"] is None
        assert plan["cycle_day"] is None and plan["normal_minutes"] is None and plan["in_progress"] is None
        # Ni le cycle officiel (qui serait ancré sur la date d'affectation), ni le moteur du site.
        assert core.planned_day(db, row, site, day) == {"known": False, "on": None, "period": "", "start_time": "", "end_time": ""}
        rot = ops_service.assignment_rotation_for_date(db, row, site, model, day)
        assert rot["known"] is False and rot["on"] is None and "cycle_day" not in rot
    # Durée autorisée : règle historique du site (24/48 ⇒ 24 h), pas les 480 min du travail posté.
    assert core.authorized_work_minutes(db, row, site, ANCHOR) == 24 * 60

    generated = ops_service.generate_rotation_daily_presence(db, SimpleNamespace(presence_date=ANCHOR, site_id=site.id, society=None))
    assert db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).first() is None
    assert emp.id not in {item["employee_id"] for item in ops_service.standby_personnel(db, ANCHOR, site_id=site.id)}
    assert emp.code not in str(generated)

    # Pointage accepté (le fait est enregistré) mais aucune anomalie de planning n'est inventée.
    for hhmm in ("09:30", "18:10"):
        core.record_scan(db, employee=emp, source="QR", actor=SimpleNamespace(id=None, username="PTG"), idempotency_key=f"k-{_tag()}",
                         now=_at(ANCHOR, hhmm))
    types = {a.anomaly_type for a in db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == emp.id)).scalars()}
    assert not types & {"LATE", "OFF_SCHEDULE", "OVERTIME"}


def test_api_legacy_and_normal_assignments_are_unchanged(client, db, auth_headers):
    site, emp = _site(db), _employee(db)
    db.commit()
    legacy = client.post("/api/ops/assignments", headers=auth_headers, json=_payload(emp, site))
    assert legacy.status_code == 200 and legacy.json()["work_regime"] is None and legacy.json()["group_code"] == "A"
    normal = client.post("/api/ops/assignments", headers=auth_headers, json=_payload(emp, site, work_regime="NORMAL"))
    assert normal.status_code == 200 and normal.json()["work_regime"] == "NORMAL"
    out = client.get(f"/api/attendance/official-shift?employee_id={emp.id}&site_id={site.id}", headers=auth_headers).json()
    assert out["status"] == "NORMAL" and out["shift"] is None


def test_api_official_model_is_listed_and_protected(client, db, auth_headers):
    model = official.ensure_official_model(db)
    db.commit()
    catalog = client.get("/api/attendance/work-regimes", headers=auth_headers).json()
    assert catalog["regimes"] == [{"value": "NORMAL", "label": "Horaire normal"}, {"value": "POSTE_CONTINU", "label": "Travail posté 24h/24"}]
    assert catalog["groups"] == ["A", "B", "C", "D"]
    assert [m for m in catalog["models"] if m["code"] == official.OFFICIAL_MODEL_CODE][0]["cycle"] == CYCLE
    listed = [r for r in client.get("/api/ops/rotations", headers=auth_headers).json() if r["id"] == model.id][0]
    assert listed["official"] == 1 and listed["version"] == 1
    tampered = {"code": model.code, "name": "X", "cycle_length": 7, "cycle_days": [{"status": "repos"}] * 7, "group_offsets": {"A": 0}}
    assert client.put(f"/api/ops/rotations/{model.id}", headers=auth_headers, json=tampered).status_code == 409
    db.refresh(model)
    assert model.cycle_length == 8
