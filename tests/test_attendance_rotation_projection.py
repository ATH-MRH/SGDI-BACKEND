"""Pointage & Planning intelligent V3 — lot 4 : projection du planning.

La règle (cycle versionné + décisions humaines datées) est stockée ; les occurrences sont
calculées à la demande, jamais matérialisées. Une période passée reste reproductible avec la
version et les décisions alors en vigueur. La projection n'est jamais supérieure au réel."""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event, func, select

from app.core.config import settings
from app.modules.alerts.models import Alert
from app.modules.attendance import core, deviations, projection, sheets
from app.modules.attendance.models import (
    AttendanceEvent,
    AttendanceSheet,
    AttendanceSheetLine,
    RotationCheck,
    RotationDecision,
    RotationModelVersion,
    RotationSetting,
    RotationSiteModel,
)
from app.modules.auth.models import AuditEvent
from app.modules.ops.models import Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_attendance_rotation_deviations import (  # noqa: F401
    START,
    _close,
    _rotation,
    _scan,
    _site,
    _stable,
    _team,
    _user,
    _User,
    _when,
    learning_enabled,
)

NOW = _when(16)                                  # 10/10/2026 14:02 : 16 rotations apprises, la 17ᵉ commence
D = lambda day: date(2026, 10, day)              # noqa: E731


def _plan(db, site, first, last=None, **kwargs):
    db.expire_all()
    return projection.project(db, db.get(Site, site.id), date_from=first, date_to=last or first, now=NOW, **kwargs)


def _utc(day, hour):
    return core.to_utc_naive(datetime(2026, 10, day, hour, 0, tzinfo=core.TZ))


def _groups(plan):
    return [(o["date"][-2:], o["start"], o["group"]) for o in plan["occurrences"]]


# ── Cycle stable : demain, 7 jours, 30 jours ────────────────────────────────────────────────
def test_stable_cycle_projects_tomorrow_week_and_month_without_storing_anything(db):
    site, teams = _stable(db)
    counts = lambda: tuple(db.execute(select(func.count()).select_from(m)).scalar_one()  # noqa: E731
                           for m in (AttendanceSheet, AttendanceSheetLine, AttendanceEvent, RotationCheck, RotationDecision, RotationModelVersion))
    before = counts()
    tomorrow = _plan(db, site, D(11))
    assert (tomorrow["banner"]["label"], tomorrow["banner"]["reliable"], tomorrow["materialized"]) == ("PLANNING INTELLIGENT ACTIF", True, False)
    assert _groups(tomorrow) == [("11", "06:00", "C"), ("11", "14:00", "D"), ("11", "22:00", "A")]
    first = tomorrow["occurrences"][0]
    assert (first["end"], first["period"], first["actual"], first["exceptions"], first["version"]) == ("14:00", "future", None, [], tomorrow["model_version"])
    assert sorted(p["matricule"] for p in first["expected"]) == sorted(e.code for e in teams[2]) and {p["source"] for p in first["expected"]} == {"LEARNED"}
    week, month = _plan(db, site, D(11), D(17)), _plan(db, site, D(11), date(2026, 11, 9))
    assert (len(week["occurrences"]), len(month["occurrences"])) == (21, 90)
    assert [o["group"] for o in month["occurrences"]] == ["CDAB"[i % 4] for i in range(90)]             # A → B → C → D → A, sans fin
    assert {o["expected_count"] for o in month["occurrences"]} == {3}
    cycle = tomorrow["cycle"]
    assert (cycle["pattern"], cycle["period"], cycle["shift_minutes"], cycle["source"], cycle["confidence"]) == (["A", "B", "C", "D"], 4, 480, "LEARNED", 1.0)
    assert cycle["anchor"].startswith("2026-10-05T06:00") and cycle["effective_at"]
    assert counts() == before                                                                           # rien n'est matérialisé
    with pytest.raises(ValueError):
        _plan(db, site, D(11), date(2027, 3, 1))                                                        # horizon borné


