"""Plusieurs équipements faciaux au même instant — courses réelles sur PostgreSQL JETABLE.

SQLite sérialise les écritures : ces tests ne s'exécutent que si ATTENDANCE_PG_URL pointe vers
une base PostgreSQL jetable (jamais la production), par exemple :
    ATTENDANCE_PG_URL=postgresql+psycopg2://user@/atlas_race?host=/tmp pytest tests/test_pointeur_multi_facial_pg_race.py
"""
import os
import threading
import uuid
from datetime import date

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")

ROUNDS = 4          # essais simultanés par équipement


@pytest.fixture(scope="module")
def Session():
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(PG_URL, pool_size=20, max_overflow=0)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


@pytest.fixture(autouse=True)
def facial(monkeypatch):
    from app.core.config import settings
    from app.modules.biometrics import engine as engine_module
    from tests.test_biometrics import TEST_KEY
    from tests.test_biometrics_test_mode import FakePngEngine

    monkeypatch.setattr(settings, "biometric_enabled", True)
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    monkeypatch.setattr(settings, "attendance_min_event_gap_seconds", 300)      # anti-rebond de production
    engine_module.set_engine(FakePngEngine())
    yield
    engine_module.set_engine(None)


def _world(Session, cameras=2):
    """Site, employé enrôlé (consentement admissible), `cameras` caméras de pointage, une borne
    associée, un administrateur global et un compte Pointeur du site."""
    from app.modules.auth.models import User
    from app.modules.biometrics import crypto, service
    from app.modules.biometrics.models import BiometricConsent, BiometricTemplate, BiometricTerminal, Camera
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment, Site
    from tests.biometric_fakes import _vector

    tag = uuid.uuid4().hex[:8]
    with Session() as db:
        site = Site(name=f"Multi {tag}", active=1, equipment_plan={"societe": "RACE"})
        admin = User(username=f"A{tag}", full_name="Race admin", role="ADMIN", password_hash="unused", is_active=True,
                     global_society_access=True)
        db.add_all([site, admin]); db.flush()
        pointer = User(username=f"P{tag}", full_name="Race pointeur", role="pointeur", password_hash="unused", is_active=True,
                       authorized_modules=["pointeur"], authorized_actions=["read", "create"], authorized_societies=["RACE"],
                       authorized_sites=[site.id])
        emp = Employee(code=f"RACE{tag}", first_name="R", last_name="C", society="RACE", status="actif")
        db.add_all([pointer, emp]); db.flush()
        db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
        consent = BiometricConsent(employee_id=emp.id, status="contract_confirmed", source="EMPLOYMENT_CONTRACT",
                                   proof_reference="Contrat", notice_version=service.NOTICE_VERSION)
        db.add(consent); db.flush()
        who = f"W-{tag}"
        db.add(BiometricTemplate(employee_id=emp.id, status="ACTIVE", embedding_encrypted=crypto.encrypt_vector(_vector(who, 0.0, 0)),
                                 engine="fake", config_version=1, source="CAMERA", quality={}, consent_id=consent.id,
                                 society="RACE", site_id=site.id))
        cams = [Camera(name=f"CAM-{i}-{tag}", manufacturer="DAHUA", model="Race", adapter="DAHUA", society="RACE", site_id=site.id, host="10.0.0.20", channel=1,
                       usage="ATTENDANCE", role="ENTRY", active=True, facial_attendance_enabled=True) for i in range(cameras)]
        term = BiometricTerminal(public_id=f"trm_{tag}", name=f"TAB-{tag}", terminal_type="TABLET_ANDROID", society="RACE",
                                 site_id=site.id, enabled=True, facial_attendance_enabled=True, public_key={"kty": "EC"},
                                 config_version=1, meta={})
        db.add_all(cams + [term]); db.commit()
        service.active_config(db); db.commit()                    # configuration créée AVANT la course
        return {"employee": emp.id, "who": who, "site": site.id, "cameras": [c.id for c in cams], "terminal": term.id,
                "admin": admin.id, "pointer": pointer.id}


def _frames(who):
    from tests.biometric_fakes import face, frame
    from tests.test_biometrics_test_mode import png

    return [png(frame(face(who))) for _ in range(3)]


def _camera_call(camera_id, who, burst_id):
    def call(db):
        from app.modules.auth.models import User
        from app.modules.biometrics import service
        from app.modules.biometrics.models import Camera

        camera = db.get(Camera, camera_id)
        return service.recognize_and_record(db, camera=camera, frames=_frames(who), burst_id=burst_id,
                                            actor=db.execute(select(User).limit(1)).scalar_one())
    return call


def _kiosk_call(terminal_id, who, challenge):
    def call(db):
        from app.modules.biometrics import service
        from app.modules.biometrics.engine import get_engine
        from app.modules.biometrics.models import BiometricTerminal
        from app.modules.biometrics.terminals import TerminalActor

        term = db.get(BiometricTerminal, terminal_id)
        cfg = service.active_config(db)
        decision = service.analyze_frames(get_engine(), _frames(who), cfg, require_liveness=True)
        source = service.FacialSource(label=f"terminal {term.name}", key=f"T{term.id}", site_id=term.site_id, society=term.society,
                                      details={"terminal_id": term.id}, idempotency_key=f"term{term.id}-ch{challenge}", device_id=None,
                                      society_scoped=True, extra={"terminal": term.public_id, "terminal_name": term.name})
        return service.match_and_record(db, source=source, decision=decision, cfg=cfg, actor=TerminalActor(term))
    return call


def _race(Session, calls):
    barrier = threading.Barrier(len(calls))
    results, errors = [], []

    def worker(call):
        with Session() as db:
            barrier.wait()
            try:
                results.append(call(db))
                db.commit()
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                errors.append(exc)

    threads = [threading.Thread(target=worker, args=(call,)) for call in calls]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results, errors


