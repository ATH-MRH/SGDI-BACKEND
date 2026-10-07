"""Pointage consulté depuis DRH : lecture seule aussi côté serveur.

L'interface DRH n'expose aucun contrôle d'écriture du Pointage. Ce fichier vérifie que la
protection ne repose pas sur l'interface : un compte DRH limité à l'action « read » est refusé
(403) sur CHAQUE route d'écriture du Pointage, appelée directement, et les données restent
inchangées. Les lectures, elles, restent autorisées.
"""
import pytest

SOC = "Iron Global Securite"
USERNAME = "drhpointageread"
PASSWORD = "testpass123"
PERIODE = "2026-07"

# Actions legacy du Pointage (feuille mensuelle et feuille de présence quotidienne).
LEGACY_ACTIONS = [
    "save-pointage-cell", "save-pointage-observation", "clear-pointage-sheet",
    "validate-pointage", "unlock-pointage", "validate-pointage-day", "unlock-pointage-day",
    "validate-pointage-all", "unlock-pointage-all",
    "upsert-presence-line", "delete-presence-line", "add-presence-agent", "save-presence-movement",
    "validate-presence-line", "unlock-presence-line", "close-presence-day", "reopen-presence-day",
]
COLLECTIONS = ["pointages", "feuillePresence", "feuillePresenceCloture", "feuillePresenceArchive"]

MUTATIONS = (
    [("post", f"/api/irongs/actions/{action}", {"data": {"agentId": "x", "periode": PERIODE, "day": "1", "code": "P", "date": "2026-07-01"}})
     for action in LEGACY_ACTIONS]
    + [("put", f"/api/irongs/collections/{name}", {"data": []}) for name in COLLECTIONS]
    + [("post", f"/api/irongs/collections/{name}/items", {"data": {"id": "x"}}) for name in COLLECTIONS]
    + [(method, f"/api/irongs/collections/{name}/items/x", {"data": {"id": "x"}})
       for name in ("pointages", "feuillePresence") for method in ("put", "patch", "delete")]
    + [
        ("put", "/api/irongs/db", {"data": {"pointages": []}}),
        ("post", "/api/irongs/db", {"pointages": []}),
        ("post", "/api/ops/pointage/daily/generate", {}),
        ("post", "/api/ops/pointage/daily/generate-rotation", {}),
        ("post", "/api/ops/pointage/daily/close", {}),
        ("post", "/api/ops/pointage/daily", {}),
        ("patch", "/api/ops/pointage/daily/1", {}),
        ("patch", "/api/attendance/presences/1", {}),
        ("patch", "/api/attendance/anomalies/1", {}),
        ("post", "/api/attendance/close", {}),
        ("post", "/api/attendance/presences/1/unlock", {}),
        ("post", "/api/portal/attendance-qr/scan", {"token": "x"}),
        ("post", "/api/portal/attendance-manual/scan", {"employee_id": 1}),
        ("post", "/api/portal/attendance-manual/abandon", {"employee_id": 1}),
    ]
)


@pytest.fixture
def drh_read_headers(client, db):
    from app.core.security import hash_password
    from app.modules.auth.models import User

    if not db.query(User).filter(User.username == USERNAME).first():
        db.add(User(
            username=USERNAME, email="drh-pointage-read@test.com", full_name="DRH lecture seule",
            role="drh", access_level="H3", authorized_societies=[SOC], authorized_structures=["drh"],
            authorized_modules=["drh"], authorized_actions=["read"],
            password_hash=hash_password(PASSWORD), is_active=True,
        ))
        db.commit()
    response = client.post("/api/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _call(client, headers, method, path, payload):
    if method == "delete":
        return client.delete(path, headers=headers)
    return getattr(client, method)(path, headers=headers, json=payload)


def _collection(client, headers, name):
    response = client.get(f"/api/irongs/collections/{name}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json().get("data")


def _seed_sheet(client, auth_headers, code):
    employee = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": code, "first_name": "Lecture", "last_name": "Seule", "society": SOC,
        "status": "actif", "contract_type": "CDD",
    })
    assert employee.status_code in (200, 201), employee.text
    backend_id = employee.json().get("id") or employee.json().get("backendId")
    agent = next(a for a in _collection(client, auth_headers, "agents") if a.get("backendId") == int(backend_id))
    saved = client.post("/api/irongs/actions/save-pointage-cell", headers=auth_headers, json={
        "data": {"agentId": str(agent["id"]), "periode": PERIODE, "day": "1", "code": "P"}})
    assert saved.status_code == 200, saved.text
    return str(agent["id"])


@pytest.mark.parametrize("method,path,payload", MUTATIONS, ids=[f"{m.upper()} {p}" for m, p, _ in MUTATIONS])
def test_drh_read_only_account_cannot_mutate_pointage(client, drh_read_headers, method, path, payload):
    response = _call(client, drh_read_headers, method, path, payload)
    assert response.status_code == 403, f"{method.upper()} {path} -> {response.status_code} {response.text[:200]}"


