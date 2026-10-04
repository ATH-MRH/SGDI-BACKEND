"""Lot 4 : historique individuel, récapitulatif mensuel et contractuel — calculés à la demande
depuis les événements, les anomalies, l'audit et le planning officiel. Des faits, aucun jugement."""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import event as sa_event, select

from app.modules.attendance import core, live, official, recap
from app.modules.attendance.models import AttendanceAnomaly
from app.modules.drh.models import Contract, Employee
from app.modules.ops.models import Assignment, Site, SiteRotation
from tests.conftest import test_engine
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_attendance_counted_time import ANCHOR, NEXT, SOC, _iso, _scan, _setup, _tag, _ts

OCT_31, NOV_1 = date(2026, 10, 31), date(2026, 11, 1)
POINTER = SimpleNamespace(id=None, username="POINTEUR")


def _month(db, emp, month="2026-10", **scope):
    return recap.monthly(db, emp, month, **scope)


def _worked_month(db):
    """Groupe A : Matin normal le 1er, maintien l'après-midi, une tentative refusée, puis Matin
    en retard le 2 avec sortie anticipée."""
    emp, site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "05:40")
    _scan(db, emp, ANCHOR, "14:06")
    with pytest.raises(HTTPException):
        _scan(db, emp, ANCHOR, "14:20")                               # nouvelle entrée avant TFIN+30 : refusée
    _scan(db, emp, ANCHOR, "14:35")
    _scan(db, emp, ANCHOR, "22:00")
    _scan(db, emp, NEXT, "06:40")
    _scan(db, emp, NEXT, "13:30")
    return emp, site


# ── Mois sans données ────────────────────────────────────────────────────────────────────
def test_month_without_data(db):
    emp, _site = _setup(db, regime=None)
    out = _month(db, emp, "2026-03")
    assert out["history"] == out["refusals"] == out["anomalies"] == out["planned"] == [] and out["materialized"] is False
    assert all(value in (0, 0.0, {}) for value in out["summary"].values())
    with pytest.raises(ValueError):
        _month(db, emp, "2026-13")


# ── Mois complet : planifié, réalisé, comptabilisé ───────────────────────────────────────
def test_full_month_summary_and_history(db):
    emp, site = _worked_month(db)
    out = _month(db, emp)
    summary = out["summary"]
    assert summary["planned_shifts"] == sum(1 for day in range(31) if day % 8 < 6) == 24      # cycle officiel du groupe A
    assert (summary["worked_shifts"], summary["counted_minutes"], summary["counted_hours"]) == (2, 480 + 410, 14.83)
    assert (summary["early_arrivals"], summary["late_arrivals"], summary["early_exits"], summary["late_exits"]) == (1, 1, 1, 1)
    assert (summary["extra_shifts"], summary["extra_counted_minutes"], summary["extra_treatments"]) == (1, 445, {"A_QUALIFIER": 1})
    assert (summary["refused_attempts"], summary["refused_by_code"]) == (1, {"EXTRA_BEFORE_WINDOW": 1})
    assert (summary["manual_entries"], summary["other_presences"], summary["open_shifts"]) == (0, 0, 0)
    assert summary["anomalies_by_type"] == {"EXTRA_SHIFT": 1, "LATE": 1} and summary["anomalies_open"] == 2

    first, extra, second = out["history"]
    assert (first["date"], first["site"], first["group"], first["kind"], first["shift"]) == (ANCHOR.isoformat(), site.name, "A", "NORMAL", "MATIN")
    assert (first["scheduled_start"], first["actual_entry"], first["counted_start"]) == (_iso(ANCHOR, "06:00"), _iso(ANCHOR, "05:40"), _iso(ANCHOR, "06:00"))
    assert (first["actual_exit"], first["counted_end"], first["counted_minutes"], first["treatment"]) == (_iso(ANCHOR, "14:06"), _iso(ANCHOR, "14:00"), 480, None)
    assert (extra["kind"], extra["shift"], extra["counted_start"], extra["counted_minutes"]) == ("EXTRA_SHIFT", "APRES_MIDI", _iso(ANCHOR, "14:35"), 445)
    assert (extra["treatment"], extra["treatment_label"]) == ("A_QUALIFIER", "À qualifier (récupération ou paiement)")
    assert [a["type"] for a in extra["anomalies"]] == ["EXTRA_SHIFT"]
    assert (second["entry_status"], second["counted_minutes"], [a["type"] for a in second["anomalies"]]) == ("AFTER_START", 410, ["LATE"])


def test_refused_attempt_is_listed_but_never_counted(db):
    emp, site = _worked_month(db)
    out = _month(db, emp)
    refusal = out["refusals"][0]
    assert (refusal["code"], refusal["at"], refusal["site"], refusal["recorded"]) == ("EXTRA_BEFORE_WINDOW", _iso(ANCHOR, "14:20"), site.name, False)
    assert "14:30" in refusal["message"]
    assert len(out["history"]) == 3                                   # la tentative n'est pas une vacation
    assert sum(row["counted_minutes"] for row in out["history"]) == out["summary"]["counted_minutes"] + out["summary"]["extra_counted_minutes"]


