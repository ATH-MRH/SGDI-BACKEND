from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.achats.models import BonDeCommande, FactureFournisseur, Fournisseur
from app.modules.commercial.models import Client
from app.modules.finance_models import CashEntry, Invoice, Payment
from app.modules.ventes.models import CommandeClient, Devis, BonDeLivraison


def _society_filter(stmt, model, society: str | None, allowed: list[str]):
    if society:
        return stmt.where(model.society == society)
    if allowed:
        return stmt.where(model.society.in_(allowed))
    return stmt


def _date_filter(stmt, date_field, date_debut: date | None, date_fin: date | None):
    if date_debut:
        stmt = stmt.where(date_field >= date_debut)
    if date_fin:
        stmt = stmt.where(date_field <= date_fin)
    return stmt


def dashboard_kpis(
    db: Session,
    society: str | None,
    allowed: list[str],
    date_debut: date | None,
    date_fin: date | None,
) -> dict:
    def count(model, date_field=None):
        stmt = select(func.count(model.id))
        stmt = _society_filter(stmt, model, society, allowed)
        if date_field is not None:
            stmt = _date_filter(stmt, date_field, date_debut, date_fin)
        return db.scalar(stmt) or 0

    def total(model, amount_field, date_field=None, status_filter=None):
        stmt = select(func.coalesce(func.sum(amount_field), 0))
        stmt = _society_filter(stmt, model, society, allowed)
        if date_field is not None:
            stmt = _date_filter(stmt, date_field, date_debut, date_fin)
        if status_filter is not None:
            stmt = stmt.where(status_filter)
        return float(db.scalar(stmt) or 0)

    ca_ttc = total(Invoice, Invoice.total_ttc, Invoice.invoice_date)
    ca_ht = total(Invoice, Invoice.total_ht, Invoice.invoice_date)
    paiements = total(Payment, Payment.amount, Payment.payment_date)
    achats_ttc = total(FactureFournisseur, FactureFournisseur.total_ttc, FactureFournisseur.date_facture)
    achats_ht = total(FactureFournisseur, FactureFournisseur.total_ht, FactureFournisseur.date_facture)
    marge_brute = round(ca_ht - achats_ht, 2)

    return {
        "chiffre_affaires_ht": round(ca_ht, 2),
        "chiffre_affaires_ttc": round(ca_ttc, 2),
        "paiements_encaisses": round(paiements, 2),
        "achats_ttc": round(achats_ttc, 2),
        "marge_brute_estimee": marge_brute,
        "nb_clients": count(Client),
        "nb_fournisseurs": count(Fournisseur),
        "nb_devis": count(Devis, Devis.date_devis),
        "nb_commandes": count(CommandeClient, CommandeClient.date_commande),
        "nb_livraisons": count(BonDeLivraison, BonDeLivraison.date_livraison),
        "nb_factures": count(Invoice, Invoice.invoice_date),
        "nb_bons_commande_achat": count(BonDeCommande, BonDeCommande.date_commande),
    }


def _agg_by_status(db, model, status_field, date_field, society, allowed, date_debut, date_fin, amount_field=None):
    stmt = select(status_field, func.count().label("n"), func.coalesce(func.sum(amount_field), 0).label("s") if amount_field is not None else func.count().label("s"))
    stmt = _society_filter(stmt, model, society, allowed)
    stmt = _date_filter(stmt, date_field, date_debut, date_fin)
    stmt = stmt.group_by(status_field)
    rows = db.execute(stmt).all()
    total = sum(r.n for r in rows)
    montant = round(sum(float(r.s) for r in rows), 2) if amount_field is not None else None
    par_status = {r[0]: r.n for r in rows if r[0] is not None}
    return total, montant, par_status


def ventes_stats(
    db: Session,
    society: str | None,
    allowed: list[str],
    date_debut: date | None,
    date_fin: date | None,
) -> dict:
    d_total, d_ttc, d_status = _agg_by_status(db, Devis, Devis.status, Devis.date_devis, society, allowed, date_debut, date_fin, Devis.total_ttc)
    c_total, c_ttc, c_status = _agg_by_status(db, CommandeClient, CommandeClient.status, CommandeClient.date_commande, society, allowed, date_debut, date_fin, CommandeClient.total_ttc)
    bl_total, _, bl_status = _agg_by_status(db, BonDeLivraison, BonDeLivraison.status, BonDeLivraison.date_livraison, society, allowed, date_debut, date_fin)
    f_total, f_ttc, f_status = _agg_by_status(db, Invoice, Invoice.status, Invoice.invoice_date, society, allowed, date_debut, date_fin, Invoice.total_ttc)
    return {
        "devis": {"total": d_total, "montant_ttc": d_ttc, "par_status": d_status},
        "commandes": {"total": c_total, "montant_ttc": c_ttc, "par_status": c_status},
        "livraisons": {"total": bl_total, "par_status": bl_status},
        "factures": {"total": f_total, "montant_ttc": f_ttc, "par_status": f_status},
    }


