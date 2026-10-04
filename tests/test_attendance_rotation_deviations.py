"""Pointage & Planning intelligent V3 — lot 3 : comparaison prévu / réel, alertes, qualification OPS.

Le pointage est enregistré AVANT l'analyse et n'est jamais bloqué. Un écart n'est émis que si la
référence attendue est fiable (site ACTIVE, modèle STABLE, cycle démontré, groupe de référence
sûr). Observation réelle, prédiction du moteur et décision humaine restent séparées."""
import os
import sqlite3
import subprocess
import sys
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.modules.alerts.models import Alert, AlertHistory
from app.modules.attendance import core, deviations, learning, live, sheets
from app.modules.attendance.models import (
    SOURCE_FACIAL,
    SOURCE_MANUAL,
    SOURCE_QR,
    AttendanceEvent,
    AttendanceSheet,
    AttendanceSheetLine,
    RotationCheck,
    RotationDecision,
    RotationMembership,
    RotationMembershipHistory,
    RotationSetting,
    RotationSheetObservation,
    RotationSiteModel,
)
from app.modules.auth.models import AuditEvent, User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"
TZ = core.TZ
START = datetime(2026, 10, 5, 6, 0, tzinfo=TZ)
FAST = {"min_site_sheets": 8, "min_group_sheets": 2, "min_observations": 3, "min_cycle_comparisons": 8, "window_sheets": 60}


def _tag():
    return uuid.uuid4().hex[:6].upper()


@pytest.fixture(autouse=True)
def learning_enabled(monkeypatch):
    monkeypatch.setattr(settings, "rotation_learning_enabled", True)


def _site(db, *, minutes=480, groups=4, mode="ACTIVE", params=FAST):
    site = Site(name=f"DEV {_tag()}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    db.add(RotationSetting(site_id=site.id, first_shift_time="06:00", shift_minutes=minutes, groups_count=groups,
                           early_margin_minutes=60, active=1, version=1))
    db.add(RotationSiteModel(site_id=site.id, mode=mode, params=params))
    db.commit()
    return site


def _team(db, site, group, size=3):
    out = []
    for _ in range(size):
        emp = Employee(code=f"K{_tag()}", first_name="Ibrahim", last_name=f"Adda{_tag()}", society=SOC, status="actif", position="AGENT")
        db.add(emp); db.flush()
        db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=date(2026, 1, 1), active=1))
        out.append(emp)
    db.commit()
    return out


def _when(index, minutes=480, offset=2):
    return START + timedelta(minutes=index * minutes + offset)


def _scan(db, emp, when, *, source=SOURCE_QR, key=None):
    return core.record_scan(db, employee=emp, source=source, actor=None, idempotency_key=key or f"k-{uuid.uuid4().hex}", now=when)


def _rotation(db, index, employees, *, minutes=480):
    """Rotation réelle : entrées puis sorties. Retourne les résultats des ENTRÉES."""
    entries = [_scan(db, emp, _when(index, minutes)) for emp in employees]
    for emp in employees:
        _scan(db, emp, _when(index, minutes, minutes - 10))
    return entries


def _close(db, site, index, *, minutes=480):
    sheets.maintain(db, START + timedelta(minutes=(index + 1) * minutes + 1), [site.id], ensure_current=False)
    db.commit(); db.expire_all()


def _stable(db, *, mode="ACTIVE", rotations=16):
    """Site 3 × 8, 4 groupes A → B → C → D, modèle STABLE (créneau i ⇒ groupe i mod 4)."""
    site = _site(db, mode=mode)
    teams = [_team(db, site, name) for name in "ABCD"]
    for index in range(rotations):
        _rotation(db, index, teams[index % 4])
    _close(db, site, rotations - 1)
    assert db.execute(select(RotationSiteModel.state).where(RotationSiteModel.site_id == site.id)).scalar_one() == "STABLE"
    return site, teams


def _checks(db, site, **where):
    db.expire_all()
    query = select(RotationCheck).where(RotationCheck.site_id == site.id).order_by(RotationCheck.id)
    for key, value in where.items():
        query = query.where(getattr(RotationCheck, key) == value)
    return db.execute(query).scalars().all()


def _alerts(db, site):
    db.expire_all()
    return db.execute(select(Alert).where(Alert.site_id == site.id, Alert.rule_key == "attendance.rotation.deviation").order_by(Alert.id)).scalars().all()


def _deviate(db, site, emp, index):
    """`emp` prend son poste sur la rotation `index` (qui n'est pas celle de son groupe)."""
    result = _scan(db, emp, _when(index))
    return result, _checks(db, site, employee_id=emp.id)[-1]


class _User:
    id = None
    username = "ops.validateur"