def test_a_far_date_is_computed_directly_without_intermediate_rows(db):
    site, _teams = _stable(db)
    sheets_before = db.execute(select(func.count(AttendanceSheet.id)).where(AttendanceSheet.site_id == site.id)).scalar_one()
    far = date(2031, 3, 14)
    plan = _plan(db, site, far)
    slot_index = (datetime(2031, 3, 14, 6, 0, tzinfo=core.TZ) - START) // timedelta(hours=8)
    assert [o["group"] for o in plan["occurrences"]] == ["ABCD"[(slot_index + i) % 4] for i in range(3)]
    assert [o["start"] for o in plan["occurrences"]] == ["06:00", "14:00", "22:00"] and plan["occurrences"][0]["date"] == "2031-03-14"
    assert db.execute(select(func.count(AttendanceSheet.id)).where(AttendanceSheet.site_id == site.id)).scalar_one() == sheets_before


def test_projection_cost_does_not_grow_with_the_horizon(db):
    site, _teams = _stable(db)
    statements = []
    listener = lambda conn, cursor, statement, *args: statements.append(statement)  # noqa: E731
    bind = db.get_bind()
    event.listen(bind, "before_cursor_execute", listener)
    try:
        _plan(db, site, D(11)); day = len(statements)
        statements.clear()
        _plan(db, site, D(11), date(2026, 11, 9)); month = len(statements)
    finally:
        event.remove(bind, "before_cursor_execute", listener)
    assert day == month <= 12, (day, month)                                                             # aucun N+1


def test_the_rotation_in_progress_when_a_version_takes_effect_stays_in_the_planning(db):
    """Une règle apprise en cours de rotation couvre cette rotation entière ; avant la première
    règle, aucun planning n'est affiché (rien n'est reconstitué a posteriori)."""
    site, teams = _stable(db)
    versions = db.execute(select(RotationModelVersion).where(RotationModelVersion.site_id == site.id).order_by(RotationModelVersion.version)).scalars().all()
    first = next(v for v in versions if v.cycle.get("found"))
    for v in versions:                                                       # toutes apprises le 10/10 à 21:30 (heure locale)
        v.effective_at = _utc(10, 21) + timedelta(minutes=30)
    db.commit()
    plan = _plan(db, site, D(10))
    assert _groups(plan) == [("10", "14:00", "A"), ("10", "22:00", "B")]     # 14:00–22:00 en cours à 21:30 : conservée ; 06:00 : antérieure à la règle
    assert {o["version"] for o in plan["occurrences"]} == {max(v.version for v in versions)} and first.version <= plan["model_version"]
    assert _plan(db, site, D(9))["occurrences"] == []
    assert projection.coverage_start(first) == _utc(10, 14)


# ── Décisions humaines datées : priorité, versions, reproductibilité ────────────────────────
def test_dated_group_change_opens_a_new_version_and_never_rewrites_earlier_periods(db):
    site, teams = _stable(db)
    k162 = teams[0][0]
    v1 = _plan(db, site, D(11))["model_version"]
    decision = deviations.decide(db, site_id=site.id, employee_id=k162.id, kind="PERMANENT", group="B", start=_utc(13, 6), end=None,
                                 reason="Mutation à compter du 13/10", user=_User()); db.commit()
    assert (decision.previous_group, decision.group_label, decision.effective_to) == ("A", "B", None)
    version = db.execute(select(RotationModelVersion).where(RotationModelVersion.site_id == site.id).order_by(RotationModelVersion.version.desc())).scalars().first()
    assert (version.version, version.source, version.actor, version.effective_at, version.cycle["pattern"]) == (v1 + 1, "HUMAN", "ops.validateur", _utc(13, 6), ["A", "B", "C", "D"])
    plan = _plan(db, site, D(11), D(14))

    def where(code):
        return [(o["date"][-2:], o["start"], o["group"], o["version"]) for o in plan["occurrences"] if code in {p["matricule"] for p in o["expected"]}]

    # Avant le 13/10 06:00 : toujours A, version 1. Ensuite : B, version 2 (rotations du groupe B).
    assert where(k162.code) == [("11", "22:00", "A", v1), ("13", "14:00", "B", v1 + 1), ("14", "22:00", "B", v1 + 1)]
    assert {o["version"] for o in plan["occurrences"] if o["date"] < "2026-10-13"} == {v1}
    assert {o["version"] for o in plan["occurrences"] if o["date"] >= "2026-10-13"} == {v1 + 1}
    a_before = next(o for o in plan["occurrences"] if (o["date"], o["start"]) == ("2026-10-11", "22:00"))
    a_after = next(o for o in plan["occurrences"] if (o["date"], o["start"]) == ("2026-10-13", "06:00"))
    assert (a_before["expected_count"], a_after["expected_count"], a_after["group"]) == (3, 2, "A")
    confirmed = next(p for o in plan["occurrences"] if o["date"] == "2026-10-13" and o["start"] == "14:00" for p in o["expected"] if p["matricule"] == k162.code)
    assert confirmed["source"] == "CONFIRMED"
    # Historique reproductible : une période antérieure à la version 2 se relit avec la version 1.
    past = _plan(db, site, D(9))
    assert {o["version"] for o in past["occurrences"]} <= set(range(1, v1 + 1))
    assert [o["group"] for o in past["occurrences"]] == ["A", "B", "C"]
    assert k162.code in {p["matricule"] for p in past["occurrences"][0]["expected"]}


