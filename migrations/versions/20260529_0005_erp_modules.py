"""Add ERP modules: accounting, achats, ventes

Revision ID: 20260529_0005
Revises: 20260517_0004
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "20260529_0005"
down_revision = "20260517_0004"
branch_labels = None
depends_on = None

TS = [
    sa.Column("created_at", sa.DateTime(), nullable=False),
    sa.Column("updated_at", sa.DateTime()),
]


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    # ── Comptabilité ──────────────────────────────────────────────────────────
    if _table_exists("comptes_comptables"):
        return

    op.create_table(
        "comptes_comptables",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("numero", sa.String(20), index=True, nullable=False),
        sa.Column("libelle", sa.String(220), nullable=False),
        sa.Column("type_compte", sa.String(60), index=True),
        sa.Column("parent_numero", sa.String(20), index=True),
        sa.Column("notes", sa.Text()),
        *TS,
    )

    op.create_table(
        "ecritures_comptables",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("numero_piece", sa.String(60), unique=True, index=True),
        sa.Column("date_ecriture", sa.Date(), index=True),
        sa.Column("libelle", sa.String(220)),
        sa.Column("journal", sa.String(20), index=True),
        sa.Column("ref_externe", sa.String(120)),
        sa.Column("status", sa.String(40), index=True),
        sa.Column("total_debit", sa.Float(), default=0),
        sa.Column("total_credit", sa.Float(), default=0),
        sa.Column("notes", sa.Text()),
        *TS,
    )

    op.create_table(
        "lignes_ecriture",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ecriture_id", sa.Integer(), index=True, nullable=False),
        sa.Column("compte_numero", sa.String(20), nullable=False),
        sa.Column("libelle", sa.String(220)),
        sa.Column("debit", sa.Float(), default=0),
        sa.Column("credit", sa.Float(), default=0),
        *TS,
    )

    # ── Achats / Fournisseurs ─────────────────────────────────────────────────

    op.create_table(
        "fournisseurs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("name", sa.String(180), index=True, nullable=False),
        sa.Column("legal_name", sa.String(220)),
        sa.Column("contact_name", sa.String(180)),
        sa.Column("contact_position", sa.String(140)),
        sa.Column("phone", sa.String(60)),
        sa.Column("email", sa.String(180)),
        sa.Column("address", sa.Text()),
        sa.Column("nif", sa.String(100)),
        sa.Column("rc", sa.String(100)),
        sa.Column("status", sa.String(60), index=True),
        sa.Column("notes", sa.Text()),
        sa.Column("data", sa.JSON()),
        *TS,
    )

    op.create_table(
        "bons_commande_achat",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("fournisseur_id", sa.Integer(), index=True),
        sa.Column("fournisseur_name", sa.String(180), index=True),
        sa.Column("numero", sa.String(60), unique=True, index=True),
        sa.Column("date_commande", sa.Date(), index=True),
        sa.Column("date_livraison_prevue", sa.Date()),
        sa.Column("status", sa.String(60), index=True),
        sa.Column("total_ht", sa.Float(), default=0),
        sa.Column("tva", sa.Float(), default=0),
        sa.Column("total_ttc", sa.Float(), default=0),
        sa.Column("notes", sa.Text()),
        sa.Column("data", sa.JSON()),
        *TS,
    )

    op.create_table(
        "lignes_bon_commande_achat",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bon_commande_id", sa.Integer(), index=True, nullable=False),
        sa.Column("designation", sa.String(220), nullable=False),
        sa.Column("reference", sa.String(120)),
        sa.Column("quantite", sa.Float(), default=1),
        sa.Column("unite", sa.String(40)),
        sa.Column("prix_unitaire_ht", sa.Float(), default=0),
        sa.Column("tva_pct", sa.Float(), default=0),
        sa.Column("total_ht", sa.Float(), default=0),
        sa.Column("total_ttc", sa.Float(), default=0),
        sa.Column("notes", sa.Text()),
        *TS,
    )

    op.create_table(
        "receptions_marchandise",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("bon_commande_id", sa.Integer(), index=True),
        sa.Column("fournisseur_id", sa.Integer(), index=True),
        sa.Column("fournisseur_name", sa.String(180), index=True),
        sa.Column("numero", sa.String(60), unique=True, index=True),
        sa.Column("date_reception", sa.Date(), index=True),
        sa.Column("status", sa.String(60), index=True),
        sa.Column("notes", sa.Text()),
        sa.Column("data", sa.JSON()),
        *TS,
    )

    op.create_table(
        "lignes_reception",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reception_id", sa.Integer(), index=True, nullable=False),
        sa.Column("designation", sa.String(220), nullable=False),
        sa.Column("reference", sa.String(120)),
        sa.Column("quantite_commandee", sa.Float(), default=0),
        sa.Column("quantite_recue", sa.Float(), default=0),
        sa.Column("unite", sa.String(40)),
        sa.Column("notes", sa.Text()),
        *TS,
    )

    op.create_table(
        "factures_fournisseur",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("fournisseur_id", sa.Integer(), index=True),
        sa.Column("fournisseur_name", sa.String(180), index=True),
        sa.Column("bon_commande_id", sa.Integer(), index=True),
        sa.Column("reception_id", sa.Integer(), index=True),
        sa.Column("numero", sa.String(60), unique=True, index=True),
        sa.Column("numero_fournisseur", sa.String(120)),
        sa.Column("date_facture", sa.Date(), index=True),
        sa.Column("date_echeance", sa.Date(), index=True),
        sa.Column("status", sa.String(60), index=True),
        sa.Column("total_ht", sa.Float(), default=0),
        sa.Column("tva", sa.Float(), default=0),
        sa.Column("total_ttc", sa.Float(), default=0),
        sa.Column("montant_paye", sa.Float(), default=0),
        sa.Column("notes", sa.Text()),
        sa.Column("data", sa.JSON()),
        *TS,
    )

    # ── Ventes ────────────────────────────────────────────────────────────────

    op.create_table(
        "devis",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("client_id", sa.Integer(), index=True),
        sa.Column("client_name", sa.String(180), index=True),
        sa.Column("numero", sa.String(60), unique=True, index=True),
        sa.Column("date_devis", sa.Date(), index=True),
        sa.Column("date_validite", sa.Date()),
        sa.Column("objet", sa.String(220)),
        sa.Column("status", sa.String(60), index=True),
        sa.Column("total_ht", sa.Float(), default=0),
        sa.Column("tva", sa.Float(), default=0),
        sa.Column("total_ttc", sa.Float(), default=0),
        sa.Column("notes", sa.Text()),
        sa.Column("data", sa.JSON()),
        *TS,
    )

    op.create_table(
        "lignes_devis",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("devis_id", sa.Integer(), index=True, nullable=False),
        sa.Column("designation", sa.String(220), nullable=False),
        sa.Column("reference", sa.String(120)),
        sa.Column("quantite", sa.Float(), default=1),
        sa.Column("unite", sa.String(40)),
        sa.Column("prix_unitaire_ht", sa.Float(), default=0),
        sa.Column("tva_pct", sa.Float(), default=0),
        sa.Column("total_ht", sa.Float(), default=0),
        sa.Column("total_ttc", sa.Float(), default=0),
        sa.Column("notes", sa.Text()),
        *TS,
    )

    op.create_table(
        "commandes_client",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("client_id", sa.Integer(), index=True),
        sa.Column("client_name", sa.String(180), index=True),
        sa.Column("devis_id", sa.Integer(), index=True),
        sa.Column("numero", sa.String(60), unique=True, index=True),
        sa.Column("date_commande", sa.Date(), index=True),
        sa.Column("date_livraison_prevue", sa.Date()),
        sa.Column("objet", sa.String(220)),
        sa.Column("status", sa.String(60), index=True),
        sa.Column("total_ht", sa.Float(), default=0),
        sa.Column("tva", sa.Float(), default=0),
        sa.Column("total_ttc", sa.Float(), default=0),
        sa.Column("notes", sa.Text()),
        sa.Column("data", sa.JSON()),
        *TS,
    )

    op.create_table(
        "lignes_commande_client",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("commande_id", sa.Integer(), index=True, nullable=False),
        sa.Column("designation", sa.String(220), nullable=False),
        sa.Column("reference", sa.String(120)),
        sa.Column("quantite", sa.Float(), default=1),
        sa.Column("unite", sa.String(40)),
        sa.Column("prix_unitaire_ht", sa.Float(), default=0),
        sa.Column("tva_pct", sa.Float(), default=0),
        sa.Column("total_ht", sa.Float(), default=0),
        sa.Column("total_ttc", sa.Float(), default=0),
        sa.Column("notes", sa.Text()),
        *TS,
    )

    op.create_table(
        "bons_livraison",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("society", sa.String(150), index=True),
        sa.Column("commande_id", sa.Integer(), index=True),
        sa.Column("client_id", sa.Integer(), index=True),
        sa.Column("client_name", sa.String(180), index=True),
        sa.Column("numero", sa.String(60), unique=True, index=True),
        sa.Column("date_livraison", sa.Date(), index=True),
        sa.Column("status", sa.String(60), index=True),
        sa.Column("notes", sa.Text()),
        sa.Column("data", sa.JSON()),
        *TS,
    )

    op.create_table(
        "lignes_bon_livraison",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bl_id", sa.Integer(), index=True, nullable=False),
        sa.Column("designation", sa.String(220), nullable=False),
        sa.Column("reference", sa.String(120)),
        sa.Column("quantite_commandee", sa.Float(), default=0),
        sa.Column("quantite_livree", sa.Float(), default=0),
        sa.Column("unite", sa.String(40)),
        sa.Column("notes", sa.Text()),
        *TS,
    )


def downgrade() -> None:
    op.drop_table("lignes_bon_livraison")
    op.drop_table("bons_livraison")
    op.drop_table("lignes_commande_client")
    op.drop_table("commandes_client")
    op.drop_table("lignes_devis")
    op.drop_table("devis")
    op.drop_table("factures_fournisseur")
    op.drop_table("lignes_reception")
    op.drop_table("receptions_marchandise")
    op.drop_table("lignes_bon_commande_achat")
    op.drop_table("bons_commande_achat")
    op.drop_table("fournisseurs")
    op.drop_table("lignes_ecriture")
    op.drop_table("ecritures_comptables")
    op.drop_table("comptes_comptables")
