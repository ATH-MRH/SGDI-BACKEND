"""Tests de CONCURRENCE réels — plusieurs utilisateurs qui écrivent EN MÊME TEMPS.

Aucun mock : vrai serveur (TestClient), vraie base, vrais threads en parallèle,
chaque requête ayant sa propre session (fixture `live_client`). On vérifie qu'aucune
écriture concurrente n'est perdue et qu'aucune ne casse la base.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed


def _post_employee(client, headers, code):
    return client.post("/api/drh/employees", headers=headers, json={
        "code": code,
        "first_name": f"Conc{code}",
        "last_name": "Test",
        "society": "Iron Global Securite",
        "status": "actif",
        "contract_type": "CDD",
    })


def test_concurrent_employee_creation_no_loss(live_client, live_headers):
    """20 threads créent 20 employés distincts EN MÊME TEMPS -> les 20 sont conservés."""
    codes = [f"CONC{i:03d}" for i in range(20)]

    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = [pool.submit(_post_employee, live_client, live_headers, c) for c in codes]
        results = [f.result() for f in as_completed(futures)]

    # Toutes les créations ont réussi
    assert all(r.status_code in (200, 201) for r in results), \
        [r.status_code for r in results if r.status_code not in (200, 201)]

    # Les 20 sont bien présents en base (aucune perte due à la concurrence)
    listing = live_client.get("/api/drh/employees", headers=live_headers)
    assert listing.status_code == 200
    present = {e.get("code") for e in listing.json()}
    missing = [c for c in codes if c not in present]
    assert not missing, f"Employés perdus en écriture concurrente : {missing}"


def test_concurrent_assignments_all_persist(live_client, live_headers):
    """N employés + 1 site, puis N affectations créées en parallèle -> toutes actives."""
    # 1 site
    site_resp = live_client.post("/api/irongs/collections/sites/items", headers=live_headers, json={
        "data": {"nom": "Site Concurrence", "indicatif": "SCC", "societe": "Iron Global Securite", "actif": True}
    })
    assert site_resp.status_code in (200, 201)
    site_id = site_resp.json().get("backendId") or site_resp.json().get("id")

    # N employés
    emp_ids = []
    for i in range(12):
        r = _post_employee(live_client, live_headers, f"ASG{i:03d}")
        assert r.status_code in (200, 201)
        emp_ids.append(r.json().get("id") or r.json().get("backendId"))

    def make_assignment(emp_id):
        return live_client.post("/api/ops/assignments", headers=live_headers, json={
            "employee_id": int(emp_id),
            "site_id": int(site_id),
            "group_code": "A",
            "start_date": "2026-01-01",
            "active": 1,
        })

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = [f.result() for f in as_completed([pool.submit(make_assignment, e) for e in emp_ids])]

    assert all(r.status_code in (200, 201) for r in results), \
        [r.status_code for r in results if r.status_code not in (200, 201)]

    # Toutes les affectations actives existent (aucune perdue)
    active = live_client.get("/api/ops/assignments?active=1", headers=live_headers)
    assert active.status_code == 200
    assigned_emp = {int(a.get("employee_id")) for a in active.json() if a.get("employee_id") is not None}
    for e in emp_ids:
        assert int(e) in assigned_emp, f"Affectation perdue pour l'employé {e}"


def test_concurrent_db_saves_different_collections_no_clobber(live_client, live_headers):
    """Deux sauvegardes globales simultanées sur des collections DIFFÉRENTES :
    aucune n'écrase l'autre (validation de la sauvegarde ciblée / non destructive)."""
    # Baseline
    base = live_client.put("/api/irongs/db", headers=live_headers, json={"data": {
        "notifications": [{"id": "n1", "msg": "base"}],
        "activityLog": [{"id": "a1", "msg": "base"}],
    }})
    assert base.status_code == 200

    def save_notifications():
        return live_client.put("/api/irongs/db", headers=live_headers, json={"data": {
            "notifications": [{"id": "n1", "msg": "base"}, {"id": "n2", "msg": "ajout A"}],
        }})

    def save_activitylog():
        return live_client.put("/api/irongs/db", headers=live_headers, json={"data": {
            "activityLog": [{"id": "a1", "msg": "base"}, {"id": "a2", "msg": "ajout B"}],
        }})

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(save_notifications)
        f2 = pool.submit(save_activitylog)
        assert f1.result().status_code == 200
        assert f2.result().status_code == 200

    # Les DEUX ajouts ont survécu (pas d'écrasement croisé)
    notifs = live_client.get("/api/irongs/collections/notifications", headers=live_headers).json().get("data", [])
    logs = live_client.get("/api/irongs/collections/activityLog", headers=live_headers).json().get("data", [])
    assert {n.get("id") for n in notifs} >= {"n1", "n2"}, notifs
    assert {l.get("id") for l in logs} >= {"a1", "a2"}, logs


def test_concurrent_same_collection_no_corruption(live_client, live_headers):
    """Écritures concurrentes sur la MÊME collection : pas de crash, base cohérente
    (dernier gagnant accepté, mais aucune corruption / erreur serveur)."""
    def save(n):
        return live_client.put("/api/irongs/db", headers=live_headers, json={"data": {
            "demandesStructure": [{"id": f"d{n}", "who": n}],
        }})

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = [f.result() for f in as_completed([pool.submit(save, i) for i in range(10)])]

    assert all(r.status_code == 200 for r in results), [r.status_code for r in results]
    # La collection est lisible et cohérente (une des écritures a gagné)
    final = live_client.get("/api/irongs/collections/demandesStructure", headers=live_headers)
    assert final.status_code == 200
    assert isinstance(final.json().get("data", []), list)
