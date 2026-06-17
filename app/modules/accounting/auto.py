"""
Génération automatique d'écritures comptables (brouillon) depuis les événements
métier : facture fournisseur, commande client, paiement client, paiement fournisseur,
entrée/sortie de caisse.

Toutes les écritures sont créées en statut "brouillon" — le comptable les valide
manuellement après vérification. Elles suivent le PCN algérien (Plan Comptable National).

Comptes utilisés :
  401 — Fournisseurs
  411 — Clients
  445 — TVA (44566 déductible, 44571 collectée)
  512 — Banques
  531 — Caisse
  607 — Achats de marchandises
  707 — Ventes de marchandises / prestations de services
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.accounting.models import EcritureComptable, LigneEcriture


def _next_numero_piece(db: Session) -> str:
    year = date.today().year
    prefix = f"JRN-{year}-"
    count = db.scalar(
        select(func.count(EcritureComptable.id)).where(
            EcritureComptable.numero_piece.like(f"{prefix}%")
        )
    ) or 0
    return f"{prefix}{count + 1:04d}"


def _create_ecriture(
    db: Session,
    *,
    society: str | None,
    journal: str,
    libelle: str,
    ref_externe: str | None,
    date_ecriture: date | None,
    lignes: list[dict[str, Any]],
) -> EcritureComptable:
    """Crée une écriture brouillon équilibrée et l'ajoute à la session (sans commit)."""
    numero = _next_numero_piece(db)
    ecriture = EcritureComptable(
        society=society,
        numero_piece=numero,
        date_ecriture=date_ecriture or date.today(),
        libelle=libelle,
        journal=journal,
        ref_externe=ref_externe,
        status="brouillon",
        total_debit=round(sum(l.get("debit", 0) for l in lignes), 2),
        total_credit=round(sum(l.get("credit", 0) for l in lignes), 2),
    )
    db.add(ecriture)
    db.flush()
    for l in lignes:
        db.add(LigneEcriture(
            ecriture_id=ecriture.id,
            compte_numero=l["compte"],
            libelle=l.get("libelle", libelle),
            debit=round(l.get("debit", 0), 2),
            credit=round(l.get("credit", 0), 2),
        ))
    db.flush()
    return ecriture


# ── Facture fournisseur ───────────────────────────────────────────────────────

def ecriture_facture_fournisseur(db: Session, facture: Any) -> EcritureComptable | None:
    """
    Achat HT + TVA déductible / Fournisseur TTC.
      D 607  Achats HT
      D 44566 TVA déductible
      C 401  Fournisseurs TTC
    """
    ht = float(facture.total_ht or 0)
    ttc = float(facture.total_ttc or 0)
    tva = round(ttc - ht, 2)
    if ttc <= 0:
        return None
    nom = getattr(facture, "fournisseur_name", None) or "Fournisseur"
    numero = getattr(facture, "numero", None) or str(getattr(facture, "id", ""))
    lignes: list[dict] = [
        {"compte": "607", "libelle": f"Achats — {nom}", "debit": ht, "credit": 0},
    ]
    if tva > 0:
        lignes.append({"compte": "44566", "libelle": "TVA déductible", "debit": tva, "credit": 0})
    lignes.append({"compte": "401", "libelle": f"Fournisseur {nom}", "debit": 0, "credit": ttc})
    return _create_ecriture(
        db,
        society=facture.society,
        journal="ACH",
        libelle=f"Facture fournisseur {numero} — {nom}",
        ref_externe=numero,
        date_ecriture=getattr(facture, "date_facture", None),
        lignes=lignes,
    )


# ── Facture client (Invoice) ──────────────────────────────────────────────────

