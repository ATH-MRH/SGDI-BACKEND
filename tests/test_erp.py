"""Tests CRUD des modules ERP : Comptabilité, Achats, Ventes."""
import pytest


# ── Comptabilité ─────────────────────────────────────────────────────────────

def test_create_compte(client, auth_headers, society):
    resp = client.post("/api/accounting/comptes", headers=auth_headers, json={
        "numero": "512", "libelle": "Banque", "type_compte": "actif", "society": society
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["numero"] == "512"
    assert data["id"] > 0


def test_list_comptes(client, auth_headers):
    resp = client.get("/api/accounting/comptes", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_ecriture(client, auth_headers, society):
    resp = client.post("/api/accounting/ecritures", headers=auth_headers, json={
        "society": society,
        "date_ecriture": "2026-01-15",
        "libelle": "Règlement client",
        "journal": "BQ",
        "lignes": [
            {"compte_numero": "512", "libelle": "Débit banque", "debit": 10000, "credit": 0},
            {"compte_numero": "411", "libelle": "Client soldé", "debit": 0, "credit": 10000},
        ]
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["numero_piece"] is not None
    assert data["total_debit"] == 10000
    assert data["total_credit"] == 10000


def test_valider_ecriture_desequilibree(client, auth_headers, society):
    create = client.post("/api/accounting/ecritures", headers=auth_headers, json={
        "society": society, "date_ecriture": "2026-01-16",
        "libelle": "Écriture déséquilibrée", "journal": "OD",
        "lignes": [{"compte_numero": "512", "libelle": "Test", "debit": 500, "credit": 0}]
    })
    assert create.status_code == 200
    ecriture_id = create.json()["id"]
    resp = client.post(f"/api/accounting/ecritures/{ecriture_id}/valider", headers=auth_headers)
    assert resp.status_code == 400
    assert "équilibrée" in resp.json()["detail"].lower() or "crédit" in resp.json()["detail"].lower()


def test_balance(client, auth_headers, society):
    resp = client.get(f"/api/accounting/balance?society={society}", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ── Achats ────────────────────────────────────────────────────────────────────

def test_create_fournisseur(client, auth_headers, society):
    resp = client.post("/api/achats/fournisseurs", headers=auth_headers, json={
        "name": "Fournisseur Test SARL", "society": society,
        "phone": "0550000000", "email": "contact@ftest.dz"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Fournisseur Test SARL"
    assert data["status"] == "actif"


def test_list_fournisseurs(client, auth_headers):
    resp = client.get("/api/achats/fournisseurs", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_bon_commande(client, auth_headers, society):
    resp = client.post("/api/achats/commandes", headers=auth_headers, json={
        "society": society, "fournisseur_name": "Fournisseur Test",
        "date_commande": "2026-01-10",
        "lignes": [
            {"designation": "Fournitures bureau", "quantite": 10, "prix_unitaire_ht": 500, "tva_pct": 19},
        ]
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["numero"].startswith("BDC-")
    assert data["total_ht"] == 5000
    assert data["total_ttc"] == 5950


def test_payer_facture_montant_negatif(client, auth_headers, society):
    facture = client.post("/api/achats/factures", headers=auth_headers, json={
        "society": society, "fournisseur_name": "Fournisseur Test",
        "date_facture": "2026-01-10", "total_ht": 10000, "tva": 1900, "total_ttc": 11900
    })
    assert facture.status_code == 200
    fid = facture.json()["id"]
    resp = client.post(f"/api/achats/factures/{fid}/payer", headers=auth_headers, json={"montant": -500})
    assert resp.status_code == 400


def test_payer_facture_surpaiement(client, auth_headers, society):
    facture = client.post("/api/achats/factures", headers=auth_headers, json={
        "society": society, "fournisseur_name": "Fournisseur Test 2",
        "date_facture": "2026-01-11", "total_ht": 1000, "tva": 190, "total_ttc": 1190
    })
    fid = facture.json()["id"]
    resp = client.post(f"/api/achats/factures/{fid}/payer", headers=auth_headers, json={"montant": 9999})
    assert resp.status_code == 400
    assert "dépasse" in resp.json()["detail"].lower()


def test_payer_facture_valide(client, auth_headers, society):
    facture = client.post("/api/achats/factures", headers=auth_headers, json={
        "society": society, "fournisseur_name": "Fournisseur Payé",
        "date_facture": "2026-01-12", "total_ht": 1000, "tva": 190, "total_ttc": 1190
    })
    fid = facture.json()["id"]
    resp = client.post(f"/api/achats/factures/{fid}/payer", headers=auth_headers, json={"montant": 1190})
    assert resp.status_code == 200
    assert resp.json()["status"] == "payée"


# ── Ventes ────────────────────────────────────────────────────────────────────

def test_create_devis(client, auth_headers, society):
    resp = client.post("/api/ventes/devis", headers=auth_headers, json={
        "society": society, "client_name": "Client Test SARL",
        "date_devis": "2026-01-15", "objet": "Prestation de gardiennage",
        "lignes": [
            {"designation": "Gardiennage mensuel", "quantite": 1, "prix_unitaire_ht": 50000, "tva_pct": 9},
        ]
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["numero"].startswith("DEV-")
    assert data["status"] == "brouillon"
    assert data["total_ht"] == 50000
    assert data["total_ttc"] == 54500


def test_envoyer_devis(client, auth_headers, society):
    create = client.post("/api/ventes/devis", headers=auth_headers, json={
        "society": society, "client_name": "Client Envoi",
        "date_devis": "2026-01-16", "objet": "Test envoi",
        "lignes": [{"designation": "Service", "quantite": 1, "prix_unitaire_ht": 10000, "tva_pct": 19}]
    })
    devis_id = create.json()["id"]
    resp = client.post(f"/api/ventes/devis/{devis_id}/valider", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "envoyé"


def test_convertir_devis_en_commande(client, auth_headers, society):
    create = client.post("/api/ventes/devis", headers=auth_headers, json={
        "society": society, "client_name": "Client Conversion",
        "date_devis": "2026-01-17", "objet": "Test conversion",
        "lignes": [{"designation": "Produit", "quantite": 2, "prix_unitaire_ht": 5000, "tva_pct": 19}]
    })
    devis_id = create.json()["id"]
    client.post(f"/api/ventes/devis/{devis_id}/valider", headers=auth_headers)
    resp = client.post(f"/api/ventes/devis/{devis_id}/convertir", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["numero"].startswith("CMD-")
    assert data["total_ht"] == 10000
    assert data["devis_id"] == devis_id


def test_list_commandes(client, auth_headers):
    resp = client.get("/api/ventes/commandes/page", headers=auth_headers)
    assert resp.status_code == 200
    assert "items" in resp.json()


# ── Reporting ─────────────────────────────────────────────────────────────────

def test_reporting_dashboard(client, auth_headers):
    resp = client.get("/api/reporting/dashboard", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "chiffre_affaires_ht" in data
    assert "nb_devis" in data


def test_reporting_ventes(client, auth_headers):
    resp = client.get("/api/reporting/ventes", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "devis" in data
    assert "commandes" in data


def test_reporting_achats(client, auth_headers):
    resp = client.get("/api/reporting/achats", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "bons_commande" in data
    assert "factures_fournisseur" in data
