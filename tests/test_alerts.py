"""Lot 0.6-A — moteur d'alertes déterministes.

Vraies fonctions (détecteurs, scoring, service, repository), vrai schéma
SQLite de test (voir tests/conftest.py). La validation Alembic sur
PostgreSQL réel (0034 -> 0035 -> downgrade -> head) a été faite séparément,
en jetable, hors de cette suite (voir le rapport final).

Chaque test utilise une plage d'employee_id qui lui est propre : le fixture
``db`` ne fait rollback QUE de ce qui n'a pas été commit, or plusieurs
fonctions du service (apply_lifecycle_action, run_detector) committent en
interne (comme le reste du projet, ex. app.modules.drh.service). Des
dedup_key uniques par test évitent toute collision entre tests sans
dépendre de l'ordre d'exécution.
"""
import threading
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import inspect

from app.modules.alerts import repository, service
from app.modules.alerts.detectors import DetectorFinding, contract_expiring, missing_checkout
from app.modules.alerts.lifecycle import ALLOWED_TRANSITIONS, InvalidTransitionError, ensure_valid_transition
from app.modules.alerts.models import Alert, DetectionRun
from app.modules.alerts.rules import RULE_CONTRACT_EXPIRING, RULE_MISSING_CHECKOUT
from app.modules.alerts.scheduler import _run_one_detector
from app.modules.alerts.scoring import score_contract_expiring, score_missing_checkout
from app.modules.drh.models import Employee
from app.modules.ops.models import DailyPresence, Site

SOC_A = "Iron Global Securite"
SOC_B = "Iron Global Sécurité Sud"


def make_employee(db, *, code, society=SOC_A, status="actif", contract_end_date=None, contract_type="CDI"):
    emp = Employee(code=code, first_name="TEST", last_name=code, society=society, status=status,
                    contract_end_date=contract_end_date, contract_type=contract_type)
    db.add(emp)
    db.flush()
    return emp


def make_presence(db, *, employee, presence_date, arrival_time, departure_time=None, closed_at=None, site_id=None):
    row = DailyPresence(employee_id=employee.id, presence_date=presence_date, arrival_time=arrival_time,
                         departure_time=departure_time, closed_at=closed_at, site_id=site_id)
    db.add(row)
    db.flush()
    return row


def make_finding(*, employee_id, society=SOC_A, days_remaining=5, contract_end_date="2026-09-18"):
    return DetectorFinding(
        rule_key=RULE_CONTRACT_EXPIRING, source_type="employee", source_id=str(employee_id),
        society=society, site_id=None, title=f"Contrat employé {employee_id}", summary="s",
        evidence={"employee_id": employee_id, "employee_code": f"E{employee_id}", "status": "actif",
                  "contract_type": "CDI", "contract_end_date": contract_end_date, "days_remaining": days_remaining, "society": society},
        score_context={"days_remaining": days_remaining, "employee_status": "actif"},
        dedup_dimensions={"employee_id": employee_id, "contract_end_date": contract_end_date},
    )


# ── Migration (structure via les modèles ORM ; PostgreSQL réel validé séparément) ──

def test_alert_tables_exist_with_expected_constraints(db):
    inspector = inspect(db.bind)
    tables = set(inspector.get_table_names())
    assert {"alert_rules", "alerts", "alert_evidence", "alert_history", "detection_runs"} <= tables
    unique_names = {c["name"] for c in inspector.get_unique_constraints("alerts")}
    assert "uq_alerts_dedup_key" in unique_names


# ── Catalogue de règles ────────────────────────────────────────────────────

def test_rule_catalog_seed_is_idempotent(db):
    repository.ensure_rule_catalog(db)
    repository.ensure_rule_catalog(db)
    rule = repository.get_rule(db, RULE_CONTRACT_EXPIRING)
    assert rule is not None
    assert rule.enabled is True
    assert rule.module_key == "drh"


# ── Détecteur contrat ──────────────────────────────────────────────────────

def test_contract_detector_respects_threshold_and_status(db):
    today = date(2026, 9, 13)
    make_employee(db, code="C1SOON", contract_end_date=today + timedelta(days=5))
    make_employee(db, code="C1FAR", contract_end_date=today + timedelta(days=60))
    make_employee(db, code="C1NULL", contract_end_date=None)
    make_employee(db, code="C1SORTANT", status="sortant", contract_end_date=today + timedelta(days=5))
    make_employee(db, code="C1OVERDUE", contract_end_date=today - timedelta(days=3))

    findings = contract_expiring.detect(db, allowed_societies=None, today=today)
    codes = {f.evidence["employee_code"] for f in findings} & {"C1SOON", "C1FAR", "C1NULL", "C1SORTANT", "C1OVERDUE"}
    assert codes == {"C1SOON", "C1OVERDUE"}
    overdue = next(f for f in findings if f.evidence["employee_code"] == "C1OVERDUE")
    assert overdue.score_context["days_remaining"] == -3
    assert overdue.rule_key == RULE_CONTRACT_EXPIRING


