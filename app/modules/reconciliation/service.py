"""ATLAS Reconciliation Engine — service (P1-F).

Moteur de scoring RÉEL (pas un stub) mais délibérément simple et explicable : chaque
proposition porte une explication textuelle listant les critères qui ont contribué au score,
jamais une boîte noire. Aucun rapprochement n'est jamais confirmé automatiquement — le
moteur PROPOSE (ReconciliationCase.status="proposed"), un humain CONFIRME
(service.confirm_case, seul chemin qui crée réellement des Settlement).
"""
from __future__ import annotations

import itertools
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.banking.models import BankTransaction
from app.modules.finance_core import service as finance_core_service
from app.modules.finance_core.models import FinancialObligation
from app.modules.reconciliation.models import BankingException, ReconciliationCase, ReconciliationMatch

CONFIDENCE_THRESHOLD = 70
MAX_CANDIDATES_FOR_COMBINATION = 8
MAX_COMBINATION_SIZE = 4


def _obligation_direction_for(amount: Decimal) -> str:
    """Un crédit bancaire (montant positif) règle une créance (receivable) ; un débit
    (montant négatif) règle une dette (payable) — c'est la seule règle de signe utilisée."""
    return "receivable" if amount > 0 else "payable"


def _score_pair(transaction: BankTransaction, obligation: FinancialObligation) -> tuple[int, list[str]]:
    reasons: list[str] = []
    score = 0
    remaining = finance_core_service.amount_remaining(obligation)
    tx_amount = abs(transaction.amount)

    if tx_amount == remaining:
        score += 50
        reasons.append(f"montant exact ({tx_amount})")
    elif remaining > 0 and abs(tx_amount - remaining) / remaining <= Decimal("0.01"):
        score += 30
        reasons.append(f"montant proche à 1% ({tx_amount} ≈ {remaining})")

    ref = (transaction.reference or "") + " " + (transaction.label or "")
    ref_lower = ref.lower()
    if obligation.source_id and obligation.source_id.lower() in ref_lower:
        score += 30
        reasons.append(f"référence obligation trouvée dans le libellé/référence ({obligation.source_id})")
    if obligation.counterparty_name and obligation.counterparty_name.lower() in ref_lower:
        score += 15
        reasons.append("nom de la contrepartie retrouvé dans le libellé")

    if obligation.due_date and transaction.value_date:
        delta = abs((transaction.value_date - obligation.due_date).days)
        if delta <= 7:
            score += 20
            reasons.append(f"date proche de l'échéance ({delta} j)")
        elif delta <= 30:
            score += 10
            reasons.append(f"date dans le mois de l'échéance ({delta} j)")

    return min(score, 100), reasons


def _open_obligation_candidates(db: Session, society: str, direction: str) -> list[FinancialObligation]:
    stmt = select(FinancialObligation).where(
        FinancialObligation.society == society,
        FinancialObligation.direction == direction,
        FinancialObligation.status.in_(("open", "partially_settled")),
    )
    return list(db.scalars(stmt).all())


def _create_case(
    db: Session, *, society: str, kind: str, confidence: int, explanation: str, total_amount: Decimal,
    matches: list[tuple[int, int, Decimal]], idempotency_key: str,
) -> ReconciliationCase:
    existing = db.scalar(select(ReconciliationCase).where(ReconciliationCase.idempotency_key == idempotency_key))
    if existing:
        return existing
    case = ReconciliationCase(
        society=society, kind=kind, status="proposed", confidence_score=confidence,
        explanation=explanation, total_amount=total_amount, idempotency_key=idempotency_key,
    )
    db.add(case)
    db.flush()
    for tx_id, obligation_id, amount in matches:
        db.add(ReconciliationMatch(case_id=case.id, bank_transaction_id=tx_id, obligation_id=obligation_id, amount_imputed=amount))
    db.flush()
    return case


