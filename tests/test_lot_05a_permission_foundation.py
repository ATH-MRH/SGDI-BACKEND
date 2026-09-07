import pytest
from sqlalchemy.exc import IntegrityError

from app.core.granular_permissions import (
    PermissionScope,
    evaluate_permission,
    load_explicit_permissions,
)
from app.core.permission_catalog import CANONICAL_ACTIONS, CANONICAL_MODULES
from app.core.security import hash_password
from app.modules.auth.models import User, UserModulePermission


FULL_SCOPE = PermissionScope(
    society_required=True,
    site_required=True,
    society_allowed=True,
    site_allowed=True,
)


def _user(db, username: str, *, role: str = "ops", global_access: bool = False) -> User:
    row = User(
        username=username,
        full_name=username,
        role=role,
        access_level="H3",
        authorized_societies=["legacy society"],
        authorized_structures=["legacy structure"],
        authorized_sites=[99],
        authorized_actions=["admin"],
        authorized_modules=["drh"],
        global_society_access=global_access,
        password_hash=hash_password("testpass123"),
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_canonical_catalog_contains_exactly_validated_modules_and_actions():
    assert CANONICAL_MODULES == (
        "administration", "drh", "recruitment", "leaves", "ops", "attendance",
        "material", "commercial", "sales", "purchases", "accounting", "finance",
        "reporting", "loans", "secretariat", "cash", "employee_portal",
        "client_portal", "rounds", "assistant", "erp_cockpit", "legacy", "ui",
    )
    assert CANONICAL_ACTIONS == (
        "read", "create", "update", "validate", "delete", "export", "unlock",
        "admin", "sign", "pay", "recruit", "execute",
    )


def test_explicit_permission_is_stored_and_loaded(db):
    user = _user(db, "LOT05A_STORE")
    db.add(UserModulePermission(user_id=user.id, module_key="drh", action_key="read"))
    db.commit()

    grants = load_explicit_permissions(db, user.id)

    assert [(grant.module_key, grant.action_key) for grant in grants] == [("drh", "read")]


def test_duplicate_permission_is_rejected(db):
    user = _user(db, "LOT05A_DUPLICATE")
    db.add(UserModulePermission(user_id=user.id, module_key="ops", action_key="read"))
    db.commit()
    db.add(UserModulePermission(user_id=user.id, module_key="ops", action_key="read"))

    with pytest.raises(IntegrityError):
        db.commit()


@pytest.mark.parametrize(
    ("module_key", "action_key"),
    (("unknown", "read"), ("drh", "unknown")),
)
def test_database_constraints_reject_unknown_catalog_values(db, module_key, action_key):
    user = _user(db, f"LOT05A_INVALID_{module_key}_{action_key}")
    db.add(UserModulePermission(user_id=user.id, module_key=module_key, action_key=action_key))

    with pytest.raises(IntegrityError):
        db.commit()


def test_service_requires_exact_module_action_grant(db):
    user = _user(db, "LOT05A_EXACT")
    grant = UserModulePermission(user_id=user.id, module_key="drh", action_key="read")

    assert evaluate_permission(
        user, [grant], module_key="drh", action_key="read", scope=FULL_SCOPE
    ).allowed
    assert not evaluate_permission(
        user, [grant], module_key="drh", action_key="update", scope=FULL_SCOPE
    ).allowed
    assert not evaluate_permission(
        user, [grant], module_key="ops", action_key="read", scope=FULL_SCOPE
    ).allowed


def test_service_never_derives_permission_from_legacy_fields(db):
    user = _user(db, "OPS05A_LEGACY")

    decision = evaluate_permission(
        user, [], module_key="drh", action_key="admin", scope=FULL_SCOPE
    )

    assert not decision.allowed
    assert decision.reason == "missing_explicit_grant"


def test_required_society_and_site_must_be_explicitly_satisfied(db):
    user = _user(db, "LOT05A_SCOPE")
    grant = UserModulePermission(user_id=user.id, module_key="ops", action_key="read")

    missing_society = PermissionScope(True, True, None, True)
    missing_site = PermissionScope(True, True, True, None)
    assert not evaluate_permission(
        user, [grant], module_key="ops", action_key="read", scope=missing_society
    ).allowed
    assert not evaluate_permission(
        user, [grant], module_key="ops", action_key="read", scope=missing_site
    ).allowed


def test_only_explicit_global_administrator_bypasses_grants_and_scopes(db):
    global_admin = _user(db, "LOT05A_GLOBAL", role="admin", global_access=True)
    limited_admin = _user(db, "LOT05A_LIMITED_ADMIN", role="admin", global_access=False)
    absent_scope = PermissionScope(True, True, None, None)

    assert evaluate_permission(
        global_admin, [], module_key="cash", action_key="pay", scope=absent_scope
    ).allowed
    assert not evaluate_permission(
        limited_admin, [], module_key="cash", action_key="pay", scope=absent_scope
    ).allowed


def test_inactive_global_administrator_is_refused(db):
    user = _user(db, "LOT05A_INACTIVE", role="admin", global_access=True)
    user.is_active = False

    decision = evaluate_permission(
        user, [], module_key="cash", action_key="pay", scope=FULL_SCOPE
    )

    assert not decision.allowed
    assert decision.reason == "inactive_user"


@pytest.mark.parametrize(
    ("module_key", "action_key", "reason"),
    (("unknown", "read", "unknown_module"), ("drh", "unknown", "unknown_action")),
)
def test_service_refuses_unknown_catalog_values(db, module_key, action_key, reason):
    user = _user(db, f"LOT05A_SERVICE_{module_key}_{action_key}")

    decision = evaluate_permission(
        user, [], module_key=module_key, action_key=action_key, scope=FULL_SCOPE
    )

    assert not decision.allowed
    assert decision.reason == reason


def test_permission_foreign_key_delete_behaviour(db):
    creator = _user(db, "LOT05A_CREATOR")
    owner = _user(db, "LOT05A_OWNER")
    permission = UserModulePermission(
        user_id=owner.id,
        module_key="drh",
        action_key="read",
        created_by_user_id=creator.id,
    )
    db.add(permission)
    db.commit()
    db.refresh(permission)
    assert permission.created_at is not None

    db.delete(creator)
    db.commit()
    db.refresh(permission)
    assert permission.created_by_user_id is None

    permission_id = permission.id
    db.delete(owner)
    db.commit()
    assert db.get(UserModulePermission, permission_id) is None