def test_temporary_replacement_takes_priority_during_its_period_only(db):
    site, teams = _stable(db)
    k162 = teams[0][0]
    deviations.decide(db, site_id=site.id, employee_id=k162.id, kind="TEMPORARY", group="C", start=_utc(11, 6), end=_utc(12, 14),
                      reason="Remplace un absent du groupe C", user=_User()); db.commit()
    plan = _plan(db, site, D(11), D(13))
    by = {(o["date"][-2:], o["start"]): o for o in plan["occurrences"]}
    with_c = by[("11", "06:00")]
    assert (with_c["group"], with_c["expected_count"]) == ("C", 4)
    assert [p["source"] for p in with_c["expected"] if p["matricule"] == k162.code] == ["TEMPORARY"]
    assert [e["type"] for e in with_c["exceptions"]] == ["TEMPORARY"] and "habituel : groupe A" in with_c["exceptions"][0]["label"]
    without = by[("11", "22:00")]                                                                       # rotation de son groupe A
    assert (without["group"], without["expected_count"], [e["type"] for e in without["exceptions"]]) == ("A", 2, ["REPLACED_ELSEWHERE"])
    back = by[("13", "06:00")]                                                                          # groupe A, après la fin : retour automatique
    assert (back["group"], back["expected_count"], back["exceptions"]) == ("A", 3, [])
    assert db.execute(select(func.count(RotationModelVersion.id)).where(RotationModelVersion.site_id == site.id,
                                                                        RotationModelVersion.source == "HUMAN")).scalar_one() == 0


def test_inactive_employee_is_not_expected_and_filters_apply(db):
    site, teams = _stable(db)
    gone = teams[2][0]
    gone.status = "suspendu"; db.commit()
    first = _plan(db, site, D(11))["occurrences"][0]
    assert (first["group"], first["expected_count"]) == ("C", 2)
    assert [(e["type"], e["matricule"]) for e in first["exceptions"]] == [("INACTIVE", gone.code)]
    only_a = _plan(db, site, D(11), D(17), group="A")
    assert {o["group"] for o in only_a["occurrences"]} == {"A"} and len(only_a["occurrences"]) == 5
    mine = _plan(db, site, D(11), D(17), employee_id=teams[1][0].id)
    assert {o["group"] for o in mine["occurrences"]} == {"B"}


