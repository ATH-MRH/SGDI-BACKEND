"""Public candidate website, sharing the mobile application's existing APIs."""
import os
from pathlib import Path
from urllib.parse import urlsplit

from app.modules.drh.badge_design import qr_svg
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse, Response

router = APIRouter(include_in_schema=False)
STATIC = Path(__file__).resolve().parents[1] / "static"
WEB = STATIC / "emploi-app"
PUBLIC_ORIGIN = "https://emploi.irongs.com"
NO_CACHE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin"}


def is_employment_host(host: str) -> bool:
    return host.split(":", 1)[0].lower() in {"emploi.irongs.com", "www.emploi.irongs.com"}


def landing_page():
    return FileResponse(STATIC / "emploi.html", headers=NO_CACHE)


@router.get("/emploi")
def employment_landing():
    return landing_page()


@router.get("/emploi/config")
def employment_config():
    path = os.getenv("RECRUITMENT_ANDROID_APK_PATH", "").strip()
    local = bool(path and Path(path).is_file() and Path(path).suffix.lower() == ".apk")
    try:
        parsed = urlsplit(os.getenv("RECRUITMENT_ANDROID_APK_URL", "").strip())
        remote = bool(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password)
    except ValueError:
        remote = False
    return {"android_available": local or remote}


@router.get("/emploi/telecharger")
def download_android():
    # Keep the APK outside Git, in a persistent read-only mount configured by operations.
    path = os.getenv("RECRUITMENT_ANDROID_APK_PATH", "").strip()
    if path and Path(path).is_file() and Path(path).suffix.lower() == ".apk":
        return FileResponse(path, filename="IRON-Emploi.apk", media_type="application/vnd.android.package-archive", headers=NO_CACHE)
    url = os.getenv("RECRUITMENT_ANDROID_APK_URL", "").strip()
    try:
        parsed = urlsplit(url)
    except ValueError:
        raise HTTPException(503, "Le téléchargement Android est temporairement indisponible.")
    if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password:
        return RedirectResponse(url, status_code=307, headers=NO_CACHE)
    raise HTTPException(503, "Le téléchargement Android sera disponible prochainement. Vous pouvez déjà candidater depuis le site.")


@router.get("/emploi/qr.svg")
def employment_qr():
    return Response(qr_svg(PUBLIC_ORIGIN), media_type="image/svg+xml", headers={**NO_CACHE, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})


@router.get("/espace")
def employment_space_redirect():
    return RedirectResponse("/espace/", status_code=307)


@router.get("/espace/{route:path}")
def employment_space(route: str):
    root = WEB.resolve()
    path = (root / route).resolve()
    if not path.is_relative_to(root):
        raise HTTPException(404)
    if path.is_file():
        return FileResponse(path, headers=NO_CACHE)
    # Client-side routes must survive a browser refresh. Never return HTML for a missing asset.
    if Path(route).suffix or route.startswith(("assets/", "_expo/")):
        raise HTTPException(404)
    index = root / "index.html"
    if not index.is_file():
        raise HTTPException(503, "L’espace candidat est en cours de préparation. Réessayez dans quelques instants.")
    return FileResponse(index, headers=NO_CACHE)
