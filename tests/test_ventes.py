"""Palier 10 — VENTES : devis, conversion en commande, livraisons.

Verrouille : le calcul des totaux de devis (HT/TTC), le workflow (brouillon ->
envoyé -> converti), et la CONVERSION devis -> commande (report des lignes/montants).
"""
from datetime import date

SOC = "Iron Global Securite"


def _devis(client, h, lignes=None):
    r = client.post("/api/ventes/devis", headers=h, json={
        "society": SOC, "client_name": "ACME", "date_devis": str(date.today()),
        "objet": "Prestation gardiennage",
        "lignes": lignes if lignes is not None else [
            {"designation": "Agent jour", "quantite": 4, "prix_unitaire_ht": 50000, "tva_pct": 19},
        ],
    })
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_devis_create_computes_totals(client, auth_headers):
    d = _devis(client, auth_headers, lignes=[
        {"designation": "Agent jour", "quantite": 4, "prix_unitaire_ht": 50000, "tva_pct": 19},
        {"designation": "Agent nuit", "quantite": 2, "prix_unitaire_ht": 60000, "tva_pct": 19},
    ])
    # HT = 4*50000 + 2*60000 = 320000 ; TTC = 320000 * 1.19 = 380800
    assert d["total_ht"] == 320000
    assert d["total_ttc"] == 380800
    assert d["status"] == "brouillon"


def test_devis_add_ligne_recomputes_total(client, auth_headers):
    d = _devis(client, auth_headers, lignes=[{"designation": "A", "quantite": 1, "prix_unitaire_ht": 1000, "tva_pct": 0}])
    assert d["total_ht"] == 1000
    after = client.post(f"/api/ventes/devis/{d['id']}/lignes", headers=auth_headers, json={
        "designation": "B", "quantite": 3, "prix_unitaire_ht": 1000, "tva_pct": 0}).json()
    assert after["total_ht"] == 4000, "total recalculé après ajout de ligne"


def test_devis_envoyer(client, auth_headers):
    d = _devis(client, auth_headers)
    r = client.post(f"/api/ventes/devis/{d['id']}/valider", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] in ("envoyé", "validé", "envoye")


def test_devis_convertir_en_commande(client, auth_headers):
    """Convertir un devis crée une commande qui reprend les lignes et montants."""
    d = _devis(client, auth_headers, lignes=[
        {"designation": "Agent", "quantite": 3, "prix_unitaire_ht": 40000, "tva_pct": 19}])
    assert d["total_ht"] == 120000

    # Un devis doit d'abord être envoyé/accepté pour être converti
    client.post(f"/api/ventes/devis/{d['id']}/valider", headers=auth_headers)
    r = client.post(f"/api/ventes/devis/{d['id']}/convertir", headers=auth_headers)
    assert r.status_code in (200, 201), r.text
    cmd = r.json()
    # La commande reprend le total du devis
    assert cmd.get("total_ht") == 120000
    assert cmd.get("total_ttc") == round(120000 * 1.19, 2)
    # Elle référence le devis d'origine
    assert cmd.get("devis_id") == d["id"] or any(
        l.get("designation") == "Agent" for l in cmd.get("lignes", []))


def test_devis_delete(client, auth_headers):
    d = _devis(client, auth_headers)
    assert client.delete(f"/api/ventes/devis/{d['id']}", headers=auth_headers).status_code in (200, 204)


def test_devis_page(client, auth_headers):
    _devis(client, auth_headers)
    r = client.get("/api/ventes/devis/page?page=1&page_size=5", headers=auth_headers)
    assert r.status_code == 200 and "items" in r.json()
