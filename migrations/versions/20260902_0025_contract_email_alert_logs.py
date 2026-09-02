"""Crée contract_email_alert_logs (jusqu'ici seulement via create_all au démarrage)

La table du modèle ContractEmailAlertLog (app/modules/drh/email_alerts.py) n'était
créée par aucune migration : uniquement par Base.metadata.create_all() dans
app/main.py. Cette migration la déclare explicitement pour que
`alembic upgrade head` produise un schéma complet.

Revision ID: 20260902_0025
Revises: 20260902_0024
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "20260902_0025"
down_revision = "20260902_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("contract_email_alert_logs"):
        return
    op.create_table(
        "contract_email_alert_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("alert_key", sa.String(length=260), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("contract_end_date", sa.Date(), nullable=False),
        sa.Column("days_left", sa.Integer(), nullable=False),
        sa.Column("recipient", sa.String(length=180), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="sent"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_contract_email_alert_logs_id", "contract_email_alert_logs", ["id"])
    op.create_index("ix_contract_email_alert_logs_alert_key", "contract_email_alert_logs", ["alert_key"], unique=True)
    op.create_index("ix_contract_email_alert_logs_employee_id", "contract_email_alert_logs", ["employee_id"])
    op.create_index("ix_contract_email_alert_logs_contract_end_date", "contract_email_alert_logs", ["contract_end_date"])
    op.create_index("ix_contract_email_alert_logs_days_left", "contract_email_alert_logs", ["days_left"])
    op.create_index("ix_contract_email_alert_logs_recipient", "contract_email_alert_logs", ["recipient"])


def downgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("contract_email_alert_logs"):
        return
    op.drop_table("contract_email_alert_logs")
