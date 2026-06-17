from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.achats.models import (
    BonDeCommande,
    FactureFournisseur,
    Fournisseur,
    LigneBonDeCommande,
    LigneReception,
    ReceptionMarchandise,
)
from app.modules.achats.schemas import (
    BonDeCommandeCreate,
    BonDeCommandeUpdate,
    FactureFournisseurCreate,
    FactureFournisseurUpdate,
    FournisseurCreate,
    FournisseurUpdate,
    LigneBDCCreate,
    LigneBDCUpdate,
    LigneReceptionCreate,
    LigneReceptionUpdate,
    ReceptionCreate,
    ReceptionUpdate,
)
from app.modules.materiel.models import StockArticle, StockMovement, Supplier
from app.modules.accounting.auto import ecriture_facture_fournisseur, ecriture_paiement_fournisseur


def _next_numero(db: Session, model, field, prefix: str) -> str:
    year = date.today().year
    full_prefix = f"{prefix}{year}-"
    count = db.scalar(
        select(func.count(model.id)).where(getattr(model, field).like(f"{full_prefix}%"))
    ) or 0
    return f"{full_prefix}{count + 1:04d}"


def _calc_ligne(quantite: float, prix_unitaire_ht: float, tva_pct: float) -> tuple[float, float]:
    ht = round(quantite * prix_unitaire_ht, 2)
    ttc = round(ht * (1 + tva_pct / 100), 2)
    return ht, ttc


def _refresh_bdc_totals(db: Session, bdc: BonDeCommande) -> None:
    lignes = db.execute(select(LigneBonDeCommande).where(LigneBonDeCommande.bon_commande_id == bdc.id)).scalars().all()
    bdc.total_ht = round(sum(l.total_ht for l in lignes), 2)
    bdc.tva = round(sum(l.total_ttc - l.total_ht for l in lignes), 2)
    bdc.total_ttc = round(sum(l.total_ttc for l in lignes), 2)


def _row_to_dict(row) -> dict:
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


def _bdc_with_lignes(db: Session, bdc_id: int) -> dict:
    bdc = db.get(BonDeCommande, bdc_id)
    lignes = db.execute(select(LigneBonDeCommande).where(LigneBonDeCommande.bon_commande_id == bdc_id).order_by(LigneBonDeCommande.id)).scalars().all()
    data = _row_to_dict(bdc)
    data["lignes"] = [_row_to_dict(l) for l in lignes]
    return data


def _reception_with_lignes(db: Session, rec_id: int) -> dict:
    rec = db.get(ReceptionMarchandise, rec_id)
    lignes = db.execute(select(LigneReception).where(LigneReception.reception_id == rec_id).order_by(LigneReception.id)).scalars().all()
    data = _row_to_dict(rec)
    data["lignes"] = [_row_to_dict(l) for l in lignes]
    return data


# ── Fournisseurs ─────────────────────────────────────────────────────────────

def get_fournisseur_or_404(db: Session, fournisseur_id: int) -> Fournisseur:
    row = db.get(Fournisseur, fournisseur_id)
    if not row:
        raise HTTPException(status_code=404, detail="Fournisseur introuvable")
    return row


def list_fournisseurs(db: Session, society: str | None, status: str | None) -> list[Fournisseur]:
    stmt = select(Fournisseur)
    if society:
        stmt = stmt.where(Fournisseur.society == society)
    if status:
        stmt = stmt.where(Fournisseur.status == status)
    return db.execute(stmt.order_by(Fournisseur.name)).scalars().all()


def _sync_supplier(db: Session, fournisseur: Fournisseur) -> None:
    """Crée ou met à jour le Supplier matériel correspondant (même name+society)."""
    supplier = db.execute(
        select(Supplier).where(
            Supplier.name == fournisseur.name,
            Supplier.society == fournisseur.society,
        )
    ).scalars().first()
    if supplier is None:
        supplier = Supplier(name=fournisseur.name, society=fournisseur.society)
        db.add(supplier)
    supplier.contact_name = fournisseur.contact_name
    supplier.phone = fournisseur.phone
    supplier.email = fournisseur.email
    supplier.nif = fournisseur.nif
    supplier.rc = fournisseur.rc
    supplier.address = fournisseur.address
    db.flush()


