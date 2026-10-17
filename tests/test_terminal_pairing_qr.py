"""Association des tablettes / smartphones par QR code (Gestion des équipements → /borne).

Le QR ne porte que le code d'association à usage unique déjà en place (`/borne#pair=CODE`) :
aucun second système d'appairage. Le serveur seul valide : code aléatoire, 10 minutes, usage
unique, terminal précis (donc sa société et son site), terminal actif, refus distincts, verrou
contre les scans simultanés, audit. Aucune activation faciale, aucun droit ajouté. Fictif."""
import os
import threading
from datetime import datetime, timedelta
from urllib.parse import urlsplit

import pytest
from sqlalchemy import func, select

from app.core import rate_limit
from app.modules.auth.models import AuditEvent, UserFeaturePermission
from app.modules.biometrics import terminals
from app.modules.biometrics.models import BiometricTerminal, FacialDeviceAuthorization
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics_terminals import API, OTHER, SOC, Device, _site, _tag

PAIR = f"{API}/terminal/pair"


@pytest.fixture(autouse=True)
def fresh_rate_limit():
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()
    yield


def _new_terminal(client, h, site, name=None):
    r = client.post(f"{API}/terminals", headers=h, json={"name": name or f"TAB-{_tag()}", "terminal_type": "TABLET_ANDROID", "site_id": site.id})
    assert r.status_code == 200, r.text
    return r.json()


def _qr(client, h, terminal_id):
    """Contenu du QR affiché par l'Administration Système : l'adresse /borne portant le code."""
    out = client.post(f"{API}/terminals/{terminal_id}/pairing-code", headers=h)
    assert out.status_code == 200, out.text
    body = out.json()
    return body, body["pair_path"]


def _code_from_qr(path: str) -> str:
    """Lecture faite par la borne : le fragment `pair=` de l'adresse scannée."""
    return urlsplit("https://pointeur.irongs.com" + path).fragment.split("pair=", 1)[1]


def _refusal(response, status, code, message):
    assert response.status_code == status, response.text
    assert response.json()["detail"] == {"code": code, "message": message}


def test_qr_and_manual_code_are_the_same_single_operation(client, auth_headers, db):
    site = _site(db)
    term = _new_terminal(client, auth_headers, site)
    body, path = _qr(client, auth_headers, term["id"])
    assert path.startswith("/borne#pair=") and _code_from_qr(path) == body["code"].replace("-", "")
    assert body["expires_in"] == terminals.PAIRING_TTL_SECONDS == 600
    r = client.post(PAIR, json={"code": _code_from_qr(path), "public_key": Device().jwk, "device_label": "Galaxy Tab"})
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["society"], r.json()["site"]) == (term["name"], SOC, site.name)
    # Le code saisi à la main (avec tiret) est la même opération : déjà consommée.
    _refusal(client.post(PAIR, json={"code": body["code"], "public_key": Device().jwk}), 409, "PAIRING_CODE_USED", "QR déjà utilisé")


def test_manual_code_works_when_the_camera_is_unavailable(client, auth_headers, db):
    site = _site(db)
    term = _new_terminal(client, auth_headers, site)
    body, _ = _qr(client, auth_headers, term["id"])
    assert client.post(PAIR, json={"code": " " + body["code"].lower() + " ", "public_key": Device().jwk}).status_code == 200


def test_expired_qr_is_refused_with_a_clear_message(client, auth_headers, db):
    site = _site(db)
    term = _new_terminal(client, auth_headers, site)
    body, path = _qr(client, auth_headers, term["id"])
    row = db.get(BiometricTerminal, term["id"]); db.refresh(row)
    row.pairing_expires_at = datetime.utcnow() - timedelta(seconds=1); db.commit()
    _refusal(client.post(PAIR, json={"code": _code_from_qr(path), "public_key": Device().jwk}), 410,
             "PAIRING_CODE_EXPIRED", "QR expiré — générez un nouveau code")
    db.refresh(row); assert row.public_key is None
    # « Générer un nouveau QR » : l'ancien ne sert plus, le nouveau associe.
    old = _code_from_qr(path)
    _, fresh = _qr(client, auth_headers, term["id"])
    _refusal(client.post(PAIR, json={"code": old, "public_key": Device().jwk}), 401, "PAIRING_CODE_INVALID", "Code d'association invalide")
    assert client.post(PAIR, json={"code": _code_from_qr(fresh), "public_key": Device().jwk}).status_code == 200