# ── Référence attendue (fonction pure) ──────────────────────────────────────────────────────
def test_reference_priority_is_temporary_then_confirmed_then_reliable_learned():
    params = {**learning.default_params(), "alert_confidence": 0.8}
    t0 = datetime(2026, 10, 10, 5, 0)
    member = RotationMembership(site_id=1, employee_id=1, learned_group="A", status="PROBABLE", confidence=0.9)
    assert deviations.reference_at([], member, t0, params)["source"] == "LEARNED"
    member.confidence = 0.79                                             # appris mais pas assez fiable ⇒ aucune référence
    assert deviations.reference_at([], member, t0, params) is None
    member.status, member.confidence = "LEARNING", 0.95
    assert deviations.reference_at([], member, t0, params) is None
    permanent = RotationDecision(id=1, kind="PERMANENT", group_label="B", effective_from=t0)
    temporary = RotationDecision(id=2, kind="TEMPORARY", group_label="C", effective_from=t0 + timedelta(hours=8), effective_to=t0 + timedelta(hours=24))
    rows = [permanent, temporary]
    assert deviations.reference_at(rows, member, t0 - timedelta(hours=1), params) is None            # avant la date d'effet
    assert (deviations.reference_at(rows, member, t0, params)["group"], deviations.reference_at(rows, member, t0, params)["source"]) == ("B", "CONFIRMED")
    assert deviations.reference_at(rows, member, t0 + timedelta(hours=9), params)["source"] == "TEMPORARY"
    assert deviations.reference_at(rows, member, t0 + timedelta(hours=24), params)["group"] == "B"    # fin ⇒ retour automatique


# ── CAS A / CAS B : conforme, puis écart ────────────────────────────────────────────────────
def test_expected_group_on_its_own_rotation_raises_nothing(db):
    site, teams = _stable(db)
    results = _rotation(db, 16, teams[0])
    assert [r["action"] for r in results] == ["arrivee"] * 3 and {r["rotation_alert"] for r in results} == {None}
    checks = _checks(db, site)
    assert [(c.outcome, c.status, c.alert_id, c.expected_group, c.observed_group, c.expected_source) for c in checks] == [("CONFORM", None, None, "A", "A", "LEARNED")] * 3
    assert _alerts(db, site) == []
    assert db.execute(select(AttendanceSheet.expected_group).where(AttendanceSheet.id == checks[0].sheet_id)).scalar_one() == "A"


@pytest.mark.parametrize("source", [SOURCE_QR, SOURCE_MANUAL, SOURCE_FACIAL])
def test_unusual_rotation_is_recorded_shown_and_alerted_whatever_the_source(db, source):
    site, teams = _stable(db)
    k162 = teams[0][0]
    events_before = db.execute(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.employee_id == k162.id)).scalar_one()
    result = _scan(db, k162, _when(17), source=source)                       # rotation du groupe B
    # Le pointage est ACCEPTÉ et enregistré ; l'écart est signalé en plus.
    assert (result["success"], result["action"], result["duplicate"]) == (True, "arrivee", False)
    assert db.execute(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.employee_id == k162.id)).scalar_one() == events_before + 1
    assert result["rotation_alert"] == {
        "id": result["rotation_alert"]["id"], "type": "UNEXPECTED_ROTATION", "label": "ROTATION INHABITUELLE", "recorded": True,
        # Attendu = rotation la plus proche de son groupe dans le cycle (A travaillait 14:00–22:00 ce jour-là).
        "expected": {"group": "A", "start": "14:00", "end": "22:00"}, "observed": {"group": "B", "start": "22:00", "end": "06:00"}}
    (check,) = _checks(db, site, employee_id=k162.id)
    assert (check.outcome, check.status, check.severity, check.event_id, check.confidence, check.expected_source) == (
        "UNEXPECTED_ROTATION", "OPEN", "warning", result["event_id"], 1.0, "LEARNED")
    assert check.explanation["membership"] == {"observations": 4, "with_group": 4, "confidence": 1.0, "status": "PROBABLE"}
    (alert,) = _alerts(db, site)
    assert (alert.status, alert.severity, alert.source_type, alert.source_id, alert.society, alert.confidence) == ("open", "warning", "employee", str(k162.id), SOC, 100)
    assert alert.title == f"Changement de rotation détecté — {k162.code} — {k162.last_name} Ibrahim" and check.alert_id == alert.id
    assert "Attendu : Groupe A · 14:00–22:00 · Observé : Groupe B · 22:00–06:00" in alert.summary and site.name in alert.summary
    # Poste de pointage : l'écart accompagne le passage dans le flux temps réel.
    feed = live.live(db, {site.id}, after_id=result["event_id"] - 1, after_refusal_id=None, now=_when(17, offset=3))
    assert [e["rotation_alert"]["observed"]["group"] for e in feed["events"] if e["id"] == result["event_id"]] == ["B"]


