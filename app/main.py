import hashlib
import logging
import asyncio
import html
import json
import socket
from pathlib import Path
from urllib.parse import quote

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, inspect, select, text

from app.api.router import api_router
from app.core.config import settings
from app.db.base import Base
from app.core.security import decode_token, hash_password
from app.db.session import SessionLocal, engine, safe_database_url
from app.modules.auth.models import User
from app.modules.auth.service import get_user
from app.modules.auth.dependencies import current_user
from app.modules.irongs.models import SgdiRecord
from app.core.photo_storage import UPLOADS_ROOT, ensure_upload_dirs
from app.modules.auth import models as _auth_models  # noqa: F401
from app.modules.drh import models as _drh_models  # noqa: F401
from app.modules.drh import email_alerts as _drh_email_alerts  # noqa: F401
from app.modules.commercial import models as _commercial_models  # noqa: F401
from app.modules.irongs import models as _irongs_models  # noqa: F401
from app.modules import finance_models as _finance_models  # noqa: F401
from app.modules.materiel import models as _materiel_models  # noqa: F401
from app.modules.ops import models as _ops_models  # noqa: F401
from app.modules.irongs import service as irongs_service
from app.modules.drh import service as drh_service
from app.modules.drh.email_alerts import start_contract_email_alert_scheduler, stop_contract_email_alert_scheduler
from app.modules.accounting import models as _accounting_models  # noqa: F401
from app.modules.achats import models as _achats_models  # noqa: F401
from app.modules.ventes import models as _ventes_models  # noqa: F401
from app.modules.ronde import models as _ronde_models  # noqa: F401


logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("sgdi")
STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title=settings.app_name, debug=settings.app_debug)

_NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}

@app.get("/static/sgdi-app.js", include_in_schema=False)
def serve_sgdi_app_js():
    return FileResponse(STATIC_DIR / "sgdi-app.js", media_type="application/javascript", headers=_NO_CACHE)

@app.get("/static/sgdi-app.css", include_in_schema=False)
def serve_sgdi_app_css():
    return FileResponse(STATIC_DIR / "sgdi-app.css", media_type="text/css", headers=_NO_CACHE)

@app.get("/static/index.html", include_in_schema=False)
def serve_index_html_static():
    return FileResponse(STATIC_DIR / "index.html", headers=_NO_CACHE)

@app.get("/api/version", include_in_schema=False)
def app_version():
    js_file = STATIC_DIR / "sgdi-app.js"
    try:
        h = hashlib.md5(js_file.read_bytes()).hexdigest()[:12]
    except Exception:
        h = "unknown"
    return {"version": h}

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_ROOT), check_dir=False), name="uploads")

_COLLECTION_KEEP_LAST: dict[str, int] = {"activityLog": 200, "notificationLog": 200}

def _purge_oversized_collections() -> None:
    from app.modules.irongs.models import SgdiRecord
    from sqlalchemy import func
    with SessionLocal() as db:
        for collection, keep in _COLLECTION_KEEP_LAST.items():
            try:
                total = db.execute(
                    select(func.count()).where(SgdiRecord.collection == collection, SgdiRecord.kind == "item")
                ).scalar() or 0
                if total > keep:
                    cutoff_id = db.execute(
                        select(SgdiRecord.id)
                        .where(SgdiRecord.collection == collection, SgdiRecord.kind == "item")
                        .order_by(SgdiRecord.id.desc())
                        .offset(keep)
                        .limit(1)
                    ).scalar()
                    if cutoff_id:
                        deleted = db.execute(
                            delete(SgdiRecord).where(SgdiRecord.collection == collection, SgdiRecord.id <= cutoff_id)
                        ).rowcount
                        db.commit()
                        logger.info("Purge %s : %d entrées supprimées (gardé les %d dernières)", collection, deleted, keep)
            except Exception as e:
                db.rollback()
                logger.warning("Purge %s échouée: %s", collection, e)

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
        if "stores" in tables:
            columns = {col["name"] for col in inspector.get_columns("stores")}
            if "config" not in columns:
                connection.execute(text("ALTER TABLE stores ADD COLUMN config JSON"))
        if "positions" in tables:
            columns = {col["name"] for col in inspector.get_columns("positions")}
            if "society" not in columns:
                connection.execute(text("ALTER TABLE positions ADD COLUMN society VARCHAR(150)"))
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
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StaticCacheMiddleware:
    """Ajoute Cache-Control long terme sur les fichiers statiques versionnés."""

    _NO_CACHE_PATHS = {"/static/sw.js", "/static/index.html", "/static/manifest.webmanifest"}

    def __init__(self, app):
        self._app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self._app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        cacheable = (
            path.startswith("/static/")
            and path not in self._NO_CACHE_PATHS
            and not path.endswith(".html")
        )

        if not cacheable:
            await self._app(scope, receive, send)
            return

        async def patched_send(message):
            if message["type"] == "http.response.start":
                headers = [
                    (k, v) for k, v in message.get("headers", [])
                    if k.lower() != b"cache-control"
                ]
                headers.append((b"cache-control", b"public, max-age=31536000, immutable"))
                message = {**message, "headers": headers}
            await send(message)

        await self._app(scope, receive, patched_send)


