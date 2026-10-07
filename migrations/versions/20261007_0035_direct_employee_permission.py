"""Autorise le droit explicite de création directe d'employé dans le catalogue RH.

Revision ID: 20261007_0035
Revises: 20260908_0034
"""

from alembic import op
import sqlalchemy as sa


revision = "20261007_0035"
down_revision = "20260908_0034"
branch_labels = None
depends_on = None


_FEATURE_PERMISSION = "module_key = 'drh' AND feature_key = 'direct_employee_creation'"
_FEATURE_ACTION_PERMISSION = (
    "module_key = 'drh' AND feature_key = 'direct_employee_creation' "
    "AND action_key = 'create'"
)


def _constraint_sql(name: str) -> str:
    constraints = sa.inspect(op.get_bind()).get_check_constraints("user_feature_permissions")
    for constraint in constraints:
        if constraint["name"] == name and constraint.get("sqltext"):
            return constraint["sqltext"]
    raise RuntimeError(f"Contrainte absente : {name}")


def upgrade() -> None:
    old_features = _constraint_sql("ck_user_feature_permission_feature")
    old_applicable_actions = _constraint_sql("ck_user_feature_permission_applicable")
    with op.batch_alter_table("user_feature_permissions") as batch:
        batch.drop_constraint("ck_user_feature_permission_feature", type_="check")
        batch.drop_constraint("ck_user_feature_permission_applicable", type_="check")
        batch.create_check_constraint(
            "ck_user_feature_permission_feature",
            f"({old_features}) OR ({_FEATURE_PERMISSION})",
        )
        batch.create_check_constraint(
            "ck_user_feature_permission_applicable",
            f"({old_applicable_actions}) OR ({_FEATURE_ACTION_PERMISSION})",
        )


def downgrade() -> None:
    features = _constraint_sql("ck_user_feature_permission_feature")
    applicable_actions = _constraint_sql("ck_user_feature_permission_applicable")
    with op.batch_alter_table("user_feature_permissions") as batch:
        batch.drop_constraint("ck_user_feature_permission_feature", type_="check")
        batch.drop_constraint("ck_user_feature_permission_applicable", type_="check")
        batch.create_check_constraint(
            "ck_user_feature_permission_feature",
            features.replace(f" OR ({_FEATURE_PERMISSION})", ""),
        )
        batch.create_check_constraint(
            "ck_user_feature_permission_applicable",
            applicable_actions.replace(f" OR ({_FEATURE_ACTION_PERMISSION})", ""),
        )
