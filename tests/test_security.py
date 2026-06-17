"""Tests de sécurité : portal token, isolation société, accès non autorisé."""
import pytest


def test_portal_rh_mobile_page_served(client):
    resp = client.get("/portail-rh")
    assert resp.status_code == 200
    assert "Portail RH - Demandes du Personnel" in resp.text
    assert "Réclamation salaire" in resp.text


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
