from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import HTMLResponse
import html
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.irongs.sql_bridge import employee_by_ref
from app.modules.loans.models import EmployeeLoanRepayment, EmployeeLoanRequest, LoanWorkflowNotification
from app.modules.loans.schemas import LoanDecisionIn, LoanRepaymentCreate, LoanRequestCreate, LoanReviewIn, LoanSimulationIn, SignatureConfirmationIn
from app.modules.loans.service import due_schedule, employee_eligibility, next_month_start, serialize_request


router = APIRouter()
MANAGER_ROLES = {"admin", "adm", "adm1", "adm2", "dg", "directeur_general", "drh", "rh", "finance", "finances", "paie", "secretariat", "caisse", "tresorerie"}
MANAGER_STRUCTURES = {"drh", "rh", "finance", "finances", "comptabilite", "comptabilité", "paie", "prets", "prêts", "secretariat general", "secrétariat général", "caisse", "tresorerie", "trésorerie"}


def _portal_employee(db: Session, authorization: str | None) -> Employee:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Connexion salarié requise")
    try:
        payload = decode_token(authorization.removeprefix("Bearer "))
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Session invalide") from exc
    if not payload.get("portal") or not payload.get("sub"):
        raise HTTPException(status_code=403, detail="Compte salarié requis")
    employee = employee_by_ref(db, str(payload["sub"]))
    if not employee:
        raise HTTPException(status_code=404, detail="Fiche employé introuvable")
    blocked = ("suspend", "sortant", "inact", "blacklist", "archive", "demission", "licenc")
    if any(marker in str(employee.status or "").lower() for marker in blocked):
        raise HTTPException(status_code=403, detail="Votre situation administrative ne permet pas une nouvelle demande")
    return employee


def _ensure_manager(user: User) -> None:
    role = str(user.role or "").strip().lower()
    structures = {str(value or "").strip().lower() for value in (user.authorized_structures or [])}
    if role not in MANAGER_ROLES and not structures.intersection(MANAGER_STRUCTURES):
        raise HTTPException(status_code=403, detail="Accès réservé aux gestionnaires RH, paie ou finance")


def _is_general_director(user: User) -> bool:
    role = str(user.role or "").strip().lower().replace("_", " ")
    username = str(user.username or "").strip().upper()
    structures = {str(value or "").strip().lower().replace("_", " ") for value in (user.authorized_structures or [])}
    return role in {"dg", "directeur general", "direction generale"} or "direction generale" in structures or (
        str(user.access_level or "").strip().upper() == "H5" and username.startswith(("DG", "ADG"))
    )


def _ensure_general_director(user: User) -> None:
    if not _is_general_director(user):
        raise HTTPException(status_code=403, detail="Décision et signature réservées au Directeur Général")


def _normalized_user_scope(user: User) -> tuple[str, set[str]]:
    role = str(user.role or "").strip().lower().replace("_", " ")
    structures = {str(value or "").strip().lower().replace("_", " ") for value in (user.authorized_structures or [])}
    return role, structures


def _is_secretariat(user: User) -> bool:
    role, structures = _normalized_user_scope(user)
    return role in {"secretariat", "secrétariat", "secretariat general", "secrétariat général"} or bool(structures & {"secretariat general", "secrétariat général"})


def _ensure_secretariat(user: User) -> None:
    if not _is_secretariat(user): raise HTTPException(status_code=403, detail="Action réservée au Secrétariat Général")


def _is_cash(user: User) -> bool:
    role, structures = _normalized_user_scope(user)
    return role in {"caisse", "caissier", "tresorerie", "trésorerie"} or bool(structures & {"caisse", "tresorerie", "trésorerie"})


def _ensure_cash(user: User) -> None:
    if not _is_cash(user): raise HTTPException(status_code=403, detail="Action réservée à la caisse")


def _notify(db: Session, row: EmployeeLoanRequest, recipient_role: str, host: str, event_type: str, title: str, message: str) -> None:
    db.add(LoanWorkflowNotification(loan_request_id=row.id, recipient_role=recipient_role, recipient_host=host, event_type=event_type, title=title, message=message, status="unread"))


