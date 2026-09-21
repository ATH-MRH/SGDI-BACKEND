"""ATLAS V3 — LOT V3.1 : point d'entrée contrôlé.

Preuve explicite (pas seulement lue dans le code) que les nouvelles routes statiques
core-v3/modules-v3/atlas-v3 n'interceptent JAMAIS le reste de /static/* — risque réel
identifié et corrigé pendant l'écriture de ces routes (un premier motif générique
/static/{root_dir}/{asset_path:path} aurait cassé /static/js/modules/*.js et tout le reste).
"""


def test_atlas_v3_entry_serves_versioned_html(client):
    r = client.get("/atlas-v3")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "app.mjs?v=" in r.text
    assert "atlas-v3.css?v=" in r.text


def test_atlas_v3_core_asset_served(client):
    r = client.get("/static/core-v3/session.mjs")
    assert r.status_code == 200
    assert "text/javascript" in r.headers["content-type"]


def test_atlas_v3_modules_asset_served(client):
    r = client.get("/static/modules-v3/dashboard/index.mjs")
    assert r.status_code == 200


def test_atlas_v3_entry_asset_served(client):
    r = client.get("/static/atlas-v3/app.mjs")
    assert r.status_code == 200


def test_atlas_v3_relative_imports_are_rewritten_with_version(client):
    r = client.get("/static/atlas-v3/app.mjs?v=x")
    assert r.status_code == 200
    assert "from \"../core-v3/bootstrap.mjs?v=" in r.text


def test_atlas_v3_path_traversal_refused(client):
    r = client.get("/static/core-v3/../../../etc/passwd")
    assert r.status_code in (404, 400)


# CRITIQUE — non-régression : ces routes ne doivent JAMAIS intercepter le reste de /static/*.
def test_legacy_monolith_js_still_served(client):
    r = client.get("/static/sgdi-app.js")
    assert r.status_code == 200


def test_legacy_lazy_module_still_served(client):
    r = client.get("/static/js/modules/drh.js")
    assert r.status_code == 200


def test_legacy_core_utils_still_served(client):
    r = client.get("/static/js/core/module-registry.js")
    assert r.status_code == 200


def test_drh_next_unaffected(client):
    r = client.get("/static/drh-next/app.mjs")
    assert r.status_code == 200


def test_legacy_css_still_served(client):
    r = client.get("/static/sgdi-app.css")
    assert r.status_code == 200
