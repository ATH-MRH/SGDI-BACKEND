"""Gestion des équipements (Administration Système) et « Mes équipements » (Pointeur).

Vue unifiée des registres existants (terminaux, caméras) et affectations compte × équipement
dans `facial_device_authorizations`. Une affectation n'accorde aucun droit biométrique, aucun
accès société, et n'active jamais le pointage facial. Données fictives."""
import os
import threading
from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.biometrics.models import BiometricTerminal, Camera, FacialDeviceAuthorization
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics_terminals import OTHER, SOC, _site
from tests.test_pointeur_multi_facial_terminals import (  # noqa: F401 (fixture autouse « multi »)
    API, FORBIDDEN_FIELDS, _activate, _camera, _grant, _kiosk, _list, _login, _pointer, _tag, multi)

EQ = f"{API}/equipment"


def _assign(client, h, keys, users, action="grant"):
    return client.post(f"{EQ}/assignments", headers=h, json={"keys": keys, "user_ids": [u.id for u in users], "action": action})


def _items(client, h, **params):
    r = client.get(EQ, headers=h, params=params)
    assert r.status_code == 200, r.text
    return {row["key"]: row for row in r.json()["items"]}


def _rows_for(db, user):
    db.expire_all()
    return db.execute(select(FacialDeviceAuthorization).where(FacialDeviceAuthorization.user_id == user.id)).scalars().all()


@pytest.fixture
def park(client, auth_headers, db):
    site = _site(db)
    tid, _device = _kiosk(client, auth_headers, site)
    cid = _camera(client, auth_headers, site)
    return site, f"trm:{tid}", f"cam:{cid}"


# Ajout d'équipement : fiche complète, états séparés, aucun champ sensible
def test_registered_equipment_appears_with_a_complete_sheet(client, auth_headers, db, park):
    site, trm, cam = park
    items = _items(client, auth_headers)
    terminal, camera = items[trm], items[cam]
    assert terminal["type"] == "TABLET_ANDROID" and terminal["type_label"] == "Tablette Android"
    assert terminal["admin_state"] == "ACTIVE" and terminal["pairing_state"] == "PAIRED"
    assert terminal["availability"] == "OFFLINE" and terminal["connection"] == "NEVER"      # appairée, jamais connectée
    assert terminal["facial_authorization"] is True and "FACIAL_ATTENDANCE" in terminal["capabilities"]
    assert camera["type"] == "IP_CAMERA" and camera["pairing_state"] == "REGISTERED" and camera["availability"] == "UNKNOWN"
    for row in (terminal, camera):
        assert row["society"] == SOC and row["site_id"] == site.id and row["users"] == []
    sheet = client.get(f"{EQ}/{trm}", headers=auth_headers).json()
    assert [h["label"] for h in sheet["history"]][-1] == "Enregistrement"
    body = client.get(EQ, headers=auth_headers).text + client.get(f"{EQ}/{cam}", headers=auth_headers).text
    for field in ("public_key", "key_fingerprint", "pairing_code", "credentials", "public_id", '"host"', "10.0.0.20", "secret-cam"):
        assert field not in body, field


def test_dashboard_and_filters(client, auth_headers, db, park):
    site, trm, cam = park
    other_site = _site(db)
    _kiosk(client, auth_headers, other_site, pair=False)
    data = client.get(EQ, headers=auth_headers).json()
    board = data["dashboard"]
    assert board["total"] >= 3 and board["terminals"] >= 2 and board["cameras"] >= 1 and board["unassigned"] >= 3
    assert set(_items(client, auth_headers, site_id=site.id)) == {trm, cam}
    assert set(_items(client, auth_headers, site_id=site.id, kind="CAMERA")) == {cam}
    assert set(_items(client, auth_headers, site_id=site.id, type="TABLET_ANDROID")) == {trm}
    assert all(r["admin_state"] == "ACTIVE" for r in _items(client, auth_headers, state="ACTIVE").values())
    user, _ = _pointer(client, db, sites=[site])
    assert _assign(client, auth_headers, [cam], [user]).status_code == 200
    assert set(_items(client, auth_headers, user_id=user.id)) == {cam}
    assert SOC in data["filters"]["societies"]


