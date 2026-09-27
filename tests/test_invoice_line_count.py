"""Facturation — colonne NBR : total ligne = NBR × QUANTITÉ × PRIX UNITAIRE, calcul serveur
autoritaire, factures historiques inchangées, snapshot des factures validées."""
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.finance_models import Invoice
from app.modules.irongs.invoice_lines import compute_invoice
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"


def _line(designation="MAGASINIER", **kw):
    base = {"type": "article", "designation": designation, "unite": "Jour", "qte": 25, "prixUnitHT": 3070.32, "tva": 19}
    base.update(kw)
    return base


def _ht(invoice):
    return Decimal(str(compute_invoice(invoice)["totalHT"]))


# ── Calcul canonique ─────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("nbr, qte, pu, expected", [
    (30, 25, "3070.32", "2302740.00"),      # CAS A — 30 magasiniers × 25 jours × 3 070,32
    (2, 30, "5000", "300000.00"),           # CAS B — véhicules
    (5, 1, "20000", "100000.00"),           # CAS C — équipements
    (1, 1, "150000", "150000.00"),          # CAS D — prestation unique
    (1, 4, "3070.32", "12281.28"),          # NBR par défaut
    (1, "2.5", "1000.33", "2500.83"),       # arrondi au centime, demi vers le haut (2500,825)
    (1000, 30, "999999.99", "29999999700.00"),  # grands montants
])
def test_line_total_is_nbr_times_quantity_times_price(nbr, qte, pu, expected):
    out = compute_invoice({"lignes": [_line(nbr=nbr, qte=qte, prixUnitHT=pu)]})
    assert Decimal(str(out["lignes"][0]["totalHT"])) == Decimal(expected)
    assert Decimal(str(out["totalHT"])) == Decimal(expected)


def test_totals_vat_and_ttc_follow_the_existing_rules():
    out = compute_invoice({"lignes": [_line(nbr=30)]})
    assert (out["totalHT"], out["tvaAmt"], out["ttc"]) == (2302740.0, 437520.6, 2740260.6)
    assert out["montantHT"] == out["totalHT"] and out["montantTTC"] == out["ttc"]


def test_discounts_and_subtotals_apply_after_nbr():
    lines = [_line(nbr=2, qte=10, prixUnitHT=100), {"type": "remise", "remisePct": 10}, {"type": "soustotal"},
             _line(nbr=1, qte=1, prixUnitHT=500), {"type": "commentaire", "designation": "note"}]
    out = compute_invoice({"lignes": lines})
    assert [l.get("totalHT") for l in out["lignes"]] == [2000.0, -200.0, None, 500.0, None]
    assert out["totalHT"] == 2300.0


def test_historical_line_without_nbr_keeps_its_amount():
    """Toutes les factures antérieures : pas de NBR ⇒ NBR = 1 ⇒ Q × PU, strictement identique."""
    legacy = {"lignes": [{"type": "article", "designation": "MAGASINIER", "unite": "Mois", "qte": 25,
                          "prixUnitHT": 92109.6, "tva": 19}]}
    out = compute_invoice(legacy)
    assert out["lignes"][0]["nbr"] == 1
    assert out["totalHT"] == 2302740.0          # 92 109,60 × 25 — jamais multiplié une seconde fois par 30


def test_browser_totals_are_never_trusted():
    out = compute_invoice({"lignes": [_line(nbr=30, totalHT=1)], "totalHT": 1, "ttc": 1, "tvaAmt": 0})
    assert out["totalHT"] == 2302740.0 and out["lignes"][0]["totalHT"] == 2302740.0


@pytest.mark.parametrize("nbr", [-1, "abc", "NaN", "Infinity", "-Infinity", 2.5, "1e9", True])
def test_invalid_nbr_is_refused(nbr):
    with pytest.raises(HTTPException) as exc:
        compute_invoice({"lignes": [_line(nbr=nbr)]})
    assert exc.value.status_code == 422


@pytest.mark.parametrize("field, value", [("qte", -1), ("prixUnitHT", "-5"), ("qte", "NaN"), ("prixUnitHT", "x")])
def test_invalid_quantity_or_price_is_refused(field, value):
    with pytest.raises(HTTPException):
        compute_invoice({"lignes": [_line(**{field: value})]})


