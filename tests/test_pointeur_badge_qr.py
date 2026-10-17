"""QR des badges officiels (Studio Badges) scannés au Pointeur.

Le QR d'un badge est un lien PUBLIC de consultation ; il ne vaut pointage que scanné par un
compte Pointeur habilité, après validation serveur : signature du badge émis (mécanisme réel,
jamais simulé), badge actif et non expiré, employé actif et hors liste noire, périmètre
société / site, puis les règles d'Attendance Core. Données fictives uniquement."""
import json
import os
import threading
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.modules.auth.models import AuditEvent
from app.core.security import create_access_token
from app.main import _public_employee_token
from app.modules.attendance.models import AttendanceEvent
from app.modules.drh.badge_models import STATUS_ACTIVE, STATUS_REPLACED, STATUS_REVOKED, EmployeeBadge
from app.modules.drh.badge_routes import _qr_url
from app.modules.drh.models import EmployeeBlacklistEntry
from app.modules.ops.models import DailyPresence
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_pointeur_audit_p0 import POINTEUR, SOC_A, SOC_B, _account, _employee, _headers, _site

SCAN = "/api/portal/attendance-qr/scan"
STUDIO = SimpleNamespace(base_url="https://drh.irongs.com/")          # adresse publique du Studio


def _badge(db, employee, status=STATUS_ACTIVE, valid_until=None, revoked=False):
    badge = EmployeeBadge(employee_id=employee.id, society=employee.society, status=status, snapshot={}, design={},
                          width_mm=85.6, height_mm=54.0, valid_until=valid_until,
                          revoked_at=datetime.utcnow() if revoked else None)
    db.add(badge); db.commit()
    return badge


def _qr(employee, badge):
    """Contenu exact du QR imprimé : adresse produite par le Studio Badges lui-même."""
    return _qr_url(STUDIO, employee, badge.id)


@pytest.fixture
def setup(client, db):
    site = _site(db)
    employee = _employee(db, site=site)
    badge = _badge(db, employee)
    headers = _headers(client, _account(db, modules=("pointeur",), sites=(site,)), POINTEUR)
    return SimpleNamespace(site=site, employee=employee, badge=badge, headers=headers)


def _scan(client, headers, token, site=None, **extra):
    return client.post(SCAN, headers=headers, json={"token": token, "site_id": getattr(site, "id", site), **extra})


def _events(db, employee):
    db.expire_all()
    return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == employee.id)).scalars().all()


def _refused(response, code, message, severity, status_code=None):
    assert response.status_code == (status_code or response.status_code) and response.status_code >= 400, response.text
    assert response.json()["detail"] == {"code": code, "message": message, "severity": severity}
    assert response.headers["X-Attendance-Code"] == code


# 1 · 7 — badge officiel actif, employé actif : pointage enregistré par Attendance Core
def test_valid_studio_badge_records_the_attendance(client, db, setup):
    response = _scan(client, setup.headers, _qr(setup.employee, setup.badge), setup.site)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["success"] is True and body["action"] == "arrivee" and not body.get("duplicate")
    assert [(e.event_type, e.source) for e in _events(db, setup.employee)] == [("ARRIVAL", "QR")]


def test_the_api_variant_of_the_badge_link_is_accepted_too(client, db, setup):
    token = _qr(setup.employee, setup.badge).replace("/public/badge/", "/api/public/badge/")
    assert _scan(client, setup.headers, token, setup.site).status_code == 201


# 2 — expiré
def test_expired_badge_is_refused(client, db, setup):
    badge = _badge(db, setup.employee, valid_until=date.today() - timedelta(days=1))
    _refused(_scan(client, setup.headers, _qr(setup.employee, badge), setup.site), "BADGE_EXPIRED", "QR code expiré", "error", 403)
    assert _events(db, setup.employee) == []


def test_expired_portal_qr_is_reported_as_expired_not_invalid(client, db, setup):
    token = create_access_token(subject=setup.employee.code, ttl_seconds=-5, claims={
        "attendance_qr": True, "employee_id": setup.employee.id, "nonce": uuid.uuid4().hex})
    _refused(_scan(client, setup.headers, token, setup.site), "QR_EXPIRED", "QR code expiré", "error", 400)


