import json

import pytest

from app.core.permission_catalog import CANONICAL_ACTIONS, CANONICAL_MODULES
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import AuditEvent, User, UserModulePermission


def _user(db, username, *, role="ops", global_access=False, actions=None, active=True):
    row = User(
        username=username,
        full_name=username,
        role=role,
        access_level="H5" if role == "admin" else "H3",
        authorized_societies=["Iron Global Securite"],
        authorized_structures=[],
        authorized_sites=[7],
        authorized_modules=[],
        authorized_actions=[] if actions is None else actions,
        global_society_access=global_access,
        password_hash=hash_password("testpass123"),
        is_active=active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _headers(user):
    return {"Authorization": f"Bearer {create_access_token(str(user.id), {'username': user.username})}"}


def _url(user):
    return f"/api/auth/users/{user.id}/module-permissions"


def test_catalog_and_empty_state_are_available_to_explicit_global_admin(client, db):
    admin = _user(db, "LOT05B_ADMIN", role="admin", global_access=True)
    target = _user(db, "LOT05B_TARGET")

    catalog = client.get("/api/auth/granular-permissions/catalog", headers=_headers(admin))
    state = client.get(_url(target), headers=_headers(admin))

    assert catalog.status_code == 200
    assert catalog.json() == {"modules": list(CANONICAL_MODULES), "actions": list(CANONICAL_ACTIONS)}
    assert state.status_code == 200
    assert state.json()["permissions"] == []
    assert state.json()["granular_permissions_active"] is False
    assert state.json()["legacy_permissions_active"] is True


@pytest.mark.parametrize(
    ("role", "global_access"),
    (("admin", False), ("ops", True)),
)
def test_management_requires_explicit_global_admin(client, db, role, global_access):
    actor = _user(db, f"LOT05B_DENIED_{role}_{global_access}", role=role, global_access=global_access)
    target = _user(db, f"LOT05B_DENIED_TARGET_{role}_{global_access}")

    response = client.get(_url(target), headers=_headers(actor))

    assert response.status_code == 403
    assert response.json()["detail"] == "Administration globale explicite requise"


def test_inactive_global_admin_is_rejected_by_existing_authentication(client, db):
    actor = _user(db, "LOT05B_INACTIVE", role="admin", global_access=True, active=False)
    target = _user(db, "LOT05B_INACTIVE_TARGET")

    assert client.get(_url(target), headers=_headers(actor)).status_code == 401


def test_existing_authorized_actions_are_not_bypassed(client, db):
    actor = _user(db, "LOT05B_LEGACY_ACTION", role="admin", global_access=True, actions=["read"])
    target = _user(db, "LOT05B_LEGACY_ACTION_TARGET")

    response = client.put(_url(target), headers=_headers(actor), json={"permissions": []})

    assert response.status_code == 403
    assert response.json()["detail"] == "Action non autorisée : admin"


def test_replace_is_atomic_preserves_legacy_and_audits_each_delta(client, db):
    actor = _user(db, "LOT05B_REPLACE_ADMIN", role="admin", global_access=True)
    target = _user(db, "LOT05B_REPLACE_TARGET")
    original_legacy = (
        list(target.authorized_modules), list(target.authorized_actions),
        list(target.authorized_societies), list(target.authorized_sites), target.global_society_access,
    )
    db.add(UserModulePermission(user_id=target.id, module_key="ops", action_key="read"))
    db.commit()

    response = client.put(
        _url(target), headers=_headers(actor),
        json={"permissions": [
            {"module_key": "drh", "action_key": "read"},
            {"module_key": "ops", "action_key": "read"},
        ]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["permissions"] == [
        {"module_key": "drh", "action_key": "read"},
        {"module_key": "ops", "action_key": "read"},
    ]
    refreshed = db.get(User, target.id)
    assert (
        refreshed.authorized_modules, refreshed.authorized_actions,
        refreshed.authorized_societies, refreshed.authorized_sites, refreshed.global_society_access,
    ) == original_legacy
    events = db.query(AuditEvent).filter(
        AuditEvent.user_id == actor.id,
        AuditEvent.resource_id == str(target.id),
        AuditEvent.action.in_(["granular_permission.add", "granular_permission.remove"]),
    ).all()
    assert len(events) == 1
    event = events[0]
    assert event.action == "granular_permission.add"
    detail = json.loads(event.new_state)
    assert detail == {
        "target_user_id": target.id, "target_username": target.username,
        "module": "drh", "action": "read", "change": "add",
    }
    assert event.correlation_id and event.result == "success"

    replaced = client.put(
        _url(target), headers=_headers(actor),
        json={"permissions": [{"module_key": "drh", "action_key": "read"}]},
    )
    assert replaced.status_code == 200
    removal = db.query(AuditEvent).filter(
        AuditEvent.user_id == actor.id,
        AuditEvent.resource_id == str(target.id),
        AuditEvent.action == "granular_permission.remove",
    ).one()
    assert json.loads(removal.old_state)["change"] == "remove"
    assert json.loads(removal.old_state)["module"] == "ops"


def test_idempotent_replace_creates_no_false_delta_audit(client, db):
    actor = _user(db, "LOT05B_IDEMPOTENT_ADMIN", role="admin", global_access=True)
    target = _user(db, "LOT05B_IDEMPOTENT_TARGET")
    payload = {"permissions": [{"module_key": "drh", "action_key": "read"}]}
    assert client.put(_url(target), headers=_headers(actor), json=payload).status_code == 200
    before = db.query(AuditEvent).filter(AuditEvent.user_id == actor.id).count()

    assert client.put(_url(target), headers=_headers(actor), json=payload).status_code == 200

    assert db.query(AuditEvent).filter(AuditEvent.user_id == actor.id).count() == before


def test_empty_payload_removes_all_only_for_target(client, db):
    actor = _user(db, "LOT05B_EMPTY_ADMIN", role="admin", global_access=True)
    target = _user(db, "LOT05B_EMPTY_TARGET")
    other = _user(db, "LOT05B_EMPTY_OTHER")
    db.add_all([
        UserModulePermission(user_id=target.id, module_key="drh", action_key="read"),
        UserModulePermission(user_id=other.id, module_key="ops", action_key="read"),
    ])
    db.commit()

    response = client.put(_url(target), headers=_headers(actor), json={"permissions": []})

    assert response.status_code == 200
    assert response.json()["permissions"] == []
    assert db.query(UserModulePermission).filter_by(user_id=target.id).count() == 0
    assert db.query(UserModulePermission).filter_by(user_id=other.id).count() == 1


def test_prepared_permissions_do_not_change_effective_module_access(client, db):
    actor = _user(db, "LOT05B_INERT_ADMIN", role="admin", global_access=True)
    prepared_only = _user(db, "LOT05B_INERT_PREPARED")
    legacy_allowed = _user(db, "LOT05B_INERT_LEGACY")
    legacy_allowed.authorized_modules = ["drh"]
    db.commit()
    assert client.put(
        _url(prepared_only), headers=_headers(actor),
        json={"permissions": [{"module_key": "drh", "action_key": "read"}]},
    ).status_code == 200

    assert client.get("/api/drh/dashboard", headers=_headers(prepared_only)).status_code == 403
    assert client.get("/api/drh/dashboard", headers=_headers(legacy_allowed)).status_code == 200


@pytest.mark.parametrize(
    "permissions",
    (
        [{"module_key": "DRH", "action_key": "read"}],
        [{"module_key": "drh", "action_key": "unknown"}],
        [
            {"module_key": "drh", "action_key": "read"},
            {"module_key": "drh", "action_key": "read"},
        ],
    ),
)
def test_invalid_or_duplicate_permissions_are_refused_and_audited(client, db, permissions):
    actor = _user(db, "LOT05B_INVALID_ADMIN_" + str(len(db.query(User).all())), role="admin", global_access=True)
    target = _user(db, "LOT05B_INVALID_TARGET_" + str(len(db.query(User).all())))

    response = client.put(_url(target), headers=_headers(actor), json={"permissions": permissions})

    assert response.status_code == 422
    assert db.query(UserModulePermission).filter_by(user_id=target.id).count() == 0
    event = db.query(AuditEvent).filter_by(
        user_id=actor.id, resource_id=str(target.id), action="granular_permission.replace", result="refused"
    ).one()
    assert "password" not in (event.new_state or "").lower()
    assert "token" not in (event.new_state or "").lower()


def test_unknown_target_is_404(client, db):
    actor = _user(db, "LOT05B_404_ADMIN", role="admin", global_access=True)
    assert client.get("/api/auth/users/999999/module-permissions", headers=_headers(actor)).status_code == 404


def test_audit_failure_rolls_back_permission_changes(client, db, monkeypatch):
    actor = _user(db, "LOT05B_ROLLBACK_ADMIN", role="admin", global_access=True)
    target = _user(db, "LOT05B_ROLLBACK_TARGET")

    def fail_audit(*_args, **_kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr("app.modules.auth.routes.append_audit", fail_audit)
    with pytest.raises(RuntimeError, match="audit unavailable"):
        client.put(
            _url(target), headers=_headers(actor),
            json={"permissions": [{"module_key": "drh", "action_key": "read"}]},
        )

    assert db.query(UserModulePermission).filter_by(user_id=target.id).count() == 0
