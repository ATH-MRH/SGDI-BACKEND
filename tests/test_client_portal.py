"""Portail Client : comptes externes nominatifs, visibilité dérivée des sites, signalements.

Vérifie en particulier les points sensibles identifiés en conception :
- la visibilité des agents ne doit JAMAIS reposer sur Site.client_name (texte libre) mais
  sur Site.client_id (FK fiable) ;
- un client ne doit jamais voir les signalements d'un autre client ;
- la vue client (ObservationOut) ne doit jamais exposer la note de résolution interne.
"""
SOCIETY = "Iron Global Securite"


def _emp(client, h, code, society=SOCIETY):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "Portail",
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
    r = client.post("/api/ops/sites", headers=h, json={
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


def _portal_account(client, h, client_id, username="clientuser1"):
    r = client.post("/api/client-portal/admin/users", headers=h, json={
        "client_id": client_id, "full_name": "Interlocuteur Test", "username": username,
    })
    assert r.status_code == 201, r.text
    return r.json()


def _login(client, username, password):
    r = client.post("/api/client-portal/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ── Sous-domaine : portal_slug ──────────────────────────────────────────────────────

def test_portal_slug_reserved_word_rejected(client, auth_headers):
    r = client.post("/api/commercial/clients", headers=auth_headers, json={
        "name": "Client Reserve", "society": SOCIETY, "portal_slug": "drh",
    })
    assert r.status_code == 409, r.text


def test_portal_slug_must_be_unique(client, auth_headers):
    _commercial_client(client, auth_headers, "Client Slug A", portal_slug="clienttest-unique")
    r = client.post("/api/commercial/clients", headers=auth_headers, json={
        "name": "Client Slug B", "society": SOCIETY, "portal_slug": "clienttest-unique",
    })
    assert r.status_code == 409, r.text


# ── Comptes / connexion ──────────────────────────────────────────────────────────────

def test_admin_create_account_and_login_forces_password_change(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Login")
    account = _portal_account(client, auth_headers, cid, username="clientlogin1")
    temp_password = account["temporary_password"]

    login = client.post("/api/client-portal/auth/login", json={"username": "clientlogin1", "password": temp_password})
    assert login.status_code == 200, login.text
    body = login.json()
    assert body["must_change_password"] is True
    assert body["client_id"] == cid


def test_login_wrong_password_rejected(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Wrong Pass")
    account = _portal_account(client, auth_headers, cid, username="clientwrongpass")
    r = client.post("/api/client-portal/auth/login", json={"username": "clientwrongpass", "password": "n'importe quoi"})
    assert r.status_code == 401, r.text


def test_login_rejected_when_portal_disabled(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Disabled", portal_slug="clientdisabled", portal_enabled=False)
    account = _portal_account(client, auth_headers, cid, username="clientdisableduser")
    r = client.post("/api/client-portal/auth/login", json={"username": "clientdisableduser", "password": account["temporary_password"]})
    assert r.status_code == 401, r.text


def test_non_admin_cannot_create_portal_account(client, restricted_headers):
    r = client.post("/api/client-portal/admin/users", headers=restricted_headers, json={
        "client_id": 1, "full_name": "X", "username": "clientnonadmin",
    })
    assert r.status_code == 403, r.text


def test_admin_can_define_and_fully_update_client_portal_credentials(client, auth_headers):
    cid_a = _commercial_client(client, auth_headers, "Client Admin Account A", portal_slug="client-admin-a")
    cid_b = _commercial_client(client, auth_headers, "Client Admin Account B", portal_slug="client-admin-b")
    created = client.post("/api/client-portal/admin/users", headers=auth_headers, json={
        "client_id": cid_a,
        "full_name": "Responsable Initial",
        "username": "client.admin.initial",
        "password": "Secret123",
        "is_active": True,
        "must_change_password": False,
    })
    assert created.status_code == 201, created.text
    account = created.json()
    assert account["temporary_password"] == "Secret123"
    assert account["must_change_password"] is False
    assert _login(client, "client.admin.initial", "Secret123")

    updated = client.patch(f"/api/client-portal/admin/users/{account['id']}", headers=auth_headers, json={
        "client_id": cid_b,
        "full_name": "Responsable Modifié",
        "username": "client.admin.updated",
        "password": "Nouveau456",
        "is_active": True,
        "must_change_password": True,
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["client_id"] == cid_b
    assert updated.json()["username"] == "client.admin.updated"
    assert updated.json()["must_change_password"] is True
    assert _login(client, "client.admin.updated", "Nouveau456")


def test_admin_cannot_duplicate_client_portal_username_on_update(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Admin Duplicate", portal_slug="client-admin-duplicate")
    first = _portal_account(client, auth_headers, cid, username="client.admin.first")
    second = _portal_account(client, auth_headers, cid, username="client.admin.second")
    response = client.patch(f"/api/client-portal/admin/users/{second['id']}", headers=auth_headers, json={
        "username": first["username"],
    })
    assert response.status_code == 409, response.text


def test_site_groups_count_only_explicit_portal_assignments(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Group Zero", portal_slug="client-group-zero")
    site_id = _site(client, auth_headers, "Site Group Zero", client_id=cid)
    employee_id = _emp(client, auth_headers, "GRPZERO1")
    _assign(client, auth_headers, employee_id, site_id)
    account = _portal_account(client, auth_headers, cid, username="client.group.zero")
    portal_headers = _login(client, account["username"], account["temporary_password"])

    response = client.get("/api/client-portal/sites", headers=portal_headers)
    assert response.status_code == 200, response.text
    site = next(row for row in response.json() if row["id"] == site_id)
    assert site["actual_staff"] == 1
    assert site["employees"][0]["code"] == "GRPZERO1"
    assert site["employees"][0]["assignment_start_date"] == "2026-01-01"
    assert site["employees"][0]["presence_count"] == 0
    assert site["employees"][0]["absence_count"] == 0
    assert site["employees"][0]["suspension_count"] == 0
    assert site["employees"][0]["blacklisted"] is False
    employees_response = client.get("/api/client-portal/employees", headers=portal_headers)
    assert employees_response.status_code == 200, employees_response.text
    assert next(row for row in employees_response.json() if row["id"] == employee_id)["group_code"] is None
    assert next(group for group in site["groups"] if group["code"] == "A")["assigned"] == 0

    assigned_a = client.patch(f"/api/client-portal/employees/{employee_id}/group", headers=portal_headers, json={"group_code": "A"})
    assert assigned_a.status_code == 200, assigned_a.text
    response = client.get("/api/client-portal/sites", headers=portal_headers)
    site = next(row for row in response.json() if row["id"] == site_id)
    assert next(group for group in site["groups"] if group["code"] == "A")["assigned"] == 1
    employees_response = client.get("/api/client-portal/employees", headers=portal_headers)
    assert next(row for row in employees_response.json() if row["id"] == employee_id)["group_code"] == "A"

    assigned_b = client.patch(f"/api/client-portal/employees/{employee_id}/group", headers=portal_headers, json={"group_code": "B"})
    assert assigned_b.status_code == 200, assigned_b.text
    response = client.get("/api/client-portal/sites", headers=portal_headers)
    site = next(row for row in response.json() if row["id"] == site_id)
    assert next(group for group in site["groups"] if group["code"] == "A")["assigned"] == 0
    assert next(group for group in site["groups"] if group["code"] == "B")["assigned"] == 1

    unassigned = client.patch(f"/api/client-portal/employees/{employee_id}/group", headers=portal_headers, json={"group_code": None})
    assert unassigned.status_code == 200, unassigned.text
    assert unassigned.json()["group_code"] is None
    response = client.get("/api/client-portal/sites", headers=portal_headers)
    site = next(row for row in response.json() if row["id"] == site_id)
    assert all(group["assigned"] == 0 for group in site["groups"])
    assert site["employees"][0]["group_code"] is None


def test_client_can_create_site_with_positions_and_group_staffing(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Config Site", portal_slug="client-config-site")
    account = _portal_account(client, auth_headers, cid, username="client.config.site")
    portal_headers = _login(client, account["username"], account["temporary_password"])

    response = client.post("/api/client-portal/sites", headers=portal_headers, json={
        "name": "Nouveau site configuré",
        "site_type": "Entrepôt",
        "address": "Zone industrielle",
        "required_staff": 0,
        "positions": [
            {"name": "Agent de sécurité", "required": 8},
            {"name": "Superviseur", "required": 2},
        ],
        "group_quotas": {"A": 5, "B": 5, "C": 0, "D": 0, "E": 0, "F": 0},
    })
    assert response.status_code == 201, response.text
    site = response.json()
    assert site["required_staff"] == 10
    assert next(group for group in site["groups"] if group["code"] == "A")["quota"] == 5
    agent_position = next(position for position in site["position_requirements"] if position["name"] == "Agent de sécurité")
    assert agent_position == {"name": "Agent de sécurité", "assigned": 0, "required": 8, "remaining": 8}


def test_client_can_submit_employee_action_request_with_attachment(client, auth_headers, monkeypatch, tmp_path):
    from app.modules.client_portal import routes

    monkeypatch.setattr(routes, "DOCS_DIR", tmp_path)
    cid = _commercial_client(client, auth_headers, "Client Action Request", portal_slug="client-action-request")
    site_id = _site(client, auth_headers, "Site Action Request", client_id=cid)
    employee_id = _emp(client, auth_headers, "ACTION1")
    _assign(client, auth_headers, employee_id, site_id)
    account = _portal_account(client, auth_headers, cid, username="client.action.request")
    portal_headers = _login(client, account["username"], account["temporary_password"])

    response = client.post(
        "/api/client-portal/employee-action-requests",
        headers=portal_headers,
        data={"employee_id": str(employee_id), "action": "blacklist", "reason": "Incident grave documenté par le client"},
        files={"file": ("preuve.pdf", b"%PDF-1.4 test", "application/pdf")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["categories"] == ["demande_blacklist"]
    assert body["severity"] == "urgente"
    assert body["attachment_name"] == "preuve.pdf"
    assert body["attachment_url"].startswith("/uploads/photos/docs/client_request_")
    assert any(tmp_path.iterdir())

    target_site_id = _site(client, auth_headers, "Nouveau Site Action", client_id=cid)
    rotation = client.post("/api/ops/rotations", headers=auth_headers, json={
        "code": "ACT7", "name": "Planning action 7 jours", "cycle_length": 7,
        "cycle_days": [{"day": index + 1, "status": "travail"} for index in range(7)],
        "group_offsets": {"A": 0, "B": 1}, "active": 1,
    })
    assert rotation.status_code == 201, rotation.text
    options = client.get("/api/client-portal/reference/assignment-options", headers=portal_headers)
    assert options.status_code == 200, options.text
    assert any(row["id"] == target_site_id for row in options.json()["sites"])
    assert any(row["id"] == rotation.json()["id"] for row in options.json()["plannings"])

    assignment_request = client.post(
        "/api/client-portal/employee-action-requests", headers=portal_headers,
        data={
            "employee_id": str(employee_id), "action": "affectation", "reason": "Renforcement de la nouvelle équipe",
            "target_site_id": str(target_site_id), "target_group_code": "B",
            "target_rotation_id": str(rotation.json()["id"]), "effective_date": "2026-09-01",
        },
    )
    assert assignment_request.status_code == 201, assignment_request.text
    assignment_body = assignment_request.json()
    assert assignment_body["categories"] == ["demande_affectation"]
    assert "NOUVEAU SITE ACTION · Groupe B" in assignment_body["description"]
    assert "PLANNING ACTION 7 JOURS (ACT7)" in assignment_body["description"]
    assert "2026-09-01" in assignment_body["description"]


# ── Visibilité des employés : dérivée du site, PAS de Site.client_name ─────────────────

def test_employee_visible_only_via_site_client_id(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Visi A")
    other_cid = _commercial_client(client, auth_headers, "Client Visi B")
    account = _portal_account(client, auth_headers, cid, username="clientvisi_a")
    headers = _login(client, "clientvisi_a", account["temporary_password"])

    site_mine = _site(client, auth_headers, "Site Visi Mine", client_id=cid)
    site_other = _site(client, auth_headers, "Site Visi Other", client_id=other_cid)
    site_unlinked = _site(client, auth_headers, "Site Visi Unlinked", client_id=None)

    emp_mine = _emp(client, auth_headers, "VISIMINE")
    emp_other = _emp(client, auth_headers, "VISIOTHER")
    emp_unlinked = _emp(client, auth_headers, "VISIUNLINKED")
    _assign(client, auth_headers, emp_mine, site_mine)
    _assign(client, auth_headers, emp_other, site_other)
    _assign(client, auth_headers, emp_unlinked, site_unlinked)

    r = client.get("/api/client-portal/employees", headers=headers)
    assert r.status_code == 200, r.text
    assert next(e for e in r.json() if e["id"] == emp_mine)["code"] == "VISIMINE"
    ids = {e["id"] for e in r.json()}
    assert emp_mine in ids
    assert emp_other not in ids, "un employé d'un autre client ne doit jamais être visible"
    assert emp_unlinked not in ids, "un site sans client_id ne doit exposer aucun employé"


def test_employee_no_longer_visible_after_assignment_ends(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Visi End")
    account = _portal_account(client, auth_headers, cid, username="clientvisi_end")
    headers = _login(client, "clientvisi_end", account["temporary_password"])
    site = _site(client, auth_headers, "Site Visi End", client_id=cid)
    emp = _emp(client, auth_headers, "VISIEND")
    assignment_id = _assign(client, auth_headers, emp, site)
    client.patch(f"/api/ops/assignments/{assignment_id}", headers=auth_headers, json={"active": 0})

    r = client.get("/api/client-portal/employees", headers=headers)
    assert emp not in {e["id"] for e in r.json()}


def test_client_portal_permissions_are_enforced(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Permissions")
    account = _portal_account(client, auth_headers, cid, username="clientpermissions")
    headers = _login(client, "clientpermissions", account["temporary_password"])
    updated = client.put(f"/api/commercial/clients/{cid}", headers=auth_headers, json={
        "data": {"portalPermissions": {
            "viewEmployees": False,
            "viewObservations": False,
            "createObservations": False,
        }}
    })
    assert updated.status_code == 200, updated.text
    assert client.get("/api/client-portal/employees", headers=headers).status_code == 403
    assert client.get("/api/client-portal/observations", headers=headers).status_code == 403
    r = client.post("/api/client-portal/observations", headers=headers, json={
        "employee_id": 1, "kind": "observation", "categories": [],
        "description": "Cette soumission doit être bloquée.", "incident_date": "2026-08-18",
    })
    assert r.status_code == 403


# ── Soumission d'un signalement ─────────────────────────────────────────────────────

def test_create_observation_and_urgent_severity(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Obs")
    account = _portal_account(client, auth_headers, cid, username="clientobs1")
    headers = _login(client, "clientobs1", account["temporary_password"])
    site = _site(client, auth_headers, "Site Obs", client_id=cid)
    emp = _emp(client, auth_headers, "OBS1")
    _assign(client, auth_headers, emp, site)

    r = client.post("/api/client-portal/observations", headers=headers, json={
        "employee_id": emp, "kind": "probleme", "categories": ["abandon_poste"],
        "description": "Agent absent du poste sans justification.", "incident_date": "2026-08-18",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["employee_code"] == "OBS1"
    assert body["severity"] == "urgente"
    assert body["status"] == "nouveau"
    assert "resolution_note" not in body, "la vue client ne doit jamais exposer la note de résolution"


def test_create_observation_rejected_for_employee_not_on_client_site(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Obs Reject")
    other_cid = _commercial_client(client, auth_headers, "Client Obs Other")
    account = _portal_account(client, auth_headers, cid, username="clientobsreject")
    headers = _login(client, "clientobsreject", account["temporary_password"])
    other_site = _site(client, auth_headers, "Site Obs Other", client_id=other_cid)
    foreign_emp = _emp(client, auth_headers, "OBSFOREIGN")
    _assign(client, auth_headers, foreign_emp, other_site)

    r = client.post("/api/client-portal/observations", headers=headers, json={
        "employee_id": foreign_emp, "kind": "observation", "categories": [],
        "description": "Tentative sur un agent qui n'est pas le mien.", "incident_date": "2026-08-18",
    })
    assert r.status_code == 404, r.text


def test_history_scoped_per_client(client, auth_headers):
    cid_a = _commercial_client(client, auth_headers, "Client Hist A")
    cid_b = _commercial_client(client, auth_headers, "Client Hist B")
    account_a = _portal_account(client, auth_headers, cid_a, username="clienthist_a")
    account_b = _portal_account(client, auth_headers, cid_b, username="clienthist_b")
    headers_a = _login(client, "clienthist_a", account_a["temporary_password"])
    headers_b = _login(client, "clienthist_b", account_b["temporary_password"])
    site_a = _site(client, auth_headers, "Site Hist A", client_id=cid_a)
    emp_a = _emp(client, auth_headers, "HISTA")
    _assign(client, auth_headers, emp_a, site_a)

    created = client.post("/api/client-portal/observations", headers=headers_a, json={
        "employee_id": emp_a, "kind": "observation", "categories": [],
        "description": "RAS, ponctuel et professionnel.", "incident_date": "2026-08-18",
    })
    assert created.status_code == 201, created.text
    obs_id = created.json()["id"]

    own_history = client.get("/api/client-portal/observations", headers=headers_a).json()
    assert any(o["id"] == obs_id for o in own_history)

    other_history = client.get("/api/client-portal/observations", headers=headers_b).json()
    assert not any(o["id"] == obs_id for o in other_history), "client B ne doit jamais voir les signalements de A"


# ── Écran interne OPS : triage ───────────────────────────────────────────────────────

def test_ops_can_list_and_resolve_observation_without_exposing_note_to_client(client, auth_headers):
    cid = _commercial_client(client, auth_headers, "Client Ops Triage")
    account = _portal_account(client, auth_headers, cid, username="clientopstriage")
    headers = _login(client, "clientopstriage", account["temporary_password"])
    site = _site(client, auth_headers, "Site Ops Triage", client_id=cid)
    emp = _emp(client, auth_headers, "OPSTRIAGE")
    _assign(client, auth_headers, emp, site)
    created = client.post("/api/client-portal/observations", headers=headers, json={
        "employee_id": emp, "kind": "probleme", "categories": ["retard"],
        "description": "Arrivé 30 minutes en retard.", "incident_date": "2026-08-18",
    })
    obs_id = created.json()["id"]

    ops_list = client.get("/api/client-portal/ops/observations", headers=auth_headers)
    assert ops_list.status_code == 200, ops_list.text
    assert any(o["id"] == obs_id for o in ops_list.json())

    resolved = client.post(f"/api/client-portal/ops/observations/{obs_id}/resolve", headers=auth_headers, json={
        "status": "traite", "resolution_note": "Agent recadré, note interne confidentielle.",
        "client_response": "Votre signalement a été traité par nos équipes.",
    })
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["resolution_note"] == "Agent recadré, note interne confidentielle."
    assert resolved.json()["client_response"] == "Votre signalement a été traité par nos équipes."

    client_view = client.get("/api/client-portal/observations", headers=headers).json()
    own = next(o for o in client_view if o["id"] == obs_id)
    assert own["status"] == "traite"
    assert own["client_response"] == "Votre signalement a été traité par nos équipes."
    assert own["replied_by_name"]
    assert "resolution_note" not in own, "le client ne doit voir que le statut, jamais la note interne"


def test_ops_triage_scoped_by_authorized_society(client, auth_headers, restricted_headers):
    """restricted_headers = utilisateur limité à 'Iron Global Securite' (voir conftest).
    Un signalement rattaché à un site d'une autre société ne doit pas lui apparaître."""
    cid = _commercial_client(client, auth_headers, "Client Ops Scope", portal_slug="clientopsscope")
    account = _portal_account(client, auth_headers, cid, username="clientopsscope_user")
    headers = _login(client, "clientopsscope_user", account["temporary_password"])
    site = client.post("/api/ops/sites", headers=auth_headers, json={
        "name": "Site Ops Scope Foreign", "indicatif": "SOS", "rotation_system": "24/48",
        "active": 1, "client_id": cid, "equipment_plan": {"societe": "Sword Corporation"},
    }).json()
    emp = _emp(client, auth_headers, "OPSSCOPE", society="Sword Corporation")
    _assign(client, auth_headers, emp, site["id"])
    created = client.post("/api/client-portal/observations", headers=headers, json={
        "employee_id": emp, "kind": "observation", "categories": [],
        "description": "Observation hors périmètre du testops.", "incident_date": "2026-08-18",
    })
    assert created.status_code == 201, created.text
    obs_id = created.json()["id"]

    scoped_list = client.get("/api/client-portal/ops/observations", headers=restricted_headers)
    assert scoped_list.status_code == 200, scoped_list.text
    assert not any(o["id"] == obs_id for o in scoped_list.json())
