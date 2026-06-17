from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.finance_models import Invoice
from app.modules.accounting.auto import ecriture_facture_client
from app.modules.ventes.models import (
    BonDeLivraison,
    CommandeClient,
    Devis,
    LigneBonDeLivraison,
    LigneCommandeClient,
    LigneDevis,
)
from app.modules.ventes.schemas import (
    BonDeLivraisonCreate,
    BonDeLivraisonUpdate,
    CommandeClientCreate,
    CommandeClientUpdate,
    DevisCreate,
    DevisUpdate,
    LigneBLCreate,
    LigneBLUpdate,
    LigneVenteCreate,
    LigneVenteUpdate,
)


def _next_numero(db: Session, model, prefix: str) -> str:
    year = date.today().year
    full_prefix = f"{prefix}{year}-"
    count = db.scalar(
        select(func.count(model.id)).where(model.numero.like(f"{full_prefix}%"))
    ) or 0
    return f"{full_prefix}{count + 1:04d}"


def _next_invoice_number(db: Session) -> str:
    year = date.today().year
    prefix = f"FAC-{year}-"
    count = db.scalar(
        select(func.count(Invoice.id)).where(Invoice.number.like(f"{prefix}%"))
    ) or 0
    return f"{prefix}{count + 1:04d}"


def _create_invoice_from_commande(db: Session, cmd: "CommandeClient") -> Invoice:
    """Crée une Invoice Finance à partir d'une CommandeClient confirmée."""
    invoice = Invoice(
        number=_next_invoice_number(db),
        invoice_date=date.today(),
        society=cmd.society,
        client_name=cmd.client_name,
        subject=cmd.objet,
        status="en_attente",
        total_ht=cmd.total_ht,
        total_ttc=cmd.total_ttc,
    )
    db.add(invoice)
    db.flush()
    try:
        ecriture_facture_client(db, invoice)
    except Exception:
        pass
    return invoice


def _calc(quantite: float, prix_unitaire_ht: float, tva_pct: float) -> tuple[float, float]:
    ht = round(quantite * prix_unitaire_ht, 2)
    ttc = round(ht * (1 + tva_pct / 100), 2)
    return ht, ttc


def _row_to_dict(row) -> dict:
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


def _refresh_doc_totals(db: Session, doc, lignes_model, fk_field: str) -> None:
    lignes = db.execute(
        select(lignes_model).where(getattr(lignes_model, fk_field) == doc.id)
    ).scalars().all()
    doc.total_ht = round(sum(l.total_ht for l in lignes), 2)
    doc.tva = round(sum(l.total_ttc - l.total_ht for l in lignes), 2)
    doc.total_ttc = round(sum(l.total_ttc for l in lignes), 2)


def _devis_with_lignes(db: Session, devis_id: int) -> dict:
    devis = db.get(Devis, devis_id)
    lignes = db.execute(select(LigneDevis).where(LigneDevis.devis_id == devis_id).order_by(LigneDevis.id)).scalars().all()
    data = _row_to_dict(devis)
    data["lignes"] = [_row_to_dict(l) for l in lignes]
    return data


def _commande_with_lignes(db: Session, cmd_id: int) -> dict:
    cmd = db.get(CommandeClient, cmd_id)
    lignes = db.execute(select(LigneCommandeClient).where(LigneCommandeClient.commande_id == cmd_id).order_by(LigneCommandeClient.id)).scalars().all()
    data = _row_to_dict(cmd)
    data["lignes"] = [_row_to_dict(l) for l in lignes]
    return data


def _bl_with_lignes(db: Session, bl_id: int) -> dict:
    bl = db.get(BonDeLivraison, bl_id)
    lignes = db.execute(select(LigneBonDeLivraison).where(LigneBonDeLivraison.bl_id == bl_id).order_by(LigneBonDeLivraison.id)).scalars().all()
    data = _row_to_dict(bl)
    data["lignes"] = [_row_to_dict(l) for l in lignes]
    return data