def test_one_logical_deviation_never_creates_two_alerts(db):
    """Requête rejouée, contrôle rejoué, sortie : un événement, une ligne, un écart, une alerte."""
    site, teams = _stable(db)
    k162 = teams[0][0]
    first = _scan(db, k162, _when(17), key="same-request")
    replay = _scan(db, k162, _when(17), key="same-request")                 # même requête (idempotence Attendance Core)
    assert replay["duplicate"] is True and replay["event_id"] == first["event_id"]
    event = db.get(AttendanceEvent, first["event_id"])
    line = db.execute(select(AttendanceSheetLine).where(AttendanceSheetLine.last_event_id == event.id)).scalar_one()
    again = deviations.check_arrival_safely(db, event=event, employee=k162, site=db.get(Site, site.id), line=line, now=_when(17)); db.commit()
    assert again["id"] == first["rotation_alert"]["id"]                     # contrôle rejoué : même écart
    _scan(db, k162, _when(17, offset=120))                                  # la sortie ne recrée rien
    assert len(_checks(db, site, employee_id=k162.id)) == 1 and len(_alerts(db, site)) == 1
    assert _alerts(db, site)[0].occurrence_count == 1
    db.refresh(line)
    assert line.events_count == 2
    assert db.execute(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.employee_id == k162.id,
                                                                    AttendanceEvent.occurred_at >= core.to_utc_naive(_when(17)))).scalar_one() == 2


# ── Pas de sur-alerte ───────────────────────────────────────────────────────────────────────
def test_no_comparison_while_learning_under_review_off_or_without_reliable_reference(db):
    learning_site, teams = _stable(db, mode="LEARNING")                      # modèle STABLE mais site non ACTIVE
    assert _scan(db, teams[0][0], _when(17))["rotation_alert"] is None and _checks(db, learning_site) == []
    young = _site(db)                                                        # ACTIVE mais encore en apprentissage
    crew = [_team(db, young, name) for name in "ABCD"]
    for index in range(4):
        _rotation(db, index, crew[index % 4])
    _close(db, young, 3)
    assert _scan(db, crew[0][0], _when(5))["rotation_alert"] is None and _checks(db, young) == []
    site, teams = _stable(db)
    newcomer = _team(db, site, "A", size=1)[0]                               # jamais observé ⇒ aucune référence fiable
    assert _scan(db, newcomer, _when(17))["rotation_alert"] is None and _checks(db, site) == []
    model = db.execute(select(RotationSiteModel).where(RotationSiteModel.site_id == site.id)).scalar_one()
    model.state = "REVIEW_REQUIRED"; db.commit()
    assert _scan(db, teams[0][0], _when(17))["rotation_alert"] is None and _checks(db, site) == []


def test_site_off_or_unconfigured_behaves_exactly_as_before(db, monkeypatch):
    bare = Site(name=f"BARE {_tag()}", active=1, equipment_plan={"societe": SOC})
    db.add(bare); db.commit()
    emp = _team(db, bare, "A", size=1)[0]
    result = _scan(db, emp, _when(0))
    assert (result["action"], result["rotation_alert"]) == ("arrivee", None)
    for model in (AttendanceSheet, RotationCheck, RotationSiteModel):
        assert db.execute(select(func.count()).select_from(model).where(model.site_id == bare.id)).scalar_one() == 0
    site, teams = _stable(db)
    monkeypatch.setattr(settings, "rotation_learning_enabled", False)       # coupe-circuit global
    assert _scan(db, teams[0][0], _when(17))["rotation_alert"] is None and _checks(db, site) == [] and _alerts(db, site) == []