def create_fournisseur(db: Session, payload: FournisseurCreate) -> Fournisseur:
    row = Fournisseur(**payload.model_dump())
    db.add(row)
    db.flush()
    _sync_supplier(db, row)
    db.commit()
    db.refresh(row)
    return row


def update_fournisseur(db: Session, fournisseur_id: int, payload: FournisseurUpdate) -> Fournisseur:
    row = get_fournisseur_or_404(db, fournisseur_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.flush()
    _sync_supplier(db, row)
    db.commit()
    db.refresh(row)
    return row


def delete_fournisseur(db: Session, fournisseur_id: int) -> dict:
    row = get_fournisseur_or_404(db, fournisseur_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": fournisseur_id}


# ── Bon de commande ───────────────────────────────────────────────────────────

def get_bdc_or_404(db: Session, bdc_id: int) -> BonDeCommande:
    row = db.get(BonDeCommande, bdc_id)
    if not row:
        raise HTTPException(status_code=404, detail="Bon de commande introuvable")
    return row


def create_bdc(db: Session, payload: BonDeCommandeCreate) -> dict:
    numero = _next_numero(db, BonDeCommande, "numero", "BDC-")
    bdc = BonDeCommande(
        numero=numero,
        society=payload.society,
        fournisseur_id=payload.fournisseur_id,
        fournisseur_name=payload.fournisseur_name,
        date_commande=payload.date_commande,
        date_livraison_prevue=payload.date_livraison_prevue,
        notes=payload.notes,
        data=payload.data,
        status="brouillon",
    )
    db.add(bdc)
    db.flush()
    for ligne_data in payload.lignes:
        ht, ttc = _calc_ligne(ligne_data.quantite, ligne_data.prix_unitaire_ht, ligne_data.tva_pct)
        ligne = LigneBonDeCommande(bon_commande_id=bdc.id, total_ht=ht, total_ttc=ttc, **ligne_data.model_dump())
        db.add(ligne)
    db.flush()
    _refresh_bdc_totals(db, bdc)
    db.commit()
    return _bdc_with_lignes(db, bdc.id)


def update_bdc(db: Session, bdc_id: int, payload: BonDeCommandeUpdate) -> dict:
    bdc = get_bdc_or_404(db, bdc_id)
    if bdc.status == "annulé":
        raise HTTPException(status_code=400, detail="Impossible de modifier un bon annulé")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(bdc, key, value)
    db.commit()
    return _bdc_with_lignes(db, bdc_id)


def valider_bdc(db: Session, bdc_id: int) -> dict:
    bdc = get_bdc_or_404(db, bdc_id)
    if bdc.status != "brouillon":
        raise HTTPException(status_code=400, detail=f"Statut actuel : {bdc.status}")
    bdc.status = "validé"
    db.commit()
    return _bdc_with_lignes(db, bdc_id)


def annuler_bdc(db: Session, bdc_id: int) -> dict:
    bdc = get_bdc_or_404(db, bdc_id)
    if bdc.status == "annulé":
        raise HTTPException(status_code=400, detail="Bon déjà annulé")
    bdc.status = "annulé"
    db.commit()
    return _bdc_with_lignes(db, bdc_id)


def delete_bdc(db: Session, bdc_id: int) -> dict:
    bdc = get_bdc_or_404(db, bdc_id)
    if bdc.status != "brouillon":
        raise HTTPException(status_code=400, detail="Seuls les brouillons peuvent être supprimés")
    lignes = db.execute(select(LigneBonDeCommande).where(LigneBonDeCommande.bon_commande_id == bdc_id)).scalars().all()
    for l in lignes:
        db.delete(l)
    db.delete(bdc)
    db.commit()
    return {"deleted": True, "id": bdc_id}


def add_ligne_bdc(db: Session, bdc_id: int, payload: LigneBDCCreate) -> dict:
    bdc = get_bdc_or_404(db, bdc_id)
    if bdc.status == "annulé":
        raise HTTPException(status_code=400, detail="Bon annulé")
    ht, ttc = _calc_ligne(payload.quantite, payload.prix_unitaire_ht, payload.tva_pct)
    ligne = LigneBonDeCommande(bon_commande_id=bdc_id, total_ht=ht, total_ttc=ttc, **payload.model_dump())
    db.add(ligne)
    db.flush()
    _refresh_bdc_totals(db, bdc)
    db.commit()
    return _bdc_with_lignes(db, bdc_id)


def update_ligne_bdc(db: Session, bdc_id: int, ligne_id: int, payload: LigneBDCUpdate) -> dict:
    bdc = get_bdc_or_404(db, bdc_id)
    if bdc.status == "annulé":
        raise HTTPException(status_code=400, detail="Bon de commande annulé — modification impossible")
    ligne = db.get(LigneBonDeCommande, ligne_id)
    if not ligne or ligne.bon_commande_id != bdc_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(ligne, key, value)
    ligne.total_ht, ligne.total_ttc = _calc_ligne(ligne.quantite, ligne.prix_unitaire_ht, ligne.tva_pct)
    db.flush()
    _refresh_bdc_totals(db, bdc)
    db.commit()
    return _bdc_with_lignes(db, bdc_id)


def delete_ligne_bdc(db: Session, bdc_id: int, ligne_id: int) -> dict:
    bdc = get_bdc_or_404(db, bdc_id)
    if bdc.status == "annulé":
        raise HTTPException(status_code=400, detail="Bon de commande annulé — modification impossible")
    ligne = db.get(LigneBonDeCommande, ligne_id)
    if not ligne or ligne.bon_commande_id != bdc_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    db.delete(ligne)
    db.flush()
    _refresh_bdc_totals(db, bdc)
    db.commit()
    return _bdc_with_lignes(db, bdc_id)


# ── Réception ─────────────────────────────────────────────────────────────────

def get_reception_or_404(db: Session, rec_id: int) -> ReceptionMarchandise:
    row = db.get(ReceptionMarchandise, rec_id)
    if not row:
        raise HTTPException(status_code=404, detail="Réception introuvable")
    return row


def create_reception(db: Session, payload: ReceptionCreate) -> dict:
    numero = _next_numero(db, ReceptionMarchandise, "numero", "REC-")
    rec = ReceptionMarchandise(
        numero=numero,
        society=payload.society,
        bon_commande_id=payload.bon_commande_id,
        fournisseur_id=payload.fournisseur_id,
        fournisseur_name=payload.fournisseur_name,
        date_reception=payload.date_reception,
        notes=payload.notes,
        data=payload.data,
        status="en_cours",
    )
    db.add(rec)
    db.flush()
    for ligne_data in payload.lignes:
        ligne = LigneReception(reception_id=rec.id, **ligne_data.model_dump())
        db.add(ligne)
    db.commit()
    return _reception_with_lignes(db, rec.id)


def update_reception(db: Session, rec_id: int, payload: ReceptionUpdate) -> dict:
    rec = get_reception_or_404(db, rec_id)
    if rec.status == "annulée":
        raise HTTPException(status_code=400, detail="Réception annulée")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(rec, key, value)
    db.commit()
    return _reception_with_lignes(db, rec_id)


def valider_reception(db: Session, rec_id: int) -> dict:
    """
    Valide une réception marchandise :
    - Passe le statut à "reçue"
    - Crée un StockMovement par ligne ayant quantite_recue > 0
      (cherche l'article par article_id si défini, sinon par designation)
    - Met à jour StockArticle.quantity
    """
    rec = get_reception_or_404(db, rec_id)
    if rec.status == "reçue":
        raise HTTPException(status_code=400, detail="Réception déjà validée")
    if rec.status == "annulée":
        raise HTTPException(status_code=400, detail="Réception annulée")

    lignes = db.execute(
        select(LigneReception).where(LigneReception.reception_id == rec_id)
    ).scalars().all()

    mouvements_crees = 0
    for ligne in lignes:
        qte = float(ligne.quantite_recue or 0)
        if qte <= 0:
            continue

        # Résolution de l'article : par FK si définie, sinon par désignation
        article: StockArticle | None = None
        if ligne.article_id:
            article = db.get(StockArticle, ligne.article_id)
        if article is None:
            article = db.execute(
                select(StockArticle).where(
                    StockArticle.designation.ilike(ligne.designation),
                    StockArticle.active == 1,
                )
            ).scalars().first()

        if article is None:
            continue

        mvt = StockMovement(
            article_id=article.id,
            movement_date=rec.date_reception or date.today(),
            movement_type="achat",
            quantity=qte,
            unit_price=float(ligne.prix_unitaire or article.unit_price or 0),
            supplier_id=rec.fournisseur_id,
            recipient=rec.fournisseur_name or "",
            reason=f"Réception {rec.numero}",
            voucher_number=rec.numero,
        )
        db.add(mvt)
        article.quantity = round(float(article.quantity or 0) + qte, 4)
        mouvements_crees += 1

    rec.status = "reçue"
    db.commit()
    result = _reception_with_lignes(db, rec_id)
    result["mouvements_crees"] = mouvements_crees
    return result


def add_ligne_reception(db: Session, rec_id: int, payload: LigneReceptionCreate) -> dict:
    get_reception_or_404(db, rec_id)
    ligne = LigneReception(reception_id=rec_id, **payload.model_dump())
    db.add(ligne)
    db.commit()
    return _reception_with_lignes(db, rec_id)


def update_ligne_reception(db: Session, rec_id: int, ligne_id: int, payload: LigneReceptionUpdate) -> dict:
    get_reception_or_404(db, rec_id)
    ligne = db.get(LigneReception, ligne_id)
    if not ligne or ligne.reception_id != rec_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(ligne, key, value)
    db.commit()
    return _reception_with_lignes(db, rec_id)


def delete_ligne_reception(db: Session, rec_id: int, ligne_id: int) -> dict:
    get_reception_or_404(db, rec_id)
    ligne = db.get(LigneReception, ligne_id)
    if not ligne or ligne.reception_id != rec_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    db.delete(ligne)
    db.commit()
    return _reception_with_lignes(db, rec_id)


# ── Facture fournisseur ───────────────────────────────────────────────────────

def get_facture_or_404(db: Session, facture_id: int) -> FactureFournisseur:
    row = db.get(FactureFournisseur, facture_id)
    if not row:
        raise HTTPException(status_code=404, detail="Facture fournisseur introuvable")
    return row


def create_facture(db: Session, payload: FactureFournisseurCreate) -> FactureFournisseur:
    numero = _next_numero(db, FactureFournisseur, "numero", "FF-")
    facture = FactureFournisseur(numero=numero, status="en_attente", **payload.model_dump())
    db.add(facture)
    db.flush()
    try:
        ecriture_facture_fournisseur(db, facture)
    except Exception:
        pass  # Ne pas bloquer la création si la comptabilité échoue
    db.commit()
    db.refresh(facture)
    return facture


def update_facture(db: Session, facture_id: int, payload: FactureFournisseurUpdate) -> FactureFournisseur:
    facture = get_facture_or_404(db, facture_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(facture, key, value)
    db.commit()
    db.refresh(facture)
    return facture


def payer_facture(db: Session, facture_id: int, montant: float) -> FactureFournisseur:
    if montant <= 0:
        raise HTTPException(status_code=400, detail="Le montant doit être positif")
    facture = get_facture_or_404(db, facture_id)
    if facture.status == "payée":
        raise HTTPException(status_code=400, detail="Facture déjà entièrement payée")
    restant = round(facture.total_ttc - facture.montant_paye, 2)
    if montant > restant:
        raise HTTPException(status_code=400, detail=f"Montant ({montant}) dépasse le restant à payer ({restant})")
    facture.montant_paye = round(facture.montant_paye + montant, 2)
    facture.status = "payée" if facture.montant_paye >= facture.total_ttc else "partiellement_payée"
    try:
        ecriture_paiement_fournisseur(db, facture, montant)
    except Exception:
        pass
    db.commit()
    db.refresh(facture)
    return facture
