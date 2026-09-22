"""ATLAS Finance Core — Accounting Bridge (P1-B).

Consomme les FinancialEvent (via l'outbox, P0-F) et matérialise l'impact comptable
correspondant en réutilisant app.modules.accounting.auto (mêmes comptes PCN, même statut
"brouillon" — un comptable valide ensuite manuellement, comme pour tout le reste de la
comptabilité existante). Une seule implémentation du double-entry (_create_ecriture dans
accounting/auto.py), jamais une seconde.

handle_financial_event() est le handler passé à finance_core.service.dispatch_pending_events
— appelé par une tâche planifiée ou par l'endpoint POST /finance-core/outbox/dispatch
(traitement différé assumé, pas un bridge temps réel synchrone dans ce lot, cohérent avec
le patron outbox : la transaction métier qui règle une obligation ne doit jamais échouer à
cause d'un problème du côté comptable).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.accounting import auto as accounting_auto
from app.modules.finance_core.models import AccountingEvent, FinancialEvent, FinancialObligation, Settlement


def _existing_accounting_event(db: Session, idempotency_key: str) -> AccountingEvent | None:
    return db.scalar(select(AccountingEvent).where(AccountingEvent.idempotency_key == idempotency_key))


def handle_financial_event(db: Session, event: FinancialEvent) -> None:
    """Traite UN événement financier — lève une exception en cas d'échec réel (capturée par
    dispatch_pending_events, qui marque l'entrée outbox "failed" sans bloquer les autres)."""
    if event.event_type != "settlement.created":
        return  # les autres types d'événement n'ont pas (encore) de contrepartie comptable dédiée

    idempotency_key = f"acc:{event.idempotency_key}"
    existing = _existing_accounting_event(db, idempotency_key)
    if existing and existing.status in ("posted", "skipped"):
        # "skipped" = préempté par settle_obligation(skip_accounting_bridge=True) : l'appelant
        # (ex. achats.payer_facture) a déjà posté sa propre écriture pour ce règlement —
        # reposter ici créerait un double comptage.
        return

    settlement = db.get(Settlement, event.aggregate_id)
    if not settlement:
        raise ValueError(f"Settlement {event.aggregate_id} introuvable pour l'événement {event.id}")
    obligation = db.get(FinancialObligation, settlement.obligation_id)
    if not obligation:
        raise ValueError(f"Obligation {settlement.obligation_id} introuvable pour le règlement {settlement.id}")

    accounting_event = existing or AccountingEvent(
        society=settlement.society, source_type="settlement", source_id=settlement.id,
        status="pending", idempotency_key=idempotency_key,
    )
    if not existing:
        db.add(accounting_event)
        db.flush()

    try:
        ecriture = accounting_auto.ecriture_settlement(
            db, society=settlement.society, direction=obligation.direction, amount=settlement.amount,
            counterparty_name=obligation.counterparty_name, reference=obligation.source_id,
            settlement_date=settlement.settled_at.date() if settlement.settled_at else None,
        )
        accounting_event.ecriture_id = ecriture.id if ecriture else None
        accounting_event.status = "posted" if ecriture else "skipped"
        accounting_event.last_error = None
    except Exception as exc:  # noqa: BLE001 — statut "failed" tracé, jamais avalé silencieusement
        accounting_event.status = "failed"
        accounting_event.last_error = str(exc)[:2000]
        db.flush()
        raise
    db.flush()
