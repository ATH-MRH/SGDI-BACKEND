"""Envoi des notifications push d'ATLAS MOBILE.

Rien n'est envoyé tant que `PUSH_PROVIDER` vaut "disabled" (valeur par défaut). Le
fournisseur est interchangeable : Expo Push Service en V1, APNs / FCM directs plus tard,
sans toucher aux appelants.

Une notification ne transporte JAMAIS de donnée métier : son texte est choisi dans une
liste fixe par catégorie, et elle ne porte qu'une route interne. Le détail se lit dans
l'application, après authentification.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Protocol

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.modules.mobile.devices import active_devices
from app.modules.mobile.models import MobileDevice

logger = logging.getLogger(__name__)

# Catégorie → (titre, texte). Aucun nom, aucun site, aucun chiffre.
CATEGORIES: dict[str, tuple[str, str]] = {
    "critical": ("ATLAS — alerte critique", "Une alerte critique demande votre attention."),
    "incident": ("ATLAS — incident", "Un incident a été signalé dans votre périmètre."),
    "attendance": ("ATLAS — pointage", "Une situation de pointage est à traiter."),
    "hr": ("ATLAS — ressources humaines", "Une demande attend votre décision."),
    "system": ("ATLAS", "Une information est disponible dans l'application."),
}

# Mêmes routes que celles acceptées par l'application (mobile/atlas/src/push/links.ts).
_ROUTES = tuple(re.compile(pattern) for pattern in (
    r"^/alerts/\d{1,12}$",
    r"^/ops/sites/\d{1,12}$",
    r"^/drh/employees/\d{1,12}$",
    r"^/(incidents|abandons|attendance|brq|recruitment)$",
    r"^/drh/leaves$",
    r"^/\(tabs\)/(tasks|alerts)$",
))

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_BATCH = 100


def valid_route(route: str | None) -> bool:
    return isinstance(route, str) and len(route) <= 60 and any(pattern.fullmatch(route) for pattern in _ROUTES)


@dataclass(frozen=True)
class OutboundPush:
    token: str
    title: str
    body: str
    category: str
    route: str | None


@dataclass(frozen=True)
class PushResult:
    token: str
    #: "sent" | "invalid_token" (appareil à révoquer) | "error" | "disabled"
    status: str
    detail: str | None = None


class PushProvider(Protocol):
    name: str

    def send(self, messages: list[OutboundPush]) -> list[PushResult]: ...


class DisabledProvider:
    """Fournisseur par défaut : n'envoie rien, et le dit."""

    name = "disabled"

    def send(self, messages: list[OutboundPush]) -> list[PushResult]:
        return [PushResult(message.token, "disabled") for message in messages]


HttpPost = Callable[[str, dict[str, str], bytes], tuple[int, bytes]]


def _http_post(url: str, headers: dict[str, str], body: bytes) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310 — URL fixe en HTTPS
        return response.status, response.read()


class ExpoPushProvider:
    """Expo Push Service. Le jeton d'accès Expo, s'il est exigé par le projet, vient de
    l'environnement (`EXPO_ACCESS_TOKEN`) : jamais du dépôt, jamais des journaux."""

    name = "expo"

    def __init__(self, access_token: str | None = None, http_post: HttpPost = _http_post):
        self._access_token = access_token
        self._http_post = http_post

    def send(self, messages: list[OutboundPush]) -> list[PushResult]:
        results: list[PushResult] = []
        for start in range(0, len(messages), EXPO_BATCH):
            results.extend(self._send_batch(messages[start:start + EXPO_BATCH]))
        return results

    def _send_batch(self, batch: list[OutboundPush]) -> list[PushResult]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"
        payload = [
            {"to": message.token, "title": message.title, "body": message.body, "sound": "default",
             "channelId": "atlas-alerts", "priority": "high" if message.category == "critical" else "default",
             "data": {"category": message.category, **({"route": message.route} if message.route else {})}}
            for message in batch
        ]
        try:
            status, raw = self._http_post(EXPO_PUSH_URL, headers, json.dumps(payload).encode("utf-8"))
            tickets = json.loads(raw.decode("utf-8")).get("data") if status == 200 else None
        except Exception as exc:  # noqa: BLE001 — une panne du fournisseur ne doit jamais casser l'appelant
            logger.warning("push expo indisponible: %s", type(exc).__name__)
            return [PushResult(message.token, "error", "provider_unreachable") for message in batch]
        if not isinstance(tickets, list) or len(tickets) != len(batch):
            return [PushResult(message.token, "error", f"http_{status}") for message in batch]
        results = []
        for message, ticket in zip(batch, tickets):
            ticket = ticket if isinstance(ticket, dict) else {}
            if ticket.get("status") == "ok":
                results.append(PushResult(message.token, "sent"))
                continue
            code = str((ticket.get("details") or {}).get("error") or "unknown")[:40]
            results.append(PushResult(message.token, "invalid_token" if code == "DeviceNotRegistered" else "error", code))
        return results


def get_provider() -> PushProvider:
    settings = get_settings()
    if settings.push_provider == "expo":
        return ExpoPushProvider(settings.expo_access_token)
    return DisabledProvider()


def notify_user(db: Session, user_id: int, category: str, route: str | None = None, *,
                provider: PushProvider | None = None) -> dict[str, int]:
    """Notifie les appareils actifs d'un utilisateur. Retourne le décompte par statut.

    Les appareils dont le fournisseur signale le jeton comme invalide sont révoqués."""
    if category not in CATEGORIES:
        raise ValueError(f"Catégorie de notification inconnue : {category}")
    if route is not None and not valid_route(route):
        raise ValueError("Route de notification non autorisée")
    provider = provider or get_provider()
    title, body = CATEGORIES[category]
    devices = [device for device in active_devices(db, user_id, environment=get_settings().push_environment) if device.provider == provider.name]
    counts: dict[str, int] = {}
    if not devices:
        return counts
    results = provider.send([OutboundPush(device.push_token, title, body, category, route) for device in devices])
    invalid = [result.token for result in results if result.status == "invalid_token"]
    if invalid:
        db.execute(update(MobileDevice).where(MobileDevice.push_token.in_(invalid)).values(revoked_at=datetime.utcnow()))
        db.flush()
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
    return counts
