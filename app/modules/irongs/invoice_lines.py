"""Calcul CANONIQUE d'une facture (Facturation ATLAS) — source unique, côté serveur.

Ligne article :  total = NBR × QUANTITÉ × PRIX UNITAIRE HT   (arrondi au centime)
  NBR       = nombre d'éléments facturés (agents, véhicules, équipements, postes…) ;
  QUANTITÉ  = quantité facturée POUR CHAQUE élément (jours, heures, mois…) ;
  PRIX      = prix d'une unité de quantité pour un élément.
Ligne remise : −(pourcentage × sous-total de la section en cours), section = depuis le
dernier « sous-total ». Total HT = somme ; TVA = HT × taux ; TTC = HT + TVA.

Arrondi : ROUND_HALF_UP au centime (politique financière d'ATLAS, finance_core.q2), appliqué
à chaque ligne, à chaque remise et à la TVA. Montants en Decimal ; conversion en nombre
uniquement pour le stockage JSON historique lu par le navigateur.

Compatibilité : une ligne sans NBR (toutes les factures antérieures) vaut NBR = 1, donc
1 × Q × PU = Q × PU — les montants historiques ne changent pas. Le navigateur calcule pour
l'affichage ; le total enregistré est TOUJOURS celui recalculé ici.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException

CENT = Decimal("0.01")
DEFAULT_TVA = Decimal("19")
MAX_NBR = 1_000_000
MAX_AMOUNT = Decimal("999999999999.99")


def _q(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _decimal(value: Any, field: str, *, default: Decimal) -> Decimal:
    if value is None or (isinstance(value, str) and not value.strip()):
        return default
    if isinstance(value, bool):
        raise HTTPException(422, detail=f"Valeur invalide pour {field}")
    text = str(value).strip().replace(" ", "").replace(" ", "").replace(" ", "").replace(",", ".")
    try:
        number = Decimal(text)
    except InvalidOperation:
        raise HTTPException(422, detail=f"Valeur invalide pour {field} : {value}") from None
    if not number.is_finite():
        raise HTTPException(422, detail=f"Valeur non finie pour {field}")
    if number < 0:
        raise HTTPException(422, detail=f"{field} ne peut pas être négatif")
    return number


def line_nbr(line: dict[str, Any]) -> int:
    """NBR d'une ligne : entier ≥ 0 ; absent (factures historiques) = 1."""
    raw = line.get("nbr")
    number = _decimal(raw, "NBR", default=Decimal(1))
    if number != number.to_integral_value():
        raise HTTPException(422, detail="NBR doit être un nombre entier d'éléments")
    if number > MAX_NBR:
        raise HTTPException(422, detail=f"NBR trop grand (maximum {MAX_NBR})")
    return int(number)


def _line_quantity(line: dict[str, Any]) -> Decimal:
    raw = line.get("qte") if line.get("qte") not in (None, "") else line.get("quantite")
    return _decimal(raw, "Quantité", default=Decimal(0))


def _line_price(line: dict[str, Any]) -> Decimal:
    raw = line.get("prixUnitHT") if line.get("prixUnitHT") not in (None, "") else line.get("prixUnitaire")
    return _decimal(raw, "Prix unitaire", default=Decimal(0))


def line_total(nbr: int, quantity: Decimal, price: Decimal) -> Decimal:
    total = _q(Decimal(nbr) * quantity * price)
    if total > MAX_AMOUNT:
        raise HTTPException(422, detail="Montant de ligne trop élevé")
    return total


def _tva_rate(invoice: dict[str, Any], lines: list[dict[str, Any]]) -> Decimal:
    """Même règle que l'éditeur existant : le taux global est porté par chaque ligne article
    (champ « tva ») ; 19 % par défaut. Aucune règle fiscale n'est ajoutée ni modifiée."""
    for candidate in [invoice.get("tvaPct"), *[l.get("tva") for l in lines if (l.get("type") or "article") == "article"]]:
        if candidate not in (None, ""):
            try:
                rate = Decimal(str(candidate).replace(",", "."))
            except InvalidOperation:
                continue
            if rate.is_finite() and rate > 0:
                return rate
    return DEFAULT_TVA


def compute_invoice(invoice: dict[str, Any], *, for_validation: bool = False) -> dict[str, Any]:
    """Recalcule lignes et totaux. Retourne une copie de la facture où chaque ligne article
    porte nbr / qte / quantite / prixUnitHT / prixUnitaire / totalHT canoniques, et où
    totalHT / montantHT / tvaAmt / montantTTC / ttc sont ceux du serveur."""
    lines_in = invoice.get("lignes") if isinstance(invoice.get("lignes"), list) else []
    if not lines_in and not for_validation:
        # Facture « en-tête seul » (import Excel, historique sans détail) : aucun détail à
        # recalculer, les totaux fournis sont conservés tels quels.
        return dict(invoice)
    rate = _tva_rate(invoice, lines_in)
    total_ht = Decimal(0)
    section = Decimal(0)
    lines_out: list[dict[str, Any]] = []
    articles = 0
    for index, raw in enumerate(lines_in, start=1):
        line = dict(raw) if isinstance(raw, dict) else {}
        kind = line.get("type") or "article"
        if kind == "article":
            nbr = line_nbr(line)
            quantity = _line_quantity(line)
            price = _line_price(line)
            total = line_total(nbr, quantity, price)
            if for_validation and (line.get("designation") or price):
                if nbr < 1:
                    raise HTTPException(422, detail=f"Ligne {index} : NBR doit être au moins 1 pour valider la facture")
                if quantity <= 0:
                    raise HTTPException(422, detail=f"Ligne {index} : la quantité doit être positive pour valider la facture")
            line.update({"nbr": nbr, "qte": float(quantity), "quantite": float(quantity),
                         "prixUnitHT": float(price), "prixUnitaire": float(price), "totalHT": float(total)})
            total_ht += total
            section += total
            articles += 1
        elif kind == "remise":
            pct = _decimal(line.get("remisePct"), "Remise (%)", default=Decimal(0))
            if pct > 100:
                raise HTTPException(422, detail="Une remise ne peut pas dépasser 100 %")
            amount = _q(section * pct / Decimal(100))
            line.update({"remisePct": float(pct), "totalHT": float(-amount)})
            total_ht -= amount
            section -= amount
        elif kind == "soustotal":
            section = Decimal(0)
        lines_out.append(line)
    if for_validation and not articles:
        raise HTTPException(422, detail="Une facture validée doit contenir au moins une ligne article")
    tva = _q(total_ht * rate / Decimal(100))
    ttc = total_ht + tva
    out = dict(invoice)
    out.update({"lignes": lines_out, "totalHT": float(total_ht), "montantHT": float(total_ht), "tvaAmt": float(tva),
                "montantTTC": float(ttc), "ttc": float(ttc)})
    return out
