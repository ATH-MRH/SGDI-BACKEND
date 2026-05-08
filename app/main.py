import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from app.api.router import api_router
from app.core.config import settings
from app.db.base import Base
from app.core.security import hash_password
from app.db.session import SessionLocal, engine, safe_database_url
from app.modules.auth.models import User
from app.modules.auth import models as _auth_models  # noqa: F401
from app.modules.drh import models as _drh_models  # noqa: F401
from app.modules.irongs import models as _irongs_models  # noqa: F401
from app.modules.materiel import models as _materiel_models  # noqa: F401
from app.modules.ops import models as _ops_models  # noqa: F401


logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("sgdi")
STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title=settings.app_name, debug=settings.app_debug)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    logger.info("Démarrage %s en mode %s", settings.app_name, settings.app_env)
    logger.info("Base de données: %s", safe_database_url())
    Base.metadata.create_all(bind=engine)
    logger.info("Tables PostgreSQL vérifiées/créées")
    with SessionLocal() as db:
        admin = db.query(User).filter(User.username == "admin").one_or_none()
        if admin is None:
            admin = User(
                username="admin",
                email=None,
                full_name="Administrateur",
                role="admin",
                password_hash=hash_password("admin"),
                is_active=True,
            )
            db.add(admin)
        db.commit()
    logger.info("Compte administrateur vérifié")


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true", "app": settings.app_name}


@app.get("/health/db")
def database_health() -> dict:
    with engine.connect() as connection:
        tables = sorted(inspect(connection).get_table_names())
        migration = None
        if "alembic_version" in tables:
            migration = connection.execute(text("select version_num from alembic_version")).scalar()
        return {
            "ok": True,
            "database": connection.execute(text("select current_database()")).scalar(),
            "user": connection.execute(text("select current_user")).scalar(),
            "url": safe_database_url(),
            "migration": migration,
            "tables_count": len(tables),
            "tables": tables,
        }


@app.get("/", include_in_schema=False)
def frontend() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


app.include_router(api_router, prefix=settings.api_prefix)