# Affectation, retrait, plusieurs utilisateurs × plusieurs équipements, historique
def test_assign_several_devices_to_several_users_then_remove(client, auth_headers, db, park):
    site, trm, cam = park
    alice, alice_h = _pointer(client, db, sites=[site])
    bob, _ = _pointer(client, db, sites=[site])
    check = client.post(f"{EQ}/assignments/check", headers=auth_headers,
                        json={"keys": [trm, cam], "user_ids": [alice.id, bob.id], "action": "grant"}).json()
    assert check["allowed"] is True and check["changes"] == 4
    assert _rows_for(db, alice) == []                                   # la vérification n'écrit rien
    r = _assign(client, auth_headers, [trm, cam], [alice, bob])
    assert r.status_code == 200 and r.json()["changed"] == 4, r.text
    items = _items(client, auth_headers)
    assert {u["username"] for u in items[trm]["users"]} == {alice.username, bob.username} == {u["username"] for u in items[cam]["users"]}
    assert {row["key"] for row in _list(client, alice_h, site_id=site.id).json()["terminals"]} == {trm, cam}

    again = _assign(client, auth_headers, [trm], [alice])               # déjà affecté : aucune ligne doublée
    assert again.status_code == 200 and again.json()["changed"] == 0
    assert _assign(client, auth_headers, [cam], [alice], "revoke").json()["changed"] == 1
    assert {r.camera_id for r in _rows_for(db, alice)} == {None} and len(_rows_for(db, bob)) == 2
    history = client.get(f"{EQ}/{cam}", headers=auth_headers).json()["history"]
    assert history[0]["label"] == "Affectations modifiées" and history[0]["removed"] == [alice.username]
    assert history[1]["added"] == sorted([alice.username, bob.username]) and history[0]["by"]


def test_legacy_screen_and_equipment_module_share_the_same_assignments(client, auth_headers, db, park):
    site, trm, cam = park
    alice, _ = _pointer(client, db, sites=[site])
    assert _grant(client, auth_headers, trm, alice).status_code == 200            # écran historique
    assert [u["id"] for u in _items(client, auth_headers)[trm]["users"]] == [alice.id]
    assert _assign(client, auth_headers, [cam], [alice]).status_code == 200
    legacy = {row["key"]: row for row in client.get(f"{API}/facial-devices", headers=auth_headers).json()["items"]}
    assert [u["id"] for u in legacy[cam]["users"]] == [alice.id]


# Société / site non autorisé, comptes non éligibles : tout ou rien
def test_out_of_scope_or_ineligible_accounts_are_refused_all_or_nothing(client, auth_headers, db, park):
    site, trm, cam = park
    alice, _ = _pointer(client, db, sites=[site])
    elsewhere, _ = _pointer(client, db, sites=[_site(db)])
    foreign, _ = _pointer(client, db, sites=[_site(db, OTHER)], societies=(OTHER,))
    inactive, _ = _pointer(client, db, sites=[site])
    inactive.is_active = False; db.commit()
    admin = db.execute(select(User).where(User.username == "testadmin")).scalar_one()
    r = _assign(client, auth_headers, [trm, cam], [alice, elsewhere, foreign, inactive, admin])
    assert r.status_code == 422, r.text
    codes = {(x["username"], x["code"]) for x in r.json()["detail"]["refused"]}
    assert {(elsewhere.username, "OUT_OF_SCOPE"), (foreign.username, "OUT_OF_SCOPE"),
            (inactive.username, "ACCOUNT_INACTIVE"), (admin.username, "GLOBAL_ADMIN")} <= codes
    assert _rows_for(db, alice) == []                                   # rien d'écrit, même pour le compte valable


def test_insufficient_permissions(client, auth_headers, db, park):
    site, trm, cam = park
    alice, alice_h = _pointer(client, db, sites=[site])
    for call in (lambda h: client.get(EQ, headers=h), lambda h: client.get(f"{EQ}/{trm}", headers=h),
                 lambda h: client.get(f"{EQ}/accounts", headers=h), lambda h: _assign(client, h, [trm], [alice]),
                 lambda h: client.post(f"{EQ}/assignments/check", headers=h, json={"keys": [trm], "user_ids": [alice.id], "action": "grant"})):
        assert call(alice_h).status_code == 403
    assert _rows_for(db, alice) == []


