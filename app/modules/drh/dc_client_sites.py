"""Clients et sites proposés au formulaire DRH de contractualisation.

Source officielle unique : le module Commercial (dc.irongs.com) — les clients (`clients`,
commercial.Client) et leurs sites (`sites`, ops.Site rattaché par `sites.client_id`). Aucune
liste locale ni table parallèle : le contrat ne conserve que les identifiants DC et un libellé
figé pour l'historique. Le nom n'est jamais une clé technique."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.scope_policy import society_key
from app.modules.commercial.models import Client
from app.modules.ops.models import Site

logger = logging.getLogger(__name__)

DC_SOURCE = "dc.irongs.com"
DC_UNAVAILABLE_DETAIL = "Impossible de charger les clients et sites depuis DC. Réessayez."
ACTIVE_CLIENT_STATUSES = {"actif", "active"}


def _client_is_active(client: Client) -> bool:
    # Même priorité que la fiche client DC : le statut saisi (data.statut) prime sur la colonne.
    data = client.data if isinstance(client.data, dict) else {}
    return str(data.get("statut") or client.status or "actif").strip().lower() in ACTIVE_CLIENT_STATUSES


def _site_is_active(site: Site) -> bool:
    return bool(site.active)


def client_site_label(client: Client, site: Site | None) -> str:
    client_name = str(client.name or client.legal_name or "").strip()
    site_name = str(site.name or "").strip() if site is not None else ""
    return f"{client_name} — {site_name}" if site_name else client_name


def _option(client: Client, site: Site | None) -> dict[str, Any]:
    return {
        "dc_client_id": client.id,
        "dc_site_id": site.id if site is not None else None,
        "client_name": str(client.name or client.legal_name or "").strip(),
        "site_name": str(site.name or "").strip() if site is not None else None,
        "label": client_site_label(client, site),
        "address": (site.address if site is not None else client.address) or None,
        "commune": site.commune if site is not None else None,
        "wilaya": site.wilaya if site is not None else None,
    }


def list_client_site_options(db: Session, society: str) -> list[dict[str, Any]]:
    """Clients actifs de la société et leurs sites actifs : une ligne par site, ou une ligne
    « client seul » quand le client n'a aucun site actif."""
    wanted = society_key(society)
    try:
        clients = [
            row for row in db.execute(select(Client).order_by(Client.name, Client.id)).scalars().all()
            if society_key(row.society) == wanted and _client_is_active(row)
        ]
        sites_by_client: dict[int, list[Site]] = {}
        if clients:
            stmt = select(Site).where(Site.client_id.in_([row.id for row in clients])).order_by(Site.name, Site.id)
            for site in db.execute(stmt).scalars().all():
                if _site_is_active(site):
                    sites_by_client.setdefault(site.client_id, []).append(site)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Lecture des clients et sites DC impossible")
        raise HTTPException(status_code=503, detail=DC_UNAVAILABLE_DETAIL) from exc
    options: list[dict[str, Any]] = []
    for client in clients:
        sites = sites_by_client.get(client.id) or [None]
        options.extend(_option(client, site) for site in sites)
    return options


def resolve_contract_selection(
    db: Session, *, dc_client_id: int | None, dc_site_id: int | None, society: str | None,
    allowed_societies: list[str] | None = None,
) -> dict[str, Any]:
    """Valide une sélection avant écriture dans un contrat et renvoie les colonnes à stocker.
    Le libellé est recalculé depuis DC : celui envoyé par le navigateur n'est jamais repris."""
    if dc_client_id is None:
        if dc_site_id is not None:
            raise HTTPException(status_code=422, detail="Site DC sans client DC")
        return {"dc_client_id": None, "dc_site_id": None, "dc_client_site_label": None}
    try:
        client = db.get(Client, dc_client_id)
        site = db.get(Site, dc_site_id) if dc_site_id is not None else None
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Vérification du client / site DC impossible")
        raise HTTPException(status_code=503, detail=DC_UNAVAILABLE_DETAIL) from exc
    if client is None or not _client_is_active(client):
        raise HTTPException(status_code=422, detail="Client DC introuvable ou inactif")
    if society_key(society):
        authorized = society_key(client.society) == society_key(society)
    else:
        # Dossier sans société : le périmètre du compte reste la seule limite.
        authorized = not allowed_societies or society_key(client.society) in {society_key(item) for item in allowed_societies}
    if not authorized:
        raise HTTPException(status_code=403, detail="Client DC non autorisé pour cette société")
    if dc_site_id is not None and (site is None or not _site_is_active(site) or site.client_id != client.id):
        raise HTTPException(status_code=422, detail="Site DC introuvable, inactif ou rattaché à un autre client")
    return {"dc_client_id": client.id, "dc_site_id": site.id if site is not None else None,
            "dc_client_site_label": client_site_label(client, site)}
