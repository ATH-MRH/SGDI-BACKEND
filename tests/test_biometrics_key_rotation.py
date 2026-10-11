"""Rechiffrement des contenus biométriques après ajout d'une nouvelle clé.

Toutes les clés sont fictives, générées ici. Les tests utilisent une base SQLite
à part : la base de test commune contient des gabarits chiffrés par d'autres modules de test,
chacun avec sa propre clé."""
import json
import logging
import struct
from datetime import datetime, timedelta

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.modules.biometrics import crypto, key_rotation
from app.modules.biometrics.models import BiometricRemoteCaptureSession, BiometricTemplate, Camera

OLD_KEY = Fernet.generate_key().decode()
NEW_KEY = Fernet.generate_key().decode()
OTHER_KEY = Fernet.generate_key().decode()
VECTOR = [0.25, -0.5, 0.125, 1.0]
SECRET = {"username": "cam-user", "password": "cam-secret-fictif"}
PHOTO = b"\xff\xd8photo-fictive\xff\xd9"


def _keys(monkeypatch, active, previous=None):
    monkeypatch.setattr(settings, "biometric_template_key", active)
    monkeypatch.setattr(settings, "biometric_template_key_previous", previous)


@pytest.fixture
def Session(tmp_path):
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'rotation.db'}")
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False, future=True)
    engine.dispose()


def _template(db, token):
    row = BiometricTemplate(employee_id=1, status="ACTIVE", embedding_encrypted=token, engine="fake", config_version=1,
                            source="EMPLOYEE_PHOTO")
    db.add(row); db.flush()
    return row.id


def _camera(db, token, name="Cam fictive"):
    row = Camera(name=name, manufacturer="X", model="Y", adapter="dahua", society="TEST", site_id=1,
                 host="cam.example.test", credentials_encrypted=token)
    db.add(row); db.flush()
    return row.id


def _capture(db, token, tag):
    now = datetime.now()
    row = BiometricRemoteCaptureSession(public_id=f"cap-{tag}", employee_id=1, terminal_id=1, status="PREVIEW_READY",
                                        photo_encrypted=token, expires_at=now + timedelta(minutes=2), command_at=now)
    db.add(row); db.flush()
    return row.id


def _seed_old(monkeypatch, Session, templates=5):
    """Lot fictif chiffré avec l'ancienne clé, plus des lignes sans contenu chiffré."""
    _keys(monkeypatch, OLD_KEY)
    with Session() as db:
        ids = {"templates": [_template(db, crypto.encrypt_vector([float(i), 0.5])) for i in range(templates)],
               "camera": _camera(db, crypto.encrypt_secret(SECRET)),
               "camera_without_secret": _camera(db, None, "Cam sans identifiants"),
               "capture": _capture(db, crypto.encrypt_bytes(PHOTO), "old"),
               "closed_capture": _capture(db, None, "closed")}
        db.commit()
    return ids


def _tokens(Session):
    with Session() as db:
        return {("t", r.id): bytes(r.embedding_encrypted) for r in db.execute(select(BiometricTemplate)).scalars()} | \
               {("c", r.id): r.credentials_encrypted for r in db.execute(select(Camera)).scalars()} | \
               {("p", r.id): r.photo_encrypted for r in db.execute(select(BiometricRemoteCaptureSession)).scalars()}


def test_dry_run_counts_without_writing(monkeypatch, Session):
    _seed_old(monkeypatch, Session)
    before = _tokens(Session)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)

    report = key_rotation.run(Session, log=lambda _: None)

    assert report["mode"] == "dry-run"
    assert report["targets"]["biometric_templates"] == {"column": "embedding_encrypted", "current": 0, "pending": 5,
                                                         "rotated": 0, "unreadable": 0, "unreadable_ids": []}
    assert report["targets"]["cameras"]["pending"] == 1
    assert report["targets"]["biometric_remote_capture_sessions"]["pending"] == 1
    assert report["exit_code"] == key_rotation.EXIT_PENDING and not report["safe_to_remove_previous_key"]
    assert _tokens(Session) == before


