import logging
import os
from datetime import date

logger = logging.getLogger(__name__)


def _iron_url() -> str:
    return os.getenv("IRON_API_URL", "").rstrip("/")


def _iron_key() -> str:
    return os.getenv("IRON_SYNC_SECRET", "")


def build_payload(employee, site, assignment) -> dict:
    """Construit le dict de sync pendant que la session DB est encore ouverte."""
    return {
        "atlas_id": employee.id,
        "matricule": employee.code,
        "prenom": employee.first_name,
        "nom": employee.last_name,
        "service": site.name,
        "fonction": assignment.position or employee.position or "",
        "badge": None,
        "niveau": assignment.group_code or "A",
        "statut": "actif" if assignment.active else "inactif",
        "creation": str(assignment.start_date or date.today()),
        "site_id": site.id,
        "site_nom": site.name,
        "groupe": assignment.group_code or "A",
        "date_affectation": str(assignment.start_date or date.today()),
    }


def push_payload(payload: dict) -> None:
    """Fire-and-forget: envoie le payload vers Security-IRON (sans session DB)."""
    url = _iron_url()
    key = _iron_key()
    if not url or not key:
        logger.debug("Iron sync désactivé (IRON_API_URL / IRON_SYNC_SECRET non définis)")
        return
    try:
        import httpx
        resp = httpx.post(
            f"{url}/api/sync/affectation",
            json=payload,
            headers={"X-Atlas-Sync-Key": key},
            timeout=5.0,
        )
        if resp.status_code != 200:
            logger.warning("Iron sync HTTP %s : %s", resp.status_code, resp.text[:200])
        else:
            logger.info("Iron sync OK — atlas_id=%s site=%s", payload.get("atlas_id"), payload.get("site_nom"))
    except Exception as exc:
        logger.warning("Iron sync échoué : %s", exc)


def push_assignment(employee, site, assignment) -> None:
    """Compatibilité — construit le payload et l'envoie immédiatement (usage hors background task)."""
    push_payload(build_payload(employee, site, assignment))
