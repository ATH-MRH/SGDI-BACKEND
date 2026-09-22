"""Cockpit DG (P3) — agrégation SERVEUR uniquement, jamais une collection complète envoyée
au frontend pour qu'il fabrique lui-même une métrique (règle explicite de la mission).
Combine les agrégats déjà réels de treasury/profitability/fiscalite/reconciliation/budget —
aucune nouvelle table, aucun recalcul dupliqué."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.budget.models import BudgetLine
from app.modules.budget import service as budget_service
from app.modules.finance_core.models import FinancialObligation, Settlement
from app.modules.fiscalite import service as fiscalite_service
from app.modules.payroll.models import PayrollRun, PayrollSlip
from app.modules.profitability import service as profitability_service
from app.modules.reconciliation.models import BankingException, ReconciliationCase
from app.modules.treasury import service as treasury_service


def _q2(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _month_bounds(period: str) -> tuple[date, date]:
    year, month = (int(p) for p in period.split("-"))
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def summary(db: Session, *, society: str, period: str) -> dict:
    forecast = treasury_service.cash_forecast(db, society=society, allowed=None)
    period_start, period_end = _month_bounds(period)

    open_statuses = ("open", "partially_settled")
    remaining_expr = FinancialObligation.amount_total - FinancialObligation.amount_settled

    creances = db.scalar(
        select(func.coalesce(func.sum(remaining_expr), 0))
        .where(FinancialObligation.society == society, FinancialObligation.direction == "receivable", FinancialObligation.status.in_(open_statuses))
    ) or 0
    dettes = db.scalar(
        select(func.coalesce(func.sum(remaining_expr), 0))
        .where(FinancialObligation.society == society, FinancialObligation.direction == "payable", FinancialObligation.status.in_(open_statuses))
    ) or 0
    # Dashboard (frontend V2, §3) — échu = ouvert ET échéance dépassée aujourd'hui. Même
    # agrégat serveur que ci-dessus, filtre supplémentaire — jamais une collection complète
    # renvoyée au frontend pour qu'il filtre lui-même.
    today = date.today()
    creances_echues = db.scalar(
        select(func.coalesce(func.sum(remaining_expr), 0))
        .where(FinancialObligation.society == society, FinancialObligation.direction == "receivable",
               FinancialObligation.status.in_(open_statuses), FinancialObligation.due_date.isnot(None), FinancialObligation.due_date < today)
    ) or 0
    dettes_echues = db.scalar(
        select(func.coalesce(func.sum(remaining_expr), 0))
        .where(FinancialObligation.society == society, FinancialObligation.direction == "payable",
               FinancialObligation.status.in_(open_statuses), FinancialObligation.due_date.isnot(None), FinancialObligation.due_date < today)
    ) or 0
    # CNAS/IRG à payer : reste dû total (toutes périodes confondues) issu de la paie — un
    # DG doit voir ce qui reste réellement dû à ces organismes, pas seulement le mois en
    # cours. source_type déjà posé par payroll.validate_slip(), jamais un second calcul.
    cnas_a_payer = db.scalar(
        select(func.coalesce(func.sum(remaining_expr), 0))
        .where(FinancialObligation.society == society, FinancialObligation.source_type == "payroll_cnas", FinancialObligation.status.in_(open_statuses))
    ) or 0
    irg_a_payer = db.scalar(
        select(func.coalesce(func.sum(remaining_expr), 0))
        .where(FinancialObligation.society == society, FinancialObligation.source_type == "payroll_irg", FinancialObligation.status.in_(open_statuses))
    ) or 0
    # Encaissements/décaissements de la période : Settlement réellement posés (settled_at),
    # jamais une intention (PaymentIntent) ni une obligation encore ouverte.
    encaissements_periode = db.scalar(
        select(func.coalesce(func.sum(Settlement.amount), 0)).join(FinancialObligation, Settlement.obligation_id == FinancialObligation.id)
        .where(FinancialObligation.society == society, FinancialObligation.direction == "receivable", Settlement.kind == "normal",
               Settlement.settled_at >= period_start, Settlement.settled_at < period_end)
    ) or 0
    decaissements_periode = db.scalar(
        select(func.coalesce(func.sum(Settlement.amount), 0)).join(FinancialObligation, Settlement.obligation_id == FinancialObligation.id)
        .where(FinancialObligation.society == society, FinancialObligation.direction == "payable", Settlement.kind == "normal",
               Settlement.settled_at >= period_start, Settlement.settled_at < period_end)
    ) or 0

    marge = profitability_service.margin(db, society=society, period=period)

    masse_salariale = db.scalar(
        select(func.coalesce(func.sum(PayrollSlip.brut + PayrollSlip.cotisation_patronale), 0))
        .join(PayrollRun, PayrollSlip.payroll_run_id == PayrollRun.id)
        .where(PayrollSlip.society == society, PayrollSlip.status == "validated", PayrollRun.period == period)
    ) or 0

    fiscal_a_echeance = fiscalite_service.calendar(db, society=society, allowed=None, upcoming_only=True)

    rapprochements_ouverts = db.scalar(
        select(func.count()).select_from(ReconciliationCase).where(ReconciliationCase.society == society, ReconciliationCase.status == "proposed")
    ) or 0
    exceptions_ouvertes = db.scalar(
        select(func.count()).select_from(BankingException).where(BankingException.society == society, BankingException.resolved == 0)
    ) or 0

    budget_lines = db.scalars(select(BudgetLine).where(BudgetLine.society == society, BudgetLine.period == period)).all()
    budget_vs_realise = [budget_service.line_summary(db, line) for line in budget_lines]

    return {
        "society": society, "period": period,
        "tresorerie": {
            "position_bancaire": forecast["position_bancaire_actuelle"],
            "solde_previsionnel": forecast["solde_previsionnel"],
        },
        "creances_ouvertes": str(Decimal(str(creances)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "dettes_ouvertes": str(Decimal(str(dettes)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "chiffre_affaires": marge["ca"],
        "marge_brute": marge["marge_brute"],
        "taux_marge_pct": marge["taux_marge_pct"],
        "masse_salariale": str(Decimal(str(masse_salariale)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "charges_achats": marge["cout_achats"],
        "fiscalite_a_echeance": [{"id": o.id, "type": o.obligation_type, "montant": str(o.montant), "echeance": str(o.echeance), "status": o.status} for o in fiscal_a_echeance],
        "rapprochements_non_resolus": rapprochements_ouverts,
        "exceptions_bancaires_ouvertes": exceptions_ouvertes,
        "budget_vs_realise": budget_vs_realise,
        "creances_echues": str(_q2(creances_echues)),
        "dettes_echues": str(_q2(dettes_echues)),
        "cnas_a_payer": str(_q2(cnas_a_payer)),
        "irg_a_payer": str(_q2(irg_a_payer)),
        "encaissements_periode": str(_q2(encaissements_periode)),
        "decaissements_periode": str(_q2(decaissements_periode)),
    }
