"""Rentabilité (P2) — agrégation PURE sur les sources déjà canoniques, AUCUNE duplication
comptable (pas de nouvelle table de coûts) : CA = finance_models.Invoice, coût personnel =
payroll.PayrollSlip (bulletins validés uniquement — un brouillon n'est pas un coût engagé),
achats = achats.FactureFournisseur. Axes réellement traçables aujourd'hui : société, client
(via Invoice.client_name), période. contrat/site/activité NE sont PAS des dimensions portées
par Invoice/FactureFournisseur/PayrollSlip à ce jour — limite documentée, pas contournée par
une donnée inventée (voir docs/atlas-finance-platform-parity.md)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.achats.models import FactureFournisseur
from app.modules.finance_models import Invoice
from app.modules.payroll.models import PayrollSlip


def _month_bounds(period: str) -> tuple[date, date]:
    year, month = (int(p) for p in period.split("-"))
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def margin(db: Session, *, society: str, period: str, client: str | None = None) -> dict:
    start, end = _month_bounds(period)

    ca_stmt = select(func.coalesce(func.sum(Invoice.total_ht), 0)).where(
        Invoice.society == society, Invoice.invoice_date >= start, Invoice.invoice_date < end,
    )
    if client:
        ca_stmt = ca_stmt.where(Invoice.client_name == client)
    ca = Decimal(str(db.scalar(ca_stmt) or 0))

    personnel_stmt = select(func.coalesce(func.sum(PayrollSlip.brut + PayrollSlip.cotisation_patronale), 0)).where(
        PayrollSlip.society == society, PayrollSlip.status == "validated",
    )
    # PayrollSlip est rattaché à un PayrollRun.period, pas directement dateable — jointure
    # nécessaire pour filtrer par période (voir payroll.models.PayrollRun).
    from app.modules.payroll.models import PayrollRun
    personnel_stmt = personnel_stmt.join(PayrollRun, PayrollSlip.payroll_run_id == PayrollRun.id).where(PayrollRun.period == period)
    cout_personnel = Decimal(str(db.scalar(personnel_stmt) or 0))

    achats_stmt = select(func.coalesce(func.sum(FactureFournisseur.total_ht), 0)).where(
        FactureFournisseur.society == society, FactureFournisseur.date_facture >= start, FactureFournisseur.date_facture < end,
    )
    cout_achats = Decimal(str(db.scalar(achats_stmt) or 0))

    marge_brute = (ca - cout_personnel - cout_achats).quantize(Decimal("0.01"))
    # Revue d'intégrité, item 4 (Decimal/arrondis) : seul float() de tout le Finance Platform,
    # revu et jugé sans risque — taux_marge_pct est un RATIO d'affichage (pourcentage), jamais
    # un montant monétaire réinjecté dans un calcul ultérieur, et il est déjà quantize()
    # (Decimal, 2 décimales) AVANT ce cast — aucune perte de précision monétaire possible ici.
    taux_marge = float((marge_brute / ca * 100).quantize(Decimal("0.01"))) if ca > 0 else None

    return {
        "society": society, "period": period, "client": client,
        "ca": str(ca.quantize(Decimal("0.01"))), "cout_personnel": str(cout_personnel.quantize(Decimal("0.01"))),
        "cout_achats": str(cout_achats.quantize(Decimal("0.01"))), "marge_brute": str(marge_brute),
        "taux_marge_pct": taux_marge,
        "note": "axes contrat/site/activité non traçables aujourd'hui (aucune source ne les porte) — voir documentation",
    }


def margin_by_client(db: Session, *, society: str, period: str) -> list[dict]:
    start, end = _month_bounds(period)
    clients = db.scalars(
        select(Invoice.client_name).where(Invoice.society == society, Invoice.invoice_date >= start, Invoice.invoice_date < end).distinct()
    ).all()
    return [margin(db, society=society, period=period, client=c) for c in clients if c]
