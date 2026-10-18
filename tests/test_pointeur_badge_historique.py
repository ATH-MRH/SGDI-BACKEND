"""Badges historiques (imprimés par l'écran de badge d'ATLAS, avant le Studio Badges) scannés au
Pointeur. Leur QR est le lien public signé `/public/badge/<réf>?t=<signature>` SANS `b=`.

Le QR est produit par la route réellement utilisée par cet écran (`/api/public-links/employee`),
puis validé par le mécanisme officiel. La possession du lien ne suffit jamais : compte Pointeur,
périmètre, désactivation du badge, remplacement par un badge Studio, statut, liste noire,
affectation et règles d'Attendance Core s'appliquent. Données fictives uniquement."""
import os
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

import app.main as main
from app.main import _public_employee_token
from app.modules.attendance.models import AttendanceEvent
from app.modules.drh.badge_models import STATUS_REVOKED
from app.modules.drh.models import EmployeeBlacklistEntry
from app.modules.ops.models import DailyPresence
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_pointeur_audit_p0 import POINTEUR, SOC_A, SOC_B, _account, _employee, _headers, _site
from tests.test_pointeur_badge_qr import _badge, _events, _refused, _scan


def _historical_qr(client, auth_headers, employee, ref=None):
    """Contenu exact du QR imprimé par l'écran de badge historique."""
    r = client.get(f"/api/public-links/employee/{ref or employee.id}", headers=auth_headers)
    assert r.status_code == 200, r.text
    link = r.json()["badge_page"]
    assert "b=" not in link and "?t=" in link
    return link


@pytest.fixture
def setup(client, db, auth_headers):
    site = _site(db)
    employee = _employee(db, site=site)
    headers = _headers(client, _account(db, modules=("pointeur",), sites=(site,)), POINTEUR)
    return SimpleNamespace(site=site, employee=employee, headers=headers, qr=_historical_qr(client, auth_headers, employee))


def test_historical_badge_records_the_presence_and_shows_the_employee(client, db, setup):
    setup.employee.extra = {"photo": "/uploads/photos/fictif.jpg", "groupeSanguin": "AB-"}; db.commit()
    started = time.perf_counter()
    r = _scan(client, setup.headers, setup.qr, setup.site)
    elapsed = time.perf_counter() - started
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["success"] is True and body["action"] == "arrivee" and body["heure"]
    card = body["employee"]
    assert (card["matricule"], card["nom"], card["prenom"]) == (setup.employee.code, setup.employee.last_name, setup.employee.first_name)
    assert body["site"] == setup.site.name
    assert "AB-" not in r.text and "groupeSanguin" not in r.text, "groupe sanguin jamais renvoyé"
    assert [(e.event_type, e.source) for e in _events(db, setup.employee)] == [("ARRIVAL", "QR")]
    assert elapsed < 1.0, f"résultat en {elapsed:.3f} s"


def test_historical_badge_never_scans_every_employee_record(client, db, setup, monkeypatch):
    """Référence numérique (tous les badges imprimés par ATLAS) : lecture directe, sans relire les
    fiches de tout le personnel (≈ 300 ms en production)."""
    def forbidden(ref):
        raise AssertionError("résolution lente appelée")
    monkeypatch.setattr(main, "_public_employee_badge_data", forbidden)
    assert _scan(client, setup.headers, setup.qr, setup.site).status_code == 201


def test_historical_badge_with_a_matricule_reference_uses_the_official_resolution(client, db, setup, auth_headers):
    qr = _historical_qr(client, auth_headers, setup.employee, ref=setup.employee.code)
    assert f"/public/badge/{setup.employee.code}?" in qr
    assert _scan(client, setup.headers, qr, setup.site).status_code == 201