def test_summary_states_facts_and_never_judges(db):
    emp, _site = _worked_month(db)
    text = str(_month(db, emp)).lower()
    for word in ("fraude", "sanction", "conduite", "défavorable", "renouvellement", "faute"):
        assert word not in text


# ── Anomalie résolue conservée ───────────────────────────────────────────────────────────
def test_resolved_anomaly_stays_in_the_recap(db):
    emp, site = _setup(db)                                            # groupe B : Après-midi
    _scan(db, emp, ANCHOR, "13:50")
    live.live(db, {site.id}, after_id=0, after_refusal_id=None, now=_ts(ANCHOR, "22:46"))
    before = _month(db, emp)["summary"]
    assert (before["relief_anomalies"], before["anomalies_open"], before["open_shifts"]) == (1, 1, 1)
    _scan(db, emp, ANCHOR, "22:50")
    out = _month(db, emp)
    assert (out["summary"]["relief_anomalies"], out["summary"]["anomalies_open"], out["summary"]["anomalies_resolved"]) == (1, 0, 1)
    assert out["summary"]["regularisations"] == 1 and out["summary"]["open_shifts"] == 0
    anomaly = next(a for a in out["anomalies"] if a["type"] == "VACATION_NON_CLOTUREE")
    assert (anomaly["status"], anomaly["resolved_by"], anomaly["resolution"]) == ("RESOLVED", "system", "Sortie enregistrée à 22:50:00")
    assert out["history"][0]["anomalies"][0]["status"] == "RESOLVED"


# ── Nuit traversant le mois ──────────────────────────────────────────────────────────────
def test_night_shift_across_the_month_boundary_belongs_to_its_start_day(db):
    emp, _site = _setup(db, group="D")                                # 31 octobre : Nuit 22:00 → 06:00
    _scan(db, emp, OCT_31, "21:50")
    _scan(db, emp, NOV_1, "06:05")
    october, november = _month(db, emp, "2026-10"), _month(db, emp, "2026-11")
    assert [(row["date"], row["shift"], row["actual_exit"], row["counted_minutes"]) for row in october["history"]] == [
        (OCT_31.isoformat(), "NUIT", _iso(NOV_1, "06:05"), 480)]
    assert october["summary"]["counted_minutes"] == 480
    assert november["history"] == [] and november["summary"]["counted_minutes"] == 0


# ── Changement de site / de société : périmètre ──────────────────────────────────────────
def _second_site(db, emp, society):
    site = Site(name=f"Site second {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.flush()
    model = official.ensure_official_model(db)
    db.add(SiteRotation(site_id=site.id, rotation_id=model.id, start_date=ANCHOR, active=1))
    first = db.execute(select(Assignment).where(Assignment.employee_id == emp.id)).scalar_one()
    first.end_date, first.active = NEXT, 0
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=NEXT + timedelta(days=1), active=1,
                      work_regime=official.REGIME_POSTE_CONTINU, rotation_id=model.id))
    db.commit()
    return site


def test_site_change_is_followed_and_scope_is_enforced(db):
    emp, first = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "06:00")
    _scan(db, emp, ANCHOR, "14:00")
    second = _second_site(db, emp, SOC)
    third_day = ANCHOR + timedelta(days=2)                            # J3 du groupe A : Après-midi
    _scan(db, emp, third_day, "14:00")
    _scan(db, emp, third_day, "22:00")
    everything = _month(db, emp)
    assert [(row["site"], row["shift"]) for row in everything["history"]] == [(first.name, "MATIN"), (second.name, "APRES_MIDI")]
    assert everything["summary"]["planned_shifts"] == 24 and everything["summary"]["counted_minutes"] == 960
    scoped = _month(db, emp, site_ids={second.id})
    assert [row["site"] for row in scoped["history"]] == [second.name] and scoped["summary"]["counted_minutes"] == 480
    assert all(row["site_id"] == second.id for row in scoped["planned"])


def test_company_change_restricted_account_only_sees_its_own_company(client, db, auth_headers, restricted_headers):
    emp, first = _setup(db, group="A")                                # société du compte restreint
    _scan(db, emp, ANCHOR, "06:00")
    _scan(db, emp, ANCHOR, "14:00")
    other = _second_site(db, emp, "AUTRE SOCIETE")
    third_day = ANCHOR + timedelta(days=2)
    _scan(db, emp, third_day, "14:00")
    _scan(db, emp, third_day, "22:00")
    url = f"/api/attendance/employees/{emp.id}/monthly-recap?month=2026-10"
    full = client.get(url, headers=auth_headers).json()
    assert {row["site"] for row in full["history"]} == {first.name, other.name}
    restricted = client.get(url, headers=restricted_headers)
    assert restricted.status_code == 200, restricted.text
    assert {row["site"] for row in restricted.json()["history"]} == {first.name}
    assert restricted.json()["summary"]["counted_minutes"] == 480
    embedded = client.get(f"/api/attendance/employees/{emp.id}?days=10&month=2026-10", headers=restricted_headers).json()
    assert embedded["recap"]["summary"]["counted_minutes"] == 480 and "recap" not in client.get(
        f"/api/attendance/employees/{emp.id}?days=10", headers=auth_headers).json()


