"""Recherche des employés à enrôler (GET /api/biometrics/employees) — contrat sur lequel repose
la recherche DYNAMIQUE de l'écran Enrôlement : partielle dès 1 caractère, insensible à la casse,
matricule / nom / prénom, 25 résultats au plus, TOUJOURS limitée au périmètre du compte (société,
site) côté serveur, permission biometric_status × read. Aucun code serveur modifié par ce lot."""
import uuid
from datetime import date

import pytest

from app.core.config import settings
from app.core.security import hash_password
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "IRON GLOBAL SOLUTION"
OTHER = "Sword Corporation"
URL = "/api/biometrics/employees"


@pytest.fixture(autouse=True)
def flags(monkeypatch):
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)
    monkeypatch.setattr(settings, "biometric_enabled", False)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db, society=SOC):
    site = Site(name=f"SRCH {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.flush()
    return site


def _emp(db, site, *, last, first, society=SOC):
    emp = Employee(code=f"SR{_tag()}", first_name=first, last_name=last, society=society, status="actif", position="AGENT")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


def _user(client, db, *, sites, societies=(SOC,), features=(("biometric_status", "read"),)):
    name = f"PTG{uuid.uuid4().int % 10**6:06d}"
    user = User(username=name, full_name=name, role="agent", access_level="H2", password_hash=hash_password("search-pass-1"),
                is_active=True, authorized_modules=["pointage"], authorized_societies=list(societies), authorized_sites=list(sites))
    db.add(user); db.flush()
    for feature, action in features:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance", feature_key=feature, action_key=action))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "search-pass-1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _codes(client, h, **params):
    r = client.get(URL, headers=h, params=params)
    assert r.status_code == 200, r.text
    return {row["matricule"] for row in r.json()}


def test_partial_case_insensitive_search_on_matricule_last_and_first_name(client, db):
    site = _site(db)
    tag = _tag()
    a = _emp(db, site, last=f"ABDELLI{tag}", first="Karim")
    b = _emp(db, site, last=f"BENALI{tag}", first=f"Abdel{tag}")
    c = _emp(db, site, last=f"OUALI{tag}", first="Amine")
    h = _user(client, db, sites=[site.id])
    assert _codes(client, h, q=a.code.lower()) == {a.code}                       # matricule, casse
    assert _codes(client, h, q=f"benali{tag.lower()}") == {b.code}              # nom, casse
    assert _codes(client, h, q=f"abdel{tag.lower()}") == {b.code}               # prénom, casse
    assert {a.code, b.code} <= _codes(client, h, q="abdel")                     # partiel : nom ET prénom
    assert {a.code, b.code, c.code} <= _codes(client, h, q="a")                 # dès 1 caractère
    assert _codes(client, h, q="zzzz-introuvable") == set()


def test_results_are_capped_at_25(client, db):
    site = _site(db)
    tag = _tag()
    for i in range(30):
        _emp(db, site, last=f"LIMIT{tag}{i:02d}", first="Test")
    h = _user(client, db, sites=[site.id])
    assert len(client.get(URL, headers=h, params={"q": f"LIMIT{tag}"}).json()) == 25
    assert len(client.get(URL, headers=h).json()) <= 25                         # champ vide : jamais toute la base


def test_never_returns_employees_outside_the_account_scope(client, db):
    mine, elsewhere, foreign = _site(db), _site(db), _site(db, society=OTHER)
    tag = _tag()
    inside = _emp(db, mine, last=f"SCOPE{tag}", first="Dedans")
    other_site = _emp(db, elsewhere, last=f"SCOPE{tag}", first="AutreSite")
    other_soc = _emp(db, foreign, last=f"SCOPE{tag}", first="AutreSociete", society=OTHER)
    h = _user(client, db, sites=[mine.id])                                      # type POINTEUR 01 : un site
    assert _codes(client, h, q=f"scope{tag}") == {inside.code}
    for hidden in (other_site, other_soc):
        assert _codes(client, h, q=hidden.code) == set()
    assert client.get(URL, headers=h, params={"q": "a", "site_id": elsewhere.id}).status_code == 404


def test_requires_explicit_biometric_status_permission(client, db):
    site = _site(db)
    h = _user(client, db, sites=[site.id], features=())
    r = client.get(URL, headers=h, params={"q": "a"})
    assert r.status_code == 403 and "Permission biométrique" in r.text
