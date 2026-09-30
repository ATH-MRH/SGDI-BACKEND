"""Garde : le script de build qui télécharge les modèles biométriques exige EXACTEMENT les
fichiers et empreintes SHA-256 que le moteur vérifie au chargement (engine.MODEL_FILES).
Un écart ferait construire une image dont le moteur refuserait ses propres modèles."""
import importlib.util
from pathlib import Path

from app.modules.biometrics.engine import MODEL_FILES

ROOT = Path(__file__).resolve().parents[1]


def _fetch_module():
    spec = importlib.util.spec_from_file_location("fetch_biometric_models", ROOT / "scripts" / "fetch_biometric_models.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_manifest_matches_engine_fingerprints():
    fetch = _fetch_module()
    assert {name: sha for name, (_url, sha) in fetch.MODELS.items()} == dict(MODEL_FILES.values())


def test_sources_are_pinned_to_commits():
    fetch = _fetch_module()
    for name, (url, _sha) in fetch.MODELS.items():
        assert url.startswith("https://"), name
        assert "/main/" not in url and "/master/" not in url, f"{name} : source non figée"


def test_image_installs_engine_and_models_without_secret():
    dockerfile = (ROOT / "Dockerfile").read_text()
    assert "requirements-biometric.txt" in dockerfile
    assert "fetch_biometric_models.py" in dockerfile and "/app/models/biometrics" in dockerfile
    assert "OpenCvFaceEngine('/app/models/biometrics')" in dockerfile       # moteur vérifié au build
    for forbidden in ("BIOMETRIC_TEMPLATE_KEY=", "BIOMETRIC_ENABLED=true", "BIOMETRIC_ENABLED=1"):
        assert forbidden not in dockerfile, forbidden
    pins = [line for line in (ROOT / "requirements-biometric.txt").read_text().splitlines() if line and not line.startswith("#")]
    assert pins and all("==" in line for line in pins), pins
