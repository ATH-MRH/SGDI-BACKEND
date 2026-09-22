"""ATLAS Banking Core — service (P1-D/P1-E).

Import de relevés : SEUL le format CSV est réellement implémenté dans ce lot (parseur réel,
testé, avec contrôle mathématique et déduplication). XLSX/CAMT053/MT940/PDF-OCR ont une
interface d'adaptateur prête (ImportAdapter, get_adapter) mais lèvent explicitement
NotImplementedError — ce n'est PAS déguisé en succès silencieux : voir docs/
atlas-finance-platform-parity.md pour l'état exact de chaque format. Construire un parseur
CAMT.053/MT940/OCR conforme à la norme réelle (SWIFT/ISO 20022) dépasse le périmètre
raisonnable de ce lot ; un stub qui prétendrait les supporter serait plus dangereux qu'utile.
"""
from __future__ import annotations

import csv
import hashlib
import io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.banking.models import BankAccount, BankStatement, BankTransaction

TWO_PLACES = Decimal("0.01")


def q2(value: Any) -> Decimal:
    # Revue d'intégrité, item 4 (Decimal/arrondis) — TROUVÉ PENDANT L'AUDIT : rounding=
    # manquant ici retombait sur le contexte decimal par défaut de Python (ROUND_HALF_EVEN,
    # "bankers' rounding"), alors que finance_core.service.q2 et payroll.service.q2 utilisent
    # explicitement ROUND_HALF_UP — la politique d'arrondi DOIT être identique partout où un
    # montant financier est manipulé (voir docs/atlas-finance-platform-parity.md, "Politique
    # d'arrondi"), sans quoi un même montant à la limite exacte (ex. x,xx5) pourrait arrondir
    # différemment selon qu'il transite par le module bancaire ou par finance_core/payroll —
    # un désaccord d'un centime en rapprochement bancaire, silencieux et difficile à tracer.
    return Decimal(str(value)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


# ── Comptes bancaires ───────────────────────────────────────────────────────────────────

def create_account(db: Session, *, society: str, bank_name: str, account_number: str, iban: str | None,
                    currency: str = "DZD", label: str | None = None) -> BankAccount:
    existing = db.scalar(
        select(BankAccount).where(BankAccount.society == society, BankAccount.account_number == account_number)
    )
    if existing:
        return existing
    account = BankAccount(
        society=society, bank_name=bank_name, account_number=account_number, iban=iban,
        currency=currency, label=label, active=1,
    )
    db.add(account)
    db.flush()
    return account


def get_account_or_404(db: Session, account_id: int) -> BankAccount:
    account = db.get(BankAccount, account_id)
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Compte bancaire introuvable")
    return account


def list_accounts(db: Session, *, society: str | None, allowed: list[str] | None) -> list[BankAccount]:
    stmt = select(BankAccount)
    if society:
        stmt = stmt.where(BankAccount.society == society)
    elif allowed:
        stmt = stmt.where(BankAccount.society.in_(allowed))
    return list(db.scalars(stmt.order_by(BankAccount.id.desc())).all())


# ── Clôture (P1-H) ──────────────────────────────────────────────────────────────────────
# Un relevé clôturé devient une période gelée : les transactions qui le composent ne
# peuvent plus être proposées à un NOUVEAU rapprochement (reconciliation/service.py le
# vérifie explicitement — voir _ensure_statement_open). Clôturer n'annule JAMAIS un
# rapprochement déjà confirmé — ce n'est pas une suppression, seulement un verrou vers
# l'avant, cohérent avec l'intégrité append-only du reste de Finance Core (P0-A).

def close_statement(db: Session, statement_id: int, *, closed_by: str) -> BankStatement:
    statement = db.get(BankStatement, statement_id)
    if not statement:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Relevé introuvable")
    if statement.closed:
        return statement
    unmatched = db.scalar(
        select(BankTransaction).where(
            BankTransaction.bank_statement_id == statement_id, BankTransaction.reconcile_status == "unmatched",
        )
    )
    if unmatched is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Des transactions de ce relevé restent non rapprochées — traitez-les (ou classez-les en exception) avant de clôturer",
        )
    statement.closed = 1
    db.flush()
    return statement


def reopen_statement(db: Session, statement_id: int) -> BankStatement:
    statement = db.get(BankStatement, statement_id)
    if not statement:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Relevé introuvable")
    statement.closed = 0
    db.flush()
    return statement


# ── Déduplication ───────────────────────────────────────────────────────────────────────

def _dedup_hash(bank_account_id: int, value_date: date | None, amount: Decimal, label: str, reference: str) -> str:
    raw = f"{bank_account_id}|{value_date}|{amount}|{label.strip().lower()}|{reference.strip().lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ── Adaptateurs d'import ────────────────────────────────────────────────────────────────

class ImportAdapter:
    format_key: str = "abstract"

    def parse(self, raw_bytes: bytes) -> list[dict[str, Any]]:
        """Retourne une liste de dicts {value_date, booking_date, amount(Decimal signé),
        label, reference, raw}."""
        raise NotImplementedError