def test_forged_or_foreign_historical_qr_is_refused(client, db, setup, auth_headers):
    other = _employee(db, site=setup.site)
    signature = setup.qr.split("t=")[1]
    forged = [
        setup.qr.replace(signature, "0" * 32),
        setup.qr.replace(f"/badge/{setup.employee.id}?", f"/badge/{other.id}?"),             # signature d'un autre employé
        f"https://drh.irongs.com/public/badge/{setup.employee.id}?t={_public_employee_token('dotation', str(setup.employee.id))}",
        f"https://drh.irongs.com/public/badge/{setup.employee.id}",                             # sans signature
        f"https://drh.irongs.com/public/badge/{setup.employee.code}",                           # matricule seul
        f"https://drh.irongs.com/public/badge/999999999?t={_public_employee_token('badge', '999999999')}",   # inconnu, bien signé
    ]
    for token in forged:
        _refused(_scan(client, setup.headers, token, setup.site), "QR_UNRECOGNIZED", "QR code non reconnu", "error", 400)
    assert _events(db, setup.employee) == [] and _events(db, other) == []


def test_historical_badge_disabled_on_the_record_is_refused(client, db, setup):
    setup.employee.extra = {"badgeActif": False}; db.commit()
    _refused(_scan(client, setup.headers, setup.qr, setup.site), "BADGE_INACTIVE", "Badge inactif", "error", 403)
    assert _events(db, setup.employee) == []


@pytest.mark.parametrize("status", [None, STATUS_REVOKED])
def test_historical_badge_is_replaced_by_any_studio_badge(client, db, setup, status):
    _badge(db, setup.employee, **({"status": status, "revoked": True} if status else {}))
    _refused(_scan(client, setup.headers, setup.qr, setup.site), "BADGE_REPLACED", "Badge remplacé — présentez le badge actuel", "error", 403)
    assert _events(db, setup.employee) == []


@pytest.mark.parametrize("status", ["inactif", "suspendu", "sortant"])
def test_inactive_employee_with_a_historical_badge_is_refused(client, db, setup, status):
    setup.employee.status = status; db.commit()
    _refused(_scan(client, setup.headers, setup.qr, setup.site), "EMPLOYEE_BLOCKED", "Employé inactif", "error", 403)


def test_blacklisted_employee_with_a_historical_badge_is_refused(client, db, setup):
    db.add(EmployeeBlacklistEntry(employee_id=setup.employee.id, society=SOC_A, reason="Essai fictif", status="active")); db.commit()
    _refused(_scan(client, setup.headers, setup.qr, setup.site), "EMPLOYEE_BLOCKED", "Employé inactif", "error", 403)
    assert _events(db, setup.employee) == []


def test_wrong_society_or_site_reveals_nothing(client, db, setup, auth_headers):
    site_b = _site(db, SOC_B)
    foreign = _employee(db, SOC_B, site=site_b)
    _badge(db, foreign)                                            # même remplacé, rien n'est révélé hors périmètre
    _refused(_scan(client, setup.headers, _historical_qr(client, auth_headers, foreign)), "SITE_NOT_ALLOWED",
             "Employé non autorisé sur ce site", "business", 403)
    elsewhere = _employee(db, site=_site(db))
    _refused(_scan(client, setup.headers, _historical_qr(client, auth_headers, elsewhere), setup.site), "SITE_NOT_ALLOWED",
             "Employé non autorisé sur ce site", "business", 403)
    assert _events(db, foreign) == [] and _events(db, elsewhere) == []


def test_permissions_are_required(client, db, setup):
    other_module = _headers(client, _account(db, modules=("dc",), sites=(setup.site,)))
    assert _scan(client, other_module, setup.qr, setup.site).status_code == 403
    assert client.post("/api/portal/attendance-qr/scan", json={"token": setup.qr}).status_code == 401
    assert _events(db, setup.employee) == []


def test_repeated_scans_record_one_presence(client, db, setup):
    first = _scan(client, setup.headers, setup.qr, setup.site)
    assert first.status_code == 201 and not first.json().get("duplicate")
    for _ in range(3):
        again = _scan(client, setup.headers, setup.qr, setup.site)
        assert again.status_code == 201 and again.json()["duplicate"] is True and again.json()["message"] == "Présence déjà enregistrée"
    assert len(_events(db, setup.employee)) == 1