def propose_matches_for_transaction(db: Session, transaction_id: int) -> ReconciliationCase | None:
    """Cherche le meilleur rapprochement pour UNE transaction : d'abord 1:1 (le candidat le
    mieux noté), sinon 1:N (une combinaison de petites obligations dont la somme égale
    exactement le montant de la transaction). Retourne None (et journalise une exception) si
    rien d'assez fiable n'est trouvé."""
    transaction = db.get(BankTransaction, transaction_id)
    if not transaction:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction introuvable")
    if transaction.reconcile_status != "unmatched":
        return None
    from app.modules.banking.models import BankStatement
    statement = db.get(BankStatement, transaction.bank_statement_id)
    if statement and statement.closed:
        # Garde-fou explicite (P1-H) : en pratique close_statement() refuse déjà de clôturer
        # un relevé avec des transactions non rapprochées, donc ce cas ne devrait jamais se
        # produire — mais un rapprochement ne doit JAMAIS être proposé sur une période gelée,
        # même si un futur chemin de code venait à contourner cette garantie.
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Relevé clôturé — période gelée, aucun nouveau rapprochement possible")

    direction = _obligation_direction_for(transaction.amount)
    candidates = _open_obligation_candidates(db, transaction.society, direction)
    tx_amount = abs(transaction.amount)

    # 1:1 — meilleur candidat individuel
    scored = sorted(
        ((ob, *_score_pair(transaction, ob)) for ob in candidates),
        key=lambda t: t[1], reverse=True,
    )
    if scored and scored[0][1] >= CONFIDENCE_THRESHOLD:
        best_ob, best_score, reasons = scored[0]
        remaining = finance_core_service.amount_remaining(best_ob)
        imputed = min(tx_amount, remaining)
        return _create_case(
            db, society=transaction.society, kind="1:1", confidence=best_score,
            explanation="; ".join(reasons), total_amount=imputed,
            matches=[(transaction.id, best_ob.id, imputed)],
            idempotency_key=f"rc:1:1:{transaction.id}:{best_ob.id}",
        )

    # 1:N — combinaison de candidats (même contrepartie de préférence) dont la somme des
    # restes-à-régler égale exactement le montant de la transaction. Recherche bornée
    # (MAX_CANDIDATES_FOR_COMBINATION candidats, combinaisons jusqu'à MAX_COMBINATION_SIZE)
    # — un vrai calcul, pas une approximation, mais volontairement borné pour rester rapide.
    pool = sorted(candidates, key=lambda ob: finance_core_service.amount_remaining(ob))[:MAX_CANDIDATES_FOR_COMBINATION]
    for size in range(2, MAX_COMBINATION_SIZE + 1):
        for combo in itertools.combinations(pool, size):
            total = sum((finance_core_service.amount_remaining(ob) for ob in combo), Decimal("0"))
            if total == tx_amount:
                explanation = f"somme exacte de {size} obligations ouvertes = montant transaction ({tx_amount})"
                matches = [(transaction.id, ob.id, finance_core_service.amount_remaining(ob)) for ob in combo]
                return _create_case(
                    db, society=transaction.society, kind="1:N", confidence=65,
                    explanation=explanation, total_amount=tx_amount, matches=matches,
                    idempotency_key=f"rc:1:N:{transaction.id}:{'-'.join(str(ob.id) for ob in combo)}",
                )

    _record_exception(db, transaction, reason="Aucune proposition suffisamment fiable (score < seuil, aucune combinaison exacte)")
    return None


