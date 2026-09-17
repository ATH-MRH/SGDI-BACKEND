"""LOT — POINTAGE EN LECTURE SEULE DANS L'ESPACE CLIENT.

Vérifie en particulier les points sensibles de sécurité :
- le périmètre vient TOUJOURS de user.client_id (dérivé du token authentifié),
  jamais d'un client_id/site_id/employee_id fourni tel quel par le frontend ;
- un client ne voit jamais les présences d'un autre client, même en manipulant
  les paramètres de la requête ;
- le droit view_attendance est opt-in (False par défaut), jamais accordé
  implicitement ;
- aucun endpoint d'écriture n'existe pour ce lot (lecture seule stricte).

Note : POST /api/client-portal/auth/login est protégé par un rate-limit anti
brute-force PARTAGÉ avec tests/test_client_portal.py (20 tentatives / 300 s,
cf. app/core/rate_limit.py + _limit_public dans app/modules/client_portal/
routes.py) — ce compteur n'est jamais remis à zéro par un succès (comportement
du code existant, non modifié ici). Comme ce fichier ne teste ni ce rate-limit
ni sa politique, on le réinitialise avant chaque test (rate_limit.clear, prévu
pour cet usage) pour que ce module reste indépendant du volume de connexions
des autres fichiers de test — sans quoi son résultat dépendrait de l'ordre
d'exécution de la suite, ce qui n'a rien à voir avec ce qui est testé ici.
"""
from datetime import date

import pytest

from app.core import rate_limit
from app.modules.ops.models import DailyPresence
from tests.site_fixtures import historical_site

SOCIETY = "Iron Global Securite"


@pytest.fixture(autouse=True)
def _reset_client_portal_login_rate_limit():
    rate_limit.clear("client_portal:login:testclient")
    yield


