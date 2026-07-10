import os
import tempfile

_tmp_uploads = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///./test_sgdi.db"
os.environ["JWT_SECRET"] = "test-secret-key-sgdi-testing-1234567890"
os.environ["ADMIN_SYSTEM_PASSWORD"] = "test-admin-password"
os.environ["ADMIN_SYSTEM_USERNAME"] = "testadmin"
os.environ["ADMIN_INITIAL_USERNAME"] = "testadmin"
os.environ["ADMIN_INITIAL_PASSWORD"] = "testpass123"
os.environ["APP_ENV"] = "test"
os.environ["LOG_LEVEL"] = "ERROR"
os.environ["SGDI_UPLOADS_DIR"] = _tmp_uploads

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
get_settings.cache_clear()

import app.db.session as _db_session
from app.db.base import Base

TEST_DB_URL = "sqlite:///./test_sgdi.db"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})

@event.listens_for(test_engine, "connect")
def set_sqlite_pragma(dbapi_conn, _):
    dbapi_conn.execute("PRAGMA foreign_keys=ON")
    # Concurrence réelle : au lieu d'échouer immédiatement sur "database is locked",
    # SQLite attend qu'un autre writer libère le verrou (jusqu'à 30 s). Indispensable
    # pour les tests de concurrence (plusieurs threads qui écrivent en même temps).
    dbapi_conn.execute("PRAGMA busy_timeout=30000")

TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

_db_session.engine = test_engine
_db_session.SessionLocal = TestSessionLocal

from app.main import app
from app.db.session import get_db
from app.core.security import hash_password, create_access_token
from app.modules.auth.models import User


@pytest.fixture(scope="session", autouse=True)
def create_tables():
    Base.metadata.create_all(bind=test_engine)
    _seed_admin()
    yield
    import os as _os
    Base.metadata.drop_all(bind=test_engine)
    if _os.path.exists("./test_sgdi.db"):
        _os.remove("./test_sgdi.db")


def _seed_admin():
    session = TestSessionLocal()
    try:
        if not session.query(User).filter(User.username == "testadmin").first():
            session.add(User(
                username="testadmin",
                email="admin@test.com",
                full_name="Test Admin",
                role="admin",
                access_level="H5",
                authorized_societies=[],
                authorized_structures=[],
                password_hash=hash_password("testpass123"),
                is_active=True,
            ))
            session.commit()
    finally:
        session.close()


@pytest.fixture
def db():
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers(client):
    resp = client.post("/api/auth/login", json={"username": "testadmin", "password": "testpass123"})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def society():
    return "TEST_SOC"


# ── Concurrence réelle (sans mock) ───────────────────────────────────────────
# Client qui N'override PAS get_db : chaque requête HTTP obtient sa PROPRE session
# (comme en production). Indispensable pour tester plusieurs threads qui écrivent
# en même temps. Portée module pour ne lancer le lifespan qu'une fois.
@pytest.fixture(scope="module")
def live_client():
    app.dependency_overrides.pop(get_db, None)
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(scope="module")
def live_headers(live_client):
    resp = live_client.post("/api/auth/login", json={"username": "testadmin", "password": "testpass123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}