# 3 — révoqué
@pytest.mark.parametrize("revoked_at_only", [False, True])
def test_revoked_badge_is_refused(client, db, setup, revoked_at_only):
    badge = _badge(db, setup.employee, status=STATUS_ACTIVE if revoked_at_only else STATUS_REVOKED, revoked=True)
    _refused(_scan(client, setup.headers, _qr(setup.employee, badge), setup.site), "BADGE_REVOKED", "Badge révoqué", "error", 403)
    assert _events(db, setup.employee) == []


# 4 — falsifié
def test_forged_badge_qr_is_never_accepted(client, db, setup):
    other = _employee(db, site=setup.site)
    other_badge = _badge(db, other)
    genuine = _qr(setup.employee, setup.badge)
    signature = genuine.split("t=")[1].split("&")[0]
    forged = [
        genuine.replace(f"t={signature}", "t=" + ("0" * 32)),                                   # signature inventée
        genuine.replace(f"b={setup.badge.id}", f"b={other_badge.id}"),                          # badge d'un autre
        genuine.replace(f"/badge/{setup.employee.id}?", f"/badge/{other.id}?"),                 # employé substitué
        f"https://drh.irongs.com/public/badge/{other.id}?t={signature}&b={setup.badge.id}",
        genuine + f"&b={other_badge.id}",                                                       # paramètre doublé
        genuine.replace(f"t={signature}", "t=" + signature.upper()),
        setup.employee.code,                                                                    # code employé seul (K01…)
        f"{setup.employee.last_name} {setup.employee.first_name}",                              # nom seul
        f"https://drh.irongs.com/public/badge/{setup.employee.code}?b={setup.badge.id}",
        "javascript:alert(1)//public/badge/1?t=x&b=1",
    ]
    for token in forged:
        _refused(_scan(client, setup.headers, token, setup.site), "QR_UNRECOGNIZED", "QR code non reconnu", "error", 400)
    assert _events(db, setup.employee) == [] and _events(db, other) == []


def test_badge_of_a_deleted_employee_link_is_not_recognized(client, db, setup):
    badge = _badge(db, setup.employee)
    token = _qr(setup.employee, badge)
    badge.employee_id = None; db.commit()
    _refused(_scan(client, setup.headers, token, setup.site), "QR_UNRECOGNIZED", "QR code non reconnu", "error", 400)


# 5 — QR historique : lien de consultation sans badge émis, ou badge remplacé
def test_legacy_consultation_link_is_not_a_proof_of_attendance(client, db, setup):
    legacy = _qr_url(STUDIO, setup.employee)                         # signature valide, mais sans b=
    assert "b=" not in legacy
    _refused(_scan(client, setup.headers, legacy, setup.site), "QR_UNRECOGNIZED", "QR code non reconnu", "error", 400)
    assert _events(db, setup.employee) == []


def test_replaced_badge_is_inactive(client, db, setup):
    old = _badge(db, setup.employee, status=STATUS_REPLACED)
    _refused(_scan(client, setup.headers, _qr(setup.employee, old), setup.site), "BADGE_INACTIVE", "Badge inactif", "error", 403)
    assert _scan(client, setup.headers, _qr(setup.employee, setup.badge), setup.site).status_code == 201   # le nouveau


# 6 — QR d'un autre usage
def test_qr_of_another_usage_is_never_a_proof_of_attendance(client, db, setup):
    ref = str(setup.employee.id)
    dotation = f"https://drh.irongs.com/public/dotation/{ref}?t={_public_employee_token('dotation', ref)}"
    dotation_on_badge_path = (f"https://drh.irongs.com/public/badge/{ref}?t={_public_employee_token('dotation', f'{ref}:{setup.badge.id}')}"
                              f"&b={setup.badge.id}")
    session_token = setup.headers["Authorization"].split(" ", 1)[1]
    not_attendance = create_access_token(subject=setup.employee.code, claims={"employee_id": setup.employee.id, "nonce": "n"})
    for token in (dotation, dotation_on_badge_path, session_token, not_attendance):
        _refused(_scan(client, setup.headers, token, setup.site), "QR_UNRECOGNIZED", "QR code non reconnu", "error", 400)
    assert _events(db, setup.employee) == []