def test_a_comparison_failure_never_blocks_or_alters_the_scan(db, monkeypatch):
    site, teams = _stable(db)
    monkeypatch.setattr(deviations, "check_arrival", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    result = _scan(db, teams[0][0], _when(17))
    assert (result["success"], result["action"], result["rotation_alert"]) == (True, "arrivee", None)
    line = db.execute(select(AttendanceSheetLine).where(AttendanceSheetLine.last_event_id == result["event_id"])).scalar_one()
    assert line.state == "PRESENT" and _checks(db, site) == []


def test_refused_scan_creates_no_presence_no_observation_no_deviation(db):
    site, teams = _stable(db)
    blocked = teams[0][0]
    blocked.status = "suspendu"; db.commit()
    lines_before = db.execute(select(func.count(AttendanceSheetLine.id)).where(AttendanceSheetLine.employee_id == blocked.id)).scalar_one()
    with pytest.raises(HTTPException):
        _scan(db, blocked, _when(17))
    db.rollback()
    assert db.execute(select(func.count(AttendanceSheetLine.id)).where(AttendanceSheetLine.employee_id == blocked.id)).scalar_one() == lines_before
    assert _checks(db, site) == [] and _alerts(db, site) == []
    _close(db, site, 17)
    row = db.execute(select(RotationMembership).where(RotationMembership.employee_id == blocked.id)).scalar_one()
    assert row.observations == 4                                            # le refus n'a rien appris


# ── Types d'écart réellement déterminables ──────────────────────────────────────────────────
def test_repeated_deviations_to_the_same_group_flag_a_possible_lasting_change(db):
    site, teams = _stable(db)
    k162 = teams[0][0]
    outcomes = []
    for index in (17, 21, 25):                                               # trois rotations du groupe B
        result, check = _deviate(db, site, k162, index)
        _scan(db, k162, _when(index, offset=470))
        outcomes.append((check.outcome, check.severity))
    assert outcomes == [("UNEXPECTED_ROTATION", "warning"), ("UNEXPECTED_ROTATION", "warning"),
                        ("PERSISTENT_ROTATION_CHANGE_POSSIBLE", "critical")]
    assert [a.severity for a in _alerts(db, site)] == ["warning", "warning", "critical"]


def test_presence_on_a_rest_slot_is_reported_as_unplanned(db):
    """Site de jour en 2 × 12 h : A, repos, B, repos. Une prise de poste de nuit n'est pas prévue."""
    site = _site(db, minutes=720, groups=2)
    day_a, day_b = _team(db, site, "A"), _team(db, site, "B")
    for index in range(0, 24, 2):
        _rotation(db, index, day_a if index % 4 == 0 else day_b, minutes=720)
    _close(db, site, 23, minutes=720)
    model = db.execute(select(RotationSiteModel).where(RotationSiteModel.site_id == site.id)).scalar_one()
    assert (model.state, model.cycle["pattern"]) == ("STABLE", ["A", "∅", "B", "∅"])
    result = _scan(db, day_a[0], _when(25, 720))
    assert result["rotation_alert"]["type"] == "UNPLANNED_PRESENCE" and result["rotation_alert"]["observed"]["group"] is None
    assert "Créneau de repos · 18:00–06:00" in _alerts(db, site)[0].summary


def test_night_rotation_across_midnight_keeps_entry_exit_group_alert_and_history(db):
    site, teams = _stable(db)
    k162 = teams[0][0]
    entry = _scan(db, k162, _when(17, offset=5))                             # 22:05, rotation 22:00 → 06:00 (groupe B)
    leave = _scan(db, k162, _when(17, offset=478))                           # 05:58 le lendemain
    assert (entry["action"], leave["action"]) == ("arrivee", "depart")
    line = db.execute(select(AttendanceSheetLine).where(AttendanceSheetLine.last_event_id == leave["event_id"])).scalar_one()
    sheet = db.get(AttendanceSheet, line.sheet_id)
    assert (core.to_local(sheet.window_start).strftime("%d %H:%M"), core.to_local(sheet.window_end).strftime("%d %H:%M")) == ("10 22:00", "11 06:00")
    assert (line.state, line.events_count) == ("SORTI", 2)
    (check,) = _checks(db, site, employee_id=k162.id)
    assert (check.sheet_id, check.observed_start, check.observed_end, check.observed_group) == (sheet.id, "22:00", "06:00", "B")
    rows = deviations.history_rows(db, site_ids=[site.id], employee_id=k162.id, date_from=date(2026, 10, 10), date_to=date(2026, 10, 10))["items"]
    assert [(r["date"], r["rotation"], r["first_entry"], r["last_exit"], r["expected_group"], r["observed_group"], r["outcome"]) for r in rows] == [
        ("2026-10-10", "22:00 – 06:00", "22:05", "05:58", "A", "B", "UNEXPECTED_ROTATION")]


# ── Qualifications OPS ──────────────────────────────────────────────────────────────────────
def test_exceptional_swap_keeps_the_scan_the_sheet_and_the_permanent_group(db):
    site, teams = _stable(db)
    k162 = teams[0][0]
    result, check = _deviate(db, site, k162, 17)
    facts = (db.get(AttendanceEvent, result["event_id"]).occurred_at, check.sheet_id)
    done = deviations.qualify(db, check.id, action="PERMUTATION", user=_User(), reason="Échange avec un collègue"); db.commit()
    assert (done.status, done.qualification, done.decided_by, done.decision_id) == ("RESOLVED", "PERMUTATION", "ops.validateur", None)
    member = db.execute(select(RotationMembership).where(RotationMembership.employee_id == k162.id)).scalar_one()
    assert (member.learned_group, member.confirmed_group, member.status) == ("A", None, "PROBABLE")
    assert db.execute(select(func.count(RotationDecision.id)).where(RotationDecision.employee_id == k162.id)).scalar_one() == 0
    assert (db.get(AttendanceEvent, result["event_id"]).occurred_at, done.sheet_id) == facts
    (alert,) = _alerts(db, site)
    assert alert.status == "treated"
    history = db.execute(select(AlertHistory).where(AlertHistory.alert_id == alert.id).order_by(AlertHistory.id)).scalars().all()
    assert [(h.action, h.previous_status, h.new_status) for h in history] == [("detected", None, "open"), ("treated", "open", "treated")]
    assert "Permutation exceptionnelle — Échange avec un collègue" in history[-1].reason
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.rotation_deviation.qualify",
                                                AuditEvent.resource_id == str(check.id))).scalar_one()
    assert '"qualification": "PERMUTATION"' in audit.new_state and '"status": "OPEN"' in audit.old_state and audit.username == "ops.validateur"
    # Le groupe permanent est inchangé : la prochaine prise de poste hors groupe est de nouveau signalée.
    _scan(db, k162, _when(17, offset=470))
    assert _scan(db, k162, _when(21))["rotation_alert"]["expected"]["group"] == "A"


