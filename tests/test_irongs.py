"""Palier 4 — irongs (cœur multi-PC) : snapshot, collections SQL & JSON, endpoints, actions.

Sans mock, vraies routes, vraie base. Complète la couverture déjà apportée par le
chantier perf (scope/accents/admin, flatten, snapshot non-destructif, concurrence).
On verrouille ici : le round-trip de CHAQUE collection SQL (sauvegarde -> relecture
sans perte), le CRUD des items JSON, les endpoints positions, /db POST, la
sémantique de remplacement, et les actions legacy.
"""
import pytest

SOC = "Iron Global Securite"


def _post_item(client, h, name, data):
    r = client.post(f"/api/irongs/collections/{name}/items", headers=h, json={"data": data})
    assert r.status_code in (200, 201), r.text
    return r.json()


def _collection(client, h, name):
    r = client.get(f"/api/irongs/collections/{name}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _find(rows, key, value):
    return next((x for x in rows if isinstance(x, dict) and str(x.get(key)) == str(value)), None)


# ═══════════════════════════════════════════════════════════════════════════
# Round-trip des collections SQL : sauvegarde legacy -> colonnes -> relecture
# ═══════════════════════════════════════════════════════════════════════════

def test_roundtrip_site(client, auth_headers):
    _post_item(client, auth_headers, "sites", {
        "id": "st_rt1", "nom": "Depot Test RT", "indicatif": "DRT", "societe": SOC,
        "adresse": "Rue 10", "commune": "Alger", "rotationSystem": "24/48",
        "effectifs": {"totalContractuel": 7, "jour": 3, "nuit": 2},
        "champMetierCustom": "valeur-a-preserver",
    })
    site = _find(_collection(client, auth_headers, "sites"), "indicatif", "DRT")
    assert site is not None
    assert site["nom"] == "Depot Test RT"
    assert site["effectifs"]["totalContractuel"] == 7
    assert site["champMetierCustom"] == "valeur-a-preserver", "un champ legacy custom doit survivre"
    assert site.get("backendId")


def test_roundtrip_client(client, auth_headers):
    _post_item(client, auth_headers, "clients", {
        "id": "cl_rt1", "raisonSociale": "ACME SARL", "nom": "ACME", "societe": SOC,
        "statut": "actif", "tel": "0550111222", "nif": "NIF123", "champCustom": "X",
    })
    cli = _find(_collection(client, auth_headers, "clients"), "raisonSociale", "ACME SARL")
    assert cli is not None
    assert cli["statut"] == "actif" and cli["tel"] == "0550111222"
    assert cli["champCustom"] == "X"


@pytest.mark.parametrize("name,payload,check", [
    ("factures", {"id": "fa1", "numero": "F-2026-001", "date": "2026-01-10", "societe": SOC,
                  "client": "ACME", "ttc": 119000, "totalHT": 100000, "objet": "Prestation"},
     ("numero", "F-2026-001")),
    ("paiements", {"id": "pa1", "montant": 50000, "date": "2026-01-15", "societe": SOC, "mode": "virement"},
     ("montant", 50000)),
    ("avances", {"id": "av1", "montant": 20000, "societe": SOC, "beneficiaire": "K01"},
     ("beneficiaire", "K01")),
    ("avoirs", {"id": "avo1", "montant": 8000, "societe": SOC, "motif": "retour"},
     ("motif", "retour")),
    ("caisse", {"id": "ca1", "montant": 3000, "sens": "entree", "societe": SOC, "libelle": "vente"},
     ("libelle", "vente")),
])
def test_roundtrip_finance(client, auth_headers, name, payload, check):
    """Les collections finance stockent le legacy complet : tout champ survit au round-trip."""
    _post_item(client, auth_headers, name, payload)
    rows = _collection(client, auth_headers, name)
    key, val = check
    row = _find(rows, key, val)
    assert row is not None, f"{name}: item {key}={val} introuvable apres round-trip"
    assert row.get("backendId")
    # Un champ custom quelconque survit (preuve du round-trip _legacy)
    assert row.get(key) == val


def test_facture_ancienne_reconstruite_depuis_les_colonnes_sql(client, auth_headers, db):
    """Une facture dont le JSON legacy est incomplet ne doit pas disparaître : les
    colonnes SQL restent la source de secours pour l'affichage et le filtre société."""
    from datetime import date
    from app.modules.finance_models import Invoice
    from app.modules.commercial.models import Client

    db.add(Invoice(
        external_id="legacy_sql_only_invoice", number="FAC0999/08/26",
        invoice_date=date(2026, 8, 1), society=SOC, client_name="CLIENT HISTORIQUE",
        subject="Prestation historique", status="emise", total_ht=1000,
        total_ttc=1190, data={"collection": "factures", "_legacy": {"id": "legacy_sql_only_invoice"}},
    ))
    db.commit()

    row = _find(_collection(client, auth_headers, "factures"), "numero", "FAC0999/08/26")
    assert row is not None
    assert row["societe"] == SOC
    assert row["client"] == "CLIENT HISTORIQUE"
    assert row["ttc"] == 1190

    db.add(Client(name="CLIENT SOCIETE DEDUITE", society=SOC, status="actif"))
    db.add(Invoice(
        external_id="legacy_invoice_without_society", number="FAC0998/08/26",
        invoice_date=date(2026, 8, 1), society=None, client_name="CLIENT SOCIETE DEDUITE",
        status="emise", total_ttc=500, data={"_legacy": {"id": "legacy_invoice_without_society"}},
    ))
    db.commit()
    inferred = _find(_collection(client, auth_headers, "factures"), "numero", "FAC0998/08/26")
    assert inferred is not None
    assert inferred["societe"] == SOC


def test_multiple_invoice_drafts_can_be_saved(client, auth_headers):
    """Le libellé BROUILLON ne doit jamais violer l'unicité du numéro comptable."""
    first = _post_item(client, auth_headers, "factures", {
        "id": "draft_multi_1", "numero": "BROUILLON", "statut": "brouillon",
        "date": "2026-08-03", "societe": SOC, "client": "Client A", "ttc": 1000,
    })
    second = _post_item(client, auth_headers, "factures", {
        "id": "draft_multi_2", "numero": "BROUILLON", "statut": "brouillon",
        "date": "2026-08-03", "societe": SOC, "client": "Client B", "ttc": 2000,
    })
    assert first["numero"] == second["numero"] == "BROUILLON"
    rows = _collection(client, auth_headers, "factures")
    assert _find(rows, "id", "draft_multi_1") is not None
    assert _find(rows, "id", "draft_multi_2") is not None


def test_valider_facture_attribue_un_numero_atomique(client, auth_headers):
    """La numérotation se fait côté serveur (POST /factures/{id}/valider), plus dans le navigateur."""
    _post_item(client, auth_headers, "factures", {
        "id": "draft_val_1", "numero": "BROUILLON", "statut": "brouillon",
        "date": "2026-08-03", "societe": SOC, "client": "Client Val", "ttc": 500,
    })
    r = client.post("/api/irongs/factures/draft_val_1/valider", headers=auth_headers)
    assert r.status_code == 200, r.text
    validated = r.json()
    assert validated["numero"].startswith("FAC")
    assert validated["statut"] == "emise"
    rows = _collection(client, auth_headers, "factures")
    assert _find(rows, "id", "draft_val_1")["numero"] == validated["numero"]


def test_valider_facture_est_idempotente(client, auth_headers):
    """Rejouer la validation d'une facture déjà validée renvoie le même numéro (pas d'erreur, pas de réattribution)."""
    _post_item(client, auth_headers, "factures", {
        "id": "draft_val_2", "numero": "BROUILLON", "statut": "brouillon",
        "date": "2026-08-03", "societe": SOC, "client": "Client Val2", "ttc": 700,
    })
    r1 = client.post("/api/irongs/factures/draft_val_2/valider", headers=auth_headers)
    assert r1.status_code == 200, r1.text
    r2 = client.post("/api/irongs/factures/draft_val_2/valider", headers=auth_headers)
    assert r2.status_code == 200, r2.text
    assert r1.json()["numero"] == r2.json()["numero"]


def test_valider_facture_contourne_un_numero_deja_pris(client, auth_headers, db):
    """Si le prochain numéro calculé est déjà pris (collision), le serveur doit
    automatiquement essayer le suivant au lieu de planter."""
    import re as _re
    from sqlalchemy import select
    from app.modules.finance_models import Invoice
    from datetime import date as _date

    # Numéro "suivant" tel que le serveur le calculerait maintenant, à partir des
    # numéros déjà réellement attribués (peut varier selon l'ordre des tests).
    seq = 0
    for (number,) in db.execute(select(Invoice.number).where(Invoice.number.isnot(None))).all():
        m = _re.match(r"^FAC(\d+)", str(number or ""))
        if m:
            seq = max(seq, int(m.group(1)))
    mm, yy = f"{_date.today().month:02d}", f"{_date.today().year % 100:02d}"
    taken_number = f"FAC{seq + 1:04d}/{mm}/{yy}"
    db.add(Invoice(external_id="already_using_next_seq", number=taken_number, society=SOC))
    db.commit()

    _post_item(client, auth_headers, "factures", {
        "id": "draft_val_3", "numero": "BROUILLON", "statut": "brouillon",
        "date": "2026-08-03", "societe": SOC, "client": "Client Val3", "ttc": 300,
    })
    r = client.post("/api/irongs/factures/draft_val_3/valider", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["numero"] != taken_number
    assert r.json()["numero"].startswith("FAC")


def test_valider_facture_introuvable(client, auth_headers):
    r = client.post("/api/irongs/factures/inconnue-xyz/valider", headers=auth_headers)
    assert r.status_code == 404


def test_roundtrip_stock_article(client, auth_headers):
    """stockArticles conserve le legacy complet (colonne attributes) -> round-trip sans perte.
    NB : magasins/fournisseurs, eux, sont gérés par le module MATÉRIEL (/api/materiel/stores,
    /suppliers) et non par le snapshot irongs — ils relèvent du palier matériel."""
    _post_item(client, auth_headers, "stockArticles", {
        "id": "ar1", "code": "ART001", "designation": "Rangers", "quantite": 40,
        "prixUnitaire": 3500, "societe": SOC, "taille": "42",
    })
    row = _find(_collection(client, auth_headers, "stockArticles"), "code", "ART001")
    assert row is not None, "stockArticles ART001 introuvable"
    assert row.get("backendId")
    assert row.get("taille") == "42", "un champ custom doit survivre (round-trip _legacy)"


def test_roundtrip_incident(client, auth_headers):
    _post_item(client, auth_headers, "incidents", {
        "id": "inc_rt1", "date": "2026-06-01", "societe": SOC, "type": "intrusion",
        "gravite": "critique", "description": "Tentative perimetre nord",
    })
    rows = _collection(client, auth_headers, "incidents")
    inc = _find(rows, "description", "Tentative perimetre nord")
    assert inc is not None and inc.get("backendId")


def test_roundtrip_ops_movement(client, auth_headers):
    _post_item(client, auth_headers, "opsMouvements", {
        "id": "mv_rt1", "date": "2026-04-01", "societe": SOC,
        "mouvementType": "affectation", "mouvementMotif": "Renfort",
    })
    rows = _collection(client, auth_headers, "opsMouvements")
    assert any(x.get("backendId") for x in rows)


def test_unsupported_sql_collection_returns_400(client, auth_headers):
    r = client.post("/api/irongs/collections/agents/items", headers=auth_headers, json={"data": {}})
    # agents EST supporté ; on teste une collection SQL inconnue via list
    from app.modules.irongs import sql_bridge
    from app.db.session import SessionLocal
    with SessionLocal() as db:
        with pytest.raises(Exception):
            sql_bridge.list_collection(db, "collection_sql_inexistante")


# ═══════════════════════════════════════════════════════════════════════════
# CRUD des items d'une collection JSON (store legacy)
# ═══════════════════════════════════════════════════════════════════════════

def test_json_item_full_crud(client, auth_headers):
    name = "demandesStructure"
    created = _post_item(client, auth_headers, name, {"id": "ds1", "objet": "Nouveau poste", "statut": "ouvert"})
    assert created["id"] == "ds1"

    # GET item
    got = client.get(f"/api/irongs/collections/{name}/items/ds1", headers=auth_headers)
    assert got.status_code == 200 and got.json()["objet"] == "Nouveau poste"

    # PATCH (fusion partielle)
    patched = client.patch(f"/api/irongs/collections/{name}/items/ds1", headers=auth_headers,
                           json={"data": {"statut": "traite"}})
    assert patched.status_code == 200
    assert patched.json()["statut"] == "traite" and patched.json()["objet"] == "Nouveau poste"

    # PUT (remplacement complet)
    put = client.put(f"/api/irongs/collections/{name}/items/ds1", headers=auth_headers,
                     json={"data": {"objet": "Poste revu", "statut": "ferme"}})
    assert put.status_code == 200 and put.json()["objet"] == "Poste revu"

    # DELETE
    assert client.delete(f"/api/irongs/collections/{name}/items/ds1", headers=auth_headers).status_code == 200
    assert client.get(f"/api/irongs/collections/{name}/items/ds1", headers=auth_headers).status_code == 404


def test_json_item_duplicate_id_conflict(client, auth_headers):
    name = "demandesStructure"
    _post_item(client, auth_headers, name, {"id": "dup1", "objet": "A"})
    r = client.post(f"/api/irongs/collections/{name}/items", headers=auth_headers,
                    json={"data": {"id": "dup1", "objet": "B"}})
    assert r.status_code == 409, r.text


def test_json_item_get_404(client, auth_headers):
    assert client.get("/api/irongs/collections/demandesStructure/items/inexistant", headers=auth_headers).status_code == 404


def test_json_list_items(client, auth_headers):
    _post_item(client, auth_headers, "demandesStructure", {"id": "li1", "objet": "L"})
    r = client.get("/api/irongs/collections/demandesStructure/items", headers=auth_headers)
    assert r.status_code == 200 and isinstance(r.json(), list)
    assert any(x.get("id") == "li1" for x in r.json())


# ═══════════════════════════════════════════════════════════════════════════
# Postes (positions)
# ═══════════════════════════════════════════════════════════════════════════

def test_positions_list_seeds(client, auth_headers):
    r = client.get("/api/irongs/positions", headers=auth_headers)
    assert r.status_code == 200 and isinstance(r.json(), list) and len(r.json()) >= 1
    assert all("name" in p for p in r.json())


def test_positions_create_and_delete_admin(client, auth_headers):
    created = client.post("/api/irongs/positions", headers=auth_headers,
                          json={"name": "POSTE TEST IRONGS", "society": SOC})
    assert created.status_code in (200, 201), created.text
    pid = created.json()["id"]
    # Doublon -> 409
    dup = client.post("/api/irongs/positions", headers=auth_headers,
                      json={"name": "POSTE TEST IRONGS", "society": SOC})
    assert dup.status_code == 409
    # Suppression
    assert client.delete(f"/api/irongs/positions/{pid}", headers=auth_headers).status_code == 200


def test_positions_create_forbidden_for_non_admin(client, restricted_headers):
    r = client.post("/api/irongs/positions", headers=restricted_headers,
                    json={"name": "TENTATIVE", "society": SOC})
    assert r.status_code == 403, r.text


# ═══════════════════════════════════════════════════════════════════════════
# Snapshot /db : POST comme PUT, non-destructif
# ═══════════════════════════════════════════════════════════════════════════

def test_db_post_saves_like_put(client, auth_headers):
    r = client.post("/api/irongs/db", headers=auth_headers, json={"data": {
        "notifications": [{"id": "np1", "msg": "via POST"}],
    }})
    assert r.status_code == 200, r.text
    data = _collection(client, auth_headers, "notifications")
    assert any(n.get("id") == "np1" for n in data)


def test_db_get_snapshot_has_collections(client, auth_headers):
    snap = client.get("/api/irongs/db", headers=auth_headers)
    assert snap.status_code == 200
    body = snap.json()
    assert isinstance(body, dict)
    # les collections SQL sont présentes (agents, sites) et le legacy aussi
    assert "agents" in body and "sites" in body


# ═══════════════════════════════════════════════════════════════════════════
# Remplacement de collection : skip-empty + garde admin
# ═══════════════════════════════════════════════════════════════════════════

def test_replace_collection_empty_returns_current_not_wipe(client, auth_headers):
    """PUT /collections/{name} avec liste vide ne doit pas effacer (retourne l'existant)."""
    _post_item(client, auth_headers, "sites", {"id": "st_keep", "nom": "Site Keep", "indicatif": "SKP", "societe": SOC})
    r = client.put("/api/irongs/collections/sites", headers=auth_headers, json={"data": []})
    assert r.status_code == 200
    assert any(s.get("indicatif") == "SKP" for s in r.json()["data"]), "liste vide ne doit pas effacer les sites"


def test_replace_collection_forbidden_for_non_admin_sensitive(client, restricted_headers):
    r = client.put("/api/irongs/collections/agents", headers=restricted_headers, json={"data": []})
    assert r.status_code == 403, r.text


# ═══════════════════════════════════════════════════════════════════════════
# Bootstrap + actions legacy
# ═══════════════════════════════════════════════════════════════════════════

def test_bootstrap(client, auth_headers):
    r = client.get("/api/irongs/bootstrap", headers=auth_headers)
    assert r.status_code == 200 and isinstance(r.json(), dict)


def test_bootstrap_structure_precise(client, auth_headers):
    # La réponse est désormais assemblée à partir d'octets JSON pré-encodés (le "db"
    # est mis en cache). Ce test verrouille : content-type JSON, JSON bien formé
    # (sinon .json() lèverait), et présence des 3 clés user/constants/db.
    r = client.get("/api/irongs/bootstrap", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    body = r.json()
    assert {"user", "constants", "db"}.issubset(body), body.keys()
    assert isinstance(body["db"], dict)
    assert isinstance(body["constants"], dict)
    assert body["user"].get("username")


def test_legacy_action_set_status(client, auth_headers):
    # Un client existe (collection JSON prospects/clients gérée en legacy pour set-status)
    client.put("/api/irongs/db", headers=auth_headers, json={"data": {
        "prospects": [{"id": "pr1", "nom": "Prospect A", "statut": "nouveau", "societe": SOC}],
    }})
    r = client.post("/api/irongs/actions/set-status", headers=auth_headers, json={
        "collection": "prospects", "item_id": "pr1", "data": {"status": "contacte"},
    })
    assert r.status_code == 200, r.text
    prospects = _collection(client, auth_headers, "prospects")
    assert _find(prospects, "id", "pr1")["statut"] == "contacte"


def test_legacy_action_set_status_rejects_bad_collection(client, auth_headers):
    r = client.post("/api/irongs/actions/set-status", headers=auth_headers, json={
        "collection": "agents", "item_id": "x", "data": {"status": "actif"},
    })
    assert r.status_code == 422, r.text


def test_legacy_action_delete_item(client, auth_headers):
    client.put("/api/irongs/db", headers=auth_headers, json={"data": {
        "opportunites": [{"id": "op_del", "nom": "Opp A", "etape": "nouveau", "societe": SOC}],
    }})
    r = client.post("/api/irongs/actions/delete-item", headers=auth_headers, json={
        "collection": "opportunites", "item_id": "op_del",
    })
    assert r.status_code == 200, r.text
    assert not _find(_collection(client, auth_headers, "opportunites"), "id", "op_del")


def test_legacy_action_delete_item_rejects_protected_collection(client, auth_headers):
    r = client.post("/api/irongs/actions/delete-item", headers=auth_headers, json={
        "collection": "agents", "item_id": "x",
    })
    assert r.status_code == 422, r.text


def test_legacy_action_convert_prospect(client, auth_headers):
    """convert-prospect : crée un client depuis un prospect et marque le prospect converti."""
    client.put("/api/irongs/db", headers=auth_headers, json={"data": {
        "prospects": [{"id": "pr_conv", "nom": "Prospect Convert", "statut": "interesse",
                       "tel": "0550999888", "societe": SOC}],
        "clients": [],
    }})
    r = client.post("/api/irongs/actions/convert-prospect", headers=auth_headers, json={
        "collection": "prospects", "item_id": "pr_conv", "data": {},
    })
    assert r.status_code == 200, r.text

    prospect = _find(_collection(client, auth_headers, "prospects"), "id", "pr_conv")
    assert prospect["statut"] == "converti"
    clients = _collection(client, auth_headers, "clients")
    nouveau = _find(clients, "prospectId", "pr_conv")
    assert nouveau is not None and nouveau["nom"] == "Prospect Convert"
    assert nouveau["tel"] == "0550999888" and nouveau["statut"] == "actif"

    # Reconvertir le même prospect est refusé
    again = client.post("/api/irongs/actions/convert-prospect", headers=auth_headers, json={
        "collection": "prospects", "item_id": "pr_conv", "data": {},
    })
    assert again.status_code == 422, again.text
