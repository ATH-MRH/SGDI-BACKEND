"""Budget (P2). Réalisé calculé depuis les écritures comptables RÉELLES (compte + société +
période), pas une saisie manuelle parallèle — traçabilité jusqu'aux écritures (exigence
explicite). Limite assumée et documentée (pas cachée) : centre_cout/contrat/client/site ne
sont PAS des dimensions portées par EcritureComptable/LigneEcriture aujourd'hui — le
"réalisé" ne peut donc être recoupé de façon fiable que sur société+compte+période ; les
autres dimensions restent déclaratives sur la ligne budgétaire elle-même tant qu'aucune
source comptable ne les porte."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.accounting.models import EcritureComptable, LigneEcriture
from app.modules.budget.models import BudgetLine
from app.modules.finance_core.models import FinancialObligation


def _month_bounds(period: str) -> tuple[date, date]:
    year, month = (int(p) for p in period.split("-"))
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def create_line(db: Session, *, society: str, period: str, compte: str | None, centre_cout: str | None, contrat: str | None, client: str | None, site: str | None, montant_budgete, created_by: str) -> BudgetLine:
    line = BudgetLine(
        society=society, period=period, compte=compte, centre_cout=centre_cout, contrat=contrat,
        client=client, site=site, montant_budgete=Decimal(str(montant_budgete)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        status="draft", created_by=created_by,
    )
    db.add(line)
    db.flush()
    return line


def _transition(db: Session, line_id: int, *, allowed_from: tuple[str, ...], to: str, actor: str | None = None) -> BudgetLine:
    line = db.get(BudgetLine, line_id)
    if not line:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ligne budgétaire introuvable")
    if line.status not in allowed_from:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Transition {line.status}->{to} interdite")
    line.status = to
    if to == "approved":
        line.approved_by = actor
        line.approved_at = datetime.utcnow()
    db.flush()
    return line


def submit(db: Session, line_id: int) -> BudgetLine:
    return _transition(db, line_id, allowed_from=("draft",), to="submitted")


def approve(db: Session, line_id: int, *, approved_by: str) -> BudgetLine:
    return _transition(db, line_id, allowed_from=("submitted",), to="approved", actor=approved_by)


def lock(db: Session, line_id: int) -> BudgetLine:
    return _transition(db, line_id, allowed_from=("approved",), to="locked")


def reject(db: Session, line_id: int) -> BudgetLine:
    return _transition(db, line_id, allowed_from=("submitted",), to="rejected")


def revise(db: Session, line_id: int, *, montant_budgete, created_by: str) -> BudgetLine:
    """Une ligne "locked" ne se modifie jamais — révise en crée une NOUVELLE en "draft",
    liée par revises_id, reprenant les mêmes dimensions."""
    original = db.get(BudgetLine, line_id)
    if not original:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ligne budgétaire introuvable")
    revision = BudgetLine(
        society=original.society, period=original.period, centre_cout=original.centre_cout,
        contrat=original.contrat, client=original.client, site=original.site, compte=original.compte,
        montant_budgete=Decimal(str(montant_budgete)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), status="draft",
        revises_id=original.id, created_by=created_by,
    )
    db.add(revision)
    db.flush()
    return revision


def realise(db: Session, *, society: str, period: str, compte: str | None) -> Decimal:
    """Somme réelle (débit-crédit, ou crédit-débit selon le sens du compte — simplifié ici en
    valeur absolue du mouvement net, cohérent avec une lecture "consommé" d'un compte de
    charge) des écritures VALIDÉES (pas les brouillons, qui ne sont pas encore actées) pour
    ce compte/société/période."""
    if not compte:
        return Decimal("0")
    start, end = _month_bounds(period)
    stmt = (
        select(func.coalesce(func.sum(LigneEcriture.debit - LigneEcriture.credit), 0))
        .join(EcritureComptable, LigneEcriture.ecriture_id == EcritureComptable.id)
        .where(
            EcritureComptable.society == society, EcritureComptable.status == "validée",
            EcritureComptable.date_ecriture >= start, EcritureComptable.date_ecriture < end,
            LigneEcriture.compte_numero == compte,
        )
    )
    total = db.scalar(stmt) or 0
    return Decimal(str(total)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def engage(db: Session, *, society: str, period: str) -> Decimal:
    """Engagé = obligations ouvertes/partiellement réglées de la société (toutes dimensions
    confondues — voir limite documentée en tête de fichier) créées pendant la période."""
    start, end = _month_bounds(period)
    stmt = select(func.coalesce(func.sum(FinancialObligation.amount_total - FinancialObligation.amount_settled), 0)).where(
        FinancialObligation.society == society, FinancialObligation.status.in_(("open", "partially_settled")),
        FinancialObligation.created_at >= datetime.combine(start, datetime.min.time()),
        FinancialObligation.created_at < datetime.combine(end, datetime.min.time()),
    )
    total = db.scalar(stmt) or 0
    return Decimal(str(total)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def line_summary(db: Session, line: BudgetLine) -> dict:
    realized = realise(db, society=line.society, period=line.period, compte=line.compte)
    engaged = engage(db, society=line.society, period=line.period)
    budget = Decimal(str(line.montant_budgete))
    return {
        "id": line.id, "society": line.society, "period": line.period, "compte": line.compte,
        "centre_cout": line.centre_cout, "contrat": line.contrat, "client": line.client, "site": line.site,
        "status": line.status, "budget": str(budget), "realise": str(realized), "engage": str(engaged),
        "ecart": str((budget - realized).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
    }
