"""Explicit per-user authorizations on already registered facial devices.

Revision ID: 20261012_0001
Revises: 20261011_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261012_0001"
down_revision = "20261011_0001"
branch_labels = None
depends_on = None

TABLE = "facial_device_authorizations"


def upgrade() -> None:
    # Additive only: no existing row is touched; without a row, access is denied by default.
    if sa.inspect(op.get_bind()).has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("terminal_id", sa.Integer(), sa.ForeignKey("biometric_terminals.id", ondelete="CASCADE"), nullable=True),
        sa.Column("camera_id", sa.Integer(), sa.ForeignKey("cameras.id", ondelete="CASCADE"), nullable=True),
        sa.Column("granted_by", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "terminal_id", name="uq_facial_device_auth_user_terminal"),
        sa.UniqueConstraint("user_id", "camera_id", name="uq_facial_device_auth_user_camera"),
        sa.CheckConstraint("(terminal_id IS NULL) <> (camera_id IS NULL)", name="ck_facial_device_auth_one_device"),
    )
    op.create_index("ix_facial_device_authorizations_user_id", TABLE, ["user_id"])
    op.create_index("ix_facial_device_authorizations_terminal_id", TABLE, ["terminal_id"])
    op.create_index("ix_facial_device_authorizations_camera_id", TABLE, ["camera_id"])


def downgrade() -> None:
    # Un retour arrière applicatif ne l'exige pas (l'ancienne version ignore cette table). Supprimer
    # la table effacerait des autorisations saisies : refusé tant qu'il en reste.
    bind = op.get_bind()
    if not sa.inspect(bind).has_table(TABLE):
        return
    if bind.execute(sa.text(f"SELECT 1 FROM {TABLE} LIMIT 1")).first():
        raise RuntimeError("Downgrade refusé : des autorisations d'équipements faciaux existent. "
                           "Les retirer explicitement avant de supprimer la table.")
    op.drop_table(TABLE)
