"""Pointage & Planning intelligent V3 — lot 2 : apprentissage des groupes et des rotations.

Le moteur OBSERVE les feuilles clôturées et PROPOSE (groupe appris, confiance, cycle, état du
site). Il est déterministe, n'écrit jamais dans les pointages, les feuilles ou les affectations,
et n'émet aucune alerte (lots suivants). Scénarios construits avec de VRAIS pointages."""
import os
import sqlite3
import subprocess
import sys
import uuid
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.modules.attendance import core, learning, sheets
from app.modules.attendance.models import (
    AttendanceAnomaly,
    AttendanceEvent,
    AttendanceSheet,
    AttendanceSheetLine,
    RotationGroup,
    RotationMembership,
    RotationMembershipHistory,
    RotationModelVersion,
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
# Seuils de TEST explicites (les valeurs initiales de production sont dans la configuration).
FAST = {"min_site_sheets": 8, "min_group_sheets": 2, "min_observations": 3, "min_cycle_comparisons": 8, "window_sheets": 60}


def _tag():
    return uuid.uuid4().hex[:6].upper()


@pytest.fixture(autouse=True)
def learning_enabled(monkeypatch):
    monkeypatch.setattr(settings, "rotation_learning_enabled", True)


def _site(db, *, minutes=480, groups=4, mode="LEARNING", params=FAST, configured=True):
    site = Site(name=f"LEARN {_tag()}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    if configured:
        db.add(RotationSetting(site_id=site.id, first_shift_time="06:00", shift_minutes=minutes, groups_count=groups,
                               early_margin_minutes=60, active=1, version=1))
    if mode:
        db.add(RotationSiteModel(site_id=site.id, mode=mode, params=params))
    db.commit()
    return site


def _team(db, site, group, size=3):
    out = []
    for _ in range(size):
        emp = Employee(code=f"RL{_tag()}", first_name="Adda", last_name=f"Agent{_tag()}", society=SOC, status="actif", position="AGENT")
        db.add(emp); db.flush()
        db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=date(2026, 1, 1), active=1))
        out.append(emp)
    db.commit()
    return out


def _scan(db, emp, when):
    return core.record_scan(db, employee=emp, source="QR", actor=None, idempotency_key=f"k-{_tag()}", now=when)


def _rotation(db, site, index, employees, *, minutes=480, late=2):
    """Une rotation réelle : chaque salarié entre puis sort (pointages Attendance Core)."""
    start = START + timedelta(minutes=index * minutes)
    for emp in employees:
        _scan(db, emp, start + timedelta(minutes=late))
    for emp in employees:
        _scan(db, emp, start + timedelta(minutes=minutes - 10))
    return start


def _close(db, site, index, *, minutes=480):
    """Rattrapage à l'accès après la fin de la rotation `index` : clôture + apprentissage."""
    sheets.maintain(db, START + timedelta(minutes=(index + 1) * minutes + 1), [site.id], ensure_current=False)
    db.commit()
    db.expire_all()


def _model(db, site):
    db.expire_all()
    return db.execute(select(RotationSiteModel).where(RotationSiteModel.site_id == site.id)).scalar_one()


def _member(db, site, emp):
    db.expire_all()
    return db.execute(select(RotationMembership).where(RotationMembership.site_id == site.id,
                                                       RotationMembership.employee_id == emp.id)).scalar_one_or_none()


def _groups(db, site):
    db.expire_all()
    return {g.label: g for g in db.execute(select(RotationGroup).where(RotationGroup.site_id == site.id)).scalars().all()}


def _four_groups(db, site, cycles=4, declared=("A", "B", "C", "D")):
    teams = [_team(db, site, name) for name in declared]
    for index in range(cycles * 4):
        _rotation(db, site, index, teams[index % 4])
    _close(db, site, cycles * 4 - 1)
    return teams


# ── Fonctions pures : déterministes et explicables ──────────────────────────────────────────
def test_dice_and_parameter_validation(monkeypatch):
    assert learning.dice({1, 2, 3}, {1, 2, 3}) == 1.0
    assert learning.dice({1, 2, 3, 9}, {1, 2, 3}) == pytest.approx(6 / 7)
    assert learning.dice(set(), {1}) == 0.0
    assert learning.validate_params({"min_observations": 4, "probable_threshold": "0.8"}) == {"min_observations": 4, "probable_threshold": 0.8}
    for bad in ({"unknown": 1}, {"probable_threshold": 3}, {"min_observations": 0}, {"min_observations": "x"},
                {"weight_share": 0, "weight_time": 0, "weight_recency": 0}):
        with pytest.raises(ValueError):
            learning.validate_params(bad)
    # Aucun seuil n'est figé dans le moteur : la configuration les fournit, le site les surcharge.
    monkeypatch.setattr(settings, "rotation_learning_min_observations", 9)
    assert learning.default_params()["min_observations"] == 9
    assert learning.effective_params(RotationSiteModel(site_id=1, params={"min_observations": 2}))["min_observations"] == 2


