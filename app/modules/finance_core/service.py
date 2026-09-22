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
from sqlalchemy import select, update as sa_update
from sqlalchemy.exc import IntegrityError
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


MAX_OUTBOX_ATTEMPTS = 5


def dispatch_pending_events(db: Session, *, handler, limit: int = 50) -> dict:
    """Traite les entrées outbox en attente (P0-F) : appelle `handler(financial_event)` pour
    chacune, marque "dispatched" en cas de succès, "failed" + last_error sinon — SANS jamais
    interrompre le traitement des autres entrées sur l'échec d'une seule. Conçu pour être
    appelé par une tâche planifiée (pas de dispatch temps réel synchrone dans ce lot), ce qui
    est le patron outbox standard : la transaction métier qui écrit l'événement ne dépend
    jamais de la disponibilité du bridge comptable pour réussir.

    P0 (revue d'intégrité, item 6/7) — TROUVÉ PENDANT L'AUDIT, deux défauts distincts :

    (a) Une entrée "failed" n'était JAMAIS reprise par un dispatch ultérieur (la requête ne
    portait que sur status == "pending") — un échec transitoire (bridge comptable
    momentanément indisponible) laissait l'écriture comptable définitivement manquante,
    silencieusement, sans aucune nouvelle tentative. Corrigé : les entrées "failed" sous
    MAX_OUTBOX_ATTEMPTS tentatives sont reprises comme les "pending" ; au-delà, elles restent
    "failed" mais ne sont plus reprises automatiquement (intervention manuelle nécessaire,
    tracée par last_error/attempts — jamais une boucle de nouvelles tentatives infinie).

    (b) Si `handler(event)` échouait APRÈS avoir déjà écrit une partie de son effet (ex. un
    AccountingEvent créé puis une erreur avant la fin de ecriture_settlement), rien
    n'annulait cette écriture partielle avant le db.commit() final du lot entier — une
    donnée comptable BRISÉE (déséquilibrée) aurait pu être committée. Corrigé par un
    SAVEPOINT (transaction imbriquée) par entrée : un échec annule UNIQUEMENT l'effet
    partiel de CETTE entrée, jamais celui des entrées déjà traitées avec succès dans le
    même lot ni la mise à jour du statut/attempts de l'entrée elle-même (appliquée APRÈS le
    rollback du savepoint, donc hors de sa portée)."""
    pending = db.scalars(
        select(FinanceOutboxEvent)
        .where(
            (FinanceOutboxEvent.status == "pending")
            | ((FinanceOutboxEvent.status == "failed") & (FinanceOutboxEvent.attempts < MAX_OUTBOX_ATTEMPTS))
        )
        .limit(limit)
    ).all()
    dispatched, failed = 0, 0
    for entry in pending:
        event = db.get(FinancialEvent, entry.financial_event_id)
        entry.attempts += 1
        savepoint = db.begin_nested()
        try:
            handler(event)
            savepoint.commit()
            entry.status = "dispatched"
            from datetime import datetime
            entry.dispatched_at = datetime.utcnow()
            dispatched += 1
        except Exception as exc:  # noqa: BLE001 — isolation volontaire, voir docstring
            savepoint.rollback()
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


