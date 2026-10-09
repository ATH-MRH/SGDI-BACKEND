"""Sessions ATLAS MOBILE — concurrence réelle sur PostgreSQL.

SQLite sérialise les écritures : ces tests ne s'exécutent que si ATTENDANCE_PG_URL pointe
vers une base PostgreSQL JETABLE (même convention que les autres tests *_pg_race).
"""
import os
import threading
import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

PG_URL = os.getenv("ATTENDANCE_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ATTENDANCE_PG_URL non défini (base PostgreSQL jetable requise)")

PARALLEL = 12


@pytest.fixture(scope="module")
def Session():
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    engine = create_engine(PG_URL, pool_size=PARALLEL + 2, max_overflow=0)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


@pytest.fixture
def user_id(Session):
    from app.core.security import hash_password
    from app.modules.auth.models import User

    with Session() as db:
        name = f"race{uuid.uuid4().hex[:10]}"
        user = User(username=name, email=f"{name}@race.test", full_name="Race", role="ops", password_hash=hash_password("x" * 12), is_active=True)
        db.add(user)
        db.commit()
        return user.id


def _parallel(worker):
    barrier = threading.Barrier(PARALLEL)
    results, errors = [], []

    def run(index):
        barrier.wait()
        try:
            results.append(worker(index))
        except Exception as exc:  # noqa: BLE001 — le test compte les issues
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(PARALLEL)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results, errors


def test_concurrent_refresh_consumes_the_token_exactly_once(Session, user_id):
    from app.modules.auth import sessions
    from app.modules.auth.models import AuthSession, User

    with Session() as db:
        tokens = sessions.open_session(db, db.get(User, user_id), platform="ios", app_version="1.0.0")
        db.commit()

    def worker(_index):
        with Session() as db:
            new_tokens, _user, _session = sessions.rotate_session(db, tokens["refresh_token"])
            db.commit()
            return new_tokens["refresh_token"]

    results, errors = _parallel(worker)
    assert len(results) == 1, f"{len(results)} renouvellements ont abouti"
    assert len(errors) == PARALLEL - 1 and all(isinstance(error, sessions.SessionError) for error in errors)
    with Session() as db:
        rows = db.execute(select(AuthSession).where(AuthSession.user_id == user_id)).scalars().all()
        assert len(rows) == 1
        # Un seul jeton vivant, celui du gagnant ; quelle que soit l'issue, jamais deux.
        if rows[0].revoked_at is None:
            follow_up, _user, _session = sessions.rotate_session(db, results[0])
            assert follow_up["refresh_token"] != results[0]


def test_concurrent_device_registration_keeps_one_row_per_token(Session, user_id):
    from app.modules.auth.models import User
    from app.modules.mobile import devices
    from app.modules.mobile.models import MobileDevice

    token = f"ExponentPushToken[{uuid.uuid4().hex[:22]}]"

    def worker(_index):
        with Session() as db:
            devices.register_device(db, db.get(User, user_id), None, push_token=token, provider="expo", platform="ios",
                                    environment="staging", app_version="1.0.0")
            db.commit()
            return True

    results, errors = _parallel(worker)
    # Aucun appel n'échoue, et la contrainte unique garantit une seule ligne.
    assert errors == [] and len(results) == PARALLEL
    with Session() as db:
        assert len(db.execute(select(MobileDevice).where(MobileDevice.push_token == token)).scalars().all()) == 1


def test_concurrent_logout_and_refresh_never_leave_a_usable_session(Session, user_id):
    from app.modules.auth import sessions
    from app.modules.auth.models import AuthSession, User

    with Session() as db:
        tokens = sessions.open_session(db, db.get(User, user_id), platform="android", app_version="1.0.0")
        public_id = db.execute(select(AuthSession.public_id).where(AuthSession.user_id == user_id)).scalar_one()
        db.commit()

    def worker(index):
        with Session() as db:
            if index % 2:
                sessions.revoke_session(db, public_id, "logout")
                db.commit()
                return None
            new_tokens, _user, _session = sessions.rotate_session(db, tokens["refresh_token"])
            db.commit()
            return new_tokens["refresh_token"]

    results, _errors = _parallel(worker)
    with Session() as db:
        assert db.execute(select(AuthSession).where(AuthSession.public_id == public_id)).scalar_one().revoked_at is not None
        for refreshed in filter(None, results):
            with pytest.raises(sessions.SessionError):
                sessions.rotate_session(db, refreshed)
