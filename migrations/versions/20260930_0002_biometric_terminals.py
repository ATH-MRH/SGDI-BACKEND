"""Terminaux faciaux autorisés (tablette / smartphone) — défis serveur, anti-rejeu.

Additive, aucune donnée modifiée :
- biometric_terminals : terminal associé par un administrateur (code à usage unique), rattaché
  à une société et un site, authentifié par une clé publique P-256 (aucun secret stocké) ;
  pointage facial FAUX par défaut ;
- biometric_terminal_challenges : défis à usage unique (quelques secondes) ;
- biometric_frame_digests : empreintes SHA-256 des images reçues (jamais l'image), anti-rejeu.

Revision ID: 20260930_0002
Revises: 20260930_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20260930_0002"
down_revision = "20260930_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("biometric_terminals"):
        op.create_table(
            "biometric_terminals",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("public_id", sa.String(40), nullable=False),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("terminal_type", sa.String(30), nullable=False),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("location", sa.String(120), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("facial_attendance_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("public_key", sa.JSON(), nullable=True),
            sa.Column("key_fingerprint", sa.String(64), nullable=True),
            sa.Column("pairing_code_hash", sa.String(64), nullable=True),
            sa.Column("pairing_expires_at", sa.DateTime(), nullable=True),
            sa.Column("paired_at", sa.DateTime(), nullable=True),
            sa.Column("last_seen_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_reason", sa.Text(), nullable=True),
            sa.Column("config_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("meta", sa.JSON(), nullable=True),
            sa.Column("created_by", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("site_id", "name", name="uq_biometric_terminals_site_name"),
        )
        op.create_index("ix_biometric_terminals_public_id", "biometric_terminals", ["public_id"], unique=True)
        op.create_index("ix_biometric_terminals_society", "biometric_terminals", ["society"])
        op.create_index("ix_biometric_terminals_site_id", "biometric_terminals", ["site_id"])
        op.create_index("ix_biometric_terminals_pairing_code_hash", "biometric_terminals", ["pairing_code_hash"])
    if not inspector.has_table("biometric_terminal_challenges"):
        op.create_table(
            "biometric_terminal_challenges",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("terminal_id", sa.Integer(), sa.ForeignKey("biometric_terminals.id", ondelete="CASCADE"), nullable=False),
            sa.Column("site_id", sa.Integer(), nullable=False),
            sa.Column("config_version", sa.Integer(), nullable=False),
            sa.Column("terminal_config_version", sa.Integer(), nullable=False),
            sa.Column("nonce_hash", sa.String(64), nullable=False),
            sa.Column("issued_at", sa.DateTime(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("consumed_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("nonce_hash", name="uq_biometric_terminal_challenges_nonce_hash"),
        )
        op.create_index("ix_biometric_terminal_challenges_terminal_id", "biometric_terminal_challenges", ["terminal_id"])
        op.create_index("ix_biometric_terminal_challenges_expires_at", "biometric_terminal_challenges", ["expires_at"])
    if not inspector.has_table("biometric_frame_digests"):
        op.create_table(
            "biometric_frame_digests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("digest", sa.String(64), nullable=False),
            sa.Column("terminal_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("digest", name="uq_biometric_frame_digests_digest"),
        )
        op.create_index("ix_biometric_frame_digests_terminal_id", "biometric_frame_digests", ["terminal_id"])
        op.create_index("ix_biometric_frame_digests_created_at", "biometric_frame_digests", ["created_at"])


def downgrade() -> None:
    op.drop_table("biometric_frame_digests")
    op.drop_table("biometric_terminal_challenges")
    op.drop_table("biometric_terminals")