def find_obligation_by_source(db: Session, *, source_type: str, source_id: str) -> FinancialObligation | None:
    """Retrouve l'obligation créée pour un enregistrement métier donné (P1-C : permet à
    achats/ventes d'appeler settle_obligation() depuis leur propre flux de paiement existant
    sans avoir à connaître/stocker l'obligation_id)."""
    return db.scalar(
        select(FinancialObligation).where(
            FinancialObligation.source_type == source_type, FinancialObligation.source_id == str(source_id),
        )
    )


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
    idempotency_key: str, notes: str | None = None, skip_accounting_bridge: bool = False,
) -> Settlement:
    """Règle (totalement ou partiellement) une obligation. JAMAIS de dépassement silencieux :
    un montant qui excéderait le reste à régler est refusé explicitement (pas de trop-perçu
    implicite — un trop-perçu réel doit être un settlement de kind="overpayment" saisi en
    connaissance de cause, non implémenté automatiquement dans ce lot).

    skip_accounting_bridge=True : à utiliser UNIQUEMENT quand l'appelant a DÉJÀ posté sa
    propre écriture comptable pour ce paiement (ex. achats.payer_facture appelle encore
    directement ecriture_paiement_fournisseur, chemin pré-existant conservé pour ne rien
    casser) — évite que le pont comptable (accounting_bridge) ne re-poste une SECONDE
    écriture pour le même règlement lors d'un futur dispatch de l'outbox (double comptage).

    P0 (revue d'intégrité, item 5 — double paiement) — TROUVÉ PENDANT L'AUDIT, reproduit
    empiriquement par un test de concurrence réelle (tests/test_finance_concurrency.py, vrais
    threads, vrai serveur, vraie base) : la version précédente lisait `remaining` sur l'objet
    Python PUIS écrivait `amount_settled` en deux temps distincts — une course franche
    (TOCTOU) entre requêtes concurrentes sur la MÊME obligation permettait un dépassement réel
    du montant dû (5 règlements de 30.00 tous acceptés sur un dû de 100.00). Corrigé par une
    UPDATE ... WHERE atomique (compare-and-swap en base, portable SQLite/Postgres, jamais une
    dépendance à un niveau d'isolation particulier) : la ligne n'est incrémentée QUE si la
    contrainte est encore respectée AU MOMENT DE L'ÉCRITURE, jamais sur une lecture devenue
    périmée entre-temps."""
    existing = _existing_by_key(db, Settlement, idempotency_key)
    if existing:
        return existing
    obligation = get_obligation_or_404(db, obligation_id)
    if obligation.status == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Obligation annulée, règlement impossible")
    amt = q2(amount)
    if amt <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Montant de règlement invalide")

    intent = None
    if payment_intent_id is not None:
        # P0 (revue d'intégrité, item 10 — multi-société) — TROUVÉ PENDANT L'AUDIT : aucune
        # vérification que payment_intent_id référence bien une intention créée POUR CETTE
        # obligation. Un appelant pouvait faire régler N'IMPORTE QUELLE obligation (y compris
        # d'une autre société) en passant l'id d'un PaymentIntent appartenant à une TOUT AUTRE
        # obligation — celui-ci se retrouvait alors marqué "settled" par effet de bord, sans
        # aucun lien réel avec le règlement en cours (corruption d'état inter-locataire).
        # Vérifié AVANT toute écriture (y compris l'UPDATE atomique ci-dessous) pour ne rien
        # avoir à annuler en cas de refus.
        intent = db.get(PaymentIntent, payment_intent_id)
        if not intent:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Intention de paiement introuvable")
        if intent.obligation_id != obligation.id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Cette intention de paiement ne correspond pas à l'obligation réglée",
            )

    cas_result = db.execute(
        sa_update(FinancialObligation)
        .where(
            FinancialObligation.id == obligation_id,
            FinancialObligation.status != "cancelled",
            (FinancialObligation.amount_settled + amt) <= FinancialObligation.amount_total,
        )
        .values(amount_settled=FinancialObligation.amount_settled + amt)
    )
    if cas_result.rowcount == 0:
        # Deux causes possibles, à distinguer explicitement plutôt que refuser à l'aveugle :
        # (a) une requête CONCURRENTE avec la MÊME idempotency_key vient de committer entre
        #     notre vérification initiale et cet UPDATE — un simple retry légitime, doit
        #     renvoyer LE MÊME règlement (200), jamais une erreur ; (b) le reste à régler est
        #     réellement insuffisant — refus 409 explicite, avec le reste réellement à jour.
        db.rollback()
        winner = _existing_by_key(db, Settlement, idempotency_key)
        if winner:
            return winner
        obligation = get_obligation_or_404(db, obligation_id)
        remaining = amount_remaining(obligation)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Montant ({amt}) supérieur au reste à régler ({remaining}) — trop-perçu non automatique",
        )
    db.refresh(obligation)
    obligation.status = "settled" if obligation.amount_settled >= obligation.amount_total else "partially_settled"

    settlement = Settlement(
        society=society or obligation.society, obligation_id=obligation.id,
        payment_intent_id=payment_intent_id, bank_transaction_id=bank_transaction_id,
        amount=amt, kind="normal", idempotency_key=idempotency_key, notes=notes,
    )
    db.add(settlement)
    if intent is not None:
        intent.status = "settled"
    try:
        db.flush()
    except IntegrityError:
        # Course sur idempotency_key : notre UPDATE atomique ci-dessus a réussi (il n'y avait
        # pas de conflit sur LE MONTANT), mais une transaction concurrente pour LA MÊME clé a
        # inséré son propre Settlement entre-temps et gagné la contrainte UNIQUE. Annule
        # notre propre incrément (sinon double comptage) et renvoie le règlement gagnant —
        # jamais une IntegrityError brute remontée à l'appelant, jamais un second règlement.
        db.rollback()
        winner = _existing_by_key(db, Settlement, idempotency_key)
        if winner:
            return winner
        raise
    event = emit_event(
        db, society=obligation.society, event_type="settlement.created", aggregate_type="settlement",
        aggregate_id=settlement.id,
        payload={"obligation_id": obligation.id, "amount": str(amt), "kind": "normal"},
        idempotency_key=f"evt:{idempotency_key}:created",
    )
    if skip_accounting_bridge:
        _preempt_accounting_event(db, event, society=obligation.society, reason="Écriture déjà postée par l'appelant (chemin métier existant)")
    return settlement


