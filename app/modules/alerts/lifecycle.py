"""Cycle de vie explicite d'une alerte. Aucune transition arbitraire : toute
transition hors de cette matrice est rejetée explicitement par le service.
"""
from __future__ import annotations

STATUSES: tuple[str, ...] = (
    "open",
    "acknowledged",
    "assigned",
    "deferred",
    "treated",
    "ignored",
    "resolved",
)

# Statut -> ensemble des statuts cibles atteignables depuis lui.
# "resolved" et le retour "ignored"/"treated" -> "open" sont des transitions
# SYSTÈME (le service les applique lui-même quand une occurrence réapparaît ou
# disparaît d'un run de détection) ; les autres sont des actions utilisateur
# (voir service.py : acknowledge/assign/defer/ignore/treated).
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "open": frozenset({"acknowledged", "assigned", "deferred", "ignored", "treated", "resolved"}),
    "acknowledged": frozenset({"assigned", "deferred", "treated", "ignored", "resolved"}),
    "assigned": frozenset({"acknowledged", "deferred", "treated", "ignored", "resolved"}),
    "deferred": frozenset({"open", "acknowledged", "assigned", "treated", "ignored", "resolved"}),
    "treated": frozenset({"resolved", "open"}),
    "ignored": frozenset({"open"}),
    "resolved": frozenset({"open"}),
}

# Actions API -> statut cible qu'elles produisent.
ACTION_TARGET_STATUS: dict[str, str] = {
    "acknowledge": "acknowledged",
    "assign": "assigned",
    "defer": "deferred",
    "ignore": "ignored",
    "treated": "treated",
}


class InvalidTransitionError(ValueError):
    """Levée quand une transition demandée n'existe pas dans la matrice."""

    def __init__(self, current_status: str, target_status: str) -> None:
        self.current_status = current_status
        self.target_status = target_status
        super().__init__(f"Transition refusée : {current_status} -> {target_status}")


def is_valid_transition(current_status: str, target_status: str) -> bool:
    if current_status == target_status:
        return False
    return target_status in ALLOWED_TRANSITIONS.get(current_status, frozenset())


def ensure_valid_transition(current_status: str, target_status: str) -> None:
    if not is_valid_transition(current_status, target_status):
        raise InvalidTransitionError(current_status, target_status)


def target_status_for_action(action: str) -> str:
    try:
        return ACTION_TARGET_STATUS[action]
    except KeyError as exc:
        raise ValueError(f"Action inconnue : {action}") from exc