app.add_middleware(StaticCacheMiddleware)


def _fix_societe_name() -> None:
    """Corrige 'IRON GLOBAL SECURITE' → 'IRON GLOBAL SÉCURITÉ' dans toute la base."""
    OLD = "IRON GLOBAL SECURITE"
    NEW = "IRON GLOBAL SÉCURITÉ"
    fixed = 0
    try:
        with SessionLocal() as db:
            # Tables avec colonne society (texte simple)
            for table, col in [
                ("employees", "society"), ("candidates", "society"),
                ("sites", None),           # society dans equipment_plan JSON
                ("stock_articles", "society"), ("stores", "society"),
                ("suppliers", "society"), ("clients", "society"),
                ("invoices", "society"), ("payments", "society"),
                ("advances", "society"), ("credit_notes", "society"),
                ("cash_entries", "society"),
                ("comptes_comptables", "society"), ("ecritures_comptables", "society"),
                ("fournisseurs", "society"),
                ("bons_commande_achat", "society"), ("receptions_marchandise", "society"),
                ("factures_fournisseur", "society"),
                ("devis", "society"), ("commandes_client", "society"),
                ("bons_livraison", "society"),
            ]:
                if col is None:
                    continue
                try:
                    r = db.execute(
                        text(f"UPDATE {table} SET {col}=:new WHERE {col}=:old"),
                        {"old": OLD, "new": NEW},
                    )
                    fixed += r.rowcount
                except Exception:
                    pass

            # Table users : authorized_societies est un JSON array
            users = db.execute(text("SELECT id, authorized_societies FROM users")).fetchall()
            for row in users:
                socs = row[1]
                if not isinstance(socs, list):
                    continue
                if OLD in socs:
                    updated = [NEW if s == OLD else s for s in socs]
                    db.execute(
                        text("UPDATE users SET authorized_societies=:s WHERE id=:id"),
                        {"s": json.dumps(updated), "id": row[0]},
                    )
                    fixed += 1

            # SgdiRecord : chercher dans le champ data (JSON)
            records = db.execute(
                text("SELECT id, collection, data FROM sgdi_records")
            ).fetchall()
            for rec in records:
                raw = rec[2]
                if raw is None:
                    continue
                text_repr = json.dumps(raw, ensure_ascii=False)
                if OLD in text_repr:
                    fixed_data = json.loads(text_repr.replace(OLD, NEW))
                    db.execute(
                        text("UPDATE sgdi_records SET data=:d WHERE id=:id"),
                        {"d": json.dumps(fixed_data, ensure_ascii=False), "id": rec[0]},
                    )
                    fixed += 1

            db.commit()
        if fixed:
            logger.info("Correction société : %d enregistrement(s) mis à jour (%s → %s)", fixed, OLD, NEW)
    except Exception as exc:
        logger.warning("Correction société échouée (non bloquante) : %s", exc)


@app.on_event("startup")
def on_startup() -> None:
    logger.info("Démarrage %s en mode %s", settings.app_name, settings.app_env)
    logger.info("Base de données: %s", safe_database_url())
    ensure_upload_dirs()
    Base.metadata.create_all(bind=engine)
    ensure_schema_upgrades()
    _fix_societe_name()
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
        # Compte module FACTURATION
        fac_user = db.query(User).filter(User.username == "fac01").one_or_none()
        if fac_user is None:
            fac_user = User(
                username="fac01",
                email=None,
                full_name="Facturation",
                role="facmod",
                access_level="H1",
                authorized_societies=[],
                authorized_structures=["facmod"],
                password_hash=hash_password("fac01"),
                is_active=True,
            )
            db.add(fac_user)
            logger.info("Compte fac01 créé")
        db.commit()
    logger.info("Compte administrateur vérifié")
    _purge_oversized_collections()
    start_contract_email_alert_scheduler()


