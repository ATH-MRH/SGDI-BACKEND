"""Tâches planifiées de l'assistant ATLAS.

L'assistant peut programmer des tâches récurrentes (ex. « chaque lundi 08:00,
résume la semaine »). Un planificateur en arrière-plan les exécute au bon
moment, en se faisant passer pour l'utilisateur qui les a créées (donc avec son
périmètre société). Le résultat est stocké dans la tâche et, si configuré,
envoyé par email.

Isolé par verrou consultatif PostgreSQL : un seul worker/conteneur exécute la
boucle même avec plusieurs workers Gunicorn.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy import text

from app.core.config import settings
from app.db.session import SessionLocal, engine

logger = logging.getLogger("sgdi.assistant.scheduler")

COLLECTION = "atlasScheduledTasks"
_CHECK_INTERVAL_SECONDS = 60
_LOCK_KEY = 20260708_03

_scheduler_task: asyncio.Task | None = None
_lock_conn = None


def _now_local() -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Africa/Algiers"))
    except Exception:
        return datetime.now()


def _due(task: dict[str, Any], now: datetime) -> bool:
    """Une tâche est due si l'heure planifiée est atteinte et pas déjà lancée aujourd'hui."""
    if not isinstance(task, dict) or not task.get("active", True):
        return False
    try:
        hour = int(task.get("hour", 8))
        minute = int(task.get("minute", 0))
    except (TypeError, ValueError):
        return False
    if task.get("frequency") == "weekly":
        try:
            if int(task.get("day_of_week", 0)) != now.weekday():
                return False
        except (TypeError, ValueError):
            return False
    # Heure atteinte (à la minute près, tolérance jusqu'à la fin de journée)
    if (now.hour, now.minute) < (hour, minute):
        return False
    return str(task.get("last_run") or "") != now.date().isoformat()


def list_tasks(db) -> list[dict[str, Any]]:
    from app.modules.irongs import service as _svc
    try:
        items = _svc.list_items(db, COLLECTION)
    except Exception:
        return []
    return [i for i in items if isinstance(i, dict)]


def create_task(db, task: dict[str, Any]) -> dict[str, Any]:
    from app.modules.irongs import service as _svc
    _svc.create_item(db, COLLECTION, task)
    db.commit()
    return task


def _update_task(db, task_id: str, changes: dict[str, Any]) -> None:
    from app.modules.irongs import service as _svc
    try:
        _svc.update_item(db, COLLECTION, task_id, changes)
        db.commit()
    except Exception as exc:  # pragma: no cover
        db.rollback()
        logger.warning("MAJ tâche planifiée %s échouée: %s", task_id, exc)


def _send_email_result(recipient: str, title: str, body: str) -> bool:
    if not (settings.smtp_host and recipient):
        return False
    try:
        import smtplib
        from email.message import EmailMessage

        from_email = settings.smtp_from_email or settings.smtp_username
        msg = EmailMessage()
        msg["From"] = from_email
        msg["To"] = recipient
        msg["Subject"] = f"ATLAS — {title}"
        msg.set_content(body)
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20) as s:
                if settings.smtp_username and settings.smtp_password:
                    s.login(settings.smtp_username, settings.smtp_password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
                if settings.smtp_use_tls:
                    s.starttls()
                if settings.smtp_username and settings.smtp_password:
                    s.login(settings.smtp_username, settings.smtp_password)
                s.send_message(msg)
        return True
    except Exception as exc:  # pragma: no cover
        logger.warning("Envoi email tâche planifiée échoué: %s", exc)
        return False


def run_due_tasks() -> int:
    """Exécute les tâches dues. Retourne le nombre exécuté."""
    from app.modules.assistant import agent
    from app.modules.auth.models import User

    now = _now_local()
    executed = 0
    with SessionLocal() as db:
        tasks = list_tasks(db)
        for task in tasks:
            if not _due(task, now):
                continue
            username = task.get("user")
            user = db.query(User).filter(User.username == username).one_or_none() if username else None
            if user is None:
                _update_task(db, str(task.get("id")), {"last_run": now.date().isoformat(),
                                                        "last_result": "Utilisateur introuvable."})
                continue
            try:
                result = agent.run_agent(db, user, str(task.get("instruction") or ""), [])
            except Exception as exc:
                result = f"Échec : {exc}"
            _update_task(db, str(task.get("id")), {
                "last_run": now.date().isoformat(),
                "last_run_at": now.isoformat(timespec="seconds"),
                "last_result": result[:4000],
            })
            recipient = task.get("recipient_email")
            if recipient:
                _send_email_result(recipient, task.get("title") or "Tâche planifiée", result)
            logger.info("Tâche planifiée exécutée: %s (user=%s)", task.get("title"), username)
            executed += 1
    return executed


async def _loop() -> None:
    while True:
        try:
            await asyncio.to_thread(run_due_tasks)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover
            logger.warning("Boucle tâches planifiées: %s", exc)
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
        return True


def start_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return
    if not _acquire_lock():
        logger.info("Tâches planifiées : gérées par un autre worker, ignoré ici")
        return
    _scheduler_task = asyncio.get_running_loop().create_task(_loop())
    logger.info("Planificateur de tâches ATLAS démarré")


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