def test_contract_detector_society_scoping(db):
    today = date(2026, 9, 13)
    make_employee(db, code="C2SOCA", society=SOC_A, contract_end_date=today + timedelta(days=2))
    make_employee(db, code="C2SOCB", society=SOC_B, contract_end_date=today + timedelta(days=2))

    findings = contract_expiring.detect(db, allowed_societies=[SOC_A], today=today)
    codes = {f.evidence["employee_code"] for f in findings} & {"C2SOCA", "C2SOCB"}
    assert codes == {"C2SOCA"}
    assert contract_expiring.detect(db, allowed_societies=[], today=today) == []


# ── Détecteur présence ─────────────────────────────────────────────────────

def test_missing_checkout_detector_threshold(db):
    emp = make_employee(db, code="P1EMP")
    ref = datetime(2026, 9, 13, 20, 0)
    make_presence(db, employee=emp, presence_date=date(2026, 9, 13), arrival_time="06:00")  # 14h -> détecté
    make_presence(db, employee=emp, presence_date=date(2026, 9, 13), arrival_time="19:30")  # 30min -> pas détecté
    findings = [f for f in missing_checkout.detect(db, allowed_societies=None, reference_datetime=ref, threshold_minutes=12 * 60)
                if f.evidence["employee_code"] == "P1EMP"]
    assert len(findings) == 1
    assert findings[0].evidence["elapsed_minutes"] == 14 * 60
    assert findings[0].rule_key == RULE_MISSING_CHECKOUT


def test_missing_checkout_ignores_closed_or_departed(db):
    emp = make_employee(db, code="P2CLOSED")
    ref = datetime(2026, 9, 13, 20, 0)
    make_presence(db, employee=emp, presence_date=date(2026, 9, 13), arrival_time="06:00", departure_time="14:00")
    make_presence(db, employee=emp, presence_date=date(2026, 9, 13), arrival_time="06:00", closed_at=datetime(2026, 9, 13, 15, 0))
    findings = [f for f in missing_checkout.detect(db, allowed_societies=None, reference_datetime=ref)
                if f.evidence["employee_code"] == "P2CLOSED"]
    assert findings == []


def test_missing_checkout_site_and_society_from_employee(db):
    site = Site(name="Site Test 0.6-A")
    db.add(site)
    db.flush()
    emp = make_employee(db, code="P3SITE", society=SOC_A)
    ref = datetime(2026, 9, 13, 20, 0)
    make_presence(db, employee=emp, presence_date=date(2026, 9, 13), arrival_time="06:00", site_id=site.id)
    findings = [f for f in missing_checkout.detect(db, allowed_societies=None, reference_datetime=ref)
                if f.evidence["employee_code"] == "P3SITE"]
    assert len(findings) == 1
    assert findings[0].site_id == site.id
    assert findings[0].society == SOC_A


# ── Scoring ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("days_remaining,expected_min_score", [(30, 30), (15, 50), (7, 70), (0, 90), (-5, 90)])
def test_score_contract_expiring_bands(days_remaining, expected_min_score):
    result = score_contract_expiring(days_remaining=days_remaining, employee_status="actif")
    assert result.score >= expected_min_score
    assert result.severity in {"info", "warning", "critical"}
    assert result.confidence == 100
    assert result.factors and result.explanation


def test_score_contract_expiring_monotonic_with_proximity():
    far = score_contract_expiring(days_remaining=30, employee_status="actif")
    near = score_contract_expiring(days_remaining=0, employee_status="actif")
    assert near.score > far.score
    assert near.severity == "critical"


def test_score_missing_checkout_bands():
    at_threshold = score_missing_checkout(elapsed_minutes=720, threshold_minutes=720)
    far_over = score_missing_checkout(elapsed_minutes=720 * 3, threshold_minutes=720)
    assert far_over.score > at_threshold.score
    assert far_over.severity == "critical"


# ── Déduplication / répétition / preuves ────────────────────────────────────

def test_dedup_same_occurrence_updates_instead_of_duplicating(db):
    alert1, created1 = service.apply_finding(db, make_finding(employee_id=10001), rule_version=1)
    alert2, created2 = service.apply_finding(db, make_finding(employee_id=10001, days_remaining=4), rule_version=1)
    assert created1 is True
    assert created2 is False
    assert alert1.id == alert2.id
    assert alert2.occurrence_count == 2
    assert db.query(Alert).filter(Alert.dedup_key == alert1.dedup_key).count() == 1