# ── Devis ────────────────────────────────────────────────────────────────────

def get_devis_or_404(db: Session, devis_id: int) -> Devis:
    row = db.get(Devis, devis_id)
    if not row:
        raise HTTPException(status_code=404, detail="Devis introuvable")
    return row


def create_devis(db: Session, payload: DevisCreate) -> dict:
    numero = _next_numero(db, Devis, "DEV-")
    devis = Devis(
        numero=numero, status="brouillon",
        society=payload.society, client_id=payload.client_id, client_name=payload.client_name,
        date_devis=payload.date_devis, date_validite=payload.date_validite,
        objet=payload.objet, notes=payload.notes, data=payload.data,
    )
    db.add(devis)
    db.flush()
    for l in payload.lignes:
        ht, ttc = _calc(l.quantite, l.prix_unitaire_ht, l.tva_pct)
        db.add(LigneDevis(devis_id=devis.id, total_ht=ht, total_ttc=ttc, **l.model_dump()))
    db.flush()
    _refresh_doc_totals(db, devis, LigneDevis, "devis_id")
    db.commit()
    return _devis_with_lignes(db, devis.id)


def update_devis(db: Session, devis_id: int, payload: DevisUpdate) -> dict:
    devis = get_devis_or_404(db, devis_id)
    if devis.status in ("accepté", "annulé"):
        raise HTTPException(status_code=400, detail=f"Devis {devis.status}, modification impossible")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(devis, key, value)
    db.commit()
    return _devis_with_lignes(db, devis_id)


def envoyer_devis(db: Session, devis_id: int) -> dict:
    devis = get_devis_or_404(db, devis_id)
    if devis.status != "brouillon":
        raise HTTPException(status_code=400, detail=f"Statut actuel : {devis.status}")
    devis.status = "envoyé"
    db.commit()
    return _devis_with_lignes(db, devis_id)


def convertir_en_commande(db: Session, devis_id: int) -> dict:
    devis = get_devis_or_404(db, devis_id)
    if devis.status not in ("envoyé", "accepté"):
        raise HTTPException(status_code=400, detail="Devis doit être envoyé ou accepté pour être converti")
    devis.status = "accepté"
    lignes_devis = db.execute(select(LigneDevis).where(LigneDevis.devis_id == devis_id).order_by(LigneDevis.id)).scalars().all()
    numero = _next_numero(db, CommandeClient, "CMD-")
    cmd = CommandeClient(
        numero=numero, status="confirmée",
        society=devis.society, client_id=devis.client_id, client_name=devis.client_name,
        devis_id=devis_id, objet=devis.objet, date_commande=date.today(),
        total_ht=devis.total_ht, tva=devis.tva, total_ttc=devis.total_ttc,
    )
    db.add(cmd)
    db.flush()
    for l in lignes_devis:
        db.add(LigneCommandeClient(
            commande_id=cmd.id,
            designation=l.designation, reference=l.reference,
            quantite=l.quantite, unite=l.unite,
            prix_unitaire_ht=l.prix_unitaire_ht, tva_pct=l.tva_pct,
            total_ht=l.total_ht, total_ttc=l.total_ttc,
        ))
    db.flush()
    _create_invoice_from_commande(db, cmd)
    db.commit()
    return _commande_with_lignes(db, cmd.id)


def delete_devis(db: Session, devis_id: int) -> dict:
    devis = get_devis_or_404(db, devis_id)
    if devis.status != "brouillon":
        raise HTTPException(status_code=400, detail="Seuls les brouillons peuvent être supprimés")
    for l in db.execute(select(LigneDevis).where(LigneDevis.devis_id == devis_id)).scalars().all():
        db.delete(l)
    db.delete(devis)
    db.commit()
    return {"deleted": True, "id": devis_id}


