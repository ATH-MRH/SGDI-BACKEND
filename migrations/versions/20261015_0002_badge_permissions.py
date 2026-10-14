"""Studio Badges DRH : permission fine « drh / badges » (émettre, révoquer, imprimer, gérer).

Les contraintes CHECK de user_feature_permissions figent le catalogue des fonctionnalités
(migrations 20260908_0034 puis 20260927_0002). La fonctionnalité « badges » y est ajoutée ;
aucune permission n'est créée : elles sont accordées ensuite dans l'administration.

Revision ID: 20261015_0002
Revises: 20261015_0001
"""
import importlib.util
from pathlib import Path

from alembic import op

revision = "20261015_0002"
down_revision = "20261015_0001"
branch_labels = None
depends_on = None

BADGE_FEATURES = {"badges": ("read", "create", "validate", "export", "admin")}


def _biometrics():
    path = Path(__file__).with_name("20260927_0002_biometrics.py")
    spec = importlib.util.spec_from_file_location("biometrics_20260927_0002", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _catalog(with_badges: bool) -> dict:
    biometrics = _biometrics()
    catalog = biometrics._catalog_0034()
    catalog.setdefault("attendance", {}).update(biometrics.BIOMETRIC_FEATURES)
    if with_badges:
        catalog.setdefault("drh", {}).update(BADGE_FEATURES)
    return catalog


def upgrade() -> None:
    _biometrics()._replace_feature_checks(_catalog(True))


def downgrade() -> None:
    """Non destructif : si des permissions « badges » ont été accordées, elles sont conservées
    avec la contrainte élargie (inoffensive pour une version antérieure du code)."""
    import sqlalchemy as sa

    bind = op.get_bind()
    if not sa.inspect(bind).has_table("user_feature_permissions"):
        return
    if bind.execute(sa.text("SELECT 1 FROM user_feature_permissions WHERE module_key = 'drh' AND feature_key = 'badges' LIMIT 1")).first():
        print("Studio Badges : permissions accordées conservées (retour arrière non destructif).")
        return
    _biometrics()._replace_feature_checks(_catalog(False))