# ── Prévu / réel pour le passé ──────────────────────────────────────────────────────────────
def test_past_periods_show_planned_actual_gap_and_decision(db):
    site, teams = _stable(db)
    k162 = teams[0][0]
    _rotation(db, 16, teams[0][1:])                                          # groupe A sans K162
    result = _scan(db, k162, _when(17)); _scan(db, k162, _when(17, offset=470))
    for emp in teams[1][:2]:
        _scan(db, emp, _when(17, offset=3)); _scan(db, emp, _when(17, offset=471))
    deviations.qualify(db, result["rotation_alert"]["id"], action="REPLACEMENT", user=_User(), reason="Absence",
                       end_at=core.to_utc_naive(START + timedelta(hours=8 * 18))); db.commit()
    _close(db, site, 17)
    db.expire_all()
    plan = projection.project(db, db.get(Site, site.id), date_from=D(10), date_to=D(10), now=_when(19))
    by = {o["start"]: o for o in plan["occurrences"]}
    a, b = by["14:00"], by["22:00"]
    assert (a["period"], a["group"], a["actual"]["present"], [p["matricule"] for p in a["actual"]["missing"]]) == ("past", "A", 2, [k162.code])
    assert (b["group"], b["actual"]["present"], b["actual"]["observed_group"]) == ("B", 3, "B")
    assert [(g["matricule"], g["expected_group"], g["observed_group"], g["outcome_label"], g["qualification_label"]) for g in b["actual"]["deviations"]] == [
        (k162.code, "A", "B", "Rotation inhabituelle", "Remplacement temporaire")]
    assert [p["matricule"] for p in b["actual"]["missing"]] == [teams[1][2].code]
    assert b["actual"]["unexpected"] == []                                   # qualifié remplacement ⇒ attendu avec B sur ce créneau
    assert [e["type"] for e in b["exceptions"]] == ["TEMPORARY"]


# ── États du modèle ─────────────────────────────────────────────────────────────────────────
def test_learning_site_is_shown_as_a_forecast_and_no_cycle_means_no_projection(db):
    site, _teams = _stable(db, mode="LEARNING")
    model = db.execute(select(RotationSiteModel).where(RotationSiteModel.site_id == site.id)).scalar_one()
    model.state = "LEARNING"; db.commit()
    plan = _plan(db, site, D(11))
    assert (plan["banner"]["label"], plan["banner"]["reliable"], len(plan["occurrences"])) == ("PRÉVISION EN APPRENTISSAGE", False, 3)
    young = _site(db, mode="LEARNING")
    crew = _team(db, young, "A")
    _rotation(db, 0, crew); _close(db, young, 0)
    empty = _plan(db, young, D(11))
    assert empty["occurrences"] == [] and empty["cycle"] is None and "Aucun cycle démontré" in empty["banner"]["detail"]
    off = _site(db, mode="OFF")
    assert (_plan(db, off, D(11))["banner"]["code"], _plan(db, off, D(11))["occurrences"]) == ("OFF", [])
    bare = Site(name="BARE PROJ", active=1, equipment_plan={"societe": "X"}); db.add(bare); db.commit()
    assert _plan(db, bare, D(11))["banner"]["code"] == "OFF"


def test_incoherent_model_stops_being_presented_as_reliable_and_alerts_ops(db):
    site, teams = _stable(db)
    setting = db.execute(select(RotationSetting).where(RotationSetting.site_id == site.id)).scalar_one()
    setting.groups_count = 5; db.commit()                                    # configuration désormais incompatible avec le réel
    _rotation(db, 16, teams[0]); _close(db, site, 16)
    plan = _plan(db, site, D(11))
    assert (plan["state"], plan["banner"]["label"], plan["banner"]["reliable"]) == ("REVIEW_REQUIRED", "RÉVISION DU PLANNING REQUISE", False)
    alert = db.execute(select(Alert).where(Alert.rule_key == "attendance.rotation.model_review", Alert.site_id == site.id)).scalar_one()
    assert (alert.status, alert.source_type, alert.source_id) == ("open", "site", str(site.id)) and "Groupes consolidés" in alert.summary
    setting.groups_count = 4; db.commit()
    _rotation(db, 17, teams[1]); _close(db, site, 17)
    db.expire_all()
    assert db.execute(select(RotationSiteModel.state).where(RotationSiteModel.site_id == site.id)).scalar_one() == "STABLE"
    alerts = db.execute(select(Alert).where(Alert.rule_key == "attendance.rotation.model_review", Alert.site_id == site.id)).scalars().all()
    assert [a.status for a in alerts] == ["resolved"]                        # une seule alerte, résolue