@app.on_event("shutdown")
def on_shutdown() -> None:
    stop_contract_email_alert_scheduler()


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true", "app": settings.app_name}


def _local_ipv4_addresses() -> list[str]:
    addresses: list[str] = []
    candidates: set[str] = set()
    try:
        candidates.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            candidates.add(sock.getsockname()[0])
    except OSError:
        pass
    for ip in sorted(candidates):
        if ip and not ip.startswith(("127.", "169.254.")) and ip != "0.0.0.0":
            addresses.append(ip)
    return addresses


def _portal_mobile_urls(request: Request) -> list[str]:
    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    host = request.headers.get("host", "").split(":")[0].lower()
    port = request.url.port
    port_part = f":{port}" if port and port not in (80, 443) else ""
    urls: list[str] = []
    if host in ("portail-rh.irongs.com", "drh.irongs.com"):
        urls.append("https://portail-rh.irongs.com")
    else:
        urls.append(str(request.url_for("portal_rh_mobile")))
    for ip in _local_ipv4_addresses():
        urls.append(f"{scheme}://{ip}{port_part}/portail-rh")
    return list(dict.fromkeys(urls))


@app.get("/portail-sw.js", include_in_schema=False)
def portal_sw() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "portail-sw.js",
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache, max-age=0"},
    )


@app.get("/portail-manifest.webmanifest", include_in_schema=False)
def portal_manifest() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "portail-manifest.webmanifest",
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache, max-age=0"},
    )


@app.get("/portail-rh", include_in_schema=False, name="portal_rh_mobile")
def portal_rh_mobile() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "portail-rh-bilingue.html",
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-cache, max-age=0"},
    )


@app.get("/portail-rh/acces", include_in_schema=False)
def portal_rh_access(request: Request) -> HTMLResponse:
    urls = _portal_mobile_urls(request)
    primary = urls[0]
    options = "\n".join(
        f'<button type="button" data-url="{html.escape(url, quote=True)}">{html.escape(url)}</button>'
        for url in urls
    )
    content = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Accès mobile Portail RH</title>
