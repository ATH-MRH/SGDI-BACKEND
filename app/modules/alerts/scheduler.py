"""Orchestrateur alertes 0.6-A.

Reprend exactement le modèle de app.modules.assistant.scheduler : verrou
consultatif PostgreSQL (fail-closed — pas de lock obtenu -> aucun run), pas
GUNICORN_WORKER_ID comme garantie principale (contrairement à
app.modules.drh.email_alerts, qui reste tel quel — voir la docstring de
start_scheduler). Boucle asyncio en arrière-plan, une seule par process/
conteneur grâce au verrou.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text

from app.db.session import SessionLocal, engine
from app.modules.alerts import repository, service
from app.modules.alerts.detectors import contract_expiring, missing_checkout
from app.modules.alerts.rules import RULE_CONTRACT_EXPIRING, RULE_MISSING_CHECKOUT

logger = logging.getLogger("sgdi.alerts.scheduler")

_CHECK_INTERVAL_SECONDS = 300  # Détection déterministe périodique, pas de besoin de temps réel.
# Clé distincte de celle de l'assistant (app/modules/assistant/scheduler.py: 20260708_03) —
# même convention (date de création du verrou + suffixe de domaine).
_LOCK_KEY = 20260913_06

_scheduler_task: asyncio.Task | None = None
_lock_conn = None

_DETECTORS: tuple[tuple[str, str, callable], ...] = (
    ("drh.employee_contract.expiring", RULE_CONTRACT_EXPIRING, lambda db: contract_expiring.detect(db, allowed_societies=None)),
    ("attendance.presence.missing_checkout", RULE_MISSING_CHECKOUT, lambda db: missing_checkout.detect(db, allowed_societies=None)),
)


def _run_one_detector(db, detector_key: str, rule_key: str, detect_fn) -> dict:
    """Isole la panne d'UN détecteur : une erreur pendant la détection elle-même
    (avant même la persistance) produit tout de même un DetectionRun 'failed',
    et n'empêche pas les autres détecteurs de s'exécuter."""
    try:
        findings = detect_fn(db)
    except Exception as exc:  # noqa: BLE001 — isolation volontaire (section 15/21 du cadrage)
        logger.warning("Détecteur %s : échec pendant la détection : %s", detector_key, exc)
        run = repository.create_detection_run(db, detector_key=detector_key)
        repository.finish_detection_run(
            db, run, status="failed", scanned_count=0, detected_count=0,
            created_count=0, updated_count=0, error_count=1, error_summary=str(exc)[:2000],
        )
        return {"error": str(exc)}
    rule = repository.get_rule(db, rule_key)
    return service.run_detector(
        db, detector_key=detector_key, rule_key=rule_key, findings=findings,
        rule_version=rule.rule_version if rule else 1,
    )


def run_all_detectors() -> dict[str, dict]:
    """Portée toujours globale (système) — jamais le périmètre d'un utilisateur
    particulier : c'est l'orchestrateur, pas une requête API."""
    results: dict[str, dict] = {}
    with SessionLocal() as db:
        repository.ensure_rule_catalog(db)
        for detector_key, rule_key, detect_fn in _DETECTORS:
            results[detector_key] = _run_one_detector(db, detector_key, rule_key, detect_fn)
    return results


async def _loop() -> None:
    while True:
        try:
            await asyncio.to_thread(run_all_detectors)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover
            logger.warning("Boucle orchestrateur alertes: %s", exc)
        await asyncio.sleep(_CHECK_INTERVAL_SECONDS)


def _acquire_lock() -> bool:
    global _lock_conn
    if engine.dialect.name != "postgresql":
        return True
    try:
        conn = engine.connect()
        got = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": _LOCK_KEY}).scalar()
        if got:
            _lock_conn = conn
            return True
        conn.close()
        return False
    except Exception:
        # Fail-closed : en cas d'incident sur le verrou lui-même, on préfère ne
        # PAS démarrer plutôt que risquer une double exécution non détectée.
        return False


def start_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return
    if not _acquire_lock():
        logger.info("Orchestrateur alertes : verrou non obtenu (autre worker actif ou incident) — aucun run ici")
        return
    _scheduler_task = asyncio.get_running_loop().create_task(_loop())
    logger.info("Orchestrateur alertes démarré")


def stop_scheduler() -> None:
    global _lock_conn
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
    if _lock_conn is not None:
        try:
            _lock_conn.close()
        except Exception:
            pass
        _lock_conn = None