def _events(Session, employee_id):
    from app.modules.attendance.models import AttendanceEvent
    with Session() as db:
        return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == employee_id).order_by(AttendanceEvent.id)).scalars().all()


def _presences(Session, employee_id):
    from app.modules.ops.models import DailyPresence
    with Session() as db:
        return db.scalar(select(func.count(DailyPresence.id)).where(DailyPresence.employee_id == employee_id))


def test_same_person_seen_by_several_devices_at_once_is_clocked_exactly_once(Session):
    """Deux caméras + une borne reconnaissent le même employé au même instant (clés d'idempotence
    toutes différentes) : un seul mouvement, une seule journée — jamais ENTRÉE puis SORTIE."""
    w = _world(Session)
    run = uuid.uuid4().hex
    calls = [_camera_call(cam, w["who"], f"{run}-{cam}-{i}") for cam in w["cameras"] for i in range(ROUNDS)] \
        + [_kiosk_call(w["terminal"], w["who"], f"{run}-{i}") for i in range(ROUNDS)]
    results, errors = _race(Session, calls)
    assert not errors, errors
    events = _events(Session, w["employee"])
    assert [(e.event_type, e.source) for e in events] == [("ARRIVAL", "FACIAL")]
    assert sorted(r["state"] for r in results) == ["ALREADY_RECORDED"] * (len(calls) - 1) + ["ATTENDANCE_RECORDED"]
    assert sum(1 for r in results if r["recorded"]) == 1 and _presences(Session, w["employee"]) == 1
    # Nouvelle salve juste après : toujours rien de plus.
    results, errors = _race(Session, [_camera_call(cam, w["who"], f"{run}-again-{cam}") for cam in w["cameras"]])
    assert not errors and {r["state"] for r in results} == {"ALREADY_RECORDED"} and len(_events(Session, w["employee"])) == 1


def test_parallel_retries_of_the_same_attempt_are_idempotent(Session):
    """Reprise réseau : le même essai (même caméra, même identifiant) rejoué en parallèle."""
    w = _world(Session, cameras=1)
    burst_id = uuid.uuid4().hex
    results, errors = _race(Session, [_camera_call(w["cameras"][0], w["who"], burst_id) for _ in range(10)])
    assert not errors, errors
    events = _events(Session, w["employee"])
    assert len(events) == 1 and events[0].idempotency_key == f"cam{w['cameras'][0]}-{burst_id}"
    assert sum(1 for r in results if r["recorded"]) == 1


def test_two_people_on_two_devices_at_once_are_both_clocked(Session):
    """L'anti-doublon est PAR employé : deux personnes différentes ne se bloquent pas."""
    first, second = _world(Session, cameras=1), _world(Session, cameras=1)
    run = uuid.uuid4().hex
    results, errors = _race(Session, [_camera_call(first["cameras"][0], first["who"], f"{run}-a"),
                                      _camera_call(second["cameras"][0], second["who"], f"{run}-b")])
    assert not errors, errors
    assert [r["state"] for r in results] == ["ATTENDANCE_RECORDED"] * 2
    assert len(_events(Session, first["employee"])) == len(_events(Session, second["employee"])) == 1


def test_parallel_authorization_writes_never_duplicate_a_grant(Session):
    """Deux administrateurs enregistrent la même autorisation au même instant : une seule ligne."""
    from app.modules.auth.models import User
    from app.modules.biometrics.models import FacialDeviceAuthorization
    from app.modules.biometrics.pointer_devices import AuthorizationsIn, set_authorizations

    w = _world(Session, cameras=1)
    key = f"cam:{w['cameras'][0]}"

    def grant(db):
        return set_authorizations(AuthorizationsIn(key=key, user_ids=[w["pointer"]]), db, db.get(User, w["admin"]))

    results, errors = _race(Session, [grant for _ in range(8)])
    assert not errors and len(results) == 8, errors                 # sérialisés par le verrou de l'équipement
    assert all([u["id"] for u in r["users"]] == [w["pointer"]] for r in results)
    with Session() as db:
        assert db.scalar(select(func.count(FacialDeviceAuthorization.id)).where(
            FacialDeviceAuthorization.camera_id == w["cameras"][0], FacialDeviceAuthorization.user_id == w["pointer"])) == 1


def test_revocation_racing_with_an_activation_never_leaves_a_revoked_terminal_usable(Session):
    """Révocation et contrôle de sélection simultanés : après la course, le terminal est refusé."""
    from app.modules.auth.models import User
    from app.modules.biometrics.pointer_devices import AuthorizationsIn, SelectionIn, activate_terminals, pointer_terminals, set_authorizations
    from app.modules.biometrics.routes import RevokeIn, revoke_terminal

    w = _world(Session, cameras=1)
    key = f"trm:{w['terminal']}"
    with Session() as db:
        set_authorizations(AuthorizationsIn(key=key, user_ids=[w["pointer"]]), db, db.get(User, w["admin"]))

    def revoke(db):
        return revoke_terminal(w["terminal"], RevokeIn(reason="Tablette perdue"), db, db.get(User, w["admin"]))

    def activate(db):
        return activate_terminals(SelectionIn(keys=[key]), db, db.get(User, w["pointer"]))

    results, errors = _race(Session, [revoke] + [activate for _ in range(6)])
    assert not errors, errors
    with Session() as db:
        pointer = db.get(User, w["pointer"])
        after = activate_terminals(SelectionIn(keys=[key]), db, pointer)["results"][0]
        assert (after["status"], after["code"]) == ("REFUSED", "REVOKED")
        assert pointer_terminals(None, None, db, pointer)["terminals"] == []
