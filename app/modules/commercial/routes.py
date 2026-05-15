from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.pagination import paginate_statement
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.commercial import service
from app.modules.commercial.models import Client
from app.modules.commercial.schemas import ClientCreate, ClientOut, ClientUpdate


router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _effective_society_filter(user: User, requested: str | None) -> str | None:
    allowed = _allowed_societies(user)
    if requested:
        _ensure_society_allowed(user, requested)
        return requested
    if len(allowed) == 1:
        return allowed[0]
    return None


def _ensure_client_allowed(db: Session, user: User, client_id: int) -> Client:
    row = db.get(Client, client_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    _ensure_society_allowed(user, row.society)
    return row


@router.get("/clients/page")
def clients_page(society: str | None = None, status: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    effective_society = _effective_society_filter(user, society)
    allowed = _allowed_societies(user)
    stmt = select(Client)
    if effective_society:
        stmt = stmt.where(Client.society == effective_society)
    elif allowed:
        stmt = stmt.where(Client.society.in_(allowed))
    if status:
        stmt = stmt.where(Client.status == status)
    return paginate_statement(db, stmt, model=Client, search_fields=[Client.name, Client.legal_name, Client.society, Client.structure, Client.contact_name, Client.phone, Client.email, Client.services], q=q, page=page, page_size=page_size)


@router.get("/clients", response_model=list[ClientOut])
def clients(society: str | None = None, status: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    effective_society = _effective_society_filter(user, society)
    rows = service.list_rows(db, Client, {"society": effective_society, "status": status})
    allowed = _allowed_societies(user)
    if allowed and not effective_society:
        rows = [row for row in rows if row.society in allowed]
    return rows


@router.post("/clients", response_model=ClientOut)
def create_client(payload: ClientCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_row(db, Client, payload)


@router.put("/clients/{client_id}", response_model=ClientOut)
def update_client(client_id: int, payload: ClientUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = _ensure_client_allowed(db, user, client_id)
    _ensure_society_allowed(user, payload.society or existing.society)
    return service.update_row(db, Client, client_id, payload)


@router.delete("/clients/{client_id}")
def delete_client(client_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_client_allowed(db, user, client_id)
    return service.delete_row(db, Client, client_id)
