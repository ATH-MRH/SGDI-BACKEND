"""Temps RÉEL / temps COMPTABILISÉ du travail posté (lot 1).

Deux temps distincts, jamais confondus :

    TEMPS RÉEL          = horodatage enregistré par le terminal (`attendance_events.occurred_at`),
                          append-only, jamais modifié ni écrasé ;
    TEMPS COMPTABILISÉ  = temps retenu par les règles de la vacation OFFICIELLE.

Seules les affectations `POSTE_CONTINU` dont la vacation officielle est connue sont concernées ;
la vacation vient exclusivement de `official.official_shift` (rien n'est recalculé ici). Hors de
ce cas (LEGACY, NORMAL, ROTATION_NOT_CONFIGURED, OFF, pointage après la fin de la vacation), ce
module ne renvoie rien et les règles historiques s'appliquent sans changement.

Règles (vacation T → TFIN) :
- entrée avant T-30 min       : EARLY_OUTSIDE_WINDOW — refusée, aucun mouvement, aucune présence ;
- entrée de T-30 min à T      : acceptée, comptabilisée à partir de T ;
- entrée après T              : comptabilisée à partir de l'heure réelle ;
- sortie avant TFIN           : comptabilisée jusqu'à l'heure réelle ;
- sortie après TFIN           : comptabilisée jusqu'à TFIN ;
- durée comptabilisée         : max(0, fin - début), plafonnée à la durée normale (480 min).

Vacation SUPPLÉMENTAIRE (lot 2, maintien au poste) : jamais une vacation de 16 h, toujours deux
vacations distinctes. Après la SORTIE de la vacation normale, une nouvelle entrée ouvre le créneau
suivant (TFIN → TFIN + 480 min). La fenêtre se compte depuis TFIN, jamais depuis la sortie réelle :
- TFIN à TFIN+30 min (exclu)  : EXTRA_BEFORE_WINDOW — refusée ;
- TFIN+30 à TFIN+45 (inclus)  : acceptée (EXTRA_IN_WINDOW) ;
- après TFIN+45               : MANUAL_ENTRY_REQUIRED — refusée, sauf saisie manuelle du pointeur
                                habilité (EXTRA_MANUAL, motif obligatoire) ;
- vacation précédente sans sortie : PREVIOUS_SHIFT_NOT_CLOSED — refusée.

L'instantané est FIGÉ dans l'événement (`attendance_events.data["counted"]`) au moment du
pointage : le planning officiel (groupe, ancrage, modèle) peut changer ensuite sans réécrire le
passé. La sortie se calcule sur l'instantané de SON entrée, jamais sur le planning du moment.
Voir docs/attendance-counted-time.md.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.modules.attendance import official

EARLY_WINDOW = timedelta(minutes=30)

EXTRA_NO_ENTRY = timedelta(minutes=30)             # TFIN → TFIN+30 : nouvelle entrée interdite
EXTRA_WINDOW_END = timedelta(minutes=45)           # TFIN+30 → TFIN+45 : nouvelle entrée autonome

KIND_NORMAL = "NORMAL"                             # vacation officielle du cycle
KIND_EXTRA = "EXTRA_SHIFT"                         # vacation supplémentaire (maintien)
KIND_LABELS = {KIND_NORMAL: "Vacation normale", KIND_EXTRA: "Vacation supplémentaire (maintien)"}
INTENT_EXTRA_ENTRY = "EXTRA_SHIFT_ENTRY"           # saisie manuelle : entrée explicite, jamais une sortie

ENTRY_IN_WINDOW = "IN_WINDOW"                      # T-30 ≤ entrée ≤ T
ENTRY_AFTER_START = "AFTER_START"                  # entrée > T
EARLY_OUTSIDE_WINDOW = "EARLY_OUTSIDE_WINDOW"      # entrée < T-30 : aucun mouvement
ENTRY_EXTRA_IN_WINDOW = "EXTRA_IN_WINDOW"          # TFIN+30 ≤ entrée ≤ TFIN+45
ENTRY_EXTRA_MANUAL = "EXTRA_MANUAL"                # après TFIN+45, saisie par le pointeur habilité
EXTRA_BEFORE_WINDOW = "EXTRA_BEFORE_WINDOW"        # TFIN ≤ entrée < TFIN+30 : aucun mouvement
PREVIOUS_SHIFT_NOT_CLOSED = "PREVIOUS_SHIFT_NOT_CLOSED"
MANUAL_ENTRY_REQUIRED = "MANUAL_ENTRY_REQUIRED"    # entrée > TFIN+45 : aucun mouvement autonome
REFUSALS = frozenset({EARLY_OUTSIDE_WINDOW, EXTRA_BEFORE_WINDOW, PREVIOUS_SHIFT_NOT_CLOSED, MANUAL_ENTRY_REQUIRED})
ENTRY_STATUS_LABELS = {
    ENTRY_IN_WINDOW: "Arrivée dans la fenêtre",
    ENTRY_AFTER_START: "Arrivée après le début de vacation",
    EARLY_OUTSIDE_WINDOW: "Arrivée avant l'ouverture de la fenêtre",
    ENTRY_EXTRA_IN_WINDOW: "Nouvelle entrée dans la fenêtre de maintien",
    ENTRY_EXTRA_MANUAL: "Nouvelle entrée saisie par le pointeur",
    EXTRA_BEFORE_WINDOW: "Nouvelle entrée avant l'ouverture de la fenêtre de maintien",
    PREVIOUS_SHIFT_NOT_CLOSED: "Vacation précédente non clôturée",
    MANUAL_ENTRY_REQUIRED: "Saisie manuelle par le pointeur requise",
}
# Libellés prêts pour les écrans (Pointeur V5 à venir) : aucune refonte dans ce lot.
LABELS = {
    "actual_entry": "Entrée réelle", "actual_exit": "Sortie réelle",
    "counted_start": "Début comptabilisé", "counted_end": "Fin comptabilisée",
    "counted_minutes": "Durée comptabilisée", "scheduled_start": "Début de vacation",
    "scheduled_end": "Fin de vacation", "window_opens_at": "Ouverture du pointage",
    "window_closes_at": "Fermeture de la fenêtre", "previous": "Vacation précédente",
}


# ── Règles (fonctions pures) ─────────────────────────────────────────────────────────────
def classify_entry(plan: dict[str, Any], at: datetime) -> dict[str, Any]:
    """Instantané d'une entrée à `at` sur la vacation officielle `plan` (travaillée)."""
    start = plan["scheduled_start"]
    opens = start - EARLY_WINDOW
    if at < opens:
        status, counted_start = EARLY_OUTSIDE_WINDOW, None
    elif at <= start:
        status, counted_start = ENTRY_IN_WINDOW, start
    else:
        status, counted_start = ENTRY_AFTER_START, at
    return {
        "kind": KIND_NORMAL, "regime": plan["regime"], "group": plan["group"], "shift": plan["shift"],
        "work_date": plan["work_date"].isoformat(), "cycle_day": plan["cycle_day"],
        "model_version": (plan["model"] or {}).get("version"),
        "scheduled_start": start.isoformat(), "scheduled_end": plan["scheduled_end"].isoformat(),
        "normal_minutes": plan["normal_minutes"], "window_opens_at": opens.isoformat(),
        "entry_status": status, "actual_entry": at.isoformat(),
        "counted_start": counted_start.isoformat() if counted_start else None,
        "actual_exit": None, "counted_end": None, "counted_minutes": None,
    }


