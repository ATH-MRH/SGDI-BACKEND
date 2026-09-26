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


def test_admin_create_user_persists_exactly_site_workforce_key(client, auth_headers, db):
    """§8.B — cocher "Chargé des effectifs" et enregistrer doit persister EXACTEMENT
    la clé site_workforce, jamais une transformation vers drh/ops/attendance/autre."""
    site, _ = _seeded_site(db)
    r = client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_test", "email": "ce01_test@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [site.id],
        "password": "ce01password", "validation_password": "validation123",
    })
    assert r.status_code in (200, 201), r.text
    assert r.json()["authorized_modules"] == ["site_workforce"]


def test_admin_reload_after_save_keeps_site_workforce_checked(client, auth_headers, db):
    """§8.C — relecture après sauvegarde : la case doit rester cochée (le GET renvoie
    bien la clé persistée, pas une valeur par défaut/dérivée)."""
    site, _ = _seeded_site(db)
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_reload", "email": "ce01_reload@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [site.id],
        "password": "ce01password", "validation_password": "validation123",
    })
    rows = client.get("/api/auth/users", headers=auth_headers).json()
    reloaded = next(u for u in rows if u["username"] == "CE01_RELOAD" or u["username"] == "ce01_reload")
    assert "site_workforce" in reloaded["authorized_modules"]


def test_admin_uncheck_site_workforce_removes_key(client, auth_headers, db):
    """§8.D — décocher retire exactement la clé, sans effet de bord sur les autres."""
    site, _ = _seeded_site(db)
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_uncheck", "email": "ce01_uncheck@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce", "drh"],
        "authorized_societies": [SOC], "authorized_sites": [site.id],
        "password": "ce01password", "validation_password": "validation123",
    })
    r = client.patch("/api/auth/users/ce01_uncheck", headers=auth_headers, json={
        "authorized_modules": ["drh"],  # site_workforce décoché dans le formulaire
    })
    assert r.status_code == 200, r.text
    assert r.json()["authorized_modules"] == ["drh"]
    assert "site_workforce" not in r.json()["authorized_modules"]


def test_auth_me_exposes_site_workforce_in_effective_modules(client, auth_headers, db):
    """§4 — GET /api/auth/me doit exposer site_workforce dans effective_modules selon le
    contrat actuel (_normalized_module_keys, aucune transformation)."""
    site, _ = _seeded_site(db)
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_me", "email": "ce01_me@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [site.id],
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


def _legacy_beo_user(db, username, *, societies, sites):
    """Compte BEO posé directement en base, comme une donnée antérieure à la garde
    d'écriture : sert à prouver que les gardes RUNTIME restent en place."""
    user = User(username=username.upper(), email=f"{username}@test.com", full_name=username,
                role="charge_effectifs_site", access_level="H2", authorized_modules=["site_workforce"],
                authorized_societies=societies, authorized_sites=sites, authorized_structures=[],
                authorized_actions=[], password_hash=hash_password("ce01password"), is_active=True)
    db.add(user); db.flush()
    return user


def test_user_with_site_workforce_and_multiple_sites_still_refused(client, auth_headers, db):
    """§5/§8.G — un compte BEO multi-sites (donnée héritée : l'Administration refuse
    désormais de l'écrire) reste refusé par le portail — la garde runtime
    resolve_scoped_site() est conservée en plus de la garde d'écriture."""
    site_a, _ = _seeded_site(db)
    site_b = Site(name=f"Site B secondaire {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": SOC})
    db.add(site_b); db.flush()
    _legacy_beo_user(db, "ce01_multi", societies=[SOC], sites=[site_a.id, site_b.id])
    dash = client.get("/api/site-workforce/dashboard", headers=_login(client, "ce01_multi"))
    assert dash.status_code == 403


def test_granting_site_workforce_never_implicitly_grants_other_modules(client, auth_headers, db):
    """§7/§8.H — cocher uniquement "Chargé des effectifs" n'accorde jamais DRH/OPS/Finances
    implicitement, et le compte reste refusé sur ces autres périmètres."""
    site, _ = _seeded_site(db)
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_isolated", "email": "ce01_isolated@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [site.id],
        "password": "ce01password", "validation_password": "validation123",
    })
    r = client.post("/api/auth/login", json={"username": "ce01_isolated", "password": "ce01password"})
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/drh/employees", headers=headers).status_code == 403
    assert client.get("/api/ops/sites", headers=headers).status_code == 403
    assert client.get("/api/finance-core/obligations", headers=headers, params={"society": SOC}).status_code == 403


