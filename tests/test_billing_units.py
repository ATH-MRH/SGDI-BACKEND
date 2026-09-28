"""Unité tarifaire par prestation (Commercial → Facturation).

Chaque prestation du catalogue client porte désignation + prix unitaire + unité tarifaire
(Heure / Jour / Mois / Forfait). Une ancienne prestation sans unité reste « à définir » :
jamais convertie ni supposée. La ligne de facture issue d'une prestation reçoit l'unité et
le prix contractuels (snapshot) ; un payload forgé ne peut pas les changer ; une facture
émise ne bouge plus, même si Commercial change ensuite."""
import uuid

import pytest
from fastapi import HTTPException

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.commercial.billing_units import BILLING_UNITS, normalize_billing_unit, validate_catalog
from app.modules.commercial.models import Client
from app.modules.finance_models import Invoice
from app.modules.irongs.invoice_lines import compute_invoice
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"


# ── Représentation canonique ────────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw, expected", [
    ("Heure", "Heure"), ("heure", "Heure"), ("H", "Heure"), ("hr", "Heure"), ("heures", "Heure"),
    ("Jour", "Jour"), ("jour", "Jour"), ("J", "Jour"), ("jours", "Jour"),
    ("Mois", "Mois"), ("mois", "Mois"),
    ("Forfait", "Forfait"), ("forfait", "Forfait"), ("forfaitaire", "Forfait"),
    ("", None), (None, None), ("  ", None),
])
def test_canonical_units(raw, expected):
    assert normalize_billing_unit(raw) == expected


@pytest.mark.parametrize("raw", ["Semaine", "kg", "30", "Mois/Jour"])
def test_unknown_unit_is_refused(raw):
    with pytest.raises(HTTPException) as exc:
        normalize_billing_unit(raw)
    assert exc.value.status_code == 422


def test_supported_units():
    assert BILLING_UNITS == ("Heure", "Jour", "Mois", "Forfait")


def test_new_priced_prestation_requires_a_unit_but_legacy_lines_are_kept():
    legacy = [{"designation": "MAGASINIER", "prixUnitaire": 92109.6}]
    # Ancienne prestation inchangée, sans unité : conservée telle quelle (« à définir »).
    assert validate_catalog(legacy, legacy) == legacy
    # Nouvelle prestation tarifée sans unité : refusée.
    with pytest.raises(HTTPException) as exc:
        validate_catalog(legacy + [{"designation": "AGENT", "prixUnitaire": 3070.32}], legacy)
    assert exc.value.status_code == 422
    # Prix d'une ancienne prestation modifié sans unité : refusé aussi.
    with pytest.raises(HTTPException):
        validate_catalog([{"designation": "MAGASINIER", "prixUnitaire": 90000}], legacy)
    # Unité normalisée, prix JAMAIS converti.
    out = validate_catalog([{"designation": "MAGASINIER", "prixUnitaire": 92109.6, "unite": "mois"}], legacy)
    assert out == [{"designation": "MAGASINIER", "prixUnitaire": 92109.6, "unite": "Mois"}]
    # Ligne sans prix (brouillon de saisie) : pas d'unité exigée.
    assert validate_catalog([{"designation": "CHEF", "prixUnitaire": 0}], []) == [{"designation": "CHEF", "prixUnitaire": 0}]


# ── API Commercial ─────────────────────────────────────────────────────────────────────
def _catalog():
    return [{"designation": "AGENT HEURE", "prixUnitaire": 550, "unite": "Heure"},
            {"designation": "AGENT JOUR", "prixUnitaire": 3070.32, "unite": "Jour"},
            {"designation": "MAGASINIER", "prixUnitaire": 92109.6, "unite": "Mois"},
            {"designation": "MAINTENANCE", "prixUnitaire": 25000, "unite": "Forfait"}]


def _create_client(client, h, catalog, sites=None):
    name = f"CLIENT-UNITE-{uuid.uuid4().hex[:5]}"
    r = client.post("/api/commercial/clients", headers=h, json={"name": name, "society": SOC, "data": {
        "nom": name, "societe": SOC, "lignesFacturation": catalog, "tech_sites": sites or []}})
    return r


