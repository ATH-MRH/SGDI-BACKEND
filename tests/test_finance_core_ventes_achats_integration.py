"""P1-C — Ventes/Achats intégrés à Finance Core : une facture client validée doit ouvrir
une créance (receivable), une facture fournisseur doit ouvrir une dette (payable), et un
paiement fournisseur existant (achats.payer_facture) doit régler l'obligation SANS jamais
double-compter l'écriture comptable déjà postée par le chemin achats natif."""
from datetime import date

SOC = "Iron Global Securite"


def test_devis_converti_en_commande_ouvre_une_creance_finance_core(client, auth_headers):
    devis = client.post("/api/ventes/devis", headers=auth_headers, json={
        "society": SOC, "client_name": "ACME Finance Core", "date_devis": str(date.today()),
        "objet": "Prestation", "lignes": [{"designation": "Agent", "quantite": 2, "prix_unitaire_ht": 50000, "tva_pct": 19}],
    }).json()
    client.post(f"/api/ventes/devis/{devis['id']}/valider", headers=auth_headers)
    cmd = client.post(f"/api/ventes/devis/{devis['id']}/convertir", headers=auth_headers).json()
    # La commande convertie crée une Invoice ; son numéro n'est pas retourné directement par
    # /convertir — on retrouve l'obligation par société+direction+source_type et on vérifie
    # que son montant correspond au total de la commande confirmée.
    obligations = client.get("/api/finance-core/obligations", headers=auth_headers, params={
        "society": SOC, "direction": "receivable",
    }).json()["items"]
    matching = [o for o in obligations if o["counterparty_name"] == "ACME Finance Core"]
    assert matching, "aucune obligation Finance Core créée depuis la conversion devis -> commande"
    assert float(matching[0]["amount_total"]) == float(cmd["total_ttc"])
    assert matching[0]["status"] == "open"


def test_facture_fournisseur_creation_ouvre_une_dette_finance_core(client, auth_headers):
    fournisseur = client.post("/api/achats/fournisseurs", headers=auth_headers, json={
        "society": SOC, "name": "Fournisseur Finance Core Test",
    }).json()
    facture = client.post("/api/achats/factures", headers=auth_headers, json={
        "society": SOC, "fournisseur_id": fournisseur["id"], "fournisseur_name": fournisseur["name"],
        "date_facture": str(date.today()), "total_ht": 1000.0, "tva": 190.0, "total_ttc": 1190.0,
    }).json()

    obligations = client.get("/api/finance-core/obligations", headers=auth_headers, params={
        "society": SOC, "direction": "payable",
    }).json()["items"]
    matching = [o for o in obligations if o["source_type"] == "facture_fournisseur" and o["source_id"] == facture["numero"]]
    assert matching, "aucune obligation Finance Core créée depuis la facture fournisseur"
    assert float(matching[0]["amount_total"]) == 1190.0


def test_payer_facture_settles_obligation_without_double_accounting_entry(client, auth_headers):
    fournisseur = client.post("/api/achats/fournisseurs", headers=auth_headers, json={
        "society": SOC, "name": "Fournisseur Double Compte Test",
    }).json()
    facture = client.post("/api/achats/factures", headers=auth_headers, json={
        "society": SOC, "fournisseur_id": fournisseur["id"], "fournisseur_name": fournisseur["name"],
        "date_facture": str(date.today()), "total_ht": 500.0, "tva": 0.0, "total_ttc": 500.0,
    }).json()

    ecritures_before = client.get("/api/accounting/ecritures/page", headers=auth_headers, params={
        "society": SOC, "page": 1, "page_size": 100,
    }).json()["total"]

    pay = client.post(f"/api/achats/factures/{facture['id']}/payer", headers=auth_headers, json={"montant": 500.0})
    assert pay.status_code == 200, pay.text
    assert pay.json()["status"] == "payée"

    ecritures_after_payer = client.get("/api/accounting/ecritures/page", headers=auth_headers, params={
        "society": SOC, "page": 1, "page_size": 100,
    }).json()["total"]
    assert ecritures_after_payer == ecritures_before + 1, "payer_facture doit poster exactement UNE écriture (chemin achats natif)"

    obligations = client.get("/api/finance-core/obligations", headers=auth_headers, params={
        "society": SOC, "direction": "payable",
    }).json()["items"]
    matching = [o for o in obligations if o["source_type"] == "facture_fournisseur" and o["source_id"] == facture["numero"]]
    assert matching and matching[0]["status"] == "settled", matching

    # Traiter l'outbox NE DOIT PAS créer de seconde écriture pour ce même règlement :
    # settle_obligation(skip_accounting_bridge=True) a préempté l'AccountingEvent en
    # "skipped", donc le pont comptable ne repostera jamais l'écriture déjà créée par
    # ecriture_paiement_fournisseur (chemin achats natif, inchangé).
    client.post("/api/finance-core/outbox/dispatch", headers=auth_headers)
    ecritures_after_dispatch = client.get("/api/accounting/ecritures/page", headers=auth_headers, params={
        "society": SOC, "page": 1, "page_size": 100,
    }).json()["total"]
    assert ecritures_after_dispatch == ecritures_after_payer, "le dispatch de l'outbox ne doit JAMAIS double-compter une écriture déjà postée"

    events = client.get("/api/finance-core/accounting-events", headers=auth_headers, params={"society": SOC}).json()
    assert any(e["status"] == "skipped" for e in events), "l'AccountingEvent du règlement achats doit être marqué 'skipped', jamais reposté"