def test_public_consultation_still_works_and_records_nothing(client, db, setup):
    page = client.get(_qr(setup.employee, setup.badge).replace("https://drh.irongs.com", ""))
    assert page.status_code == 200 and "Badge actif" in page.text
    revoked = _badge(db, setup.employee, status=STATUS_REVOKED, revoked=True)
    assert "Badge désactivé" in client.get(_qr(setup.employee, revoked).replace("https://drh.irongs.com", "")).text
    assert _events(db, setup.employee) == []


# 8 — employé inactif / badge désactivé sur la fiche / 11 — liste noire
@pytest.mark.parametrize("status", ["inactif", "suspendu", "blackliste", "sortant"])
def test_inactive_employee_is_refused(client, db, setup, status):
    setup.employee.status = status; db.commit()
    _refused(_scan(client, setup.headers, _qr(setup.employee, setup.badge), setup.site), "EMPLOYEE_BLOCKED", "Badge inactif", "error", 403)
    assert _events(db, setup.employee) == []


def test_badge_disabled_on_the_employee_record_is_refused(client, db, setup):
    setup.employee.extra = {"badgeActif": False}; db.commit()
    _refused(_scan(client, setup.headers, _qr(setup.employee, setup.badge), setup.site), "EMPLOYEE_BLOCKED", "Badge inactif", "error", 403)


def test_active_blacklist_entry_blocks_even_if_the_status_was_not_mirrored(client, db, setup):
    db.add(EmployeeBlacklistEntry(employee_id=setup.employee.id, society=SOC_A, reason="Essai fictif", status="active"))
    db.commit()
    _refused(_scan(client, setup.headers, _qr(setup.employee, setup.badge), setup.site), "EMPLOYEE_BLOCKED", "Badge inactif", "error", 403)
    assert _events(db, setup.employee) == []


# 9 — mauvais site / 10 — mauvaise société / 17 — permissions
def test_wrong_site_is_refused(client, db, setup):
    other_site = _site(db)
    stranger = _employee(db, site=other_site)
    stranger_badge = _badge(db, stranger)
    _refused(_scan(client, setup.headers, _qr(stranger, stranger_badge), setup.site),
             "SITE_NOT_ALLOWED", "Employé non autorisé sur ce site", "business", 403)
    admin_headers = _headers(client, _account(db, role="admin", modules=None, societies=(SOC_A,)))
    _refused(_scan(client, admin_headers, _qr(setup.employee, setup.badge), other_site),
             "SITE_NOT_ALLOWED", "Employé non autorisé sur ce site", "business", 409)
    assert _events(db, stranger) == [] and _events(db, setup.employee) == []


def test_wrong_society_reveals_nothing_about_the_badge(client, db, setup):
    site_b = _site(db, SOC_B)
    foreign = _employee(db, SOC_B, site=site_b)
    for badge in (_badge(db, foreign), _badge(db, foreign, status=STATUS_REVOKED, revoked=True)):
        _refused(_scan(client, setup.headers, _qr(foreign, badge)), "SITE_NOT_ALLOWED", "Employé non autorisé sur ce site", "business", 403)
    _refused(_scan(client, setup.headers, _qr(setup.employee, setup.badge), setup.site, society=SOC_B),
             "SITE_NOT_ALLOWED", "Employé non autorisé sur ce site", "business", 403)
    assert _events(db, foreign) == [] and _events(db, setup.employee) == []


def test_insufficient_permissions_are_refused_before_any_badge_check(client, db, setup):
    token = _qr(setup.employee, setup.badge)
    other_module = _headers(client, _account(db, modules=("dc",), sites=(setup.site,)))
    assert _scan(client, other_module, token, setup.site).status_code == 403
    assert client.post(SCAN, json={"token": token}).status_code == 401
    assert _events(db, setup.employee) == []