def ecriture_facture_client(db: Session, invoice: Any) -> EcritureComptable | None:
    """
    Vente HT + TVA collectée / Client TTC.
      D 411  Clients TTC
      C 707  Ventes HT
      C 44571 TVA collectée
    """
    ht = float(getattr(invoice, "total_ht", 0) or 0)
    ttc = float(getattr(invoice, "total_ttc", 0) or 0)
    tva = round(ttc - ht, 2)
    if ttc <= 0:
        return None
    client = getattr(invoice, "client_name", None) or "Client"
    numero = getattr(invoice, "number", None) or str(getattr(invoice, "id", ""))
    lignes: list[dict] = [
        {"compte": "411", "libelle": f"Client {client}", "debit": ttc, "credit": 0},
        {"compte": "707", "libelle": f"Ventes — {client}", "debit": 0, "credit": ht},
    ]
    if tva > 0:
        lignes.append({"compte": "44571", "libelle": "TVA collectée", "debit": 0, "credit": tva})
    return _create_ecriture(
        db,
        society=getattr(invoice, "society", None),
        journal="VTE",
        libelle=f"Facture client {numero} — {client}",
        ref_externe=numero,
        date_ecriture=getattr(invoice, "invoice_date", None),
        lignes=lignes,
    )


# ── Paiement client ───────────────────────────────────────────────────────────

def ecriture_paiement_client(db: Session, payment: Any) -> EcritureComptable | None:
    """
    Encaissement client : Banque / Client.
      D 512  Banque
      C 411  Clients
    """
    amount = float(getattr(payment, "amount", 0) or 0)
    if amount <= 0:
        return None
    client = getattr(payment, "client_name", None) or "Client"
    ref = getattr(payment, "reference", None) or str(getattr(payment, "id", ""))
    return _create_ecriture(
        db,
        society=getattr(payment, "society", None),
        journal="BQ",
        libelle=f"Paiement client {client} — {ref}",
        ref_externe=ref,
        date_ecriture=getattr(payment, "payment_date", None),
        lignes=[
            {"compte": "512", "libelle": "Banque", "debit": amount, "credit": 0},
            {"compte": "411", "libelle": f"Client {client}", "debit": 0, "credit": amount},
        ],
    )


# ── Paiement fournisseur ──────────────────────────────────────────────────────

def ecriture_paiement_fournisseur(db: Session, facture: Any, montant: float) -> EcritureComptable | None:
    """
    Décaissement fournisseur : Fournisseur / Banque.
      D 401  Fournisseurs
      C 512  Banque
    """
    if montant <= 0:
        return None
    nom = getattr(facture, "fournisseur_name", None) or "Fournisseur"
    numero = getattr(facture, "numero", None) or str(getattr(facture, "id", ""))
    return _create_ecriture(
        db,
        society=getattr(facture, "society", None),
        journal="BQ",
        libelle=f"Paiement fournisseur {nom} — {numero}",
        ref_externe=numero,
        date_ecriture=date.today(),
        lignes=[
            {"compte": "401", "libelle": f"Fournisseur {nom}", "debit": montant, "credit": 0},
            {"compte": "512", "libelle": "Banque", "debit": 0, "credit": montant},
        ],
    )


# ── Caisse ────────────────────────────────────────────────────────────────────

def ecriture_caisse(db: Session, entry: Any) -> EcritureComptable | None:
    """
    Entrée caisse : D 531 / C 707
    Sortie caisse : D 607 / C 531
    """
    amount = float(getattr(entry, "amount", 0) or 0)
    if amount <= 0:
        return None
    entry_type = str(getattr(entry, "entry_type", "") or "").lower()
    label = getattr(entry, "label", None) or "Caisse"
    ref = getattr(entry, "external_id", None) or str(getattr(entry, "id", ""))
    is_entree = entry_type in ("entree", "encaissement", "recette")
    lignes: list[dict] = (
        [
            {"compte": "531", "libelle": "Caisse", "debit": amount, "credit": 0},
            {"compte": "707", "libelle": label, "debit": 0, "credit": amount},
        ]
        if is_entree
        else [
            {"compte": "607", "libelle": label, "debit": amount, "credit": 0},
            {"compte": "531", "libelle": "Caisse", "debit": 0, "credit": amount},
        ]
    )
    return _create_ecriture(
        db,
        society=getattr(entry, "society", None),
        journal="CAI",
        libelle=f"Caisse — {label}",
        ref_externe=ref,
        date_ecriture=getattr(entry, "entry_date", None),
        lignes=lignes,
    )
