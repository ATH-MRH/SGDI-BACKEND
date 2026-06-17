from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exports import excel_response, pdf_document
from app.core.pagination import paginate_statement
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.achats import service
from app.modules.achats.models import BonDeCommande, FactureFournisseur, Fournisseur, LigneBonDeCommande, ReceptionMarchandise
from app.modules.achats.schemas import (
    BonDeCommandeCreate,
    BonDeCommandeUpdate,
    FactureFournisseurCreate,
    FactureFournisseurOut,
    FactureFournisseurUpdate,
    FournisseurCreate,
    FournisseurOut,
    FournisseurUpdate,
    LigneBDCCreate,
    LigneBDCUpdate,
    LigneReceptionCreate,
    LigneReceptionUpdate,
    ReceptionCreate,
    ReceptionUpdate,
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


# ── Fournisseurs ──────────────────────────────────────────────────────────────

@router.get("/fournisseurs/page")
def fournisseurs_page(
    society: str | None = None, status: str | None = None, q: str | None = None,
    page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    stmt = select(Fournisseur)
    if eff:
        stmt = stmt.where(Fournisseur.society == eff)
    elif allowed:
        stmt = stmt.where(Fournisseur.society.in_(allowed))
    if status:
        stmt = stmt.where(Fournisseur.status == status)
    return paginate_statement(
        db, stmt, model=Fournisseur,
        search_fields=[Fournisseur.name, Fournisseur.legal_name, Fournisseur.contact_name, Fournisseur.phone, Fournisseur.email, Fournisseur.nif],
        q=q, page=page, page_size=page_size,
    )


@router.get("/fournisseurs", response_model=list[FournisseurOut])
def fournisseurs(society: str | None = None, status: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    eff = _effective_society(user, society)
    rows = service.list_fournisseurs(db, eff, status)
    allowed = _allowed_societies(user)
    if allowed and not eff:
        rows = [r for r in rows if r.society in allowed]
    return rows


@router.get("/fournisseurs/{fournisseur_id}", response_model=FournisseurOut)
def get_fournisseur(fournisseur_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = service.get_fournisseur_or_404(db, fournisseur_id)
    _ensure_society_allowed(user, row.society)
    return row


@router.post("/fournisseurs", response_model=FournisseurOut)
def create_fournisseur(payload: FournisseurCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_fournisseur(db, payload)


@router.put("/fournisseurs/{fournisseur_id}", response_model=FournisseurOut)
def update_fournisseur(fournisseur_id: int, payload: FournisseurUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_fournisseur_or_404(db, fournisseur_id)
    _ensure_society_allowed(user, payload.society or existing.society)
    return service.update_fournisseur(db, fournisseur_id, payload)


@router.delete("/fournisseurs/{fournisseur_id}")
def delete_fournisseur(fournisseur_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = service.get_fournisseur_or_404(db, fournisseur_id)
    _ensure_society_allowed(user, existing.society)
    return service.delete_fournisseur(db, fournisseur_id)


# ── Bons de commande ──────────────────────────────────────────────────────────

@router.get("/commandes/page")
def bdc_page(
    society: str | None = None, status: str | None = None, fournisseur_id: int | None = None,
    q: str | None = None, page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    stmt = select(BonDeCommande)
    if eff:
        stmt = stmt.where(BonDeCommande.society == eff)
    elif allowed:
        stmt = stmt.where(BonDeCommande.society.in_(allowed))
    if status:
        stmt = stmt.where(BonDeCommande.status == status)
    if fournisseur_id:
        stmt = stmt.where(BonDeCommande.fournisseur_id == fournisseur_id)
    return paginate_statement(
        db, stmt, model=BonDeCommande,
        search_fields=[BonDeCommande.numero, BonDeCommande.fournisseur_name],
        q=q, page=page, page_size=page_size,
    )


@router.get("/commandes/{bdc_id}")
def get_bdc(bdc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bdc = service.get_bdc_or_404(db, bdc_id)
    _ensure_society_allowed(user, bdc.society)
    return service._bdc_with_lignes(db, bdc_id)


@router.post("/commandes")
def create_bdc(payload: BonDeCommandeCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_bdc(db, payload)


@router.put("/commandes/{bdc_id}")
def update_bdc(bdc_id: int, payload: BonDeCommandeUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bdc = service.get_bdc_or_404(db, bdc_id)
    _ensure_society_allowed(user, bdc.society)
    return service.update_bdc(db, bdc_id, payload)


@router.post("/commandes/{bdc_id}/valider")
def valider_bdc(bdc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bdc = service.get_bdc_or_404(db, bdc_id)
    _ensure_society_allowed(user, bdc.society)
    return service.valider_bdc(db, bdc_id)


@router.post("/commandes/{bdc_id}/annuler")
def annuler_bdc(bdc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bdc = service.get_bdc_or_404(db, bdc_id)
    _ensure_society_allowed(user, bdc.society)
    return service.annuler_bdc(db, bdc_id)


@router.delete("/commandes/{bdc_id}")
def delete_bdc(bdc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bdc = service.get_bdc_or_404(db, bdc_id)
    _ensure_society_allowed(user, bdc.society)
    return service.delete_bdc(db, bdc_id)


@router.post("/commandes/{bdc_id}/lignes")
def add_ligne_bdc(bdc_id: int, payload: LigneBDCCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bdc = service.get_bdc_or_404(db, bdc_id)
    _ensure_society_allowed(user, bdc.society)
    return service.add_ligne_bdc(db, bdc_id, payload)


@router.put("/commandes/{bdc_id}/lignes/{ligne_id}")
def update_ligne_bdc(bdc_id: int, ligne_id: int, payload: LigneBDCUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bdc = service.get_bdc_or_404(db, bdc_id)
    _ensure_society_allowed(user, bdc.society)
    return service.update_ligne_bdc(db, bdc_id, ligne_id, payload)


@router.delete("/commandes/{bdc_id}/lignes/{ligne_id}")
def delete_ligne_bdc(bdc_id: int, ligne_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bdc = service.get_bdc_or_404(db, bdc_id)
    _ensure_society_allowed(user, bdc.society)
    return service.delete_ligne_bdc(db, bdc_id, ligne_id)


# ── Réceptions ────────────────────────────────────────────────────────────────

@router.get("/receptions/page")
def receptions_page(
    society: str | None = None, status: str | None = None, q: str | None = None,
    page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    stmt = select(ReceptionMarchandise)
    if eff:
        stmt = stmt.where(ReceptionMarchandise.society == eff)
    elif allowed:
        stmt = stmt.where(ReceptionMarchandise.society.in_(allowed))
    if status:
        stmt = stmt.where(ReceptionMarchandise.status == status)
    return paginate_statement(
        db, stmt, model=ReceptionMarchandise,
        search_fields=[ReceptionMarchandise.numero, ReceptionMarchandise.fournisseur_name],
        q=q, page=page, page_size=page_size,
    )


@router.get("/receptions/{rec_id}")
def get_reception(rec_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rec = service.get_reception_or_404(db, rec_id)
    _ensure_society_allowed(user, rec.society)
    return service._reception_with_lignes(db, rec_id)


@router.post("/receptions")
def create_reception(payload: ReceptionCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_reception(db, payload)


@router.put("/receptions/{rec_id}")
def update_reception(rec_id: int, payload: ReceptionUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rec = service.get_reception_or_404(db, rec_id)
    _ensure_society_allowed(user, rec.society)
    return service.update_reception(db, rec_id, payload)


@router.post("/receptions/{rec_id}/valider")
def valider_reception(rec_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Valide la réception : statut → reçue, crée les mouvements de stock."""
    rec = service.get_reception_or_404(db, rec_id)
    _ensure_society_allowed(user, rec.society)
    return service.valider_reception(db, rec_id)


@router.post("/receptions/{rec_id}/lignes")
def add_ligne_reception(rec_id: int, payload: LigneReceptionCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rec = service.get_reception_or_404(db, rec_id)
    _ensure_society_allowed(user, rec.society)
    return service.add_ligne_reception(db, rec_id, payload)


@router.put("/receptions/{rec_id}/lignes/{ligne_id}")
def update_ligne_reception(rec_id: int, ligne_id: int, payload: LigneReceptionUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rec = service.get_reception_or_404(db, rec_id)
    _ensure_society_allowed(user, rec.society)
    return service.update_ligne_reception(db, rec_id, ligne_id, payload)


@router.delete("/receptions/{rec_id}/lignes/{ligne_id}")
def delete_ligne_reception(rec_id: int, ligne_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rec = service.get_reception_or_404(db, rec_id)
    _ensure_society_allowed(user, rec.society)
    return service.delete_ligne_reception(db, rec_id, ligne_id)


# ── Factures fournisseur ──────────────────────────────────────────────────────

@router.get("/factures/page")
def factures_page(
    society: str | None = None, status: str | None = None, fournisseur_id: int | None = None,
    q: str | None = None, page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    stmt = select(FactureFournisseur)
    if eff:
        stmt = stmt.where(FactureFournisseur.society == eff)
    elif allowed:
        stmt = stmt.where(FactureFournisseur.society.in_(allowed))
    if status:
        stmt = stmt.where(FactureFournisseur.status == status)
    if fournisseur_id:
        stmt = stmt.where(FactureFournisseur.fournisseur_id == fournisseur_id)
    return paginate_statement(
        db, stmt, model=FactureFournisseur,
        search_fields=[FactureFournisseur.numero, FactureFournisseur.fournisseur_name, FactureFournisseur.numero_fournisseur],
        q=q, page=page, page_size=page_size,
    )


@router.get("/factures/{facture_id}", response_model=FactureFournisseurOut)
def get_facture(facture_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = service.get_facture_or_404(db, facture_id)
    _ensure_society_allowed(user, row.society)
    return row


@router.post("/factures", response_model=FactureFournisseurOut)
def create_facture(payload: FactureFournisseurCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_facture(db, payload)


@router.put("/factures/{facture_id}", response_model=FactureFournisseurOut)
def update_facture(facture_id: int, payload: FactureFournisseurUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = service.get_facture_or_404(db, facture_id)
    _ensure_society_allowed(user, row.society)
    return service.update_facture(db, facture_id, payload)


class PaiementPayload(BaseModel):
    montant: float


@router.post("/factures/{facture_id}/payer", response_model=FactureFournisseurOut)
def payer_facture(facture_id: int, payload: PaiementPayload, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = service.get_facture_or_404(db, facture_id)
    _ensure_society_allowed(user, row.society)
    return service.payer_facture(db, facture_id, payload.montant)


# ── Exports ──────────────────────────────────────────────────────────────────

@router.get("/fournisseurs/export/xlsx")
def export_fournisseurs_excel(
    society: str | None = None, status: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    rows = service.list_fournisseurs(db, eff, status)
    data_rows = [[r.name, r.legal_name, r.contact_name, r.phone, r.email, r.nif, r.rc, r.status] for r in rows]
    return excel_response("fournisseurs.xlsx", [{
        "title": "Fournisseurs",
        "headers": ["Nom", "Nom légal", "Contact", "Téléphone", "Email", "NIF", "RC", "Statut"],
        "rows": data_rows,
        "totals": None,
    }])


@router.get("/commandes/export/xlsx")
def export_bdc_excel(
    society: str | None = None, status: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    stmt = select(BonDeCommande)
    if eff:
        stmt = stmt.where(BonDeCommande.society == eff)
    if status:
        stmt = stmt.where(BonDeCommande.status == status)
    rows = db.execute(stmt.order_by(BonDeCommande.id.desc())).scalars().all()
    data_rows = [[r.numero, r.fournisseur_name, r.date_commande, r.date_livraison_prevue, r.status, r.total_ht, r.tva, r.total_ttc] for r in rows]
    return excel_response("bons_commande.xlsx", [{
        "title": "Bons de commande",
        "headers": ["N° BDC", "Fournisseur", "Date", "Livraison prévue", "Statut", "HT", "TVA", "TTC"],
        "rows": data_rows,
        "totals": ["TOTAL", "", "", "", "", sum(r.total_ht for r in rows), sum(r.tva for r in rows), sum(r.total_ttc for r in rows)],
    }])


@router.get("/commandes/{bdc_id}/pdf")
def export_bdc_pdf(bdc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bdc = service.get_bdc_or_404(db, bdc_id)
    _ensure_society_allowed(user, bdc.society)
    lignes = db.execute(select(LigneBonDeCommande).where(LigneBonDeCommande.bon_commande_id == bdc_id).order_by(LigneBonDeCommande.id)).scalars().all()
    meta = [
        ("N° BDC", bdc.numero or ""),
        ("Fournisseur", bdc.fournisseur_name or ""),
        ("Date commande", str(bdc.date_commande or "")),
        ("Livraison prévue", str(bdc.date_livraison_prevue or "")),
        ("Statut", bdc.status or ""),
        ("Société", bdc.society or ""),
    ]
    rows = [[l.designation, f"{l.quantite:.2f}", l.unite or "", f"{l.prix_unitaire_ht:,.2f}", f"{l.tva_pct:.1f}%", f"{l.total_ht:,.2f}", f"{l.total_ttc:,.2f}"] for l in lignes]
    totals = {"Total HT": bdc.total_ht, "TVA": bdc.tva, "Total TTC": bdc.total_ttc}
    columns = [("Désignation", 0.35), ("Qté", 0.08), ("Unité", 0.07), ("P.U. HT", 0.13), ("TVA", 0.07), ("Total HT", 0.15), ("Total TTC", 0.15)]
    return pdf_document(f"bdc-{bdc.numero or bdc_id}.pdf", f"BON DE COMMANDE — {bdc.numero or ''}", meta, columns, rows, totals, bdc.notes)


@router.get("/factures/export/xlsx")
def export_factures_excel(
    society: str | None = None, status: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    stmt = select(FactureFournisseur)
    if eff:
        stmt = stmt.where(FactureFournisseur.society == eff)
    if status:
        stmt = stmt.where(FactureFournisseur.status == status)
    rows = db.execute(stmt.order_by(FactureFournisseur.id.desc())).scalars().all()
    data_rows = [[r.numero, r.fournisseur_name, r.date_facture, r.date_echeance, r.status, r.total_ht, r.tva, r.total_ttc, r.montant_paye, round(r.total_ttc - r.montant_paye, 2)] for r in rows]
    return excel_response("factures_fournisseur.xlsx", [{
        "title": "Factures fournisseur",
        "headers": ["N°", "Fournisseur", "Date", "Échéance", "Statut", "HT", "TVA", "TTC", "Payé", "Restant"],
        "rows": data_rows,
        "totals": ["TOTAL", "", "", "", "", sum(r.total_ht for r in rows), sum(r.tva for r in rows), sum(r.total_ttc for r in rows), sum(r.montant_paye for r in rows), round(sum(r.total_ttc - r.montant_paye for r in rows), 2)],
    }])
