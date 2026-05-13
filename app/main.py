import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from app.api.router import api_router
from app.core.config import settings
from app.db.base import Base
from app.core.security import hash_password
from app.db.session import SessionLocal, engine, safe_database_url
from app.modules.auth.models import User
from app.modules.irongs.models import SgdiRecord
from app.core.photo_storage import UPLOADS_ROOT, ensure_upload_dirs
from app.modules.auth import models as _auth_models  # noqa: F401
from app.modules.drh import models as _drh_models  # noqa: F401
from app.modules.commercial import models as _commercial_models  # noqa: F401
from app.modules.irongs import models as _irongs_models  # noqa: F401
from app.modules import finance_models as _finance_models  # noqa: F401
from app.modules.materiel import models as _materiel_models  # noqa: F401
from app.modules.ops import models as _ops_models  # noqa: F401
from app.modules.irongs import service as irongs_service
from app.modules.drh import service as drh_service


logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("sgdi")
STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title=settings.app_name, debug=settings.app_debug)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_ROOT), check_dir=False), name="uploads")

def ensure_schema_upgrades() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        if "users" in tables:
            columns = {col["name"] for col in inspector.get_columns("users")}
            if "access_level" not in columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN access_level VARCHAR(40)"))
            if "authorized_societies" not in columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN authorized_societies JSON"))
            if "authorized_structures" not in columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN authorized_structures JSON"))
            connection.execute(text("UPDATE users SET authorized_societies = '[]' WHERE authorized_societies IS NULL"))
            connection.execute(text("UPDATE users SET authorized_structures = '[]' WHERE authorized_structures IS NULL"))
        if "suppliers" in tables:
            columns = {col["name"] for col in inspector.get_columns("suppliers")}
            if "society" not in columns:
                connection.execute(text("ALTER TABLE suppliers ADD COLUMN society VARCHAR(150)"))
        if "daily_presence" in tables:
            columns = {col["name"] for col in inspector.get_columns("daily_presence")}
            daily_presence_columns = {
                "rotation_system": "VARCHAR(40)",
                "rotation_group": "VARCHAR(20)",
                "rotation_period": "VARCHAR(20)",
                "faction": "VARCHAR(40)",
                "recovery": "INTEGER DEFAULT 0",
                "standby": "INTEGER DEFAULT 0",
                "data": "JSON",
            }
            for name, sql_type in daily_presence_columns.items():
                if name not in columns:
                    connection.execute(text(f"ALTER TABLE daily_presence ADD COLUMN {name} {sql_type}"))
        if "irongs_collections" in tables and "sgdi_records" in tables:
            existing = connection.execute(text("SELECT COUNT(*) FROM sgdi_records")).scalar() or 0
            if existing == 0:
                rows = connection.execute(text("SELECT name, data FROM irongs_collections")).mappings().all()
                for pos, row in enumerate(rows):
                    collection = row["name"]
                    data = row["data"]
                    if isinstance(data, list):
                        used_ids: set[str] = set()
                        for idx, item in enumerate(data):
                            if isinstance(item, dict):
                                item = dict(item)
                                raw_id = item.get("id")
                                if raw_id in (None, "", "None", "none", "null", "undefined"):
                                    raw_id = f"idx-{idx:06d}"
                                item_id = str(raw_id)
                                if item_id in used_ids:
                                    item_id = f"{item_id}-{idx:06d}"
                                used_ids.add(item_id)
                                item["id"] = item_id
                            else:
                                item_id = f"idx-{idx:06d}"
                                if item_id in used_ids:
                                    item_id = f"{item_id}-{idx:06d}"
                                used_ids.add(item_id)
                            connection.execute(
                                SgdiRecord.__table__.insert().values(
                                    collection=collection,
                                    item_id=item_id,
                                    position=idx,
                                    kind="item",
                                    data=item,
                                    label=str(item.get("nom") or item.get("name") or item.get("code") or "") if isinstance(item, dict) else str(item),
                                )
                            )
                    else:
                        connection.execute(
                            SgdiRecord.__table__.insert().values(
                                collection=collection,
                                item_id="__object__",
                                position=pos,
                                kind="object",
                                data=data,
                                label=collection,
                            )
                        )
            connection.execute(text("DROP TABLE IF EXISTS irongs_collections"))


app.add_middleware(GZipMiddleware, minimum_size=1024)

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
    ensure_upload_dirs()
    Base.metadata.create_all(bind=engine)
    ensure_schema_upgrades()
    logger.info("Tables PostgreSQL vérifiées/créées")
    with SessionLocal() as db:
        irongs_service.cleanup_base64_photos(db)
        cleaned_drh = drh_service.cleanup_base64_photos(db)
        if cleaned_drh:
            logger.info("Photos Base64 nettoyées dans les tables DRH: %s ligne(s)", cleaned_drh)
        admin_username = (settings.admin_initial_username or settings.admin_system_username or "").strip()
        admin = db.query(User).filter(User.username == admin_username).one_or_none() if admin_username else None
        if admin is None and admin_username and settings.admin_initial_password:
            admin = User(
                username=admin_username,
                email=None,
                full_name="Administrateur",
                role="admin",
                access_level="H5",
                authorized_societies=[],
                authorized_structures=[],
                password_hash=hash_password(settings.admin_initial_password),
                is_active=True,
            )
            db.add(admin)
        elif admin is None:
            logger.warning("Compte administrateur absent: définissez ADMIN_INITIAL_USERNAME et ADMIN_INITIAL_PASSWORD pour le créer au démarrage")
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
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache, max-age=0"})


@app.get("/sw.js", include_in_schema=False)
def service_worker() -> FileResponse:
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache, max-age=0", "Service-Worker-Allowed": "/"})


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


app.include_router(api_router, prefix=settings.api_prefix)
