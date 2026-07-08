"""Limitation d'essais en mémoire (anti brute-force).

Léger, sans dépendance : compte les échecs par clé (ex. IP) sur une fenêtre
glissante. Un succès efface le compteur. Par worker (avec plusieurs workers,
la limite effective est multipliée par le nombre de workers — ce qui reste très
protecteur face à des milliers de tentatives).
"""
from __future__ import annotations

import threading
import time

_LOCK = threading.Lock()
_FAILURES: dict[str, list[float]] = {}
_MAX_KEYS = 10_000


def _prune(now: float, window: float) -> None:
    # Nettoyage occasionnel pour éviter une croissance mémoire non bornée.
    if len(_FAILURES) <= _MAX_KEYS:
        return
    for key in list(_FAILURES.keys()):
        kept = [t for t in _FAILURES[key] if now - t < window]
        if kept:
            _FAILURES[key] = kept
        else:
            _FAILURES.pop(key, None)


def failure_count(key: str, window: float = 300.0) -> int:
    now = time.time()
    with _LOCK:
        arr = [t for t in _FAILURES.get(key, []) if now - t < window]
        if arr:
            _FAILURES[key] = arr
        else:
            _FAILURES.pop(key, None)
        return len(arr)


def record_failure(key: str, window: float = 300.0) -> int:
    now = time.time()
    with _LOCK:
        arr = [t for t in _FAILURES.get(key, []) if now - t < window]
        arr.append(now)
        _FAILURES[key] = arr
        _prune(now, window)
        return len(arr)


def clear(key: str) -> None:
    with _LOCK:
        _FAILURES.pop(key, None)
