"""Trésorerie (P2) — agrégation PURE sur des sources déjà canoniques (BankTransaction pour
le réel bancaire, FinancialObligation pour l'engagé/l'échéancier). Aucune table propre,
aucune donnée fabriquée : une position bancaire ici est la somme réelle des transactions
importées pour ce compte, pas une estimation."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.banking.models import BankAccount, BankTransaction
from app.modules.finance_core.models import FinancialObligation


def _societies_clause(model, society: str | None, allowed: list[str] | None):
    if society:
        return model.society == society
    if allowed:
        return model.society.in_(allowed)
    return None


def bank_positions(db: Session, *, society: str | None, allowed: list[str] | None) -> list[dict]:
    """Position RÉELLE par compte bancaire = somme des transactions importées (crédits
    positifs, débits négatifs) — pas un solde saisi à la main."""
    stmt = select(BankAccount)
    clause = _societies_clause(BankAccount, society, allowed)
    if clause is not None:
        stmt = stmt.where(clause)
    accounts = db.scalars(stmt).all()
    result = []
    # Revue d'intégrité, item 4 (Decimal/arrondis) : rounding=ROUND_HALF_UP explicite sur
    # chaque quantize() de ce module — un quantize() sans rounding= retombe sur le contexte
    # decimal par défaut de Python (ROUND_HALF_EVEN), différent de la politique appliquée
    # partout ailleurs dans le Finance Platform (finance_core/payroll/banking). Trouvé et
    # corrigé de façon identique dans budget/fiscalite/cockpit pendant cette revue.
    for acc in accounts:
        total = db.scalar(select(func.coalesce(func.sum(BankTransaction.amount), 0)).where(BankTransaction.bank_account_id == acc.id)) or 0
        result.append({"bank_account_id": acc.id, "society": acc.society, "bank_name": acc.bank_name, "account_number": acc.account_number, "position": str(Decimal(str(total)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))})
    return result


def echeancier(db: Session, *, society: str | None, allowed: list[str] | None, horizon_days: int = 90) -> dict:
    """Échéancier = obligations ouvertes (engagé), séparées encaissements (receivable) /
    décaissements (payable), triées par échéance. Ne mélange jamais les deux sens."""
    stmt = select(FinancialObligation).where(FinancialObligation.status.in_(("open", "partially_settled")))
    clause = _societies_clause(FinancialObligation, society, allowed)
    if clause is not None:
        stmt = stmt.where(clause)
    rows = db.scalars(stmt.order_by(FinancialObligation.due_date.asc().nulls_last())).all()

    def remaining(o: FinancialObligation) -> Decimal:
        return Decimal(str(o.amount_total)) - Decimal(str(o.amount_settled))

    encaissements = [
        {"obligation_id": o.id, "society": o.society, "counterparty_name": o.counterparty_name, "due_date": str(o.due_date) if o.due_date else None, "amount_remaining": str(remaining(o).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))}
        for o in rows if o.direction == "receivable"
    ]
    decaissements = [
        {"obligation_id": o.id, "society": o.society, "counterparty_name": o.counterparty_name, "due_date": str(o.due_date) if o.due_date else None, "amount_remaining": str(remaining(o).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))}
        for o in rows if o.direction == "payable"
    ]
    return {
        "encaissements_attendus": encaissements, "decaissements_attendus": decaissements,
        "total_encaissements": str(sum((Decimal(e["amount_remaining"]) for e in encaissements), Decimal("0"))),
        "total_decaissements": str(sum((Decimal(d["amount_remaining"]) for d in decaissements), Decimal("0"))),
    }


def cash_forecast(db: Session, *, society: str | None, allowed: list[str] | None) -> dict:
    """Prévisionnel simple et honnête : position bancaire actuelle + échéancier net. Pas de
    modèle statistique/prédictif — une somme arithmétique traçable jusqu'à ses sources,
    conforme à l'exigence 'toujours depuis les sources canoniques'."""
    positions = bank_positions(db, society=society, allowed=allowed)
    total_position = sum((Decimal(p["position"]) for p in positions), Decimal("0"))
    ech = echeancier(db, society=society, allowed=allowed)
    net_echeancier = Decimal(ech["total_encaissements"]) - Decimal(ech["total_decaissements"])
    return {
        "position_bancaire_actuelle": str(total_position.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "net_echeancier_attendu": str(net_echeancier.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "solde_previsionnel": str((total_position + net_echeancier).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "positions": positions, "echeancier": ech,
    }


def exposure(db: Session, *, society: str | None, allowed: list[str] | None) -> dict:
    """Exposition par contrepartie (clients/fournisseurs) — somme des restes à régler par
    counterparty_name, triée décroissante."""
    stmt = select(FinancialObligation).where(FinancialObligation.status.in_(("open", "partially_settled")))
    clause = _societies_clause(FinancialObligation, society, allowed)
    if clause is not None:
        stmt = stmt.where(clause)
    rows = db.scalars(stmt).all()
    by_counterparty: dict[str, Decimal] = {}
    for o in rows:
        key = f"{o.direction}:{o.counterparty_name or 'Inconnu'}"
        by_counterparty[key] = by_counterparty.get(key, Decimal("0")) + (Decimal(str(o.amount_total)) - Decimal(str(o.amount_settled)))
    items = [{"direction": k.split(":", 1)[0], "counterparty_name": k.split(":", 1)[1], "amount_remaining": str(v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))} for k, v in by_counterparty.items()]
    items.sort(key=lambda i: Decimal(i["amount_remaining"]), reverse=True)
    return {"items": items}
