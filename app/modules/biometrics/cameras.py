"""Caméras — abstraction CameraAdapter (Attendance Core ne connaît jamais le fabricant).

Architecture réseau privilégiée : caméra sur le LAN du site, jamais exposée sur Internet ;
ATLAS (ou une passerelle du site : VPN, tunnel) l'atteint à l'adresse `host`. Les identifiants
sont déchiffrés ici, au dernier moment, et ne sortent jamais du backend (ni réponse API, ni
journal, ni audit). Voir docs/biometrics.md.

Profils conceptuels :
- CAPTURE_HIGH_QUALITY    : flux principal / instantané pleine résolution (enrôlement) ;
- RECOGNITION_REALTIME    : instantané pour la reconnaissance (réduit côté serveur à 1280 px) ;
- PREVIEW_LOW_BANDWIDTH   : aperçu terminal, sous-flux, réduit à 640 px.
"""
from __future__ import annotations

import io
import socket
import time
import urllib.error
import urllib.request
from typing import Any

from app.modules.biometrics import crypto
from app.modules.biometrics.models import Camera

PROFILES = ("CAPTURE_HIGH_QUALITY", "RECOGNITION_REALTIME", "PREVIEW_LOW_BANDWIDTH")
TIMEOUT = 5.0


class CameraError(RuntimeError):
    """Message sûr (jamais d'identifiant ni d'URL avec mot de passe)."""


def _image_size(data: bytes) -> tuple[int, int] | None:
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as img:
            return img.size
    except Exception:  # noqa: BLE001
        return None


def downscale_jpeg(data: bytes, max_side: int) -> bytes:
    from PIL import Image
    with Image.open(io.BytesIO(data)) as img:
        img = img.convert("RGB")
        img.thumbnail((max_side, max_side))
        out = io.BytesIO()
        img.save(out, "JPEG", quality=80)
        return out.getvalue()


def _rtsp_reachable(host: str, port: int, path: str) -> tuple[bool, str]:
    """Poignée de main RTSP OPTIONS : 200 ou 401 (authentification requise) prouvent que le
    serveur de flux répond, sans transmettre d'identifiant."""
    try:
        with socket.create_connection((host, port), timeout=TIMEOUT) as sock:
            sock.settimeout(TIMEOUT)
            sock.sendall(f"OPTIONS rtsp://{host}:{port}{path} RTSP/1.0\r\nCSeq: 1\r\n\r\n".encode())
            head = sock.recv(256).decode(errors="replace")
    except OSError as exc:
        return False, f"Flux injoignable ({exc.__class__.__name__})"
    if head.startswith("RTSP/1.0 200") or head.startswith("RTSP/1.0 401"):
        return True, "Serveur de flux joignable"
    return False, "Réponse RTSP inattendue"


class CameraAdapter:
    def __init__(self, camera: Camera):
        self.camera = camera

    def _credentials(self) -> tuple[str, str]:
        secret = crypto.decrypt_secret(self.camera.credentials_encrypted)
        return secret.get("username") or "", secret.get("password") or ""

    def snapshot(self, profile: str = "RECOGNITION_REALTIME") -> bytes:
        raise NotImplementedError

    def stream_path(self, profile: str) -> str:
        raise NotImplementedError

    def burst(self, count: int = 3, interval: float = 0.25) -> list[bytes]:
        frames = []
        for i in range(count):
            frames.append(self.snapshot("RECOGNITION_REALTIME"))
            if i + 1 < count:
                time.sleep(interval)
        return frames

    def test(self) -> dict[str, Any]:
        cam = self.camera
        result: dict[str, Any] = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        port = cam.http_port or 80
        started = time.monotonic()
        try:
            with socket.create_connection((cam.host, port), timeout=TIMEOUT):
                pass
            result["connection"] = {"ok": True, "latency_ms": round((time.monotonic() - started) * 1000)}
        except OSError as exc:
            result["connection"] = {"ok": False, "error": f"Connexion impossible ({exc.__class__.__name__})"}
        started = time.monotonic()
        try:
            data = self.snapshot("CAPTURE_HIGH_QUALITY")
            size = _image_size(data)
            result["snapshot"] = {"ok": size is not None, "latency_ms": round((time.monotonic() - started) * 1000),
                                  **({"resolution": f"{size[0]}x{size[1]}"} if size else {"error": "Image illisible"})}
        except CameraError as exc:
            result["snapshot"] = {"ok": False, "error": str(exc)}
        ok, message = _rtsp_reachable(cam.host, cam.rtsp_port or 554, self.stream_path("RECOGNITION_REALTIME"))
        result["stream"] = {"ok": ok, "message": message}
        return result


