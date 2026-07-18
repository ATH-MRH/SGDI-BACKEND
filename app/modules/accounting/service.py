from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.accounting.models import CompteComptable, EcritureComptable, LigneEcriture
from app.modules.accounting.schemas import (
    CompteComptableCreate,
    CompteComptableUpdate,
    EcritureComptableCreate,
    EcritureComptableUpdate,
    LigneEcritureCreate,
    LigneEcritureUpdate,
)


def _next_numero_piece(db: Session, year: int) -> str:
    prefix = f"JRN-{year}-"
    count = db.scalar(
        select(func.count(EcritureComptable.id)).where(
            EcritureComptable.numero_piece.like(f"{prefix}%")
        )
    ) or 0
    return f"{prefix}{count + 1:04d}"


def _refresh_totals(db: Session, ecriture: EcritureComptable) -> None:
    lignes = db.execute(
        select(LigneEcriture).where(LigneEcriture.ecriture_id == ecriture.id)
    ).scalars().all()
    ecriture.total_debit = round(sum(l.debit for l in lignes), 2)
    ecriture.total_credit = round(sum(l.credit for l in lignes), 2)


def get_compte_or_404(db: Session, compte_id: int) -> CompteComptable:
    row = db.get(CompteComptable, compte_id)
    if not row:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return row


def list_comptes(db: Session, society: str | None = None) -> list[CompteComptable]:
    stmt = select(CompteComptable)
    if society:
        stmt = stmt.where(CompteComptable.society == society)
    return db.execute(stmt.order_by(CompteComptable.numero)).scalars().all()


