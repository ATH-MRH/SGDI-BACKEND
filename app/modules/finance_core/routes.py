from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.finance_core import service
from app.modules.finance_core.accounting_bridge import handle_financial_event
from app.modules.finance_core.models import AccountingEvent, Settlement
from app.modules.finance_core.schemas import (
    ObligationCreate,
    ObligationOut,
    PaymentIntentCreate,
    ReversalRequest,
    SettleRequest,
    SettlementOut,
)

router = APIRouter(dependencies=[Depends(current_user)])


# ── Scope société — même patron que achats/ventes/accounting (P0-B) ───────────────────
def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _effective_society(user: User, requested: str | None) -> str | None:
    allowed = _allowed_societies(user)
    if requested:
        _ensure_society_allowed(user, requested)
        return requested
    if len(allowed) == 1:
        return allowed[0]
    return None


@router.get("/societies")
def known_societies(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Sociétés réellement connues du périmètre Finance (obligations/comptes bancaires/paie),
    respectant authorized_societies — alimente le sélecteur d'en-tête et la vue groupe Cockpit
    DG (frontend V2). Lecture/agrégat pur, voir service.list_known_societies."""
    allowed = _allowed_societies(user)
    return {"items": service.list_known_societies(db, allowed=allowed or None)}


@router.get("/obligations")
def obligations_page(
    society: str | None = None, direction: str | None = None, status_filter: str | None = None,
    page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    allowed = _allowed_societies(user)
    effective = _effective_society(user, society)
    return service.list_obligations(
        db, society=effective, allowed=allowed if allowed and not effective else None,
        direction=direction, status_filter=status_filter, page=page, page_size=page_size,
    )


@router.get("/obligations/{obligation_id}", response_model=ObligationOut)
def get_obligation(obligation_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    obligation = service.get_obligation_or_404(db, obligation_id)
    _ensure_society_allowed(user, obligation.society)
    return obligation


@router.post("/obligations", response_model=ObligationOut)
def create_obligation(payload: ObligationCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    obligation = service.create_obligation(
        db, society=payload.society, direction=payload.direction, source_type=payload.source_type,
        source_id=payload.source_id, amount_total=payload.amount_total,
        counterparty_name=payload.counterparty_name, due_date=payload.due_date,
        currency=payload.currency, notes=payload.notes, idempotency_key=payload.idempotency_key,
    )
    db.commit()
    db.refresh(obligation)
    return obligation


@router.post("/obligations/{obligation_id}/cancel", response_model=ObligationOut)
def cancel_obligation(obligation_id: int, reason: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    obligation = service.get_obligation_or_404(db, obligation_id)
    _ensure_society_allowed(user, obligation.society)
    obligation = service.cancel_obligation(db, obligation_id, reason=reason)
    db.commit()
    db.refresh(obligation)
    return obligation


@router.post("/obligations/{obligation_id}/settle", response_model=SettlementOut)
def settle_obligation(obligation_id: int, payload: SettleRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    obligation = service.get_obligation_or_404(db, obligation_id)
    _ensure_society_allowed(user, obligation.society)
    settlement = service.settle_obligation(
        db, obligation_id=obligation_id, amount=payload.amount, society=obligation.society,
        payment_intent_id=payload.payment_intent_id, bank_transaction_id=payload.bank_transaction_id,
        idempotency_key=payload.idempotency_key, notes=payload.notes,
    )
    db.commit()
    db.refresh(settlement)
    return settlement


@router.post("/settlements/{settlement_id}/reverse", response_model=SettlementOut)
def reverse_settlement(settlement_id: int, payload: ReversalRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = db.get(Settlement, settlement_id)
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Règlement introuvable")
    _ensure_society_allowed(user, existing.society)
    reversal = service.reverse_settlement(db, settlement_id=settlement_id, reason=payload.reason, idempotency_key=payload.idempotency_key)
    db.commit()
    db.refresh(reversal)
    return reversal


@router.post("/payment-intents")
def create_payment_intent(payload: PaymentIntentCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    intent = service.create_payment_intent(
        db, society=payload.society, direction=payload.direction, amount=payload.amount,
        obligation_id=payload.obligation_id, method=payload.method, planned_date=payload.planned_date,
        currency=payload.currency, notes=payload.notes, idempotency_key=payload.idempotency_key,
    )
    db.commit()
    db.refresh(intent)
    return {
        "id": intent.id, "society": intent.society, "obligation_id": intent.obligation_id,
        "direction": intent.direction, "amount": str(intent.amount), "status": intent.status,
    }


# ── Accounting Bridge (P1-B) — traitement de l'outbox ──────────────────────────────────
# Réservé aux rôles Administration (impact transverse toutes sociétés) : déclenche le
# traitement des événements financiers en attente (patron outbox, §P0-F) — en production,
# appelé par une tâche planifiée ; exposé ici en POST pour rester déclenchable manuellement
# et testable sans dépendre d'un scheduler.
def _require_admin(user: User) -> None:
    role = str(getattr(user, "role", "") or "").strip().lower()
    if role not in {"admin", "adm", "adm1", "adm2"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Réservé à l'administration")


@router.post("/outbox/dispatch")
def dispatch_outbox(limit: int = 50, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _require_admin(user)
    return service.dispatch_pending_events(db, handler=lambda event: handle_financial_event(db, event), limit=limit)


@router.get("/accounting-events")
def list_accounting_events(
    society: str | None = None, status_filter: str | None = None,
    limit: int = 200, offset: int = 0,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    # limit/offset (pas une enveloppe {items,total,...}) : ajoutés pour le frontend V2 sans
    # changer la forme de réponse existante (liste brute) — tous les appelants actuels
    # (tests + E2E) itèrent directement dessus ; défaut à 200 pour rester sans effet sur eux.
    from sqlalchemy import select as _select
    safe_limit = min(max(int(limit or 200), 1), 500)
    safe_offset = max(int(offset or 0), 0)
    stmt = _select(AccountingEvent)
    if society:
        stmt = stmt.where(AccountingEvent.society == society)
    if status_filter:
        stmt = stmt.where(AccountingEvent.status == status_filter)
    rows = db.scalars(stmt.order_by(AccountingEvent.id.desc()).limit(safe_limit).offset(safe_offset)).all()
    return [
        {"id": r.id, "society": r.society, "source_type": r.source_type, "source_id": r.source_id,
         "ecriture_id": r.ecriture_id, "status": r.status, "last_error": r.last_error}
        for r in rows
    ]
