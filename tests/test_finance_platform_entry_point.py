def test_finance_platform_entry_serves_html(client):
    """V2 (frontend complet) : index.html est désormais une coquille qui charge api.js/
    shell.js/views/*.js — plus un fichier auto-porté unique (voir CHANGELOG de la mission
    "ATLAS Finance Platform V2"). Les assertions portent donc sur la présence des scripts
    référencés, chacun vérifié séparément ci-dessous pour son propre contenu."""
    r = client.get("/finance-platform")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "ATLAS Finance Platform" in r.text
    for src in ("api.js", "shell.js", "views/banque.js", "views/obligations.js", "views/paie.js",
                "views/budget.js", "views/rentabilite.js", "views/fiscalite.js", "views/comptabilite.js",
                "views/reglementation.js", "views/cockpit.js", "views/tresorerie.js", "views/dashboard.js"):
        assert src in r.text, f"script manquant dans la coquille : {src}"


def test_finance_platform_static_assets_serve_real_content(client):
    """Les fichiers référencés par index.html sont réellement servis (StaticFiles couvre
    app/static entièrement) et portent le contenu attendu — preuve directe que l'architecture
    modulaire fonctionne de bout en bout, pas seulement que les <script src> existent."""
    api_js = client.get("/static/finance-platform/api.js")
    assert api_js.status_code == 200
    assert 'const API = "/api"' in api_js.text

    banque_js = client.get("/static/finance-platform/views/banque.js")
    assert banque_js.status_code == 200
    assert "/banking/accounts" in banque_js.text
    assert "/reconciliation/cases" in banque_js.text

    app_css = client.get("/static/finance-platform/app.css")
    assert app_css.status_code == 200
    assert "--primary" in app_css.text


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
    assert "shell.js" in r.text


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