def test_temporary_replacement_becomes_the_reference_then_ends_automatically(db):
    site, teams = _stable(db)
    k162 = teams[0][0]
    _result, check = _deviate(db, site, k162, 17)
    end = core.to_utc_naive(START + timedelta(hours=8 * 22))                 # jusqu'à la fin de la rotation 21
    with pytest.raises(ValueError):
        deviations.qualify(db, check.id, action="REPLACEMENT", user=_User(), reason="Remplace un absent")      # fin obligatoire
    db.rollback()
    with pytest.raises(ValueError):
        deviations.qualify(db, check.id, action="REPLACEMENT", user=_User(), reason="x", group="ZZ", end_at=end)
    db.rollback()
    done = deviations.qualify(db, check.id, action="REPLACEMENT", user=_User(), reason="Remplace un absent du groupe B", end_at=end); db.commit()
    decision = db.get(RotationDecision, done.decision_id)
    assert (decision.kind, decision.group_label, decision.previous_group, decision.validator, decision.reason) == (
        "TEMPORARY", "B", "A", "ops.validateur", "Remplace un absent du groupe B")
    assert (decision.effective_from, decision.effective_to, decision.check_id, decision.alert_id, decision.model_confidence) == (
        db.get(AttendanceSheet, check.sheet_id).window_start, end, check.id, check.alert_id, 1.0)
    member = db.execute(select(RotationMembership).where(RotationMembership.employee_id == k162.id)).scalar_one()
    assert (member.confirmed_group, member.learned_group) == (None, "A")     # groupe habituel inchangé
    _scan(db, k162, _when(17, offset=470))
    # Pendant la période : le groupe temporaire EST la référence — plus d'alerte répétée.
    during = _scan(db, k162, _when(21))
    assert during["rotation_alert"] is None
    assert [(c.outcome, c.expected_group, c.expected_source) for c in _checks(db, site, employee_id=k162.id)][-1] == ("CONFORM", "B", "TEMPORARY")
    _scan(db, k162, _when(21, offset=470))
    assert len(_alerts(db, site)) == 1
    # À la fin : retour automatique au groupe précédent (aucun traitement planifié).
    after = _scan(db, k162, _when(25))
    assert after["rotation_alert"]["expected"]["group"] == "A" and len(_alerts(db, site)) == 2


def test_confirmed_group_change_versions_the_membership_without_rewriting_the_past(db):
    site, teams = _stable(db)
    k162 = teams[0][0]
    past = db.execute(select(AttendanceSheetLine.id, AttendanceSheetLine.declared_group, AttendanceSheet.expected_group, RotationSheetObservation.group_label)
                      .join(AttendanceSheet, AttendanceSheet.id == AttendanceSheetLine.sheet_id)
                      .join(RotationSheetObservation, RotationSheetObservation.sheet_id == AttendanceSheet.id)
                      .where(AttendanceSheetLine.employee_id == k162.id).order_by(AttendanceSheetLine.id)).all()
    _result, check = _deviate(db, site, k162, 17)
    with pytest.raises(ValueError):
        deviations.qualify(db, check.id, action="GROUP_CHANGE", user=_User())                 # motif obligatoire
    db.rollback()
    done = deviations.qualify(db, check.id, action="GROUP_CHANGE", user=_User(), reason="Mutation validée par le chef de site"); db.commit()
    decision = db.get(RotationDecision, done.decision_id)
    assert (decision.kind, decision.group_label, decision.previous_group, decision.effective_to, decision.model_confidence) == ("PERMANENT", "B", "A", None, 1.0)
    member = db.execute(select(RotationMembership).where(RotationMembership.employee_id == k162.id)).scalar_one()
    # Déclaré / appris / confirmé restent distincts ; le moteur apprend encore A ⇒ OVERRIDDEN (la décision humaine prévaut).
    assert (member.declared_group, member.learned_group, member.confirmed_group, member.status) == ("A", "A", "B", "OVERRIDDEN")
    last = db.execute(select(RotationMembershipHistory).where(RotationMembershipHistory.employee_id == k162.id)
                      .order_by(RotationMembershipHistory.id.desc())).scalars().first()
    assert (last.old_group, last.new_group, last.source, last.actor, last.source_sheet_id, last.old_confidence) == ("A", "B", "HUMAN", "ops.validateur", check.sheet_id, 1.0)
    assert db.execute(select(Assignment.group_code).where(Assignment.employee_id == k162.id)).scalar_one() == "A"   # affectation RH intacte
    assert db.execute(select(AttendanceSheetLine.id, AttendanceSheetLine.declared_group, AttendanceSheet.expected_group, RotationSheetObservation.group_label)
                      .join(AttendanceSheet, AttendanceSheet.id == AttendanceSheetLine.sheet_id)
                      .join(RotationSheetObservation, RotationSheetObservation.sheet_id == AttendanceSheet.id)
                      .where(AttendanceSheetLine.employee_id == k162.id, AttendanceSheetLine.id <= past[-1][0]).order_by(AttendanceSheetLine.id)).all() == past
    _scan(db, k162, _when(17, offset=470))
    assert _scan(db, k162, _when(21))["rotation_alert"] is None                # avec B : conforme
    _scan(db, k162, _when(21, offset=470))
    back = _scan(db, k162, _when(24))                                          # retour avec A : c'est maintenant l'écart
    assert (back["rotation_alert"]["expected"]["group"], back["rotation_alert"]["observed"]["group"]) == ("B", "A")
    # Une période antérieure à la date d'effet se relit toujours avec l'ancienne référence.
    params = learning.effective_params(None)
    before = deviations.reference_at([decision], member, decision.effective_from - timedelta(minutes=1), {**params, "alert_confidence": 0})
    assert before is None or before["group"] != "B"
    # L'apprentissage continue sans réécrire ses statistiques.
    _close(db, site, 24)
    member = db.execute(select(RotationMembership).where(RotationMembership.employee_id == k162.id)).scalar_one()
    assert member.confirmed_group == "B" and member.explanation["by_group"]["A"] >= 4 and member.status in ("OVERRIDDEN", "CONFIRMED")


