"""Vues des quatre écrans : planning mensuel OPS, aperçu de brouillon, couverture BEO.
Mêmes occurrences et mêmes attendus que le Pointeur (test_central_rotation_expected_population)."""
from datetime import date, timedelta

import pytest
from sqlalchemy import delete, func, select

from app.core.security import hash_password
from app.modules.attendance import core, live
from app.modules.auth.models import AuditEvent, User
from app.modules.rotations import views
from app.modules.rotations.models import OfficialRotation, RotationDraft
from tests.test_attendance_counted_time import ACTOR, ANCHOR, SOC, _tag, _ts
from tests.test_central_rotation_engine import config
from tests.test_central_rotation_expected_population import AT_NIGHT, NIGHT_DAY, central_site, clean, staff  # noqa: F401


def test_published_month_respects_one_third_rules_and_kpis(db, central_site):
    site = central_site["site"]
    month = views.month_view(db, site.id, "2026-10")
    assert month["regime"] == "1/3" and month["versions"] == [1] and len(month["days"]) == 31
    for day in month["days"]:
        for slot in day["slots"]:
            if slot["group"] == "A":
                assert slot["shift"] == "JOUR" and not day["weekend"] and not day["holiday"]
            assert slot["occurrence_id"].startswith(f"{site.id}:{central_site['published'].id}:")
        assert set(day["off_groups"]) | {s["group"] for s in day["slots"] if s["group"]} == set("ABCD")
    first = month["days"][0]
    assert [(s["label"], s["group"], s["start"], s["end"]) for s in first["slots"]] == [("Jour", "A", "08:00", "17:00"), ("Nuit", "B", "17:00", "08:00")]
    assert first["slots"][1]["planned_staff"] == 2
    assert month["kpis"]["planned_staff"] == 5 and month["kpis"]["critical_points"] == 0
    assert all(rule["ok"] for rule in month["summary"]["rules"])
    assert month["summary"]["coverage"]["weekends"][0] == month["summary"]["coverage"]["weekends"][1] > 0
    night = live.control_post(db, site.id, AT_NIGHT)["current"]
    assert first["slots"][1]["occurrence_id"] == night["occurrence_id"]       # OPS = Pointeur


def test_understaffed_and_uncovered_are_distinct_critical_points(db, central_site):
    site = central_site["site"]
    month = views.month_view(db, site.id, "2026-10")
    assert not any(c["code"] == "UNDERSTAFFED" for d in month["days"] for c in d["critical"])
    # Effectif requis 3 la nuit : groupe présent mais insuffisant → SOUS-EFFECTIF, jamais NON COUVERTE.
    short = views.preview(db, site.id, config("1/3", anchor=str(ANCHOR), required_staff={"JOUR": 1, "NUIT": 3}), "2026-10")
    codes = {c["code"] for d in short["days"] for c in d["critical"]}
    assert "UNDERSTAFFED" in codes and "UNCOVERED_SHIFT" not in codes
    # Un repos impossible à respecter laisse un jour de week-end sans groupe admissible : NON COUVERTE.
    uncovered = views.preview(db, None, config("1/3", anchor=str(ANCHOR), minimum_rest_minutes=1500), "2026-10")
    labels = {c["label"] for d in uncovered["days"] for c in d["critical"]}
    assert "VACATION NON COUVERTE" in labels and "SOUS-EFFECTIF" not in labels


def test_preview_never_writes_and_rejects_invalid_configuration(db, client, auth_headers, central_site):
    site = central_site["site"]
    before = (db.scalar(select(func.count(RotationDraft.id))), db.scalar(select(func.count(AuditEvent.id))))
    response = client.post("/api/ops/central-rotations/preview", headers=auth_headers,
                           json={"site_id": site.id, "month": "2026-11", "config": config("24H48", anchor="2026-11-01")})
    assert response.status_code == 200, response.text
    assert response.json()["regime"] == "24H48" and response.json()["kpis"]["day_slots"] == 30
    assert (db.scalar(select(func.count(RotationDraft.id))), db.scalar(select(func.count(AuditEvent.id)))) == before
    bad = client.post("/api/ops/central-rotations/preview", headers=auth_headers,
                      json={"month": "2026-11", "config": {**config("1/3"), "phases": {"A": 0}}})
    assert bad.status_code == 422 and "Phases" in bad.text


