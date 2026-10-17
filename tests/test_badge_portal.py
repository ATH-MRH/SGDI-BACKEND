"""Portail autonome badge.irongs.com : même application, mêmes API et droits que le Studio Badges DRH."""
import re
import uuid
from datetime import date, timedelta

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.badge_models import EmployeeBadge
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_drh_badges import API, SOC, _employee, clean_badges, drh, fast_portrait  # noqa: F401

BADGE = {"host": "badge.irongs.com"}
DRH = {"host": "drh.irongs.com"}


def _user(db, *, modules, username=None):
    name = username or f"BP{uuid.uuid4().int % 10**6:06d}"
    user = User(username=name, full_name=name, role="drh", access_level="H2", password_hash=hash_password("portail-badge-1"),
                is_active=True, authorized_modules=modules, authorized_societies=[SOC])
    db.add(user)
    db.commit()
    return name


def _login(client, name, host):
    return client.post("/api/auth/login", json={"username": name, "password": "portail-badge-1"}, headers={"host": host})


def test_badge_host_serves_the_same_versioned_app_marked_as_badge_portal(client):
    portal = client.get("/", headers=BADGE)
    hr = client.get("/", headers=DRH)
    assert portal.status_code == 200 and hr.status_code == 200
    assert "window.__BADGE_AUTONOMOUS_APP__=true" in portal.text and "__BADGE_AUTONOMOUS_APP__" not in hr.text
    assert "<title>STUDIO BADGES — IRON GLOBAL</title>" in portal.text
    assert 'data-standalone-module="badge"' in portal.text and 'data-atlas-surface="badge"' in portal.text
    scripts = lambda html: re.findall(r'src="(/static/[^"]+)"', html)  # noqa: E731
    assert scripts(portal.text) == scripts(hr.text)                     # mêmes fichiers, mêmes versions
    assert portal.headers["cache-control"].startswith("no-cache")


def test_login_on_the_badge_host_requires_the_dedicated_badge_module(client, db):
    assert _login(client, _user(db, modules=["badge"]), "badge.irongs.com").status_code == 200          # module Studio Badges
    assert _login(client, _user(db, modules=["drh"]), "badge.irongs.com").status_code == 403            # DRH seul : refusé
    assert _login(client, _user(db, modules=["commercial"]), "badge.irongs.com").status_code == 403
    legacy_ok = _user(db, modules=None, username=f"DRH{uuid.uuid4().int % 10**5:05d}")
    legacy_ko = _user(db, modules=None, username=f"COM{uuid.uuid4().int % 10**5:05d}")
    assert _login(client, legacy_ok, "badge.irongs.com").status_code == 200                            # comptes historiques DRH
    assert _login(client, legacy_ko, "badge.irongs.com").status_code == 403
    assert _login(client, _user(db, modules=["badge"]), "drh.irongs.com").status_code == 403            # et l'inverse


def _token(client, name):
    return {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": name, "password": "portail-badge-1"}).json()["access_token"]}


def test_badge_api_requires_the_badge_module_on_every_host(client, db, drh):
    emp = _employee(db)
    for host in (BADGE, DRH):
        headers = {**drh, **host}
        rights = client.get(f"{API}/permissions", headers=headers).json()
        assert all(rights[key] for key in ("create", "validate", "export", "admin")) and rights["reasons"] == {}
        assert client.get(f"{API}/employees/{emp.id}", headers=headers).status_code == 200
    badge_only = _token(client, _user(db, modules=["badge"]))
    assert client.get(f"{API}/dashboard", headers={**badge_only, **BADGE}).status_code == 200            # sans module DRH
    assert client.get(f"{API}/employees/{emp.id}", headers=badge_only).status_code == 200
    assert client.post(f"{API}/preview/pdf", json={"employee_id": emp.id}, headers=badge_only).status_code == 200
    issued = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=badge_only)         # droit opérationnel du module
    assert issued.status_code == 200, issued.text
    assert client.post(f"{API}/{issued.json()['id']}/revoke", json={"reason": "perdu"}, headers=badge_only).status_code == 403
    drh_only = _token(client, _user(db, modules=["drh"]))
    assert client.get(f"{API}/dashboard", headers={**drh_only, **DRH}).status_code == 403              # DRH seul : plus d'accès
    assert client.get("/api/drh/employees", headers=drh_only).status_code != 403                       # le reste de la DRH inchangé
    outsider = _token(client, _user(db, modules=["commercial"]))
    assert client.get(f"{API}/dashboard", headers={**outsider, **BADGE}).status_code == 403


def test_admin_catalog_presents_studio_badges_as_its_own_module():
    from app.core.permission_catalog import catalog_entries

    entries = {entry["entry_key"]: entry for entry in catalog_entries()}
    badge = entries["badge"]
    assert badge["label"] == "Studio Badges" and badge["domain"] == "badge.irongs.com" and badge["module_key"] == "drh"
    assert [feature["feature_key"] for feature in badge["features"]] == ["badges"]                      # stockage inchangé : drh/badges
    assert "badges" not in [feature["feature_key"] for feature in entries["drh"]["features"]]


def test_dashboard_counts_the_badge_fleet_and_filters_by_site(client, db, drh):
    first, second, third = _employee(db), _employee(db), _employee(db)
    ids = [client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()["id"] for emp in (first, second, third)]
    client.post(f"{API}/{ids[1]}/revoke", json={"reason": "perdu"}, headers=drh)
    expired = db.get(EmployeeBadge, ids[2])
    expired.valid_until = date.today() - timedelta(days=1)
    db.commit()
    data = client.get(f"{API}/dashboard", headers=drh).json()
    assert data["total_badges"] >= 3 and data["lost"] >= 1 and data["revoked"] >= 1
    assert data["expired"] >= 1 and data["to_renew"] >= data["expired"] and data["active"] >= 1
    assert data["recent_issues"] and all(event["action"] == "EMISSION" for event in data["recent_issues"])
    from app.modules.ops.models import Assignment

    site_of = lambda emp: db.query(Assignment.site_id).filter(Assignment.employee_id == emp.id).scalar()  # noqa: E731
    by_site = client.get(f"{API}/dashboard", params={"site_id": site_of(third)}, headers=drh).json()   # chaque employé de test a son site
    assert by_site["employees"] == 1 and by_site["total_badges"] == 1 and by_site["expired"] == 1 and by_site["active"] == 0
    assert client.get(f"{API}/dashboard", params={"site_id": site_of(second)}, headers=drh).json()["lost"] == 1
