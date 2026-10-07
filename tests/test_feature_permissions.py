import json

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.permission_catalog import (
    CANONICAL_MODULES,
    FEATURE_CATALOG,
    applicable_actions,
    feature_catalog_payload,
)
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission, UserModulePermission


def _user(db, username, *, role="ops", global_access=False):
    row = User(
        username=username,
        full_name=username,
        role=role,
        access_level="H5" if role == "admin" else "H3",
        authorized_societies=["Iron Global Securite"],
        authorized_structures=[],
        authorized_sites=[7],
        authorized_modules=[],
        authorized_actions=[],
        global_society_access=global_access,
        password_hash=hash_password("testpass123"),
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _headers(user):
    token = create_access_token(str(user.id), {"username": user.username})
    return {"Authorization": f"Bearer {token}"}


def _url(user):
    return f"/api/auth/users/{user.id}/feature-permissions"


def test_catalog_has_all_23_modules_and_only_applicable_actions(client, db):
    admin = _user(db, "FEATURE_CATALOG_ADMIN", role="admin", global_access=True)
    response = client.get("/api/auth/granular-permissions/feature-catalog", headers=_headers(admin))

    assert response.status_code == 200
    body = response.json()
    # 23 modules de STOCKAGE, présentés en 24 entrées : attendance = « Gestion du pointage »
    # (pointage) + « Pointage » (pointeur), sans aucune nouvelle clé de stockage.
    assert list(dict.fromkeys(module["module_key"] for module in body["modules"])) == list(CANONICAL_MODULES)
    assert len(body["modules"]) == 24
    assert body["granular_permissions_active"] is False
    for module in body["modules"]:
        expected = FEATURE_CATALOG[module["module_key"]]
        entry = next((e for e in expected.get("entries", ()) if e["entry_key"] == module["entry_key"]), expected)
        assert module["label"] == entry["label"]
        assert module["domain"] == entry["domain"]
        assert module["features"]
        for feature in module["features"]:
            assert feature["applicable_actions"] == list(
                applicable_actions(module["module_key"], feature["feature_key"])
            )
    drh = next(module for module in body["modules"] if module["module_key"] == "drh")
    direct = next(feature for feature in drh["features"] if feature["feature_key"] == "direct_employee_creation")
    assert direct["applicable_actions"] == ["create"]


def test_feature_administration_requires_explicit_global_admin(client, db):
    limited_admin = _user(db, "FEATURE_LIMITED_ADMIN", role="admin", global_access=False)
    target = _user(db, "FEATURE_LIMITED_TARGET")
    headers = _headers(limited_admin)

    assert client.get("/api/auth/granular-permissions/feature-catalog", headers=headers).status_code == 403
    assert client.get(_url(target), headers=headers).status_code == 403
    assert client.put(_url(target), headers=headers, json={"permissions": []}).status_code == 403


@pytest.mark.parametrize(
    ("permission", "message"),
    (
        ({"module_key": "unknown", "feature_key": "employees", "action_key": "read"}, "Module granulaire inconnu"),
        ({"module_key": "drh", "feature_key": "unknown", "action_key": "read"}, "Fonctionnalité granulaire inconnue"),
        ({"module_key": "drh", "feature_key": "employees", "action_key": "unknown"}, "Action granulaire inconnue"),
        ({"module_key": "drh", "feature_key": "employees", "action_key": "pay"}, "Action non applicable"),
    ),
)
def test_unknown_or_non_applicable_values_are_refused(client, db, permission, message):
    admin = _user(db, "FEATURE_INVALID_ADMIN_" + permission["module_key"] + permission["action_key"], role="admin", global_access=True)
    target = _user(db, "FEATURE_INVALID_TARGET_" + permission["module_key"] + permission["action_key"])

    response = client.put(_url(target), headers=_headers(admin), json={"permissions": [permission]})

    assert response.status_code == 422
    assert message in response.json()["detail"]
    assert db.query(UserFeaturePermission).filter_by(user_id=target.id).count() == 0


def test_duplicate_is_refused(client, db):
    admin = _user(db, "FEATURE_DUP_ADMIN", role="admin", global_access=True)
    target = _user(db, "FEATURE_DUP_TARGET")
    item = {"module_key": "drh", "feature_key": "employees", "action_key": "read"}

    response = client.put(_url(target), headers=_headers(admin), json={"permissions": [item, item]})

    assert response.status_code == 422
    assert "dupliquée" in response.json()["detail"]


def test_replace_is_atomic_audited_and_preserves_all_legacy_rights(client, db):
    admin = _user(db, "FEATURE_REPLACE_ADMIN", role="admin", global_access=True)
    target = _user(db, "FEATURE_REPLACE_TARGET")
    target.authorized_modules = ["drh"]
    target.authorized_actions = ["read"]
    target.authorized_societies = ["Iron Global Securite"]
    target.authorized_sites = [7]
    db.add(UserModulePermission(user_id=target.id, module_key="drh", action_key="read"))
    db.add(UserFeaturePermission(user_id=target.id, module_key="ops", feature_key="sites", action_key="read"))
    db.commit()
    legacy_before = (
        list(target.authorized_modules), list(target.authorized_actions),
        list(target.authorized_societies), list(target.authorized_sites), target.global_society_access,
        db.query(UserModulePermission).filter_by(user_id=target.id).count(),
    )

    payload = {"permissions": [
        {"module_key": "drh", "feature_key": "employees", "action_key": "read"},
        {"module_key": "drh", "feature_key": "employees", "action_key": "update"},
    ]}
    response = client.put(_url(target), headers=_headers(admin), json=payload)

    assert response.status_code == 200, response.text
    assert response.json()["permissions"] == payload["permissions"]
    refreshed = db.get(User, target.id)
    legacy_after = (
        refreshed.authorized_modules, refreshed.authorized_actions,
        refreshed.authorized_societies, refreshed.authorized_sites, refreshed.global_society_access,
        db.query(UserModulePermission).filter_by(user_id=target.id).count(),
    )
    assert legacy_after == legacy_before
    events = db.query(AuditEvent).filter(
        AuditEvent.user_id == admin.id,
        AuditEvent.resource_id == str(target.id),
        AuditEvent.action.in_(["feature_permission.add", "feature_permission.remove"]),
    ).all()
    assert len(events) == 3
    details = [json.loads(event.new_state or event.old_state) for event in events]
    assert all({"module", "feature", "action", "target_user_id", "target_username", "change"} <= set(detail) for detail in details)
    assert all(event.result == "success" for event in events)


def test_identical_replacement_is_deterministic_without_false_audit(client, db):
    admin = _user(db, "FEATURE_IDEMPOTENT_ADMIN", role="admin", global_access=True)
    target = _user(db, "FEATURE_IDEMPOTENT_TARGET")
    payload = {"permissions": [
        {"module_key": "drh", "feature_key": "employees", "action_key": "read"},
    ]}
    assert client.put(_url(target), headers=_headers(admin), json=payload).status_code == 200
    before = db.query(AuditEvent).filter_by(user_id=admin.id, resource_id=str(target.id)).count()

    response = client.put(_url(target), headers=_headers(admin), json=payload)

    assert response.status_code == 200
    assert response.json()["permissions"] == payload["permissions"]
    assert db.query(AuditEvent).filter_by(user_id=admin.id, resource_id=str(target.id)).count() == before


def test_direct_employee_creation_permission_can_be_granted_and_revoked(client, db):
    admin = _user(db, "FEATURE_DIRECT_ADMIN", role="admin", global_access=True)
    target = _user(db, "FEATURE_DIRECT_TARGET")
    target.authorized_modules = ["drh"]
    db.commit()
    headers = _headers(target)
    options_url = "/api/drh/employees/creation-options"
    assert client.get(options_url, headers=headers).json()["direct_creation_allowed"] is False
    permission = {"module_key": "drh", "feature_key": "direct_employee_creation", "action_key": "create"}

    granted = client.put(_url(target), headers=_headers(admin), json={"permissions": [permission]})
    assert granted.status_code == 200, granted.text
    assert client.get(options_url, headers=headers).json()["direct_creation_allowed"] is True

    revoked = client.put(_url(target), headers=_headers(admin), json={"permissions": []})
    assert revoked.status_code == 200, revoked.text
    assert client.get(options_url, headers=headers).json()["direct_creation_allowed"] is False


def test_user_creation_can_grant_direct_permission_but_public_registration_cannot(client, db, monkeypatch):
    admin = _user(db, "FEATURE_DIRECT_CREATE_ADMIN", role="admin", global_access=True)
    permission = {"module_key": "drh", "feature_key": "direct_employee_creation", "action_key": "create"}
    monkeypatch.setattr("app.modules.auth.routes.send_user_credentials_email", lambda *_args, **_kwargs: None)
    created = client.post("/api/auth/users", headers=_headers(admin), json={
        "username": "FEATURE_DIRECT_NEW",
        "email": "feature.direct.new@example.com",
        "full_name": "Direct creation user",
        "role": "drh",
        "authorized_modules": ["drh"],
        "authorized_societies": ["Iron Global Securite"],
        "feature_permissions": [permission],
        "password": "testpass123",
        "validation_password": "test-validation-password",
    })
    assert created.status_code == 200, created.text
    created_user_id = created.json()["id"]
    assert db.query(UserFeaturePermission).filter_by(
        user_id=created_user_id, module_key="drh",
        feature_key="direct_employee_creation", action_key="create",
    ).count() == 1

    monkeypatch.setattr("app.modules.auth.routes.settings.allow_public_registration", True)
    public = client.post("/api/auth/register", json={
        "username": "FEATURE_PUBLIC_DIRECT",
        "email": "feature.public.direct@example.com",
        "role": "admin",
        "authorized_modules": ["drh"],
        "feature_permissions": [permission],
        "password": "testpass123",
    })
    assert public.status_code == 200, public.text
    public_user_id = public.json()["id"]
    assert db.query(UserFeaturePermission).filter_by(user_id=public_user_id).count() == 0


def test_audit_failure_rolls_back_the_complete_replacement(client, db, monkeypatch):
    admin = _user(db, "FEATURE_ROLLBACK_ADMIN", role="admin", global_access=True)
    target = _user(db, "FEATURE_ROLLBACK_TARGET")
    original = UserFeaturePermission(user_id=target.id, module_key="ops", feature_key="sites", action_key="read")
    db.add(original)
    db.commit()

    def fail_audit(*_args, **_kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr("app.modules.auth.routes.append_audit", fail_audit)
    with pytest.raises(RuntimeError, match="audit unavailable"):
        client.put(
            _url(target),
            headers=_headers(admin),
            json={"permissions": [{"module_key": "drh", "feature_key": "employees", "action_key": "read"}]},
        )
    rows = db.query(UserFeaturePermission).filter_by(user_id=target.id).all()
    assert [(row.module_key, row.feature_key, row.action_key) for row in rows] == [("ops", "sites", "read")]


def test_database_rejects_non_applicable_action(db):
    target = _user(db, "FEATURE_DB_CHECK")
    db.add(UserFeaturePermission(user_id=target.id, module_key="drh", feature_key="employees", action_key="pay"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_prepared_feature_permission_does_not_activate_business_access(client, db):
    admin = _user(db, "FEATURE_INERT_ADMIN", role="admin", global_access=True)
    target = _user(db, "FEATURE_INERT_TARGET")
    assert client.put(
        _url(target),
        headers=_headers(admin),
        json={"permissions": [{"module_key": "drh", "feature_key": "employees", "action_key": "read"}]},
    ).status_code == 200

    assert client.get("/api/drh/dashboard", headers=_headers(target)).status_code == 403
    assert feature_catalog_payload()["granular_permissions_active"] is False
