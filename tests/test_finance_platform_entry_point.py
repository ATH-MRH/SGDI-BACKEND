def test_finance_platform_entry_serves_html(client):
    r = client.get("/finance-platform")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "ATLAS Finance Platform" in r.text
    assert "/banking/accounts" in r.text
    assert "/reconciliation/cases" in r.text
    assert 'const API = "/api"' in r.text


def test_legacy_still_served_unaffected(client):
    r = client.get("/static/sgdi-app.js")
    assert r.status_code == 200


# ── finance.irongs.com — domaine canonique (Host header) ──────────────────────────────────
# Un seul backend, une seule auth/session/RBAC/scope société — le domaine ne fait que
# sélectionner quelle page statique "/" sert, exactement comme dc.irongs.com/pret.irongs.com/
# rh.irongs.com déjà en place (voir app/main.py, _is_xxx_host). Aucune route /api/* n'est
# jamais conditionnée par le Host — testé explicitement ci-dessous.

def test_finance_host_serves_finance_platform_at_root(client):
    r = client.get("/", headers={"host": "finance.irongs.com"})
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "ATLAS Finance Platform" in r.text
    assert "/banking/accounts" in r.text


def test_finance_host_root_is_nocache(client):
    r = client.get("/", headers={"host": "finance.irongs.com"})
    assert "no-store" in r.headers.get("cache-control", "")


def test_drh_host_root_unaffected(client):
    """drh.irongs.com/ continue de servir l'application DRH par défaut, inchangée —
    Finance Platform n'y est retiré qu'au chemin /finance-platform (voir plus bas), jamais
    à la racine."""
    r = client.get("/", headers={"host": "drh.irongs.com"})
    assert r.status_code == 200
    assert "ATLAS Finance Platform" not in r.text
    assert 'id="app"' in r.text


def test_ops_host_root_unaffected(client):
    r = client.get("/", headers={"host": "ops.irongs.com"})
    assert r.status_code == 200
    assert "ATLAS Finance Platform" not in r.text


def test_materiel_host_root_unaffected(client):
    r = client.get("/", headers={"host": "materiel.irongs.com"})
    assert r.status_code == 200
    assert "ATLAS Finance Platform" not in r.text


def test_drh_finance_platform_path_redirects_to_finance_host(client):
    r = client.get("/finance-platform", headers={"host": "drh.irongs.com"}, follow_redirects=False)
    assert r.status_code == 301
    assert r.headers["location"] == "https://finance.irongs.com/"


def test_finance_platform_path_from_other_hosts_still_serves_directly(client):
    """La dépréciation explicite ne porte QUE sur drh.irongs.com (demande précise) — les
    autres domaines partagés continuent de servir /finance-platform tel quel, aucune route
    existante n'est retirée en dehors du périmètre demandé."""
    for host in ("atlas.irongs.com", "ops.irongs.com", "materiel.irongs.com"):
        r = client.get("/finance-platform", headers={"host": host}, follow_redirects=False)
        assert r.status_code == 200, (host, r.status_code)
        assert "ATLAS Finance Platform" in r.text


def test_finance_host_does_not_affect_api_routes(client, auth_headers):
    """Même backend, même auth, même RBAC, même scope société, même PostgreSQL — le Host
    ne conditionne jamais /api/*. Testé avec un Host finance.irongs.com sur une route
    Finance réelle déjà couverte par la suite Finance Core."""
    r = client.post("/api/finance-core/obligations", headers={**auth_headers, "host": "finance.irongs.com"}, json={
        "society": "Iron Global Securite", "direction": "receivable", "source_type": "manual",
        "source_id": "HOST-ROUTING-TEST-1", "amount_total": "10.00",
        "idempotency_key": "host-routing-test:1",
    })
    assert r.status_code == 200, r.text
    assert r.json()["society"] == "Iron Global Securite"