def test_false_positive_keeps_fact_prediction_and_human_decision_for_recalibration(db):
    site, teams = _stable(db)
    result, check = _deviate(db, site, teams[0][0], 17)
    with pytest.raises(ValueError):
        deviations.qualify(db, check.id, action="FALSE_POSITIVE", user=_User(), reason="  ")
    db.rollback()
    done = deviations.qualify(db, check.id, action="FALSE_POSITIVE", user=_User(), reason="Rotation décalée ce jour-là"); db.commit()
    assert (done.status, done.qualification, done.reason, done.outcome, done.expected_group, done.observed_group, done.confidence) == (
        "DISMISSED", "FALSE_POSITIVE", "Rotation décalée ce jour-là", "UNEXPECTED_ROTATION", "A", "B", 1.0)
    assert db.get(AttendanceEvent, result["event_id"]) is not None and db.get(AttendanceSheet, done.sheet_id) is not None
    (alert,) = _alerts(db, site)
    assert (alert.status, "faux positif" in alert.ignore_reason) == ("ignored", True)
    assert db.execute(select(func.count(RotationDecision.id)).where(RotationDecision.site_id == site.id)).scalar_one() == 0
    listed = deviations.list_deviations(db, site_ids=[site.id], status="DISMISSED")["items"]
    assert [(i["qualification"], i["reason"]) for i in listed] == [("FALSE_POSITIVE", "Rotation décalée ce jour-là")]


def test_examine_later_stays_visible_then_a_final_decision_is_idempotent_and_exclusive(db):
    site, teams = _stable(db)
    _result, check = _deviate(db, site, teams[0][0], 17)
    later = deviations.qualify(db, check.id, action="LATER", user=_User()); db.commit()
    assert (later.status, later.qualification) == ("ACKNOWLEDGED", "LATER") and _alerts(db, site)[0].status == "acknowledged"
    assert [i["id"] for i in deviations.list_deviations(db, site_ids=[site.id], status="ACKNOWLEDGED")["items"]] == [check.id]
    assert db.execute(select(RotationMembership.confirmed_group).where(RotationMembership.employee_id == teams[0][0].id)).scalar_one() is None
    deviations.qualify(db, check.id, action="LATER", user=_User()); db.commit()        # rejouable
    first = deviations.qualify(db, check.id, action="GROUP_CHANGE", user=_User(), reason="Confirmé"); db.commit()
    again = deviations.qualify(db, check.id, action="GROUP_CHANGE", user=_User(), reason="Confirmé"); db.commit()
    assert again.decision_id == first.decision_id
    assert db.execute(select(func.count(RotationDecision.id)).where(RotationDecision.check_id == check.id)).scalar_one() == 1
    assert db.execute(select(func.count(RotationMembershipHistory.id)).where(RotationMembershipHistory.employee_id == teams[0][0].id,
                                                                            RotationMembershipHistory.source == "HUMAN")).scalar_one() == 1
    with pytest.raises(deviations.AlreadyQualified):
        deviations.qualify(db, check.id, action="FALSE_POSITIVE", user=_User(), reason="trop tard")
    db.rollback()
    assert _alerts(db, site)[0].status == "treated"


def test_employee_history_tells_the_real_story_day_by_day(db):
    """Conforme → permutation → remplacement → changement confirmé → conforme : lignes réelles."""
    site, teams = _stable(db)
    k162 = teams[0][0]

    def shift(index):
        result = _scan(db, k162, _when(index))
        _scan(db, k162, _when(index, offset=470))
        return _checks(db, site, employee_id=k162.id)[-1]

    shift(16)                                                                # A — conforme
    deviations.qualify(db, shift(17).id, action="PERMUTATION", user=_User(), reason="Échange"); db.commit()
    deviations.qualify(db, shift(21).id, action="REPLACEMENT", user=_User(), reason="Absence",
                       end_at=core.to_utc_naive(START + timedelta(hours=8 * 22))); db.commit()
    deviations.qualify(db, shift(25).id, action="GROUP_CHANGE", user=_User(), reason="Mutation"); db.commit()
    shift(29)                                                                # B — conforme
    rows = deviations.history_rows(db, site_ids=[site.id], employee_id=k162.id, date_from=date(2026, 10, 10))["items"]
    story = [(r["observed_group"], r["expected_group"], r["outcome_label"], r["qualification_label"]) for r in reversed(rows)]
    assert story == [
        ("A", "A", "Conforme", None),
        ("B", "A", "Rotation inhabituelle", "Permutation exceptionnelle"),
        ("B", "A", "Rotation inhabituelle", "Remplacement temporaire"),
        ("B", "A", "Changement de rotation durable possible", "Changement de groupe confirmé"),   # 3ᵉ écart consécutif vers B
        ("B", "B", "Conforme", None)]
    # Avant l'activation, rien n'a été comparé : ces lignes restent « non évaluées », jamais reconstituées.
    old = deviations.history_rows(db, site_ids=[site.id], employee_id=k162.id, date_to=date(2026, 10, 9))["items"]
    assert {r["outcome"] for r in old} == {"NOT_EVALUATED"} and {r["observed_group"] for r in old} == {"A"}


