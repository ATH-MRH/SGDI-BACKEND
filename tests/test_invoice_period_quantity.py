"""Facturation — quantité dérivée de la période pour les lignes issues du contrat.

Ligne « automatique » (qteAuto) : la quantité est recalculée PAR LE SERVEUR depuis la période
de la facture et l'unité — Jour = jours calendaires (bornes incluses), Mois = mois calendaires
entiers (sinon non déterminée : 0, validation refusée), Forfait = 1, autres unités = saisie.
Ligne « manuelle » : la quantité saisie est conservée, quelle que soit la période.
Facture émise : lignes, montants ET période figés."""
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.finance_models import Invoice
from app.modules.irongs.invoice_lines import compute_invoice, period_quantity
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"


def _auto(unite="Jour", **kw):
    line = {"type": "article", "designation": "MAGASINIER", "unite": unite, "nbr": 30, "qte": 999, "prixUnitHT": 3070.32,
            "tva": 19, "catalogKey": '["c","site:0:0"]', "qteAuto": True}
    line.update(kw)
    return line


def _inv(start, end, *lines):
    return {"periodeDebut": start, "periodeFin": end, "lignes": list(lines)}


@pytest.mark.parametrize("unite, start, end, expected", [
    ("Jour", "2026-09-01", "2026-09-30", 30),
    ("Jour", "2026-09-01", "2026-09-25", 25),
    ("Jour", "2026-09-14", "2026-09-14", 1),           # période d'un jour
    ("Jour", "2026-02-01", "2026-02-28", 28),
    ("Mois", "2026-09-01", "2026-09-30", 1),
    ("Mois", "2026-09-01", "2026-10-31", 2),
    ("Mois", "2026-11-01", "2027-01-31", 3),            # changement d'année
    ("Mois", "2026-09-05", "2026-09-30", None),         # mois incomplet : jamais de prorata
    ("Mois", "2026-10-01", "2026-10-30", None),         # 30/10 n'est pas la fin d'octobre
    ("Forfait", "2026-09-05", "2026-09-17", 1),
    ("Forfait", "", "", 1),
    ("Heure", "2026-09-01", "2026-09-30", None),        # jamais déduit de la période
    ("Année", "2026-01-01", "2026-12-31", None),
    ("", "2026-09-01", "2026-09-30", None),             # unité non choisie
    ("Jour", "2026-09-30", "2026-09-01", None),         # période inversée
    ("Jour", "2026-02-30", "2026-03-01", None),         # date invalide
])
def test_period_quantity_rules(unite, start, end, expected):
    assert period_quantity(unite, start, end) == expected


def test_auto_line_quantity_follows_the_period_and_the_amount_is_exact():
    out = compute_invoice(_inv("2026-09-01", "2026-09-25", _auto()))
    line = out["lignes"][0]
    assert (line["qte"], line["nbr"], line["totalHT"]) == (25.0, 30, 2302740.0)
    assert (out["totalHT"], out["tvaAmt"], out["ttc"]) == (2302740.0, 437520.6, 2740260.6)
    # Changement de période : 01 → 30/09 ⇒ 30 jours, recalcul complet.
    out = compute_invoice(_inv("2026-09-01", "2026-09-30", _auto()))
    assert out["lignes"][0]["qte"] == 30.0
    assert Decimal(str(out["totalHT"])) == Decimal("2763288.00")


def test_auto_month_and_flat_rate_lines():
    out = compute_invoice(_inv("2026-09-01", "2026-10-31", _auto("Mois", nbr=5, prixUnitHT=60000),
                               _auto("Forfait", nbr=1, prixUnitHT=150000)))
    assert [l["qte"] for l in out["lignes"]] == [2.0, 1.0]
    assert out["totalHT"] == 5 * 2 * 60000 + 150000


def test_undetermined_auto_quantity_is_zero_and_blocks_validation():
    inv = _inv("2026-09-05", "2026-09-30", _auto("Mois"))
    assert compute_invoice(inv)["lignes"][0]["qte"] == 0.0          # brouillon : accepté, montant 0
    with pytest.raises(HTTPException) as exc:
        compute_invoice(inv, for_validation=True)
    assert exc.value.status_code == 422