# 12 — déjà pointé
def test_second_scan_of_the_same_badge_is_already_recorded(client, db, setup):
    token = _qr(setup.employee, setup.badge)
    assert _scan(client, setup.headers, token, setup.site).status_code == 201
    again = _scan(client, setup.headers, token, setup.site)
    assert again.status_code == 201 and again.json()["duplicate"] is True
    assert again.json()["message"] == "Présence déjà enregistrée"
    assert len(_events(db, setup.employee)) == 1


def test_new_arrival_too_soon_after_a_departure_is_already_recorded(client, db, setup, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 0)
    token = _qr(setup.employee, setup.badge)
    assert _scan(client, setup.headers, token, setup.site).json()["action"] == "arrivee"
    assert _scan(client, setup.headers, token, setup.site).json()["action"] == "depart"
    _refused(_scan(client, setup.headers, token, setup.site), "ALREADY_RECORDED", "Présence déjà enregistrée", "business", 409)
    assert len(_events(db, setup.employee)) == 2


# 13 — absent du planning (aucune affectation active)
def test_employee_without_any_assignment_has_no_shift(client, db, auth_headers):
    employee = _employee(db)
    badge = _badge(db, employee)
    _refused(_scan(client, auth_headers, _qr(employee, badge)), "NO_SHIFT", "Aucun service prévu pour cet employé", "business", 409)
    assert _events(db, employee) == []


# 14 — journée clôturée
def test_closed_day_is_never_modified(client, db, setup):
    from app.modules.attendance.core import TZ

    today = datetime.now(TZ).date()
    db.add(DailyPresence(presence_date=today, employee_id=setup.employee.id, site_id=setup.site.id, status="absent",
                         closed_at=datetime.utcnow()))
    db.commit()
    _refused(_scan(client, setup.headers, _qr(setup.employee, setup.badge), setup.site),
             "DAY_CLOSED", "Journée clôturée : pointage refusé", "business", 409)
    db.expire_all()
    presence = db.execute(select(DailyPresence).where(DailyPresence.employee_id == setup.employee.id)).scalar_one()
    assert presence.status == "absent" and presence.arrival_time is None
    assert _events(db, setup.employee) == []


# 16 — erreur d'écriture : jamais un succès
def test_database_failure_never_reports_a_success(db, setup, monkeypatch):
    from fastapi.testclient import TestClient
    from sqlalchemy.exc import OperationalError

    from app.db.session import get_db
    from app.main import app
    from app.modules.irongs import sql_bridge

    def broken(*args, **kwargs):
        raise OperationalError("UPDATE daily_presence", {}, Exception("connexion perdue"))

    monkeypatch.setattr(sql_bridge, "upsert_presence", broken)
    app.dependency_overrides[get_db] = lambda: db
    try:
        response = TestClient(app, raise_server_exceptions=False).post(
            SCAN, headers=setup.headers, json={"token": _qr(setup.employee, setup.badge), "site_id": setup.site.id})
    finally:
        app.dependency_overrides.pop(get_db, None)
    db.rollback()
    assert response.status_code == 500
    assert "success" not in response.text and "ENREGISTR" not in response.text.upper()
    # Absence de toute écriture : vérifiée sur PostgreSQL (SQLite valide un SAVEPOINT ouvert hors transaction).


# 18 — compteurs
def test_counters_follow_the_badge_scan(client, db, setup):
    live = lambda: client.get(f"/api/portal/attendance-live?site_id={setup.site.id}", headers=setup.headers).json()
    before = live()
    assert _scan(client, setup.headers, _qr(setup.employee, setup.badge), setup.site).status_code == 201
    after = live()
    assert after["latest_event_id"] > before["latest_event_id"]
    assert [e["type"] for e in after["events"] if e["id"] > before["latest_event_id"]] == ["ENTREE"]
    assert after["summary"] != before["summary"]


