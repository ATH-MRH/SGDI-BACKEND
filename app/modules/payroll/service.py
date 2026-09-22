"""Paie — moteur de calcul (P1-A). Chaîne : pointage clôturé -> variables -> grille ->
calcul -> validation -> obligations Finance Core. Le paiement/rapprochement/comptabilité
NE sont PAS réimplémentés ici — voir finance_core.service.settle_obligation,
finance_core.accounting_bridge, app.modules.reconciliation (réutilisés tels quels)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.drh.models import Employee
from app.modules.finance_core import service as finance_core_service
from app.modules.ops.models import DailyPresence
from app.modules.payroll.models import PayrollRun, PayrollSlip, SalaryGrid
from app.modules.regulatory import service as regulatory_service

TWO_PLACES = Decimal("0.01")


def q2(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def _month_bounds(period: str) -> tuple[date, date]:
    year, month = (int(p) for p in period.split("-"))
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


# ── Grille salariale ────────────────────────────────────────────────────────────────────

def create_salary_grid(
    db: Session, *, society: str, poste: str, categorie: str | None, niveau: str | None,
    salaire_base: Any, primes_fixes: list | None, effective_from: date,
) -> SalaryGrid:
    last = db.scalar(
        select(SalaryGrid).where(SalaryGrid.society == society, SalaryGrid.poste == poste, SalaryGrid.status == "active")
        .order_by(SalaryGrid.version_number.desc())
    )
    version_number = 1
    if last:
        if last.effective_from >= effective_from:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="La nouvelle version doit démarrer après la version active en cours")
        last.effective_to = effective_from
        last.status = "superseded"
        version_number = last.version_number + 1
    grid = SalaryGrid(
        society=society, poste=poste, categorie=categorie, niveau=niveau, salaire_base=q2(salaire_base),
        primes_fixes=primes_fixes or [], version_number=version_number, effective_from=effective_from,
        effective_to=None, status="active",
    )
    db.add(grid)
    db.flush()
    return grid


def get_grid_applicable_at(db: Session, *, society: str, poste: str, as_of_date: date) -> SalaryGrid | None:
    """P0 (revue d'intégrité, §3 paie historique) : reproduit pour la grille salariale la
    même garantie que regulatory.get_applicable_version() pour les règles — la version dont
    la fenêtre [effective_from, effective_to) couvre RÉELLEMENT as_of_date, jamais "la
    version active actuelle" appliquée par erreur à une période passée. create_salary_grid()
    ferme déjà effective_to de l'ancienne version à la création d'une nouvelle, donc cette
    requête est précise sans logique supplémentaire. Retourne None si aucune grille ne
    couvre la date (à la charge de l'appelant de retomber sur employee.salary_net, comme le
    fait déjà compute_slip)."""
    stmt = select(SalaryGrid).where(
        SalaryGrid.society == society, SalaryGrid.poste == poste, SalaryGrid.effective_from <= as_of_date,
    ).where(
        (SalaryGrid.effective_to.is_(None)) | (SalaryGrid.effective_to > as_of_date)
    ).order_by(SalaryGrid.effective_from.desc())
    return db.scalar(stmt)


# ── Pointage clôturé -> variables ───────────────────────────────────────────────────────

def compute_presence_variables(db: Session, *, employee_id: int, period: str) -> dict:
    """Lit UNIQUEMENT du pointage clôturé (DailyPresence.closed_at non nul) — un pointage
    encore ouvert ne doit jamais influencer un calcul de paie (donnée pas encore figée)."""
    start, end = _month_bounds(period)
    stmt = select(DailyPresence).where(
        DailyPresence.employee_id == employee_id,
        DailyPresence.presence_date >= start, DailyPresence.presence_date < end,
        DailyPresence.closed_at.isnot(None),
    )
    rows = db.scalars(stmt).all()
    worked = sum(1 for r in rows if r.status == "present")
    absent = sum(1 for r in rows if r.status == "absent")
    return {"worked_days": worked, "absence_days": absent, "closed_presence_rows": len(rows)}


# ── Calcul du bulletin ──────────────────────────────────────────────────────────────────

def _apply_progressive_brackets(base: Decimal, brackets: list[dict]) -> Decimal:
    """brackets: [{"up_to": 20000, "rate": 0}, {"up_to": 40000, "rate": 0.2}, {"up_to": null, "rate": 0.35}]
    — tranches MARGINALES (barème progressif standard), up_to=null = tranche finale sans plafond."""
    total = Decimal("0")
    lower = Decimal("0")
    for bracket in brackets:
        rate = Decimal(str(bracket["rate"]))
        upper = Decimal(str(bracket["up_to"])) if bracket.get("up_to") is not None else None
        if base <= lower:
            break
        slice_top = min(base, upper) if upper is not None else base
        if slice_top > lower:
            total += (slice_top - lower) * rate
        lower = upper if upper is not None else base
        if upper is None:
            break
    return q2(total)


def compute_slip(
    db: Session, *, payroll_run_id: int, employee_id: int, salary_grid_id: int | None = None,
    primes_variables: Decimal | None = None, autres_retenues: Decimal | None = None,
    idempotency_key: str, allow_unverified_rules: bool = True,
) -> PayrollSlip:
    existing = db.scalar(select(PayrollSlip).where(PayrollSlip.idempotency_key == idempotency_key))
    if existing:
        return existing

    run = db.get(PayrollRun, payroll_run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Cycle de paie introuvable")
    if run.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Cycle de paie non modifiable (déjà validé/payé)")

    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Employé introuvable")

    # P0 (revue d'intégrité, §3 paie historique) — TROUVÉ PENDANT L'AUDIT : un index UNIQUE
    # (payroll_run_id, employee_id) existe déjà en base (un seul bulletin par employé et par
    # cycle, jamais un recalcul parallèle) mais rien ne le vérifiait ici avant l'INSERT — un
    # second calcul avec une idempotency_key différente remontait un IntegrityError brut
    # (500) au lieu d'un refus métier propre. Un bulletin déjà présent pour cet employé sur ce
    # cycle ne doit JAMAIS être recalculé silencieusement ; le seul chemin de correction est
    # de clôturer/annuler le cycle et d'en ouvrir un nouveau, jamais un second bulletin parallèle.
    duplicate = db.scalar(
        select(PayrollSlip).where(PayrollSlip.payroll_run_id == payroll_run_id, PayrollSlip.employee_id == employee_id)
    )
    if duplicate:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Un bulletin (#{duplicate.id}) existe déjà pour cet employé sur ce cycle de paie — "
                   "jamais de second calcul parallèle pour le même employé/cycle",
        )

    grid = db.get(SalaryGrid, salary_grid_id) if salary_grid_id else None
    base = q2(grid.salaire_base) if grid else q2(employee.salary_net or 0)
    primes_fixes_total = q2(sum(Decimal(str(p.get("montant", 0))) for p in (grid.primes_fixes if grid else [])))
    primes_var = q2(primes_variables or 0)

    presence = compute_presence_variables(db, employee_id=employee_id, period=run.period)
    period_end = _month_bounds(run.period)[1]

    brut = q2(base + primes_fixes_total + primes_var)

    rules_used: dict = {}
    cnas_salarial = Decimal("0")
    cnas_patronal = Decimal("0")
    try:
        v_cnas_sal = regulatory_service.get_applicable_version(
            db, rule_type="cnas_taux_salarial", society=run.society, as_of_date=period_end, allow_unverified=allow_unverified_rules,
        )
        cnas_salarial = q2(brut * Decimal(str(v_cnas_sal.parameters["taux"])))
        rules_used["cnas_taux_salarial"] = {"version_id": v_cnas_sal.id, "status": v_cnas_sal.status, "parameters": v_cnas_sal.parameters}
    except regulatory_service.NoApplicableRuleError as exc:
        rules_used["cnas_taux_salarial"] = {"error": str(exc)}
    try:
        v_cnas_pat = regulatory_service.get_applicable_version(
            db, rule_type="cnas_taux_patronal", society=run.society, as_of_date=period_end, allow_unverified=allow_unverified_rules,
        )
        cnas_patronal = q2(brut * Decimal(str(v_cnas_pat.parameters["taux"])))
        rules_used["cnas_taux_patronal"] = {"version_id": v_cnas_pat.id, "status": v_cnas_pat.status, "parameters": v_cnas_pat.parameters}
    except regulatory_service.NoApplicableRuleError as exc:
        rules_used["cnas_taux_patronal"] = {"error": str(exc)}

    imposable = q2(max(brut - cnas_salarial, Decimal("0")))
    irg = Decimal("0")
    try:
        v_irg = regulatory_service.get_applicable_version(
            db, rule_type="irg_bareme", society=run.society, as_of_date=period_end, allow_unverified=allow_unverified_rules,
        )
        irg = _apply_progressive_brackets(imposable, v_irg.parameters["brackets"])
        rules_used["irg_bareme"] = {"version_id": v_irg.id, "status": v_irg.status, "parameters": v_irg.parameters}
    except regulatory_service.NoApplicableRuleError as exc:
        rules_used["irg_bareme"] = {"error": str(exc)}

    autres = q2(autres_retenues or 0)
    net = q2(imposable - irg - autres)
    net_a_payer = net  # avances/prêts non déduits dans ce lot (dette documentée)

    slip = PayrollSlip(
        payroll_run_id=payroll_run_id, employee_id=employee_id, society=run.society, salary_grid_id=salary_grid_id,
        inputs={**presence, "primes_variables": str(primes_var), "primes_fixes_total": str(primes_fixes_total)},
        rules_used=rules_used,
        base=base, brut=brut, cotisation_salariale=cnas_salarial, cotisation_patronale=cnas_patronal,
        imposable=imposable, irg=irg, autres_retenues=autres, net=net, net_a_payer=net_a_payer,
        status="draft", idempotency_key=idempotency_key,
    )
    db.add(slip)
    db.flush()
    return slip


def slip_validation_blockers(slip: PayrollSlip) -> list[str]:
    """P0 (revue d'intégrité) — TROUVÉ PENDANT L'AUDIT : rien n'empêchait auparavant un
    bulletin calculé avec une règle réglementaire "unverified" (ou carrément absente) de se
    valider et d'ouvrir des obligations financières réelles. rules_used (déjà stocké par
    compute_slip, aucune migration nécessaire) porte le statut de CHAQUE règle utilisée —
    cette fonction est la SEULE porte que validate_slip() doit franchir. Une règle en erreur
    (NoApplicableRuleError, aucune version trouvée) bloque aussi : un composant à 0 par
    absence de règle serait un montant silencieusement faux, pas juste "non vérifié"."""
    blockers = []
    for rule_type, entry in (slip.rules_used or {}).items():
        if "error" in entry:
            blockers.append(f"{rule_type} : aucune règle réglementaire applicable trouvée ({entry['error']})")
        elif entry.get("status") != "active":
            blockers.append(f"{rule_type} : règle non vérifiée (version #{entry.get('version_id')}, statut '{entry.get('status')}')")
    return blockers


def is_slip_validatable(slip: PayrollSlip) -> bool:
    return not slip_validation_blockers(slip)


def validate_slip(db: Session, slip_id: int, *, validated_by: str) -> PayrollSlip:
    """Fige le bulletin (immuable) et ouvre les obligations Finance Core correspondantes —
    net à payer (dû au salarié), charges sociales (dues à la CNAS), IRG (dû au Trésor). AUCUN
    virement/règlement n'est déclenché ici — settle_obligation() reste un acte séparé,
    explicite, via Finance Core (même chemin que pour une facture).

    GARDE P0 : refuse si une règle réglementaire non vérifiée (ou absente) a servi au calcul
    — un bulletin dans cet état reste une SIMULATION (consultable, jamais validable) tant
    qu'un administrateur n'a pas approuvé une version "active" de la/les règle(s) manquante(s)
    (voir regulatory.service.approve_proposal(mark_verified=True)) et que le bulletin n'a pas
    été recalculé (nouvel idempotency_key -> nouveau PayrollSlip, l'ancien reste tel quel,
    jamais réécrit)."""
    slip = db.get(PayrollSlip, slip_id)
    if not slip:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Bulletin introuvable")
    if slip.status != "draft":
        return slip  # déjà validé — idempotent par construction (rien à refaire)

    blockers = slip_validation_blockers(slip)
    if blockers:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Bulletin non validable — simulation uniquement (règle(s) réglementaire(s) non vérifiée(s) ou manquante(s)) : " + " ; ".join(blockers),
        )

    employee = db.get(Employee, slip.employee_id)
    employee_label = f"{employee.last_name} {employee.first_name}".strip() if employee else f"Employé #{slip.employee_id}"

    if slip.net_a_payer > 0:
        obligation = finance_core_service.create_obligation(
            db, society=slip.society, direction="payable", source_type="payroll_slip", source_id=str(slip.id),
            amount_total=slip.net_a_payer, counterparty_name=employee_label,
            idempotency_key=f"obl:payroll_slip:{slip.id}",
        )
        slip.obligation_id = obligation.id
    charges_sociales = q2(slip.cotisation_salariale + slip.cotisation_patronale)
    if charges_sociales > 0:
        cnas_obl = finance_core_service.create_obligation(
            db, society=slip.society, direction="payable", source_type="payroll_cnas", source_id=str(slip.id),
            amount_total=charges_sociales, counterparty_name="CNAS",
            idempotency_key=f"obl:payroll_cnas:{slip.id}",
        )
        slip.cnas_obligation_id = cnas_obl.id
    if slip.irg > 0:
        irg_obl = finance_core_service.create_obligation(
            db, society=slip.society, direction="payable", source_type="payroll_irg", source_id=str(slip.id),
            amount_total=slip.irg, counterparty_name="Trésor Public (IRG)",
            idempotency_key=f"obl:payroll_irg:{slip.id}",
        )
        slip.irg_obligation_id = irg_obl.id

    slip.status = "validated"
    db.flush()
    return slip


def validate_run(db: Session, run_id: int, *, validated_by: str) -> PayrollRun:
    from datetime import datetime
    run = db.get(PayrollRun, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Cycle de paie introuvable")
    slips = db.scalars(select(PayrollSlip).where(PayrollSlip.payroll_run_id == run_id)).all()
    if not slips:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Aucun bulletin dans ce cycle")
    not_validated = [s for s in slips if s.status != "validated"]
    if not_validated:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"{len(not_validated)} bulletin(s) non validé(s) — validez chaque bulletin avant le cycle")
    run.status = "validated"
    run.validated_by = validated_by
    run.validated_at = datetime.utcnow()
    db.flush()
    return run
