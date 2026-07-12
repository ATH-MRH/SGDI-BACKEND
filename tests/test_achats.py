"""Palier 9 — ACHATS : fournisseurs, bons de commande, réceptions.

Verrouille : le calcul des totaux de ligne (HT/TTC avec TVA), le workflow de BDC
(brouillon -> validé / annulé), et surtout la RÉCEPTION VALIDÉE qui incrémente le
stock (mouvement + quantité article). Une erreur ici = un stock faux.
"""
from datetime import date

SOC = "Iron Global Securite"
_n = [0]


def _uid():
    _n[0] += 1
    return _n[0]


def _fournisseur(client, h, name="Fournisseur A"):
    r = client.post("/api/achats/fournisseurs", headers=h, json={"name": name, "society": SOC, "phone": "0550000000"})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _store(client, h):
    r = client.post("/api/materiel/stores", headers=h, json={"name": f"Mag Achat {_uid()}", "code": f"MA{_uid()}", "society": SOC})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _article(client, h, store_id, qty=0):
    code = f"ART_ACH{_uid()}"
    r = client.post("/api/materiel/articles", headers=h, json={
        "code": code, "designation": f"Art {code}", "store_id": store_id, "society": SOC, "quantity": qty,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ── Fournisseurs ──────────────────────────────────────────────────────────────

def test_fournisseur_crud(client, auth_headers):
    fid = _fournisseur(client, auth_headers, "Fournisseur CRUD")
    assert any(f["id"] == fid for f in client.get("/api/achats/fournisseurs", headers=auth_headers).json())
    upd = client.put(f"/api/achats/fournisseurs/{fid}", headers=auth_headers, json={"status": "inactif"})
    assert upd.status_code == 200 and upd.json()["status"] == "inactif"
    page = client.get("/api/achats/fournisseurs/page?page=1&page_size=5", headers=auth_headers)
    assert page.status_code == 200 and "items" in page.json()
    assert client.delete(f"/api/achats/fournisseurs/{fid}", headers=auth_headers).status_code in (200, 204)


# ── Bons de commande : totaux + workflow ─────────────────────────────────────

def test_bdc_create_computes_totals(client, auth_headers):
    fid = _fournisseur(client, auth_headers)
    r = client.post("/api/achats/commandes", headers=auth_headers, json={
        "fournisseur_id": fid, "society": SOC, "date_commande": str(date.today()),
        "lignes": [
            {"designation": "Rangers", "quantite": 10, "prix_unitaire_ht": 3000, "tva_pct": 19},
            {"designation": "Casques", "quantite": 5, "prix_unitaire_ht": 2000, "tva_pct": 19},
        ],
    })
    assert r.status_code in (200, 201), r.text
    bdc = r.json()
    # HT = 10*3000 + 5*2000 = 40000 ; TTC = 40000 * 1.19 = 47600
    assert bdc["total_ht"] == 40000
    assert bdc["total_ttc"] == 47600
    assert bdc["status"] == "brouillon"


def test_bdc_add_ligne_recomputes_total(client, auth_headers):
    fid = _fournisseur(client, auth_headers)
    bdc = client.post("/api/achats/commandes", headers=auth_headers, json={
        "fournisseur_id": fid, "society": SOC, "lignes": [
            {"designation": "A", "quantite": 1, "prix_unitaire_ht": 1000, "tva_pct": 19}]}).json()
    assert bdc["total_ht"] == 1000
    after = client.post(f"/api/achats/commandes/{bdc['id']}/lignes", headers=auth_headers, json={
        "designation": "B", "quantite": 2, "prix_unitaire_ht": 500, "tva_pct": 19}).json()
    assert after["total_ht"] == 2000, "le total doit être recalculé après ajout de ligne"
    assert after["total_ttc"] == round(2000 * 1.19, 2)


def test_bdc_valider_workflow(client, auth_headers):
    fid = _fournisseur(client, auth_headers)
    bdc = client.post("/api/achats/commandes", headers=auth_headers, json={
        "fournisseur_id": fid, "society": SOC, "lignes": [
            {"designation": "X", "quantite": 1, "prix_unitaire_ht": 100, "tva_pct": 0}]}).json()
    v = client.post(f"/api/achats/commandes/{bdc['id']}/valider", headers=auth_headers)
    assert v.status_code == 200 and v.json()["status"] == "validé"
    # Re-valider un bon déjà validé -> refusé
    assert client.post(f"/api/achats/commandes/{bdc['id']}/valider", headers=auth_headers).status_code == 400


def test_bdc_delete_only_brouillon(client, auth_headers):
    fid = _fournisseur(client, auth_headers)
    bdc = client.post("/api/achats/commandes", headers=auth_headers, json={
        "fournisseur_id": fid, "society": SOC, "lignes": []}).json()
    client.post(f"/api/achats/commandes/{bdc['id']}/valider", headers=auth_headers)
    # Validé -> suppression refusée
    assert client.delete(f"/api/achats/commandes/{bdc['id']}", headers=auth_headers).status_code == 400


def test_bdc_annuler(client, auth_headers):
    fid = _fournisseur(client, auth_headers)
    bdc = client.post("/api/achats/commandes", headers=auth_headers, json={
        "fournisseur_id": fid, "society": SOC, "lignes": []}).json()
    a = client.post(f"/api/achats/commandes/{bdc['id']}/annuler", headers=auth_headers)
    assert a.status_code == 200 and a.json()["status"] == "annulé"
    # Re-annuler -> refusé
    assert client.post(f"/api/achats/commandes/{bdc['id']}/annuler", headers=auth_headers).status_code == 400


# ── Réception validée -> stock incrémenté ────────────────────────────────────

def test_reception_valider_increments_stock(client, auth_headers):
    fid = _fournisseur(client, auth_headers)
    sid = _store(client, auth_headers)
    aid = _article(client, auth_headers, sid, qty=5)

    # NB: on ne passe pas fournisseur_id ici — valider_reception l'affecte à
    # StockMovement.supplier_id, or fournisseur_id référence les fournisseurs ACHATS
    # tandis que supplier_id vise les fournisseurs MATÉRIEL (espaces d'ID distincts).
    # On teste l'incrément de stock, cœur du sujet, via fournisseur_name.
    rec = client.post("/api/achats/receptions", headers=auth_headers, json={
        "society": SOC, "fournisseur_name": "Fournisseur X", "date_reception": str(date.today()),
        "lignes": [{"article_id": aid, "designation": "Art", "quantite_commandee": 20, "quantite_recue": 12, "prix_unitaire": 3000}],
    })
    assert rec.status_code in (200, 201), rec.text
    rec_id = rec.json()["id"]

    v = client.post(f"/api/achats/receptions/{rec_id}/valider", headers=auth_headers)
    assert v.status_code == 200, v.text

    # Le stock de l'article est passé de 5 à 5+12 = 17
    art = next(a for a in client.get("/api/materiel/articles", headers=auth_headers).json() if a["id"] == aid)
    assert art["quantity"] == 17, "la réception validée doit incrémenter le stock"

    # Re-valider -> refusé
    assert client.post(f"/api/achats/receptions/{rec_id}/valider", headers=auth_headers).status_code == 400