# 19 — aucune fuite de données personnelles ni du contenu du QR
def test_refusals_leak_no_personal_data_and_audit_never_stores_the_qr(client, db, setup, caplog):
    setup.employee.extra = {"groupeSanguin": "O+", "telephone": "0550000000"}
    revoked = _badge(db, setup.employee, status=STATUS_REVOKED, revoked=True)
    db.commit()
    token = _qr(setup.employee, revoked)
    signature = token.split("t=")[1].split("&")[0]
    response = _scan(client, setup.headers, token, setup.site)
    for secret in (setup.employee.code, setup.employee.last_name, "O+", "0550000000", signature):
        assert secret not in response.text
    db.expire_all()
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.qr_scan.refused")
                       .order_by(AuditEvent.id.desc())).scalars().first()
    state = json.loads(audit.new_state) if isinstance(audit.new_state, str) else audit.new_state
    assert audit is not None and state["code"] == "BADGE_REVOKED" and state["badge_id"] == revoked.id
    assert signature not in str(state) and signature not in caplog.text
    success = _scan(client, setup.headers, _qr(setup.employee, setup.badge), setup.site)
    assert success.status_code == 201 and "O+" not in success.text and "groupeSanguin" not in success.text


# 15 · 16 — PostgreSQL : verrou réel de l'employé, transaction réelle
PG_URL = os.getenv("ATTENDANCE_PG_URL")


@pytest.fixture
def pg():
    if not PG_URL:
        pytest.skip("ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.db.base import Base
    from app.modules.auth.models import User
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment, Site

    engine = create_engine(PG_URL, pool_size=8, max_overflow=0)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        site = Site(name=f"PG BADGE {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": SOC_A}); db.add(site); db.flush()
        employee = Employee(code=f"PGB{uuid.uuid4().hex[:6]}", first_name="Fictif", last_name="Badge", society=SOC_A, status="actif")
        db.add(employee); db.flush()
        db.add(Assignment(employee_id=employee.id, site_id=site.id, start_date=date.today() - timedelta(days=3), active=1))
        scanner = User(username=f"pgb{uuid.uuid4().hex[:8]}", full_name="Pointeur fictif", role="admin", access_level="H1",
                       password_hash="x", is_active=True, authorized_societies=[SOC_A])
        db.add(scanner); db.commit()
        badge = _badge(db, employee)
        data = SimpleNamespace(Session=Session, token=_qr(employee, badge), site_id=site.id, employee_id=employee.id, scanner_id=scanner.id)

    def events():
        with Session() as db:
            return [e.event_type for e in db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == data.employee_id)).scalars()]

    def scan():
        from app.modules.portal.routes import scan_employee_attendance_qr

        with Session() as db:
            return scan_employee_attendance_qr({"token": data.token, "site_id": data.site_id}, db, db.get(User, data.scanner_id))

    data.events, data.scan = events, scan
    yield data
    with Session() as db:
        for table in (AttendanceEvent, DailyPresence, EmployeeBadge):
            db.execute(table.__table__.delete().where(table.__table__.c.employee_id == data.employee_id))
        db.commit()
    engine.dispose()


def test_two_simultaneous_badge_scans_record_a_single_arrival_on_postgres(pg):
    barrier, results, failures = threading.Barrier(2), [], []

    def scan():
        barrier.wait()
        try:
            results.append(pg.scan())
        except Exception as exc:  # noqa: BLE001
            failures.append(exc)

    threads = [threading.Thread(target=scan) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert failures == []
    assert sorted(bool(r.get("duplicate")) for r in results) == [False, True]
    assert pg.events() == ["ARRIVAL"]


def test_write_failure_on_postgres_leaves_no_attendance(pg, monkeypatch):
    from sqlalchemy.exc import OperationalError

    from app.modules.irongs import sql_bridge

    def broken(*args, **kwargs):
        raise OperationalError("UPDATE daily_presence", {}, Exception("connexion perdue"))

    monkeypatch.setattr(sql_bridge, "upsert_presence", broken)
    with pytest.raises(OperationalError):
        pg.scan()
    assert pg.events() == []
    monkeypatch.undo()
    assert pg.scan()["success"] is True and pg.events() == ["ARRIVAL"]       # rien n'est resté verrouillé