def _preempt_accounting_event(db: Session, event: FinancialEvent, *, society: str | None, reason: str) -> None:
    """Écrit un AccountingEvent status="skipped" PAR AVANCE pour que le pont comptable
    (accounting_bridge.handle_financial_event) ne tente jamais de reposter une écriture pour
    cet événement lors d'un futur dispatch de l'outbox."""
    from app.modules.finance_core.models import AccountingEvent
    key = f"acc:{event.idempotency_key}"
    if _existing_by_key(db, AccountingEvent, key):
        return
    db.add(AccountingEvent(society=society, source_type="settlement", source_id=event.aggregate_id, status="skipped", last_error=reason, idempotency_key=key))
    db.flush()


def reverse_settlement(db: Session, *, settlement_id: int, reason: str, idempotency_key: str) -> Settlement:
    """Annule un règlement SANS jamais le supprimer (P0-A intégrité) : crée un settlement
    miroir kind="reversal" de montant négatif-équivalent (montant positif, sens inverse porté
    par kind), restaure amount_settled/status de l'obligation.

    P0 (revue d'intégrité, item 5/6) — TROUVÉ PENDANT L'AUDIT : rien n'empêchait auparavant
    d'annuler DEUX FOIS le même règlement (deux appels avec des idempotency_key différentes) —
    chaque annulation décrémente amount_settled, une double annulation pouvait artificiellement
    rouvrir une obligation déjà soldée et permettre un second règlement réel derrière (vecteur
    de double paiement). Garde applicative ci-dessous + index UNIQUE en base (migration
    20260922_0045, défense en profondeur) sur reversed_settlement_id."""
    existing = _existing_by_key(db, Settlement, idempotency_key)
    if existing:
        return existing
    original = db.get(Settlement, settlement_id)
    if not original:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Règlement introuvable")
    if original.kind != "normal":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Seul un règlement normal peut être annulé")
    already_reversed = db.scalar(select(Settlement).where(Settlement.reversed_settlement_id == original.id))
    if already_reversed:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Règlement déjà annulé (annulation #{already_reversed.id})")
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
    try:
        db.flush()
    except IntegrityError:
        # Course : une annulation concurrente (idempotency_key différente) du MÊME règlement
        # a gagné l'index UNIQUE (reversed_settlement_id) entre notre vérification et ce
        # flush — annule notre propre décrément (sinon double comptabilisation) et refuse
        # proprement, jamais une IntegrityError brute.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Règlement déjà annulé (course concurrente détectée)")
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
