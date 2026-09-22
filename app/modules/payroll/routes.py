from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.payroll import service
from app.modules.payroll.models import PayrollRun, PayrollSlip, SalaryGrid
from app.modules.payroll.schemas import PayrollRunCreate, SalaryGridCreate, SlipComputeRequest

router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _slip_out(s: PayrollSlip) -> dict:
    return {
        "id": s.id, "payroll_run_id": s.payroll_run_id, "employee_id": s.employee_id, "society": s.society,
        "base": str(s.base), "brut": str(s.brut), "cotisation_salariale": str(s.cotisation_salariale),
        "cotisation_patronale": str(s.cotisation_patronale), "imposable": str(s.imposable), "irg": str(s.irg),
        "autres_retenues": str(s.autres_retenues), "net": str(s.net), "net_a_payer": str(s.net_a_payer),
        "status": s.status, "rules_used": s.rules_used, "inputs": s.inputs,
        "obligation_id": s.obligation_id, "cnas_obligation_id": s.cnas_obligation_id, "irg_obligation_id": s.irg_obligation_id,
    }


@router.post("/salary-grids")
def create_salary_grid(payload: SalaryGridCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    grid = service.create_salary_grid(
        db, society=payload.society, poste=payload.poste, categorie=payload.categorie, niveau=payload.niveau,
        salaire_base=payload.salaire_base, primes_fixes=payload.primes_fixes, effective_from=payload.effective_from,
    )
    db.commit()
    db.refresh(grid)
    return {"id": grid.id, "society": grid.society, "poste": grid.poste, "salaire_base": str(grid.salaire_base), "version_number": grid.version_number, "status": grid.status}


@router.get("/salary-grids")
def list_salary_grids(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    stmt = select(SalaryGrid)
    if society:
        stmt = stmt.where(SalaryGrid.society == society)
    rows = db.scalars(stmt.order_by(SalaryGrid.id.desc())).all()
    return [{"id": g.id, "society": g.society, "poste": g.poste, "salaire_base": str(g.salaire_base), "status": g.status, "effective_from": str(g.effective_from)} for g in rows]


@router.post("/runs")
def create_run(payload: PayrollRunCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    existing = db.scalar(select(PayrollRun).where(PayrollRun.idempotency_key == payload.idempotency_key))
    if existing:
        run = existing
    else:
        already = db.scalar(select(PayrollRun).where(PayrollRun.society == payload.society, PayrollRun.period == payload.period))
        if already:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Un cycle de paie existe déjà pour cette société/période")
        run = PayrollRun(society=payload.society, period=payload.period, status="draft", created_by=user.username, idempotency_key=payload.idempotency_key)
        db.add(run)
        db.flush()
    db.commit()
    db.refresh(run)
    return {"id": run.id, "society": run.society, "period": run.period, "status": run.status}


@router.get("/runs")
def list_runs(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    stmt = select(PayrollRun)
    if society:
        stmt = stmt.where(PayrollRun.society == society)
    rows = db.scalars(stmt.order_by(PayrollRun.id.desc())).all()
    return [{"id": r.id, "society": r.society, "period": r.period, "status": r.status} for r in rows]


@router.post("/runs/{run_id}/slips")
def compute_slip(run_id: int, payload: SlipComputeRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    run = db.get(PayrollRun, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Cycle de paie introuvable")
    _ensure_society_allowed(user, run.society)
    slip = service.compute_slip(
        db, payroll_run_id=run_id, employee_id=payload.employee_id, salary_grid_id=payload.salary_grid_id,
        primes_variables=payload.primes_variables, autres_retenues=payload.autres_retenues,
        idempotency_key=payload.idempotency_key, allow_unverified_rules=payload.allow_unverified_rules,
    )
    db.commit()
    db.refresh(slip)
    return _slip_out(slip)


@router.get("/runs/{run_id}/slips")
def list_slips(run_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(PayrollSlip).where(PayrollSlip.payroll_run_id == run_id)).all()
    return [_slip_out(s) for s in rows]


@router.get("/slips/{slip_id}")
def get_slip(slip_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    slip = db.get(PayrollSlip, slip_id)
    if not slip:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Bulletin introuvable")
    _ensure_society_allowed(user, slip.society)
    return _slip_out(slip)


@router.post("/slips/{slip_id}/validate")
def validate_slip(slip_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    slip = db.get(PayrollSlip, slip_id)
    if not slip:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Bulletin introuvable")
    _ensure_society_allowed(user, slip.society)
    slip = service.validate_slip(db, slip_id, validated_by=user.username)
    db.commit()
    db.refresh(slip)
    return _slip_out(slip)


@router.post("/runs/{run_id}/validate")
def validate_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    run = db.get(PayrollRun, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Cycle de paie introuvable")
    _ensure_society_allowed(user, run.society)
    run = service.validate_run(db, run_id, validated_by=user.username)
    db.commit()
    db.refresh(run)
    return {"id": run.id, "status": run.status}
