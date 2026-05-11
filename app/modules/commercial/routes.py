from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.pagination import paginate_statement
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.commercial import service
from app.modules.commercial.models import Client
from app.modules.commercial.schemas import ClientCreate, ClientOut, ClientUpdate


router = APIRouter(dependencies=[Depends(current_user)])


@router.get("/clients/page")
def clients_page(society: str | None = None, status: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    stmt = select(Client)
    if society:
        stmt = stmt.where(Client.society == society)
    if status:
        stmt = stmt.where(Client.status == status)
    return paginate_statement(db, stmt, model=Client, search_fields=[Client.name, Client.legal_name, Client.society, Client.structure, Client.contact_name, Client.phone, Client.email, Client.services], q=q, page=page, page_size=page_size)


@router.get("/clients", response_model=list[ClientOut])
def clients(society: str | None = None, status: str | None = None, db: Session = Depends(get_db)):
    return service.list_rows(db, Client, {"society": society, "status": status})


@router.post("/clients", response_model=ClientOut)
def create_client(payload: ClientCreate, db: Session = Depends(get_db)):
    return service.create_row(db, Client, payload)


@router.put("/clients/{client_id}", response_model=ClientOut)
def update_client(client_id: int, payload: ClientUpdate, db: Session = Depends(get_db)):
    return service.update_row(db, Client, client_id, payload)


@router.delete("/clients/{client_id}")
def delete_client(client_id: int, db: Session = Depends(get_db)):
    return service.delete_row(db, Client, client_id)
