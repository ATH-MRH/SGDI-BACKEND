"""Biométrie faciale et caméras — tables neuves, aucune donnée existante modifiée.

biometric_consents (historique append-only), biometric_templates (gabarits chiffrés),
biometric_configs (seuils versionnés), camera_models (catalogue administrable), cameras
(secrets chiffrés). La fonction reste désactivée tant que BIOMETRIC_ENABLED n'est pas vrai.

Revision ID: 20260927_0002
Revises: 20260927_0001
"""
import importlib.util
from pathlib import Path

from alembic import op
import sqlalchemy as sa

revision = "20260927_0002"
down_revision = "20260927_0001"
branch_labels = None
depends_on = None


# Permissions fines : les contraintes CHECK de user_feature_permissions figent le catalogue
# (migration 20260908_0034). Les trois fonctionnalités biométriques y sont ajoutées ici —
# sans cela, PostgreSQL refuserait toute permission biométrique explicite.
BIOMETRIC_FEATURES = {
    "biometric_status": ("read",),
    "biometric_enrollment": ("create", "update"),
    "biometric_admin": ("validate", "admin"),
}


def _catalog_0034() -> dict:
    path = Path(__file__).with_name("20260908_0034_user_feature_permissions.py")
    spec = importlib.util.spec_from_file_location("feature_permissions_0034", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {mod: dict(features) for mod, features in module.FEATURE_ACTIONS.items()}


def _checks(catalog: dict) -> tuple[str, str]:
    quoted = lambda values: ", ".join(repr(v) for v in values)  # noqa: E731
    feature = " OR ".join(f"(module_key = {mod!r} AND feature_key IN ({quoted(sorted(feats))}))" for mod, feats in catalog.items())
    applicable = " OR ".join(
        f"(module_key = {mod!r} AND feature_key = {feat!r} AND action_key IN ({quoted(actions)}))"
        for mod, feats in catalog.items() for feat, actions in feats.items())
    return feature, applicable


def _replace_feature_checks(catalog: dict) -> None:
    if not sa.inspect(op.get_bind()).has_table("user_feature_permissions"):
        return
    feature, applicable = _checks(catalog)
    with op.batch_alter_table("user_feature_permissions", recreate="auto") as batch:
        batch.drop_constraint("ck_user_feature_permission_feature", type_="check")
        batch.drop_constraint("ck_user_feature_permission_applicable", type_="check")
        batch.create_check_constraint("ck_user_feature_permission_feature", feature)
        batch.create_check_constraint("ck_user_feature_permission_applicable", applicable)


def _timestamps():
    return [sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=True)]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("biometric_consents"):
        op.create_table(
            "biometric_consents",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(30), nullable=False),
            sa.Column("source", sa.String(40), nullable=False),
            sa.Column("consent_date", sa.DateTime(), nullable=True),
            sa.Column("proof_reference", sa.String(200), nullable=True),
            sa.Column("notice_version", sa.String(20), nullable=False),
            sa.Column("recorded_by", sa.String(120), nullable=True),
            sa.Column("comment", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_biometric_consents_employee_id", "biometric_consents", ["employee_id"])
    if not inspector.has_table("biometric_templates"):
        op.create_table(
            "biometric_templates",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("embedding_encrypted", sa.LargeBinary(), nullable=False),
            sa.Column("engine", sa.String(60), nullable=False),
            sa.Column("config_version", sa.Integer(), nullable=False),
            sa.Column("source", sa.String(30), nullable=False),
            sa.Column("source_ref", sa.String(200), nullable=True),
            sa.Column("quality", sa.JSON(), nullable=True),
            sa.Column("consent_id", sa.Integer(), sa.ForeignKey("biometric_consents.id", ondelete="SET NULL"), nullable=True),
            sa.Column("duplicate_of_employee_id", sa.Integer(), nullable=True),
            sa.Column("duplicate_score", sa.Float(), nullable=True),
            sa.Column("created_by", sa.String(120), nullable=True),
            sa.Column("activated_at", sa.DateTime(), nullable=True),
            sa.Column("deactivated_at", sa.DateTime(), nullable=True),
            sa.Column("status_reason", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_biometric_templates_employee_id", "biometric_templates", ["employee_id"])
        op.create_index("ix_biometric_templates_status", "biometric_templates", ["status"])
        op.create_index("ix_biometric_templates_employee_status", "biometric_templates", ["employee_id", "status"])
    if not inspector.has_table("biometric_configs"):
        op.create_table(
            "biometric_configs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("version", sa.Integer(), nullable=False, unique=True),
            sa.Column("recognition_threshold", sa.Float(), nullable=False),
            sa.Column("review_margin", sa.Float(), nullable=False),
            sa.Column("duplicate_threshold", sa.Float(), nullable=False),
            sa.Column("liveness_threshold", sa.Float(), nullable=False),
            sa.Column("quality_min_detection_score", sa.Float(), nullable=False),
            sa.Column("quality_min_face_px", sa.Integer(), nullable=False),
            sa.Column("quality_min_sharpness", sa.Float(), nullable=False),
            sa.Column("cooldown_seconds", sa.Integer(), nullable=False),
            sa.Column("provenance", sa.Text(), nullable=False),
            sa.Column("created_by", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
    if not inspector.has_table("camera_models"):
        op.create_table(
            "camera_models",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("manufacturer", sa.String(80), nullable=False),
            sa.Column("model", sa.String(120), nullable=False),
            sa.Column("adapter", sa.String(40), nullable=False),
            sa.Column("resolution", sa.String(40), nullable=True),
            sa.Column("capabilities", sa.JSON(), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False),
            *_timestamps(),
            sa.UniqueConstraint("manufacturer", "model", name="uq_camera_models_manufacturer_model"),
        )
    if not inspector.has_table("cameras"):
        op.create_table(
            "cameras",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("camera_model_id", sa.Integer(), sa.ForeignKey("camera_models.id", ondelete="SET NULL"), nullable=True),
            sa.Column("manufacturer", sa.String(80), nullable=False),
            sa.Column("model", sa.String(120), nullable=False),
            sa.Column("adapter", sa.String(40), nullable=False),
            sa.Column("society", sa.String(150), nullable=False),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("location", sa.String(120), nullable=True),
            sa.Column("serial_number", sa.String(80), nullable=True),
            sa.Column("host", sa.String(255), nullable=False),
            sa.Column("http_port", sa.Integer(), nullable=True),
            sa.Column("rtsp_port", sa.Integer(), nullable=True),
            sa.Column("connection_type", sa.String(30), nullable=False),
            sa.Column("channel", sa.Integer(), nullable=False),
            sa.Column("resolution", sa.String(40), nullable=True),
            sa.Column("fps", sa.Integer(), nullable=True),
            sa.Column("profiles", sa.JSON(), nullable=True),
            sa.Column("capabilities", sa.JSON(), nullable=True),
            sa.Column("usage", sa.String(40), nullable=False),
            sa.Column("role", sa.String(20), nullable=False),
            sa.Column("is_default", sa.Boolean(), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("credentials_encrypted", sa.LargeBinary(), nullable=True),
            sa.Column("last_check", sa.JSON(), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint("site_id", "name", name="uq_cameras_site_name"),
        )
        op.create_index("ix_cameras_society", "cameras", ["society"])
        op.create_index("ix_cameras_site_id", "cameras", ["site_id"])
    catalog = _catalog_0034()
    catalog.setdefault("attendance", {}).update(BIOMETRIC_FEATURES)
    _replace_feature_checks(catalog)


def downgrade() -> None:
    # Les permissions biométriques explicites disparaissent avec la fonctionnalité.
    op.execute("DELETE FROM user_feature_permissions WHERE module_key = 'attendance' AND feature_key LIKE 'biometric_%'")
    _replace_feature_checks(_catalog_0034())
    op.drop_table("cameras")
    op.drop_table("camera_models")
    op.drop_table("biometric_configs")
    op.drop_table("biometric_templates")
    op.drop_table("biometric_consents")