def test_forged_qr_is_refused(client, auth_headers, db):
    site = _site(db)
    term = _new_terminal(client, auth_headers, site)
    _, path = _qr(client, auth_headers, term["id"])
    real = _code_from_qr(path)
    forged = [real[:-1] + ("A" if real[-1] != "A" else "B"), "AAAAABBBBB", real + "X", "", "../../etc", str(term["id"])]
    for code in forged:
        _refusal(client.post(PAIR, json={"code": code, "public_key": Device().jwk}), 401, "PAIRING_CODE_INVALID", "Code d'association invalide")
    row = db.get(BiometricTerminal, term["id"]); db.refresh(row)
    assert row.public_key is None and row.pairing_expires_at is not None, "le vrai code reste utilisable"


def test_revoked_or_disabled_device_or_inactive_site_is_refused(client, auth_headers, db):
    site = _site(db)
    revoked = _new_terminal(client, auth_headers, site)
    _, revoked_qr = _qr(client, auth_headers, revoked["id"])
    row = db.get(BiometricTerminal, revoked["id"]); db.refresh(row)
    row.revoked_at, row.pairing_expires_at = datetime.utcnow(), datetime.utcnow() + timedelta(minutes=5)   # révocation « en vol »
    db.commit()
    message = "Association refusée — appareil ou site non autorisé"
    _refusal(client.post(PAIR, json={"code": _code_from_qr(revoked_qr), "public_key": Device().jwk}), 403, "PAIRING_REFUSED", message)
    disabled = _new_terminal(client, auth_headers, site)
    _, disabled_qr = _qr(client, auth_headers, disabled["id"])
    assert client.patch(f"{API}/terminals/{disabled['id']}", headers=auth_headers, json={"enabled": False}).status_code == 200
    _refusal(client.post(PAIR, json={"code": _code_from_qr(disabled_qr), "public_key": Device().jwk}), 403, "PAIRING_REFUSED", message)
    closed_site = _site(db)
    term = _new_terminal(client, auth_headers, closed_site)
    _, closed_qr = _qr(client, auth_headers, term["id"])
    closed_site.active = 0; db.commit()
    _refusal(client.post(PAIR, json={"code": _code_from_qr(closed_qr), "public_key": Device().jwk}), 403, "PAIRING_REFUSED", message)
    for terminal_id in (revoked["id"], disabled["id"], term["id"]):
        row = db.get(BiometricTerminal, terminal_id); db.refresh(row)
        assert row.public_key is None


def test_association_is_bound_to_its_own_device_society_and_site(client, auth_headers, db):
    site_a, site_b = _site(db), _site(db, OTHER)
    term_a, term_b = _new_terminal(client, auth_headers, site_a), _new_terminal(client, auth_headers, site_b)
    _, qr_a = _qr(client, auth_headers, term_a["id"])
    _, qr_b = _qr(client, auth_headers, term_b["id"])
    out = client.post(PAIR, json={"code": _code_from_qr(qr_b), "public_key": Device().jwk}).json()
    assert (out["name"], out["society"], out["site"]) == (term_b["name"], OTHER, site_b.name)
    a = db.get(BiometricTerminal, term_a["id"]); b = db.get(BiometricTerminal, term_b["id"]); db.refresh(a); db.refresh(b)
    assert b.public_key is not None and a.public_key is None, "le QR d'un équipement n'associe jamais un autre équipement"
    assert (a.society, a.site_id, b.society, b.site_id) == (SOC, site_a.id, OTHER, site_b.id)
    assert a.pairing_expires_at is not None, "le QR de l'autre équipement reste valable"


