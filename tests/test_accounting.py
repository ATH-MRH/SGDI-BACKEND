"""Palier 11 — COMPTABILITÉ : comptes, écritures, balance.

Verrouille LA règle comptable fondamentale : une écriture ne peut être validée que
si elle est ÉQUILIBRÉE (total débit == total crédit). Plus le recalcul des totaux à
l'ajout de ligne et la balance.
"""
from datetime import date

SOC = "Iron Global Securite"
_n = [0]


def _uid():
    _n[0] += 1
    return _n[0]


def _compte(client, h, numero=None, libelle="Compte test", type_compte="charge"):
    numero = numero or f"6{_uid():05d}"
    r = client.post("/api/accounting/comptes", headers=h, json={
        "numero": numero, "libelle": libelle, "type_compte": type_compte, "society": SOC})
    assert r.status_code in (200, 201), r.text
    return r.json(), numero


# ── Comptes ───────────────────────────────────────────────────────────────────

def test_compte_crud(client, auth_headers):
    compte, numero = _compte(client, auth_headers, libelle="Achats matiere")
    cid = compte["id"]
    assert any(c["numero"] == numero for c in client.get("/api/accounting/comptes", headers=auth_headers).json())
    upd = client.put(f"/api/accounting/comptes/{cid}", headers=auth_headers, json={"libelle": "Achats modifie"})
    assert upd.status_code == 200 and upd.json()["libelle"] == "Achats modifie"
    page = client.get("/api/accounting/comptes/page?page=1&page_size=5", headers=auth_headers)
    assert page.status_code == 200 and "items" in page.json()
    assert client.delete(f"/api/accounting/comptes/{cid}", headers=auth_headers).status_code in (200, 204)


# ── Écritures : la règle d'équilibre débit/crédit ────────────────────────────

def test_ecriture_create_computes_totals(client, auth_headers):
    _, c1 = _compte(client, auth_headers)
    _, c2 = _compte(client, auth_headers)
    r = client.post("/api/accounting/ecritures", headers=auth_headers, json={
        "society": SOC, "date_ecriture": str(date.today()), "libelle": "Achat fournitures", "journal": "ACH",
        "lignes": [
            {"compte_numero": c1, "libelle": "Charge", "debit": 10000, "credit": 0},
            {"compte_numero": c2, "libelle": "Fournisseur", "debit": 0, "credit": 10000},
        ],
    })
    assert r.status_code in (200, 201), r.text
    ec = r.json()
    assert ec["total_debit"] == 10000 and ec["total_credit"] == 10000
    assert ec["status"] == "brouillon"


def test_ecriture_balanced_can_be_validated(client, auth_headers):
    _, c1 = _compte(client, auth_headers)
    _, c2 = _compte(client, auth_headers)
    ec = client.post("/api/accounting/ecritures", headers=auth_headers, json={
        "society": SOC, "libelle": "Equilibree", "lignes": [
            {"compte_numero": c1, "debit": 5000, "credit": 0},
            {"compte_numero": c2, "debit": 0, "credit": 5000},
        ]}).json()
    v = client.post(f"/api/accounting/ecritures/{ec['id']}/valider", headers=auth_headers)
    assert v.status_code == 200 and v.json()["status"] == "validée"
    # Re-valider -> refusé
    assert client.post(f"/api/accounting/ecritures/{ec['id']}/valider", headers=auth_headers).status_code == 400


def test_ecriture_unbalanced_cannot_be_validated(client, auth_headers):
    """RÈGLE CLÉ : débit != crédit -> validation refusée (écriture non équilibrée)."""
    _, c1 = _compte(client, auth_headers)
    _, c2 = _compte(client, auth_headers)
    ec = client.post("/api/accounting/ecritures", headers=auth_headers, json={
        "society": SOC, "libelle": "Desequilibree", "lignes": [
            {"compte_numero": c1, "debit": 10000, "credit": 0},
            {"compte_numero": c2, "debit": 0, "credit": 7000},
        ]}).json()
    assert ec["total_debit"] != ec["total_credit"]
    v = client.post(f"/api/accounting/ecritures/{ec['id']}/valider", headers=auth_headers)
    assert v.status_code == 400, v.text
    assert "quilibr" in v.json()["detail"].lower()


def test_ecriture_add_ligne_recomputes_totals(client, auth_headers):
    _, c1 = _compte(client, auth_headers)
    ec = client.post("/api/accounting/ecritures", headers=auth_headers, json={
        "society": SOC, "libelle": "E", "lignes": [
            {"compte_numero": c1, "debit": 3000, "credit": 0}]}).json()
    assert ec["total_debit"] == 3000
    _, c2 = _compte(client, auth_headers)
    after = client.post(f"/api/accounting/ecritures/{ec['id']}/lignes", headers=auth_headers, json={
        "compte_numero": c2, "debit": 0, "credit": 3000}).json()
    assert after["total_credit"] == 3000, "les totaux doivent se recalculer après ajout de ligne"


def test_balance_endpoint(client, auth_headers):
    r = client.get("/api/accounting/balance", headers=auth_headers)
    assert r.status_code == 200 and isinstance(r.json(), list)
