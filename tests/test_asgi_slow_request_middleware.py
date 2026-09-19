"""LOT HOTFIX ASGI SLOW REQUEST MIDDLEWARE.

log_slow_requests était un @app.middleware("http"), donc un BaseHTTPMiddleware.
Preuve par reproduction isolée (script jetable, hors dépôt) : BaseHTTPMiddleware
reconstruit TOUJOURS la réponse en flux interne (queue + générateur async) avant
de la rendre au dispatcher, même pour une Response non-streaming à l'origine —
GZipMiddleware (placé plus à l'extérieur dans la pile, voir app/main.py) tombe
alors dans sa branche "streaming", qui supprime Content-Length et impose du
chunked, quelle que soit la taille réelle du corps.

Remplacé par SlowRequestMiddleware, un middleware ASGI pur qui n'intercepte que
le message http.response.start (pour y ajouter X-Process-Time-ms) et laisse
tout http.response.body strictement inchangé.

Ce fichier vérifie :
- le comportement préservé (en-tête de timing, host facturation.irongs.com,
  seuil de journalisation des requêtes lentes) ;
- le test structurel critique demandé : Content-Length présent pour une
  réponse non-streaming compressée (échouait sur l'ancien middleware) ;
- qu'un véritable StreamingResponse reste un vrai flux (jamais de
  Content-Length forcé dessus).
"""
import logging

from starlette.responses import JSONResponse, StreamingResponse

from app.main import app  # noqa: E402  (import isolé de SlowRequestMiddleware ci-dessous :
# les tests de seuil l'importent localement, pour que SEULE la preuve Content-Length
# — la régression réelle de ce lot — casse contre l'ancien middleware, sans faire
# planter TOUT le fichier sur un ImportError qui masquerait le vrai signal.

# Routes de test ajoutées directement sur l'application réelle (même pile de
# middlewares que la production, y compris GZipMiddleware) — jamais montées en
# production car préfixées /__test/, et ajoutées une seule fois même si ce
# module est importé plusieurs fois par pytest.
_BIG_PAYLOAD = {"items": [{"i": i, "label": "x" * 80} for i in range(400)]}


def _big_json_route():
    return JSONResponse(_BIG_PAYLOAD)


def _real_stream_route():
    def gen():
        for i in range(5):
            yield f"chunk-{i}\n".encode()
    return StreamingResponse(gen(), media_type="text/plain")


if not any(getattr(r, "path", None) == "/__test/big-json" for r in app.router.routes):
    app.add_api_route("/__test/big-json", _big_json_route, methods=["GET"])
if not any(getattr(r, "path", None) == "/__test/real-stream" for r in app.router.routes):
    app.add_api_route("/__test/real-stream", _real_stream_route, methods=["GET"])


def _header_names(response):
    return {k.lower() for k in response.headers.keys()}


def test_x_process_time_header_present(client):
    r = client.get("/__test/big-json")
    assert r.status_code == 200
    assert "x-process-time-ms" in _header_names(r)
    assert int(r.headers["x-process-time-ms"]) >= 0


def test_gzip_response_keeps_content_length_for_non_streaming_body(client):
    """Test structurel critique (§7 du lot) : échouait sur l'ancien
    BaseHTTPMiddleware (Content-Length supprimé, réponse transformée en
    streaming/chunked), doit passer avec le middleware ASGI pur."""
    r = client.get("/__test/big-json", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert "content-length" in _header_names(r), (
        "Content-Length doit être présent : la route retourne une Response non-streaming, "
        "GZipMiddleware ne doit donc plus être forcé dans sa branche streaming."
    )
    assert int(r.headers["content-length"]) > 0
    # httpx décompresse automatiquement le corps ; on vérifie le contenu logique,
    # pas une correspondance d'octets avec le Content-Length (qui décrit le corps
    # COMPRESSÉ sur le fil, pas le JSON décompressé lu ici).
    assert r.json() == _BIG_PAYLOAD


def test_identity_response_also_keeps_content_length(client):
    r = client.get("/__test/big-json", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert "content-encoding" not in _header_names(r)
    assert "content-length" in _header_names(r)


def test_real_streaming_response_is_never_given_a_forced_content_length(client):
    """§8 : ne jamais forcer Content-Length sur un véritable StreamingResponse —
    avant ou après ce correctif, un flux réel doit rester un flux réel."""
    r = client.get("/__test/real-stream", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert "content-length" not in _header_names(r), (
        "un StreamingResponse ne connaît pas sa taille totale à l'avance : "
        "lui imposer Content-Length serait incorrect, pas juste different du passé"
    )
    assert r.text == "chunk-0\nchunk-1\nchunk-2\nchunk-3\nchunk-4\n"


def test_facturation_host_still_returns_404_not_found(client):
    """Comportement préexistant à préserver à l'identique : host-based guard,
    court-circuite tout le reste de l'app AVANT le routeur."""
    r = client.get("/api/version", headers={"Host": "facturation.irongs.com"})
    assert r.status_code == 404
    assert r.text == "Not Found"
    assert r.headers.get("cache-control") == "no-store"


def test_slow_request_is_logged_above_threshold(client, caplog):
    from app.main import SlowRequestMiddleware
    original = SlowRequestMiddleware._SLOW_THRESHOLD_MS
    SlowRequestMiddleware._SLOW_THRESHOLD_MS = 0  # toute requête devient "lente" pour ce test
    try:
        with caplog.at_level(logging.WARNING, logger="sgdi"):
            client.get("/__test/big-json")
        assert any("Requête lente" in rec.message for rec in caplog.records)
    finally:
        SlowRequestMiddleware._SLOW_THRESHOLD_MS = original


def test_fast_request_under_threshold_is_not_logged_as_slow(client, caplog):
    with caplog.at_level(logging.WARNING, logger="sgdi"):
        client.get("/__test/big-json")
    assert not any("Requête lente" in rec.message for rec in caplog.records)


def test_static_path_never_logged_as_slow_even_forced(client, caplog):
    """Exclusion préexistante : /static/ jamais journalisé comme lent, même si
    le seuil est artificiellement ramené à 0."""
    from app.main import SlowRequestMiddleware
    original = SlowRequestMiddleware._SLOW_THRESHOLD_MS
    SlowRequestMiddleware._SLOW_THRESHOLD_MS = 0
    try:
        with caplog.at_level(logging.WARNING, logger="sgdi"):
            client.get("/static/sgdi-app.js")
        assert not any("Requête lente" in rec.message for rec in caplog.records)
    finally:
        SlowRequestMiddleware._SLOW_THRESHOLD_MS = original
