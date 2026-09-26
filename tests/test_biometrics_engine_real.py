"""Vrai moteur OpenCV (YuNet + SFace + MiniFASNetV2) et vrai adaptateur Dahua.

Moteur : exécuté seulement si opencv/numpy sont installés et si les variables pointent vers
les modèles (empreintes vérifiées) et des photos de test HORS dépôt :
    BIOMETRIC_MODELS_DIR=/chemin/modeles BIOMETRIC_TEST_FACES=/chemin/photos pytest ...
Photos attendues : obama1.jpg, obama2.jpg (même personne), biden1.jpg (autre personne) —
portraits officiels du domaine public (Wikimedia Commons).

Adaptateur Dahua : serveur HTTP local à authentification Digest (aucune dépendance externe).
"""
import hashlib
import io
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from app.modules.biometrics.cameras import CameraError, DahuaCameraAdapter

MODELS = os.getenv("BIOMETRIC_MODELS_DIR")
FACES = os.getenv("BIOMETRIC_TEST_FACES")


def _engine_or_skip():
    pytest.importorskip("cv2")
    if not MODELS or not FACES:
        pytest.skip("BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES non définis")
    from app.modules.biometrics.engine import OpenCvFaceEngine
    return OpenCvFaceEngine(MODELS)


def _photo(name):
    return (Path(FACES) / name).read_bytes()


def test_real_engine_same_person_matches_other_person_does_not():
    from app.modules.biometrics.engine import cosine
    from app.modules.biometrics.service import DEFAULT_CONFIG
    engine = _engine_or_skip()
    faces = {n: engine.analyze(_photo(n)).faces for n in ("obama1.jpg", "obama2.jpg", "biden1.jpg")}
    assert all(len(f) == 1 for f in faces.values())
    emb = {n: f[0].embedding for n, f in faces.items()}
    same = cosine(emb["obama1.jpg"], emb["obama2.jpg"])
    other = max(cosine(emb["obama1.jpg"], emb["biden1.jpg"]), cosine(emb["obama2.jpg"], emb["biden1.jpg"]))
    threshold = DEFAULT_CONFIG["recognition_threshold"]
    assert same >= threshold + DEFAULT_CONFIG["review_margin"], same
    assert other < threshold, other
    for f in faces.values():
        assert f[0].liveness_real is not None and f[0].sharpness > DEFAULT_CONFIG["quality_min_sharpness"]


def test_real_engine_flags_a_frozen_frame_and_a_blurred_face():
    from app.modules.biometrics.engine import set_engine
    from app.modules.biometrics.service import DEFAULT_CONFIG, analyze_frames
    engine = _engine_or_skip()
    cfg = SimpleNamespace(**DEFAULT_CONFIG)
    photo = _photo("obama1.jpg")
    frozen = analyze_frames(engine, [photo, photo, photo], cfg, require_liveness=True)
    assert frozen.state == "LIVENESS_FAILED" and "figée" in frozen.reasons[0]
    img = Image.open(io.BytesIO(photo)).convert("RGB")
    from PIL import ImageFilter
    buf = io.BytesIO(); img.filter(ImageFilter.GaussianBlur(12)).save(buf, "JPEG")
    blurred = analyze_frames(engine, [buf.getvalue()], cfg, require_liveness=False)
    assert blurred.state in ("QUALITY_FAILED", "NO_FACE")
    set_engine(None)


def test_tampered_model_is_refused(tmp_path):
    pytest.importorskip("cv2")
    if not MODELS:
        pytest.skip("BIOMETRIC_MODELS_DIR non défini")
    from app.modules.biometrics.engine import MODEL_FILES, EngineUnavailable, OpenCvFaceEngine
    for name, _ in MODEL_FILES.values():
        (tmp_path / name).write_bytes((Path(MODELS) / name).read_bytes())
    target = tmp_path / MODEL_FILES["liveness"][0]
    target.write_bytes(target.read_bytes() + b"\0")
    with pytest.raises(EngineUnavailable, match="Empreinte"):
        OpenCvFaceEngine(str(tmp_path))


# ── Adaptateur Dahua contre un vrai serveur HTTP Digest local ───────────────────────────
USER, PASSWORD, REALM, NONCE = "admin", "S3cr3t-Cam!", "Login to DAHUA", "abc123nonce"


def _jpeg():
    buf = io.BytesIO(); Image.new("RGB", (2592, 1944), (90, 120, 150)).save(buf, "JPEG"); return buf.getvalue()


class _DahuaHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        auth = self.headers.get("Authorization", "")
        if not self.path.startswith("/cgi-bin/snapshot.cgi?channel=1"):
            self.send_response(404); self.end_headers(); return
        if auth.startswith("Digest "):
            fields = dict(p.strip().split("=", 1) for p in auth[7:].split(","))
            fields = {k: v.strip('"') for k, v in fields.items()}
            ha1 = hashlib.md5(f"{USER}:{REALM}:{PASSWORD}".encode()).hexdigest()
            ha2 = hashlib.md5(f"GET:{fields.get('uri')}".encode()).hexdigest()
            expected = hashlib.md5(f"{ha1}:{NONCE}:{fields.get('nc')}:{fields.get('cnonce')}:{fields.get('qop')}:{ha2}".encode()).hexdigest()
            if fields.get("username") == USER and fields.get("response") == expected:
                body = _jpeg()
                self.send_response(200); self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        self.send_response(401)
        self.send_header("WWW-Authenticate", f'Digest realm="{REALM}", qop="auth", nonce="{NONCE}", opaque="x"')
        self.send_header("Content-Length", "0"); self.end_headers()


@pytest.fixture()
def dahua_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _DahuaHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    yield server.server_address[1]
    server.shutdown()


def _camera(port, password, monkeypatch):
    from cryptography.fernet import Fernet
    from app.core.config import settings
    from app.modules.biometrics import crypto
    monkeypatch.setattr(settings, "biometric_template_key", Fernet.generate_key().decode())
    return SimpleNamespace(host="127.0.0.1", http_port=port, rtsp_port=1, channel=1, profiles={},
                           credentials_encrypted=crypto.encrypt_secret({"username": USER, "password": password}))


def test_dahua_snapshot_with_digest_auth_and_test_report(dahua_server, monkeypatch):
    adapter = DahuaCameraAdapter(_camera(dahua_server, PASSWORD, monkeypatch))
    data = adapter.snapshot("CAPTURE_HIGH_QUALITY")
    assert Image.open(io.BytesIO(data)).size == (2592, 1944)   # 5 MP
    preview = adapter.snapshot("PREVIEW_LOW_BANDWIDTH")
    assert max(Image.open(io.BytesIO(preview)).size) == 640 and len(preview) < len(data)
    report = adapter.test()
    assert report["connection"]["ok"] and report["snapshot"]["ok"] and report["snapshot"]["resolution"] == "2592x1944"
    assert report["stream"]["ok"] is False                     # aucun serveur RTSP sur ce port
    assert PASSWORD not in repr(report)


def test_dahua_wrong_password_is_reported_without_leaking_secrets(dahua_server, monkeypatch):
    adapter = DahuaCameraAdapter(_camera(dahua_server, "mauvais-mot-de-passe", monkeypatch))
    with pytest.raises(CameraError) as exc:
        adapter.snapshot()
    assert "Authentification caméra refusée" in str(exc.value)
    assert "mauvais" not in str(exc.value) and USER not in str(exc.value)
