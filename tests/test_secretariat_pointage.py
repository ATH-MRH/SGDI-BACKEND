"""Palier 6 — SECRÉTARIAT + POINTAGE.

Ces deux modules n'ont pas de backend dédié : secrétariat = collections JSON
(courriers/notes), pointage = collections JSON (pointages/feuillePresence) pilotées
par des ACTIONS legacy irongs (/api/irongs/actions/...). Le pointage OPS
(/api/ops/pointage/*) est déjà couvert au palier 2. On verrouille ici la
persistance secrétariat et les actions de feuille de pointage.
"""
SOC = "Iron Global Securite"


def _put(client, h, data):
    r = client.put("/api/irongs/db", headers=h, json={"data": data})
    assert r.status_code == 200, r.text


def _collection(client, h, name):
    r = client.get(f"/api/irongs/collections/{name}", headers=h)
    assert r.status_code == 200, r.text
    return r.json().get("data", [])


def _action(client, h, action, payload):
    return client.post(f"/api/irongs/actions/{action}", headers=h, json=payload)


def _emp(client, h, code, society=SOC):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "Pt", "society": society,
        "status": "actif", "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _agent_id(client, h, emp_sql_id):
    """Identifiant de l'agent tel que vu dans la collection 'agents' (attendu par le pointage)."""
    agents = _collection(client, h, "agents")
    target = next((a for a in agents if a.get("backendId") == int(emp_sql_id)), None)
    assert target is not None, "agent introuvable dans la collection"
    return str(target.get("id"))


# ═══════════════════════════════════════════════════════════════════════════
# Secrétariat : persistance des courriers / notes (collections JSON)
# ═══════════════════════════════════════════════════════════════════════════

def test_secretariat_courriers_persist(client, auth_headers):
    _put(client, auth_headers, {"secretariatCourriers": [
        {"id": "co1", "reference": "ARR-2026-001", "objet": "Demande info", "statut": "en_cours", "societe": SOC},
        {"id": "co2", "reference": "DEP-2026-002", "objet": "Reponse", "statut": "archive", "societe": SOC},
    ]})
    courriers = _collection(client, auth_headers, "secretariatCourriers")
    ids = {c["id"] for c in courriers}
    assert {"co1", "co2"} <= ids
    co1 = next(c for c in courriers if c["id"] == "co1")
    assert co1["reference"] == "ARR-2026-001" and co1["objet"] == "Demande info"


def test_secretariat_notes_persist(client, auth_headers):
    _put(client, auth_headers, {"secretariatNotes": [
        {"id": "nt1", "objet": "Note interne", "contenu": "Rappel reunion", "societe": SOC},
    ]})
    notes = _collection(client, auth_headers, "secretariatNotes")
    assert any(n["id"] == "nt1" and n["contenu"] == "Rappel reunion" for n in notes)


def test_secretariat_empty_save_does_not_wipe(client, auth_headers):
    """Une sauvegarde vide ne doit pas effacer les courriers (cohérence multi-PC)."""
    _put(client, auth_headers, {"secretariatCourriers": [{"id": "keep_co", "reference": "R", "societe": SOC}]})
    _put(client, auth_headers, {"secretariatCourriers": []})
    assert any(c["id"] == "keep_co" for c in _collection(client, auth_headers, "secretariatCourriers"))


# ═══════════════════════════════════════════════════════════════════════════
# Pointage : actions de feuille (save-cell, validate, unlock, clear)
# ═══════════════════════════════════════════════════════════════════════════

def test_save_pointage_cell_creates_sheet_and_sets_day(client, auth_headers):
    emp = _emp(client, auth_headers, "PT_A1")
    aid = _agent_id(client, auth_headers, emp)
    r = _action(client, auth_headers, "save-pointage-cell", {
        "data": {"agentId": aid, "periode": "2026-03", "day": "5", "code": "P"},
    })
    assert r.status_code == 200, r.text

    sheet = next(s for s in _collection(client, auth_headers, "pointages")
                 if str(s.get("agentId")) == aid and s.get("periode") == "2026-03")
    assert sheet["days"].get("05") == "P", "le jour doit être stocké zéro-paddé"


