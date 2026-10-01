"""pointeur.irongs.com dans le modèle d'autorisation ATLAS.

Domaine métier Pointage = deux applications distinctes, chacune ouverte par sa clé de module
existante : « pointage » (pointage.irongs.com, gestion) et « pointeur » (pointeur.irongs.com,
terminal terrain). L'accès est vérifié à la connexion ET, sur pointeur.irongs.com, à chaque
requête. Les permissions biométriques fines restent uniques (domaine attendance) et
indépendantes des cases « Modules accessibles ». La borne faciale n'utilise aucun compte."""
import uuid
from datetime import date

import pytest

from app.core.config import settings
from app.core.permission_catalog import CANONICAL_MODULES, FEATURE_CATALOG
from app.core.security import hash_password
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.ops.models import Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "IRON GLOBAL SOLUTION"
POINTEUR = {"Host": "pointeur.irongs.com"}
POINTAGE = {"Host": "pointage.irongs.com"}
PASSWORD = "pointeur-test-1234"


@pytest.fixture(autouse=True)
def flags(monkeypatch):
    # État de production attendu : Mode Test et enrôlement ouverts, pointage facial FERMÉ.
    monkeypatch.setattr(settings, "biometric_test_mode_enabled", True)
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)
    monkeypatch.setattr(settings, "biometric_enabled", False)