def _notification_dict(item: LoanWorkflowNotification, row: EmployeeLoanRequest) -> dict[str, Any]:
    return {"id": item.id, "request_id": row.id, "reference": row.reference, "employee_name": row.employee_name, "society": row.society, "title": item.title, "message": item.message, "event_type": item.event_type, "status": item.status, "created_at": item.created_at.isoformat()}


def _ensure_society(user: User, society: str | None) -> None:
    allowed = [str(value).strip().casefold() for value in (user.authorized_societies or []) if str(value).strip()]
    if allowed and str(society or "").strip().casefold() not in allowed:
        raise HTTPException(status_code=403, detail="Société non autorisée")


def _request_or_404(db: Session, request_id: int, *, for_update: bool = False) -> EmployeeLoanRequest:
    row = db.execute(
        select(EmployeeLoanRequest).where(EmployeeLoanRequest.id == request_id).with_for_update()
    ).scalar_one_or_none() if for_update else db.get(EmployeeLoanRequest, request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    return row


@router.get("/employee/profile")
def employee_profile(db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    employee = _portal_employee(db, authorization)
    simulation = employee_eligibility(db, employee, "advance", 1, 1)
    return {
        "id": employee.id, "code": employee.code,
        "name": f"{employee.last_name} {employee.first_name}".strip(),
        "society": employee.society, "position": employee.position,
        "salary_net": employee.salary_net, "recruit_date": employee.recruit_date,
        "contract_end_date": employee.contract_end_date,
        "seniority_months": simulation["seniority_months"],
        "merit_score": simulation["merit_score"],
    }


@router.post("/employee/simulate")
def simulate(payload: LoanSimulationIn, db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    employee = _portal_employee(db, authorization)
    return employee_eligibility(db, employee, payload.request_type, payload.amount, payload.installments)


@router.get("/employee/requests")
def employee_requests(db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    employee = _portal_employee(db, authorization)
    rows = db.execute(select(EmployeeLoanRequest).where(EmployeeLoanRequest.employee_id == employee.id).order_by(EmployeeLoanRequest.id.desc())).scalars().all()
    return [serialize_request(row) for row in rows]


@router.get("/employee/requests/{request_id}/contract", response_class=HTMLResponse)
def employee_contract_document(request_id: int, db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    employee = _portal_employee(db, authorization); row = _request_or_404(db, request_id)
    if row.employee_id != employee.id: raise HTTPException(status_code=403, detail="Accès refusé")
    if not row.contract_reference: raise HTTPException(status_code=409, detail="Le contrat n’est pas encore disponible")
    return HTMLResponse(_contract_html(row))


@router.post("/employee/requests/{request_id}/sign-contract")
def employee_sign_contract(request_id: int, payload: SignatureConfirmationIn, db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    _portal_employee(db, authorization)
    raise HTTPException(status_code=403, detail="La signature du bénéficiaire est constatée exclusivement par le Secrétariat Général")


@router.post("/employee/requests", status_code=status.HTTP_201_CREATED)
def create_request(payload: LoanRequestCreate, db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    employee = _portal_employee(db, authorization)
    duplicate = db.execute(select(EmployeeLoanRequest.id).where(EmployeeLoanRequest.employee_id == employee.id, EmployeeLoanRequest.status.in_({"submitted", "under_review", "decision_pending_signature", "contract_pending_signature", "approved", "disbursed"}))).scalars().first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Une demande est déjà en cours d’étude")
    eligibility = employee_eligibility(db, employee, payload.request_type, payload.amount, payload.installments)
    row = EmployeeLoanRequest(
        employee_id=employee.id, employee_code=employee.code,
        employee_name=f"{employee.last_name} {employee.first_name}".strip(), society=employee.society,
        request_type=payload.request_type, amount_requested=round(payload.amount, 2),
        installments_requested=payload.installments, reason=payload.reason.strip(),
        payroll_deduction_consent=True, status="submitted", eligibility_snapshot=eligibility,
    )
    db.add(row); db.flush()
    row.reference = f"{('AVS' if payload.request_type == 'advance' else 'PRT')}-{date.today().year}-{row.id:06d}"
    db.commit(); db.refresh(row)
    return serialize_request(row)


@router.post("/employee/requests/{request_id}/cancel")
def cancel_request(request_id: int, db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    employee = _portal_employee(db, authorization); row = _request_or_404(db, request_id, for_update=True)
    if row.employee_id != employee.id:
        raise HTTPException(status_code=403, detail="Accès refusé")
    if row.status not in {"submitted", "under_review"}:
        raise HTTPException(status_code=409, detail="Cette demande ne peut plus être annulée")
    row.status = "cancelled"; db.commit(); db.refresh(row)
    return serialize_request(row)


@router.get("/management/dashboard")
def management_dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_manager(user)
    rows = db.execute(select(EmployeeLoanRequest)).scalars().all()
    allowed = {str(value).strip().casefold() for value in (user.authorized_societies or []) if str(value).strip()}
    if allowed:
        rows = [row for row in rows if str(row.society or "").strip().casefold() in allowed]
    return {
        "total": len(rows),
        "submitted": sum(row.status in {"submitted", "under_review"} for row in rows),
        "approved": sum(row.status == "approved" for row in rows),
        "disbursed": sum(row.status == "disbursed" for row in rows),
        "outstanding": round(sum(float(row.balance_due or 0) for row in rows if row.status in {"approved", "disbursed"}), 2),
        "repaid": round(sum(float(row.amount) for row in db.execute(select(EmployeeLoanRepayment)).scalars().all() if any(request.id == row.loan_request_id for request in rows)), 2),
        "can_decide": _is_general_director(user),
        "can_secretariat": _is_secretariat(user),
        "can_cash": _is_cash(user),
    }


@router.get("/management/requests")
def management_requests(
    request_status: str | None = Query(default=None, alias="status"), society: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    _ensure_manager(user)
    stmt = select(EmployeeLoanRequest).order_by(EmployeeLoanRequest.id.desc())
    if request_status: stmt = stmt.where(EmployeeLoanRequest.status == request_status)
    if society: stmt = stmt.where(EmployeeLoanRequest.society == society)
    rows = db.execute(stmt).scalars().all()
    allowed = {str(value).strip().casefold() for value in (user.authorized_societies or []) if str(value).strip()}
    if allowed: rows = [row for row in rows if str(row.society or "").strip().casefold() in allowed]
    output = []
    for row in rows:
        repayments = db.execute(select(EmployeeLoanRepayment).where(EmployeeLoanRepayment.loan_request_id == row.id).order_by(EmployeeLoanRepayment.payment_date)).scalars().all()
        item = serialize_request(row, repayments); item["schedule"] = due_schedule(row); item["can_decide"] = _is_general_director(user); item["can_secretariat"] = _is_secretariat(user); item["can_cash"] = _is_cash(user); output.append(item)
    return output


@router.post("/management/requests/{request_id}/review")
def review_request(request_id: int, payload: LoanReviewIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_manager(user); row = _request_or_404(db, request_id, for_update=True); _ensure_society(user, row.society)
    if row.status not in {"submitted", "under_review"}: raise HTTPException(status_code=409, detail="Cette demande n’est plus en cours d’étude")
    row.status = "under_review"; row.recommendation = payload.recommendation; row.decision_note = payload.note.strip()
    row.reviewed_by = user.username; row.reviewed_at = datetime.utcnow(); db.commit(); db.refresh(row)
    return serialize_request(row)


@router.post("/management/requests/{request_id}/decision")
def decide_request(request_id: int, payload: LoanDecisionIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_manager(user); _ensure_general_director(user); row = _request_or_404(db, request_id, for_update=True); _ensure_society(user, row.society)
    if row.status not in {"submitted", "under_review"}:
        raise HTTPException(status_code=409, detail="Cette demande a déjà fait l’objet d’une décision")
    if payload.decision == "reject":
        if not payload.note.strip(): raise HTTPException(status_code=422, detail="Le motif du refus est obligatoire")
        row.status = "rejected"; row.decision_note = payload.note.strip()
    else:
        amount = round(payload.amount_approved or row.amount_requested, 2)
        installments = payload.installments_approved or row.installments_requested
        employee = db.get(Employee, row.employee_id)
        if not employee: raise HTTPException(status_code=404, detail="Employé introuvable")
        eligibility = employee_eligibility(db, employee, row.request_type, amount, installments)
        if not eligibility["eligible"] and not payload.override_eligibility:
            raise HTTPException(status_code=409, detail={"message": "Dérogation requise", "reasons": eligibility["reasons"]})
        if not eligibility["eligible"] and not payload.note.strip():
            raise HTTPException(status_code=422, detail="Une dérogation doit être motivée")
        total = round(amount * (1 + payload.interest_rate / 100), 2)
        final_monthly = round(total / installments, 2)
        if final_monthly > eligibility["available_monthly_capacity"] and not payload.override_eligibility:
            raise HTTPException(status_code=409, detail={"message": "Dérogation requise", "reasons": ["La mensualité, taux inclus, dépasse la capacité disponible"]})
        row.status = "decision_pending_signature"; row.amount_approved = amount; row.installments_approved = installments
        row.interest_rate = payload.interest_rate; row.total_due = total; row.balance_due = total
        row.monthly_installment = final_monthly; row.first_due_date = payload.first_due_date or next_month_start()
        row.eligibility_snapshot = eligibility; row.decision_note = payload.note.strip() or row.decision_note
        row.decision_reference = f"DEC-{date.today().year}-{row.id:06d}"
    row.decided_by = user.username; row.decided_at = datetime.utcnow(); db.commit(); db.refresh(row)
    return serialize_request(row)


@router.get("/management/requests/{request_id}/decision-document", response_class=HTMLResponse)
def decision_document(request_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_manager(user); row = _request_or_404(db, request_id); _ensure_society(user, row.society)
    if not row.decision_reference: raise HTTPException(status_code=409, detail="Aucune décision d’accord générée")
    return HTMLResponse(_decision_html(row))


@router.post("/management/requests/{request_id}/sign-decision")
def sign_decision(request_id: int, payload: SignatureConfirmationIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_manager(user); _ensure_general_director(user); row = _request_or_404(db, request_id, for_update=True); _ensure_society(user, row.society)
    if row.status != "decision_pending_signature" or not row.decision_reference:
        raise HTTPException(status_code=409, detail="Aucune décision en attente de signature")
    row.decision_signed_by = user.username; row.decision_signed_at = datetime.utcnow()
    row.contract_reference = f"CONV-{date.today().year}-{row.id:06d}"; row.status = "secretariat_pending"
    _notify(db, row, "secretariat", "pret.irongs.com", "dg_decision_signed", "Décision DG signée", f"Préparer la convention {row.contract_reference}, l’imprimer et recueillir la signature de {row.employee_name}.")
    db.commit(); db.refresh(row); return serialize_request(row)


@router.get("/secretariat/inbox")
def secretariat_inbox(db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_secretariat(user)
    notifications = db.execute(select(LoanWorkflowNotification).where(LoanWorkflowNotification.recipient_role == "secretariat").order_by(LoanWorkflowNotification.id.desc())).scalars().all()
    output = []
    for item in notifications:
        row = _request_or_404(db, item.loan_request_id); _ensure_society(user, row.society)
        if item.status == "unread": item.status = "read"; item.read_by = user.username; item.read_at = datetime.utcnow()
        output.append(_notification_dict(item, row))
    db.commit(); return output


@router.get("/secretariat/requests/{request_id}/contract", response_class=HTMLResponse)
def secretariat_contract_document(request_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_secretariat(user); row = _request_or_404(db, request_id); _ensure_society(user, row.society)
    if not row.contract_reference: raise HTTPException(status_code=409, detail="La convention n’est pas encore disponible")
    return HTMLResponse(_contract_html(row))


@router.post("/secretariat/requests/{request_id}/confirm-beneficiary-signature")
def secretariat_confirm_signature(request_id: int, payload: SignatureConfirmationIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_secretariat(user); row = _request_or_404(db, request_id, for_update=True); _ensure_society(user, row.society)
    if row.status != "secretariat_pending" or not row.decision_signed_at or not row.contract_reference:
        raise HTTPException(status_code=409, detail="Ce dossier n’est pas en attente au Secrétariat Général")
    now = datetime.utcnow(); row.secretariat_received_at = row.secretariat_received_at or now
    row.beneficiary_signed_at = now; row.beneficiary_signature_confirmed_by = user.username; row.cash_notified_at = now; row.status = "cash_pending"
    notification = db.execute(select(LoanWorkflowNotification).where(LoanWorkflowNotification.loan_request_id == row.id, LoanWorkflowNotification.recipient_role == "secretariat", LoanWorkflowNotification.status != "processed").order_by(LoanWorkflowNotification.id.desc())).scalars().first()
    if notification: notification.status = "processed"; notification.processed_by = user.username; notification.processed_at = now
    _notify(db, row, "cash", "caisse.irongs.com", "beneficiary_contract_signed", "Dossier prêt au décaissement", f"La décision et la convention {row.contract_reference} sont signées. Procéder au paiement de {row.amount_approved:,.2f} DZD à {row.employee_name}.")
    db.commit(); db.refresh(row); return serialize_request(row)


@router.get("/cash/inbox")
def cash_inbox(db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_cash(user)
    notifications = db.execute(select(LoanWorkflowNotification).where(LoanWorkflowNotification.recipient_role == "cash").order_by(LoanWorkflowNotification.id.desc())).scalars().all()
    output = []
    for item in notifications:
        row = _request_or_404(db, item.loan_request_id); _ensure_society(user, row.society)
        if item.status == "unread": item.status = "read"; item.read_by = user.username; item.read_at = datetime.utcnow()
        output.append(_notification_dict(item, row))
    db.commit(); return output


@router.post("/management/requests/{request_id}/disburse")
def disburse_request(request_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_manager(user); _ensure_cash(user); row = _request_or_404(db, request_id, for_update=True); _ensure_society(user, row.society)
    if row.status != "cash_pending" or not row.decision_signed_at or not row.beneficiary_signed_at:
        raise HTTPException(status_code=409, detail="Les signatures du Directeur Général et du bénéficiaire sont obligatoires avant décaissement")
    now = datetime.utcnow(); row.status = "disbursed"; row.disbursed_at = now; row.disbursed_by = user.username
    notification = db.execute(select(LoanWorkflowNotification).where(LoanWorkflowNotification.loan_request_id == row.id, LoanWorkflowNotification.recipient_role == "cash", LoanWorkflowNotification.status != "processed").order_by(LoanWorkflowNotification.id.desc())).scalars().first()
    if notification: notification.status = "processed"; notification.processed_by = user.username; notification.processed_at = now
    db.commit(); db.refresh(row)
    return serialize_request(row)


@router.post("/management/requests/{request_id}/repayments", status_code=status.HTTP_201_CREATED)
def record_repayment(request_id: int, payload: LoanRepaymentCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_manager(user); row = _request_or_404(db, request_id, for_update=True); _ensure_society(user, row.society)
    if row.status != "disbursed" or not row.balance_due: raise HTTPException(status_code=409, detail="Aucun remboursement ne peut être enregistré")
    if payload.amount > row.balance_due + .01: raise HTTPException(status_code=422, detail="Le montant dépasse le solde restant")
    payment = EmployeeLoanRepayment(loan_request_id=row.id, payment_date=payload.payment_date, amount=round(payload.amount, 2), method=payload.method, payroll_period=payload.payroll_period, reference=payload.reference, note=payload.note, recorded_by=user.username)
    db.add(payment); row.balance_due = max(round(row.balance_due - payload.amount, 2), 0)
    if row.balance_due <= .01: row.balance_due = 0; row.status = "completed"; row.completed_at = datetime.utcnow()
    db.commit(); db.refresh(payment); db.refresh(row)
    return serialize_request(row, db.execute(select(EmployeeLoanRepayment).where(EmployeeLoanRepayment.loan_request_id == row.id).order_by(EmployeeLoanRepayment.payment_date)).scalars().all())


def _document_shell(title: str, body: str) -> str:
    return f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>@page{{size:A4;margin:16mm}}body{{max-width:850px;margin:25px auto;color:#14243a;font:14px Arial;line-height:1.6}}header{{display:flex;justify-content:space-between;border-bottom:3px solid #063f78;padding-bottom:16px}}h1{{color:#063f78;text-align:center;margin:32px 0}}table{{width:100%;border-collapse:collapse;margin:20px 0}}td{{border:1px solid #ccd8e5;padding:9px}}.signatures{{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:65px}}.signature{{min-height:130px;border-top:1px solid #333;padding-top:8px;text-align:center}}.print{{position:fixed;right:18px;top:18px;padding:10px 16px;border:0;background:#063f78;color:white;border-radius:8px}}@media print{{.print{{display:none}}body{{margin:0}}}}</style></head><body><button class="print" onclick="print()">IMPRIMER</button><header><b>IRON GROUP</b><span>Document officiel</span></header>{body}</body></html>'''


def _decision_html(row: EmployeeLoanRequest) -> str:
    return _document_shell("Décision " + str(row.decision_reference), f'''<h1>DÉCISION D’ACCORD<br><small>{html.escape(row.decision_reference or "")}</small></h1><p>Le Directeur Général décide d’accorder à <b>{html.escape(row.employee_name)}</b>, matricule <b>{html.escape(row.employee_code)}</b>, un(e) <b>{html.escape("avance sur salaire" if row.request_type == "advance" else "prêt au personnel")}</b>.</p><table><tr><td>Montant accordé</td><td><b>{row.amount_approved:,.2f} DZD</b></td></tr><tr><td>Nombre d’échéances</td><td>{row.installments_approved}</td></tr><tr><td>Retenue mensuelle</td><td>{row.monthly_installment:,.2f} DZD</td></tr><tr><td>Première échéance</td><td>{row.first_due_date or "—"}</td></tr><tr><td>Société</td><td>{html.escape(row.society or "")}</td></tr></table><p>La présente décision autorise la préparation de la convention avec le bénéficiaire. Aucun décaissement ne peut intervenir avant signature des deux documents.</p><div class="signatures"><div></div><div class="signature"><b>Le Directeur Général</b><br>Nom, cachet et signature</div></div>''')


def _contract_html(row: EmployeeLoanRequest) -> str:
    schedule = due_schedule(row)
    lines = "".join(f"<tr><td>{item['number']}</td><td>{item['due_date']}</td><td>{item['amount']:,.2f} DZD</td></tr>" for item in schedule)
    return _document_shell("Convention " + str(row.contract_reference), f'''<h1>CONVENTION DE {"PRÊT" if row.request_type == "loan" else "AVANCE SUR SALAIRE"}<br><small>{html.escape(row.contract_reference or "")}</small></h1><p>Entre <b>{html.escape(row.society or "IRON GROUP")}</b>, ci-après « l’Employeur », et <b>{html.escape(row.employee_name)}</b>, matricule <b>{html.escape(row.employee_code)}</b>, ci-après « le Bénéficiaire ».</p><p>Le Bénéficiaire reconnaît recevoir la somme de <b>{row.amount_approved:,.2f} DZD</b> et autorise son remboursement par retenues sur salaire, dans la limite de l’échéancier approuvé.</p><table><thead><tr><td>N°</td><td>Échéance</td><td>Montant</td></tr></thead><tbody>{lines}</tbody></table><p>Tout solde restant à la cessation de la relation de travail sera traité conformément à la réglementation applicable et aux sommes légalement compensables.</p><div class="signatures"><div class="signature"><b>L’Employeur</b><br>Cachet et signature</div><div class="signature"><b>Le Bénéficiaire</b><br>Lu et approuvé, signature</div></div>''')
