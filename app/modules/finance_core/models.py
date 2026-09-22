"""ATLAS Finance Core — couche d'intégration commune (P0-C).

Ne duplique PAS les modules existants (finance/accounting/achats/ventes/paie) : ceux-ci
restent les sources de vérité MÉTIER (une facture reste une Invoice, un bon de commande reste
un BonDeCommande). Finance Core ajoute la couche FINANCIÈRE transverse qui manquait — la
notion d'obligation (ce qui est dû), d'intention de paiement, de règlement (Settlement) et
d'événement financier immuable — RÉFÉRENCÉE par source_type/source_id vers l'enregistrement
métier d'origine, jamais une copie.

P0-D : toutes les colonnes monétaires utilisent Numeric(18, 2) + Decimal Python — jamais
Float — c'est la règle absolue pour tout NOUVEAU code financier (le Float déjà présent dans
finance_models.py/accounting/achats/ventes est une dette LEGACY documentée séparément,
volontairement non retouchée dans ce lot : la reconstruire ligne à ligne dépasserait le
périmètre raisonnable d'une seule mission et casserait des écrans existants sans bénéfice
immédiat — voir docs/atlas-finance-platform-parity.md).

P0-F : idempotence — chaque table porteuse d'écriture a une idempotency_key UNIQUE. Un appel
répété avec la même clé ne doit jamais créer un doublon (service.py retourne l'enregistrement
existant plutôt que de lever une erreur ou d'en créer un second) — condition nécessaire pour
que des retries réseau (webhook bancaire, tâche planifiée) restent sans danger.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

MONEY = Numeric(18, 2)

DIRECTIONS = ("receivable", "payable")  # receivable = on nous doit ; payable = on doit
OBLIGATION_STATUSES = ("open", "partially_settled", "settled", "cancelled")
INTENT_STATUSES = ("pending", "settled", "cancelled", "failed")
SETTLEMENT_KINDS = ("normal", "reversal", "overpayment")
EVENT_STATUSES_OUTBOX = ("pending", "dispatched", "failed")
ACCOUNTING_EVENT_STATUSES = ("pending", "posted", "failed", "skipped")


class FinancialObligation(Base, TimestampMixin):
    """Ce qui est dû, dans un sens ou dans l'autre — la brique centrale de Finance Core.

    Une obligation N'EST PAS créée à la main en temps normal : elle est générée par un
    déclencheur métier (validation d'une facture client -> receivable ; validation d'une
    facture fournisseur -> payable ; clôture d'un cycle de paie -> payable). source_type +
    source_id pointent vers CET enregistrement d'origine — jamais de duplication de champs
    métier (pas de copie du nom du client, de la TVA, etc.) au-delà du strict nécessaire au
    suivi financier (montant, échéance, contrepartie pour affichage).
    """

    __tablename__ = "financial_obligations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    direction: Mapped[str] = mapped_column(String(20), index=True)  # receivable | payable
    source_type: Mapped[str] = mapped_column(String(60), index=True)  # invoice | facture_fournisseur | payroll_run | manual
    source_id: Mapped[str] = mapped_column(String(120), index=True)
    counterparty_name: Mapped[str | None] = mapped_column(String(180))
    amount_total: Mapped[Decimal] = mapped_column(MONEY, default=0)
    amount_settled: Mapped[Decimal] = mapped_column(MONEY, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="DZD")
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(30), default="open", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)

    __table_args__ = (
        Index("ix_financial_obligations_society_status", "society", "status"),
        Index("ix_financial_obligations_source", "source_type", "source_id"),
    )


class PaymentIntent(Base, TimestampMixin):
    """Intention de paiement/encaissement — PAS encore un règlement confirmé.

    Créée quand on planifie un paiement (ex. sélection d'une facture fournisseur pour un
    virement à venir) ; devient "settled" seulement quand un Settlement réel lui est associé
    (rapprochement bancaire confirmé, ou règlement manuel caisse/chèque explicitement saisi).
    """

    __tablename__ = "payment_intents"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    obligation_id: Mapped[int | None] = mapped_column(
        ForeignKey("financial_obligations.id", ondelete="SET NULL"), index=True
    )
    direction: Mapped[str] = mapped_column(String(20), index=True)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), default="DZD")
    method: Mapped[str | None] = mapped_column(String(40))  # bank_transfer | cash | check
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    planned_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)


class Settlement(Base, TimestampMixin):
    """Le règlement réel et confirmé d'une obligation, total ou partiel.

    bank_transaction_id est renseigné quand le règlement provient du moteur de
    rapprochement bancaire (app/modules/reconciliation) ; laissé NULL pour un règlement
    manuel (caisse, chèque) saisi directement. kind="reversal" annule un règlement précédent
    (reversed_settlement_id) SANS jamais supprimer la ligne d'origine — l'historique reste
    intact, condition nécessaire à tout audit financier réel.
    """

    __tablename__ = "settlements"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    obligation_id: Mapped[int] = mapped_column(
        ForeignKey("financial_obligations.id", ondelete="CASCADE"), index=True
    )
    payment_intent_id: Mapped[int | None] = mapped_column(
        ForeignKey("payment_intents.id", ondelete="SET NULL"), index=True
    )
    bank_transaction_id: Mapped[int | None] = mapped_column(Integer, index=True)  # FK logique -> banking.bank_transactions (module optionnel, pas de FK dure inter-module)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    kind: Mapped[str] = mapped_column(String(20), default="normal", index=True)
    settled_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reversed_settlement_id: Mapped[int | None] = mapped_column(
        ForeignKey("settlements.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)

    # P0 (revue d'intégrité, item 5/6) : un règlement ne doit jamais pouvoir être annulé deux
    # fois (double décrément de amount_settled = vecteur de double paiement) — index UNIQUE en
    # défense en profondeur du garde applicatif (finance_core.service.reverse_settlement).
    # NULL répété autorisé (un règlement normal n'a pas de reversed_settlement_id) : seule une
    # valeur non NULL doit être unique, standard SQL. Voir migration 20260922_0045 (même nom
    # d'index, tenu synchronisé ici pour que Base.metadata.create_all() — utilisé par les
    # tests — porte la même garantie que la migration en production).
    __table_args__ = (
        Index("ix_settlements_reversed_settlement_id_unique", "reversed_settlement_id", unique=True),
    )


class FinancialEvent(Base, TimestampMixin):
    """Journal d'événements immuable (event log) — jamais modifié après création, jamais
    supprimé. Chaque mutation significative de Finance Core (création d'obligation,
    règlement, annulation) écrit UN événement ici, avec son propre idempotency_key. C'est la
    source de vérité pour tout ce qui doit être rejoué/audité/bridgé vers la comptabilité —
    PAS un doublon de log applicatif générique (voir app.core.audit, qui reste utilisé pour
    l'audit RBAC transverse ; celui-ci est un event log MÉTIER FINANCIER typé).
    """

    __tablename__ = "financial_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    event_type: Mapped[str] = mapped_column(String(60), index=True)
    aggregate_type: Mapped[str] = mapped_column(String(60), index=True)
    aggregate_id: Mapped[int] = mapped_column(Integer, index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)


class FinanceOutboxEvent(Base, TimestampMixin):
    """Table outbox transactionnelle (P0-F) : chaque FinancialEvent créé dans LA MÊME
    transaction SQL qu'une entrée outbox correspondante (garantie atomique via un flush
    commun, jamais deux transactions séparées) — un worker de dispatch (non temps réel dans
    ce lot : dispatch_pending_events() peut être appelé en tâche planifiée) marque ensuite
    chaque entrée "dispatched" une fois le bridge comptable/notification effectivement
    exécuté, avec un compteur de tentatives et la dernière erreur en cas d'échec.
    """

    __tablename__ = "finance_outbox_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    financial_event_id: Mapped[int] = mapped_column(
        ForeignKey("financial_events.id", ondelete="CASCADE"), unique=True, index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime)


class AccountingEvent(Base, TimestampMixin):
    """Pont vers la comptabilité (Accounting Bridge, P1-B) : matérialise le lien entre un
    fait financier (settlement, obligation) et l'écriture comptable brouillon générée. Ne
    remplace pas accounting/auto.py — l'ÉTEND : au lieu de générer une écriture au fil de
    l'eau depuis chaque module métier séparément (comme aujourd'hui pour facture
    fournisseur/commande client), le bridge consomme désormais les FinancialEvent de Finance
    Core comme source unique, pour que TOUT flux financier (y compris ceux qui passeront un
    jour par la paie ou la banque) alimente la même comptabilité par le même chemin.
    """

    __tablename__ = "accounting_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    source_type: Mapped[str] = mapped_column(String(60), index=True)  # settlement | obligation
    source_id: Mapped[int] = mapped_column(Integer, index=True)
    ecriture_id: Mapped[int | None] = mapped_column(Integer, index=True)  # FK logique -> accounting.ecritures_comptables
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    last_error: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)