def _obs(index, label, minutes=480):
    start = datetime(2026, 10, 5, 5, 0) + timedelta(minutes=index * minutes)
    return learning.Obs(window_start=start, sheet_id=index + 1, window_end=start + timedelta(minutes=minutes),
                        local_date=start.date(), label=label, members={1: (start, None)} if label else {})


def test_cycle_is_reported_only_when_the_data_demonstrates_it():
    params = {**learning.default_params(), "min_cycle_comparisons": 8, "window_sheets": 40, "max_cycle_slots": 20}
    cycle = learning.compute_cycle([_obs(i, "ABCD"[i % 4]) for i in range(16)], params)
    assert (cycle["found"], cycle["period"], cycle["pattern"], cycle["concordance"]) == (True, 4, ["A", "B", "C", "D"], 1.0)
    # Repos inclus : A, repos, B, repos.
    rest = learning.compute_cycle([_obs(i, [None, "A", None, "B"][i % 4]) for i in range(1, 20)], params)
    assert rest["found"] and rest["period"] == 4 and sorted(rest["pattern"]) == ["A", "B", "∅", "∅"]
    # Trop peu de rotations : rien n'est affirmé, et ce n'est pas encore une contradiction.
    short = learning.compute_cycle([_obs(i, "ABCD"[i % 4]) for i in range(6)], params)
    assert (short["found"], short["status"]) == (False, "pending")
    # Succession contradictoire sur une fenêtre pleine : aucun cycle, signalé comme tel.
    chaos = "ABCDACBDDABCCADBBDCAABDCCBADDCABACDBBCDA"
    failed = learning.compute_cycle([_obs(i, chaos[i]) for i in range(40)], params)
    assert (failed["found"], failed["status"]) == (False, "failed")


# ── Groupes détectés ────────────────────────────────────────────────────────────────────────
def test_four_groups_working_together_over_several_cycles_are_detected(db):
    site = _site(db)
    teams = _four_groups(db, site)
    groups = _groups(db, site)
    assert sorted(groups) == ["A", "B", "C", "D"]
    assert {g.status for g in groups.values()} == {"STABLE"} and {g.sheets_count for g in groups.values()} == {4}
    assert {g.members_probable for g in groups.values()} == {3}
    for name, team in zip("ABCD", teams):
        for emp in team:
            row = _member(db, site, emp)
            assert (row.learned_group, row.status, row.observations, row.with_group, row.confidence) == (name, "PROBABLE", 4, 4, 1.0)
            assert row.declared_group == name and row.confirmed_group is None
    # GROUPE ≠ CRÉNEAU : 4 groupes sur 3 créneaux ⇒ le créneau de chaque groupe varie.
    assert groups["A"].explanation["slots"] == {"06:00 – 14:00": 2, "14:00 – 22:00": 1, "22:00 – 06:00": 1}
    assert groups["A"].usual_start == "06:00" and groups["A"].usual_share == 0.5
    assert groups["A"].explanation["median_arrival_offset_minutes"] == 2.0
    assert groups["A"].explanation["median_presence_minutes"] == 468.0


def test_learned_group_names_do_not_depend_on_the_declared_group(db):
    """Tous déclarés « A » (valeur par défaut des affectations) : quatre groupes sont tout de
    même détectés ; seul le premier peut porter le nom déclaré, les autres sont nommés G<n>."""
    site = _site(db)
    _four_groups(db, site, declared=("A", "A", "A", "A"))
    groups = _groups(db, site)
    assert sorted(groups) == ["A", "G2", "G3", "G4"]
    assert groups["A"].explanation["label_source"] == "declared_majority" and groups["G2"].explanation["label_source"] == "sequence"
    assert _model(db, site).groups_detected == 4


def test_expected_group_count_never_forces_employees_into_groups(db):
    """Paramètre Lot 1 : 4 groupes attendus. Le réel en montre 2 : 2 sont détectés, et le site
    passe en REVIEW_REQUIRED (configuration incompatible avec le réel) au lieu d'être forcé."""
    site = _site(db, minutes=720, groups=4)
    day, night = _team(db, site, "A"), _team(db, site, "B")
    for index in range(12):
        _rotation(db, site, index, day if index % 2 == 0 else night, minutes=720)
    _close(db, site, 11, minutes=720)
    model = _model(db, site)
    assert sorted(_groups(db, site)) == ["A", "B"] and model.groups_detected == 2
    assert model.state == "REVIEW_REQUIRED"
    failed = [c for c in model.reasons if c["status"] == "failed"]
    assert [(c["key"], c["value"], c["required"]) for c in failed] == [("groups", 2, 4)]


