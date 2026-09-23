"""Hotfix Administration — expose site_workforce dans le catalogue de modules (§1-11).

Audit préalable (voir rapport) : la source canonique unique du catalogue "Modules
accessibles" est ADMIN_LOGIN_MODULES (app/static/sgdi-app.js), qui pilote À LA FOIS
l'affichage des cases à cocher ET la construction du payload authorized_modules envoyé au
backend (app/static/js/modules/administration-user-forms.js). Le backend (schémas,
service, RBAC) acceptait déjà "site_workforce" sans transformation — authorized_modules
est une liste de chaînes libres, non contrainte par un enum — le défaut était donc
purement frontend (case absente = impossible à cocher), jamais une limitation backend.
Ces tests prouvent le round-trip RÉEL via les endpoints Administration (POST/PATCH
/api/auth/users), jamais une construction directe d'objet User qui contournerait le
chemin réellement emprunté par l'interface d'administration.
"""
import uuid
from datetime import date, timedelta

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site

SOC = "DHL Forwarding"


def test_admin_create_user_persists_exactly_site_workforce_key(client, auth_headers):
    """§8.B — cocher "Chargé des effectifs" et enregistrer doit persister EXACTEMENT
    la clé site_workforce, jamais une transformation vers drh/ops/attendance/autre."""
    r = client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_test", "email": "ce01_test@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [],
        "password": "ce01password", "validation_password": "validation123",
    })
    assert r.status_code in (200, 201), r.text
    assert r.json()["authorized_modules"] == ["site_workforce"]


def test_admin_reload_after_save_keeps_site_workforce_checked(client, auth_headers, db):
    """§8.C — relecture après sauvegarde : la case doit rester cochée (le GET renvoie
    bien la clé persistée, pas une valeur par défaut/dérivée)."""
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_reload", "email": "ce01_reload@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [],
        "password": "ce01password", "validation_password": "validation123",
    })
    rows = client.get("/api/auth/users", headers=auth_headers).json()
    reloaded = next(u for u in rows if u["username"] == "CE01_RELOAD" or u["username"] == "ce01_reload")
    assert "site_workforce" in reloaded["authorized_modules"]


def test_admin_uncheck_site_workforce_removes_key(client, auth_headers):
    """§8.D — décocher retire exactement la clé, sans effet de bord sur les autres."""
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_uncheck", "email": "ce01_uncheck@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce", "drh"],
        "authorized_societies": [SOC], "authorized_sites": [],
        "password": "ce01password", "validation_password": "validation123",
    })
    r = client.patch("/api/auth/users/ce01_uncheck", headers=auth_headers, json={
        "authorized_modules": ["drh"],  # site_workforce décoché dans le formulaire
    })
    assert r.status_code == 200, r.text
    assert r.json()["authorized_modules"] == ["drh"]
    assert "site_workforce" not in r.json()["authorized_modules"]


def test_auth_me_exposes_site_workforce_in_effective_modules(client, auth_headers):
    """§4 — GET /api/auth/me doit exposer site_workforce dans effective_modules selon le
    contrat actuel (_normalized_module_keys, aucune transformation)."""
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_me", "email": "ce01_me@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [],
        "password": "ce01password", "validation_password": "validation123",
    })
    r = client.post("/api/auth/login", json={"username": "ce01_me", "password": "ce01password"})
    token = r.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert "site_workforce" in me["effective_modules"]
    # §7 sécurité : aucun autre module accordé implicitement.
    assert me["effective_modules"] == ["site_workforce"]
    assert me["module_access_global"] is False


def _seeded_site(db):
    # POST /auth/users committe réellement (comme le reste du backend) sur la même session
    # que le fixture `db` : un identifiant fixe réutilisé par plusieurs tests finirait par
    # violer une contrainte UNIQUE (même cause déjà rencontrée et corrigée dans
    # tests/test_site_workforce.py) — un tag aléatoire l'élimine à la racine.
    tag = uuid.uuid4().hex[:8]
    site = Site(name=f"HAMOUL 01 (40K) {tag}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    emp = Employee(code=f"CE01EMP-{tag}", first_name="A", last_name="B", society=SOC, status="actif")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date.today() - timedelta(days=30), active=1))
    db.flush()
    return site, emp


def test_user_without_site_workforce_module_still_refused_by_portal(client, auth_headers, db):
    """§8.E — un utilisateur SANS site_workforce reste refusé (403), même créé/mis à jour
    via l'endpoint Administration réel."""
    site, emp = _seeded_site(db)
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_nomod", "email": "ce01_nomod@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["drh"],  # jamais site_workforce
        "authorized_societies": [SOC], "authorized_sites": [site.id],
        "password": "ce01password", "validation_password": "validation123",
    })
    r = client.post("/api/auth/login", json={"username": "ce01_nomod", "password": "ce01password"})
    token = r.json()["access_token"]
    dash = client.get("/api/site-workforce/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert dash.status_code == 403


def test_user_with_site_workforce_society_and_exactly_one_site_is_allowed(client, auth_headers, db):
    """§8.F — module + société + EXACTEMENT un site, créé via l'endpoint Administration
    réel : le portail autorise l'accès."""
    site, emp = _seeded_site(db)
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_ok", "email": "ce01_ok@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [site.id],
        "authorized_actions": ["read", "create", "update", "validate"],
        "password": "ce01password", "validation_password": "validation123",
    })
    r = client.post("/api/auth/login", json={"username": "ce01_ok", "password": "ce01password"})
    token = r.json()["access_token"]
    dash = client.get("/api/site-workforce/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert dash.status_code == 200
    assert dash.json()["site"]["id"] == site.id


def test_user_with_site_workforce_and_multiple_sites_still_refused(client, auth_headers, db):
    """§5/§8.G — l'Administration peut permettre plusieurs sites (règle générale
    inchangée), mais Site Workforce continue de refuser tant que le compte a plus d'un
    site — la règle "un seul site" reste backend-autoritaire, jamais assouplie ici."""
    site_a, _ = _seeded_site(db)
    site_b = Site(name="Site B secondaire", active=1, equipment_plan={"societe": SOC})
    db.add(site_b); db.flush()
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_multi", "email": "ce01_multi@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [site_a.id, site_b.id],
        "password": "ce01password", "validation_password": "validation123",
    })
    r = client.post("/api/auth/login", json={"username": "ce01_multi", "password": "ce01password"})
    token = r.json()["access_token"]
    dash = client.get("/api/site-workforce/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert dash.status_code == 403


def test_granting_site_workforce_never_implicitly_grants_other_modules(client, auth_headers):
    """§7/§8.H — cocher uniquement "Chargé des effectifs" n'accorde jamais DRH/OPS/Finances
    implicitement, et le compte reste refusé sur ces autres périmètres."""
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_isolated", "email": "ce01_isolated@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [],
        "password": "ce01password", "validation_password": "validation123",
    })
    r = client.post("/api/auth/login", json={"username": "ce01_isolated", "password": "ce01password"})
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/drh/employees", headers=headers).status_code == 403
    assert client.get("/api/ops/sites", headers=headers).status_code == 403
    assert client.get("/api/finance-core/obligations", headers=headers, params={"society": SOC}).status_code == 403
