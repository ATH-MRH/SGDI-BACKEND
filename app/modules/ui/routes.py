import platform
import subprocess

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.ui.service import build_sidebar_stats


router = APIRouter()


LOCAL_APP_ALLOWLIST = {
    "word": {"label": "Microsoft Word", "mac": ["Microsoft Word"], "windows": ["winword"]},
    "excel": {"label": "Microsoft Excel", "mac": ["Microsoft Excel"], "windows": ["excel"]},
    "agenda": {"label": "Agenda", "mac": ["Microsoft Outlook", "Calendar"], "windows": ["outlookcal:"]},
    "calculator": {"label": "Calculatrice", "mac": ["Calculator"], "windows": ["calc"]},
}


def _open_local_app(app_key: str) -> str:
    cfg = LOCAL_APP_ALLOWLIST.get(app_key)
    if not cfg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Raccourci inconnu")
    system = platform.system().lower()
    candidates = cfg.get("mac" if system == "darwin" else "windows" if system == "windows" else "linux", [])
    if not candidates:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Ouverture locale non supportée sur ce système")
    errors: list[str] = []
    for candidate in candidates:
        try:
            if system == "darwin":
                subprocess.run(["open", "-a", candidate], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=5)
            elif system == "windows":
                subprocess.Popen(["cmd", "/c", "start", "", candidate], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                subprocess.Popen([candidate], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return str(cfg["label"])
        except Exception as exc:
            errors.append(str(exc))
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Application introuvable ou impossible à ouvrir")


@router.get("/sidebar-stats")
def sidebar_stats(
    society: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return build_sidebar_stats(db, user, society)


@router.post("/open-app/{app_key}")
def open_app(app_key: str, user: User = Depends(current_user)):
    label = _open_local_app(app_key)
    return {"ok": True, "app": app_key, "label": label}
