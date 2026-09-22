"""ATLAS Finance Core — logique métier (P0-C/P0-F).

Toute écriture passe par ce module — les routes ne font QUE valider les entrées HTTP et
appeler ces fonctions, jamais de logique métier dans routes.py (même discipline que
achats/ventes/accounting déjà en place).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.finance_core.models import (
    AccountingEvent,
    FinanceOutboxEvent,
    FinancialEvent,
    FinancialObligation,
    PaymentIntent,
    Settlement,
)

TWO_PLACES = Decimal("0.01")


def q2(value: Any) -> Decimal:
    """Arrondit un montant à 2 décimales — jamais de float dans ce module (P0-D)."""
    return Decimal(str(value)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


# ── Idempotence (P0-F) ──────────────────────────────────────────────────────────────────

def _existing_by_key(db: Session, model, idempotency_key: str):
    return db.scalar(select(model).where(model.idempotency_key == idempotency_key))


def emit_event(
    db: Session,
    *,
    society: str | None,
    event_type: str,
    aggregate_type: str,
    aggregate_id: int,
    payload: dict,
    idempotency_key: str,
) -> FinancialEvent:
    """Écrit un FinancialEvent + son entrée outbox DANS LA MÊME transaction (flush commun,
    P0-F). Idempotent : rejouer la même clé renvoie l'événement déjà écrit sans en créer un
    second ni dupliquer l'entrée outbox."""
    existing = _existing_by_key(db, FinancialEvent, idempotency_key)
    if existing:
        return existing
    event = FinancialEvent(
        society=society, event_type=event_type, aggregate_type=aggregate_type,
        aggregate_id=aggregate_id, payload=payload, idempotency_key=idempotency_key,
    )
    db.add(event)
    db.flush()
    db.add(FinanceOutboxEvent(financial_event_id=event.id, status="pending"))
    db.flush()
    return event


def dispatch_pending_events(db: Session, *, handler, limit: int = 50) -> dict:
    """Traite les entrées outbox en attente (P0-F) : appelle `handler(financial_event)` pour
    chacune, marque "dispatched" en cas de succès, "failed" + last_error sinon — SANS jamais
    interrompre le traitement des autres entrées sur l'échec d'une seule. Conçu pour être
    appelé par une tâche planifiée (pas de dispatch temps réel synchrone dans ce lot), ce qui
    est le patron outbox standard : la transaction métier qui écrit l'événement ne dépend
    jamais de la disponibilité du bridge comptable pour réussir."""
    pending = db.scalars(
        select(FinanceOutboxEvent).where(FinanceOutboxEvent.status == "pending").limit(limit)
    ).all()
    dispatched, failed = 0, 0
    for entry in pending:
        event = db.get(FinancialEvent, entry.financial_event_id)
        entry.attempts += 1
        try:
            handler(event)
            entry.status = "dispatched"
            from datetime import datetime
            entry.dispatched_at = datetime.utcnow()
            dispatched += 1
        except Exception as exc:  # noqa: BLE001 — isolation volontaire, voir docstring
            entry.status = "failed"
            entry.last_error = str(exc)[:2000]
            failed += 1
    db.commit()
    return {"dispatched": dispatched, "failed": failed, "total": len(pending)}


# ── Obligations ─────────────────────────────────────────────────────────────────────────

def create_obligation(
    db: Session,
    *,
    society: str,
    direction: str,
    source_type: str,
    source_id: str,
    amount_total: Any,
    counterparty_name: str | None = None,
    due_date: date | None = None,
    currency: str = "DZD",
    notes: str | None = None,
    idempotency_key: str,
) -> FinancialObligation:
    if direction not in ("receivable", "payable"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="direction invalide")
    existing = _existing_by_key(db, FinancialObligation, idempotency_key)
    if existing:
        return existing
    amount = q2(amount_total)
    if amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="amount_total doit être positif")
    obligation = FinancialObligation(
        society=society, direction=direction, source_type=source_type, source_id=str(source_id),
        counterparty_name=counterparty_name, amount_total=amount, amount_settled=Decimal("0"),
        currency=currency, due_date=due_date, status="open", notes=notes,
        idempotency_key=idempotency_key,
    )
    db.add(obligation)
    db.flush()
    emit_event(
        db, society=society, event_type="obligation.created", aggregate_type="financial_obligation",
        aggregate_id=obligation.id,
        payload={"direction": direction, "source_type": source_type, "source_id": str(source_id), "amount_total": str(amount)},
        idempotency_key=f"evt:{idempotency_key}:created",
    )
    return obligation


def get_obligation_or_404(db: Session, obligation_id: int) -> FinancialObligation:
    obligation = db.get(FinancialObligation, obligation_id)
    if not obligation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Obligation introuvable")
    return obligation


def amount_remaining(obligation: FinancialObligation) -> Decimal:
    return q2(obligation.amount_total) - q2(obligation.amount_settled)


def cancel_obligation(db: Session, obligation_id: int, *, reason: str | None = None) -> FinancialObligation:
    obligation = get_obligation_or_404(db, obligation_id)
    if obligation.status == "settled":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Obligation déjà réglée, annulation impossible")
    obligation.status = "cancelled"
    if reason:
        obligation.notes = f"{obligation.notes or ''}\n[annulée] {reason}".strip()
    db.flush()
    emit_event(
        db, society=obligation.society, event_type="obligation.cancelled", aggregate_type="financial_obligation",
        aggregate_id=obligation.id, payload={"reason": reason},
        idempotency_key=f"evt:obligation:{obligation.id}:cancelled",
    )
    return obligation