def _login(client, username, password="ce01password"):
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_beo_user_cannot_modify_own_scope_permissions_or_users(client, auth_headers, db):
    """Administration BEO §14/§16.J — un chargé des effectifs ne peut ni changer son site,
    ni s'accorder DRH, ni modifier ses actions, ni créer/lister des comptes : tout
    /api/auth/users reste réservé aux administrateurs (require_admin)."""
    site, _ = _seeded_site(db)
    other = Site(name=f"Autre site {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": SOC})
    db.add(other); db.flush()
    client.post("/api/auth/users", headers=auth_headers, json={
        "username": "ce01_self", "email": "ce01_self@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [site.id],
        "authorized_actions": ["read"],
        "password": "ce01password", "validation_password": "validation123",
    })
    headers = _login(client, "ce01_self")
    for payload in (
        {"authorized_sites": [site.id, other.id]},
        {"authorized_modules": ["site_workforce", "drh"]},
        {"authorized_actions": ["read", "create", "update", "validate"]},
        {"role": "admin"},
    ):
        assert client.patch("/api/auth/users/ce01_self", headers=headers, json=payload).status_code == 403
    assert client.get("/api/auth/users", headers=headers).status_code == 403
    assert client.post("/api/auth/users", headers=headers, json={
        "username": "ce01_child", "email": "ce01_child@test.com", "role": "agent",
        "access_level": "H1", "authorized_modules": ["drh"],
        "password": "ce01password", "validation_password": "validation123",
    }).status_code == 403
    # Rien n'a bougé côté base.
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["effective_modules"] == ["site_workforce"]
    assert [int(v) for v in me["authorized_sites"]] == [site.id]


def test_admin_can_fix_beo_scope_and_portal_follows(client, auth_headers, db):
    """Administration BEO §16.K — un admin autorisé passe un compte de "plusieurs sites"
    (périmètre invalide, portail refusé) à exactement un site : le portail l'accepte alors,
    sans qu'aucun autre module ne soit ajouté."""
    site_a, _ = _seeded_site(db)
    site_b = Site(name=f"Site B {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": SOC})
    db.add(site_b); db.flush()
    _legacy_beo_user(db, "ce01_fix", societies=[SOC], sites=[site_a.id, site_b.id])
    assert client.get("/api/site-workforce/dashboard", headers=_login(client, "ce01_fix")).status_code == 403
    r = client.patch("/api/auth/users/ce01_fix", headers=auth_headers, json={
        "authorized_sites": [site_a.id], "authorized_actions": ["read", "create", "update", "validate"],
    })
    assert r.status_code == 200, r.text
    assert r.json()["authorized_modules"] == ["site_workforce"]
    headers = _login(client, "ce01_fix")
    dash = client.get("/api/site-workforce/dashboard", headers=headers)
    assert dash.status_code == 200
    assert dash.json()["site"]["id"] == site_a.id
    assert client.get("/api/drh/employees", headers=headers).status_code == 403
    assert client.get("/api/ops/sites", headers=headers).status_code == 403


# ── Revue finale BEO : garde d'écriture backend (création ET modification) ────────────
OTHER_SOC = "Autre Société BEO"


def _beo_payload(username, **overrides):
    payload = {
        "username": username, "email": f"{username}@test.com", "role": "charge_effectifs_site",
        "access_level": "H2", "authorized_modules": ["site_workforce"],
        "authorized_societies": [SOC], "authorized_sites": [],
        "authorized_actions": ["read", "create", "update", "validate"],
        "password": "ce01password", "validation_password": "validation123",
    }
    payload.update(overrides)
    return payload


def _assert_refused(r, fragment):
    assert r.status_code == 422, r.text
    assert "Chargé des effectifs" in r.json()["detail"] and fragment in r.json()["detail"], r.text


def test_beo_create_without_society_refused(client, auth_headers, db):
    """A — aucune société : refus explicite (jamais "vide = toutes")."""
    site, _ = _seeded_site(db)
    r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_a", authorized_societies=[], authorized_sites=[site.id]))
    _assert_refused(r, "société autorisée est obligatoire")
    r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_a2", authorized_societies=["  "], authorized_sites=[site.id]))
    _assert_refused(r, "société autorisée est obligatoire")


def test_beo_create_without_site_refused(client, auth_headers, db):
    """B — aucun site : refus."""
    r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_b"))
    _assert_refused(r, "site autorisé est obligatoire")


def test_beo_create_with_several_societies_refused(client, auth_headers, db):
    """C — plusieurs sociétés : refus (règle = une seule société)."""
    site, _ = _seeded_site(db)
    r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_c", authorized_societies=[SOC, OTHER_SOC], authorized_sites=[site.id]))
    _assert_refused(r, "une seule société")


def test_beo_create_with_several_sites_refused(client, auth_headers, db):
    """D — plusieurs sites : refus."""
    site_a, _ = _seeded_site(db)
    site_b, _ = _seeded_site(db)
    r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_d", authorized_sites=[site_a.id, site_b.id]))
    _assert_refused(r, "un seul site")


def test_beo_create_with_site_outside_society_refused(client, auth_headers, db):
    """E — site d'une autre société (la liste filtrée du frontend n'est jamais crue) : refus.
    Un site inexistant ou l'accès global aux sociétés sont aussi refusés."""
    foreign = Site(name=f"Site étranger {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": OTHER_SOC})
    db.add(foreign); db.flush()
    r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_e", authorized_sites=[foreign.id]))
    _assert_refused(r, "n'appartient pas à la société autorisée")
    r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_e2", authorized_sites=[999999]))
    _assert_refused(r, "site introuvable")
    site, _ = _seeded_site(db)
    r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_e3", authorized_sites=[site.id], global_society_access=True))
    _assert_refused(r, "accès global")