class CsvImportAdapter(ImportAdapter):
    """Colonnes attendues (insensibles à la casse, ordre libre) : date (ou value_date),
    label (ou libelle), reference (optionnel), puis SOIT amount (signé) SOIT debit+credit
    (deux colonnes séparées, un seul renseigné par ligne — convention bancaire standard)."""

    format_key = "csv"

    def parse(self, raw_bytes: bytes) -> list[dict[str, Any]]:
        text = raw_bytes.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="CSV vide ou sans en-tête")
        headers = {h.strip().lower(): h for h in reader.fieldnames}

        def col(row: dict, *names: str) -> str | None:
            for name in names:
                key = headers.get(name)
                if key is not None and row.get(key) not in (None, ""):
                    return row[key]
            return None

        rows: list[dict[str, Any]] = []
        for i, row in enumerate(reader, start=2):  # ligne 1 = en-tête
            raw_date = col(row, "date", "value_date", "date_valeur")
            label = col(row, "label", "libelle", "libellé", "description") or ""
            reference = col(row, "reference", "référence", "ref") or ""
            amount_raw = col(row, "amount", "montant")
            debit_raw = col(row, "debit", "débit")
            credit_raw = col(row, "credit", "crédit")
            if not raw_date:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Ligne {i} : date manquante")
            try:
                value_date = _parse_date(raw_date)
            except ValueError as exc:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Ligne {i} : date invalide ({raw_date})") from exc
            try:
                if amount_raw is not None:
                    amount = q2(amount_raw.replace(",", ".").replace(" ", ""))
                else:
                    debit = q2(debit_raw.replace(",", ".").replace(" ", "")) if debit_raw else Decimal("0")
                    credit = q2(credit_raw.replace(",", ".").replace(" ", "")) if credit_raw else Decimal("0")
                    amount = credit - debit
            except (InvalidOperation, AttributeError) as exc:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Ligne {i} : montant invalide") from exc
            if amount == 0:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Ligne {i} : montant nul (ni débit ni crédit)")
            rows.append({
                "value_date": value_date, "booking_date": value_date, "amount": amount,
                "label": label.strip(), "reference": reference.strip(), "raw": dict(row),
            })
        return rows


def _parse_date(raw: str) -> date:
    raw = raw.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"format de date non reconnu: {raw}")


_ADAPTERS: dict[str, ImportAdapter] = {"csv": CsvImportAdapter()}


def get_adapter(import_format: str) -> ImportAdapter:
    adapter = _ADAPTERS.get(import_format)
    if adapter is None:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"Format d'import '{import_format}' non implémenté dans ce lot (seul 'csv' l'est réellement) — voir docs/atlas-finance-platform-parity.md",
        )
    return adapter


# ── Import d'un relevé ──────────────────────────────────────────────────────────────────

def import_statement(
    db: Session, *, society: str, bank_account_id: int, import_format: str, file_name: str | None,
    raw_bytes: bytes, opening_balance: Any = None, closing_balance: Any = None, idempotency_key: str,
) -> BankStatement:
    existing = db.scalar(select(BankStatement).where(BankStatement.idempotency_key == idempotency_key))
    if existing:
        return existing
    account = get_account_or_404(db, bank_account_id)
    if account.society != society:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Compte bancaire hors société")

    adapter = get_adapter(import_format)
    rows = adapter.parse(raw_bytes)

    opening = q2(opening_balance) if opening_balance is not None else None
    closing = q2(closing_balance) if closing_balance is not None else None
    total_amount = sum((r["amount"] for r in rows), Decimal("0"))
    balance_check = "n/a"
    if opening is not None and closing is not None:
        balance_check = "ok" if q2(opening + total_amount) == closing else "mismatch"

    statement = BankStatement(
        society=society, bank_account_id=bank_account_id, import_format=import_format,
        file_name=file_name, opening_balance=opening, closing_balance=closing,
        computed_balance_check=balance_check, transaction_count=0, duplicate_count=0,
        closed=0, idempotency_key=idempotency_key,
    )
    db.add(statement)
    db.flush()

    created, duplicates = 0, 0
    for r in rows:
        dedup = _dedup_hash(bank_account_id, r["value_date"], r["amount"], r["label"], r["reference"])
        already = db.scalar(
            select(BankTransaction).where(
                BankTransaction.bank_account_id == bank_account_id, BankTransaction.dedup_hash == dedup
            )
        )
        if already:
            duplicates += 1
            continue
        db.add(BankTransaction(
            society=society, bank_account_id=bank_account_id, bank_statement_id=statement.id,
            stage="normalized", value_date=r["value_date"], booking_date=r["booking_date"],
            amount=r["amount"], label=r["label"], reference=r["reference"],
            raw_payload=r["raw"], dedup_hash=dedup, reconcile_status="unmatched",
        ))
        created += 1
    statement.transaction_count = created
    statement.duplicate_count = duplicates
    db.flush()
    return statement


def list_transactions(
    db: Session, *, society: str | None, allowed: list[str] | None, bank_account_id: int | None = None,
    reconcile_status: str | None = None, page: int = 1, page_size: int = 25,
) -> dict:
    stmt = select(BankTransaction)
    if society:
        stmt = stmt.where(BankTransaction.society == society)
    elif allowed:
        stmt = stmt.where(BankTransaction.society.in_(allowed))
    if bank_account_id:
        stmt = stmt.where(BankTransaction.bank_account_id == bank_account_id)
    if reconcile_status:
        stmt = stmt.where(BankTransaction.reconcile_status == reconcile_status)
    from app.core.pagination import paginate_statement
    return paginate_statement(db, stmt, model=BankTransaction, page=page, page_size=page_size)
