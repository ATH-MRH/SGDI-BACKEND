"""Unité tarifaire des prestations du catalogue client (Commercial → Facturation).

Chaque prestation (client.data.lignesFacturation) porte désignation + prix unitaire + unité
tarifaire. L'unité appartient à la prestation : un même contrat peut mélanger Heure, Jour,
Mois et Forfait. Elle n'est JAMAIS déduite du montant, et le prix n'est JAMAIS converti.

Compatibilité : les prestations créées avant l'unité tarifaire n'en ont pas. Elles restent
telles quelles (« unité à définir ») tant qu'elles ne sont pas modifiées ; toute prestation
tarifée nouvelle ou dont le prix change doit porter une unité.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException

# Représentation canonique (mêmes libellés que les unités de devis/facture existantes).
BILLING_UNITS: tuple[str, ...] = ("Heure", "Jour", "Mois", "Forfait")

_ALIASES = {
    "heure": "Heure", "heures": "Heure", "h": "Heure", "hr": "Heure", "hrs": "Heure",
    "jour": "Jour", "jours": "Jour", "j": "Jour",
    "mois": "Mois",
    "forfait": "Forfait", "forfaits": "Forfait", "forfaitaire": "Forfait",
}


def normalize_billing_unit(value: Any) -> str | None:
    """Unité canonique, None si absente ; 422 si la valeur n'est pas une unité connue."""
    text = str(value or "").strip()
    if not text:
        return None
    unit = _ALIASES.get(text.lower())
    if not unit:
        raise HTTPException(status_code=422, detail=f"Unité tarifaire inconnue : {text} (attendu : {', '.join(BILLING_UNITS)})")
    return unit


def _price(value: Any) -> Decimal:
    try:
        number = Decimal(str(value if value not in (None, "") else 0).replace(" ", "").replace(",", "."))
    except InvalidOperation:
        return Decimal(0)
    return number.quantize(Decimal("0.01")) if number.is_finite() else Decimal(0)


def _legacy_key(line: dict[str, Any]) -> tuple[str, Decimal]:
    return (str(line.get("designation") or "").strip(), _price(line.get("prixUnitaire")))


def validate_catalog(lines: Any, previous: Any = None) -> Any:
    """Normalise l'unité de chaque prestation et refuse une prestation tarifée sans unité,
    sauf si elle existait déjà à l'identique (même désignation, même prix) sans unité."""
    if not isinstance(lines, list):
        return lines
    legacy_unitless = {
        _legacy_key(line) for line in (previous if isinstance(previous, list) else [])
        if isinstance(line, dict) and not str(line.get("unite") or "").strip()
    }
    out: list[Any] = []
    for index, raw in enumerate(lines, start=1):
        if not isinstance(raw, dict):
            out.append(raw)
            continue
        line = dict(raw)
        unit = normalize_billing_unit(line.get("unite"))
        if unit:
            line["unite"] = unit
        else:
            priced = bool(str(line.get("designation") or "").strip()) and _price(line.get("prixUnitaire")) > 0
            if priced and _legacy_key(line) not in legacy_unitless:
                raise HTTPException(status_code=422, detail=(
                    f"Prestation {index} ({line.get('designation')}) : choisissez l'unité tarifaire "
                    f"({', '.join(BILLING_UNITS)})"))
        out.append(line)
    return out


def validate_client_data(data: Any, previous_data: Any = None) -> Any:
    """Applique validate_catalog au catalogue « Effectif global » d'un client."""
    if not isinstance(data, dict) or "lignesFacturation" not in data:
        return data
    previous = previous_data.get("lignesFacturation") if isinstance(previous_data, dict) else None
    return {**data, "lignesFacturation": validate_catalog(data.get("lignesFacturation"), previous)}


def catalog_entry(client_data: Any, catalog_key: Any) -> tuple[str | None, Decimal | None] | None:
    """Unité et prix contractuels d'une prestation désignée par la clé de catalogue de la
    Facturation ([clientId, "site:i:j"] ou [clientId, "catalogue:i"]). None si introuvable."""
    import json

    if not isinstance(client_data, dict):
        return None
    try:
        _client_id, path = json.loads(catalog_key) if isinstance(catalog_key, str) else catalog_key
        parts = str(path).split(":")
        catalog = [l for l in (client_data.get("lignesFacturation") or []) if isinstance(l, dict)]
        if parts[0] == "site":
            site = (client_data.get("tech_sites") or [])[int(parts[1])]
            designation = str(((site or {}).get("lignesFacturation") or [])[int(parts[2])].get("designation") or "").strip()
            entry = next((l for l in catalog if str(l.get("designation") or "").strip() == designation), None)
        elif parts[0] == "catalogue":
            entry = catalog[int(parts[1])]
        else:
            return None
    except (ValueError, TypeError, IndexError, AttributeError):
        return None
    if not entry:
        return None
    try:
        unit = normalize_billing_unit(entry.get("unite"))
    except HTTPException:
        unit = None
    price = _price(entry.get("prixUnitaire"))
    return unit, (price if price > 0 else None)
