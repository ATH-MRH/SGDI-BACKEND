"""Sessions renouvelables ATLAS MOBILE : /api/auth/mobile/login, /refresh, /logout."""
from datetime import datetime, timedelta

import pytest

from app.core.security import create_access_token, decode_token, hash_password
from app.modules.auth.models import AuditEvent, AuthSession, User
from app.modules.auth.sessions import SESSION_CLAIM

ADMIN = {"username": "testadmin", "password": "test-admin-password"}


def _login(client, **extra):
    response = client.post("/api/auth/mobile/login", json={**ADMIN, "platform": "ios", "app_version": "1.0.0", **extra})
    assert response.status_code == 200, response.text
    return response.json()


def _bearer(tokens):
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture
def session_user(db):
    user = User(
        username="mobile_session_user", email="mobile.session@test.com", full_name="Mobile Session",
        role="ops", access_level="H3", authorized_societies=["Iron Global Securite"], authorized_structures=[],
        authorized_modules=["ops"], password_hash=hash_password("testpass123"), is_active=True,
    )
    db.add(user)
    db.commit()
    yield user
    db.query(AuthSession).filter(AuthSession.user_id == user.id).delete()
    db.delete(user)
    db.commit()


def test_web_login_is_unchanged_and_has_no_session(client):
    body = client.post("/api/auth/login", json=ADMIN).json()
    assert set(body) == {"access_token", "token_type", "user"}
    assert SESSION_CLAIM not in decode_token(body["access_token"])


def test_mobile_login_opens_a_short_lived_staff_session(client, db):
    tokens = _login(client)
    assert set(tokens) == {"access_token", "token_type", "expires_in", "refresh_token", "refresh_expires_in", "user"}
    assert tokens["expires_in"] == 30 * 60
    assert tokens["user"]["username"] == "testadmin"
    payload = decode_token(tokens["access_token"])
    assert payload["token_use"] == "staff"
    session = db.query(AuthSession).filter(AuthSession.public_id == payload[SESSION_CLAIM]).one()
    assert (session.platform, session.app_version) == ("ios", "1.0.0")
    # Le refresh token n'est jamais stocké en clair.
    assert tokens["refresh_token"] not in (session.refresh_hash, session.previous_refresh_hash)
    assert len(session.refresh_hash) == 64
    assert client.get("/api/auth/me", headers=_bearer(tokens)).status_code == 200


def test_mobile_login_rejects_bad_credentials_and_unknown_platform_is_dropped(client, db):
    assert client.post("/api/auth/mobile/login", json={**ADMIN, "password": "faux"}).status_code == 401
    tokens = _login(client, platform="<script>", app_version=None)
    session = db.query(AuthSession).filter(AuthSession.public_id == decode_token(tokens["access_token"])[SESSION_CLAIM]).one()
    assert session.platform is None and session.app_version is None


def test_refresh_rotates_the_refresh_token(client):
    first = _login(client)
    second = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert second.status_code == 200, second.text
    second = second.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert decode_token(second["access_token"])[SESSION_CLAIM] == decode_token(first["access_token"])[SESSION_CLAIM]
    assert client.get("/api/auth/me", headers=_bearer(second)).status_code == 200
    third = client.post("/api/auth/refresh", json={"refresh_token": second["refresh_token"]})
    assert third.status_code == 200


def test_reusing_a_consumed_refresh_token_revokes_the_whole_session(client, db):
    first = _login(client)
    second = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]}).json()
    replay = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert replay.status_code == 401
    # Le jeton légitime est lui aussi coupé : la session est compromise.
    assert client.post("/api/auth/refresh", json={"refresh_token": second["refresh_token"]}).status_code == 401
    assert client.get("/api/auth/me", headers=_bearer(second)).status_code == 401
    event = db.query(AuditEvent).filter(AuditEvent.action == "auth.refresh").order_by(AuditEvent.id.desc()).first()
    assert event.result == "refused"
    assert first["refresh_token"] not in f"{event.new_state}{event.resource_id}"


def test_refresh_rejects_unknown_malformed_and_access_tokens(client):
    tokens = _login(client)
    assert client.post("/api/auth/refresh", json={"refresh_token": "x" * 64}).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": tokens["access_token"][:200]}).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": "court"}).status_code == 422
    assert client.post("/api/auth/refresh", json={}).status_code == 422


def test_refresh_token_is_not_an_access_token(client):
    tokens = _login(client)
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}).status_code == 401


def test_expired_session_refuses_refresh_and_access(client, db):
    tokens = _login(client)
    session = db.query(AuthSession).filter(AuthSession.public_id == decode_token(tokens["access_token"])[SESSION_CLAIM]).one()
    session.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    assert client.get("/api/auth/me", headers=_bearer(tokens)).status_code == 401


def test_session_lifetime_is_capped(client, db):
    tokens = _login(client)
    session = db.query(AuthSession).filter(AuthSession.public_id == decode_token(tokens["access_token"])[SESSION_CLAIM]).one()
    session.created_at = datetime.utcnow() - timedelta(days=89)
    db.commit()
    renewed = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).json()
    assert renewed["refresh_expires_in"] <= 24 * 3600 + 5


def test_logout_revokes_the_session_server_side(client, db):
    tokens = _login(client)
    assert client.post("/api/auth/logout", headers=_bearer(tokens)).json() == {"ok": True, "revoked": True}
    assert client.get("/api/auth/me", headers=_bearer(tokens)).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    # Un second appel avec le même jeton est refusé comme toute requête d'une session révoquée… sans erreur serveur.
    assert client.post("/api/auth/logout", headers=_bearer(tokens)).json() == {"ok": True, "revoked": False}


