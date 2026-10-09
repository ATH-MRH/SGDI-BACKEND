"""Boucle d'envoi des codes candidats via SMSGate.

Tourne dans chaque worker web : la réservation des lignes (FOR UPDATE SKIP LOCKED puis état
« sending » validé) et l'identifiant de message idempotent rendent l'exécution concurrente sûre,
sans verrou global dont la perte arrêterait les envois. Inactive tant que la fonctionnalité
n'est pas activée et entièrement configurée.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules import recruitment_sms_service as sms
from app.modules.recruitment_smsgate import SMSGateClient, load_config

logger = logging.getLogger("sgdi.recruitment.sms")

_TICK_SECONDS = 2
_HEALTH_SECONDS = 30

_task: asyncio.Task | None = None


def provider() -> str:
    return os.getenv('RECRUITMENT_SMS_PROVIDER', 'smsgate').strip().lower()


def smsgate_enabled() -> bool:
    return os.getenv('RECRUITMENT_SMS_ENABLED', 'false').lower() == 'true' and provider() == 'smsgate' and load_config() is not None


def run_once(check_health: bool) -> None:
    config = load_config()
    if config is None:
        return
    gateway = SMSGateClient(config)
    with SessionLocal() as db:
        if check_health and gateway.healthy():
            sms.mark_gateway_healthy(db)
        sms.dispatch_pending(db, settings.jwt_secret, gateway)
        sms.track_deliveries(db, gateway)


async def _loop() -> None:
    last_health = 0.0
    while True:
        check_health = time.monotonic() - last_health >= _HEALTH_SECONDS
        try:
            await asyncio.to_thread(run_once, check_health)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover
            # Seulement le type d'erreur : jamais de contenu de SMS ni d'identifiant dans les journaux.
            logger.warning("File SMS recrutement : %s", type(exc).__name__)
        if check_health:
            last_health = time.monotonic()
        await asyncio.sleep(_TICK_SECONDS)


def start_worker() -> None:
    global _task
    if _task and not _task.done():
        return
    if os.getenv('RECRUITMENT_SMS_ENABLED', 'false').lower() != 'true' or provider() != 'smsgate':
        return
    if load_config() is None:
        logger.warning("SMS recrutement activé mais configuration SMSGate absente ou invalide : aucun envoi")
        return
    # httpx journalise chaque appel en INFO (contrôle toutes les 30 s, identifiants de message dans l'URL).
    logging.getLogger("httpx").setLevel(logging.WARNING)
    _task = asyncio.get_running_loop().create_task(_loop())
    logger.info("File SMS recrutement démarrée (SMSGate)")


def stop_worker() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
    _task = None