def test_apply_finding_writes_evidence_and_history(db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10002), rule_version=1)
    evidence = repository.list_evidence(db, alert.id)
    history = repository.list_history(db, alert.id)
    assert len(evidence) == 1
    assert evidence[0].evidence_value_json["employee_code"] == "E10002"
    assert any(h.action == "detected" and h.new_status == "open" for h in history)


def test_resolve_stale_alerts_marks_resolved_when_occurrence_disappears(db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10003), rule_version=1)
    resolved = service.resolve_stale_alerts(db, rule_key=RULE_CONTRACT_EXPIRING, active_dedup_keys=set())
    db.flush()
    db.refresh(alert)
    assert resolved >= 1
    assert alert.status == "resolved"


def test_reappearance_after_resolution_reopens(db):
    finding = make_finding(employee_id=10004)
    alert, _ = service.apply_finding(db, finding, rule_version=1)
    service.resolve_stale_alerts(db, rule_key=RULE_CONTRACT_EXPIRING, active_dedup_keys=set())
    alert2, created = service.apply_finding(db, finding, rule_version=1)
    assert created is False
    assert alert2.id == alert.id
    assert alert2.status == "open"


def test_ignored_alert_is_not_auto_reopened_by_reappearance(db):
    finding = make_finding(employee_id=10005)
    alert, _ = service.apply_finding(db, finding, rule_version=1)
    db.flush()
    service.apply_lifecycle_action(db, alert, action="ignore", actor_user_id=1, reason="Cas connu, sans suite")
    alert2, created = service.apply_finding(db, finding, rule_version=1)
    assert created is False
    assert alert2.status == "ignored"


# ── Cycle de vie ─────────────────────────────────────────────────────────────

def test_lifecycle_valid_transition_matrix_has_no_self_loop():
    for status, targets in ALLOWED_TRANSITIONS.items():
        assert status not in targets


def test_lifecycle_invalid_transition_rejected():
    with pytest.raises(InvalidTransitionError):
        ensure_valid_transition("treated", "assigned")
    ensure_valid_transition("open", "acknowledged")  # ne lève pas


def test_apply_lifecycle_action_rejects_invalid_transition(db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10006), rule_version=1)
    db.flush()
    service.apply_lifecycle_action(db, alert, action="treated", actor_user_id=1)
    with pytest.raises(InvalidTransitionError):
        service.apply_lifecycle_action(db, alert, action="assign", actor_user_id=1, assigned_user_id=2)


def test_ignore_without_reason_is_rejected(db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10007), rule_version=1)
    db.flush()
    with pytest.raises(ValueError):
        service.apply_lifecycle_action(db, alert, action="ignore", actor_user_id=1, reason="   ")


def test_assign_and_acknowledge_recorded_in_history(db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10008), rule_version=1)
    db.flush()
    service.apply_lifecycle_action(db, alert, action="assign", actor_user_id=1, assigned_user_id=1)
    assert alert.assigned_user_id == 1
    service.apply_lifecycle_action(db, alert, action="acknowledge", actor_user_id=1)
    assert alert.status == "acknowledged"
    actions = {h.action for h in repository.list_history(db, alert.id)}
    assert {"assign", "acknowledge"} <= actions


# ── Repository scoped ─────────────────────────────────────────────────────

def test_repository_list_alerts_scoped_by_society(db):
    alert_a, _ = service.apply_finding(db, make_finding(employee_id=10009, society=SOC_A, contract_end_date="2026-09-19"), rule_version=1)
    alert_b, _ = service.apply_finding(db, make_finding(employee_id=10010, society=SOC_B, contract_end_date="2026-09-19"), rule_version=1)
    db.flush()
    rows_a, _ = repository.list_alerts(db, allowed_societies=[SOC_A], allowed_site_ids=None, limit=1000)
    ids_a = {r.id for r in rows_a}
    assert alert_a.id in ids_a
    assert alert_b.id not in ids_a


def test_repository_site_scope_keeps_siteless_alerts_visible(db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10011), rule_version=1)  # site_id=None (contrat)
    db.flush()
    rows, _ = repository.list_alerts(db, allowed_societies=None, allowed_site_ids=[999999], limit=1000)
    assert alert.id in {r.id for r in rows}


def test_stats_are_scoped(db):
    service.apply_finding(db, make_finding(employee_id=10012), rule_version=1)
    db.flush()
    scoped = repository.stats(db, allowed_societies=["SOCIETE_INCONNUE_TEST"], allowed_site_ids=None)
    assert scoped["total_open"] == 0
    unscoped = repository.stats(db, allowed_societies=None, allowed_site_ids=None)
    assert unscoped["total_open"] >= 1