def test_apply_reencrypts_everything_then_new_key_alone_reads_it(monkeypatch, Session):
    ids = _seed_old(monkeypatch, Session)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)

    applied = key_rotation.run(Session, apply=True, batch_size=2, log=lambda _: None)
    assert applied["totals"] == {"current": 0, "pending": 0, "rotated": 7, "unreadable": 0}
    assert not applied["safe_to_remove_previous_key"]          # à confirmer par une relecture

    verified = key_rotation.run(Session, log=lambda _: None)
    assert verified["totals"] == {"current": 7, "pending": 0, "rotated": 0, "unreadable": 0}
    assert verified["safe_to_remove_previous_key"] and verified["exit_code"] == key_rotation.EXIT_OK

    _keys(monkeypatch, NEW_KEY)                                 # ancienne clé retirée
    with Session() as db:
        vectors = [crypto.decrypt_vector(db.get(BiometricTemplate, i).embedding_encrypted) for i in ids["templates"]]
        assert vectors == [[float(i), 0.5] for i in range(5)]
        assert crypto.decrypt_secret(db.get(Camera, ids["camera"]).credentials_encrypted) == SECRET
        assert crypto.decrypt_bytes(db.get(BiometricRemoteCaptureSession, ids["capture"]).photo_encrypted) == PHOTO
        assert db.get(Camera, ids["camera_without_secret"]).credentials_encrypted is None
        assert db.get(BiometricRemoteCaptureSession, ids["closed_capture"]).photo_encrypted is None
    assert key_rotation.run(Session, log=lambda _: None)["exit_code"] == key_rotation.EXIT_OK


def test_apply_is_idempotent(monkeypatch, Session):
    _seed_old(monkeypatch, Session)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    key_rotation.run(Session, apply=True, log=lambda _: None)
    after_first = _tokens(Session)

    second = key_rotation.run(Session, apply=True, log=lambda _: None)

    assert second["totals"]["rotated"] == 0 and second["totals"]["current"] == 7
    assert _tokens(Session) == after_first                      # aucune ligne retouchée


def test_interrupted_apply_leaves_every_row_readable_and_can_resume(monkeypatch, Session):
    _seed_old(monkeypatch, Session)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    real, calls = crypto.reencrypt, {"n": 0}

    def failing(token):
        calls["n"] += 1
        if calls["n"] == 4:
            raise KeyboardInterrupt
        return real(token)

    monkeypatch.setattr(crypto, "reencrypt", failing)
    with pytest.raises(KeyboardInterrupt):
        key_rotation.run(Session, apply=True, batch_size=2, log=lambda _: None)
    monkeypatch.setattr(crypto, "reencrypt", real)

    partial = key_rotation.run(Session, log=lambda _: None)
    assert partial["totals"]["unreadable"] == 0
    assert partial["totals"]["current"] == 2 and partial["totals"]["pending"] == 5   # lot interrompu annulé en entier

    key_rotation.run(Session, apply=True, batch_size=2, log=lambda _: None)
    assert key_rotation.run(Session, log=lambda _: None)["safe_to_remove_previous_key"]


def test_row_written_with_the_old_key_after_the_pass_blocks_the_removal(monkeypatch, Session):
    _seed_old(monkeypatch, Session, templates=2)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    key_rotation.run(Session, apply=True, log=lambda _: None)
    with Session() as db:                                       # instance retardataire, ancienne clé seule
        late = _template(db, Fernet(OLD_KEY.encode()).encrypt(struct.pack("<2f", 9.0, 9.0)))
        db.commit()

    check = key_rotation.run(Session, log=lambda _: None)
    assert check["exit_code"] == key_rotation.EXIT_PENDING and not check["safe_to_remove_previous_key"]

    key_rotation.run(Session, apply=True, log=lambda _: None)
    assert key_rotation.run(Session, log=lambda _: None)["safe_to_remove_previous_key"]
    _keys(monkeypatch, NEW_KEY)
    with Session() as db:
        assert crypto.decrypt_vector(db.get(BiometricTemplate, late).embedding_encrypted) == [9.0, 9.0]