# ── Payment intents ─────────────────────────────────────────────────────────────────────

def create_payment_intent(
    db: Session, *, society: str, direction: str, amount: Any, obligation_id: int | None = None,
    method: str | None = None, planned_date: date | None = None, currency: str = "DZD",
    notes: str | None = None, idempotency_key: str,
) -> PaymentIntent:
    existing = _existing_by_key(db, PaymentIntent, idempotency_key)
    if existing:
        return existing
    if obligation_id is not None:
        get_obligation_or_404(db, obligation_id)  # 404 si invalide, jamais un FK orphelin silencieux
    intent = PaymentIntent(
        society=society, obligation_id=obligation_id, direction=direction, amount=q2(amount),
        currency=currency, method=method, status="pending", planned_date=planned_date, notes=notes,
        idempotency_key=idempotency_key,
    )
    db.add(intent)
    db.flush()
    return intent


# ── Settlements (P1-G — moteur de règlement) ───────────────────────────────────────────

def settle_obligation(
    db: Session, *, obligation_id: int, amount: Any, society: str | None = None,
    payment_intent_id: int | None = None, bank_transaction_id: int | None = None,
    idempotency_key: str, notes: str | None = None,
) -> Settlement:
    """Règle (totalement ou partiellement) une obligation. JAMAIS de dépassement silencieux :
    un montant qui excéderait le reste à régler est refusé explicitement (pas de trop-perçu
    implicite — un trop-perçu réel doit être un settlement de kind="overpayment" saisi en
    connaissance de cause, non implémenté automatiquement dans ce lot)."""
    existing = _existing_by_key(db, Settlement, idempotency_key)
    if existing:
        return existing
    obligation = get_obligation_or_404(db, obligation_id)
    if obligation.status == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Obligation annulée, règlement impossible")
    amt = q2(amount)
    if amt <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Montant de règlement invalide")
    remaining = amount_remaining(obligation)
    if amt > remaining:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Montant ({amt}) supérieur au reste à régler ({remaining}) — trop-perçu non automatique",
        )
    settlement = Settlement(
        society=society or obligation.society, obligation_id=obligation.id,
        payment_intent_id=payment_intent_id, bank_transaction_id=bank_transaction_id,
        amount=amt, kind="normal", idempotency_key=idempotency_key, notes=notes,
    )
    db.add(settlement)
    obligation.amount_settled = q2(obligation.amount_settled) + amt
    obligation.status = "settled" if obligation.amount_settled >= obligation.amount_total else "partially_settled"
    if payment_intent_id is not None:
        intent = db.get(PaymentIntent, payment_intent_id)
        if intent:
            intent.status = "settled"
    db.flush()
    emit_event(
        db, society=obligation.society, event_type="settlement.created", aggregate_type="settlement",
        aggregate_id=settlement.id,
        payload={"obligation_id": obligation.id, "amount": str(amt), "kind": "normal"},
        idempotency_key=f"evt:{idempotency_key}:created",
    )
    return settlement


def reverse_settlement(db: Session, *, settlement_id: int, reason: str, idempotency_key: str) -> Settlement:
    """Annule un règlement SANS jamais le supprimer (P0-A intégrité) : crée un settlement
    miroir kind="reversal" de montant négatif-équivalent (montant positif, sens inverse porté
    par kind), restaure amount_settled/status de l'obligation."""
    existing = _existing_by_key(db, Settlement, idempotency_key)
    if existing:
        return existing
    original = db.get(Settlement, settlement_id)
    if not original:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Règlement introuvable")
    if original.kind != "normal":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Seul un règlement normal peut être annulé")
    obligation = get_obligation_or_404(db, original.obligation_id)
    reversal = Settlement(
        society=obligation.society, obligation_id=obligation.id, amount=original.amount,
        kind="reversal", reversed_settlement_id=original.id, notes=reason,
        idempotency_key=idempotency_key,
    )
    db.add(reversal)
    obligation.amount_settled = q2(obligation.amount_settled) - q2(original.amount)
    if obligation.amount_settled < 0:
        obligation.amount_settled = Decimal("0")
    obligation.status = (
        "settled" if obligation.amount_settled >= obligation.amount_total and obligation.amount_total > 0
        else "partially_settled" if obligation.amount_settled > 0 else "open"
    )
    db.flush()
    emit_event(
        db, society=obligation.society, event_type="settlement.reversed", aggregate_type="settlement",
        aggregate_id=reversal.id,
        payload={"obligation_id": obligation.id, "amount": str(original.amount), "reversed_settlement_id": original.id, "reason": reason},
        idempotency_key=f"evt:{idempotency_key}:created",
    )
    return reversal


# ── Lecture (scope société — même patron que achats/ventes) ────────────────────────────

def list_obligations(
    db: Session, *, society: str | None, allowed: list[str] | None, direction: str | None = None,
    status_filter: str | None = None, page: int = 1, page_size: int = 25,
) -> dict:
    stmt = select(FinancialObligation)
    if society:
        stmt = stmt.where(FinancialObligation.society == society)
    elif allowed:
        stmt = stmt.where(FinancialObligation.society.in_(allowed))
    if direction:
        stmt = stmt.where(FinancialObligation.direction == direction)
    if status_filter:
        stmt = stmt.where(FinancialObligation.status == status_filter)
    from app.core.pagination import paginate_statement
    return paginate_statement(db, stmt, model=FinancialObligation, page=page, page_size=page_size)
