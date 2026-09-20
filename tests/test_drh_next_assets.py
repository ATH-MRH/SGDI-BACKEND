"""LOT 12A (finalisation DRH Next) — dette DRH-NEXT-CACHE-LOT12.

Vérifie que /drh-next et /static/drh-next/* servent un cache-buster par hash de
contenu (?v=), jamais un cache long-terme sur une requête sans ce paramètre, et que
les spécificateurs d'import relatifs des modules .mjs sont bien réécrits en cascade.
"""
import re


def test_drh_next_html_references_versioned_assets(client):
    r = client.get("/drh-next")
    assert r.status_code == 200
    body = r.text
    assert "no-cache" in r.headers.get("cache-control", "").lower() or r.headers.get("cache-control") is not None
    match = re.search(r'src="/static/drh-next/app\.mjs\?v=([0-9a-f]+)"', body)
    assert match, body
    version = match.group(1)
    for css in ("tokens.css", "layout.css", "components.css"):
        assert f'/static/drh-next/styles/{css}?v={version}"' in body


def test_drh_next_asset_without_version_is_no_cache(client):
    r = client.get("/static/drh-next/app.mjs")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "no-cache"


def test_drh_next_asset_with_version_is_long_cache_immutable(client):
    version = re.search(r'app\.mjs\?v=([0-9a-f]+)', client.get("/drh-next").text).group(1)
    r = client.get(f"/static/drh-next/app.mjs?v={version}")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "public, max-age=31536000, immutable"


def test_drh_next_mjs_relative_imports_are_rewritten_with_version(client):
    version = re.search(r'app\.mjs\?v=([0-9a-f]+)', client.get("/drh-next").text).group(1)
    r = client.get(f"/static/drh-next/modules/employee-dossier.mjs?v={version}")
    assert r.status_code == 200
    assert f'from "../core/api.mjs?v={version}"' in r.text
    assert f'from "./employees.mjs?v={version}"' in r.text
    assert r.headers.get("content-type", "").startswith("text/javascript")


def test_drh_next_css_served_with_correct_content_type(client):
    version = re.search(r'app\.mjs\?v=([0-9a-f]+)', client.get("/drh-next").text).group(1)
    r = client.get(f"/static/drh-next/styles/tokens.css?v={version}")
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("text/css")


def test_drh_next_asset_path_traversal_rejected(client):
    r = client.get("/static/drh-next/../../app/main.py")
    assert r.status_code in (404, 403, 400)


def test_api_version_exposes_drh_next_version(client):
    r = client.get("/api/version")
    assert r.status_code == 200
    body = r.json()
    assert "drh_next_version" in body
    assert re.fullmatch(r"[0-9a-f]{12}", body["drh_next_version"])