def test_unreadable_row_is_reported_by_id_and_left_untouched(monkeypatch, Session):
    _seed_old(monkeypatch, Session, templates=2)
    _keys(monkeypatch, OTHER_KEY)
    with Session() as db:
        foreign = _template(db, crypto.encrypt_vector(VECTOR))
        db.commit()
    before = _tokens(Session)[("t", foreign)]
    _keys(monkeypatch, NEW_KEY, OLD_KEY)

    report = key_rotation.run(Session, apply=True, log=lambda _: None)

    assert report["exit_code"] == key_rotation.EXIT_UNREADABLE and not report["safe_to_remove_previous_key"]
    assert report["targets"]["biometric_templates"]["unreadable_ids"] == [foreign]
    assert report["targets"]["biometric_templates"]["rotated"] == 2
    assert _tokens(Session)[("t", foreign)] == before


def test_missing_or_invalid_key_stops_before_reading_any_row(monkeypatch, Session):
    _seed_old(monkeypatch, Session, templates=1)
    before = _tokens(Session)
    for active, previous in (("", OLD_KEY), (NEW_KEY, "invalide")):
        _keys(monkeypatch, active, previous)
        with pytest.raises(HTTPException) as refused:
            key_rotation.run(Session, apply=True, log=lambda _: None)
        assert refused.value.status_code == 503
    assert _tokens(Session) == before


def test_apply_records_an_audit_event_with_counters_only(monkeypatch, Session):
    from app.modules.auth.models import AuditEvent

    _seed_old(monkeypatch, Session, templates=3)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    key_rotation.run(Session, apply=True, log=lambda _: None)
    with Session() as db:
        event = db.execute(select(AuditEvent).where(AuditEvent.action == "biometrics.key_rotation")).scalar_one()
        stored = json.dumps(event.new_state).replace("\\", "")   # résumé d'audit : JSON dans une chaîne
    assert '"biometric_templates": 3' in stored
    assert NEW_KEY not in stored and OLD_KEY not in stored


# ── Script et confidentialité ────────────────────────────────────────────────────────────
@pytest.fixture
def script(monkeypatch, Session):
    import app.db.session as db_session
    from scripts import rotate_biometric_key

    monkeypatch.setattr(db_session, "engine", Session.kw["bind"])
    monkeypatch.setattr(db_session, "SessionLocal", Session)
    return rotate_biometric_key.main


def test_script_refuses_to_write_without_the_exact_database_name(monkeypatch, Session, script, capsys):
    _seed_old(monkeypatch, Session, templates=2)
    before = _tokens(Session)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)

    assert script(["--apply"]) == 3
    assert script(["--apply", "--confirm-database", "sgdi"]) == 3
    assert _tokens(Session) == before
    assert "REFUS" in capsys.readouterr().err


def test_script_refuses_to_write_without_a_previous_key(monkeypatch, Session, script):
    _seed_old(monkeypatch, Session, templates=1)
    database = Session.kw["bind"].url.database
    assert script(["--apply", "--confirm-database", database]) == 3


def test_script_full_cycle_and_report_never_leak_keys_or_content(monkeypatch, Session, script, capsys, caplog, tmp_path):
    _seed_old(monkeypatch, Session, templates=3)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    database, report_path = Session.kw["bind"].url.database, tmp_path / "rapport.json"
    caplog.set_level(logging.DEBUG)

    assert script([]) == 1                                                        # simulation : du travail reste
    assert script(["--apply", "--confirm-database", database]) == 0
    assert script(["--report", str(report_path)]) == 0                            # vérification
    _keys(monkeypatch, NEW_KEY)
    assert script([]) == 0                                                        # nouvelle clé seule

    captured = capsys.readouterr()
    everything = captured.out + captured.err + caplog.text + report_path.read_text()
    assert "VÉRIFIÉ" in captured.out
    for secret in (OLD_KEY, NEW_KEY, SECRET["password"], PHOTO.decode("latin-1")):
        assert secret not in everything
    report = json.loads(report_path.read_text())
    assert report["safe_to_remove_previous_key"] is True and report["totals"]["current"] == 5
    assert set(report) == {"mode", "active_key_id", "previous_key_id", "targets", "totals",
                           "safe_to_remove_previous_key", "exit_code", "database"}


def test_script_reports_rows_that_no_configured_key_can_read(monkeypatch, Session, script, capsys):
    ids = _seed_old(monkeypatch, Session, templates=2)
    _keys(monkeypatch, NEW_KEY)                                                   # ancienne clé retirée trop tôt

    assert script([]) == 2
    out = capsys.readouterr().out
    assert str(ids["templates"]) in out and "NE PAS retirer" in out