# ── Une présence = une observation ──────────────────────────────────────────────────────────
def test_several_events_in_one_sheet_count_as_one_observation(db):
    site = _site(db, minutes=720, groups=2)
    team = _team(db, site, "A")
    for index in range(3):
        start = _rotation(db, site, index * 2, team, minutes=720)
        if index == 0:                                    # sortie / retour dans la même rotation
            _scan(db, team[0], start + timedelta(minutes=600))   # ré-entrée (après la sortie de _rotation… rejouée)
    events = db.execute(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.employee_id == team[0].id)).scalar_one()
    _close(db, site, 4, minutes=720)
    row = _member(db, site, team[0])
    assert events > 6 - 1 and row.observations == 3 and row.with_group == 3
    obs = db.execute(select(RotationSheetObservation).where(RotationSheetObservation.site_id == site.id)).scalars().all()
    assert sorted(o.members_count for o in obs if o.members_count) == [3, 3, 3]


def test_open_sheets_are_never_learned(db):
    site = _site(db)
    team = _team(db, site, "A")
    _rotation(db, site, 0, team)
    sheets.maintain(db, START + timedelta(hours=1), [site.id]); db.commit()      # rotation en cours
    assert db.execute(select(func.count(RotationSheetObservation.sheet_id)).where(RotationSheetObservation.site_id == site.id)).scalar_one() == 0
    assert _model(db, site).computed_at is None and _member(db, site, team[0]) is None
    _close(db, site, 0)
    assert db.execute(select(func.count(RotationSheetObservation.sheet_id)).where(RotationSheetObservation.site_id == site.id)).scalar_one() == 1


# ── Salarié ponctuel / changement progressif ────────────────────────────────────────────────
def test_a_single_passage_never_makes_a_permanent_member(db):
    site = _site(db, minutes=720, groups=2)
    team_a, team_b = _team(db, site, "A"), _team(db, site, "B")
    visitor = _team(db, site, "A", size=1)[0]
    for index in range(10):
        members = team_a if index % 2 == 0 else team_b
        _rotation(db, site, index, members + ([visitor] if index == 3 else []), minutes=720)
    _close(db, site, 9, minutes=720)
    row = _member(db, site, visitor)
    assert (row.learned_group, row.status, row.observations) == (None, "LEARNING", 1)
    assert row.explanation["candidate"] == "B" and row.confidence == pytest.approx(1 / 3, abs=1e-4)   # évidence 1/3
    assert row.declared_group == "A"                                                               # jamais écrasé
    group_b = _groups(db, site)["B"]
    assert (group_b.members_probable, group_b.members_learning) == (3, 1) and visitor.id not in group_b.explanation["core"]
    assert "insuffisantes" in learning.explain(row)


def test_a_regular_move_to_another_group_shifts_the_probability_progressively(db):
    site = _site(db, minutes=720, groups=2)
    team_a, team_b = _team(db, site, "A"), _team(db, site, "B")
    mover = _team(db, site, "A", size=1)[0]
    trail = []
    for index in range(26):
        with_a = index % 2 == 0
        present = (team_a if with_a else team_b) + ([mover] if with_a == (index < 12) else [])
        _rotation(db, site, index, present, minutes=720)
        _close(db, site, index, minutes=720)
        row = _member(db, site, mover)
        if row is not None and (index % 2 == 0) == (index < 12):
            trail.append((row.learned_group, row.status, row.confidence, row.explanation["by_group"]))
    learned = [step[0] for step in trail]
    # A probable ⇒ période d'incertitude (aucun groupe appris) ⇒ B probable : jamais de bascule directe.
    first_none, first_b = learned.index(None, 3), learned.index("B")
    assert learned[2:first_none] == ["A"] * (first_none - 2) and set(learned[first_none:first_b]) == {None}
    assert set(learned[first_b:]) == {"B"} and first_b - first_none >= 2
    confidences = [step[2] for step in trail]
    assert confidences[5] == 1.0 and all(a > b for a, b in zip(confidences[5:first_b - 1], confidences[6:first_b]))
    assert trail[-1][3] == {"A": 6, "B": 7}
    history = db.execute(select(RotationMembershipHistory).where(RotationMembershipHistory.employee_id == mover.id)
                         .order_by(RotationMembershipHistory.id)).scalars().all()
    assert [(h.old_group, h.new_group, h.new_status) for h in history] == [
        (None, None, "LEARNING"), (None, "A", "PROBABLE"), ("A", None, "LEARNING"), (None, "B", "PROBABLE")]
    assert all(h.source == "LEARNED" and h.source_sheet_id and h.engine_version == learning.ENGINE_VERSION for h in history)
    assert _member(db, site, mover).declared_group == "A"                   # le déclaré reste celui de l'affectation
    assert db.execute(select(Assignment.group_code).where(Assignment.employee_id == mover.id)).scalar_one() == "A"


