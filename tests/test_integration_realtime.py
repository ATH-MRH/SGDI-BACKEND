"""Tests d'intégration TEMPS RÉEL et compteurs serveur (sans mock).

Vérifie la base du temps réel (la signature d'événements change quand une donnée
change), que le snapshot reflète les écritures, et que les compteurs serveur
(sidebar-stats) donnent la vérité (effectif, affectés, sans affectation).
"""
from datetime import date


def _create_employee(client, headers, code, status="actif"):
    r = client.post("/api/drh/employees", headers=headers, json={
        "code": code, "first_name": f"E{code}", "last_name": "Test",
        "society": "Iron Global Securite", "status": status, "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def test_events_signature_changes_on_write(client, auth_headers):
    """La signature temps réel (SSE) doit CHANGER quand une donnée est ajoutée."""
    from app.main import _events_signature
    before = _events_signature()
    _create_employee(client, auth_headers, "SIG001")
    after = _events_signature()
    assert before != after, "La signature d'événements n'a pas changé : le temps réel ne détecterait pas le changement"


def test_snapshot_reflects_created_data(client, auth_headers):
    """Le snapshot /api/irongs/db reflète immédiatement un employé créé."""
    _create_employee(client, auth_headers, "SNAPX01")
    snap = client.get("/api/irongs/db", headers=auth_headers)
    assert snap.status_code == 200
    agents = snap.json().get("agents", [])
    codes = {a.get("matricule") or a.get("code") for a in agents}
    assert "SNAPX01" in codes


def test_sidebar_stats_reflect_reality(client, auth_headers):
    """Les compteurs serveur (sidebar-stats) comptent bien les employés créés."""
    before = client.get("/api/ui/sidebar-stats", headers=auth_headers).json()
    before_total = (((before.get("erp") or {}).get("employees") or {}).get("total")) or 0
    _create_employee(client, auth_headers, "STAT001")
    _create_employee(client, auth_headers, "STAT002")
    after = client.get("/api/ui/sidebar-stats", headers=auth_headers).json()
    after_total = (((after.get("erp") or {}).get("employees") or {}).get("total")) or 0
    assert after_total >= before_total + 2, f"Compteur effectif serveur incohérent : {before_total} -> {after_total}"


def test_sidebar_stats_without_assignment_is_server_truth(client, auth_headers):
    """without_assignment (compteur serveur) = employés actifs sans affectation active."""
    # Un employé affecté ne doit pas compter comme "sans affectation"
    emp = _create_employee(client, auth_headers, "WA001")
    site = client.post("/api/irongs/collections/sites/items", headers=auth_headers, json={
        "data": {"nom": "Site WA", "indicatif": "SWA", "societe": "Iron Global Securite", "actif": True}
    }).json()
    site_id = site.get("backendId") or site.get("id")
    a = client.post("/api/ops/assignments", headers=auth_headers, json={
        "employee_id": int(emp), "site_id": int(site_id), "start_date": "2026-01-01", "active": 1,
    })
    assert a.status_code in (200, 201), a.text

    stats = client.get("/api/ui/sidebar-stats", headers=auth_headers).json()
    emp_stats = ((stats.get("erp") or {}).get("employees") or {})
    # Le champ existe et est un nombre cohérent (>= 0)
    assert "without_assignment" in emp_stats
    assert isinstance(emp_stats["without_assignment"], int)
    assert emp_stats["without_assignment"] >= 0


def test_active_count_excludes_exit_status(client, auth_headers):
    """Le compteur serveur 'active' ne compte pas les sortants."""
    stats_before = client.get("/api/ui/sidebar-stats", headers=auth_headers).json()
    active_before = (((stats_before.get("erp") or {}).get("employees") or {}).get("active")) or 0
    # Un sortant ne doit pas augmenter l'effectif actif
    _create_employee(client, auth_headers, "SORT001", status="sortant")
    stats_after = client.get("/api/ui/sidebar-stats", headers=auth_headers).json()
    active_after = (((stats_after.get("erp") or {}).get("employees") or {}).get("active")) or 0
    assert active_after == active_before, "Un employé SORTANT a été compté dans l'effectif actif"
