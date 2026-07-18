from fastapi import APIRouter, Depends, HTTPException, status
from app.core.authz import require_level
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exports import excel_response, pdf_document
from app.core.pagination import paginate_statement
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.ventes import service
from app.modules.ventes.models import BonDeLivraison, CommandeClient, Devis, LigneDevis, LigneCommandeClient
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


# ── Devis ─────────────────────────────────────────────────────────────────────

@router.get("/devis/page")
def devis_page(
    society: str | None = None, status: str | None = None, client_id: int | None = None,
    q: str | None = None, page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    stmt = select(Devis)
    if eff:
        stmt = stmt.where(Devis.society == eff)
    elif allowed:
        stmt = stmt.where(Devis.society.in_(allowed))
    if status:
        stmt = stmt.where(Devis.status == status)
    if client_id:
        stmt = stmt.where(Devis.client_id == client_id)
    return paginate_statement(
        db, stmt, model=Devis,
        search_fields=[Devis.numero, Devis.client_name, Devis.objet],
        q=q, page=page, page_size=page_size,
    )


@router.get("/devis/{devis_id}")
def get_devis(devis_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    devis = service.get_devis_or_404(db, devis_id)
    _ensure_society_allowed(user, devis.society)
    return service._devis_with_lignes(db, devis_id)


@router.post("/devis", dependencies=[Depends(require_level("write"))])
def create_devis(payload: DevisCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_devis(db, payload)


@router.put("/devis/{devis_id}", dependencies=[Depends(require_level("write"))])
def update_devis(devis_id: int, payload: DevisUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    devis = service.get_devis_or_404(db, devis_id)
    _ensure_society_allowed(user, devis.society)
    return service.update_devis(db, devis_id, payload)


@router.post("/devis/{devis_id}/valider", dependencies=[Depends(require_level("validate"))])
def valider_devis(devis_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    devis = service.get_devis_or_404(db, devis_id)
    _ensure_society_allowed(user, devis.society)
    return service.envoyer_devis(db, devis_id)


@router.post("/devis/{devis_id}/convertir", dependencies=[Depends(require_level("validate"))])
def convertir_devis(devis_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    devis = service.get_devis_or_404(db, devis_id)
    _ensure_society_allowed(user, devis.society)
    return service.convertir_en_commande(db, devis_id)


@router.delete("/devis/{devis_id}", dependencies=[Depends(require_level("delete"))])
def delete_devis(devis_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    devis = service.get_devis_or_404(db, devis_id)
    _ensure_society_allowed(user, devis.society)
    return service.delete_devis(db, devis_id)


@router.post("/devis/{devis_id}/lignes", dependencies=[Depends(require_level("write"))])
def add_ligne_devis(devis_id: int, payload: LigneVenteCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    devis = service.get_devis_or_404(db, devis_id)
    _ensure_society_allowed(user, devis.society)
    return service.add_ligne_devis(db, devis_id, payload)


@router.put("/devis/{devis_id}/lignes/{ligne_id}", dependencies=[Depends(require_level("write"))])
def update_ligne_devis(devis_id: int, ligne_id: int, payload: LigneVenteUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    devis = service.get_devis_or_404(db, devis_id)
    _ensure_society_allowed(user, devis.society)
    return service.update_ligne_devis(db, devis_id, ligne_id, payload)


@router.delete("/devis/{devis_id}/lignes/{ligne_id}", dependencies=[Depends(require_level("write"))])
def delete_ligne_devis(devis_id: int, ligne_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    devis = service.get_devis_or_404(db, devis_id)
    _ensure_society_allowed(user, devis.society)
    return service.delete_ligne_devis(db, devis_id, ligne_id)


# ── Commandes client ──────────────────────────────────────────────────────────

@router.get("/commandes/page")
def commandes_page(
    society: str | None = None, status: str | None = None, client_id: int | None = None,
    q: str | None = None, page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    stmt = select(CommandeClient)
    if eff:
        stmt = stmt.where(CommandeClient.society == eff)
    elif allowed:
        stmt = stmt.where(CommandeClient.society.in_(allowed))
    if status:
        stmt = stmt.where(CommandeClient.status == status)
    if client_id:
        stmt = stmt.where(CommandeClient.client_id == client_id)
    return paginate_statement(
        db, stmt, model=CommandeClient,
        search_fields=[CommandeClient.numero, CommandeClient.client_name, CommandeClient.objet],
        q=q, page=page, page_size=page_size,
    )


@router.get("/commandes/{cmd_id}")
def get_commande(cmd_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    cmd = service.get_commande_or_404(db, cmd_id)
    _ensure_society_allowed(user, cmd.society)
    return service._commande_with_lignes(db, cmd_id)


@router.post("/commandes", dependencies=[Depends(require_level("write"))])
def create_commande(payload: CommandeClientCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_commande(db, payload)


@router.put("/commandes/{cmd_id}", dependencies=[Depends(require_level("write"))])
def update_commande(cmd_id: int, payload: CommandeClientUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    cmd = service.get_commande_or_404(db, cmd_id)
    _ensure_society_allowed(user, cmd.society)
    return service.update_commande(db, cmd_id, payload)


@router.post("/commandes/{cmd_id}/lignes", dependencies=[Depends(require_level("write"))])
def add_ligne_commande(cmd_id: int, payload: LigneVenteCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    cmd = service.get_commande_or_404(db, cmd_id)
    _ensure_society_allowed(user, cmd.society)
    return service.add_ligne_commande(db, cmd_id, payload)


@router.put("/commandes/{cmd_id}/lignes/{ligne_id}", dependencies=[Depends(require_level("write"))])
def update_ligne_commande(cmd_id: int, ligne_id: int, payload: LigneVenteUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    cmd = service.get_commande_or_404(db, cmd_id)
    _ensure_society_allowed(user, cmd.society)
    return service.update_ligne_commande(db, cmd_id, ligne_id, payload)


@router.delete("/commandes/{cmd_id}/lignes/{ligne_id}", dependencies=[Depends(require_level("write"))])
def delete_ligne_commande(cmd_id: int, ligne_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    cmd = service.get_commande_or_404(db, cmd_id)
    _ensure_society_allowed(user, cmd.society)
    return service.delete_ligne_commande(db, cmd_id, ligne_id)


# ── Bons de livraison ─────────────────────────────────────────────────────────

@router.get("/livraisons/page")
def livraisons_page(
    society: str | None = None, status: str | None = None, client_id: int | None = None,
    q: str | None = None, page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    allowed = _allowed_societies(user)
    stmt = select(BonDeLivraison)
    if eff:
        stmt = stmt.where(BonDeLivraison.society == eff)
    elif allowed:
        stmt = stmt.where(BonDeLivraison.society.in_(allowed))
    if status:
        stmt = stmt.where(BonDeLivraison.status == status)
    if client_id:
        stmt = stmt.where(BonDeLivraison.client_id == client_id)
    return paginate_statement(
        db, stmt, model=BonDeLivraison,
        search_fields=[BonDeLivraison.numero, BonDeLivraison.client_name],
        q=q, page=page, page_size=page_size,
    )


@router.get("/livraisons/{bl_id}")
def get_bl(bl_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bl = service.get_bl_or_404(db, bl_id)
    _ensure_society_allowed(user, bl.society)
    return service._bl_with_lignes(db, bl_id)


@router.post("/livraisons", dependencies=[Depends(require_level("write"))])
def create_bl(payload: BonDeLivraisonCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    return service.create_bl(db, payload)


@router.put("/livraisons/{bl_id}", dependencies=[Depends(require_level("write"))])
def update_bl(bl_id: int, payload: BonDeLivraisonUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bl = service.get_bl_or_404(db, bl_id)
    _ensure_society_allowed(user, bl.society)
    return service.update_bl(db, bl_id, payload)


@router.post("/livraisons/{bl_id}/lignes", dependencies=[Depends(require_level("write"))])
def add_ligne_bl(bl_id: int, payload: LigneBLCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bl = service.get_bl_or_404(db, bl_id)
    _ensure_society_allowed(user, bl.society)
    return service.add_ligne_bl(db, bl_id, payload)


@router.put("/livraisons/{bl_id}/lignes/{ligne_id}", dependencies=[Depends(require_level("write"))])
def update_ligne_bl(bl_id: int, ligne_id: int, payload: LigneBLUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bl = service.get_bl_or_404(db, bl_id)
    _ensure_society_allowed(user, bl.society)
    return service.update_ligne_bl(db, bl_id, ligne_id, payload)


@router.delete("/livraisons/{bl_id}/lignes/{ligne_id}", dependencies=[Depends(require_level("write"))])
def delete_ligne_bl(bl_id: int, ligne_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    bl = service.get_bl_or_404(db, bl_id)
    _ensure_society_allowed(user, bl.society)
    return service.delete_ligne_bl(db, bl_id, ligne_id)


# ── Exports ──────────────────────────────────────────────────────────────────

@router.get("/devis/export/xlsx")
def export_devis_excel(
    society: str | None = None, status: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    stmt = select(Devis)
    if eff:
        stmt = stmt.where(Devis.society == eff)
    if status:
        stmt = stmt.where(Devis.status == status)
    rows = db.execute(stmt.order_by(Devis.id.desc())).scalars().all()
    data_rows = [[r.numero, r.client_name, r.date_devis, r.objet, r.status, r.total_ht, r.tva, r.total_ttc] for r in rows]
    return excel_response("devis.xlsx", [{
        "title": "Devis",
        "headers": ["N°", "Client", "Date", "Objet", "Statut", "HT", "TVA", "TTC"],
        "rows": data_rows,
        "totals": ["TOTAL", "", "", "", "", sum(r.total_ht for r in rows), sum(r.tva for r in rows), sum(r.total_ttc for r in rows)],
    }])


@router.get("/devis/{devis_id}/pdf")
def export_devis_pdf(devis_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    devis = service.get_devis_or_404(db, devis_id)
    _ensure_society_allowed(user, devis.society)
    lignes = db.execute(select(LigneDevis).where(LigneDevis.devis_id == devis_id).order_by(LigneDevis.id)).scalars().all()
    meta = [
        ("N° Devis", devis.numero or ""),
        ("Client", devis.client_name or ""),
        ("Objet", devis.objet or ""),
        ("Date", str(devis.date_devis or "")),
        ("Validité", str(devis.date_validite or "")),
        ("Statut", devis.status or ""),
        ("Société", devis.society or ""),
    ]
    rows = [[l.designation, f"{l.quantite:.2f}", l.unite or "", f"{l.prix_unitaire_ht:,.2f}", f"{l.tva_pct:.1f}%", f"{l.total_ht:,.2f}", f"{l.total_ttc:,.2f}"] for l in lignes]
    totals = {"Total HT": devis.total_ht, "TVA": devis.tva, "Total TTC": devis.total_ttc}
    columns = [("Désignation", 0.35), ("Qté", 0.08), ("Unité", 0.07), ("P.U. HT", 0.13), ("TVA", 0.07), ("Total HT", 0.15), ("Total TTC", 0.15)]
    return pdf_document(f"devis-{devis.numero or devis_id}.pdf", f"DEVIS — {devis.numero or ''}", meta, columns, rows, totals, devis.notes)


@router.get("/commandes/export/xlsx")
def export_commandes_excel(
    society: str | None = None, status: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    eff = _effective_society(user, society)
    stmt = select(CommandeClient)
    if eff:
        stmt = stmt.where(CommandeClient.society == eff)
    if status:
        stmt = stmt.where(CommandeClient.status == status)
    rows = db.execute(stmt.order_by(CommandeClient.id.desc())).scalars().all()
    data_rows = [[r.numero, r.client_name, r.date_commande, r.objet, r.status, r.total_ht, r.tva, r.total_ttc] for r in rows]
    return excel_response("commandes.xlsx", [{
        "title": "Commandes",
        "headers": ["N°", "Client", "Date", "Objet", "Statut", "HT", "TVA", "TTC"],
        "rows": data_rows,
        "totals": ["TOTAL", "", "", "", "", sum(r.total_ht for r in rows), sum(r.tva for r in rows), sum(r.total_ttc for r in rows)],
    }])