def close(entry: dict[str, Any] | None, at: datetime) -> dict[str, Any] | None:
    """Instantané complété par la sortie réelle `at`. None si l'entrée n'a pas d'instantané
    (entrée hors travail posté ou antérieure au lot 1) : règles historiques."""
    if not isinstance(entry, dict) or not entry.get("counted_start"):
        return None
    start = datetime.fromisoformat(entry["counted_start"])
    end = min(at, datetime.fromisoformat(entry["scheduled_end"]))
    minutes = max(0, int((end - start).total_seconds() // 60))
    return {**entry, "actual_exit": at.isoformat(), "counted_end": end.isoformat(),
            "counted_minutes": min(int(entry["normal_minutes"]), minutes)}


# ── Vacation supplémentaire (maintien) ───────────────────────────────────────────────────
def previous_shift(events: list[Any], site_id: int | None) -> tuple[dict[str, Any], Any] | None:
    """Dernière vacation comptabilisée de l'employé (instantané du dernier événement qui en porte
    un) et son événement, si c'est une vacation NORMALE de ce site. Une vacation supplémentaire
    n'en ouvre jamais une autre."""
    for event in reversed(events):
        snapshot = event.data.get("counted") if isinstance(event.data, dict) else None
        if isinstance(snapshot, dict):
            if snapshot.get("kind", KIND_NORMAL) != KIND_NORMAL or event.site_id != site_id:
                return None
            return snapshot, event
    return None


def in_extra_slot(previous: dict[str, Any], at: datetime) -> bool:
    """`at` tombe dans le créneau qui suit la vacation précédente (TFIN → TFIN + durée normale)."""
    end = datetime.fromisoformat(previous["scheduled_end"])
    return end <= at < end + timedelta(minutes=int(previous["normal_minutes"]))


def extra_entry(previous: dict[str, Any], at: datetime, *, previous_event_id: int | None = None,
                manual_allowed: bool = False) -> dict[str, Any]:
    """Instantané d'une nouvelle entrée à `at` après la vacation `previous`. Les bornes se
    comptent depuis TFIN (fin THÉORIQUE de la vacation précédente), jamais depuis sa sortie réelle."""
    end = datetime.fromisoformat(previous["scheduled_end"])
    opens, closes = end + EXTRA_NO_ENTRY, end + EXTRA_WINDOW_END
    if not previous.get("actual_exit"):
        status = PREVIOUS_SHIFT_NOT_CLOSED
    elif at < opens:
        status = EXTRA_BEFORE_WINDOW
    elif at <= closes:
        status = ENTRY_EXTRA_IN_WINDOW
    else:
        status = ENTRY_EXTRA_MANUAL if manual_allowed else MANUAL_ENTRY_REQUIRED
    shift = next((code for code, (start, _end) in official.SHIFT_TIMES.items() if start == end.strftime("%H:%M")), None)
    return {
        "kind": KIND_EXTRA, "regime": previous["regime"], "group": previous["group"], "shift": shift,
        "work_date": end.date().isoformat(), "cycle_day": None, "model_version": previous.get("model_version"),
        "scheduled_start": end.isoformat(), "scheduled_end": (end + timedelta(minutes=int(previous["normal_minutes"]))).isoformat(),
        "normal_minutes": previous["normal_minutes"], "window_opens_at": opens.isoformat(), "window_closes_at": closes.isoformat(),
        "entry_status": status, "actual_entry": at.isoformat(),
        "counted_start": at.isoformat() if status not in REFUSALS else None,
        "actual_exit": None, "counted_end": None, "counted_minutes": None,
        "previous": {"event_id": previous_event_id, **{key: previous.get(key) for key in (
            "shift", "work_date", "scheduled_start", "scheduled_end", "actual_entry", "actual_exit", "counted_minutes")}},
    }


# ── Vacation visée par une entrée ────────────────────────────────────────────────────────
def entry(db: Session, *, employee_id: int, site_id: int, at: datetime) -> dict[str, Any] | None:
    """Instantané d'une entrée à `at`, ou None si aucune vacation officielle n'est à
    comptabiliser (hors travail posté, rotation non configurée, OFF, vacation terminée)."""
    plan = official.official_shift(db, employee_id=employee_id, site_id=site_id, at=at)
    if not plan["official"]:
        return None
    if not plan["in_progress"]:
        # Vacation dont la fenêtre d'arrivée est ouverte sans être celle de la journée civile
        # de `at` (début peu après minuit) : c'est elle que l'entrée anticipe.
        ahead = official.official_shift(db, employee_id=employee_id, site_id=site_id, at=at + EARLY_WINDOW)
        if ahead["official"] and ahead["working"] and ahead["scheduled_start"] - EARLY_WINDOW <= at < ahead["scheduled_start"]:
            plan = ahead
    if not plan["working"] or at >= plan["scheduled_end"]:
        return None
    return classify_entry(plan, at)


# ── Lecture (projections) ────────────────────────────────────────────────────────────────
def view(data: Any) -> dict[str, Any] | None:
    """Instantané porté par un événement ou une journée (`data` JSON), avec ses libellés."""
    snapshot = data.get("counted") if isinstance(data, dict) else None
    if not isinstance(snapshot, dict):
        return None
    kind = snapshot.get("kind", KIND_NORMAL)
    return {**snapshot, "kind": kind, "kind_label": KIND_LABELS.get(kind),
            "shift_label": official.SHIFT_LABELS.get(snapshot.get("shift") or ""),
            "entry_status_label": ENTRY_STATUS_LABELS.get(snapshot.get("entry_status") or "")}