def create_compte(db: Session, payload: CompteComptableCreate) -> CompteComptable:
    row = CompteComptable(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_compte(db: Session, compte_id: int, payload: CompteComptableUpdate) -> CompteComptable:
    row = get_compte_or_404(db, compte_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def delete_compte(db: Session, compte_id: int) -> dict:
    row = get_compte_or_404(db, compte_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": compte_id}


def get_ecriture_or_404(db: Session, ecriture_id: int) -> EcritureComptable:
    row = db.get(EcritureComptable, ecriture_id)
    if not row:
        raise HTTPException(status_code=404, detail="Écriture introuvable")
    return row


def get_ecriture_with_lignes(db: Session, ecriture_id: int) -> dict:
    ecriture = get_ecriture_or_404(db, ecriture_id)
    lignes = db.execute(
        select(LigneEcriture).where(LigneEcriture.ecriture_id == ecriture_id).order_by(LigneEcriture.id)
    ).scalars().all()
    data = {c.name: getattr(ecriture, c.name) for c in ecriture.__table__.columns}
    data["lignes"] = [
        {c.name: getattr(l, c.name) for c in l.__table__.columns} for l in lignes
    ]
    return data


def create_ecriture(db: Session, payload: EcritureComptableCreate) -> dict:
    year = (payload.date_ecriture or date.today()).year
    numero = _next_numero_piece(db, year)
    ecriture = EcritureComptable(
        society=payload.society,
        numero_piece=numero,
        date_ecriture=payload.date_ecriture,
        libelle=payload.libelle,
        journal=payload.journal,
        ref_externe=payload.ref_externe,
        notes=payload.notes,
        status="brouillon",
    )
    db.add(ecriture)
    db.flush()
    for ligne_data in payload.lignes:
        ligne = LigneEcriture(ecriture_id=ecriture.id, **ligne_data.model_dump())
        db.add(ligne)
    db.flush()
    _refresh_totals(db, ecriture)
    db.commit()
    db.refresh(ecriture)
    return get_ecriture_with_lignes(db, ecriture.id)


def update_ecriture(db: Session, ecriture_id: int, payload: EcritureComptableUpdate) -> dict:
    ecriture = get_ecriture_or_404(db, ecriture_id)
    if ecriture.status == "validée":
        raise HTTPException(status_code=400, detail="Impossible de modifier une écriture validée")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(ecriture, key, value)
    db.commit()
    return get_ecriture_with_lignes(db, ecriture_id)


def valider_ecriture(db: Session, ecriture_id: int) -> dict:
    ecriture = get_ecriture_or_404(db, ecriture_id)
    if ecriture.status == "validée":
        raise HTTPException(status_code=400, detail="Écriture déjà validée")
    if round(ecriture.total_debit, 2) != round(ecriture.total_credit, 2):
        raise HTTPException(
            status_code=400,
            detail=f"Écriture non équilibrée : débit {ecriture.total_debit} ≠ crédit {ecriture.total_credit}",
        )
    ecriture.status = "validée"
    db.commit()
    return get_ecriture_with_lignes(db, ecriture_id)


def delete_ecriture(db: Session, ecriture_id: int) -> dict:
    ecriture = get_ecriture_or_404(db, ecriture_id)
    if ecriture.status == "validée":
        raise HTTPException(status_code=400, detail="Impossible de supprimer une écriture validée")
    db.execute(
        select(LigneEcriture).where(LigneEcriture.ecriture_id == ecriture_id)
    )
    lignes = db.execute(
        select(LigneEcriture).where(LigneEcriture.ecriture_id == ecriture_id)
    ).scalars().all()
    for l in lignes:
        db.delete(l)
    db.delete(ecriture)
    db.commit()
    return {"deleted": True, "id": ecriture_id}


def add_ligne(db: Session, ecriture_id: int, payload: LigneEcritureCreate) -> dict:
    ecriture = get_ecriture_or_404(db, ecriture_id)
    if ecriture.status == "validée":
        raise HTTPException(status_code=400, detail="Impossible de modifier une écriture validée")
    ligne = LigneEcriture(ecriture_id=ecriture_id, **payload.model_dump())
    db.add(ligne)
    db.flush()
    _refresh_totals(db, ecriture)
    db.commit()
    return get_ecriture_with_lignes(db, ecriture_id)


def update_ligne(db: Session, ecriture_id: int, ligne_id: int, payload: LigneEcritureUpdate) -> dict:
    ecriture = get_ecriture_or_404(db, ecriture_id)
    if ecriture.status == "validée":
        raise HTTPException(status_code=400, detail="Impossible de modifier une écriture validée")
    ligne = db.get(LigneEcriture, ligne_id)
    if not ligne or ligne.ecriture_id != ecriture_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(ligne, key, value)
    db.flush()
    _refresh_totals(db, ecriture)
    db.commit()
    return get_ecriture_with_lignes(db, ecriture_id)


def delete_ligne(db: Session, ecriture_id: int, ligne_id: int) -> dict:
    ecriture = get_ecriture_or_404(db, ecriture_id)
    if ecriture.status == "validée":
        raise HTTPException(status_code=400, detail="Impossible de modifier une écriture validée")
    ligne = db.get(LigneEcriture, ligne_id)
    if not ligne or ligne.ecriture_id != ecriture_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    db.delete(ligne)
    db.flush()
    _refresh_totals(db, ecriture)
    db.commit()
    return get_ecriture_with_lignes(db, ecriture_id)


def get_balance(db: Session, society: str | None, date_debut: date | None, date_fin: date | None, societies: list[str] | None = None) -> list[dict]:
    stmt = select(LigneEcriture).join(
        EcritureComptable, LigneEcriture.ecriture_id == EcritureComptable.id
    ).where(EcritureComptable.status == "validée")
    if society:
        stmt = stmt.where(EcritureComptable.society == society)
    elif societies:  # utilisateur multi-sociétés : agrégat borné à ses sociétés
        stmt = stmt.where(EcritureComptable.society.in_(societies))
    if date_debut:
        stmt = stmt.where(EcritureComptable.date_ecriture >= date_debut)
    if date_fin:
        stmt = stmt.where(EcritureComptable.date_ecriture <= date_fin)
    lignes = db.execute(stmt).scalars().all()

    totals: dict[str, dict] = {}
    for l in lignes:
        if l.compte_numero not in totals:
            compte = db.execute(
                select(CompteComptable).where(CompteComptable.numero == l.compte_numero)
            ).scalars().first()
            totals[l.compte_numero] = {
                "compte_numero": l.compte_numero,
                "libelle": compte.libelle if compte else l.compte_numero,
                "total_debit": 0.0,
                "total_credit": 0.0,
            }
        totals[l.compte_numero]["total_debit"] += l.debit
        totals[l.compte_numero]["total_credit"] += l.credit

    result = []
    for entry in sorted(totals.values(), key=lambda x: x["compte_numero"]):
        entry["total_debit"] = round(entry["total_debit"], 2)
        entry["total_credit"] = round(entry["total_credit"], 2)
        entry["solde"] = round(entry["total_debit"] - entry["total_credit"], 2)
        result.append(entry)
    return result
