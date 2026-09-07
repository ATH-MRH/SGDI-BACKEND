from datetime import datetime, timedelta
import hashlib

from app.core.scope_policy import ScopeKind, society_scope
from app.core.audit import append_audit
from app.core.security import hash_password, verify_password
from app.main import on_startup
from app.modules.auth.models import AuditEvent, PortalPasswordResetToken, User
from app.modules.irongs import service


def _user(db, name, societies=None, global_access=False):
    row = User(username=name, full_name=name, role="ops", access_level="H3",
               authorized_societies=societies or [], authorized_structures=[], authorized_sites=[],
               global_society_access=global_access, password_hash=hash_password("ValidPassword123"), is_active=True)
    db.add(row); db.commit(); return row


def test_restart_never_changes_existing_admin_password(db, monkeypatch):
    import app.main as main_module
    monkeypatch.setattr(main_module, "start_contract_email_alert_scheduler", lambda: None)
    monkeypatch.setattr(main_module, "start_assistant_scheduler", lambda: None)
    admin = db.query(User).filter(User.username == "testadmin").one()
    admin.password_hash = hash_password("KeptPassword123")
    db.commit()
    try:
        on_startup()
        db.refresh(admin)
        assert verify_password("KeptPassword123", admin.password_hash)
        assert not verify_password("test-admin-password", admin.password_hash)
    finally:
        db.expire_all()
        admin = db.query(User).filter(User.username == "testadmin").one()
        admin.password_hash = hash_password("test-admin-password")
        db.commit()


def test_scope_policy_denies_empty_and_allows_explicit_global(db):
    empty = _user(db, "NOSCOPE")
    limited = _user(db, "SCOPEA", ["Société A"])
    global_user = _user(db, "GLOBAL", global_access=True)
    assert society_scope(empty).kind is ScopeKind.NONE
    assert not society_scope(empty).allows("Société A")
    assert society_scope(limited).allows("Societe A")
    assert not society_scope(limited).allows("Société B")
    assert society_scope(global_user).allows("Société A")
    assert society_scope(global_user).allows("Société B")


def test_legacy_collection_scope_read_write_delete(db):
    limited = _user(db, "LEGACYA", ["Société A"])
    a = service.create_item(db, "prospects", {"id": "a", "societe": "Société A", "nom": "A"})
    service.create_item(db, "prospects", {"id": "b", "societe": "Société B", "nom": "B"})
    rows = service.scope_collection_for_user("prospects", service.list_items(db, "prospects"), limited)
    assert [row["id"] for row in rows] == [a["id"]]
    service.ensure_item_allowed_for_user({"societe": "Société A"}, limited, "prospects")
    import pytest
    with pytest.raises(Exception):
        service.ensure_item_allowed_for_user({"societe": "Société B"}, limited, "prospects")


def test_password_reset_token_is_hashed_expiring_and_single_use(client, db):
    service.create_item(db, "portalAccounts", {"id": "PX1", "username": "px1", "matricule": "PX1",
                        "passwordHash": hash_password("OldPassword123"), "societe": "Société A", "active": True})
    raw = "one-time-secret-value"
    row = PortalPasswordResetToken(account_id="PX1", token_hash=hashlib.sha256(raw.encode()).hexdigest(),
                                   expires_at=datetime.utcnow() + timedelta(minutes=10))
    db.add(row); db.commit()
    response = client.post("/api/portal/password-reset/confirm", json={"token": raw, "password": "NewPassword123!"})
    assert response.status_code == 200, response.text
    db.refresh(row)
    assert row.used_at is not None
    assert client.post("/api/portal/password-reset/confirm", json={"token": raw, "password": "AnotherPassword123!"}).status_code == 400
    assert db.query(AuditEvent).filter(AuditEvent.action == "portal.password_reset.confirm").count() >= 1


def test_unknown_legacy_collection_is_denied(client, auth_headers, db):
    response = client.get("/api/irongs/collections/not-explicitly-allowed", headers=auth_headers)
    assert response.status_code == 403
    assert db.query(AuditEvent).filter(AuditEvent.action == "legacy.read", AuditEvent.result == "refused").count() >= 1


def test_public_registration_cannot_self_assign_global_access(client, db, monkeypatch):
    import app.modules.auth.routes as auth_routes
    monkeypatch.setattr(auth_routes.settings, "allow_public_registration", True)
    response = client.post("/api/auth/register", json={
        "username": "PUBLIC_SCOPE_ATTACK", "password": "ValidPassword123!",
        "role": "admin", "global_society_access": True,
    })
    assert response.status_code == 200, response.text
    created = db.query(User).filter(User.username == "PUBLIC_SCOPE_ATTACK").one()
    assert created.global_society_access is False
    assert created.role == "user"


def test_legacy_whitelist_checks_module_and_scope(client, db):
    user = _user(db, "OPS_SCOPE_A", ["Société A"])
    user.authorized_structures = ["ops"]
    db.commit()
    from app.core.security import create_access_token
    headers = {"Authorization": f"Bearer {create_access_token(str(user.id), {'role': user.role})}"}
    assert client.get("/api/irongs/collections/sites", headers=headers).status_code == 200
    assert client.get("/api/irongs/collections/paieBulletins", headers=headers).status_code == 403


def test_manual_rh_reset_flow_is_end_to_end(client, auth_headers, db):
    service.create_item(db, "portalAccounts", {
        "id": "PX2", "username": "px2", "matricule": "PX2",
        "passwordHash": hash_password("OldPassword123"), "societe": "Société A", "active": True,
    })
    requested = client.post("/api/portal/password-reset/request", json={"code": "PX2", "channel": "manual_rh"})
    assert requested.status_code == 200
    issued = client.post("/api/portal/password-reset/manual-token", headers=auth_headers, json={"matricule": "PX2"})
    assert issued.status_code == 200, issued.text
    raw = issued.json()["resetToken"]
    assert raw and raw not in {row.token_hash for row in db.query(PortalPasswordResetToken).all()}
    confirmed = client.post("/api/portal/password-reset/confirm", json={"token": raw, "password": "NewPassword123!"})
    assert confirmed.status_code == 200, confirmed.text
    assert client.post("/api/portal/login", json={"username": "PX2", "password": "NewPassword123!"}).status_code == 200


def test_audit_is_immutable_and_redacts_nested_secrets(db):
    event = append_audit(db, action="security.test", resource="test", result="success",
                         new_state={"nested": {"password": "plain", "api_secret": "plain"}})
    db.commit()
    assert "plain" not in (event.new_state or "")
    event.result = "changed"
    import pytest
    with pytest.raises(ValueError, match="append-only"):
        db.commit()
    db.rollback()