def propose_n_to_one_for_obligation(db: Session, obligation_id: int, *, window_days: int = 60) -> ReconciliationCase | None:
    """Cherche si PLUSIEURS transactions non rapprochées, de la même société et du même sens,
    dans une fenêtre de `window_days`, somment exactement le reste à régler d'UNE obligation
    (paiement échelonné). Recherche bornée comme pour le 1:N."""
    obligation = finance_core_service.get_obligation_or_404(db, obligation_id)
    remaining = finance_core_service.amount_remaining(obligation)
    if remaining <= 0:
        return None
    sign_direction = obligation.direction
    stmt = select(BankTransaction).where(
        BankTransaction.society == obligation.society, BankTransaction.reconcile_status == "unmatched",
    )
    candidates = [
        t for t in db.scalars(stmt).all()
        if _obligation_direction_for(t.amount) == sign_direction
    ]
    if obligation.due_date:
        candidates = [
            t for t in candidates
            if t.value_date and abs((t.value_date - obligation.due_date).days) <= window_days
        ]
    pool = sorted(candidates, key=lambda t: abs(t.amount))[:MAX_CANDIDATES_FOR_COMBINATION]
    for size in range(2, MAX_COMBINATION_SIZE + 1):
        for combo in itertools.combinations(pool, size):
            total = sum((abs(t.amount) for t in combo), Decimal("0"))
            if total == remaining:
                explanation = f"{size} transactions dont la somme égale exactement le reste à régler ({remaining})"
                matches = [(t.id, obligation.id, abs(t.amount)) for t in combo]
                return _create_case(
                    db, society=obligation.society, kind="N:1", confidence=65,
                    explanation=explanation, total_amount=remaining, matches=matches,
                    idempotency_key=f"rc:N:1:{obligation.id}:{'-'.join(str(t.id) for t in combo)}",
                )
    return None


def _record_exception(db: Session, transaction: BankTransaction, *, reason: str) -> None:
    existing = db.scalar(select(BankingException).where(BankingException.bank_transaction_id == transaction.id))
    if existing:
        existing.reason = reason
        existing.resolved = 0
        return
    db.add(BankingException(society=transaction.society, bank_transaction_id=transaction.id, reason=reason, resolved=0))


def confirm_case(db: Session, case_id: int, *, confirmed_by: str) -> ReconciliationCase:
    """SEUL chemin qui transforme une proposition en règlement réel — appelle
    finance_core.service.settle_obligation pour CHAQUE ligne du cas, avec bank_transaction_id
    renseigné (P1-G, moteur de règlement). Idempotent au niveau de chaque settlement (clé
    dérivée du match), donc rejouable sans double règlement."""
    from datetime import datetime

    case = db.get(ReconciliationCase, case_id)
    if not case:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Cas de rapprochement introuvable")
    if case.status != "proposed":
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Cas déjà {case.status}, confirmation impossible")

    matches = list(db.scalars(select(ReconciliationMatch).where(ReconciliationMatch.case_id == case.id)).all())
    for match in matches:
        settlement = finance_core_service.settle_obligation(
            db, obligation_id=match.obligation_id, amount=match.amount_imputed, society=case.society,
            bank_transaction_id=match.bank_transaction_id,
            idempotency_key=f"stl:case:{case.id}:match:{match.id}",
            notes=f"Rapprochement automatique (cas #{case.id}, {case.kind})",
        )
        match.settlement_id = settlement.id
        transaction = db.get(BankTransaction, match.bank_transaction_id)
        if transaction:
            transaction.reconcile_status = "matched"
            transaction.stage = "enriched"

    case.status = "confirmed"
    case.confirmed_by = confirmed_by
    case.confirmed_at = datetime.utcnow()
    db.flush()
    return case


def reject_case(db: Session, case_id: int, *, reason: str) -> ReconciliationCase:
    case = db.get(ReconciliationCase, case_id)
    if not case:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Cas de rapprochement introuvable")
    if case.status != "proposed":
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Cas déjà {case.status}")
    case.status = "rejected"
    case.rejected_reason = reason
    db.flush()
    return case


def list_exceptions(db: Session, *, society: str | None, allowed: list[str] | None, resolved: bool | None = None) -> list[BankingException]:
    stmt = select(BankingException)
    if society:
        stmt = stmt.where(BankingException.society == society)
    elif allowed:
        stmt = stmt.where(BankingException.society.in_(allowed))
    if resolved is not None:
        stmt = stmt.where(BankingException.resolved == (1 if resolved else 0))
    return list(db.scalars(stmt.order_by(BankingException.id.desc())).all())