# ── État du site ────────────────────────────────────────────────────────────────────────────
def test_site_without_rotation_settings_keeps_the_historical_behaviour(db):
    site = _site(db, configured=False, mode=None)
    emp = _team(db, site, "A", size=1)[0]
    result = _scan(db, emp, START + timedelta(minutes=5))
    assert result["action"] == "arrivee"
    sheets.maintain(db, START + timedelta(days=2), [site.id]); db.commit()
    for model in (AttendanceSheet, RotationSiteModel, RotationSheetObservation, RotationGroup, RotationMembership):
        assert db.execute(select(func.count()).select_from(model).where(model.site_id == site.id)).scalar_one() == 0


def test_learning_requires_the_global_flag_and_an_explicit_site_mode(db, monkeypatch):
    off_site, flagless = _site(db, mode="OFF"), _site(db)
    for site in (off_site, flagless):
        _rotation(db, site, 0, _team(db, site, "A"))
    monkeypatch.setattr(settings, "rotation_learning_enabled", False)
    _close(db, flagless, 0)
    monkeypatch.setattr(settings, "rotation_learning_enabled", True)
    _close(db, off_site, 0)
    assert db.execute(select(func.count(RotationSheetObservation.sheet_id)).where(
        RotationSheetObservation.site_id.in_([off_site.id, flagless.id]))).scalar_one() == 0
    # Activation : les feuilles déjà clôturées (réelles) sont alors intégrées, une seule fois.
    _close(db, flagless, 0)
    assert db.execute(select(func.count(RotationSheetObservation.sheet_id)).where(RotationSheetObservation.site_id == flagless.id)).scalar_one() == 1


def test_newly_configured_site_is_learning_and_raises_no_alert(db):
    site = _site(db)
    team = _team(db, site, "A")
    anomalies_before = db.execute(select(func.count(AttendanceAnomaly.id))).scalar_one()
    _rotation(db, site, 0, team)
    anomalies_after_scans = db.execute(select(func.count(AttendanceAnomaly.id))).scalar_one()
    _close(db, site, 0)
    model = _model(db, site)
    assert (model.state, model.sheets_observed, model.groups_detected, model.mean_confidence) == ("LEARNING", 1, 0, None)
    assert {c["key"]: c["status"] for c in model.reasons}["sheets"] == "pending"
    assert "failed" not in {c["status"] for c in model.reasons}
    # Lot 2 n'émet AUCUNE alerte : l'apprentissage ne crée ni anomalie ni modification de feuille.
    assert db.execute(select(func.count(AttendanceAnomaly.id))).scalar_one() == anomalies_after_scans >= anomalies_before
    assert db.execute(select(AttendanceSheet.expected_group).where(AttendanceSheet.site_id == site.id)).scalars().all() == [None]
    assert learning.next_rotation(model) is None                         # aucun cycle démontré ⇒ aucune valeur affichée


def test_site_becomes_stable_only_when_every_measured_criterion_holds(db):
    site = _site(db)
    teams = [_team(db, site, name) for name in "ABCD"]
    states = []
    for index in range(16):
        _rotation(db, site, index, teams[index % 4])
        _close(db, site, index)
        states.append(_model(db, site).state)
    # 12 rotations ⇒ 3 observations par salarié et 8 comparaisons de cycle : pas avant.
    assert states[:11] == ["LEARNING"] * 11 and states[11:] == ["STABLE"] * 5
    model = _model(db, site)
    assert {c["key"]: c["status"] for c in model.reasons} == {key: "ok" for key in ("sheets", "groups", "coverage", "members", "confidence", "cycle")}
    assert (model.cycle["period"], model.cycle["pattern"], model.cycle["concordance"]) == (4, ["A", "B", "C", "D"], 1.0)
    assert (model.sheets_observed, model.days_observed, model.groups_detected, model.mean_confidence) == (16, 6, 4, 1.0)
    # Rotation probable suivante : lue dans le cycle démontré (17ᵉ créneau ⇒ groupe A).
    upcoming = learning.next_rotation(model, START + timedelta(hours=16 * 8 - 1))
    assert (upcoming["group"], upcoming["label"], upcoming["indicative"]) == ("A", "14:00 – 22:00", False)
    # Versions : une par changement réel du modèle, jamais deux identiques.
    versions = db.execute(select(RotationModelVersion).where(RotationModelVersion.site_id == site.id).order_by(RotationModelVersion.version)).scalars().all()
    assert [v.version for v in versions] == list(range(1, len(versions) + 1)) == list(range(1, model.model_version + 1))
    assert len({v.fingerprint for v in versions}) == len(versions)
    # Modèle stabilisé ⇒ plus aucune nouvelle version tant que rien ne change réellement.
    assert versions[-1].state == "STABLE" and versions[-1].previous_state == "LEARNING" and versions[-1].params["min_site_sheets"] == 8
    assert versions[-1].source == "LEARNED" and versions[-1].source_sheet_id and [v.state for v in versions[:-1]] == ["LEARNING"] * (len(versions) - 1)
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.rotation_learning.model",
                                                AuditEvent.resource_id == str(site.id)).order_by(AuditEvent.id.desc())).scalars().first()
    assert '"state": "STABLE"' in audit.new_state and '"state": "LEARNING"' in audit.old_state


