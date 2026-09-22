from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.banking import service
from app.modules.banking.schemas import BankAccountCreate, BankAccountOut, BankStatementOut

router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


@router.get("/accounts", response_model=list[BankAccountOut])
def list_accounts(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed = _allowed_societies(user)
    if society:
        _ensure_society_allowed(user, society)
    return service.list_accounts(db, society=society, allowed=allowed if allowed and not society else None)


@router.post("/accounts", response_model=BankAccountOut)
def create_account(payload: BankAccountCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    account = service.create_account(
        db, society=payload.society, bank_name=payload.bank_name, account_number=payload.account_number,
        iban=payload.iban, currency=payload.currency, label=payload.label,
    )
    db.commit()
    db.refresh(account)
    return account


@router.get("/transactions")
def list_transactions(
    society: str | None = None, bank_account_id: int | None = None, reconcile_status: str | None = None,
    page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user),
):
    allowed = _allowed_societies(user)
    if society:
        _ensure_society_allowed(user, society)
    return service.list_transactions(
        db, society=society, allowed=allowed if allowed and not society else None,
        bank_account_id=bank_account_id, reconcile_status=reconcile_status, page=page, page_size=page_size,
    )


@router.post("/statements/import", response_model=BankStatementOut)
async def import_statement(
    society: str = Form(...),
    bank_account_id: int = Form(...),
    import_format: str = Form(...),
    idempotency_key: str = Form(...),
    opening_balance: str | None = Form(None),
    closing_balance: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    _ensure_society_allowed(user, society)
    raw_bytes = await file.read()
    statement = service.import_statement(
        db, society=society, bank_account_id=bank_account_id, import_format=import_format,
        file_name=file.filename, raw_bytes=raw_bytes,
        opening_balance=opening_balance, closing_balance=closing_balance,
        idempotency_key=idempotency_key,
    )
    db.commit()
    db.refresh(statement)
    return statement