def test_save_pointage_cell_validation(client, auth_headers):
    emp = _emp(client, auth_headers, "PT_A2")
    aid = _agent_id(client, auth_headers, emp)
    # Champs manquants
    assert _action(client, auth_headers, "save-pointage-cell", {"data": {"agentId": aid}}).status_code == 422
    # Jour invalide
    assert _action(client, auth_headers, "save-pointage-cell", {
        "data": {"agentId": aid, "periode": "2026-03", "day": "40", "code": "P"}}).status_code == 422
    # Agent inconnu
    assert _action(client, auth_headers, "save-pointage-cell", {
        "data": {"agentId": "inconnu_999", "periode": "2026-03", "day": "5", "code": "P"}}).status_code == 404


def test_validate_and_unlock_pointage(client, auth_headers):
    emp = _emp(client, auth_headers, "PT_VAL")
    aid = _agent_id(client, auth_headers, emp)
    _action(client, auth_headers, "save-pointage-cell", {
        "data": {"agentId": aid, "periode": "2026-04", "day": "1", "code": "P"}})

    # Valider la feuille
    v = _action(client, auth_headers, "validate-pointage", {"data": {"agentId": aid, "periode": "2026-04"}})
    assert v.status_code == 200, v.text
    sheet = next(s for s in _collection(client, auth_headers, "pointages")
                 if str(s.get("agentId")) == aid and s.get("periode") == "2026-04")
    assert sheet.get("valide") is True and sheet.get("valideAt")

    # Déverrouiller (rôle admin OK pour testadmin)
    u = _action(client, auth_headers, "unlock-pointage", {"data": {"agentId": aid, "periode": "2026-04"}})
    assert u.status_code == 200, u.text
    sheet2 = next(s for s in _collection(client, auth_headers, "pointages")
                  if str(s.get("agentId")) == aid and s.get("periode") == "2026-04")
    assert sheet2.get("valide") is False


def test_validate_pointage_requires_agent_and_period(client, auth_headers):
    assert _action(client, auth_headers, "validate-pointage", {"data": {"agentId": "", "periode": ""}}).status_code == 422


def test_unlock_pointage_allowed_for_ops_role(client, auth_headers, restricted_headers):
    """Le déverrouillage est réservé aux rôles RH/Admin/Dispatch/OPS. L'utilisateur
    'ops' (restricted) en fait partie -> autorisé."""
    emp = _emp(client, auth_headers, "PT_OPS")
    aid = _agent_id(client, auth_headers, emp)
    _action(client, auth_headers, "save-pointage-cell", {
        "data": {"agentId": aid, "periode": "2026-05", "day": "1", "code": "P"}})
    _action(client, auth_headers, "validate-pointage", {"data": {"agentId": aid, "periode": "2026-05"}})
    r = _action(client, restricted_headers, "unlock-pointage", {"data": {"agentId": aid, "periode": "2026-05"}})
    assert r.status_code == 200, r.text


def test_unlock_pointage_forbidden_for_plain_agent(client, auth_headers, db):
    """Un rôle non privilégié (agent) ne peut PAS déverrouiller (403)."""
    from app.core.security import hash_password
    from app.modules.auth.models import User
    if not db.query(User).filter(User.username == "testagent").first():
        db.add(User(username="testagent", email="ag@test.com", full_name="Agent",
                    role="agent", access_level="H1", authorized_societies=[SOC],
                    authorized_structures=[], password_hash=hash_password("testpass123"), is_active=True))
        db.commit()
    emp = _emp(client, auth_headers, "PT_AG")
    aid = _agent_id(client, auth_headers, emp)
    _action(client, auth_headers, "save-pointage-cell", {
        "data": {"agentId": aid, "periode": "2026-06", "day": "1", "code": "P"}})
    _action(client, auth_headers, "validate-pointage", {"data": {"agentId": aid, "periode": "2026-06"}})
    tok = client.post("/api/auth/login", json={"username": "testagent", "password": "testpass123"})
    h = {"Authorization": f"Bearer {tok.json()['access_token']}"}
    r = _action(client, h, "unlock-pointage", {"data": {"agentId": aid, "periode": "2026-06"}})
    assert r.status_code == 403, r.text


def test_unlock_pointage_404_when_sheet_absent(client, auth_headers):
    r = _action(client, auth_headers, "unlock-pointage", {"data": {"agentId": "1", "periode": "1999-01"}})
    assert r.status_code == 404, r.text
