"""Rechiffrement de la clé biométrique sur PostgreSQL réel (verrous de ligne, transactions).

Exécuté uniquement si ATTENDANCE_PG_URL pointe vers une base PostgreSQL JETABLE (même
convention que tests/test_attendance_core_pg_race.py). Clés et gabarits fictifs. La base
peut contenir des gabarits d'autres tests, chiffrés avec d'autres clés : les contrôles
portent sur les lignes créées ici."""
import os
import threading
import uuid

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")

OLD_KEY = Fernet.generate_key().decode()
NEW_KEY = Fernet.generate_key().decode()


@pytest.fixture(scope="module")
def Session():
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(PG_URL, pool_size=6, max_overflow=0)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False, future=True)
    engine.dispose()


def _keys(monkeypatch, active, previous=None):
    from app.core.config import settings

    monkeypatch.setattr(settings, "biometric_template_key", active)
    monkeypatch.setattr(settings, "biometric_template_key_previous", previous)


def _seed(monkeypatch, Session, count):
    from app.modules.biometrics import crypto
    from app.modules.biometrics.models import BiometricTemplate
    from app.modules.drh.models import Employee

    _keys(monkeypatch, OLD_KEY)
    with Session() as db:
        emp = Employee(code=f"KR{uuid.uuid4().hex[:8]}", first_name="K", last_name="R", society="PGKEYROT", status="actif")
        db.add(emp); db.flush()
        rows = [BiometricTemplate(employee_id=emp.id, status="ACTIVE", embedding_encrypted=crypto.encrypt_vector([float(i), 1.5]),
                                  engine="fake", config_version=1, source="EMPLOYEE_PHOTO") for i in range(count)]
        db.add_all(rows); db.commit()
        return [r.id for r in rows]


def _vectors(Session, ids):
    from app.modules.biometrics import crypto
    from app.modules.biometrics.models import BiometricTemplate

    with Session() as db:
        return [crypto.decrypt_vector(db.get(BiometricTemplate, i).embedding_encrypted) for i in ids]


def test_rotation_on_postgres_keeps_every_fictive_template_readable(monkeypatch, Session):
    from app.modules.biometrics import key_rotation

    ids = _seed(monkeypatch, Session, 7)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)

    dry = key_rotation.run(Session, batch_size=3, log=lambda _: None)
    assert dry["targets"]["biometric_templates"]["pending"] >= 7
    applied = key_rotation.run(Session, apply=True, batch_size=3, log=lambda _: None)
    assert applied["targets"]["biometric_templates"]["rotated"] >= 7
    again = key_rotation.run(Session, apply=True, batch_size=3, log=lambda _: None)
    assert again["targets"]["biometric_templates"]["rotated"] == 0 and again["totals"]["pending"] == 0
    assert not set(ids) & set(again["targets"]["biometric_templates"]["unreadable_ids"])

    _keys(monkeypatch, NEW_KEY)                                  # ancienne clé retirée
    assert _vectors(Session, ids) == [[float(i), 1.5] for i in range(7)]


def test_rotation_waits_for_a_concurrent_writer_and_loses_nothing(monkeypatch, Session):
    """Une requête applicative modifie un gabarit pendant la passe : la passe attend le verrou,
    puis rechiffre la ligne sans écraser la modification."""
    from app.modules.biometrics import key_rotation
    from app.modules.biometrics.models import BiometricTemplate

    ids = _seed(monkeypatch, Session, 2)
    _keys(monkeypatch, NEW_KEY, OLD_KEY)
    result = {}

    with Session() as writer:
        row = writer.get(BiometricTemplate, ids[0], with_for_update=True)
        row.status = "INACTIVE"
        writer.flush()
        worker = threading.Thread(target=lambda: result.update(key_rotation.run(Session, apply=True, log=lambda _: None)))
        worker.start()
        worker.join(timeout=1.5)
        assert worker.is_alive(), "la passe aurait dû attendre le verrou de ligne"
        writer.commit()
    worker.join(timeout=30)
    assert not worker.is_alive() and result["targets"]["biometric_templates"]["rotated"] >= 2

    _keys(monkeypatch, NEW_KEY)
    assert _vectors(Session, ids) == [[0.0, 1.5], [1.0, 1.5]]
    with Session() as db:
        assert db.get(BiometricTemplate, ids[0]).status == "INACTIVE"