def add_ligne_devis(db: Session, devis_id: int, payload: LigneVenteCreate) -> dict:
    devis = get_devis_or_404(db, devis_id)
    if devis.status in ("accepté", "annulé"):
        raise HTTPException(status_code=400, detail="Devis non modifiable")
    ht, ttc = _calc(payload.quantite, payload.prix_unitaire_ht, payload.tva_pct)
    db.add(LigneDevis(devis_id=devis_id, total_ht=ht, total_ttc=ttc, **payload.model_dump()))
    db.flush()
    _refresh_doc_totals(db, devis, LigneDevis, "devis_id")
    db.commit()
    return _devis_with_lignes(db, devis_id)


def update_ligne_devis(db: Session, devis_id: int, ligne_id: int, payload: LigneVenteUpdate) -> dict:
    devis = get_devis_or_404(db, devis_id)
    ligne = db.get(LigneDevis, ligne_id)
    if not ligne or ligne.devis_id != devis_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(ligne, key, value)
    ligne.total_ht, ligne.total_ttc = _calc(ligne.quantite, ligne.prix_unitaire_ht, ligne.tva_pct)
    db.flush()
    _refresh_doc_totals(db, devis, LigneDevis, "devis_id")
    db.commit()
    return _devis_with_lignes(db, devis_id)


def delete_ligne_devis(db: Session, devis_id: int, ligne_id: int) -> dict:
    devis = get_devis_or_404(db, devis_id)
    ligne = db.get(LigneDevis, ligne_id)
    if not ligne or ligne.devis_id != devis_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    db.delete(ligne)
    db.flush()
    _refresh_doc_totals(db, devis, LigneDevis, "devis_id")
    db.commit()
    return _devis_with_lignes(db, devis_id)


# ── Commande client ───────────────────────────────────────────────────────────

def get_commande_or_404(db: Session, cmd_id: int) -> CommandeClient:
    row = db.get(CommandeClient, cmd_id)
    if not row:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    return row


def create_commande(db: Session, payload: CommandeClientCreate) -> dict:
    numero = _next_numero(db, CommandeClient, "CMD-")
    initial_status = getattr(payload, "status", "brouillon") or "brouillon"
    cmd = CommandeClient(
        numero=numero, status=initial_status,
        society=payload.society, client_id=payload.client_id, client_name=payload.client_name,
        devis_id=payload.devis_id, date_commande=payload.date_commande,
        date_livraison_prevue=payload.date_livraison_prevue, objet=payload.objet,
        notes=payload.notes, data=payload.data,
    )
    db.add(cmd)
    db.flush()
    for l in payload.lignes:
        ht, ttc = _calc(l.quantite, l.prix_unitaire_ht, l.tva_pct)
        db.add(LigneCommandeClient(commande_id=cmd.id, total_ht=ht, total_ttc=ttc, **l.model_dump()))
    db.flush()
    _refresh_doc_totals(db, cmd, LigneCommandeClient, "commande_id")
    if initial_status == "confirmée":
        _create_invoice_from_commande(db, cmd)
    db.commit()
    return _commande_with_lignes(db, cmd.id)


def update_commande(db: Session, cmd_id: int, payload: CommandeClientUpdate) -> dict:
    cmd = get_commande_or_404(db, cmd_id)
    if cmd.status == "annulée":
        raise HTTPException(status_code=400, detail="Commande annulée")
    previous_status = cmd.status
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(cmd, key, value)
    # Génère la facture si la commande vient d'être confirmée
    if cmd.status == "confirmée" and previous_status != "confirmée":
        db.flush()
        _create_invoice_from_commande(db, cmd)
    db.commit()
    return _commande_with_lignes(db, cmd_id)


