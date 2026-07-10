"""Tests des correctifs CRITIQUES multi-PC (vrais endpoints, vraie base, sans mock).

Verrouille les bugs qu'on a reparés pour qu'ils ne reviennent JAMAIS :
- une sauvegarde vide/partielle n'efface pas la base ("tout à zéro") ;
- une collection absente/vide n'est pas supprimée (replace_database non destructif) ;
- le snapshot n'envoie que les affectations ACTIVES (perf) ;
- l'endpoint employés fournit la vraie affectation (fin du "50/19 au lieu de 71/0").
"""
from datetime import date


def _create_employee(client, headers, code, society="Iron Global Securite", status="actif"):
    r = client.post("/api/drh/employees", headers=headers, json={
        "code": code, "first_name": f"E{code}", "last_name": "Test",
        "society": society, "status": status, "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _create_site(client, headers, nom="Site MPC", indicatif="SMP"):
    r = client.post("/api/irongs/collections/sites/items", headers=headers, json={
        "data": {"nom": nom, "indicatif": indicatif, "societe": "Iron Global Securite", "actif": True}
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("backendId") or r.json().get("id")


def test_empty_save_does_not_wipe_existing_data(client, auth_headers):
    """PUT /db avec une collection VIDE ne doit PAS effacer les données existantes."""
    # Seed
    seed = client.put("/api/irongs/db", headers=auth_headers, json={"data": {
        "notifications": [{"id": "keep1"}, {"id": "keep2"}],
    }})
    assert seed.status_code == 200
    before = client.get("/api/irongs/collections/notifications", headers=auth_headers).json().get("data", [])
    assert {n.get("id") for n in before} >= {"keep1", "keep2"}

    # Sauvegarde qui envoie la collection VIDE (cas d'un client non chargé / multi-PC)
    empty = client.put("/api/irongs/db", headers=auth_headers, json={"data": {"notifications": []}})
    assert empty.status_code == 200

    # Les données existantes doivent TOUJOURS être là
    after = client.get("/api/irongs/collections/notifications", headers=auth_headers).json().get("data", [])
    assert {n.get("id") for n in after} >= {"keep1", "keep2"}, \
        f"Le bug 'tout à zéro' est revenu : données effacées par une sauvegarde vide ! {after}"


def test_absent_collection_is_not_wiped(client, auth_headers):
    """Une collection ABSENTE du payload garde ses données (pas de DELETE global)."""
    client.put("/api/irongs/db", headers=auth_headers, json={"data": {
        "notifications": [{"id": "n_abs"}],
        "activityLog": [{"id": "log_abs"}],
    }})
    # On sauvegarde en n'incluant QUE notifications
    client.put("/api/irongs/db", headers=auth_headers, json={"data": {
        "notifications": [{"id": "n_abs"}, {"id": "n_abs2"}],
    }})
    logs = client.get("/api/irongs/collections/activityLog", headers=auth_headers).json().get("data", [])
    assert {l.get("id") for l in logs} >= {"log_abs"}, \
        f"Une collection absente du payload a été effacée : {logs}"


def test_snapshot_serves_only_active_assignments(client, auth_headers):
    """La collection affectations ne doit contenir que les affectations ACTIVES."""
    emp = _create_employee(client, auth_headers, "SNAP01")
    site = _create_site(client, auth_headers, "Site Snap", "SNP")
    a = client.post("/api/ops/assignments", headers=auth_headers, json={
        "employee_id": int(emp), "site_id": int(site), "start_date": "2026-01-01", "active": 1,
    })
    assert a.status_code in (200, 201), a.text
    assignment_id = a.json().get("id") or a.json().get("backendId")

    coll = client.get("/api/irongs/collections/affectations", headers=auth_headers).json().get("data", [])
    assert any(int(x.get("employee_id") or x.get("agentId") or 0) == int(emp) for x in coll)

    # On désactive l'affectation
    patch = client.patch(f"/api/ops/assignments/{assignment_id}", headers=auth_headers, json={"active": 0})
    assert patch.status_code == 200, patch.text

    coll2 = client.get("/api/irongs/collections/affectations", headers=auth_headers).json().get("data", [])
    remaining = [x for x in coll2 if int(x.get("employee_id") or x.get("agentId") or 0) == int(emp)]
    assert not remaining, f"Une affectation INACTIVE est encore envoyée dans le snapshot : {remaining}"


def test_employees_endpoint_injects_real_affectation(client, auth_headers):
    """GET /drh/employees doit renvoyer la vraie affectation (affectationCourante avec le site)."""
    emp = _create_employee(client, auth_headers, "AFF01")
    site = _create_site(client, auth_headers, "Site Affectation", "SAF")
    a = client.post("/api/ops/assignments", headers=auth_headers, json={
        "employee_id": int(emp), "site_id": int(site), "start_date": "2026-01-01", "active": 1,
    })
    assert a.status_code in (200, 201), a.text

    employees = client.get("/api/drh/employees", headers=auth_headers).json()
    target = next((e for e in employees if (e.get("id") == int(emp) or e.get("backendId") == int(emp))), None)
    assert target is not None
    legacy = (target.get("extra") or {}).get("_legacy") or {}
    aff = legacy.get("affectationCourante") or {}
    assert aff.get("siteName") or aff.get("siteId"), \
        f"L'affectation réelle n'est pas fournie par le serveur : {aff}"


def test_employee_without_assignment_has_no_site(client, auth_headers):
    """Un employé sans affectation active ne doit pas avoir de site (cohérence base)."""
    emp = _create_employee(client, auth_headers, "NOAFF01")
    employees = client.get("/api/drh/employees", headers=auth_headers).json()
    target = next((e for e in employees if (e.get("id") == int(emp) or e.get("backendId") == int(emp))), None)
    assert target is not None
    legacy = (target.get("extra") or {}).get("_legacy") or {}
    aff = legacy.get("affectationCourante") or {}
    assert not (aff.get("siteName") or aff.get("siteId")), \
        f"Un employé sans affectation a un site : {aff}"