def test_commercial_api_requires_units_for_new_prestations(client, auth_headers):
    assert _create_client(client, auth_headers, [{"designation": "AGENT", "prixUnitaire": 3070.32}]).status_code == 422
    assert _create_client(client, auth_headers, [{"designation": "AGENT", "prixUnitaire": 3070.32, "unite": "Semaine"}]).status_code == 422
    r = _create_client(client, auth_headers, _catalog())
    assert r.status_code == 200, r.text
    assert [l["unite"] for l in r.json()["data"]["lignesFacturation"]] == ["Heure", "Jour", "Mois", "Forfait"]


def test_commercial_api_keeps_legacy_unitless_prestations(client, auth_headers, db):
    row = Client(name=f"ANCIEN-{uuid.uuid4().hex[:5]}", society=SOC, status="actif",
                 data={"lignesFacturation": [{"designation": "MAGASINIER", "prixUnitaire": 92109.6}]})
    db.add(row)
    db.commit()
    # Modification d'un autre champ : l'ancienne prestation sans unité reste acceptée, intacte.
    r = client.put(f"/api/commercial/clients/{row.id}", headers=auth_headers, json={"phone": "0550", "data": {
        **row.data, "tel": "0550"}})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["lignesFacturation"] == [{"designation": "MAGASINIER", "prixUnitaire": 92109.6}]
    # Ajout d'une nouvelle prestation sans unité : refusé.
    r = client.put(f"/api/commercial/clients/{row.id}", headers=auth_headers, json={"data": {
        **row.data, "lignesFacturation": row.data["lignesFacturation"] + [{"designation": "AGENT", "prixUnitaire": 1}]}})
    assert r.status_code == 422
    # Unité définie ensuite : acceptée, prix inchangé.
    r = client.put(f"/api/commercial/clients/{row.id}", headers=auth_headers, json={"data": {
        **row.data, "lignesFacturation": [{"designation": "MAGASINIER", "prixUnitaire": 92109.6, "unite": "Mois"}]}})
    assert r.status_code == 200 and r.json()["data"]["lignesFacturation"][0] == {"designation": "MAGASINIER", "prixUnitaire": 92109.6, "unite": "Mois"}


def test_legacy_collection_path_applies_the_same_rule(client, auth_headers):
    r = client.post("/api/irongs/collections/clients/items", headers=auth_headers, json={"data": {
        "nom": f"LEG-{uuid.uuid4().hex[:5]}", "societe": SOC, "lignesFacturation": [{"designation": "AGENT", "prixUnitaire": 10}]}})
    assert r.status_code == 422


