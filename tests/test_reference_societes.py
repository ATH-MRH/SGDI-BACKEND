"""Endpoint léger GET /api/irongs/societes (écran select-societe, sans snapshot global)."""


def test_societes_non_cloisonne_voit_toutes(client, auth_headers):
    r = client.get("/api/irongs/societes", headers=auth_headers)
    assert r.status_code == 200, r.text
    socs = r.json()["societes"]
    assert "IRON GLOBAL SOLUTION" in socs and len(socs) == 4


def test_societes_cloisonne_voit_les_siennes(client, restricted_headers):
    # testops est cloisonné à "Iron Global Securite" (sans accents) -> matching accent-insensible.
    r = client.get("/api/irongs/societes", headers=restricted_headers)
    assert r.status_code == 200, r.text
    socs = r.json()["societes"]
    assert len(socs) == 1
    assert "IRON GLOBAL S" in socs[0].upper()  # SÉCURITÉ (référentiel) résolu depuis "Securite"


def test_societes_exige_authentification(client):
    assert client.get("/api/irongs/societes").status_code in (401, 403)