<script src="/static/qrcode.min.js"></script>
<style>
body{{margin:0;min-height:100vh;font-family:Arial,Helvetica,sans-serif;background:#eef4fb;color:#0f172a;display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box}}
main{{width:min(560px,100%);background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:24px;box-shadow:0 18px 48px rgba(15,23,42,.12)}}
h1{{margin:0 0 8px;font-size:26px;color:#043970}}p{{margin:0 0 18px;color:#475569;line-height:1.5}}.qr{{width:210px;height:210px;margin:18px auto;padding:10px;border:1px solid #dbe3ef;background:#fff;display:flex;align-items:center;justify-content:center}}
.links{{display:grid;gap:10px;margin-top:18px}}button,a{{font:inherit}}button{{border:1px solid #cbd5e1;background:#f8fafc;color:#043970;border-radius:10px;padding:12px;text-align:left;font-weight:700;cursor:pointer;word-break:break-all}}button.active{{border-color:#1e40af;background:#dbeafe}}.open{{display:block;text-align:center;text-decoration:none;background:#1e40af;color:#fff;border-radius:12px;padding:13px 16px;font-weight:800;margin-top:14px}}.hint{{font-size:13px;color:#64748b;margin-top:14px}}
</style></head><body><main>
<h1>Portail RH mobile</h1>
<p>Scannez le QR code avec le téléphone connecté au même réseau Wi-Fi que le serveur SGDI. Les demandes et réclamations seront reçues dans SGDI via <b>/api/portal/demandes</b>.</p>
<div id="qr" class="qr"></div>
<a id="openLink" class="open" href="{html.escape(primary, quote=True)}">Ouvrir le portail</a>
<div class="links">{options}</div>
<p class="hint">Si le QR généré avec localhost ne s'ouvre pas sur mobile, choisissez l'adresse IP locale du Mac.</p>
</main><script>
const qrEl = document.getElementById('qr');
const openLink = document.getElementById('openLink');
function renderQR(url) {{
  qrEl.innerHTML = '';
  openLink.href = url;
  if (window.QRCode) new QRCode(qrEl, {{ text: url, width: 190, height: 190 }});
  else qrEl.textContent = url;
  document.querySelectorAll('button[data-url]').forEach(btn => btn.classList.toggle('active', btn.dataset.url === url));
}}
document.querySelectorAll('button[data-url]').forEach(btn => btn.addEventListener('click', () => renderQR(btn.dataset.url)));
renderQR({json.dumps(primary)});
</script></body></html>"""
    return HTMLResponse(content, headers={"Cache-Control": "no-cache, max-age=0"})


@app.get("/health/db")
def database_health(user: User = Depends(current_user)) -> dict:
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


def _public_employee_badge_data(employee_ref: str) -> dict:
    ref = str(employee_ref or "").strip()
    if not ref:
        raise HTTPException(status_code=404, detail="Badge introuvable")
    with SessionLocal() as db:
        rows = db.execute(text("SELECT id, code, first_name, last_name, phone, position, society, status, extra FROM employees")).mappings().all()
    found = None
    for row in rows:
        extra = row["extra"] if isinstance(row["extra"], dict) else {}
        legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
        candidates = {
            str(row["id"]),
            str(row["code"] or ""),
            str(extra.get("id") or ""),
            str(extra.get("matricule") or ""),
            str(legacy.get("id") or ""),
            str(legacy.get("matricule") or ""),
        }
        if ref in candidates:
            found = (row, extra, legacy)
            break
    if not found:
        raise HTTPException(status_code=404, detail="Badge introuvable")
    row, extra, legacy = found
    data = {**legacy, **extra}
    return {
        "id": str(data.get("id") or row["id"]),
        "backendId": row["id"],
        "matricule": data.get("matricule") or row["code"] or str(row["id"]),
        "nom": data.get("nom") or row["last_name"] or "",
        "prenom": data.get("prenom") or row["first_name"] or "",
        "societe": data.get("societe") or row["society"] or "",
        "statut": data.get("statut") or row["status"] or "",
        "telephone": data.get("telephone") or row["phone"] or "",
        "fonction": data.get("fonction") or row["position"] or "",
        "photo": data.get("photo") or "",
        "groupeSanguin": data.get("groupeSanguin") or data.get("groupe_sanguin") or "",
        "badgeActif": data.get("badgeActif") is not False,
        "affectationCourante": data.get("affectationCourante") if isinstance(data.get("affectationCourante"), dict) else {},
    }


@app.get("/api/public/badge/{employee_ref}", include_in_schema=False)
def public_employee_badge(employee_ref: str) -> dict:
    return _public_employee_badge_data(employee_ref)


@app.get("/public/badge/{employee_ref}", include_in_schema=False)
def public_employee_badge_page(employee_ref: str, request: Request) -> HTMLResponse:
    data = _public_employee_badge_data(employee_ref)
    raw_nom = str(data.get("nom") or "").strip()
    raw_prenom = str(data.get("prenom") or "").strip()
    name = html.escape(" ".join([raw_nom, raw_prenom]).strip())
    nom = html.escape(raw_nom or "—")
    prenom = html.escape(raw_prenom or "—")
    matricule = html.escape(str(data.get("matricule") or "—"))
    society = html.escape(str(data.get("societe") or ""))
    aff = data.get("affectationCourante") if isinstance(data.get("affectationCourante"), dict) else {}
    fonction = html.escape(str(aff.get("poste") or data.get("fonction") or "—"))
    groupe_sanguin = html.escape(str(data.get("groupeSanguin") or "—"))
    badge_active = data.get("badgeActif") is not False
    badge_label = "Badge actif" if badge_active else "Badge désactivé"
    state_class = "active" if badge_active else "inactive"
    photo = str(data.get("photo") or "")
    photo_html = f'<img src="{html.escape(photo, quote=True)}" alt="Photo">' if photo.startswith(("data:image/", "/uploads/")) else "PHOTO"
    qr_src = "https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=1&data=" + quote(str(request.url), safe="")
    content = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Badge {matricule}</title>
<style>
body{{margin:0;min-height:100vh;font-family:Arial,Helvetica,sans-serif;background:#eef4fb;color:#043970;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}}
.phone-badge{{width:min(435px,100%);min-height:calc(100vh - 24px);background:#fff;border:1.5px solid #2476bd;border-radius:28px;box-sizing:border-box;padding:18px 22px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:18px}}
.ok{{display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;text-transform:uppercase;border-radius:999px;padding:8px 18px;line-height:1}}
.ok.active{{color:#16751a;background:#d9ffc8;border:1.5px solid #83dc55}}
.ok.inactive{{color:#991b1b;background:#fee2e2;border:1.5px solid #f87171}}
.photo{{width:100%;height:min(46vh,328px);border:1.5px solid #2476bd;border-radius:22px;background:#fff;display:flex;align-items:center;justify-content:center;color:#16751a;font-size:22px;font-weight:900;overflow:hidden;box-sizing:border-box}}
.photo img{{width:100%;height:100%;object-fit:cover;display:block}}
.identity{{margin-top:0;color:#043970;font-weight:900;line-height:1.08;text-align:center}}
.identity h1{{margin:0;font-size:30px;line-height:1.08;text-transform:capitalize}}
	.identity .code{{margin-top:2px;font-size:30px;line-height:1.05}}.identity .function{{margin-top:6px;font-size:23px;line-height:1.05;color:#043970}}.identity .blood{{margin-top:5px;font-size:22px;line-height:1.05;color:#0f172a}}
.qr{{width:150px;height:150px;border:1px solid #dbe3ef;background:#fff;display:flex;align-items:center;justify-content:center;padding:4px;box-sizing:border-box}}
.qr img{{width:100%;height:100%;display:block}}
@media(max-width:380px){{.phone-badge{{padding:16px 16px 18px;gap:14px;border-radius:24px}}.photo{{height:min(43vh,288px)}}.identity h1,.identity .code{{font-size:25px}}.qr{{width:132px;height:132px}}}}
</style></head>
<body><main class="phone-badge"><div class="ok {state_class}">{badge_label}</div>
<div class="photo">{photo_html}</div>
	<section class="identity"><h1>{name or (nom + " " + prenom)}</h1><div class="code">Code : {matricule}</div><div class="function">Fonction : {fonction}</div><div class="blood">Groupe sanguin : {groupe_sanguin}</div></section>
<div class="qr"><img src="{html.escape(qr_src, quote=True)}" alt="QR pointage"></div></main></body></html>"""
    return HTMLResponse(content, headers={"Cache-Control": "no-cache, max-age=0"})


@app.get("/public/dotation/{employee_ref}", include_in_schema=False)
def public_employee_dotation_page(employee_ref: str, request: Request) -> HTMLResponse:
    ref = str(employee_ref or "").strip()
    if not ref:
        raise HTTPException(status_code=404, detail="Employé introuvable")

    with SessionLocal() as db:
        emp_rows = db.execute(text(
            "SELECT id, code, first_name, last_name, society, extra FROM employees"
        )).mappings().all()

    found = None
    for row in emp_rows:
        extra = row["extra"] if isinstance(row["extra"], dict) else {}
        legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
        data = {**legacy, **extra}
        candidates = {
            str(row["id"]),
            str(row["code"] or ""),
            str(data.get("id") or ""),
            str(data.get("matricule") or ""),
        }
        if ref in candidates:
            found = (row, data)
            break

    if not found:
        raise HTTPException(status_code=404, detail="Employé introuvable")

    emp_row, emp_data = found
    emp_id = int(emp_row["id"])

    DOT_TYPES = "('nouvelle_dotation','renouvellement_dotation','dotation_pret_mission','sortie')"
    with SessionLocal() as db:
        mvts = db.execute(text(f"""
            SELECT m.id, m.movement_date, m.quantity, m.item_state,
                   m.voucher_number, m.size_breakdown,
                   a.designation, a.unit, a.model as article_model, a.id as article_id
            FROM stock_movements m
            LEFT JOIN stock_articles a ON a.id = m.article_id
            WHERE m.employee_id = :emp_id
              AND m.movement_type IN {DOT_TYPES}
            ORDER BY m.movement_date DESC
        """), {"emp_id": emp_id}).mappings().all()

        rets = db.execute(text("""
            SELECT article_id, COALESCE(SUM(quantity),0) AS total
            FROM stock_movements
            WHERE employee_id = :emp_id
              AND movement_type IN ('retour','retour_employe','retour_employe_sortie')
            GROUP BY article_id
        """), {"emp_id": emp_id}).mappings().all()

    returned_by_article: dict[int, float] = {int(r["article_id"]): float(r["total"] or 0) for r in rets}

    def fmt_date(d: str) -> str:
        if not d:
            return "—"
        s = str(d)[:10]
        parts = s.split("-")
        if len(parts) == 3:
            return f"{parts[2]}/{parts[1]}/{parts[0]}"
        return s

    rows_html = ""
    for i, m in enumerate(mvts):
        sb = m["size_breakdown"] if isinstance(m["size_breakdown"], dict) else {}
        raw = sb.get("raw", {}) if isinstance(sb, dict) else {}
        etat = str(m["item_state"] or raw.get("etatArticle") or "—")
        rep = sb.get("repartitionTailles", {}) if isinstance(sb, dict) else {}
        detail = " / ".join(f"{k}: {v}" for k, v in rep.items()) if rep else (raw.get("taille") or raw.get("pointure") or "—")
        modele = str(m.get("article_model") or raw.get("modele") or "")
        date_str = fmt_date(str(m["movement_date"] or "")[:10])
        designation = html.escape(str(m["designation"] or "Article supprimé"))
        modele_html = f"<br><small style='color:#64748b'>{html.escape(modele)}</small>" if modele else ""
        art_id = int(m["article_id"]) if m["article_id"] else 0
        row_qty = max(0.0, float(m["quantity"] or 0) - returned_by_article.get(art_id, 0))
        unit = html.escape(str(m["unit"] or ""))
        bon = html.escape(str(m["voucher_number"] or "—"))
        rows_html += (
            f"<tr><td style='text-align:center'>{i+1}</td><td>{html.escape(date_str)}</td>"
            f"<td><b>{designation}</b>{modele_html}</td>"
            f"<td style='text-align:center'>{html.escape(etat)}</td>"
            f"<td>{html.escape(str(detail))}</td>"
            f"<td style='text-align:right'>{row_qty:g}&nbsp;{unit}</td>"
            f"<td style='font-size:10px;font-family:monospace'>{bon}</td></tr>"
        )

    if not rows_html:
        rows_html = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:16px;font-style:italic">Aucune dotation active enregistrée.</td></tr>'

    nom = html.escape(str(emp_data.get("nom") or emp_row["last_name"] or ""))
    prenom = html.escape(str(emp_data.get("prenom") or emp_row["first_name"] or ""))
    matricule = html.escape(str(emp_data.get("matricule") or emp_row["code"] or str(emp_id)))
    societe = html.escape(str(emp_data.get("societe") or emp_row["society"] or ""))
    date_rec = fmt_date(str(emp_data.get("dateRecrutement") or ""))

    latest_bon = str(mvts[0]["voucher_number"] or "").strip() if mvts else ""
    latest_date = fmt_date(str(mvts[0]["movement_date"] or "")[:10]) if mvts else ""
    ref_box_html = ""
    if latest_bon:
        ref_box_html = (
            f'<div class="doc-ref-box">'
            f'<div class="doc-ref-num">{html.escape(latest_bon)}</div>'
            f'<div class="doc-ref-date">{html.escape(latest_date)}</div>'
            f'</div>'
        )

    content = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fiche dotation — {matricule}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111827;padding:12px}}
.wrap{{max-width:760px;margin:0 auto}}
.doc-head{{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:10px;margin-bottom:12px;gap:8px}}
.doc-brand{{display:flex;align-items:center;gap:10px;flex:1;min-width:0}}
.doc-logo{{width:48px;height:48px;object-fit:contain;flex-shrink:0}}
.doc-title{{font-size:17px;font-weight:900;line-height:1.2}}
.doc-sub{{font-size:11px;color:#64748b;margin-top:3px}}
.doc-ref-box{{border:1.5px solid #111827;padding:6px 10px;text-align:center;min-width:110px;flex-shrink:0}}
.doc-ref-num{{font-size:12px;font-weight:800;font-family:monospace;word-break:break-all}}
.doc-ref-date{{font-size:11px;margin-top:2px;color:#475569}}
table{{width:100%;border-collapse:collapse}}
.it td{{border:1px solid #cbd5e1;padding:7px 8px;font-size:13px;vertical-align:top}}
.it td:nth-child(odd){{background:#f8fafc;font-weight:700;width:28%}}
.sec-title{{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-bottom:1.5px solid #111827;padding-bottom:4px;margin:12px 0 6px}}
.mt th,.mt td{{border:1px solid #94a3b8;padding:5px;font-size:11px;vertical-align:top}}
.mt th{{background:#e2e8f0;text-align:left;font-size:10px;text-transform:uppercase;font-weight:800}}
.eng-box{{border:1.5px solid #94a3b8;padding:10px 12px;margin:14px 0}}
.eng-title{{font-size:11px;font-weight:800;text-transform:uppercase;margin-bottom:8px}}
.eng-text{{font-size:11px;line-height:1.6;margin-bottom:6px}}
.eng-checks{{display:flex;gap:10px;margin-top:8px;flex-wrap:wrap}}
.eng-check{{display:flex;align-items:center;gap:5px;font-size:10px}}
.eng-check-box{{width:12px;height:12px;border:1.5px solid #111827;display:inline-block;flex-shrink:0}}
.sig-row{{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}}
.sig-label{{font-size:11px;font-weight:700;border-bottom:1px solid #111827;padding-bottom:3px;margin-bottom:4px}}
.sig-sublabel{{font-size:10px;color:#64748b;margin-bottom:6px}}
.sig-area{{height:80px;border:1px solid #94a3b8}}
@media print{{@page{{size:A4 portrait;margin:10mm}}body{{padding:0}}.wrap{{max-width:none}}}}
@media(max-width:480px){{.doc-title{{font-size:14px}}.it td{{font-size:12px;padding:6px}}.sig-row{{grid-template-columns:1fr}}.eng-checks{{flex-direction:column;gap:6px}}}}
</style></head>
<body><div class="wrap">
<div class="doc-head">
  <div class="doc-brand">
    <img class="doc-logo" src="/static/sgdi-icon-192.png" alt="Logo"/>
    <div><div class="doc-title">FICHE DE DOTATION INDIVIDUELLE</div><div class="doc-sub">{societe} · Matériel &amp; Équipement</div></div>
  </div>
  {ref_box_html}
</div>
<table class="it">
  <tr><td>Nom et prénom</td><td><b>{nom} {prenom}</b></td><td>Code</td><td><b>{matricule}</b></td></tr>
  <tr><td>Société</td><td>{societe}</td><td>Date recrutement</td><td>{date_rec}</td></tr>
</table>
<div class="sec-title">Équipements dotés au personnel</div>
<table class="mt">
  <thead><tr><th>N°</th><th>Date</th><th>Désignation</th><th>État</th><th>Détail taille/pointure</th><th>Qté</th><th>N° bon</th></tr></thead>
  <tbody>{rows_html}</tbody>
</table>
<div class="eng-box">
  <div class="eng-title">Engagement du bénéficiaire</div>
  <p class="eng-text">Je soussigné(e), <b>{nom} {prenom}</b>, reconnais avoir reçu les équipements listés ci-dessus en bon état apparent et m'engage à les utiliser exclusivement dans le cadre professionnel.</p>
  <p class="eng-text">Je m'engage à préserver ce matériel, à le restituer sur demande de l'entreprise ou lors de mon départ, et à signaler immédiatement toute perte, vol, casse, détérioration ou anomalie. En cas de perte, vol, dégradation volontaire, négligence ou non-restitution, j'accepte que ma responsabilité soit engagée conformément au règlement intérieur et aux procédures applicables de l'entreprise.</p>
  <div class="eng-checks">
    <label class="eng-check"><span class="eng-check-box"></span>&nbsp;Matériel reçu en bon état</label>
    <label class="eng-check"><span class="eng-check-box"></span>&nbsp;Engagement lu et accepté</label>
    <label class="eng-check"><span class="eng-check-box"></span>&nbsp;Restitution obligatoire en fin de mission/contrat</label>
  </div>
</div>
<div class="sig-row">
  <div>
    <div class="sig-label">Signature du bénéficiaire</div>
    <div class="sig-sublabel">Nom, date et signature précédés de la mention "Lu et approuvé"</div>
    <div class="sig-area"></div>
  </div>
  <div>
    <div class="sig-label">Responsable matériel</div>
    <div class="sig-sublabel">Nom, date, cachet et signature</div>
    <div class="sig-area"></div>
  </div>
</div>
</div></body></html>"""
    return HTMLResponse(content, headers={"Cache-Control": "no-cache, max-age=0"})


def _events_signature() -> str:
    watched_tables = [
        "sgdi_records",
        "employees",
        "candidates",
        "contracts",
        "generated_contracts",
        "sites",
        "assignments",
        "daily_presence",
        "events",
        "stock_articles",
        "stock_movements",
        "stores",
        "suppliers",
        "employee_equipment",
        "material_assignments",
        "clients",
        "prospects",
        "invoices",
        "payments",
        "cash_entries",
    ]
    with SessionLocal() as db:
        parts: list[str] = []
        for table_name in watched_tables:
            try:
                row = db.execute(
                    text(f"SELECT COUNT(*) AS c, MAX(updated_at) AS u, MAX(created_at) AS r FROM {table_name}")
                ).mappings().one()
                parts.append(f"{table_name}:{row['c']}:{row['u'] or ''}:{row['r'] or ''}")
            except Exception:
                continue
        return "|".join(parts)


@app.get("/api/irongs/events/ticket", include_in_schema=False)
def irongs_events_ticket(authorization: str | None = Header(default=None)):
    """Échange le JWT normal contre un ticket SSE valable 60 secondes."""
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")
    if not token:
        raise HTTPException(status_code=401, detail="Authorization header requis")
    with SessionLocal() as db:
        try:
            payload = decode_token(token)
            user = get_user(db, int(payload["sub"]))
        except Exception:
            user = None
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="Token invalide")
    from app.core.security import create_access_token
    ticket = create_access_token(subject=str(user.id), claims={"sse_ticket": True}, ttl_minutes=1)
    return {"ticket": ticket}


@app.get("/api/irongs/events/stream", include_in_schema=False)
def irongs_events_stream(ticket: str | None = None, token: str | None = None):
    raw_token = ticket or token
    if not raw_token:
        raise HTTPException(status_code=401, detail="Ticket SSE requis")
    with SessionLocal() as db:
        try:
            payload = decode_token(raw_token)
            user = get_user(db, int(payload["sub"]))
        except Exception:
            user = None
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="Ticket invalide")

    async def stream():
        last = None
        while True:
            sig = _events_signature()
            if sig != last:
                last = sig
                yield "event: sgdi-change\n"
                yield "data: " + json.dumps({"signature": sig}) + "\n\n"
            else:
                yield ": keepalive\n\n"
            await asyncio.sleep(5)

    return StreamingResponse(stream(), media_type="text/event-stream")


def _file_hash(path: Path, length: int = 10) -> str:
    try:
        return hashlib.md5(path.read_bytes()).hexdigest()[:length]
    except Exception:
        return "0"


_INDEX_TEMPLATE: str | None = None
_INDEX_VERSIONS: dict[str, str] = {}


def _build_index_html() -> str:
    global _INDEX_TEMPLATE, _INDEX_VERSIONS
    content = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    versions = {
        "sgdi-app.js": _file_hash(STATIC_DIR / "sgdi-app.js"),
        "sgdi-app.css": _file_hash(STATIC_DIR / "sgdi-app.css"),
        "erp-frontend.js": _file_hash(STATIC_DIR / "erp-frontend.js"),
        "sgdi-inline-2.js": _file_hash(STATIC_DIR / "sgdi-inline-2.js"),
    }
    import re
    def replace_v(m: re.Match) -> str:
        filename = m.group(1)
        h = versions.get(filename)
        if h:
            return f'/static/{filename}?v={h}'
        return m.group(0)
    content = re.sub(r'/static/([\w\-]+\.(?:js|css))\?v=[^"\'>\s]+', replace_v, content)
    _INDEX_VERSIONS = versions
    return content


@app.get("/", include_in_schema=False)
def frontend(request: Request) -> HTMLResponse:
    host = request.headers.get("host", "").split(":")[0].lower()
    if host == "portail-rh.irongs.com":
        return FileResponse(
            STATIC_DIR / "portail-rh-bilingue.html",
            media_type="text/html; charset=utf-8",
            headers={"Cache-Control": "no-cache, max-age=0"},
        )
    content = _build_index_html()
    return HTMLResponse(content, headers={"Cache-Control": "no-cache, max-age=0"})


@app.get("/sw.js", include_in_schema=False)
def service_worker() -> FileResponse:
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache, max-age=0", "Service-Worker-Allowed": "/"})


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


app.include_router(api_router, prefix=settings.api_prefix)