def test_unstable_teams_put_the_site_under_review(db):
    """Compositions sans répétition : aucun groupe ne se consolide ⇒ REVIEW_REQUIRED, pas STABLE."""
    site = _site(db, minutes=720, groups=2)
    pool = _team(db, site, "A", size=8)
    for index in range(10):
        members = [pool[(index * 3 + offset * (index % 3 + 1)) % 8] for offset in range(3)]
        _rotation(db, site, index, list({m.id: m for m in members}.values()), minutes=720)
    _close(db, site, 9, minutes=720)
    model = _model(db, site)
    assert model.state == "REVIEW_REQUIRED"
    assert {"members", "confidence"} <= {c["key"] for c in model.reasons if c["status"] == "failed"}


# ── Idempotence, reconstruction, audit ──────────────────────────────────────────────────────
def _snapshot(db, site):
    db.expire_all()
    model = _model(db, site)
    members = db.execute(select(RotationMembership).where(RotationMembership.site_id == site.id).order_by(RotationMembership.employee_id)).scalars().all()
    observations = db.execute(select(RotationSheetObservation).where(RotationSheetObservation.site_id == site.id).order_by(RotationSheetObservation.sheet_id)).scalars().all()
    return {"version": model.model_version, "fingerprint": model.fingerprint, "state": model.state,
            "members": [(m.employee_id, m.learned_group, m.status, m.confidence, m.observations) for m in members],
            "observations": [(o.sheet_id, o.group_label, o.members_count) for o in observations],
            "groups": sorted((g.label, g.status, g.sheets_count) for g in _groups(db, site).values()),
            "history": db.execute(select(func.count(RotationMembershipHistory.id)).where(RotationMembershipHistory.site_id == site.id)).scalar_one(),
            "versions": db.execute(select(func.count(RotationModelVersion.id)).where(RotationModelVersion.site_id == site.id)).scalar_one()}


def test_learning_is_incremental_and_replaying_it_changes_nothing(db):
    site = _site(db)
    _four_groups(db, site)
    before = _snapshot(db, site)
    for _ in range(3):
        _close(db, site, 15)
        assert learning.learn_site(db, site.id) is None
    db.commit()
    assert _snapshot(db, site) == before


def test_rebuild_is_explicit_dry_run_by_default_idempotent_and_audited(db):
    site = _site(db)
    _four_groups(db, site)
    before = _snapshot(db, site)
    preview = learning.rebuild(db, site.id, dry_run=True); db.commit()
    assert preview["dry_run"] is True and preview["sheets_replayed"] == 16 and preview["observations_removed"] == 16
    assert preview["model_changed"] is False and preview["membership_changes"] == []
    assert _snapshot(db, site) == before                                # simulation : rien n'est écrit
    applied = learning.rebuild(db, site.id, dry_run=False); db.commit()
    assert applied["dry_run"] is False and applied["after"]["state"] == "STABLE"
    assert _snapshot(db, site) == before                                # même modèle, même version
    # Période bornée : seules les feuilles de la période sont rejouées, le reste est conservé.
    partial = learning.rebuild(db, site.id, date_from=date(2026, 10, 6), date_to=date(2026, 10, 7), dry_run=False); db.commit()
    assert partial["sheets_replayed"] == 6 and _snapshot(db, site) == before
    audits = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.rotation_learning.rebuild",
                                                 AuditEvent.resource_id == str(site.id)).order_by(AuditEvent.id)).scalars().all()
    assert [a.result for a in audits] == ["dry_run", "success", "success"]
    assert '"date_from": "2026-10-06"' in audits[-1].new_state and '"sheets_replayed": 6' in audits[-1].new_state
    with pytest.raises(ValueError):
        learning.rebuild(db, _site(db, mode="OFF").id)
    db.rollback()