# ── API ─────────────────────────────────────────────────────────────────────────────────────
def _user(client, db, *, sites=None, modules=("ops",), actions=None):
    username = f"u{_tag()}"
    db.add(User(username=username, full_name=username, role="ops", access_level="H3",
                authorized_societies=[SOC], authorized_sites=list(sites or []),
                authorized_modules=list(modules), authorized_actions=list(actions or []),
                password_hash=hash_password("apipassword1"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": username, "password": "apipassword1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_api_lists_examines_and_qualifies_within_scope_and_rbac(client, db):
    site, teams = _stable(db)
    other, other_teams = _stable(db)
    k162 = teams[0][0]
    _result, check = _deviate(db, site, k162, 17)
    _r, foreign = _deviate(db, other, other_teams[0][0], 17)
    ops = _user(client, db, sites=[site.id])
    listing = client.get("/api/attendance/rotation-deviations?status=OPEN", headers=ops).json()
    assert [i["id"] for i in listing["items"]] == [check.id] and listing["total"] == 1
    item = listing["items"][0]
    assert (item["matricule"], item["site"], item["expected_group"], item["expected_rotation"], item["observed_group"], item["observed_rotation"], item["type_label"]) == (
        k162.code, site.name, "A", "14:00 – 22:00", "B", "22:00 – 06:00", "Rotation inhabituelle")
    for query, expected in (("group=B", 1), ("group=C", 0), ("type=UNEXPECTED_ROTATION", 1), ("type=UNPLANNED_PRESENCE", 0), ("severity=warning", 1),
                            (f"employee_id={k162.id}", 1), ("date_from=2026-10-10&date_to=2026-10-10", 1), ("date_to=2026-10-09", 0), ("status=RESOLVED", 0)):
        assert client.get(f"/api/attendance/rotation-deviations?{query}", headers=ops).json()["total"] == expected, query
    assert client.get("/api/attendance/rotation-deviations?status=NOPE", headers=ops).status_code == 422
    assert client.get(f"/api/attendance/rotation-deviations?site_id={other.id}", headers=ops).status_code in (403, 404)
    # Examiner.
    detail = client.get(f"/api/attendance/rotation-deviations/{check.id}", headers=ops).json()
    assert (detail["date"], detail["heure"], detail["confidence"], detail["expected_source"], detail["groups"]) == ("2026-10-10", "22:02", 1.0, "LEARNED", ["A", "B", "C", "D"])
    assert "groupe appris par le moteur" in detail["explanation"] and "4 rotation(s) observée(s) · 4 avec le groupe A" in detail["explanation"]
    assert detail["recent"][0]["outcome"] == "UNEXPECTED_ROTATION" and len(detail["recent"]) == 5
    assert [a["key"] for a in detail["actions"]] == ["PERMUTATION", "REPLACEMENT", "GROUP_CHANGE", "FALSE_POSITIVE", "LATER"]
    assert detail["alert_history"][0]["action"] == "detected"
    assert client.get(f"/api/attendance/rotation-deviations/{foreign.id}", headers=ops).status_code == 404
    # Centre d'alertes existant : même alerte, filtrable par employé et par règle.
    alerts = client.get(f"/api/alerts?employee_id={k162.id}&rule_key=attendance.rotation.deviation", headers=ops).json()
    assert [a["id"] for a in alerts["items"]] == [check.alert_id] and alerts["items"][0]["status"] == "open"
    # Qualifier : action « validate ».
    url = f"/api/attendance/rotation-deviations/{check.id}/qualify"
    reader = _user(client, db, sites=[site.id], actions=["read", "update"])
    assert client.post(url, json={"action": "PERMUTATION"}, headers=reader).status_code == 403
    assert client.post(f"/api/attendance/rotation-deviations/{foreign.id}/qualify", json={"action": "PERMUTATION"}, headers=ops).status_code == 404
    assert client.post(url, json={"action": "PROMOTE"}, headers=ops).status_code == 422
    assert client.post(url, json={"action": "FALSE_POSITIVE"}, headers=ops).status_code == 422
    assert client.post(url, json={"action": "REPLACEMENT", "reason": "Absence", "end_at": "2026-10-10T21:00:00"}, headers=ops).status_code == 422
    saved = client.post(url, json={"action": "replacement", "reason": "Absence", "group": "B", "end_at": "2026-10-12T14:00:00"}, headers=ops).json()
    assert (saved["status"], saved["qualification_label"], saved["decision"]["kind"], saved["decision"]["group"], saved["decision"]["previous_group"]) == (
        "RESOLVED", "Remplacement temporaire", "TEMPORARY", "B", "A")
    assert saved["decision"]["effective_to"].startswith("2026-10-12T14:00:00") and saved["decided_by"]
    assert client.post(url, json={"action": "PERMUTATION"}, headers=ops).status_code == 409
    assert _alerts(db, site)[0].status == "treated"


def test_api_history_and_sheet_detail_show_expected_observed_and_decision(client, db):
    site, teams = _stable(db)
    k162 = teams[0][0]
    _rotation(db, 16, teams[0][1:])
    _result, check = _deviate(db, site, k162, 17)
    for emp in teams[1]:
        _scan(db, emp, _when(17, offset=4))
    deviations.qualify(db, check.id, action="PERMUTATION", user=_User(), reason="Échange"); db.commit()
    drh = _user(client, db, sites=[site.id], modules=("drh",))
    history = client.get(f"/api/attendance/rotation-history?site_id={site.id}&date_from=2026-10-10&date_to=2026-10-10", headers=drh).json()
    assert history["total"] == 3 + 2 + 4                                   # rotations 15 (D), 16 (A sans K162), 17 en cours
    assert {(r["rotation"], r["outcome"]) for r in history["items"]} == {
        ("06:00 – 14:00", "NOT_EVALUATED"), ("14:00 – 22:00", "CONFORM"), ("22:00 – 06:00", "CONFORM"), ("22:00 – 06:00", "UNEXPECTED_ROTATION")}
    for query, expected in (("outcome=DEVIATION", 1), ("outcome=CONFORM", 5), ("outcome=NOT_EVALUATED", 3), (f"employee_id={k162.id}", 1),
                            ("group=B", 4), ("status=OPEN", 4), ("anomaly=DEPART_MANQUANT", 0),
                            (f"q={k162.code.lower()}", 1), ("q=inconnu-zz", 0)):
        got = client.get(f"/api/attendance/rotation-history?site_id={site.id}&date_from=2026-10-10&date_to=2026-10-10&{query}", headers=drh).json()["total"]
        assert got == expected, (query, got)
    assert client.get("/api/attendance/rotation-history?status=NOPE", headers=drh).status_code == 422
    sheet = client.get(f"/api/attendance/sheets/{check.sheet_id}", headers=drh).json()
    assert (sheet["expected_group"], sheet["label"], sheet["status"]) == ("B", "22:00 – 06:00", "OPEN")
    by_code = {line["matricule"]: line for line in sheet["lines"]}
    assert (by_code[k162.code]["expected_group"], by_code[k162.code]["observed_group"], by_code[k162.code]["outcome"],
            by_code[k162.code]["qualification_label"], by_code[k162.code]["events_count"]) == ("A", "B", "UNEXPECTED_ROTATION", "Permutation exceptionnelle", 1)
    assert {(l["expected_group"], l["outcome"]) for code, l in by_code.items() if code != k162.code} == {("B", "CONFORM")}
    outsider = _user(client, db, sites=[_site(db).id])
    assert client.get(f"/api/attendance/rotation-history?site_id={site.id}", headers=outsider).status_code in (403, 404)
    assert client.get("/api/attendance/rotation-history", headers=outsider).json()["total"] == 0


def test_active_mode_is_an_explicit_per_site_setting(client, db):
    site = _site(db, mode="LEARNING")
    ops = _user(client, db, sites=[site.id])
    saved = client.put(f"/api/attendance/rotation-learning/{site.id}", json={"mode": "ACTIVE", "params": {"alert_confidence": 0.9, "persistent_deviations": 4}}, headers=ops).json()
    assert (saved["mode"], saved["params"]["alert_confidence"], saved["params"]["persistent_deviations"]) == ("ACTIVE", 0.9, 4)
    assert client.put(f"/api/attendance/rotation-learning/{site.id}", json={"mode": "ACTIVE", "params": {"persistent_deviations": 1}}, headers=ops).status_code == 422


# ── Migration ───────────────────────────────────────────────────────────────────────────────
def test_migration_is_additive_and_reversible(tmp_path):
    database = tmp_path / "deviations.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{database}"}

    def alembic(*args):
        return subprocess.run([sys.executable, "-m", "alembic", *args], env=env, capture_output=True, text=True, timeout=180)

    assert alembic("upgrade", "20261006_0001").returncode == 0
    con = sqlite3.connect(database)
    tables = lambda: {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}  # noqa: E731
    schema = lambda: {r[0]: r[1] for r in con.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name != 'alembic_version'")}  # noqa: E731
    existing, existing_schema = tables(), schema()
    up = alembic("upgrade", "20261007_0001")
    assert up.returncode == 0, up.stderr
    assert tables() - existing == {"rotation_checks", "rotation_decisions"}
    assert {name: sql for name, sql in schema().items() if name in existing} == existing_schema
    assert con.execute("SELECT COUNT(*) FROM rotation_checks").fetchone()[0] == 0
    down = alembic("downgrade", "20261006_0001")
    assert down.returncode == 0, down.stderr
    assert tables() == existing
    assert alembic("upgrade", "20261007_0001").returncode == 0
    con.close()
