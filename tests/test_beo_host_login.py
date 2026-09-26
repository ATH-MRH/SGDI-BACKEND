"""beo.irongs.com — connexion et routage du portail Bureau des Effectifs Ouest.

Cause du refus observé en production (« Ce module n'est pas autorisé pour votre compte ») :
enforce_subdomain_login_scope() déduisait la clé module du sous-domaine ("beo") sans
alias vers la clé RBAC canonique "site_workforce" ; de plus "/" servait le shell ATLAS
générique sur ce host au lieu du portail Site Workforce.
"""
import uuid

from app.modules.auth.routes import required_module_for_subdomain
from app.modules.ops.models import Site

SOC = "DHL Forwarding"
BEO = {"host": "beo.irongs.com"}


def _site(db):
    site = Site(name=f"BEO site {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    return site


def _create(client, auth_headers, username, **overrides):
    payload = {
        "username": username, "email": f"{username}@test.com", "role": "agent",
        "access_level": "H2", "authorized_modules": ["drh"],
        "authorized_societies": [SOC], "authorized_sites": [],
        "password": "beopassword1", "validation_password": "validation123",
    }
    payload.update(overrides)
    r = client.post("/api/auth/users", headers=auth_headers, json=payload)
    assert r.status_code in (200, 201), r.text


def _beo_account(client, auth_headers, db, username):
    site = _site(db)
    _create(client, auth_headers, username, role="charge_effectifs_site", authorized_modules=["site_workforce"],
            authorized_sites=[site.id], authorized_actions=["read", "create", "update", "validate"])
    return site


def _login(client, username, headers=BEO):
    return client.post("/api/auth/login", json={"username": username, "password": "beopassword1"}, headers=headers)


def test_beo_host_requires_exactly_site_workforce():
    assert required_module_for_subdomain("beo") == "site_workforce"
    # Mappings historiques inchangés.
    assert required_module_for_subdomain("finance") == "finances"
    assert required_module_for_subdomain("commercial") == "dc"
    assert required_module_for_subdomain("drh") == "drh"


def test_beo_host_login_allowed_with_site_workforce(client, auth_headers, db):
    site = _beo_account(client, auth_headers, db, "beo_ok")
    r = _login(client, "beo_ok")
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}", **BEO}
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["effective_modules"] == ["site_workforce"]
    dash = client.get("/api/site-workforce/dashboard", headers=headers)
    assert dash.status_code == 200
    assert dash.json()["site"]["id"] == site.id


def test_beo_host_login_refused_without_site_workforce(client, auth_headers):
    _create(client, auth_headers, "beo_none", authorized_modules=["pointage"])
    r = _login(client, "beo_none")
    assert r.status_code == 403
    assert "pas autorisé" in r.json()["detail"]


def test_beo_host_login_refused_with_drh_only(client, auth_headers):
    _create(client, auth_headers, "beo_drh", role="ops", authorized_modules=["drh"])
    assert _login(client, "beo_drh").status_code == 403


def test_beo_host_login_never_accepts_a_literal_beo_module_key(client, auth_headers):
    """La clé RBAC reste exclusivement site_workforce : un module "beo" n'ouvre rien."""
    _create(client, auth_headers, "beo_literal", authorized_modules=["beo"])
    assert _login(client, "beo_literal").status_code == 403


def test_site_workforce_alone_never_grants_drh_ops_finance(client, auth_headers, db):
    _beo_account(client, auth_headers, db, "beo_iso")
    token = _login(client, "beo_iso").json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/drh/employees", headers=headers).status_code == 403
    assert client.get("/api/ops/sites", headers=headers).status_code == 403
    assert client.get("/api/finance-core/obligations", headers=headers, params={"society": SOC}).status_code == 403
    # Et ces sous-domaines refusent la connexion du compte BEO.
    for host in ("drh.irongs.com", "ops.irongs.com", "finance.irongs.com"):
        assert _login(client, "beo_iso", headers={"host": host}).status_code == 403, host


def test_beo_host_root_serves_site_workforce_portal(client):
    r = client.get("/", headers=BEO)
    assert r.status_code == 200
    assert "/static/site-workforce/shell.js" in r.text
    assert 'id="app"' not in r.text  # jamais le shell ATLAS/DRH
    assert "no-store" in r.headers.get("cache-control", "")


def test_other_hosts_root_unchanged(client):
    for host in ("drh.irongs.com", "ops.irongs.com", "atlas.irongs.com"):
        r = client.get("/", headers={"host": host})
        assert r.status_code == 200
        assert "/static/site-workforce/shell.js" not in r.text, host