def test_no_shift_and_closed_day(client, db, auth_headers):
    lonely = _employee(db)
    _refused(_scan(client, auth_headers, _historical_qr(client, auth_headers, lonely)), "NO_SHIFT", "Aucun service prévu pour cet employé", "business", 409)
    site = _site(db)
    closed = _employee(db, site=site)
    from app.modules.attendance.core import TZ
    db.add(DailyPresence(presence_date=datetime.now(TZ).date(), employee_id=closed.id, site_id=site.id, status="absent", closed_at=datetime.utcnow()))
    db.commit()
    _refused(_scan(client, auth_headers, _historical_qr(client, auth_headers, closed), site), "DAY_CLOSED", "Journée clôturée : pointage refusé", "business", 409)
    assert _events(db, lonely) == [] and _events(db, closed) == []


def test_ops_and_drh_see_the_same_presence(client, db, setup, auth_headers):
    assert _scan(client, setup.headers, setup.qr, setup.site).status_code == 201
    from app.modules.attendance.core import TZ
    db.expire_all()
    presence = db.execute(select(DailyPresence).where(DailyPresence.employee_id == setup.employee.id,
                                                      DailyPresence.presence_date == datetime.now(TZ).date())).scalar_one()
    assert presence.arrival_time and presence.site_id == setup.site.id
    live = client.get(f"/api/portal/attendance-live?site_id={setup.site.id}", headers=setup.headers).json()
    assert any(e["type"] == "ENTREE" and e["employee"].get("matricule") == setup.employee.code for e in live["events"])


# ── PostgreSQL : scans simultanés, refus d'écriture ─────────────────────────────────────────
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
    from app.modules.portal.routes import scan_employee_attendance_qr

    engine = create_engine(PG_URL, pool_size=8, max_overflow=0)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        site = Site(name=f"PG HIST {uuid.uuid4().hex[:6]}", active=1, equipment_plan={"societe": SOC_A}); db.add(site); db.flush()
        employee = Employee(code=f"PGH{uuid.uuid4().hex[:6]}", first_name="Fictif", last_name="Historique", society=SOC_A, status="actif")
        db.add(employee); db.flush()
        db.add(Assignment(employee_id=employee.id, site_id=site.id, start_date=date.today() - timedelta(days=3), active=1))
        scanner = User(username=f"pgh{uuid.uuid4().hex[:8]}", full_name="Pointeur fictif", role="admin", access_level="H1",
                       password_hash="x", is_active=True, authorized_societies=[SOC_A], global_society_access=True)
        db.add(scanner); db.commit()
        ref = str(employee.id)
        data = SimpleNamespace(Session=Session, site_id=site.id, employee_id=employee.id, scanner_id=scanner.id,
                               token=f"https://drh.irongs.com/public/badge/{ref}?t={_public_employee_token('badge', ref)}")

    def scan():
        with Session() as db:
            return scan_employee_attendance_qr({"token": data.token, "site_id": data.site_id}, db, db.get(User, data.scanner_id))

    def events():
        with Session() as db:
            return [e.event_type for e in db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == data.employee_id)).scalars()]

    data.scan, data.events = scan, events
    yield data
    with Session() as db:
        for table in (AttendanceEvent, DailyPresence):
            db.execute(table.__table__.delete().where(table.__table__.c.employee_id == data.employee_id))
        db.commit()
    engine.dispose()


def test_simultaneous_scans_of_a_historical_badge_on_postgres(pg):
    barrier, results, failures = threading.Barrier(3), [], []

    def run():
        barrier.wait()
        try:
            results.append(pg.scan())
        except Exception as exc:  # noqa: BLE001
            failures.append(exc)

    threads = [threading.Thread(target=run) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert failures == []
    assert sorted(bool(r.get("duplicate")) for r in results) == [False, True, True]
    assert pg.events() == ["ARRIVAL"]


def test_write_failure_on_postgres_never_records_a_historical_scan(pg, monkeypatch):
    from sqlalchemy.exc import OperationalError

    from app.modules.irongs import sql_bridge

    def broken(*args, **kwargs):
        raise OperationalError("UPDATE daily_presence", {}, Exception("connexion perdue"))

    monkeypatch.setattr(sql_bridge, "upsert_presence", broken)
    with pytest.raises(OperationalError):
        pg.scan()
    assert pg.events() == []