def test_review_alert_is_not_raised_while_the_site_is_only_learning(db):
    site, teams = _stable(db, mode="LEARNING")
    setting = db.execute(select(RotationSetting).where(RotationSetting.site_id == site.id)).scalar_one()
    setting.groups_count = 5; db.commit()
    _rotation(db, 16, teams[0]); _close(db, site, 16)
    assert db.execute(select(RotationSiteModel.state).where(RotationSiteModel.site_id == site.id)).scalar_one() == "REVIEW_REQUIRED"
    assert db.execute(select(func.count(Alert.id)).where(Alert.site_id == site.id)).scalar_one() == 0


def test_new_scans_keep_enriching_the_model_after_projection(db):
    site, teams = _stable(db)
    before = _plan(db, site, D(11))
    _rotation(db, 16, teams[0]); _close(db, site, 16)
    model = db.execute(select(RotationSiteModel).where(RotationSiteModel.site_id == site.id)).scalar_one()
    assert model.sheets_observed == 17 and _groups(_plan(db, site, D(11))) == _groups(before)


# ── API ─────────────────────────────────────────────────────────────────────────────────────
def test_api_planning_and_planned_decisions_respect_scope_rbac_and_audit(client, db, monkeypatch):
    site, teams = _stable(db)
    other, _o = _stable(db)
    k162 = teams[0][0]
    ops = _user(client, db, sites=[site.id])
    plan = client.get(f"/api/attendance/rotation-planning?site_id={site.id}&date_from=2026-11-02&date_to=2026-11-08", headers=ops).json()
    assert (len(plan["occurrences"]), plan["banner"]["code"], plan["materialized"]) == (21, "ACTIVE", False)
    assert client.get(f"/api/attendance/rotation-planning?site_id={site.id}", headers=ops).status_code == 200                      # aujourd'hui par défaut
    assert client.get(f"/api/attendance/rotation-planning?site_id={site.id}&date_from=2026-11-02&date_to=2027-11-02", headers=ops).status_code == 422
    assert client.get(f"/api/attendance/rotation-planning?site_id={other.id}", headers=ops).status_code in (403, 404)
    url = f"/api/attendance/rotation-planning/{site.id}/decisions"
    body = {"employee_id": k162.id, "kind": "PERMANENT", "group": "B", "start_at": "2026-11-04T06:00:00", "reason": "Mutation planifiée"}
    reader = _user(client, db, sites=[site.id], actions=["read", "update"])
    assert client.post(url, json=body, headers=reader).status_code == 403
    assert client.post(f"/api/attendance/rotation-planning/{other.id}/decisions", json=body, headers=ops).status_code in (403, 404)
    assert client.post(url, json={**body, "group": "ZZ"}, headers=ops).status_code == 422
    assert client.post(url, json={**body, "kind": "TEMPORARY"}, headers=ops).status_code == 422          # fin obligatoire
    assert client.post(url, json={**body, "reason": " "}, headers=ops).status_code == 422
    saved = client.post(url, json=body, headers=ops).json()
    assert (saved["kind"], saved["group"], saved["previous_group"], saved["matricule"]) == ("PERMANENT", "B", "A", k162.code)
    assert saved["effective_from"].startswith("2026-11-04T06:00:00") and saved["validator"]
    listed = client.get(url, headers=ops).json()["items"]
    assert [d["id"] for d in listed] == [saved["id"]]
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.rotation_planning.decision",
                                                AuditEvent.resource_id == str(saved["id"]))).scalar_one()
    assert '"group": "B"' in audit.new_state and '"group": "A"' in audit.old_state
    after = client.get(f"/api/attendance/rotation-planning?site_id={site.id}&date_from=2026-11-02&date_to=2026-11-08&employee_id={k162.id}", headers=ops).json()
    assert {(o["date"] < "2026-11-04", o["group"]) for o in after["occurrences"]} == {(True, "A"), (False, "B")}