def test_rebuild_with_new_parameters_reports_the_changes_before_applying(db):
    site = _site(db)
    teams = _four_groups(db, site)
    model = _model(db, site)
    model.params = {**FAST, "min_observations": 6}                      # exigence relevée : 4 observations ne suffisent plus
    db.commit()
    preview = learning.rebuild(db, site.id, dry_run=True); db.commit()
    assert preview["after"]["state"] == "LEARNING" and len(preview["membership_changes"]) == 12
    assert {(c["old_group"] is not None, c["new_group"], c["new_status"]) for c in preview["membership_changes"]} == {(True, None, "LEARNING")}
    assert _member(db, site, teams[0][0]).status == "PROBABLE"            # simulation seulement
    learning.rebuild(db, site.id, dry_run=False, actor=None); db.commit()
    row = _member(db, site, teams[0][0])
    assert (row.status, row.learned_group, row.source) == ("LEARNING", None, "REBUILD")
    last = db.execute(select(RotationMembershipHistory).where(RotationMembershipHistory.employee_id == teams[0][0].id)
                      .order_by(RotationMembershipHistory.id.desc())).scalars().first()
    assert (last.old_group, last.new_group, last.source, last.old_confidence) == ("A", None, "REBUILD", 1.0)


def test_declared_learned_and_confirmed_groups_stay_separate(db):
    site = _site(db)
    teams = _four_groups(db, site, cycles=3)
    agreed, contradicted = teams[0][0], teams[1][0]
    for emp, confirmed in ((agreed, "A"), (contradicted, "D")):          # décision humaine (posée par le lot 3)
        _member(db, site, emp).confirmed_group = confirmed
        db.commit()
    _rotation(db, site, 12, teams[0]); _rotation(db, site, 13, teams[1])
    _close(db, site, 13)
    ok, ko = _member(db, site, agreed), _member(db, site, contradicted)
    assert (ok.declared_group, ok.learned_group, ok.confirmed_group, ok.status) == ("A", "A", "A", "CONFIRMED")
    assert (ko.declared_group, ko.learned_group, ko.confirmed_group, ko.status) == ("B", "B", "D", "OVERRIDDEN")


def test_learning_never_touches_events_sheets_or_assignments(db):
    site = _site(db)
    teams = [_team(db, site, name) for name in "ABCD"]
    for index in range(8):
        _rotation(db, site, index, teams[index % 4])

    def facts():
        db.expire_all()
        events = db.execute(select(AttendanceEvent.id, AttendanceEvent.event_type, AttendanceEvent.occurred_at)
                            .where(AttendanceEvent.site_id == site.id).order_by(AttendanceEvent.id)).all()
        lines = db.execute(select(AttendanceSheetLine.id, AttendanceSheetLine.declared_group, AttendanceSheetLine.first_entry_at,
                                  AttendanceSheetLine.last_exit_at, AttendanceSheetLine.events_count)
                           .join(AttendanceSheet, AttendanceSheet.id == AttendanceSheetLine.sheet_id)
                           .where(AttendanceSheet.site_id == site.id).order_by(AttendanceSheetLine.id)).all()
        assignments = db.execute(select(Assignment.employee_id, Assignment.group_code).where(Assignment.site_id == site.id).order_by(Assignment.id)).all()
        return [tuple(r) for r in events], [tuple(r) for r in lines], [tuple(r) for r in assignments]

    monkey_off = settings.rotation_learning_enabled
    settings.rotation_learning_enabled = False
    try:
        _close(db, site, 7)
        before = facts()
    finally:
        settings.rotation_learning_enabled = monkey_off
    _close(db, site, 7)
    assert _model(db, site).sheets_observed == 8 and facts() == before


