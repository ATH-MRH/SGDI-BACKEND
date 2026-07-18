"""Confidentialité inter-sociétés en LECTURE sur OPS (fuites signalées).

events, pointage journalier, dashboard, mouvements et standby ne doivent JAMAIS
révéler les données d'une société non autorisée. + close_event lié à un employé seul.
"""
import pytest

from app.core.security import hash_password
from app.modules.auth.models import User

SOC = "Iron Global Securite"
SOC2 = "Iron Global Solution"
FOREIGN = "Sword Corporation"


def _mk(db, username, level, societies):
    if not db.query(User).filter(User.username == username).first():
        db.add(User(
            username=username, email=f"{username}@t.com", full_name=username,
            role="ops", access_level=level, authorized_societies=societies,
            authorized_structures=[], password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()


def _hdr(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def multi_soc_headers(client, db):
    _mk(db, "ops_multi", "H3", [SOC, SOC2])
    return _hdr(client, "ops_multi")


def _emp(client, h, code, society):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "R", "society": society, "status": "actif",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _site(client, h, name, society):
    r = client.post("/api/ops/sites", headers=h, json={
        "name": name, "indicatif": name[:3].upper(), "rotation_system": "24/48",
        "contractual_staff": 1, "active": 1, "equipment_plan": {"societe": society},
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ── 1. Événements ────────────────────────────────────────────────────────────

def test_restreint_ne_voit_pas_evenements_etrangers(client, auth_headers, restricted_headers):
    site_f = _site(client, auth_headers, "Site Evt Etr Read", FOREIGN)
    ev = client.post("/api/ops/events", headers=auth_headers, json={"title": "EVT_ETR", "message": "x", "site_id": int(site_f)})
    assert ev.status_code in (200, 201), ev.text
    titres = {e["title"] for e in client.get("/api/ops/events", headers=restricted_headers).json()}
    assert "EVT_ETR" not in titres
    page = {e["title"] for e in client.get("/api/ops/events/page?page_size=200", headers=restricted_headers).json()["items"]}
    assert "EVT_ETR" not in page


# ── 2. Pointage journalier ───────────────────────────────────────────────────

def test_restreint_ne_voit_pas_presences_etrangeres(client, auth_headers, restricted_headers):
    emp_f = _emp(client, auth_headers, "READ_FP", FOREIGN)
    site_f = _site(client, auth_headers, "Site Pres Etr", FOREIGN)
    created = client.post("/api/ops/pointage/daily", headers=auth_headers, json={
        "presence_date": "2026-05-01", "employee_id": int(emp_f), "site_id": int(site_f), "status": "present",
    })
    assert created.status_code in (200, 201), created.text
    rows = client.get("/api/ops/pointage/daily?presence_date=2026-05-01", headers=restricted_headers).json()
    assert all(r.get("site_id") != int(site_f) for r in rows), "présence d'une autre société visible"
    page = client.get("/api/ops/pointage/daily/page?presence_date=2026-05-01&page_size=200", headers=restricted_headers).json()["items"]
    assert all(r.get("site_id") != int(site_f) for r in page)


# ── 3. Dashboard (compteurs scopés) ──────────────────────────────────────────

def test_dashboard_ne_compte_pas_les_sites_etrangers(client, auth_headers, restricted_headers):
    before = client.get("/api/ops/dashboard", headers=restricted_headers).json()["active_sites"]
    _site(client, auth_headers, "Site Dash Etr", FOREIGN)
    after = client.get("/api/ops/dashboard", headers=restricted_headers).json()["active_sites"]
    assert after == before, "un site d'une autre société est compté dans le dashboard restreint"


# ── 4. Mouvements multi-sociétés ─────────────────────────────────────────────

def test_mouvements_multi_societe_ne_fuit_pas(client, auth_headers, multi_soc_headers):
    for soc, ext in [(SOC, "MV_IGS"), (SOC2, "MV_IGSOL"), (FOREIGN, "MV_SWORD")]:
        r = client.post("/api/ops/movements", headers=auth_headers, json={
            "movement_type": "test", "movement_date": "2026-05-01", "society": soc,
            "external_id": ext, "movement_number": ext,
        })
        assert r.status_code in (200, 201), r.text
    ext_vus = {m.get("external_id") for m in client.get("/api/ops/movements", headers=multi_soc_headers).json()}
    assert "MV_SWORD" not in ext_vus, "mouvement d'une société non autorisée visible"


# ── 5. Standby (scopé, pas d'erreur) ─────────────────────────────────────────

def test_standby_restreint_repond_liste_scopee(client, restricted_headers):
    r = client.get("/api/ops/pointage/standby?presence_date=2026-05-01", headers=restricted_headers)
    assert r.status_code == 200
    assert all(s.get("society", "").upper().replace("É", "E") != FOREIGN.upper() for s in r.json())


# ── 6. close_event lié à un employé seul (sans site) ─────────────────────────

def test_close_event_employe_propre_autorise(client, auth_headers, restricted_headers):
    emp = _emp(client, auth_headers, "READ_EVE", SOC)
    ev = client.post("/api/ops/events", headers=auth_headers, json={"title": "EmpEvt", "message": "x", "employee_id": int(emp)})
    assert ev.status_code in (200, 201), ev.text
    r = client.post(f"/api/ops/events/{ev.json()['id']}/close", headers=restricted_headers)
    assert r.status_code == 200, r.text


def test_close_event_employe_etranger_refuse(client, auth_headers, restricted_headers):
    emp_f = _emp(client, auth_headers, "READ_EVEF", FOREIGN)
    ev = client.post("/api/ops/events", headers=auth_headers, json={"title": "EmpEvtF", "message": "x", "employee_id": int(emp_f)})
    assert ev.status_code in (200, 201), ev.text
    r = client.post(f"/api/ops/events/{ev.json()['id']}/close", headers=restricted_headers)
    assert r.status_code == 403, r.text
