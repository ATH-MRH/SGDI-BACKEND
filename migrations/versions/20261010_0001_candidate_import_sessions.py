"""Import Excel de candidats — sessions temporaires d'analyse / confirmation.

Additive, aucune donnée modifiée : la table candidate_import_sessions porte une session courte
liée à un utilisateur et à son périmètre. Le contenu du classeur n'y existe que le temps de la
session (effacé à la confirmation, à l'annulation et à l'expiration).

Revision ID: 20261010_0001
Revises: 20261009_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261010_0001"
down_revision = "20261009_0001"
branch_labels = None
depends_on = None

TABLE = "candidate_import_sessions"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(120), nullable=True),
        sa.Column("scope_key", sa.String(64), nullable=True),
        sa.Column("scope_label", sa.String(150), nullable=True),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("file_sha256", sa.String(64), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("workbook", sa.JSON(), nullable=True),
        sa.Column("plan", sa.JSON(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_candidate_import_sessions_public_id", TABLE, ["public_id"], unique=True)
    op.create_index("ix_candidate_import_sessions_user_id", TABLE, ["user_id"])
    op.create_index("ix_candidate_import_sessions_status", TABLE, ["status"])
    op.create_index("ix_candidate_import_sessions_expires_at", TABLE, ["expires_at"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE):
        op.drop_table(TABLE)