def test_zero_nbr_is_a_draft_value_but_blocks_validation():
    assert compute_invoice({"lignes": [_line(nbr=0)]})["totalHT"] == 0.0
    with pytest.raises(HTTPException) as exc:
        compute_invoice({"lignes": [_line(nbr=0)]}, for_validation=True)
    assert "NBR" in exc.value.detail
    with pytest.raises(HTTPException):
        compute_invoice({"lignes": [_line(qte=0)]}, for_validation=True)


def test_header_only_invoice_keeps_provided_totals():
    """Import Excel (en-tête seul, sans lignes) : aucun détail à recalculer."""
    imported = {"lignes": [], "totalHT": 1000.0, "ttc": 1190.0, "sourceImport": "excel"}
    assert compute_invoice(imported) == imported


# ── API : brouillon, réouverture, modification, validation ──────────────────────────────
def _save(client, h, data, *, create=True):
    url = "/api/irongs/collections/factures/items" + ("" if create else f"/{data['id']}")
    return client.request("POST" if create else "PUT", url, headers=h, json={"data": data})


def _draft(**kw):
    data = {"id": f"fc_nbr_{uuid.uuid4().hex[:8]}", "numero": "BROUILLON", "statut": "brouillon", "societe": SOC,
            "client": "CLIENT NBR", "date": "2026-09-28", "lignes": [_line(nbr=30)], "totalHT": 1, "ttc": 1}
    data.update(kw)
    return data


def _get(client, h, item_id):
    return client.get(f"/api/irongs/collections/factures/items/{item_id}", headers=h).json()


def test_draft_is_recalculated_by_the_server_saved_and_reopened(client, auth_headers, db):
    data = _draft()
    r = _save(client, auth_headers, data)
    assert r.status_code == 200, r.text
    reopened = _get(client, auth_headers, data["id"])
    assert reopened["lignes"][0]["nbr"] == 30
    assert (reopened["totalHT"], reopened["tvaAmt"], reopened["ttc"]) == (2302740.0, 437520.6, 2740260.6)
    row = db.query(Invoice).filter(Invoice.external_id == data["id"]).one()
    assert (row.total_ht, row.total_ttc) == (2302740.0, 2740260.6)
    # Modification du NBR (31) : ligne et totaux recalculés côté serveur.
    reopened["lignes"][0]["nbr"] = 31
    assert _save(client, auth_headers, reopened, create=False).status_code == 200
    again = _get(client, auth_headers, data["id"])
    assert again["lignes"][0]["totalHT"] == 2379498.0 and again["totalHT"] == 2379498.0


def test_invalid_nbr_is_refused_by_the_api(client, auth_headers):
    for bad in (-3, "trente", 1.5):
        r = _save(client, auth_headers, _draft(lignes=[_line(nbr=bad)]))
        assert r.status_code == 422, (bad, r.text)


def test_validation_recalculates_refuses_incoherent_lines_and_freezes_the_snapshot(client, auth_headers, db):
    bad = _draft(lignes=[_line(nbr=0)])
    assert _save(client, auth_headers, bad).status_code == 200            # brouillon : accepté
    assert client.post(f"/api/irongs/factures/{bad['id']}/valider", headers=auth_headers).status_code == 422

    data = _draft()
    _save(client, auth_headers, data)
    r = client.post(f"/api/irongs/factures/{data['id']}/valider", headers=auth_headers)
    assert r.status_code == 200, r.text
    validated = r.json()
    assert validated["statut"] == "emise" and validated["numero"] != "BROUILLON"
    assert validated["lignes"][0]["nbr"] == 30 and validated["totalHT"] == 2302740.0
    # Après validation : un enregistrement ne change ni les lignes, ni les montants, ni le
    # numéro, et ne repasse jamais la facture en brouillon.
    tampered = {**validated, "lignes": [_line(nbr=99)], "totalHT": 5, "ttc": 5, "numero": "BROUILLON", "statut": "brouillon",
                "remarque": "commentaire ajouté après émission"}
    assert _save(client, auth_headers, tampered, create=False).status_code == 200
    after = _get(client, auth_headers, data["id"])
    assert after["lignes"][0]["nbr"] == 30 and after["totalHT"] == 2302740.0
    assert after["numero"] == validated["numero"] and after["statut"] == "emise"
    assert after["remarque"] == "commentaire ajouté après émission"
    row = db.query(Invoice).filter(Invoice.external_id == data["id"]).one()
    assert row.total_ht == 2302740.0 and row.number == validated["numero"]


