"""Palier 8 — COMMERCIAL (/api/commercial) : gestion des clients.

Prospects, opportunités, devis, visites sont des collections JSON irongs (couvertes
palier 4 + actions legacy set-status/convert-prospect palier 4). Le module commercial
backend gère les CLIENTS (modèle SQL). On verrouille leur CRUD + le cloisonnement société.
"""
SOC = "Iron Global Securite"


def _client(client, h, name, society=SOC, status="actif"):
    r = client.post("/api/commercial/clients", headers=h, json={
        "name": name, "legal_name": f"{name} SARL", "society": society, "status": status,
        "contact_name": "Contact", "phone": "0550111222", "nif": "NIF1",
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_client_crud(client, auth_headers):
    cid = _client(client, auth_headers, "ACME Commerce")
    lst = client.get("/api/commercial/clients", headers=auth_headers)
    assert lst.status_code == 200 and any(c["id"] == cid for c in lst.json())

    upd = client.put(f"/api/commercial/clients/{cid}", headers=auth_headers, json={
        "name": "ACME Modifie", "society": SOC, "status": "prospect",
    })
    assert upd.status_code == 200 and upd.json()["status"] == "prospect"

    page = client.get("/api/commercial/clients/page?page=1&page_size=5", headers=auth_headers)
    assert page.status_code == 200 and "items" in page.json()

    assert client.delete(f"/api/commercial/clients/{cid}", headers=auth_headers).status_code in (200, 204)
    # supprimé -> plus dans la liste
    assert not any(c["id"] == cid for c in client.get("/api/commercial/clients", headers=auth_headers).json())


def test_client_preserves_custom_data(client, auth_headers):
    r = client.post("/api/commercial/clients", headers=auth_headers, json={
        "name": "Client Data", "society": SOC, "data": {"champMetier": "a-preserver", "secteur": "logistique"},
    })
    assert r.status_code in (200, 201), r.text
    got = next(c for c in client.get("/api/commercial/clients", headers=auth_headers).json() if c["id"] == r.json()["id"])
    data = got.get("data") or {}
    assert data.get("champMetier") == "a-preserver" and data.get("secteur") == "logistique"


def test_clients_page_filters(client, auth_headers):
    _client(client, auth_headers, "Client Filtre Unique", status="actif")
    page = client.get("/api/commercial/clients/page?status=actif&q=FILTRE UNIQUE", headers=auth_headers)
    assert page.status_code == 200
    assert any("FILTRE UNIQUE" in (c.get("name") or "").upper() for c in page.json()["items"])


def test_client_create_forbidden_for_foreign_society(client, restricted_headers):
    r = client.post("/api/commercial/clients", headers=restricted_headers, json={
        "name": "Client Sword", "society": "Sword Corporation",
    })
    assert r.status_code == 403, r.text


def test_restricted_user_cannot_touch_foreign_client(client, auth_headers, restricted_headers):
    cid = _client(client, auth_headers, "Client IGS Prive", society="Sword Corporation")
    assert client.put(f"/api/commercial/clients/{cid}", headers=restricted_headers,
                      json={"name": "X", "society": "Sword Corporation"}).status_code == 403
    assert client.delete(f"/api/commercial/clients/{cid}", headers=restricted_headers).status_code == 403


def test_restricted_user_only_sees_his_society_clients(client, auth_headers, restricted_headers):
    mine = _client(client, auth_headers, "Client Visible IGS", society=SOC)
    foreign = _client(client, auth_headers, "Client Cache Sword", society="Sword Corporation")
    ids = {c["id"] for c in client.get("/api/commercial/clients", headers=restricted_headers).json()}
    assert mine in ids
    assert foreign not in ids, "un client d'une autre société ne doit pas être visible"