def test_logout_only_revokes_its_own_session(client):
    phone, tablet = _login(client), _login(client)
    client.post("/api/auth/logout", headers=_bearer(phone))
    assert client.get("/api/auth/me", headers=_bearer(tablet)).status_code == 200


def test_logout_with_a_web_token_revokes_nothing_and_says_so(client, auth_headers):
    assert client.post("/api/auth/logout", headers=auth_headers).json() == {"ok": True, "revoked": False}
    assert client.get("/api/auth/me", headers=auth_headers).status_code == 200


def test_logout_requires_a_staff_token(client):
    assert client.post("/api/auth/logout").status_code == 401
    portal = create_access_token("EMP001", {"portal": True})
    assert client.post("/api/auth/logout", headers={"Authorization": f"Bearer {portal}"}).status_code == 401


def test_logout_is_allowed_for_a_read_only_account(client, db, session_user):
    session_user.authorized_actions = ["read"]
    db.commit()
    tokens = client.post("/api/auth/mobile/login", json={"username": session_user.username, "password": "testpass123"}).json()
    assert client.post("/api/auth/logout", headers=_bearer(tokens)).json()["revoked"] is True


def test_forged_session_claim_is_refused(client, db, session_user):
    victim = _login(client)
    victim_sid = decode_token(victim["access_token"])[SESSION_CLAIM]
    # Jeton correctement signé, mais session d'un autre utilisateur ou inexistante.
    for sid in (victim_sid, "inconnue", "", 12):
        token = create_access_token(str(session_user.id), {"token_use": "staff", SESSION_CLAIM: sid})
        assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_password_change_and_deactivation_revoke_sessions(client, db, auth_headers, session_user):
    credentials = {"username": session_user.username, "password": "testpass123"}
    tokens = client.post("/api/auth/mobile/login", json=credentials).json()
    changed = client.patch(f"/api/auth/users/{session_user.username}", headers=auth_headers, json={"password": "nouveau-passe-123"})
    assert changed.status_code == 200, changed.text
    assert client.get("/api/auth/me", headers=_bearer(tokens)).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401

    tokens = client.post("/api/auth/mobile/login", json={**credentials, "password": "nouveau-passe-123"}).json()
    assert client.patch(f"/api/auth/users/{session_user.username}", headers=auth_headers, json={"is_active": False}).status_code == 200
    assert client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    assert client.post("/api/auth/mobile/login", json={**credentials, "password": "nouveau-passe-123"}).status_code == 401


def test_dead_sessions_are_purged_after_retention(client, db, session_user):
    from app.modules.auth.sessions import purge_dead_sessions

    old = datetime.utcnow() - timedelta(days=45)
    recent = datetime.utcnow() - timedelta(days=2)
    rows = {
        "expirée ancienne": dict(expires_at=old),
        "révoquée ancienne": dict(expires_at=datetime.utcnow() + timedelta(days=5), revoked_at=old),
        "révoquée récente": dict(expires_at=datetime.utcnow() + timedelta(days=5), revoked_at=recent),
        "active": dict(expires_at=datetime.utcnow() + timedelta(days=5)),
    }
    for index, values in enumerate(rows.values()):
        db.add(AuthSession(public_id=f"purge-{index}", user_id=session_user.id, refresh_hash=f"{index}" * 64,
                           created_at=old, last_used_at=old, **values))
    db.commit()

    # Une connexion nettoie les sessions mortes du compte, et seulement elles.
    assert client.post("/api/auth/mobile/login", json={"username": session_user.username, "password": "testpass123"}).status_code == 200
    kept = {row.public_id for row in db.query(AuthSession).filter(AuthSession.user_id == session_user.id)}
    assert {"purge-2", "purge-3"} <= kept and not {"purge-0", "purge-1"} & kept

    other = db.query(User).filter(User.username == "testadmin").one()
    db.add(AuthSession(public_id="purge-autre", user_id=other.id, refresh_hash="z" * 64, created_at=old, last_used_at=old, expires_at=old))
    db.commit()
    assert purge_dead_sessions(db, session_user.id) == 0
    assert purge_dead_sessions(db) >= 1
    db.commit()
    assert db.query(AuthSession).filter(AuthSession.public_id == "purge-autre").count() == 0


def test_scope_and_rights_are_unchanged_by_a_mobile_session(client, db, session_user):
    """Une session mobile porte le même compte : mêmes modules, mêmes sociétés, mêmes sites."""
    web = client.post("/api/auth/login", json={"username": session_user.username, "password": "testpass123"}).json()
    mobile = client.post("/api/auth/mobile/login", json={"username": session_user.username, "password": "testpass123"}).json()
    web_me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {web['access_token']}"}).json()
    mobile_me = client.get("/api/auth/me", headers=_bearer(mobile)).json()
    assert mobile_me == web_me
    assert mobile_me["authorized_societies"] == ["Iron Global Securite"] and mobile_me["effective_modules"] == ["ops"]
    # Module non accordé : refusé avec un jeton mobile comme avec un jeton web.
    assert client.get("/api/drh/employees/page", headers=_bearer(mobile)).status_code == 403
    assert client.get("/api/ops/sites/page", headers=_bearer(mobile)).status_code == 200

    session_user.authorized_sites = [424242]
    session_user.authorized_modules = []
    db.commit()
    # Les droits sont relus à chaque requête : pas besoin d'attendre le prochain jeton.
    assert client.get("/api/ops/sites/page", headers=_bearer(mobile)).status_code == 403
    refreshed = client.post("/api/auth/refresh", json={"refresh_token": mobile["refresh_token"]}).json()
    assert refreshed["user"]["authorized_sites"] == [424242]