# ── DetectionRun / orchestrateur ─────────────────────────────────────────────

def test_run_detector_records_detection_run(db):
    findings = [make_finding(employee_id=10013, contract_end_date="2026-09-19"),
                make_finding(employee_id=10014, contract_end_date="2026-09-20")]
    result = service.run_detector(db, detector_key="drh.employee_contract.expiring", rule_key=RULE_CONTRACT_EXPIRING, findings=findings, rule_version=1)
    assert result["created"] == 2
    run = db.query(DetectionRun).order_by(DetectionRun.id.desc()).first()
    assert run.status == "success"
    assert run.created_count == 2
    assert run.detector_key == "drh.employee_contract.expiring"


def test_scheduler_isolates_detector_failure(db):
    def failing_detect(_db):
        raise RuntimeError("panne détecteur")

    result = _run_one_detector(db, "boom.detector.0.6a.test", RULE_CONTRACT_EXPIRING, failing_detect)
    assert "error" in result
    run = db.query(DetectionRun).filter(DetectionRun.detector_key == "boom.detector.0.6a.test").first()
    assert run.status == "failed"
    assert run.error_count == 1


# ── Concurrence sur le même dedup_key ────────────────────────────────────────

def test_concurrent_creation_same_dedup_key_yields_single_alert(live_client, live_headers):
    """Deux threads, chacun avec sa PROPRE session DB (comme deux requêtes HTTP
    concurrentes), appliquent le MÊME finding en même temps. La contrainte
    unique + le rattrapage par SAVEPOINT dans service.apply_finding doivent
    garantir qu'une seule ligne Alert existe au final."""
    from app.db.session import SessionLocal

    dedup_dimensions = {"employee_id": 999001, "contract_end_date": "2026-10-01"}
    barrier = threading.Barrier(2)
    errors = []

    def worker():
        session = SessionLocal()
        try:
            barrier.wait(timeout=5)
            finding = DetectorFinding(
                rule_key=RULE_CONTRACT_EXPIRING, source_type="employee", source_id="999001", society=SOC_A, site_id=None,
                title="Contrat concurrent", summary="s",
                evidence={"employee_id": 999001, "employee_code": "CONC", "status": "actif", "contract_type": "CDI",
                          "contract_end_date": "2026-10-01", "days_remaining": 10, "society": SOC_A},
                score_context={"days_remaining": 10, "employee_status": "actif"},
                dedup_dimensions=dedup_dimensions,
            )
            service.apply_finding(session, finding, rule_version=1)
            session.commit()
        except Exception as exc:  # pragma: no cover
            errors.append(exc)
        finally:
            session.close()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, errors
    verify = SessionLocal()
    try:
        dedup_key = service.build_dedup_key(RULE_CONTRACT_EXPIRING, dedup_dimensions)
        matches = verify.query(Alert).filter(Alert.dedup_key == dedup_key).all()
        assert len(matches) == 1
        assert matches[0].occurrence_count in (1, 2)
    finally:
        verify.close()


# ── API scoped ─────────────────────────────────────────────────────────────

def test_api_requires_authentication(client):
    resp = client.get("/api/alerts")
    assert resp.status_code in (401, 403)


def test_api_list_and_stats_and_detail(client, auth_headers, db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10015), rule_version=1)
    db.flush()
    resp = client.get("/api/alerts", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 1
    resp_stats = client.get("/api/alerts/stats", headers=auth_headers)
    assert resp_stats.status_code == 200
    resp_detail = client.get(f"/api/alerts/{alert.id}", headers=auth_headers)
    assert resp_detail.status_code == 200
    detail = resp_detail.json()
    assert detail["id"] == alert.id
    assert detail["score_factors"]


def test_api_scoped_detail_404_outside_scope(client, restricted_headers, db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10016, society=SOC_B, contract_end_date="2026-09-21"), rule_version=1)
    db.flush()
    resp = client.get(f"/api/alerts/{alert.id}", headers=restricted_headers)
    assert resp.status_code == 404


def test_api_ignore_requires_reason(client, auth_headers, db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10017), rule_version=1)
    db.flush()
    resp = client.post(f"/api/alerts/{alert.id}/ignore", json={"reason": "  "}, headers=auth_headers)
    assert resp.status_code == 422


def test_api_lifecycle_actions_and_invalid_transition(client, auth_headers, db):
    alert, _ = service.apply_finding(db, make_finding(employee_id=10018), rule_version=1)
    db.flush()
    resp_treated = client.post(f"/api/alerts/{alert.id}/treated", headers=auth_headers)
    assert resp_treated.status_code == 200
    resp_assign = client.post(f"/api/alerts/{alert.id}/assign", json={"user_id": 5}, headers=auth_headers)
    assert resp_assign.status_code == 409
