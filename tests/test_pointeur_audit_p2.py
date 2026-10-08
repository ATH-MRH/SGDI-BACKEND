"""Audit pointeur.irongs.com — P2 : connexion, employés non actifs (non-régression).

Les tests P2 de la biométrie (caméras, bornes, seuils) sont dans les modules de test de la
biométrie, qui portent les faux moteurs nécessaires."""
import uuid
from datetime import date, timedelta

import pytest

from app.core import rate_limit
from app.core.config import settings
from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "IRON GLOBAL SOLUTION"
PASSWORD = "audit-p2-pass-1234"


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _user(db, prefix="AUDP2"):
    username = f"{prefix}{uuid.uuid4().int % 10**7:07d}"
    db.add(User(username=username, full_name=username, role="ops", access_level="H2", password_hash=hash_password(PASSWORD),
                is_active=True, authorized_modules=["ops"], authorized_societies=[SOC]))
    db.commit()
    return username


def _login(client, username, password=PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


@pytest.fixture
def strict_login(monkeypatch):
    monkeypatch.setattr(settings, "login_max_attempts", 3)
    rate_limit.clear("login:testclient")
    yield
    rate_limit.clear("login:testclient")


def test_failed_logins_lock_the_targeted_account_even_when_the_address_counter_is_reset(client, db, strict_login):
    """Un titulaire de compte remettait le compteur par adresse à zéro en se connectant, puis
    testait sans limite les mots de passe d'un autre compte. Le compteur par compte visé ne
    s'efface que par la réussite de ce compte."""
    victim, attacker = _user(db), _user(db)
    try:
        for attempt in range(3):
            assert _login(client, victim, "mauvais-mot-de-passe").status_code == 401, attempt
            assert _login(client, attacker).status_code == 200       # remet le compteur de l'adresse à zéro
        blocked = _login(client, victim, "encore-un-essai")
        assert blocked.status_code == 429 and blocked.headers.get("Retry-After")
        assert _login(client, victim).status_code == 429             # même avec le bon mot de passe pendant la fenêtre
        assert _login(client, attacker).status_code == 200           # les autres comptes ne sont pas bloqués
        assert _login(client, victim.lower(), "x").status_code == 429  # la casse de l'identifiant ne contourne pas le compteur
    finally:
        rate_limit.clear("login-user:" + victim.lower())
        rate_limit.clear("login-user:" + attacker.lower())


def test_successful_login_clears_the_account_counter(client, db, strict_login):
    username = _user(db)
    try:
        assert _login(client, username, "faux-1").status_code == 401
        assert _login(client, username, "faux-2").status_code == 401
        assert _login(client, username).status_code == 200
        assert _login(client, username, "faux-3").status_code == 401  # compteur reparti de zéro
        assert _login(client, username).status_code == 200
    finally:
        rate_limit.clear("login-user:" + username.lower())


def test_failed_logins_are_audited_without_the_password(client, db, strict_login):
    username = _user(db)
    try:
        mark = db.query(AuditEvent).count()
        for _ in range(3):
            _login(client, username, "Secret-Tapé-Par-Erreur")
        rows = db.query(AuditEvent).filter(AuditEvent.action == "auth.login", AuditEvent.result == "refused",
                                           AuditEvent.resource_id == username).all()
        assert len(rows) == 2                                        # premier échec, puis blocage — pas une ligne par essai
        assert all("Secret-Tapé-Par-Erreur" not in str(row.new_state) for row in rows)
        assert db.query(AuditEvent).count() >= mark + 2
    finally:
        rate_limit.clear("login-user:" + username.lower())


@pytest.mark.parametrize("status", ["Retraité", "retraite", "Décédé", "Fin de contrat", "Radié"])
def test_definitively_inactive_employee_cannot_be_clocked_by_id(client, auth_headers, db, status):
    site = Site(name=f"P2 {_tag()}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    employee = Employee(code=f"P2{_tag()}", first_name="Ancien", last_name="Agent", society=SOC, status=status)
    db.add(employee); db.flush()
    db.add(Assignment(employee_id=employee.id, site_id=site.id, start_date=date.today() - timedelta(days=400), active=1))
    db.commit()
    response = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": employee.id, "site_id": site.id})
    assert response.status_code == 403, (status, response.text)


def test_active_employee_is_still_clockable(client, auth_headers, db):
    site = Site(name=f"P2 {_tag()}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    employee = Employee(code=f"P2{_tag()}", first_name="Agent", last_name="Actif", society=SOC, status="actif")
    db.add(employee); db.flush()
    db.add(Assignment(employee_id=employee.id, site_id=site.id, start_date=date.today() - timedelta(days=30), active=1))
    db.commit()
    response = client.post("/api/portal/attendance-manual/scan", headers=auth_headers, json={"employee_id": employee.id, "site_id": site.id})
    assert response.status_code == 201, response.text
