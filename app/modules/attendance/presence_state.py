"""État d'une journée de présence (lot 0) : une planification n'est jamais un travail effectué.

La génération par rotation (OPS) crée des journées « prévues » (`generated = 1`) avec le statut
historique `present`, que l'écran legacy relit tel quel : ce statut ne prouve donc rien. L'état
réel se déduit des PREUVES, sans rien réécrire en base :

    POINTÉ      un passage ARRIVÉE / SORTIE (QR, facial, saisie manuelle du pointeur…) est
                rattaché à la journée ;
    JUSTIFIÉ    sans passage : statut saisi ou correction tracés (événement STATUS / CORRECTION,
                saisie OPS, BEO, pointeur, écran legacy), ou journée NON générée (saisie
                historique, antérieure au journal d'événements) ;
    PLANIFIÉ    journée générée, sans aucune preuve : jamais comptée comme travaillée ;
    À VÉRIFIER  journée générée sans événement mais portant des heures (écriture historique dont
                l'origine ne peut pas être établie) : ni comptée, ni écartée en silence ;
    VALIDÉ      journée POINTÉE ou JUSTIFIÉE puis clôturée — seule base de la paie.

Une journée PLANIFIÉE devient POINTÉE ou JUSTIFIÉE par le seul fait d'un pointage, d'une saisie
ou d'une correction autorisés : les règles et habilitations existantes s'appliquent sans changement.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import and_, exists, select
from sqlalchemy.orm import Session

from app.modules.attendance.models import (
    EVENT_ARRIVAL, EVENT_CORRECTION, EVENT_DEPARTURE, EVENT_STATUS, AttendanceEvent,
)
from app.modules.ops.models import DailyPresence

PLANIFIE = "PLANIFIE"
A_VERIFIER = "A_VERIFIER"
POINTE = "POINTE"
JUSTIFIE = "JUSTIFIE"
VALIDE = "VALIDE"
LABELS = {PLANIFIE: "Planifié", A_VERIFIER: "À vérifier", POINTE: "Pointé", JUSTIFIE: "Justifié", VALIDE: "Validé"}

SCAN_EVENTS = (EVENT_ARRIVAL, EVENT_DEPARTURE)
DECLARED_EVENTS = (EVENT_STATUS, EVENT_CORRECTION)
EVIDENCE_EVENTS = SCAN_EVENTS + DECLARED_EVENTS
REAL_BASES = (POINTE, JUSTIFIE)


def evidence_for(db: Session, presence_ids: Iterable[int]) -> dict[int, set[str]]:
    """Preuves rattachées à chaque journée : {"scan"} et/ou {"declared"}. Une seule requête."""
    ids = {int(i) for i in presence_ids if i}
    out: dict[int, set[str]] = {}
    if not ids:
        return out
    for presence_id, event_type in db.execute(select(AttendanceEvent.presence_id, AttendanceEvent.event_type).where(
            AttendanceEvent.presence_id.in_(ids), AttendanceEvent.event_type.in_(EVIDENCE_EVENTS)).distinct()):
        out.setdefault(presence_id, set()).add("scan" if event_type in SCAN_EVENTS else "declared")
    return out


def _has_times(row: DailyPresence) -> bool:
    return bool(str(row.arrival_time or "").strip() or str(row.departure_time or "").strip())


def basis(row: DailyPresence, evidence: set[str] | None) -> str:
    """Origine de la journée, indépendamment de la clôture."""
    evidence = evidence or set()
    if "scan" in evidence:
        return POINTE
    if "declared" in evidence:
        return JUSTIFIE
    if row.generated:
        return A_VERIFIER if _has_times(row) else PLANIFIE
    return JUSTIFIE


def state(row: DailyPresence, evidence: set[str] | None) -> str:
    current = basis(row, evidence)
    return VALIDE if row.closed_at is not None and current in REAL_BASES else current


def is_real(row: DailyPresence | None, evidence: set[str] | None) -> bool:
    """La journée repose sur une preuve (pointage, saisie ou correction, ou saisie historique)."""
    return row is not None and basis(row, evidence) in REAL_BASES


def states_for(db: Session, rows: Iterable[DailyPresence]) -> dict[int, str]:
    rows = [r for r in rows if r is not None and r.id]
    evidence = evidence_for(db, (r.id for r in rows))
    return {r.id: state(r, evidence.get(r.id)) for r in rows}


def real_rows(db: Session, rows: Iterable[DailyPresence]) -> list[DailyPresence]:
    rows = [r for r in rows if r is not None]
    evidence = evidence_for(db, (r.id for r in rows if r.id))
    return [r for r in rows if is_real(r, evidence.get(r.id))]


def unconfirmed_clause():
    """Condition SQL : journée générée sans aucune preuve rattachée (PLANIFIÉ ou À VÉRIFIER).
    Sert aux comptages agrégés, qui ne doivent jamais compter une telle journée comme présente."""
    evidence = exists().where(AttendanceEvent.presence_id == DailyPresence.id,
                              AttendanceEvent.event_type.in_(EVIDENCE_EVENTS))
    return and_(DailyPresence.generated == 1, ~evidence)


def real_clause():
    return ~unconfirmed_clause()


def summarize(db: Session, rows: Iterable[DailyPresence]) -> dict[str, Any]:
    """Comptage par état (aucune donnée personnelle) — rapports de clôture et contrôles."""
    states = states_for(db, rows)
    counts = {key: 0 for key in LABELS}
    for value in states.values():
        counts[value] += 1
    return counts

