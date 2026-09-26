"""Tests de sécurité : portal token, isolation société, accès non autorisé."""
import pytest
from types import SimpleNamespace


def test_portal_rh_mobile_page_served(client):
    resp = client.get("/portail-rh")
    assert resp.status_code == 200
    assert "Portail RH - Demandes du Personnel" in resp.text
    assert "Réclamation salaire" in resp.text


def test_private_message_visibility_ignores_username_case_and_spaces():
    from app.modules.irongs import service

    message = {"type": "message", "from": " GRH-01 ", "to": "OPS2"}
    assert service._message_visible_to_user(message, SimpleNamespace(username="grh-01"))
    assert service._message_visible_to_user(message, SimpleNamespace(username=" ops2 "))
    assert not service._message_visible_to_user(message, SimpleNamespace(username="AUTRE"))


def test_message_recipient_list_is_normalized():
    from app.modules.irongs import service

    message = {"type": "message", "from": "GRH-01", "to": [" OPS2 "], "recipients": ["Ops3"]}
    assert service._message_participants(message) == {"grh-01", "ops2", "ops3"}


def test_message_creation_forces_authenticated_sender(client, db):
    from app.core.security import create_access_token, hash_password
    from app.modules.auth.models import User

    user = User(
        username="GRH-01",
        full_name="Gestionnaire RH",
        password_hash=hash_password("secret-test"),
        role="adm",
        global_society_access=True,
        authorized_structures=["secretariat"],
        is_active=True,
    )
    db.add(user)
    db.commit()
    token = create_access_token(subject=str(user.id))

    response = client.post(
        "/api/irongs/collections/echanges/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"data": {"id": "msg-auth-sender", "type": "message", "from": "OPS2", "to": "ops2", "message": "Test"}},
    )

    assert response.status_code == 200, response.text
    assert response.json()["from"] == "GRH-01"


def test_portal_rh_access_page_served(client):
    resp = client.get("/portail-rh/acces")
    assert resp.status_code == 200
    assert "Portail RH mobile" in resp.text
    assert "/portail-rh" in resp.text


def test_portal_reclamation_saved_to_demandes_personnel(client, db):
    from app.modules.irongs import service

    payload = {
        "ref": "REC-TEST-PORTAIL",
        "type": "reclamation",
        "typeLabel": "Réclamation salaire",
        "employee": {
            "nom": "DUPONT",
            "prenom": "Jean",
            "matricule": "AGT001",
            "societe": "TEST_SOC",
            "site": "Site test",
        },
        "details": {
            "Mois concerné": "2026-06",
            "Type d'anomalie": "Prime manquante",
            "Description": "Prime non comptabilisée",
        },
        "createdAt": "2026-06-11T10:00:00.000Z",
    }
    resp = client.post("/api/portal/demandes", json=payload)
    assert resp.status_code == 201, resp.text
    saved = service.get_item(db, "demandesPersonnel", "REC-TEST-PORTAIL")
    assert saved["type"] == "Réclamation salaire"
    assert saved["matricule"] == "AGT001"
    assert saved["source"] == "portail-rh-bilingue"
    assert "Prime manquante" in saved["message"]


def test_portal_validate_employee_returns_token(client):
    resp = client.post("/api/portal/validate-employee", json={
        "nom": "DUPONT", "prenom": "Jean", "code": "AGT001", "dateNaissance": "1990-01-01"
    })
    assert resp.status_code in (200, 403)
    if resp.status_code == 200:
        assert "portal_token" in resp.json()
        assert "employee" in resp.json()
        assert "email" not in resp.json()["employee"]
        assert "telephone" not in resp.json()["employee"]


def test_portal_pointages_requires_token(client):
    resp = client.get("/api/portal/pointages/AGT001")
    assert resp.status_code == 401


def test_portal_demandes_requires_token(client):
    resp = client.get("/api/portal/demandes/AGT001")
    assert resp.status_code == 401