def _emp(client, h, code, society=SOCIETY):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "Pointage",
        "society": society, "status": "actif", "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _commercial_client(client, h, name, portal_slug=None, portal_enabled=True):
    payload = {"name": name, "society": SOCIETY, "status": "actif"}
    if portal_slug is not None:
        payload["portal_slug"] = portal_slug
    payload["portal_enabled"] = portal_enabled
    r = client.post("/api/commercial/clients", headers=h, json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _site(client, h, name, client_id=None):
    r = historical_site(client, headers=h, json={
        "name": name, "indicatif": name[:3].upper(), "rotation_system": "24/48",
        "active": 1, "client_id": client_id, "equipment_plan": {"societe": SOCIETY},
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _assign(client, h, emp_id, site_id):
    r = client.post("/api/ops/assignments", headers=h, json={
        "employee_id": int(emp_id), "site_id": int(site_id),
        "group_code": "A", "start_date": "2026-01-01", "active": 1,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _portal_account(client, h, client_id, username):
    r = client.post("/api/client-portal/admin/users", headers=h, json={
        "client_id": client_id, "full_name": "Interlocuteur Test", "username": username,
    })
    assert r.status_code == 201, r.text
    return r.json()


def _login(client, username, password):
    r = client.post("/api/client-portal/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _grant_view_attendance(client, auth_headers, client_id, granted=True):
    r = client.put(f"/api/commercial/clients/{client_id}", headers=auth_headers, json={
        "data": {"portalPermissions": {"viewAttendance": granted}}
    })
    assert r.status_code == 200, r.text


def _presence(db, employee_id, site_id, presence_date, arrival=None, departure=None, status_="present", group_code="A"):
    row = DailyPresence(
        employee_id=employee_id, site_id=site_id, presence_date=presence_date,
        arrival_time=arrival, departure_time=departure, status=status_, group_code=group_code,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id


def _new_client_site_employee(client, auth_headers, suffix):
    """Client + site + employé affecté, SANS connexion ni droit accordé — pas
    d'appel /auth/login ici (réservé aux endroits qui en ont vraiment besoin)."""
    cid = _commercial_client(client, auth_headers, f"Client Pointage {suffix}")
    site = _site(client, auth_headers, f"Site Pointage {suffix}", client_id=cid)
    emp = _emp(client, auth_headers, f"PTG{suffix}")
    _assign(client, auth_headers, emp, site)
    return {"client_id": cid, "site_id": site, "employee_id": emp}


# ── Permission opt-in + accès une fois accordé (1 connexion) ───────────────────

def test_attendance_permission_lifecycle_and_access(client, auth_headers, db):
    ctx = _new_client_site_employee(client, auth_headers, "Life")
    account = _portal_account(client, auth_headers, ctx["client_id"], username="clientptglife")
    headers = _login(client, account["username"], account["temporary_password"])  # 1 connexion, réutilisée pour tout ce test

    # Par défaut : jamais de droit implicite.
    me = client.get("/api/client-portal/me", headers=headers)
    assert me.status_code == 200, me.text
    assert me.json()["permissions"]["view_attendance"] is False, "aucun droit implicite : doit être False tant que non accordé explicitement"

    # API refusée tant que le droit n'est pas accordé.
    assert client.get("/api/client-portal/attendance", headers=headers).status_code == 403
    assert client.get("/api/client-portal/attendance/filters", headers=headers).status_code == 403

    # Une fois accordé (même session, pas de reconnexion nécessaire : le droit
    # est relu depuis Client.data à chaque requête, jamais mis en cache dans le jeton).
    _grant_view_attendance(client, auth_headers, ctx["client_id"])
    _presence(db, ctx["employee_id"], ctx["site_id"], date(2026, 9, 1), arrival="08:00", departure="16:00")
    r = client.get("/api/client-portal/attendance", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    row = body["items"][0]
    assert row["employee_code"] == "PTGLIFE"  # les codes employé sont normalisés en majuscules par /api/drh/employees
    assert row["status"] == "present"
    assert row["duration_label"] == "8h00"


# ── Isolation stricte entre clients (1 connexion par client, réutilisée pour
#    toutes les vérifications de sécurité qui portent sur cette même paire) ────

def test_client_isolation_and_scope_security(client, auth_headers, db):
    ctx_a = _new_client_site_employee(client, auth_headers, "IsoA")
    ctx_b = _new_client_site_employee(client, auth_headers, "IsoB")
    _grant_view_attendance(client, auth_headers, ctx_a["client_id"])
    _grant_view_attendance(client, auth_headers, ctx_b["client_id"])
    account_a = _portal_account(client, auth_headers, ctx_a["client_id"], username="clientptgisoa")
    headers_a = _login(client, account_a["username"], account_a["temporary_password"])
    account_b = _portal_account(client, auth_headers, ctx_b["client_id"], username="clientptgisob")
    headers_b = _login(client, account_b["username"], account_b["temporary_password"])  # 2 connexions au total pour tout ce test

    presence_a = _presence(db, ctx_a["employee_id"], ctx_a["site_id"], date(2026, 9, 2), arrival="08:00", departure="16:00")
    presence_b = _presence(db, ctx_b["employee_id"], ctx_b["site_id"], date(2026, 9, 2), arrival="08:00", departure="16:00")

    # Le client A ne voit jamais les présences du client B.
    r = client.get("/api/client-portal/attendance", headers=headers_a)
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()["items"]}
    assert presence_a in ids
    assert presence_b not in ids, "le client A ne doit jamais voir les présences du client B"

    # Un site_id hors périmètre (celui de B) est toujours refusé, jamais silencieusement vidé.
    r = client.get("/api/client-portal/attendance", headers=headers_a, params={"site_id": ctx_b["site_id"]})
    assert r.status_code == 403

    # Un employee_id d'un autre client est toujours refusé.
    r = client.get("/api/client-portal/attendance", headers=headers_a, params={"employee_id": ctx_b["employee_id"]})
    assert r.status_code == 403

    # Les filtres (sites/employés proposés) ne listent jamais que le périmètre du client.
    r = client.get("/api/client-portal/attendance/filters", headers=headers_a)
    assert r.status_code == 200, r.text
    filt = r.json()
    assert {s["id"] for s in filt["sites"]} == {ctx_a["site_id"]}
    assert {e["id"] for e in filt["employees"]} == {ctx_a["employee_id"]}
    assert ctx_b["site_id"] not in {s["id"] for s in filt["sites"]}


# ── Filtres, pagination, statuts dérivés (1 connexion, tout dans le même contexte) ──

def test_attendance_filters_pagination_and_status(client, auth_headers, db):
    ctx = _new_client_site_employee(client, auth_headers, "Combo")
    _grant_view_attendance(client, auth_headers, ctx["client_id"])
    account = _portal_account(client, auth_headers, ctx["client_id"], username="clientptgcombo")
    headers = _login(client, account["username"], account["temporary_password"])  # 1 connexion pour tout ce test

    # Filtre de période.
    _presence(db, ctx["employee_id"], ctx["site_id"], date(2026, 8, 1), arrival="08:00", departure="16:00")
    _presence(db, ctx["employee_id"], ctx["site_id"], date(2026, 9, 1), arrival="08:00", departure="16:00")
    r = client.get("/api/client-portal/attendance", headers=headers, params={"date_from": "2026-09-01", "date_to": "2026-09-30"})
    assert r.status_code == 200
    dates = {row["presence_date"] for row in r.json()["items"]}
    assert dates == {"2026-09-01"}

    # Pagination.
    for day in range(2, 8):
        _presence(db, ctx["employee_id"], ctx["site_id"], date(2026, 9, day), arrival="08:00", departure="16:00")
    r = client.get("/api/client-portal/attendance", headers=headers, params={"page": 1, "page_size": 3})
    assert r.status_code == 200, r.text
    body = r.json()
    # Aucun filtre de date sur cette requête : le 01/08 est bien inclus (1 + 1 + 6 = 8).
    assert body["total"] == 8
    assert len(body["items"]) == 3
    assert body["pages"] == 3  # ceil(8/3)

    # Statut "absent" : aucune donnée fabriquée (pas d'heure d'arrivée/durée).
    _presence(db, ctx["employee_id"], ctx["site_id"], date(2026, 9, 20), status_="absent")
    r = client.get("/api/client-portal/attendance", headers=headers, params={"date_from": "2026-09-20", "date_to": "2026-09-20"})
    row = r.json()["items"][0]
    assert row["status"] == "absent"
    assert row["arrival_time"] is None
    assert row["duration_label"] is None

    # Statut "sortie_manquante" : arrivée enregistrée un jour passé, jamais de sortie.
    _presence(db, ctx["employee_id"], ctx["site_id"], date(2026, 1, 5), arrival="08:00")
    r = client.get("/api/client-portal/attendance", headers=headers, params={"date_from": "2026-01-05", "date_to": "2026-01-05"})
    row = r.json()["items"][0]
    assert row["status"] == "sortie_manquante"

    # Lecture seule stricte : aucun verbe d'écriture n'existe sur cette route
    # (même session, pas de connexion supplémentaire nécessaire).
    for method in ("post", "put", "patch"):
        w = getattr(client, method)("/api/client-portal/attendance", headers=headers, json={})
        assert w.status_code in (404, 405), f"{method.upper()} ne doit exister sur aucune route de pointage client"
    assert client.delete("/api/client-portal/attendance", headers=headers).status_code in (404, 405)
