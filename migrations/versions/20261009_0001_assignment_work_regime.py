"""Socle officiel du travail posté 24h/24 (lot 0) : régime explicite porté par l'affectation.

Additive : `assignments.work_regime` (NULL = affectation historique, comportement inchangé),
`rotation_templates.official` / `version`, et le modèle officiel « 3x8 continu 2/2/2/2 ».
AUCUNE affectation existante n'est passée en POSTE_CONTINU : le régime n'est jamais déduit de
`group_code` ni de `sites.rotation_system`.

Revision ID: 20261009_0001
Revises: 20261008_0001
"""
from datetime import datetime
import json

from alembic import op
import sqlalchemy as sa

revision = "20261009_0001"
down_revision = "20261008_0001"
branch_labels = None
depends_on = None

REGIME_CHECK = "ck_assignments_work_regime"
POSTED_CHECK = "ck_assignments_posted_explicit"
REGIME_INDEX = "ix_assignments_work_regime"
MODEL_CODE = "3X8-CONTINU-2222"
MODEL_NAME = "3x8 continu — 4 groupes — cycle 8 jours (2/2/2/2)"


def _day(status: str, shift: str, start: str, end: str) -> dict:
    return {"status": status, "shift": shift, "label": shift, "start_time": start, "end_time": end}


# Photographie du modèle à cette révision (identique à attendance/official.py, vérifié par test).
CYCLE_DAYS = [day for day in (
    _day("matin", "MATIN", "06:00", "14:00"), _day("apres_midi", "APRES_MIDI", "14:00", "22:00"),
    _day("nuit", "NUIT", "22:00", "06:00"), _day("repos", "OFF", "", ""),
) for _ in range(2)]
GROUP_OFFSETS = {"A": 0, "B": 2, "C": 4, "D": 6}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    template_columns = {column["name"] for column in inspector.get_columns("rotation_templates")}
    with op.batch_alter_table("rotation_templates") as batch:
        if "official" not in template_columns:
            batch.add_column(sa.Column("official", sa.Integer(), nullable=False, server_default="0"))
        if "version" not in template_columns:
            batch.add_column(sa.Column("version", sa.Integer(), nullable=False, server_default="1"))

    columns = {column["name"] for column in inspector.get_columns("assignments")}
    checks = {check["name"] for check in inspector.get_check_constraints("assignments")}
    indexes = {index["name"] for index in inspector.get_indexes("assignments")}
    with op.batch_alter_table("assignments") as batch:
        if "work_regime" not in columns:
            batch.add_column(sa.Column("work_regime", sa.String(20), nullable=True))
        if REGIME_CHECK not in checks:
            batch.create_check_constraint(REGIME_CHECK, "work_regime IS NULL OR work_regime IN ('NORMAL', 'POSTE_CONTINU')")
        if POSTED_CHECK not in checks:
            batch.create_check_constraint(
                POSTED_CHECK,
                "work_regime IS NULL OR work_regime <> 'POSTE_CONTINU' "
                "OR (group_code IN ('A', 'B', 'C', 'D') AND rotation_id IS NOT NULL)")
    if REGIME_INDEX not in indexes:
        op.create_index(REGIME_INDEX, "assignments", ["work_regime"])

    templates = sa.table(
        "rotation_templates", sa.column("code", sa.String), sa.column("name", sa.String), sa.column("description", sa.Text),
        sa.column("cycle_length", sa.Integer), sa.column("cycle_days", sa.JSON), sa.column("group_offsets", sa.JSON),
        sa.column("active", sa.Integer), sa.column("official", sa.Integer), sa.column("version", sa.Integer),
        sa.column("created_at", sa.DateTime))
    if not bind.execute(sa.text("SELECT 1 FROM rotation_templates WHERE code = :code"), {"code": MODEL_CODE}).first():
        op.bulk_insert(templates, [{
            "code": MODEL_CODE, "name": MODEL_NAME,
            "description": "Modèle officiel du travail posté 24h/24 : 2 Matin, 2 Après-midi, 2 Nuit, 2 OFF.",
            "cycle_length": len(CYCLE_DAYS), "cycle_days": json.loads(json.dumps(CYCLE_DAYS)), "group_offsets": dict(GROUP_OFFSETS),
            "active": 1, "official": 1, "version": 1, "created_at": datetime.utcnow(),
        }])


def downgrade() -> None:
    bind = op.get_bind()
    # Le régime explicite n'a pas d'équivalent avant cette révision : on ne le détruit pas en silence.
    if bind.execute(sa.text("SELECT 1 FROM assignments WHERE work_regime = 'POSTE_CONTINU' LIMIT 1")).first():
        raise RuntimeError("Downgrade refusé : des affectations en travail posté (POSTE_CONTINU) perdraient leur régime.")
    official_ids = "SELECT id FROM rotation_templates WHERE official = 1"
    bind.execute(sa.text(f"UPDATE assignments SET rotation_id = NULL WHERE rotation_id IN ({official_ids})"))
    bind.execute(sa.text(f"DELETE FROM site_rotations WHERE rotation_id IN ({official_ids})"))
    bind.execute(sa.text("DELETE FROM rotation_templates WHERE official = 1"))
    op.drop_index(REGIME_INDEX, table_name="assignments")
    with op.batch_alter_table("assignments") as batch:
        batch.drop_constraint(POSTED_CHECK, type_="check")
        batch.drop_constraint(REGIME_CHECK, type_="check")
        batch.drop_column("work_regime")
    with op.batch_alter_table("rotation_templates") as batch:
        batch.drop_column("version")
        batch.drop_column("official")
