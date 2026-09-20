"""P1 finalisation DRH Next — blacklist auditée et réversible.

Décision produit (voir rapport de mission) : un enregistrement RH audité et réversible,
pas un simple booléen — table dédiée employee_blacklist_entries, motif obligatoire,
historique conservé, jamais de suppression physique.
"""


def _emp(client, h, code, society="Iron Global Securite"):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "Test", "society": society,
        "status": "actif", "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _scoped_user(client, auth_headers, username, *, actions=None, society="Iron Global Securite"):
    r = client.post("/api/auth/users", headers=auth_headers, json={
        "username": username, "email": f"{username}@test.com", "password": "testpass123",
        "validation_password": "validation123", "role": "rh",
        "authorized_societies": [society], "authorized_modules": ["drh"],
        "authorized_actions": actions or [],
    })
    assert r.status_code in (200, 201), r.text
    login = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_create_blacklist_entry_requires_reason(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL001")
    r = client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={})
    assert r.status_code == 422
    r2 = client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={"reason": ""})
    assert r2.status_code == 422


def test_create_blacklist_entry_succeeds_and_updates_employee_status(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL002")
    r = client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={"reason": "Vol constaté sur site"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "active"
    assert body["reason"] == "Vol constaté sur site"
    assert body["created_by"] == "testadmin"
    assert body["lifted_at"] is None

    emp = client.get(f"/api/drh/employees/{emp_id}", headers=auth_headers).json()
    assert emp["status"] == "blackliste"


def test_double_active_blacklist_is_rejected(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL003")
    r1 = client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={"reason": "Premier motif"})
    assert r1.status_code == 200
    r2 = client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={"reason": "Second motif"})
    assert r2.status_code == 409


def test_blacklist_history_is_kept_never_deleted(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL004")
    client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={"reason": "Motif initial"})
    lift = client.post(f"/api/drh/employees/{emp_id}/blacklist/lift", headers=auth_headers, json={"lift_reason": "Erreur d'appréciation, situation clarifiée"})
    assert lift.status_code == 200
    history = client.get(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers).json()
    assert len(history) == 1
    assert history[0]["status"] == "levee"
    assert history[0]["reason"] == "Motif initial"
    assert history[0]["lift_reason"] == "Erreur d'appréciation, situation clarifiée"
    assert history[0]["lifted_by"] == "testadmin"
    assert history[0]["lifted_at"] is not None


def test_lift_restores_previous_employee_status_not_always_actif(client, auth_headers, db):
    from app.modules.drh.models import Employee

    emp_id = _emp(client, auth_headers, "BL005")
    emp = db.get(Employee, emp_id)
    emp.status = "suspendu"
    db.commit()
    client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={"reason": "Motif"})
    client.post(f"/api/drh/employees/{emp_id}/blacklist/lift", headers=auth_headers, json={"lift_reason": "Levée"})
    reloaded = client.get(f"/api/drh/employees/{emp_id}", headers=auth_headers).json()
    assert reloaded["status"] == "suspendu", "le statut antérieur (pas systématiquement 'actif') doit être restauré"


def test_lift_without_active_entry_is_404(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL006")
    r = client.post(f"/api/drh/employees/{emp_id}/blacklist/lift", headers=auth_headers, json={"lift_reason": "Rien à lever"})
    assert r.status_code == 404


def test_lift_requires_reason(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL007")
    client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={"reason": "Motif"})
    r = client.post(f"/api/drh/employees/{emp_id}/blacklist/lift", headers=auth_headers, json={})
    assert r.status_code == 422


def test_other_society_scope_is_403(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL008", society="Iron Global Securite")
    other = _scoped_user(client, auth_headers, "rh_blacklist_autre_societe", actions=["validate"], society="Autre Société SARL")
    r = client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=other, json={"reason": "Motif"})
    assert r.status_code == 403


def test_read_history_requires_no_special_action_just_drh_scope(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL009")
    reader = _scoped_user(client, auth_headers, "rh_blacklist_lecture", actions=["read"])
    r = client.get(f"/api/drh/employees/{emp_id}/blacklist", headers=reader)
    assert r.status_code == 200


def test_create_without_validate_action_is_403(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL010")
    scoped = _scoped_user(client, auth_headers, "rh_blacklist_sans_validate", actions=["read", "create"])
    r = client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=scoped, json={"reason": "Motif"})
    assert r.status_code == 403


def test_create_with_validate_action_succeeds(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL011")
    scoped = _scoped_user(client, auth_headers, "rh_blacklist_avec_validate", actions=["read", "create", "validate"])
    r = client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=scoped, json={"reason": "Motif"})
    assert r.status_code == 200


def test_lift_without_validate_action_is_403(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL012")
    client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={"reason": "Motif"})
    scoped = _scoped_user(client, auth_headers, "rh_lift_sans_validate", actions=["read"])
    r = client.post(f"/api/drh/employees/{emp_id}/blacklist/lift", headers=scoped, json={"lift_reason": "Levée"})
    assert r.status_code == 403


def test_admin_global_bypasses_validate_requirement(client, auth_headers):
    # auth_headers = testadmin, role="admin", authorized_actions=[] : déjà exercé par tous
    # les autres tests ci-dessus (aucune action explicite requise pour un admin), revérifié
    # ici explicitement comme preuve directe de "admin global conforme aux règles existantes".
    emp_id = _emp(client, auth_headers, "BL013")
    r = client.post(f"/api/drh/employees/{emp_id}/blacklist", headers=auth_headers, json={"reason": "Motif"})
    assert r.status_code == 200


def test_no_drh_module_is_403(client, auth_headers):
    emp_id = _emp(client, auth_headers, "BL014")
    login = client.post("/api/auth/login", json={"username": "testops", "password": "testpass123"})
    ops_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    r = client.get(f"/api/drh/employees/{emp_id}/blacklist", headers=ops_headers)
    assert r.status_code == 403


def test_session_ab_no_cross_society_data(client, auth_headers):
    emp_a = _emp(client, auth_headers, "BL015", society="Iron Global Securite")
    client.post(f"/api/drh/employees/{emp_a}/blacklist", headers=auth_headers, json={"reason": "Motif société A confidentiel"})
    rhb = _scoped_user(client, auth_headers, "rh_blacklist_session_b", actions=["validate"], society="Autre Société SARL")
    r = client.get(f"/api/drh/employees/{emp_a}/blacklist", headers=rhb)
    assert r.status_code == 403
    assert "confidentiel" not in r.text.lower()


def test_nonexistent_employee_is_404(client, auth_headers):
    r = client.post("/api/drh/employees/999999/blacklist", headers=auth_headers, json={"reason": "Motif"})
    assert r.status_code == 404
