from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.base import Base


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


database_url = normalize_database_url(settings.database_url)
engine_kwargs = {"future": True, "pool_pre_ping": True}
if database_url.startswith("postgresql"):
    engine_kwargs["connect_args"] = {"connect_timeout": 5}
engine = create_engine(database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def safe_database_url() -> str:
    return make_url(database_url).render_as_string(hide_password=True)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