class DahuaCameraAdapter(CameraAdapter):
    """API HTTP Dahua : instantané /cgi-bin/snapshot.cgi (authentification Digest) ; flux RTSP
    /cam/realmonitor?channel=N&subtype=0 (principal) ou 1 (sous-flux)."""

    def snapshot(self, profile: str = "RECOGNITION_REALTIME") -> bytes:
        cam = self.camera
        url = f"http://{cam.host}:{cam.http_port or 80}/cgi-bin/snapshot.cgi?channel={cam.channel or 1}"
        username, password = self._credentials()
        manager = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        manager.add_password(None, url, username, password)
        opener = urllib.request.build_opener(urllib.request.HTTPDigestAuthHandler(manager),
                                             urllib.request.HTTPBasicAuthHandler(manager))
        try:
            with opener.open(url, timeout=TIMEOUT) as response:
                data = response.read(15_000_000)
        except urllib.error.HTTPError as exc:
            raise CameraError("Authentification caméra refusée" if exc.code == 401 else f"Instantané refusé (HTTP {exc.code})") from None
        except (urllib.error.URLError, OSError) as exc:
            raise CameraError(f"Caméra injoignable ({exc.__class__.__name__})") from None
        if not data.startswith(b"\xff\xd8"):
            raise CameraError("Réponse caméra non JPEG")
        if profile == "PREVIEW_LOW_BANDWIDTH":
            return downscale_jpeg(data, 640)
        return data

    def stream_path(self, profile: str) -> str:
        subtype = 0 if profile == "CAPTURE_HIGH_QUALITY" else 1
        return f"/cam/realmonitor?channel={self.camera.channel or 1}&subtype={subtype}"


class GenericRtspCameraAdapter(CameraAdapter):
    """Caméra RTSP générique : chemin de flux par profil dans Camera.profiles
    ({"RECOGNITION_REALTIME": {"path": "/stream1"}, ...}). Instantané = une trame du flux
    (OpenCV requis, installé avec requirements-biometric.txt)."""

    def stream_path(self, profile: str) -> str:
        profiles = self.camera.profiles or {}
        entry = profiles.get(profile) or profiles.get("RECOGNITION_REALTIME") or {}
        return str(entry.get("path") or "/")

    def snapshot(self, profile: str = "RECOGNITION_REALTIME") -> bytes:
        # L'URL RTSP contient les identifiants : journaux OpenCV/FFmpeg rendus silencieux AVANT
        # l'ouverture (un message d'erreur de connexion les recopierait sinon dans les logs).
        import os
        os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
        os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "-8")
        try:
            import cv2
        except ImportError:
            raise CameraError("Lecture RTSP indisponible (OpenCV non installé)") from None
        if hasattr(cv2, "setLogLevel"):
            cv2.setLogLevel(0)
        username, password = self._credentials()
        cam = self.camera
        auth = f"{urllib.request.quote(username)}:{urllib.request.quote(password)}@" if username else ""
        capture = cv2.VideoCapture(f"rtsp://{auth}{cam.host}:{cam.rtsp_port or 554}{self.stream_path(profile)}")
        try:
            ok, frame = capture.read()
        finally:
            capture.release()
        if not ok or frame is None:
            raise CameraError("Aucune trame reçue du flux")
        ok, encoded = cv2.imencode(".jpg", frame)
        if not ok:
            raise CameraError("Encodage de la trame impossible")
        data = encoded.tobytes()
        return downscale_jpeg(data, 640) if profile == "PREVIEW_LOW_BANDWIDTH" else data


class TerminalCameraAdapter(CameraAdapter):
    """Caméra intégrée au terminal (tablette/borne) : les images sont envoyées par le terminal
    authentifié ; le serveur ne se connecte jamais à un navigateur."""

    def snapshot(self, profile: str = "RECOGNITION_REALTIME") -> bytes:
        raise CameraError("Caméra du terminal : les images doivent être envoyées par le terminal")

    def stream_path(self, profile: str) -> str:
        return ""

    def test(self) -> dict[str, Any]:
        return {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "connection": {"ok": True, "message": "Caméra locale du terminal (testée côté terminal)"}}


ADAPTERS = {"DAHUA": DahuaCameraAdapter, "GENERIC_RTSP": GenericRtspCameraAdapter, "TERMINAL": TerminalCameraAdapter}


def adapter_for(camera: Camera) -> CameraAdapter:
    cls = ADAPTERS.get(camera.adapter)
    if cls is None:
        raise CameraError(f"Adaptateur inconnu : {camera.adapter}")
    return cls(camera)