def test_portal_pointages_wrong_matricule(client):
    from app.core.security import create_access_token
    token = create_access_token(subject="AUTRE_AGT", claims={"portal": True}, ttl_minutes=60)
    resp = client.get(
        "/api/portal/pointages/AGT001",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 403


def test_portal_pointages_correct_matricule(client):
    from app.core.security import create_access_token
    token = create_access_token(subject="AGT001", claims={"portal": True}, ttl_minutes=60)
    resp = client.get(
        "/api/portal/pointages/AGT001",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200


def test_portal_regular_jwt_rejected(client, auth_headers):
    resp = client.get(
        "/api/portal/pointages/AGT001",
        headers=auth_headers
    )
    assert resp.status_code == 403


def test_health_db_unauthenticated(client):
    resp = client.get("/health/db")
    assert resp.status_code == 401


def test_accounting_unauthenticated(client):
    for path in ["/api/accounting/comptes", "/api/accounting/ecritures/page"]:
        assert client.get(path).status_code == 401


def test_achats_unauthenticated(client):
    for path in ["/api/achats/fournisseurs", "/api/achats/commandes/page"]:
        assert client.get(path).status_code == 401


def test_ventes_unauthenticated(client):
    for path in ["/api/ventes/devis/page", "/api/ventes/commandes/page"]:
        assert client.get(path).status_code == 401


def test_reporting_unauthenticated(client):
    assert client.get("/api/reporting/dashboard").status_code == 401


# ── Pointages portail : jamais sans l'authentification de l'employé lui-même ─────────
def _portal_employee(db, code):
    from app.modules.drh.models import Employee
    emp = Employee(code=code, first_name="A", last_name="B", society="Iron Global Securite", status="actif")
    db.add(emp); db.commit()
    return emp


def _portal_headers(subject):
    from app.core.security import create_access_token
    return {"Authorization": f"Bearer {create_access_token(subject=subject, claims={'portal': True}, ttl_minutes=60)}"}


def _presences(db, emp):
    from sqlalchemy import select
    from app.modules.ops.models import DailyPresence
    return db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalars().all()


def test_portal_pointage_post_requires_token_and_writes_nothing(client, db):
    emp = _portal_employee(db, "SECPT01")
    body = {"employee": {"matricule": "SECPT01"}, "action": "arrivee", "date": "2026-01-15", "heure": "07:00"}
    assert client.post("/api/portal/pointages", json=body).status_code == 401
    assert client.post("/api/portal/pointages", json=body, headers=_portal_headers("AUTRE_AGT")).status_code == 403
    assert _presences(db, emp) == []


def test_portal_pointage_post_rejects_staff_jwt(client, db, auth_headers):
    _portal_employee(db, "SECPT02")
    body = {"employee": {"matricule": "SECPT02"}, "action": "arrivee"}
    assert client.post("/api/portal/pointages", json=body, headers=auth_headers).status_code == 403


def test_portal_pointage_post_never_backdated(client, db):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    emp = _portal_employee(db, "SECPT03")
    r = client.post("/api/portal/pointages", headers=_portal_headers("SECPT03"),
                    json={"employee": {"matricule": "SECPT03"}, "action": "arrivee", "date": "2026-01-15", "heure": "07:00"})
    assert r.status_code == 201, r.text
    today = datetime.now(ZoneInfo("Africa/Algiers")).date()
    assert [row.presence_date for row in _presences(db, emp)] == [today]


def test_legacy_pointage_qr_requires_employee_portal_token(client, db):
    import math
    from datetime import datetime, timezone
    emp = _portal_employee(db, "SECPT04")
    slot = math.floor(datetime.now(timezone.utc).timestamp() * 1000 / 10000)
    body = {"token": f"1|{slot}", "matricule": "SECPT04"}
    assert client.post("/api/portal/pointage-qr", json=body).status_code == 401
    assert client.post("/api/portal/pointage-qr", json=body, headers=_portal_headers("AUTRE_AGT")).status_code == 403
    assert _presences(db, emp) == []
    assert client.post("/api/portal/pointage-qr", json=body, headers=_portal_headers("SECPT04")).status_code == 201