def achats_stats(
    db: Session,
    society: str | None,
    allowed: list[str],
    date_debut: date | None,
    date_fin: date | None,
) -> dict:
    b_total, b_ttc, b_status = _agg_by_status(db, BonDeCommande, BonDeCommande.status, BonDeCommande.date_commande, society, allowed, date_debut, date_fin, BonDeCommande.total_ttc)
    f_total, f_ttc, f_status = _agg_by_status(db, FactureFournisseur, FactureFournisseur.status, FactureFournisseur.date_facture, society, allowed, date_debut, date_fin, FactureFournisseur.total_ttc)

    stmt_ff = select(func.coalesce(func.sum(FactureFournisseur.montant_paye), 0))
    stmt_ff = _society_filter(stmt_ff, FactureFournisseur, society, allowed)
    stmt_ff = _date_filter(stmt_ff, FactureFournisseur.date_facture, date_debut, date_fin)
    montant_paye = round(float(db.scalar(stmt_ff) or 0), 2)

    return {
        "bons_commande": {"total": b_total, "montant_ttc": b_ttc, "par_status": b_status},
        "factures_fournisseur": {
            "total": f_total, "montant_ttc": f_ttc,
            "montant_paye": montant_paye,
            "restant_a_payer": round((f_ttc or 0) - montant_paye, 2),
            "par_status": f_status,
        },
    }


def top_clients(
    db: Session,
    society: str | None,
    allowed: list[str],
    date_debut: date | None,
    date_fin: date | None,
    limit: int,
) -> list[dict]:
    stmt = (
        select(Invoice.client_name, func.sum(Invoice.total_ttc).label("total"))
        .where(Invoice.client_name.isnot(None))
    )
    stmt = _society_filter(stmt, Invoice, society, allowed)
    stmt = _date_filter(stmt, Invoice.invoice_date, date_debut, date_fin)
    stmt = stmt.group_by(Invoice.client_name).order_by(func.sum(Invoice.total_ttc).desc()).limit(limit)
    rows = db.execute(stmt).all()
    return [{"client_name": r.client_name, "total_ttc": round(r.total, 2)} for r in rows]


def top_fournisseurs(
    db: Session,
    society: str | None,
    allowed: list[str],
    date_debut: date | None,
    date_fin: date | None,
    limit: int,
) -> list[dict]:
    stmt = (
        select(FactureFournisseur.fournisseur_name, func.sum(FactureFournisseur.total_ttc).label("total"))
        .where(FactureFournisseur.fournisseur_name.isnot(None))
    )
    stmt = _society_filter(stmt, FactureFournisseur, society, allowed)
    stmt = _date_filter(stmt, FactureFournisseur.date_facture, date_debut, date_fin)
    stmt = stmt.group_by(FactureFournisseur.fournisseur_name).order_by(func.sum(FactureFournisseur.total_ttc).desc()).limit(limit)
    rows = db.execute(stmt).all()
    return [{"fournisseur_name": r.fournisseur_name, "total_ttc": round(r.total, 2)} for r in rows]


def tresorerie_stats(
    db: Session,
    society: str | None,
    allowed: list[str],
    date_debut: date | None,
    date_fin: date | None,
) -> dict:
    def total(model, amount_field, date_field):
        stmt = select(func.coalesce(func.sum(amount_field), 0))
        stmt = _society_filter(stmt, model, society, allowed)
        stmt = _date_filter(stmt, date_field, date_debut, date_fin)
        return round(float(db.scalar(stmt) or 0), 2)

    encaissements = total(Payment, Payment.amount, Payment.payment_date)

    stmt = select(func.coalesce(func.sum(CashEntry.amount), 0))
    stmt = _society_filter(stmt, CashEntry, society, allowed)
    stmt = _date_filter(stmt, CashEntry.entry_date, date_debut, date_fin)
    stmt = stmt.where(CashEntry.entry_type == "entree")
    entrees_caisse = round(float(db.scalar(stmt) or 0), 2)

    stmt = select(func.coalesce(func.sum(CashEntry.amount), 0))
    stmt = _society_filter(stmt, CashEntry, society, allowed)
    stmt = _date_filter(stmt, CashEntry.entry_date, date_debut, date_fin)
    stmt = stmt.where(CashEntry.entry_type == "sortie")
    sorties_caisse = round(float(db.scalar(stmt) or 0), 2)

    factures_payees_fournisseur = total(FactureFournisseur, FactureFournisseur.montant_paye, FactureFournisseur.date_facture)

    return {
        "encaissements_clients": encaissements,
        "entrees_caisse": entrees_caisse,
        "sorties_caisse": sorties_caisse,
        "decaissements_fournisseurs": factures_payees_fournisseur,
        "solde_net": round(encaissements + entrees_caisse - sorties_caisse - factures_payees_fournisseur, 2),
    }