def add_ligne_commande(db: Session, cmd_id: int, payload: LigneVenteCreate) -> dict:
    cmd = get_commande_or_404(db, cmd_id)
    ht, ttc = _calc(payload.quantite, payload.prix_unitaire_ht, payload.tva_pct)
    db.add(LigneCommandeClient(commande_id=cmd_id, total_ht=ht, total_ttc=ttc, **payload.model_dump()))
    db.flush()
    _refresh_doc_totals(db, cmd, LigneCommandeClient, "commande_id")
    db.commit()
    return _commande_with_lignes(db, cmd_id)


def update_ligne_commande(db: Session, cmd_id: int, ligne_id: int, payload: LigneVenteUpdate) -> dict:
    cmd = get_commande_or_404(db, cmd_id)
    ligne = db.get(LigneCommandeClient, ligne_id)
    if not ligne or ligne.commande_id != cmd_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(ligne, key, value)
    ligne.total_ht, ligne.total_ttc = _calc(ligne.quantite, ligne.prix_unitaire_ht, ligne.tva_pct)
    db.flush()
    _refresh_doc_totals(db, cmd, LigneCommandeClient, "commande_id")
    db.commit()
    return _commande_with_lignes(db, cmd_id)


def delete_ligne_commande(db: Session, cmd_id: int, ligne_id: int) -> dict:
    cmd = get_commande_or_404(db, cmd_id)
    ligne = db.get(LigneCommandeClient, ligne_id)
    if not ligne or ligne.commande_id != cmd_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    db.delete(ligne)
    db.flush()
    _refresh_doc_totals(db, cmd, LigneCommandeClient, "commande_id")
    db.commit()
    return _commande_with_lignes(db, cmd_id)


# ── Bon de livraison ──────────────────────────────────────────────────────────

def get_bl_or_404(db: Session, bl_id: int) -> BonDeLivraison:
    row = db.get(BonDeLivraison, bl_id)
    if not row:
        raise HTTPException(status_code=404, detail="Bon de livraison introuvable")
    return row


def create_bl(db: Session, payload: BonDeLivraisonCreate) -> dict:
    numero = _next_numero(db, BonDeLivraison, "BL-")
    bl = BonDeLivraison(
        numero=numero, status="brouillon",
        society=payload.society, commande_id=payload.commande_id,
        client_id=payload.client_id, client_name=payload.client_name,
        date_livraison=payload.date_livraison, notes=payload.notes, data=payload.data,
    )
    db.add(bl)
    db.flush()
    for l in payload.lignes:
        db.add(LigneBonDeLivraison(bl_id=bl.id, **l.model_dump()))
    db.commit()
    return _bl_with_lignes(db, bl.id)


def update_bl(db: Session, bl_id: int, payload: BonDeLivraisonUpdate) -> dict:
    bl = get_bl_or_404(db, bl_id)
    if bl.status == "annulé":
        raise HTTPException(status_code=400, detail="BL annulé")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(bl, key, value)
    db.commit()
    return _bl_with_lignes(db, bl_id)


def add_ligne_bl(db: Session, bl_id: int, payload: LigneBLCreate) -> dict:
    get_bl_or_404(db, bl_id)
    db.add(LigneBonDeLivraison(bl_id=bl_id, **payload.model_dump()))
    db.commit()
    return _bl_with_lignes(db, bl_id)


def update_ligne_bl(db: Session, bl_id: int, ligne_id: int, payload: LigneBLUpdate) -> dict:
    get_bl_or_404(db, bl_id)
    ligne = db.get(LigneBonDeLivraison, ligne_id)
    if not ligne or ligne.bl_id != bl_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(ligne, key, value)
    db.commit()
    return _bl_with_lignes(db, bl_id)


def delete_ligne_bl(db: Session, bl_id: int, ligne_id: int) -> dict:
    get_bl_or_404(db, bl_id)
    ligne = db.get(LigneBonDeLivraison, ligne_id)
    if not ligne or ligne.bl_id != bl_id:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    db.delete(ligne)
    db.commit()
    return _bl_with_lignes(db, bl_id)