# Appareil révoqué, hors ligne, facial coupé : visible dans « Mes équipements », jamais utilisable
def test_revoked_device_cannot_be_assigned_and_shows_as_unavailable(client, auth_headers, db, park):
    site, trm, cam = park
    alice, alice_h = _pointer(client, db, sites=[site])
    assert _assign(client, auth_headers, [trm], [alice]).status_code == 200
    tid = int(trm.split(":")[1])
    assert client.post(f"{API}/terminals/{tid}/revoke", headers=auth_headers, json={"reason": "Perdu"}).status_code == 200
    bob, _ = _pointer(client, db, sites=[site])
    refused = _assign(client, auth_headers, [trm], [bob])
    assert refused.status_code == 422 and refused.json()["detail"]["refused"][0]["code"] == "DEVICE_REVOKED"
    listing = _list(client, alice_h, site_id=site.id).json()
    assert trm not in {r["key"] for r in listing["terminals"]}
    assert [(r["key"], r["code"]) for r in listing["unavailable"]] == [(trm, "REVOKED")]
    assert _activate(client, alice_h, [trm], site_id=site.id).json()["results"][0]["status"] == "REFUSED"
    assert _items(client, auth_headers)[trm]["admin_state"] == "REVOKED"
    assert _assign(client, auth_headers, [trm], [alice], "revoke").status_code == 200    # nettoyage toujours possible


def test_offline_device_is_reported_offline(client, auth_headers, db, park):
    site, trm, cam = park
    alice, alice_h = _pointer(client, db, sites=[site])
    _assign(client, auth_headers, [trm], [alice])
    term = db.get(BiometricTerminal, int(trm.split(":")[1]))
    term.last_seen_at = datetime.utcnow() - timedelta(hours=2)
    term.meta = {**(term.meta or {}), "heartbeat_s": 30}
    db.commit()
    assert _items(client, auth_headers)[trm]["availability"] == "OFFLINE"
    row = next(r for r in _list(client, alice_h, site_id=site.id).json()["terminals"] if r["key"] == trm)
    assert row["online"] is False and row["connection"] == "LOST"


def test_assignment_never_activates_facial_attendance_nor_grants_rights(client, auth_headers, db):
    site = _site(db)
    tid, _ = _kiosk(client, auth_headers, site, facial=False)
    cid = _camera(client, auth_headers, site, facial=False)
    alice, alice_h = _pointer(client, db, sites=[site])
    permissions = lambda: db.execute(select(func.count()).select_from(UserFeaturePermission)  # noqa: E731
                                     .where(UserFeaturePermission.user_id == alice.id)).scalar_one()
    before, societies, sites = permissions(), list(alice.authorized_societies), list(alice.authorized_sites)
    assert _assign(client, auth_headers, [f"trm:{tid}", f"cam:{cid}"], [alice]).status_code == 200
    db.expire_all()
    assert db.get(BiometricTerminal, tid).facial_attendance_enabled is False
    assert db.get(Camera, cid).facial_attendance_enabled is False
    alice = db.get(User, alice.id)
    assert permissions() == before and alice.authorized_societies == societies and alice.authorized_sites == sites
    listing = _list(client, alice_h, site_id=site.id).json()
    assert listing["terminals"] == []
    assert {r["code"] for r in listing["unavailable"]} == {"FACIAL_OFF"}
    results = _activate(client, alice_h, [f"trm:{tid}", f"cam:{cid}"], site_id=site.id).json()["results"]
    assert {r["status"] for r in results} == {"REFUSED"}


def test_assignment_removed_during_a_session_is_enforced_at_the_next_use(client, auth_headers, db, park):
    site, trm, cam = park
    alice, alice_h = _pointer(client, db, sites=[site])
    _assign(client, auth_headers, [cam], [alice])
    assert _activate(client, alice_h, [cam], site_id=site.id).json()["results"][0]["status"] == "ACTIVATED"
    _assign(client, auth_headers, [cam], [alice], "revoke")
    result = _activate(client, alice_h, [cam], site_id=site.id).json()["results"][0]
    assert result["status"] == "REFUSED" and result["code"] == "NOT_AUTHORIZED"
    listing = _list(client, alice_h, site_id=site.id).json()
    assert listing["terminals"] == [] and listing["unavailable"] == [] and listing["authorized_total"] == 0


