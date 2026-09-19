"""LOT VALIDATION PRODUCTION + DURCISSEMENT MODULE LOADER — §7.

StaticCacheMiddleware imposait Cache-Control: public, max-age=31536000,
immutable sur TOUTE réponse /static/*, y compris un 404 — vérifié en
investiguant l'incident DRH via un curl direct sur un module inexistant, qui
renvoyait déjà ce même en-tête. Un 404 transitoire (course de déploiement,
faute de frappe côté client) resterait alors mis en cache "immutable" un an
entier côté navigateur/proxy, même une fois le fichier réellement disponible.
Seules les réponses 2xx doivent porter ce cache long.
"""


def test_missing_module_script_returns_real_404_without_long_cache(client):
    r = client.get("/static/js/modules/ce-fichier-n-existe-jamais.js")
    assert r.status_code == 404
    assert "cache-control" not in {k.lower() for k in r.headers.keys()}, \
        "un 404 ne doit jamais porter le Cache-Control immutable d'un an — sinon il reste mis en cache indéfiniment"


def test_existing_module_script_keeps_long_immutable_cache(client):
    r = client.get("/static/js/modules/positions.js")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "public, max-age=31536000, immutable"


def test_no_cache_paths_are_never_long_cached_even_on_success(client):
    # sgdi-app.js n'est volontairement PAS versionné par URL (contrairement aux
    # modules lazy) : il doit rester revalidé à chaque chargement, jamais figé.
    r = client.get("/static/sgdi-app.js")
    assert r.status_code == 200
    assert r.headers.get("cache-control") != "public, max-age=31536000, immutable"


def test_api_version_exposes_commit_and_alembic_revision(client):
    """§1 — avant ce lot, /api/version ne permettait d'identifier que le seul
    hash du frontend, jamais le commit backend ni la révision Alembic
    réellement appliquée à cette base : impossible de prouver en incident
    quel code tournait vraiment."""
    r = client.get("/api/version")
    assert r.status_code == 200
    body = r.json()
    assert "commit" in body
    assert "alembic" in body
    assert "frontend_version" in body
    assert body["version"] == body["frontend_version"], "champ historique conservé, ne doit pas casser un appelant existant"
    # La suite de tests crée son schéma via Base.metadata.create_all (pas de
    # vraies migrations Alembic rejouées) : il n'existe donc légitimement
    # aucune table alembic_version ici, contrairement à une vraie base migrée.
    # Ce qui compte pour ce test : l'endpoint ne doit JAMAIS planter faute de
    # cette table, et doit renvoyer un repli explicite plutôt qu'une erreur 500.
    assert isinstance(body["alembic"], str) and body["alembic"]