def test_a_learning_failure_never_breaks_sheet_maintenance(db, monkeypatch):
    site = _site(db)
    _rotation(db, site, 0, _team(db, site, "A"))
    monkeypatch.setattr(learning, "_recompute", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    result = sheets.maintain(db, START + timedelta(hours=9), [site.id]); db.commit()
    assert result["closed"] == 1
    assert db.execute(select(func.count(RotationSheetObservation.sheet_id)).where(RotationSheetObservation.site_id == site.id)).scalar_one() == 0


# ── API ─────────────────────────────────────────────────────────────────────────────────────
def _user(client, db, *, sites=None, modules=("pointage",), actions=None):
    username = f"u{_tag()}"
    db.add(User(username=username, full_name=username, role="ops", access_level="H3",
                authorized_societies=[SOC], authorized_sites=list(sites or []),
                authorized_modules=list(modules), authorized_actions=list(actions or []),
                password_hash=hash_password("apipassword1"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": username, "password": "apipassword1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_api_activation_is_explicit_validated_scoped_and_audited(client, db):
    site, other = _site(db, mode=None), _site(db, mode=None)
    headers = _user(client, db, sites=[site.id], modules=("ops",))
    overview = client.get("/api/attendance/rotation-learning", headers=headers).json()
    assert [item["site_id"] for item in overview["items"]] == [site.id]
    item = overview["items"][0]
    assert (item["mode"], item["state"], item["learning"], item["sheets_observed"], item["next"]) == ("OFF", None, False, 0, None)
    assert item["params"]["min_observations"] == settings.rotation_learning_min_observations and item["expected_groups"] == 4
    url = f"/api/attendance/rotation-learning/{site.id}"
    assert client.put(url, json={"mode": "FORCED"}, headers=headers).status_code == 422
    assert client.put(url, json={"mode": "LEARNING", "params": {"probable_threshold": 7}}, headers=headers).status_code == 422
    assert client.put(f"/api/attendance/rotation-learning/{other.id}", json={"mode": "LEARNING"}, headers=headers).status_code in (403, 404)
    read_only = _user(client, db, sites=[site.id], actions=["read"])
    assert client.put(url, json={"mode": "LEARNING"}, headers=read_only).status_code == 403
    saved = client.put(url, json={"mode": "learning", "params": {"min_observations": 4}}, headers=headers).json()
    assert (saved["mode"], saved["state"], saved["learning"], saved["overrides"], saved["params"]["min_observations"]) == ("LEARNING", "LEARNING", True, {"min_observations": 4}, 4)
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.rotation_learning.settings",
                                                AuditEvent.resource_id == str(site.id))).scalars().all()
    assert len(audit) == 1 and '"mode": "LEARNING"' in audit[0].new_state
    frozen = client.put(url, json={"mode": "OFF"}, headers=headers).json()
    assert frozen["mode"] == "OFF" and frozen["overrides"] == {"min_observations": 4}


def test_api_exposes_real_figures_for_site_groups_and_employee(client, db):
    site, foreign = _site(db), _site(db)
    teams = _four_groups(db, site)
    k162 = teams[0][0]
    headers = _user(client, db, sites=[site.id], modules=("drh",))
    item = client.get(f"/api/attendance/rotation-learning?site_id={site.id}", headers=headers).json()["items"][0]
    assert (item["state"], item["sheets_observed"], item["groups_detected"], item["mean_confidence"], item["model_version"] > 0) == ("STABLE", 16, 4, 1.0, True)
    assert item["cycle"]["pattern"] == ["A", "B", "C", "D"] and item["computed_at"] and item["next"]["group"] in "ABCD"
    data = client.get(f"/api/attendance/rotation-learning/{site.id}/groups", headers=headers).json()
    group_a = next(g for g in data["groups"] if g["label"] == "A")
    assert (group_a["status"], group_a["sheets_count"], group_a["usual_start"], group_a["confidence"]) == ("STABLE", 4, "06:00", 1.0)
    assert sorted(m["matricule"] for m in group_a["members_probable"]) == sorted(e.code for e in teams[0])
    assert group_a["members_confirmed"] == [] and group_a["members_learning"] == [] and group_a["last_observed_at"]
    card = client.get(f"/api/attendance/rotation-learning/employees/{k162.id}", headers=headers).json()
    membership = card["memberships"][0]
    assert (membership["declared_group"], membership["learned_group"], membership["confirmed_group"], membership["status"]) == ("A", "A", None, "PROBABLE")
    assert (membership["observations"], membership["with_group"], membership["time_consistent"], membership["confidence"]) == (4, 4, 4, 1.0)
    assert membership["explanation"] == "4 rotation(s) observée(s) · 4 avec le groupe A · 4/4 horaires cohérents"
    assert membership["components"] == {"share": 1.0, "time": 1.0, "recency": 1.0, "evidence": 1.0}
    assert len(card["observations"]) == 4 and {o["group"] for o in card["observations"]} == {"A"}
    assert [(h["old_group"], h["new_group"]) for h in card["history"]][0] == (None, "A")
    versions = client.get(f"/api/attendance/rotation-learning/{site.id}/versions", headers=headers).json()["items"]
    assert versions[0]["state"] == "STABLE" and versions[0]["version"] == item["model_version"] and versions[0]["groups"]
    # Observation brute ET interprétation du moteur, côte à côte, dans l'historique des feuilles.
    listing = client.get(f"/api/attendance/sheets?site_id={site.id}&date_from=2026-10-05&date_to=2026-10-05", headers=headers).json()
    assert {(s["observed_group"], s["interpretation"]["group"]) for s in listing["items"]} == {("A", "A"), ("B", "B"), ("C", "C")}
    # Périmètre.
    assert client.get(f"/api/attendance/rotation-learning/{foreign.id}/groups", headers=headers).status_code in (403, 404)
    stranger = _team(db, foreign, "A", size=1)[0]
    assert client.get(f"/api/attendance/rotation-learning/employees/{stranger.id}", headers=headers).status_code == 404


def test_api_rebuild_is_admin_only_and_backfill_preview_writes_nothing(client, db):
    site = _site(db)
    _four_groups(db, site, cycles=2)
    limited = _user(client, db, sites=[site.id], actions=["read", "update"])
    admin = _user(client, db, sites=[site.id], actions=["read", "update", "admin"])
    url = f"/api/attendance/rotation-learning/{site.id}/rebuild"
    assert client.post(url, json={}, headers=limited).status_code == 403
    before = _snapshot(db, site)
    dry = client.post(url, json={}, headers=admin).json()
    assert dry["dry_run"] is True and dry["sheets_replayed"] == 8 and _snapshot(db, site) == before
    assert client.post(url, json={"date_from": "2026-10-09", "date_to": "2026-10-01"}, headers=admin).status_code == 422
    real = client.post(url, json={"dry_run": False}, headers=admin).json()
    assert real["dry_run"] is False and _snapshot(db, site) == before
    # Audit du backfill : lecture seule, sur un site dont les pointages précèdent les feuilles.
    legacy = _site(db, configured=False, mode=None)
    emps = _team(db, legacy, "A", size=2)
    for emp in emps:
        _scan(db, emp, START + timedelta(minutes=3)); _scan(db, emp, START + timedelta(hours=7))
    db.add(RotationSetting(site_id=legacy.id, first_shift_time="06:00", shift_minutes=480, groups_count=4, early_margin_minutes=60, active=1, version=1))
    db.commit()
    viewer = _user(client, db, sites=[legacy.id])
    counts = lambda: (db.execute(select(func.count(AttendanceSheet.id)).where(AttendanceSheet.site_id == legacy.id)).scalar_one(),  # noqa: E731
                      db.execute(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.site_id == legacy.id)).scalar_one())
    state = counts()
    preview = client.get(f"/api/attendance/rotation-learning/{legacy.id}/backfill-preview?date_from=2026-10-05&date_to=2026-10-05", headers=viewer).json()
    assert (preview["events_unattached"], preview["arrivals"], preview["departures"], preview["employees"]) == (4, 2, 2, 2)
    assert (preview["sheets_reconstructible"], preview["sheets_with_several_employees"], preview["written"]) == (1, 1, False)
    assert preview["limits"] and counts() == state == (0, 4)
    assert client.get(f"/api/attendance/rotation-learning/{legacy.id}/backfill-preview?date_from=2026-01-01&date_to=2026-10-05", headers=viewer).status_code == 422


# ── Migration ───────────────────────────────────────────────────────────────────────────────
def test_migration_is_additive_and_reversible(tmp_path):
    database = tmp_path / "learning.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{database}"}

    def alembic(*args):
        return subprocess.run([sys.executable, "-m", "alembic", *args], env=env, capture_output=True, text=True, timeout=180)

    assert alembic("upgrade", "20261005_0001").returncode == 0
    con = sqlite3.connect(database)
    tables = lambda: {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}  # noqa: E731
    schema = lambda: {r[0]: r[1] for r in con.execute("SELECT name, sql FROM sqlite_master WHERE type='table'")}  # noqa: E731
    existing, existing_schema = tables(), schema()
    up = alembic("upgrade", "20261006_0001")
    assert up.returncode == 0, up.stderr
    new = {"rotation_site_models", "rotation_sheet_observations", "rotation_groups", "rotation_memberships",
           "rotation_membership_history", "rotation_model_versions"}
    assert tables() - existing == new
    assert {name: sql for name, sql in schema().items() if name in existing and name != "alembic_version"} == \
        {name: sql for name, sql in existing_schema.items() if name != "alembic_version"}
    assert all(con.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] == 0 for name in new)   # aucun backfill au déploiement
    assert alembic("upgrade", "20261006_0001").returncode == 0                                    # rejouable
    down = alembic("downgrade", "20261005_0001")
    assert down.returncode == 0, down.stderr
    assert tables() == existing
    con.close()