def test_drh_read_only_account_keeps_reading_pointage(client, auth_headers, drh_read_headers):
    agent_id = _seed_sheet(client, auth_headers, "DRH_RO_READ")
    sheets = _collection(client, drh_read_headers, "pointages")
    assert any(str(s.get("agentId")) == agent_id and s.get("periode") == PERIODE for s in sheets)
    for name in COLLECTIONS:
        assert client.get(f"/api/irongs/collections/{name}", headers=drh_read_headers).status_code == 200, name
    # Le chargement initial de l'application sert les mêmes collections au module DRH.
    snapshot = client.get("/api/irongs/bootstrap", headers=drh_read_headers)
    assert snapshot.status_code == 200, snapshot.text
    served = snapshot.json()["db"]
    assert any(str(s.get("agentId")) == agent_id for s in served.get("pointages", []))
    assert "feuillePresence" in served
    # Le droit de lecture RH ne s'étend pas aux autres collections réservées à OPS.
    assert client.get("/api/irongs/collections/opsMouvements", headers=drh_read_headers).status_code == 403


def test_refused_mutations_leave_pointage_untouched(client, auth_headers, drh_read_headers):
    agent_id = _seed_sheet(client, auth_headers, "DRH_RO_KEEP")
    before = _collection(client, auth_headers, "pointages")
    target = {"data": {"agentId": agent_id, "periode": PERIODE, "day": "1", "code": "A"}}
    for action in ("save-pointage-cell", "validate-pointage", "clear-pointage-sheet", "unlock-pointage"):
        refused = client.post(f"/api/irongs/actions/{action}", headers=drh_read_headers, json=target)
        assert refused.status_code == 403, f"{action} -> {refused.status_code}"
    assert _collection(client, auth_headers, "pointages") == before
    sheet = next(s for s in before if str(s.get("agentId")) == agent_id and s.get("periode") == PERIODE)
    assert sheet["days"]["01"] == "P" and not sheet.get("valide")


@pytest.fixture
def drh_writer_headers(client, db):
    """Compte DRH qui écrit légitimement dans SON module (aucune restriction d'action)."""
    from app.core.security import hash_password
    from app.modules.auth.models import User

    username = "drhpointagewriter"
    if not db.query(User).filter(User.username == username).first():
        db.add(User(
            username=username, email="drh-pointage-writer@test.com", full_name="DRH gestionnaire",
            role="drh", access_level="H3", authorized_societies=[SOC], authorized_structures=["drh"],
            authorized_modules=["drh"], password_hash=hash_password(PASSWORD), is_active=True,
        ))
        db.commit()
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.parametrize("action", LEGACY_ACTIONS + ["assign-vacant-agent"])
def test_drh_account_with_write_rights_still_cannot_write_pointage(client, drh_writer_headers, action):
    """Écrire le Pointage exige le module OPS : les droits d'écriture RH n'y donnent pas accès."""
    refused = client.post(f"/api/irongs/actions/{action}", headers=drh_writer_headers,
                          json={"data": {"agentId": "x", "periode": PERIODE, "day": "1", "code": "P", "date": "2026-07-01"}})
    assert refused.status_code == 403, f"{action} -> {refused.status_code} {refused.text[:200]}"


@pytest.mark.parametrize("name", COLLECTIONS)
def test_drh_account_with_write_rights_reads_but_cannot_replace_pointage_collections(client, drh_writer_headers, name):
    assert client.get(f"/api/irongs/collections/{name}", headers=drh_writer_headers).status_code == 200
    assert client.put(f"/api/irongs/collections/{name}", headers=drh_writer_headers, json={"data": []}).status_code == 403
    assert client.post(f"/api/irongs/collections/{name}/items", headers=drh_writer_headers, json={"data": {"id": "x"}}).status_code == 403


def test_ops_account_keeps_writing_pointage(client, auth_headers, restricted_headers):
    """OPS reste la référence : un compte OPS non administrateur écrit toujours le Pointage."""
    agent_id = _seed_sheet(client, auth_headers, "DRH_RO_OPS")
    saved = client.post("/api/irongs/actions/save-pointage-cell", headers=restricted_headers, json={
        "data": {"agentId": agent_id, "periode": PERIODE, "day": "2", "code": "A"}})
    assert saved.status_code == 200, saved.text
    sheet = next(s for s in _collection(client, restricted_headers, "pointages")
                 if str(s.get("agentId")) == agent_id and s.get("periode") == PERIODE)
    assert sheet["days"]["02"] == "A"


def test_same_routes_stay_open_to_an_authorised_writer(client, auth_headers):
    """Le 403 ci-dessus vient bien des droits du compte, pas d'une route inexistante."""
    agent_id = _seed_sheet(client, auth_headers, "DRH_RO_CTRL")
    target = {"data": {"agentId": agent_id, "periode": PERIODE}}
    assert client.post("/api/irongs/actions/validate-pointage", headers=auth_headers, json=target).status_code == 200
    assert client.post("/api/irongs/actions/unlock-pointage", headers=auth_headers, json=target).status_code == 200
