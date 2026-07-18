from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from app.core.authz import require_level
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.pagination import paginate_statement
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.accounting import service
from app.modules.accounting.models import CompteComptable, EcritureComptable
from app.modules.accounting.schemas import (
    CompteComptableCreate,
    CompteComptableOut,
    CompteComptableUpdate,
    EcritureComptableCreate,
    EcritureComptableUpdate,
    LigneEcritureCreate,
    LigneEcritureUpdate,
)

router = APIRouter(dependencies=[Depends(current_user)])


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _effective_society(user: User, requested: str | None) -> str | None:
    allowed = _allowed_societies(user)
    if requested:
        _ensure_society_allowed(user, requested)
        return requested
    if len(allowed) == 1:
        return allowed[0]
    return None


# ── Plan comptable ──────────────────────────────────────────────────────────

@router.get("/comptes/page")
def comptes_page(
    society: str | None = None, type_compte: str | None = None, q: str | None = None,
    page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    stmt = select(CompteComptable)
    if eff:
        stmt = stmt.where(CompteComptable.society == eff)
    elif allowed:
        stmt = stmt.where(CompteComptable.society.in_(allowed))
    if type_compte:
        stmt = stmt.where(CompteComptable.type_compte == type_compte)
    return paginate_statement(
        db, stmt, model=CompteComptable,
        search_fields=[CompteComptable.numero, CompteComptable.libelle],
        q=q, page=page, page_size=page_size,
        order_by=CompteComptable.numero,
    )


@router.get("/comptes", response_model=list[CompteComptableOut])
def comptes(society: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    rows = service.list_comptes(db, eff)
    if allowed and not eff:  # multi-sociétés sans filtre : borner aux sociétés autorisées
        rows = [r for r in rows if r.society in allowed]
    return rows


@router.post("/comptes", response_model=CompteComptableOut, dependencies=[Depends(require_level("write"))])
def create_compte(payload: CompteComptableCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_compte(db, payload)


@router.put("/comptes/{compte_id}", response_model=CompteComptableOut, dependencies=[Depends(require_level("write"))])
def update_compte(compte_id: int, payload: CompteComptableUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_compte_or_404(db, compte_id)
    _ensure_society_allowed(user, payload.society or existing.society)
    return service.update_compte(db, compte_id, payload)


@router.delete("/comptes/{compte_id}", dependencies=[Depends(require_level("delete"))])
def delete_compte(compte_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_compte_or_404(db, compte_id)
    _ensure_society_allowed(user, existing.society)
    return service.delete_compte(db, compte_id)


# ── Écritures comptables ────────────────────────────────────────────────────

@router.get("/ecritures/page")
def ecritures_page(
    society: str | None = None, journal: str | None = None,
    status: str | None = None, q: str | None = None,
    page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    stmt = select(EcritureComptable)
    if eff:
        stmt = stmt.where(EcritureComptable.society == eff)
    elif allowed:
        stmt = stmt.where(EcritureComptable.society.in_(allowed))
    if journal:
        stmt = stmt.where(EcritureComptable.journal == journal)
    if status:
        stmt = stmt.where(EcritureComptable.status == status)
    return paginate_statement(
        db, stmt, model=EcritureComptable,
        search_fields=[EcritureComptable.numero_piece, EcritureComptable.libelle, EcritureComptable.ref_externe],
        q=q, page=page, page_size=page_size,
    )


@router.get("/ecritures/{ecriture_id}")
def get_ecriture(ecriture_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ecriture = service.get_ecriture_or_404(db, ecriture_id)
    _ensure_society_allowed(user, ecriture.society)
    return service.get_ecriture_with_lignes(db, ecriture_id)


@router.post("/ecritures", dependencies=[Depends(require_level("write"))])
def create_ecriture(payload: EcritureComptableCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_ecriture(db, payload)


@router.put("/ecritures/{ecriture_id}", dependencies=[Depends(require_level("write"))])
def update_ecriture(ecriture_id: int, payload: EcritureComptableUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ecriture = service.get_ecriture_or_404(db, ecriture_id)
    _ensure_society_allowed(user, payload.society or ecriture.society)
    return service.update_ecriture(db, ecriture_id, payload)


@router.post("/ecritures/{ecriture_id}/valider", dependencies=[Depends(require_level("validate"))])
def valider_ecriture(ecriture_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ecriture = service.get_ecriture_or_404(db, ecriture_id)
    _ensure_society_allowed(user, ecriture.society)
    return service.valider_ecriture(db, ecriture_id)


@router.delete("/ecritures/{ecriture_id}", dependencies=[Depends(require_level("delete"))])
def delete_ecriture(ecriture_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ecriture = service.get_ecriture_or_404(db, ecriture_id)
    _ensure_society_allowed(user, ecriture.society)
    return service.delete_ecriture(db, ecriture_id)


@router.post("/ecritures/{ecriture_id}/lignes", dependencies=[Depends(require_level("write"))])
def add_ligne(ecriture_id: int, payload: LigneEcritureCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ecriture = service.get_ecriture_or_404(db, ecriture_id)
    _ensure_society_allowed(user, ecriture.society)
    return service.add_ligne(db, ecriture_id, payload)


@router.put("/ecritures/{ecriture_id}/lignes/{ligne_id}", dependencies=[Depends(require_level("write"))])
def update_ligne(ecriture_id: int, ligne_id: int, payload: LigneEcritureUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ecriture = service.get_ecriture_or_404(db, ecriture_id)
    _ensure_society_allowed(user, ecriture.society)
    return service.update_ligne(db, ecriture_id, ligne_id, payload)


@router.delete("/ecritures/{ecriture_id}/lignes/{ligne_id}", dependencies=[Depends(require_level("write"))])
def delete_ligne(ecriture_id: int, ligne_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ecriture = service.get_ecriture_or_404(db, ecriture_id)
    _ensure_society_allowed(user, ecriture.society)
    return service.delete_ligne(db, ecriture_id, ligne_id)


# ── Rapports ────────────────────────────────────────────────────────────────

@router.get("/balance")
def balance(
    society: str | None = None, date_debut: date | None = None, date_fin: date | None = None,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    return service.get_balance(db, eff, date_debut, date_fin, societies=None if eff else (allowed or None))