def test_beo_create_with_consistent_society_and_site_succeeds(client, auth_headers, db):
    """F — une société + un site de cette société : succès, sans aucun autre module."""
    site, _ = _seeded_site(db)
    r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_f", authorized_sites=[site.id]))
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body["authorized_modules"] == ["site_workforce"]
    assert body["authorized_societies"] == [SOC]
    assert [int(v) for v in body["authorized_sites"]] == [site.id]


def test_non_beo_accounts_keep_historical_scope_semantics(client, auth_headers, db):
    """G — hors rôle chargé des effectifs, rien ne change : sociétés vides, plusieurs
    sites, site hors société restent enregistrables, y compris avec site_workforce."""
    site_a, _ = _seeded_site(db)
    site_b = Site(name=f"Site G {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": OTHER_SOC})
    db.add(site_b); db.flush()
    for username, role, modules in (("hist_ops", "ops", ["ops", "drh"]),
                                    ("hist_agent_sw", "agent", ["site_workforce"]),
                                    ("hist_ce_nomod", "charge_effectifs_site", ["drh"])):
        r = client.post("/api/auth/users", headers=auth_headers, json=_beo_payload(
            username, role=role, authorized_modules=modules, authorized_societies=[],
            authorized_sites=[site_a.id, site_b.id]))
        assert r.status_code in (200, 201), (username, r.text)
    r = client.patch("/api/auth/users/hist_ops", headers=auth_headers, json={"authorized_sites": []})
    assert r.status_code == 200, r.text


def test_beo_patch_cannot_create_invalid_state(client, auth_headers, db):
    """H — PATCH partiel : l'état FINAL fusionné est validé ; un refus ne modifie rien."""
    site, _ = _seeded_site(db)
    site_b, _ = _seeded_site(db)
    foreign = Site(name=f"Site H {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": OTHER_SOC})
    db.add(foreign); db.flush()
    assert client.post("/api/auth/users", headers=auth_headers, json=_beo_payload("beo_h", authorized_sites=[site.id])).status_code in (200, 201)
    for payload, fragment in (
        ({"authorized_societies": []}, "société autorisée est obligatoire"),
        ({"authorized_societies": [SOC, OTHER_SOC]}, "une seule société"),
        ({"authorized_sites": []}, "site autorisé est obligatoire"),
        ({"authorized_sites": [site.id, site_b.id]}, "un seul site"),
        ({"authorized_sites": [foreign.id]}, "n'appartient pas"),
        ({"authorized_societies": [OTHER_SOC]}, "n'appartient pas"),
        ({"global_society_access": True}, "accès global"),
    ):
        _assert_refused(client.patch("/api/auth/users/beo_h", headers=auth_headers, json=payload), fragment)
    # Un compte non-BEO qui DEVIENT BEO par PATCH est validé aussi.
    assert client.post("/api/auth/users", headers=auth_headers, json=_beo_payload(
        "beo_h_ops", role="ops", authorized_modules=["ops"], authorized_societies=[], authorized_sites=[])).status_code in (200, 201)
    _assert_refused(client.patch("/api/auth/users/beo_h_ops", headers=auth_headers, json={
        "role": "charge_effectifs_site", "authorized_modules": ["site_workforce"]}), "société autorisée est obligatoire")
    # Rien n'a été persisté par les refus ; changer de site dans la société reste permis,
    # et retirer site_workforce sort le compte de la règle.
    rows = {u["username"]: u for u in client.get("/api/auth/users", headers=auth_headers).json()}
    assert [int(v) for v in rows["BEO_H"]["authorized_sites"]] == [site.id]
    assert rows["BEO_H"]["authorized_societies"] == [SOC]
    assert rows["BEO_H_OPS"]["role"] == "ops"
    assert client.patch("/api/auth/users/beo_h", headers=auth_headers, json={"authorized_sites": [site_b.id]}).status_code == 200
    r = client.patch("/api/auth/users/beo_h", headers=auth_headers, json={"authorized_modules": ["pointage"], "authorized_sites": []})
    assert r.status_code == 200, r.text


def test_invalid_beo_account_can_always_be_suspended_but_not_reactivated(client, auth_headers, db):
    """Suspendre un compte BEO mal configuré (donnée héritée) n'est jamais bloqué ; le
    réactiver repasse par la garde tant que le périmètre n'est pas corrigé."""
    site, _ = _seeded_site(db)
    _legacy_beo_user(db, "ce01_legacy", societies=[SOC], sites=[])
    assert client.patch("/api/auth/users/ce01_legacy", headers=auth_headers, json={"is_active": False}).status_code == 200
    _assert_refused(client.patch("/api/auth/users/ce01_legacy", headers=auth_headers, json={"is_active": True}),
                    "site autorisé est obligatoire")
    r = client.patch("/api/auth/users/ce01_legacy", headers=auth_headers, json={"is_active": True, "authorized_sites": [site.id]})
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is True