def _user(client, db, modules, actions):
    name = f"unit{uuid.uuid4().hex[:6]}"
    db.add(User(username=name, full_name=name, role="ops", access_level="H3", authorized_societies=[SOC], authorized_sites=[],
                authorized_structures=[], authorized_modules=modules, authorized_actions=actions,
                password_hash=hash_password("unitpass123"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "unitpass123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_only_commercial_writers_can_change_units(client, auth_headers, db):
    created = _create_client(client, auth_headers, _catalog()).json()
    body = {"data": {**created["data"], "lignesFacturation": [{**_catalog()[2], "unite": "Jour"}]}}
    fac = _user(client, db, ["fac"], ["read", "create", "update", "validate"])
    assert client.put(f"/api/commercial/clients/{created['id']}", headers=fac, json=body).status_code == 403
    reader = _user(client, db, ["dc"], ["read"])
    assert client.put(f"/api/commercial/clients/{created['id']}", headers=reader, json=body).status_code == 403


# ── Facturation : snapshot contractuel ──────────────────────────────────────────────────
def _key(cl, path):
    import json
    return json.dumps([str(cl["data"].get("id") or cl["id"]), path])


def _line(cl, path, designation, **kw):
    line = {"type": "article", "designation": designation, "unite": "Mois", "nbr": 1, "qte": 1, "prixUnitHT": 1, "tva": 19,
            "catalogKey": _key(cl, path), "qteAuto": False}
    line.update(kw)
    return line


def _save(client, h, data, *, create=True):
    url = "/api/irongs/collections/factures/items" + ("" if create else f"/{data['id']}")
    return client.request("POST" if create else "PUT", url, headers=h, json={"data": data})


def _get(client, h, item_id):
    return client.get(f"/api/irongs/collections/factures/items/{item_id}", headers=h).json()


def _invoice(lines, **kw):
    data = {"id": f"fc_unit_{uuid.uuid4().hex[:8]}", "numero": "BROUILLON", "statut": "brouillon", "societe": SOC,
            "client": "CLIENT UNITE", "date": "2026-09-28", "periodeDebut": "2026-09-01", "periodeFin": "2026-09-25", "lignes": lines}
    data.update(kw)
    return data


def _multi_client(client, h):
    sites = [{"nom": "Site A", "lignesFacturation": [{"designation": "AGENT HEURE", "qte": 10}, {"designation": "AGENT JOUR", "qte": 30},
                                                     {"designation": "MAGASINIER", "qte": 25}, {"designation": "MAINTENANCE", "qte": 1}]}]
    r = _create_client(client, h, _catalog(), sites)
    assert r.status_code == 200, r.text
    return r.json()


def test_multi_unit_contract_each_line_keeps_its_unit_and_amounts(client, auth_headers):
    cl = _multi_client(client, auth_headers)
    # Le navigateur envoie volontairement de mauvaises unités / prix : le contrat fait foi.
    lines = [_line(cl, "site:0:0", "AGENT HEURE", nbr=10, qte=160, unite="Jour", prixUnitHT=1),        # CAS A
             _line(cl, "site:0:1", "AGENT JOUR", nbr=30, qteAuto=True, qte=999),                        # CAS B
             _line(cl, "site:0:2", "MAGASINIER", nbr=25, qteAuto=False, qte=1, unite="Jour"),           # CAS C
             _line(cl, "site:0:3", "MAINTENANCE", nbr=1, qteAuto=False, qte=7)]                         # CAS D
    data = _invoice(lines)
    assert _save(client, auth_headers, data).status_code == 200
    saved = _get(client, auth_headers, data["id"])
    got = [(l["unite"], l["uniteContrat"], l["prixUnitHT"], l["nbr"], l["qte"], l["totalHT"]) for l in saved["lignes"]]
    assert got == [("Heure", "Heure", 550.0, 10, 160.0, 880000.0),
                   ("Jour", "Jour", 3070.32, 30, 25.0, 2302740.0),
                   ("Mois", "Mois", 92109.6, 25, 1.0, 2302740.0),
                   ("Forfait", "Forfait", 25000.0, 1, 1.0, 25000.0)]
    # Changement de période : Jour suit, Heure (manuelle) ne bouge pas, Forfait reste 1.
    saved["periodeFin"] = "2026-09-30"
    _save(client, auth_headers, saved, create=False)
    again = _get(client, auth_headers, data["id"])
    assert [l["qte"] for l in again["lignes"]] == [160.0, 30.0, 1.0, 1.0]


def test_hour_line_is_never_derived_from_dates(client, auth_headers):
    cl = _multi_client(client, auth_headers)
    data = _invoice([_line(cl, "site:0:0", "AGENT HEURE", nbr=10, qte=160, qteAuto=True)])
    _save(client, auth_headers, data)
    line = _get(client, auth_headers, data["id"])["lignes"][0]
    assert (line["qte"], line["qteAuto"], line["totalHT"]) == (160.0, False, 880000.0)


def test_legacy_prestation_without_unit_blocks_validation(client, auth_headers, db):
    row = Client(name=f"ANCIEN-{uuid.uuid4().hex[:5]}", society=SOC, status="actif",
                 data={"lignesFacturation": [{"designation": "MAGASINIER", "prixUnitaire": 92109.6}],
                       "tech_sites": [{"nom": "S", "lignesFacturation": [{"designation": "MAGASINIER", "qte": 25}]}]})
    db.add(row)
    db.commit()
    cl = {"id": row.id, "data": row.data}
    data = _invoice([_line(cl, "site:0:0", "MAGASINIER", nbr=25, qte=1, unite="Mois", prixUnitHT=92109.6)])
    assert _save(client, auth_headers, data).status_code == 200            # brouillon : accepté
    saved = _get(client, auth_headers, data["id"])
    # Aucune unité inventée (« Mois » envoyé par le navigateur ignoré), prix non converti.
    assert (saved["lignes"][0]["unite"], saved["lignes"][0]["uniteContrat"], saved["lignes"][0]["prixUnitHT"]) == ("", None, 92109.6)
    r = client.post(f"/api/irongs/factures/{data['id']}/valider", headers=auth_headers)
    assert r.status_code == 422, r.text
    assert db.query(Invoice).filter(Invoice.external_id == data["id"]).one().status == "brouillon"
    # Unité définie ensuite dans Commercial : la ligne (sans snapshot d'unité) la reprend.
    row.data = {**row.data, "lignesFacturation": [{"designation": "MAGASINIER", "prixUnitaire": 92109.6, "unite": "Mois"}]}
    db.commit()
    _save(client, auth_headers, saved, create=False)
    assert _get(client, auth_headers, data["id"])["lignes"][0]["unite"] == "Mois"


def test_snapshot_survives_commercial_changes_and_issued_invoice_is_frozen(client, auth_headers, db):
    cl = _multi_client(client, auth_headers)
    data = _invoice([_line(cl, "site:0:2", "MAGASINIER", nbr=25, qte=1)], periodeFin="2026-09-30")
    _save(client, auth_headers, data)
    # CAS G : Commercial change prix et unité APRÈS matérialisation de la ligne.
    row = db.get(Client, cl["id"])
    row.data = {**row.data, "lignesFacturation": [{**l, "prixUnitaire": 1000, "unite": "Jour"} if l["designation"] == "MAGASINIER" else l
                                                  for l in row.data["lignesFacturation"]]}
    db.commit()
    draft = _get(client, auth_headers, data["id"])
    _save(client, auth_headers, draft, create=False)
    line = _get(client, auth_headers, data["id"])["lignes"][0]
    assert (line["unite"], line["prixUnitHT"], line["totalHT"]) == ("Mois", 92109.6, 2302740.0)
    # CAS H : payload forgé Mois → Jour (et prix / snapshot falsifiés) : refusé silencieusement.
    forged = {**draft, "lignes": [{**draft["lignes"][0], "unite": "Jour", "uniteContrat": "Jour", "prixUnitHT": 3070.32,
                                   "prixContrat": 3070.32, "qteAuto": True}]}
    _save(client, auth_headers, forged, create=False)
    line = _get(client, auth_headers, data["id"])["lignes"][0]
    assert (line["unite"], line["prixUnitHT"], line["qte"], line["totalHT"]) == ("Mois", 92109.6, 1.0, 2302740.0)
    # Émission puis nouvelle modification Commercial : la facture émise ne bouge plus.
    issued = client.post(f"/api/irongs/factures/{data['id']}/valider", headers=auth_headers).json()
    assert (issued["statut"], issued["totalHT"], issued["ttc"]) == ("emise", 2302740.0, 2740260.6)
    row.data = {**row.data, "lignesFacturation": []}
    db.commit()
    _save(client, auth_headers, {**issued, "lignes": [{**issued["lignes"][0], "unite": "Heure", "nbr": 99}]}, create=False)
    after = _get(client, auth_headers, data["id"])
    frozen = after["lignes"][0]
    assert (frozen["designation"], frozen["nbr"], frozen["unite"], frozen["qte"], frozen["prixUnitHT"]) == ("MAGASINIER", 25, "Mois", 1.0, 92109.6)
    assert (after["periodeDebut"], after["periodeFin"], after["totalHT"], after["tvaAmt"], after["ttc"], after["numero"], after["statut"]) == \
        ("2026-09-01", "2026-09-30", 2302740.0, 437520.6, 2740260.6, issued["numero"], "emise")


def test_validation_refuses_unknown_units():
    inv = {"periodeDebut": "2026-09-01", "periodeFin": "2026-09-30",
           "lignes": [{"type": "article", "designation": "X", "unite": "Semaine", "nbr": 1, "qte": 1, "prixUnitHT": 10}]}
    with pytest.raises(HTTPException) as exc:
        compute_invoice(inv, for_validation=True)
    assert exc.value.status_code == 422
    inv["lignes"][0]["unite"] = "jour"
    assert compute_invoice(inv, for_validation=True)["lignes"][0]["unite"] == "Jour"
