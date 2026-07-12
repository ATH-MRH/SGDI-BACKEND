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
# pool_size/max_overflow par défaut (5+10=15 par worker) sont vite saturés : un seul
# chargement de page tire déjà 6-10 requêtes API en parallèle, chacune ouvrant une
# connexion. Sous charge concurrente, les requêtes en attente d'une connexion libre
# se traduisaient par des pics de lenteur simultanés sur des endpoints sans rapport
# (ex: /api/irongs/positions et /api/ops/sites bloqués ~10s exactement en même temps).
engine_kwargs = {"future": True, "pool_pre_ping": True}
if database_url.startswith("postgresql"):
    engine_kwargs["connect_args"] = {"connect_timeout": 5}
    engine_kwargs["pool_size"] = 15
    engine_kwargs["max_overflow"] = 25
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