def test_site_list_shows_labels_and_month_route(db, client, auth_headers, central_site):
    site = central_site["site"]
    sites = client.get("/api/ops/central-rotations/sites", headers=auth_headers).json()["items"]
    entry = next(s for s in sites if s["id"] == site.id)
    assert entry["name"] == site.name and entry["structure"] == SOC
    month = client.get(f"/api/ops/central-rotations/sites/{site.id}/month", params={"month": "2026-10"}, headers=auth_headers)
    assert month.status_code == 200 and month.json()["site"]["name"] == site.name
    assert client.get(f"/api/ops/central-rotations/sites/{site.id}/month", params={"month": "2026-13"}, headers=auth_headers).status_code == 422
    overview = client.get("/api/ops/central-rotations/overview", headers=auth_headers).json()
    assert overview["active_sites"] >= 1 and set(overview) == {"active_sites", "active_regimes", "critical_points", "drafts_to_validate"}


def beo_headers(client, db, site):
    username = f"beo_{_tag()}"
    db.add(User(username=username, full_name="Chargé BEO", role="charge_effectifs_site", access_level="H2",
                authorized_societies=[SOC], authorized_structures=[], authorized_modules=["site_workforce"],
                authorized_sites=[site.id], authorized_actions=["read"], password_hash=hash_password("beo-pass-1"),
                validation_password_hash=hash_password("x"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": username, "password": "beo-pass-1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_beo_coverage_matches_pointeur_and_engine(db, client, central_site, monkeypatch):
    site = central_site["site"]
    b1, _ = central_site["B"]
    core.record_scan(db, employee=b1, source="QR", actor=ACTOR, idempotency_key=None, now=_ts(NIGHT_DAY, "17:20"))
    monkeypatch.setattr(core, "_now_local", lambda: AT_NIGHT)
    headers = beo_headers(client, db, site)
    response = client.get("/api/site-workforce/attendance/coverage", params={"date": NIGHT_DAY.isoformat(), "shift": "NUIT"}, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    row = body["rows"][0]
    pointeur = live.control_post(db, site.id, AT_NIGHT)
    assert row["occurrence_id"] == pointeur["current"]["occurrence_id"]
    assert (row["expected"], row["present"], row["late"], row["group"], row["regime_label"]) == (2, 1, 1, "B", "1/3")
    assert row["expected"] == pointeur["kpi"]["expected"]
    assert row["absent"] == 1 and row["status_label"] == "Attention"        # 1 présent sur 2 attendus, requis 1
    assert body["kpis"]["expected"] == 2 and body["kpis"]["late"] == 1
    day = client.get("/api/site-workforce/attendance/coverage", params={"date": NIGHT_DAY.isoformat(), "shift": "JOUR"}, headers=headers).json()
    assert [r["group"] for r in day["rows"]] == ["A"]
    other = client.get("/api/site-workforce/attendance/coverage", params={"date": NIGHT_DAY.isoformat(), "group": "C"}, headers=headers).json()
    assert other["rows"] == []


def test_beo_coverage_statuses(db, central_site, monkeypatch):
    site = central_site["site"]
    sites = {site.id: site}
    # Personne n'est arrivé après le seuil : CRITIQUE ; avant le début : couvert par le planning.
    critical = views.coverage(db, {site.id}, NIGHT_DAY, now=AT_NIGHT, shift_kind="NUIT", sites=sites)["rows"][0]
    assert critical["status_label"] == "Critique" and critical["present"] == 0 and critical["absent"] == 2
    early = views.coverage(db, {site.id}, NIGHT_DAY, now=_ts(NIGHT_DAY, "10:00"), shift_kind="NUIT", sites=sites)["rows"][0]
    assert early["status_label"] == "Couvert" and early["present"] is None and early["absent"] == 0