def _site(db):
    site = Site(name=f"HAMOUL {uuid.uuid4().hex[:5]}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.commit()
    return site


def _account(db, *, prefix="PTG", modules=("pointeur",), features=(), actions=None, site=None):
    """modules=None : compte historique (authorized_modules NULL, contrôle par préfixe)."""
    username = f"{prefix}{uuid.uuid4().int % 10**6:06d}"        # préfixe + chiffres, comme PTG77
    user = User(username=username, full_name=username, role="agent", access_level="H2", password_hash=hash_password(PASSWORD),
                is_active=True, authorized_modules=list(modules) if modules is not None else None,
                authorized_societies=[SOC], authorized_sites=[site.id] if site else [],
                authorized_actions=list(actions) if actions else None)
    db.add(user); db.flush()
    for feature, action in features:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance", feature_key=feature, action_key=action))
    db.commit()
    return username


def _login(client, username, host):
    return client.post("/api/auth/login", headers=host, json={"username": username, "password": PASSWORD})


def _token(client, username, host):
    r = _login(client, username, host)
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


# ── Catalogue : un domaine, deux applications, permissions biométriques uniques ──────────
def test_catalog_declares_both_applications_without_duplicating_permissions(client, auth_headers):
    attendance = FEATURE_CATALOG["attendance"]
    assert [a["module_key"] for a in attendance["applications"]] == ["pointage", "pointeur"]
    assert {a["domain"] for a in attendance["applications"]} == {"pointage.irongs.com", "pointeur.irongs.com"}
    assert "pointeur" not in CANONICAL_MODULES                         # pas de second domaine concurrent
    biometric = [k for m in FEATURE_CATALOG.values() for k in m["features"] if k.startswith("biometric_")]
    assert sorted(biometric) == ["biometric_admin", "biometric_enrollment", "biometric_status"]
    payload = client.get("/api/auth/granular-permissions/feature-catalog", headers=auth_headers)
    assert payload.status_code == 200, payload.text
    body = payload.json()
    module = next(m for m in body["modules"] if m["module_key"] == "attendance")
    assert [a["label"] for a in module["applications"]] == ["Pointage", "Pointeur terrain"]
    assert module["applications"][1]["description"] == "Scanner QR, terminal terrain et pointage facial"
    assert all("applications" in m for m in body["modules"])          # champ toujours présent (liste vide sinon)


# ── Accès applicatif : quatre profils ────────────────────────────────────────────────────
def test_pointage_only_never_opens_the_field_terminal(client, db):
    user = _account(db, modules=("pointage",))
    assert _login(client, user, POINTAGE).status_code == 200
    assert _login(client, user, POINTEUR).status_code == 403
    # Jeton obtenu sur pointage.irongs.com présenté sur pointeur.irongs.com : refusé aussi.
    h = _token(client, user, POINTAGE)
    assert client.get("/api/biometrics/test-mode/status", headers={**h, **POINTEUR}).status_code == 403
    assert client.get("/api/portal/attendance-sites", headers={**h, **POINTEUR}).status_code == 403


def test_pointeur_only_never_opens_management_drh_or_administration(client, db):
    site = _site(db)
    user = _account(db, modules=("pointeur",), site=site)
    assert _login(client, user, POINTEUR).status_code == 200
    assert _login(client, user, POINTAGE).status_code == 403
    assert _login(client, user, {"Host": "drh.irongs.com"}).status_code == 403
    h = _token(client, user, POINTEUR)
    assert client.get("/api/portal/attendance-sites", headers={**h, **POINTEUR}).status_code == 200
    assert client.get("/api/attendance/sites", headers={**h, **POINTEUR}).status_code == 403     # centre de contrôle
    assert client.get("/api/drh/employees", headers={**h, **POINTEUR}).status_code == 403
    assert client.get("/api/auth/users", headers={**h, **POINTEUR}).status_code == 403


def test_both_applications(client, db):
    user = _account(db, modules=("pointage", "pointeur"), site=_site(db))
    assert _login(client, user, POINTAGE).status_code == 200
    assert _login(client, user, POINTEUR).status_code == 200


def test_no_application_is_fail_closed(client, db):
    user = _account(db, modules=())
    assert _login(client, user, POINTAGE).status_code == 403
    assert _login(client, user, POINTEUR).status_code == 403


def test_administrators_keep_their_transversal_access_on_pointeur(client, auth_headers):
    r = client.get("/api/biometrics/test-mode/status", headers={**auth_headers, **POINTEUR})
    assert r.status_code == 200 and r.json()["permitted"] is True


# ── Comptes existants : aucune perte de droit ────────────────────────────────────────────
def test_legacy_field_account_like_pointeur_01_keeps_its_access(client, db):
    """Compte historique (authorized_modules NULL, préfixe PTG) : règles inchangées."""
    user = _account(db, prefix="PTG", modules=None, site=_site(db))
    assert _login(client, user, POINTEUR).status_code == 200
    h = _token(client, user, POINTEUR)
    assert client.get("/api/portal/attendance-sites", headers={**h, **POINTEUR}).status_code == 200
    assert client.get("/api/biometrics/test-mode/status", headers={**h, **POINTEUR}).status_code == 200
    assert _login(client, user, POINTAGE).status_code == 200          # PTG : historique conservé


def test_pointeur_34_profile_keeps_test_mode_and_gains_nothing_else(client, db):
    """Profil réel de POINTEUR 34 : modules POINTEUR + POINTAGE, IRON GLOBAL SOLUTION, site
    pilote, actions read/create/update/validate, biometric_admin × validate (Mode Test)."""
    site = _site(db)
    user = _account(db, prefix="PTG", modules=("pointeur", "pointage"), site=site,
                    actions=("read", "create", "update", "validate"), features=(("biometric_admin", "validate"),))
    h = _token(client, user, POINTEUR)
    status = client.get("/api/biometrics/test-mode/status", headers={**h, **POINTEUR}).json()
    assert status["permitted"] is True and status["records_attendance"] is False and status["production_enabled"] is False
    assert _login(client, user, POINTAGE).status_code == 200
    # Aucune permission d'enrôlement ni d'administration biométrique implicite.
    r = client.post("/api/biometrics/terminals", headers={**h, **POINTAGE}, json={"name": "TAB", "terminal_type": "TABLET_ANDROID", "site_id": site.id})
    assert r.status_code == 403
    assert client.post("/api/biometrics/employees/1/enrollment/preview", headers={**h, **POINTAGE}, json={}).status_code == 403


# ── Permissions biométriques indépendantes des modules ───────────────────────────────────
def test_biometric_permissions_are_independent_from_application_access(client, db):
    site = _site(db)
    plain = _account(db, modules=("pointeur",), site=site)
    enroller = _account(db, modules=("pointeur",), site=site, features=(("biometric_enrollment", "create"),))
    h_plain, h_enr = _token(client, plain, POINTEUR), _token(client, enroller, POINTEUR)
    # Module « pointeur » seul : aucune permission biométrique.
    assert client.get("/api/biometrics/test-mode/status", headers={**h_plain, **POINTEUR}).json()["permitted"] is False
    r = client.post("/api/biometrics/employees/999999/enrollment/preview", headers={**h_plain, **POINTEUR}, json={})
    assert r.status_code == 403 and "Permission biométrique" in r.text
    # biometric_enrollment × create : la garde de permission passe (employé inconnu ⇒ 404, pas 403).
    r = client.post("/api/biometrics/employees/999999/enrollment/preview", headers={**h_enr, **POINTEUR}, json={})
    assert r.status_code == 404, r.text
    # …mais n'ouvre ni le Mode Test (biometric_admin) ni l'administration des terminaux.
    assert client.get("/api/biometrics/test-mode/status", headers={**h_enr, **POINTEUR}).json()["permitted"] is False


# ── Borne : identité de terminal, jamais une session utilisateur ────────────────────────
def test_kiosk_does_not_depend_on_a_user_session(client, db):
    user = _account(db, modules=("pointeur",), site=_site(db), features=(("biometric_admin", "admin"),))
    h = _token(client, user, POINTEUR)
    page = client.get("/borne", headers=POINTEUR)
    assert page.status_code == 200 and "Borne de pointage ATLAS" in page.text            # aucune connexion requise
    for path in ("/api/biometrics/terminal/session", "/api/biometrics/terminal/challenge"):
        method = "GET" if path.endswith("session") else "POST"
        r = client.request(method, path, headers={**h, **POINTEUR}, json={} if method == "POST" else None)
        assert r.status_code == 401, (path, r.status_code)                               # session humaine refusée