# ── RBAC : refus par défaut ──────────────────────────────────────────────────────────────
def test_recap_api_is_denied_by_default(client, db, auth_headers, restricted_headers):
    site = Site(name=f"Site hors périmètre {_tag()}", active=1, equipment_plan={"societe": "AUTRE SOCIETE"})
    emp = Employee(code=f"RC{_tag()}", first_name="Hors", last_name="Périmètre", society="AUTRE SOCIETE", status="actif")
    db.add_all([site, emp]); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    for path in ("monthly-recap?month=2026-10", "contract-recap"):
        url = f"/api/attendance/employees/{emp.id}/{path}"
        assert client.get(url).status_code in (401, 403)
        assert client.get(url, headers=restricted_headers).status_code == 404
        assert client.get(url, headers=auth_headers).status_code == 200
    assert client.get(f"/api/attendance/employees/{emp.id}/monthly-recap?month=2026-1", headers=auth_headers).status_code == 422
    assert client.get("/api/attendance/employees/999999999/contract-recap", headers=auth_headers).status_code == 404


# ── Période contractuelle ────────────────────────────────────────────────────────────────
def test_contract_recap_uses_the_real_contract_period(db):
    emp, _site = _worked_month(db)
    db.add(Contract(employee_id=emp.id, contract_type="CDD", start_date=date(2026, 9, 15), end_date=date(2026, 10, 20), status="actif"))
    db.commit()
    out = recap.contract(db, emp, today=date(2026, 12, 1))
    assert (out["computable"], out["contract_type"], out["start_date"], out["end_date"], out["open_ended"]) == (True, "CDD", "2026-09-15", "2026-10-20", False)
    assert (out["date_from"], out["date_to"]) == ("2026-09-15", "2026-10-20")
    assert out["summary"]["planned_shifts"] == sum(1 for day in range(20) if day % 8 < 6) == 16     # rien avant l'ancrage du 1er octobre
    assert (out["summary"]["worked_shifts"], out["summary"]["extra_shifts"], out["summary"]["refused_attempts"]) == (2, 1, 1)
    assert out["summary"]["unconfigured_days"] == 16                  # 15 → 30 septembre : rotation non configurée, rien d'inventé
    assert [m["month"] for m in out["months"]] == ["2026-10"] and out["months"][0]["summary"]["counted_minutes"] == 890
    assert out["summary"]["extra_treatments"] == {"A_QUALIFIER": 1}
    # Contrat en cours : jamais au-delà d'aujourd'hui.
    running = recap.contract(db, emp, today=date(2026, 10, 1))
    assert (running["date_to"], running["summary"]["worked_shifts"], running["summary"]["extra_shifts"]) == ("2026-10-01", 1, 1)


def test_open_ended_contract_runs_until_today(db):
    emp, _site = _worked_month(db)
    db.add(Contract(employee_id=emp.id, contract_type="CDI", start_date=ANCHOR, status="actif"))
    db.commit()
    out = recap.contract(db, emp, today=NEXT)
    assert (out["open_ended"], out["end_date"], out["date_to"], out["summary"]["worked_shifts"]) == (True, None, NEXT.isoformat(), 2)


def test_contract_recap_is_not_computable_without_a_reliable_period(client, db, auth_headers):
    emp, _site = _worked_month(db)
    out = recap.contract(db, emp)
    assert out["computable"] is False and "non calculable" in out["reason"] and "summary" not in out
    db.add(Contract(employee_id=emp.id, contract_type="CDD", start_date=None, end_date=date(2026, 12, 31), status="actif"))
    db.commit()
    assert recap.contract(db, emp)["computable"] is False             # aucune date de début n'est inventée
    body = client.get(f"/api/attendance/employees/{emp.id}/contract-recap", headers=auth_headers).json()
    assert body["computable"] is False and body["employee_id"] == emp.id


# ── Performance : aucune requête par jour ────────────────────────────────────────────────
def test_recap_runs_a_constant_number_of_queries(db):
    emp, _site = _worked_month(db)
    db.add(Contract(employee_id=emp.id, contract_type="CDI", start_date=date(2026, 1, 1), status="actif"))
    db.commit()
    counts = []

    def count(*_args):
        counts[-1] += 1

    sa_event.listen(test_engine, "before_cursor_execute", count)
    try:
        for start, end in ((ANCHOR, ANCHOR), (ANCHOR, OCT_31), (date(2026, 1, 1), date(2026, 12, 31))):
            db.expire_all()
            counts.append(0)
            recap.period(db, emp, start, end)
    finally:
        sa_event.remove(test_engine, "before_cursor_execute", count)
    assert counts[0] == counts[1] == counts[2] <= 10, counts