def test_pairing_never_activates_facial_nor_grants_rights_nor_touches_other_devices(client, auth_headers, db):
    site = _site(db)
    existing = _new_terminal(client, auth_headers, site)
    _, existing_qr = _qr(client, auth_headers, existing["id"])
    assert client.post(PAIR, json={"code": _code_from_qr(existing_qr), "public_key": Device().jwk}).status_code == 200
    before = db.get(BiometricTerminal, existing["id"]); db.refresh(before)
    snapshot = (before.public_key, before.key_fingerprint, before.paired_at, before.enabled, before.facial_attendance_enabled)
    counts = lambda: (db.execute(select(func.count()).select_from(UserFeaturePermission)).scalar_one(),  # noqa: E731
                      db.execute(select(func.count()).select_from(FacialDeviceAuthorization)).scalar_one())
    rights = counts()

    fresh = _new_terminal(client, auth_headers, site)
    _, qr = _qr(client, auth_headers, fresh["id"])
    assert client.post(PAIR, json={"code": _code_from_qr(qr), "public_key": Device().jwk}).status_code == 200
    db.expire_all()
    paired = db.get(BiometricTerminal, fresh["id"])
    assert paired.public_key is not None and paired.facial_attendance_enabled is False
    other = db.get(BiometricTerminal, existing["id"])
    assert (other.public_key, other.key_fingerprint, other.paired_at, other.enabled, other.facial_attendance_enabled) == snapshot
    assert counts() == rights


def test_every_refusal_and_success_is_audited_without_the_code(client, auth_headers, db):
    site = _site(db)
    term = _new_terminal(client, auth_headers, site)
    _, qr = _qr(client, auth_headers, term["id"])
    code = _code_from_qr(qr)
    client.post(PAIR, json={"code": "AAAAABBBBB", "public_key": Device().jwk})
    client.post(PAIR, json={"code": code, "public_key": Device().jwk})
    client.post(PAIR, json={"code": code, "public_key": Device().jwk})
    db.expire_all()
    rows = db.execute(select(AuditEvent).where(AuditEvent.action == "biometrics.terminal.pair").order_by(AuditEvent.id.desc()).limit(3)).scalars().all()
    states = [(r.result, r.new_state) for r in reversed(rows)]
    assert [s[0] for s in states] == ["refused", "success", "refused"]
    assert "PAIRING_CODE_INVALID" in states[0][1] and "PAIRING_CODE_USED" in states[2][1]
    assert all(code not in (r.new_state or "") and code not in (r.old_state or "") for r in rows)


def test_failed_attempts_stay_rate_limited(client, auth_headers, db):
    site = _site(db)
    term = _new_terminal(client, auth_headers, site)
    _, qr = _qr(client, auth_headers, term["id"])
    for _ in range(terminals.PAIRING_MAX_FAILURES_PER_IP):
        client.post(PAIR, json={"code": "AAAAABBBBB", "public_key": Device().jwk})
    assert client.post(PAIR, json={"code": _code_from_qr(qr), "public_key": Device().jwk}).status_code == 429


# ── Scan simultané : deux appareils présentent le même QR au même instant (PostgreSQL) ─────
PG_URL = os.getenv("ATTENDANCE_PG_URL")


@pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")
def test_two_devices_scanning_the_same_qr_at_once_only_one_is_associated():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.db.base import Base
    from app.modules.ops.models import Site

    engine = create_engine(PG_URL, pool_size=8, max_overflow=0)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        site = Site(name=f"PG QR {_tag()}", active=1, equipment_plan={"societe": SOC}); db.add(site); db.flush()
        term = BiometricTerminal(name=f"TAB-{_tag()}", terminal_type="TABLET_ANDROID", society=SOC, site_id=site.id,
                                 public_id=_tag() + _tag(), enabled=True)
        db.add(term); db.flush()
        out = terminals.new_pairing_code(db, term, None)
        db.commit()
        ids = (term.id, site.id)
    code = out["code"]
    barrier, results = threading.Barrier(4), []
    with rate_limit._LOCK:
        rate_limit._FAILURES.clear()

    def scan(n):
        barrier.wait()
        with Session() as db:
            try:
                terminals.pair(db, code=code, public_key=Device().jwk, device_label=f"appareil {n}", ip=f"10.0.0.{n}")
                results.append("OK")
            except Exception as exc:  # noqa: BLE001
                results.append(getattr(exc, "detail", {}).get("code", type(exc).__name__))

    threads = [threading.Thread(target=scan, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    try:
        assert sorted(results) == ["OK", "PAIRING_CODE_USED", "PAIRING_CODE_USED", "PAIRING_CODE_USED"]
        with Session() as db:
            row = db.get(BiometricTerminal, ids[0])
            assert row.public_key is not None and row.pairing_expires_at is None and row.facial_attendance_enabled is False
    finally:
        with Session() as db:
            db.execute(BiometricTerminal.__table__.delete().where(BiometricTerminal.id == ids[0]))
            db.execute(Site.__table__.delete().where(Site.id == ids[1]))
            db.commit()
        engine.dispose()