def test_manual_quantity_is_kept_whatever_the_period():
    manual = _auto(qteAuto=False, qte=2.5, nbr=1, prixUnitHT=1000.33)
    out = compute_invoice(_inv("2026-09-01", "2026-09-30", manual))
    assert out["lignes"][0]["qte"] == 2.5 and out["lignes"][0]["totalHT"] == 2500.83   # 2500,825 → demi vers le haut
    assert "qteAuto" in out["lignes"][0] and out["lignes"][0]["qteAuto"] is False


def test_nbr_one_and_quantity_one():
    out = compute_invoice(_inv("2026-09-01", "2026-09-01", _auto(nbr=1, prixUnitHT=3070.32)))
    assert (out["lignes"][0]["qte"], out["totalHT"]) == (1.0, 3070.32)


def test_contract_line_without_unit_cannot_be_validated():
    inv = _inv("2026-09-01", "2026-09-30", _auto(""))
    with pytest.raises(HTTPException) as exc:
        compute_invoice(inv, for_validation=True)
    assert exc.value.status_code == 422


def test_historical_lines_are_untouched():
    legacy = {"type": "article", "designation": "MAGASINIER", "unite": "Mois", "qte": 25, "prixUnitHT": 92109.6, "tva": 19}
    out = compute_invoice(_inv("2026-09-05", "2026-09-30", legacy))
    assert out["lignes"][0]["nbr"] == 1 and out["lignes"][0]["qte"] == 25.0 and out["totalHT"] == 2302740.0
    assert "qteAuto" not in out["lignes"][0]


# ── API ────────────────────────────────────────────────────────────────────────────────
def _save(client, h, data, *, create=True):
    url = "/api/irongs/collections/factures/items" + ("" if create else f"/{data['id']}")
    return client.request("POST" if create else "PUT", url, headers=h, json={"data": data})


def _get(client, h, item_id):
    return client.get(f"/api/irongs/collections/factures/items/{item_id}", headers=h).json()


def _draft(**kw):
    data = {"id": f"fc_per_{uuid.uuid4().hex[:8]}", "numero": "BROUILLON", "statut": "brouillon", "societe": SOC,
            "client": "CLIENT PERIODE", "date": "2026-09-28", "periodeDebut": "2026-09-01", "periodeFin": "2026-09-30",
            "lignes": [_auto()]}
    data.update(kw)
    return data


def test_period_change_recomputes_saved_draft_and_reopen_is_consistent(client, auth_headers, db):
    data = _draft()
    assert _save(client, auth_headers, data).status_code == 200
    saved = _get(client, auth_headers, data["id"])
    assert (saved["lignes"][0]["qte"], saved["lignes"][0]["qteAuto"], saved["totalHT"]) == (30.0, True, 2763288.0)
    # L'utilisateur change la fin de période : 25/09 ⇒ 25 jours (même si le navigateur envoie 30).
    saved["periodeFin"] = "2026-09-25"
    assert _save(client, auth_headers, saved, create=False).status_code == 200
    again = _get(client, auth_headers, data["id"])
    assert (again["lignes"][0]["qte"], again["totalHT"], again["ttc"]) == (25.0, 2302740.0, 2740260.6)
    row = db.query(Invoice).filter(Invoice.external_id == data["id"]).one()
    assert (row.total_ht, row.total_ttc) == (2302740.0, 2740260.6)


def test_issued_invoice_is_frozen_including_its_period(client, auth_headers, db):
    data = _draft(periodeFin="2026-09-25")
    _save(client, auth_headers, data)
    r = client.post(f"/api/irongs/factures/{data['id']}/valider", headers=auth_headers)
    assert r.status_code == 200, r.text
    issued = r.json()
    assert issued["totalHT"] == 2302740.0
    forged = {**issued, "periodeDebut": "2026-01-01", "periodeFin": "2026-12-31", "statut": "brouillon", "totalHT": 1,
              "lignes": [_auto(nbr=99, qte=99, prixUnitHT=99999, qteAuto=False)]}
    assert _save(client, auth_headers, forged, create=False).status_code == 200
    after = _get(client, auth_headers, data["id"])
    assert (after["periodeDebut"], after["periodeFin"]) == ("2026-09-01", "2026-09-25")
    assert after["lignes"][0]["nbr"] == 30 and after["lignes"][0]["qte"] == 25.0 and after["lignes"][0]["prixUnitHT"] == 3070.32
    assert after["totalHT"] == 2302740.0 and after["statut"] == "emise" and after["numero"] == issued["numero"]
    row = db.query(Invoice).filter(Invoice.external_id == data["id"]).one()
    assert row.total_ht == 2302740.0