def test_eligible_accounts_list_shows_current_equipment(client, auth_headers, db, park):
    site, trm, cam = park
    alice, _ = _pointer(client, db, sites=[site])
    _assign(client, auth_headers, [trm, cam], [alice])
    accounts = {a["id"]: a for a in client.get(f"{EQ}/accounts", headers=auth_headers).json()}
    assert accounts[alice.id]["equipment"] == sorted([trm, cam])
    assert "password_hash" not in str(accounts[alice.id])
    assert not any(a["username"] == "testadmin" for a in accounts.values())


def test_audit_records_every_change_with_before_and_after(client, auth_headers, db, park):
    site, trm, cam = park
    alice, _ = _pointer(client, db, sites=[site])
    _assign(client, auth_headers, [trm], [alice])
    db.expire_all()
    row = db.execute(select(AuditEvent).where(AuditEvent.action == "biometrics.device.authorizations",
                                              AuditEvent.resource_id == trm.split(":")[1]).order_by(AuditEvent.id.desc())).scalars().first()
    assert row is not None and '"user_ids": []' in row.old_state and str(alice.id) in row.new_state


# Connexions simultanées : PostgreSQL, deux administrateurs en parallèle sur le même équipement
PG_URL = os.getenv("ATTENDANCE_PG_URL")


@pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")
def test_simultaneous_assignments_on_postgres_keep_every_grant():
    from types import SimpleNamespace

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.db.base import Base
    from app.modules.biometrics.equipment import AssignmentChange, change_assignments
    from app.modules.ops.models import Site

    engine = create_engine(PG_URL, pool_size=8, max_overflow=0)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        site = Site(name=f"PG EQ {_tag()}", active=1, equipment_plan={"societe": SOC}); db.add(site); db.flush()
        term = BiometricTerminal(name=f"TAB-{_tag()}", terminal_type="TABLET_ANDROID", society=SOC, site_id=site.id,
                                 public_id=_tag() + _tag(), enabled=True)
        db.add(term); db.flush()
        users = [User(username=f"pgeq{_tag().lower()}", full_name="Fictif", role="pointeur", access_level="H2", is_active=True,
                      authorized_modules=["pointeur"], authorized_societies=[SOC], authorized_sites=[site.id], password_hash="x")
                 for _ in range(4)]
        admin = User(username=f"pgadm{_tag().lower()}", full_name="Admin fictif", role="admin", access_level="H1", is_active=True,
                     password_hash="x", authorized_societies=[], global_society_access=True)
        db.add_all(users + [admin]); db.commit()
        ids = SimpleNamespace(term=term.id, users=[u.id for u in users], admin=admin.id, site=site.id)

    barrier, failures = threading.Barrier(4), []

    def grant(user_id):
        barrier.wait()
        try:
            with Session() as db:
                change_assignments(AssignmentChange(keys=[f"trm:{ids.term}"], user_ids=[user_id], action="grant"), db, db.get(User, ids.admin))
        except Exception as exc:  # noqa: BLE001
            failures.append(exc)

    threads = [threading.Thread(target=grant, args=(uid,)) for uid in ids.users]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    try:
        assert failures == []
        with Session() as db:
            granted = set(db.execute(select(FacialDeviceAuthorization.user_id)
                                     .where(FacialDeviceAuthorization.terminal_id == ids.term)).scalars())
            assert granted == set(ids.users)
            audits = db.execute(select(AuditEvent.old_state).where(AuditEvent.action == "biometrics.device.authorizations",
                                                                   AuditEvent.resource_id == str(ids.term))).scalars().all()
            assert len(audits) == 4 and len(set(audits)) == 4                # chaque écriture a relu la liste à jour
    finally:
        with Session() as db:
            db.execute(FacialDeviceAuthorization.__table__.delete().where(FacialDeviceAuthorization.terminal_id == ids.term))
            db.execute(BiometricTerminal.__table__.delete().where(BiometricTerminal.id == ids.term))
            db.execute(User.__table__.delete().where(User.id.in_(ids.users + [ids.admin])))
            db.execute(Site.__table__.delete().where(Site.id == ids.site))
            db.commit()
        engine.dispose()