def test_historical_invoices_keep_exactly_their_amounts(client, auth_headers, db):
    """Fixtures « avant NBR » posées directement en base : lecture, ré-enregistrement d'une
    facture émise et validation d'un ancien brouillon — montant X avant, X après."""
    cases = [("emise", 25, 92109.6, 2302740.0, 2740260.6), ("brouillon", 4, 3070.32, 12281.28, 14614.72)]
    for status, qte, pu, ht, ttc in cases:
        ext = f"fc_hist_{uuid.uuid4().hex[:8]}"
        legacy = {"id": ext, "numero": f"F-HIST-{ext[-4:]}" if status == "emise" else "BROUILLON", "statut": status, "societe": SOC,
                  "client": "HISTORIQUE", "lignes": [{"type": "article", "designation": "MAGASINIER", "unite": "Mois", "qte": qte,
                                                      "prixUnitHT": pu, "tva": 19, "totalHT": ht}],
                  "totalHT": ht, "montantHT": ht, "tvaAmt": round(ttc - ht, 2), "ttc": ttc, "montantTTC": ttc}
        db.add(Invoice(external_id=ext, number=legacy["numero"] if status == "emise" else None, society=SOC, client_name="HISTORIQUE",
                       status=status, total_ht=ht, total_ttc=ttc, data={"_legacy": legacy, "collection": "factures"}))
        db.commit()
        before = _get(client, auth_headers, ext)
        assert (before["totalHT"], before["ttc"]) == (ht, ttc) and "nbr" not in before["lignes"][0]
        _save(client, auth_headers, before, create=False)
        if status == "brouillon":
            assert client.post(f"/api/irongs/factures/{ext}/valider", headers=auth_headers).status_code == 200
        after = _get(client, auth_headers, ext)
        assert (after["totalHT"], after["ttc"]) == (ht, ttc), status
        row = db.query(Invoice).filter(Invoice.external_id == ext).one()
        assert (row.total_ht, row.total_ttc) == (ht, ttc)


# ── RBAC / multi-société : NBR ne contourne aucune règle existante ──────────────────────
def _user(client, db, *, modules, societies):
    name = f"nbr{uuid.uuid4().hex[:6]}"
    db.add(User(username=name, full_name=name, role="ops", access_level="H3", authorized_societies=societies, authorized_sites=[],
                authorized_structures=[], authorized_modules=modules, password_hash=hash_password("nbrpass123"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "nbrpass123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_rbac_and_society_rules_still_apply(client, auth_headers, db):
    data = _draft()
    _save(client, auth_headers, data)
    other_module = _user(client, db, modules=["site_workforce"], societies=[SOC])
    assert _save(client, other_module, {**data, "lignes": [_line(nbr=500)]}, create=False).status_code == 403
    other_society = _user(client, db, modules=["finances"], societies=["Sword Corporation"])
    assert _save(client, other_society, {**data, "lignes": [_line(nbr=500)]}, create=False).status_code in (403, 404)
    assert _get(client, auth_headers, data["id"])["lignes"][0]["nbr"] == 30


def test_duplicate_keeps_nbr(client, auth_headers):
    """La duplication (frontend) recopie les lignes telles quelles : NBR est conservé et
    recalculé par le serveur à l'enregistrement de la copie."""
    source = _draft()
    _save(client, auth_headers, source)
    saved = _get(client, auth_headers, source["id"])
    copy = {**saved, "id": f"fc_copy_{uuid.uuid4().hex[:8]}", "numero": "BROUILLON", "statut": "brouillon"}
    copy.pop("backendId", None)
    assert _save(client, auth_headers, copy).status_code == 200
    assert _get(client, auth_headers, copy["id"])["lignes"][0]["nbr"] == 30
