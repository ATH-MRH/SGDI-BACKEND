"""Mode Test biométrique — reconnaissance SANS pointage (caméra du navigateur).

Deux circuits strictement séparés (docs/biometrics.md, § Mode Test) :
- PRODUCTION : caméra lue par le serveur → biométrie → Attendance Core → présence.
  Une image fournie par un navigateur n'y est JAMAIS acceptée (service.recognize_and_record).
- TEST (ce module) : image du navigateur → validation → biométrie → résultat. Rien d'autre.

Ce module est en LECTURE SEULE : il n'importe ni n'appelle aucune fonction d'écriture —
ni Attendance Core (record_scan, raise_anomaly), ni gabarits (deactivate_templates,
invalidate_if_photo_changed, enroll), ni configuration (active_config crée la v1 si absente).
Un test vérifie cette liste sur le code source, un autre compte chaque table avant/après.
Les images sont traitées en mémoire : jamais stockées, jamais journalisées.
"""
from __future__ import annotations

import base64
import binascii
import struct
import time
from datetime import date
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.biometrics import crypto
from app.modules.biometrics.engine import EngineUnavailable, FaceEngine, FrameAnalysis, cosine, get_engine
from app.modules.biometrics.models import TEMPLATE_ACTIVE, BiometricConfig, BiometricTemplate
from app.modules.biometrics.service import DEFAULT_CONFIG, analyze_frames, consent_admissible, photo_change_supervised, photo_fingerprint
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment

MAX_FRAMES = 6
MAX_FRAME_BYTES = 3_000_000
MAX_BODY_BYTES = MAX_FRAMES * (MAX_FRAME_BYTES * 4 // 3 + 64) + 4096     # base64 + JSON
MAX_SIDE = 4096
MAX_PIXELS = 4096 * 3072
FORMATS = ("jpeg", "png", "webp")

# Vocabulaire : celui du pointage facial existant (NO_FACE, MULTIPLE_FACES, QUALITY_FAILED,
# LIVENESS_FAILED, UNKNOWN_FACE, AMBIGUOUS, REVIEW_REQUIRED, REFUSED) + RECOGNIZED, propre au
# test (le pointage réel dit ATTENDANCE_RECORDED, ce qui serait faux ici).
STATES = ("RECOGNIZED", "UNKNOWN_FACE", "AMBIGUOUS", "REVIEW_REQUIRED", "REFUSED", "NO_FACE",
          "MULTIPLE_FACES", "QUALITY_FAILED", "LIVENESS_FAILED")
REFUSAL_REASONS = ("CONSENT_REQUIRED", "EMPLOYEE_INACTIVE")
UNAVAILABLE_CODES = ("TEST_MODE_DISABLED", "ENGINE_UNAVAILABLE", "INVALID_IMAGE", "IMAGE_TOO_LARGE", "RATE_LIMITED")
DISCLAIMER = ("Mode Test : aucun pointage n'est enregistré. Un résultat obtenu avec une caméra de navigateur "
              "ne valide ni la résistance aux photos, écrans ou vidéos, ni la calibration de la caméra de site.")


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message})


# ── Disponibilité ─────────────────────────────────────────────────────────────────────────
def availability() -> dict[str, Any]:
    """État du Mode Test, sans effet de bord (ne charge pas le moteur s'il est désactivé)."""
    engine_ok, engine_detail = False, ""
    if settings.biometric_test_mode_enabled:
        try:
            engine_detail, engine_ok = get_engine().engine_id, True
        except EngineUnavailable as exc:
            engine_detail = str(exc)
    return {"test_mode_enabled": settings.biometric_test_mode_enabled, "production_enabled": settings.biometric_enabled,
            "engine_available": engine_ok, "engine": engine_detail,
            "key_configured": bool((settings.biometric_template_key or "").strip())}


def ensure_test_mode() -> FaceEngine:
    """Indépendant de BIOMETRIC_ENABLED : le Mode Test fonctionne sans le pointage facial."""
    if not settings.biometric_test_mode_enabled:
        raise _error(503, "TEST_MODE_DISABLED", "Mode Test biométrique désactivé (BIOMETRIC_TEST_MODE_ENABLED=false)")
    if not (settings.biometric_template_key or "").strip():
        raise _error(503, "ENGINE_UNAVAILABLE", "Clé de chiffrement des gabarits non configurée (BIOMETRIC_TEMPLATE_KEY)")
    try:
        return get_engine()
    except EngineUnavailable as exc:
        raise _error(503, "ENGINE_UNAVAILABLE", f"Moteur biométrique indisponible : {exc}") from None


# ── Validation des images (avant tout décodage) ──────────────────────────────────────────
def _jpeg_size(raw: bytes) -> tuple[int, int] | None:
    i = 2
    while i + 9 < len(raw):
        if raw[i] != 0xFF:
            return None
        marker = raw[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        length = struct.unpack(">H", raw[i + 2:i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", raw[i + 5:i + 9])
            return width, height
        i += 2 + length
    return None


def _webp_size(raw: bytes) -> tuple[int, int] | None:
    chunk = raw[12:16]
    if chunk == b"VP8 " and len(raw) >= 30:
        w, h = struct.unpack("<HH", raw[26:30])
        return w & 0x3FFF, h & 0x3FFF
    if chunk == b"VP8L" and len(raw) >= 25:
        bits = int.from_bytes(raw[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8X" and len(raw) >= 30:
        return int.from_bytes(raw[24:27], "little") + 1, int.from_bytes(raw[27:30], "little") + 1
    return None


def sniff_image(raw: bytes) -> tuple[str, int, int]:
    """Format réel (signature du fichier, jamais le type déclaré) et dimensions lues dans
    l'en-tête : une image démesurée est refusée AVANT d'être décodée en mémoire."""
    size, kind = None, None
    if raw[:3] == b"\xff\xd8\xff":
        kind, size = "jpeg", _jpeg_size(raw)
    elif raw[:8] == b"\x89PNG\r\n\x1a\n" and raw[12:16] == b"IHDR":
        kind, size = "png", struct.unpack(">II", raw[16:24])
    elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        kind, size = "webp", _webp_size(raw)
    if kind is None:
        raise _error(422, "INVALID_IMAGE", "Format non accepté : JPEG, PNG ou WebP attendu")
    if not size or not all(size):
        raise _error(422, "INVALID_IMAGE", "Image corrompue : dimensions illisibles")
    width, height = size
    if max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
        raise _error(413, "IMAGE_TOO_LARGE", f"Image trop grande ({width}×{height}) — {MAX_SIDE} px de côté maximum")
    return kind, width, height


def decode_frames(values: Any) -> list[bytes]:
    if not isinstance(values, list) or not values:
        raise _error(422, "INVALID_IMAGE", "Au moins une image est requise")
    if len(values) > MAX_FRAMES:
        raise _error(422, "INVALID_IMAGE", f"{MAX_FRAMES} images maximum")
    out = []
    for value in values:
        if not isinstance(value, str) or not value:
            raise _error(422, "INVALID_IMAGE", "Image vide")
        declared = None
        if value.startswith("data:"):
            header, _, value = value.partition(",")
            declared = header[5:].split(";")[0].strip().lower()
        if len(value) > MAX_FRAME_BYTES * 4 // 3 + 8:
            raise _error(413, "IMAGE_TOO_LARGE", "Image trop volumineuse")
        try:
            raw = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError):
            raise _error(422, "INVALID_IMAGE", "Image invalide (base64)") from None
        if not raw:
            raise _error(422, "INVALID_IMAGE", "Image vide")
        if len(raw) > MAX_FRAME_BYTES:
            raise _error(413, "IMAGE_TOO_LARGE", "Image trop volumineuse")
        kind, _, _ = sniff_image(raw)
        if declared and declared not in (f"image/{kind}", "image/jpg" if kind == "jpeg" else ""):
            raise _error(422, "INVALID_IMAGE", "Type déclaré différent du contenu réel de l'image")
        out.append(raw)
    return out


# ── Lecture seule : configuration et candidats ───────────────────────────────────────────
def readonly_config(db: Session) -> Any:
    """Configuration active, SANS créer la version 1 si elle n'existe pas encore."""
    row = db.execute(select(BiometricConfig).order_by(BiometricConfig.version.desc()).limit(1)).scalar_one_or_none()
    return row if row is not None else SimpleNamespace(version=1, **DEFAULT_CONFIG)


def readonly_candidates(db: Session, site_id: int, today: date) -> list[tuple[Employee, BiometricTemplate]]:
    """Même périmètre 1:N que le pointage réel (gabarits ACTIFS des employés affectés au
    site), sans l'effet de bord : un gabarit dont la photo source a changé est ignoré, pas
    désactivé (ce sera fait par le circuit de production)."""
    employee_ids = set(db.execute(select(Assignment.employee_id).where(
        Assignment.site_id == site_id, Assignment.active == 1, Assignment.start_date <= today,
        (Assignment.end_date.is_(None)) | (Assignment.end_date >= today))).scalars())
    if not employee_ids:
        return []
    rows = db.execute(select(BiometricTemplate).where(BiometricTemplate.employee_id.in_(employee_ids),
                                                      BiometricTemplate.status == TEMPLATE_ACTIVE)).scalars().all()
    employees = {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_({r.employee_id for r in rows}))).scalars()} if rows else {}
    out = []
    for row in rows:
        employee = employees.get(row.employee_id)
        if employee is None:
            continue
        if row.source == "EMPLOYEE_PHOTO" and (row.quality or {}).get("photo_sha256") != photo_fingerprint(employee) \
                and not photo_change_supervised(db, employee):                    # même règle que le pointage réel
            continue
        out.append((employee, row))
    return out


class _TimedEngine:
    """Enveloppe de mesure : cumule les durées par phase du moteur et compte les images
    illisibles (le pipeline existant les ignore silencieusement)."""

    def __init__(self, inner: FaceEngine):
        self.inner, self.engine_id = inner, inner.engine_id
        self.timings: dict[str, float] = {}
        self.unreadable = 0

    def analyze(self, image: bytes) -> FrameAnalysis:
        start = time.perf_counter()
        try:
            result = self.inner.analyze(image)
        except ValueError:
            self.unreadable += 1
            raise
        finally:
            self.timings["analysis"] = self.timings.get("analysis", 0.0) + (time.perf_counter() - start) * 1000
        for phase, ms in (result.timings or {}).items():
            self.timings[phase] = self.timings.get(phase, 0.0) + ms
        return result


def _liveness(state: str, decision: Any, threshold: float) -> dict[str, Any]:
    if state in ("NO_FACE", "MULTIPLE_FACES", "QUALITY_FAILED"):
        result = "NOT_EVALUATED"
    elif state == "LIVENESS_FAILED":
        result = "INCONCLUSIVE" if decision.liveness is None else "FAIL"
    else:
        result = "PASS"
    score = decision.liveness
    return {"result": result, "score": round(score, 3) if score is not None else None, "threshold": threshold}


def _employee_out(employee: Employee, site_name: str | None) -> dict[str, Any]:
    return {"employee_id": employee.id, "matricule": employee.code, "nom": employee.last_name,
            "prenom": employee.first_name, "fonction": employee.position, "site": site_name}


# ── Pipeline ─────────────────────────────────────────────────────────────────────────────
def recognize(db: Session, *, engine: FaceEngine, site: Any, frames: list[bytes], today: date) -> dict[str, Any]:
    """IMAGE → DÉTECTION → NOMBRE DE VISAGES → QUALITÉ → LIVENESS → GABARIT → 1:N → SEUIL.
    Mêmes règles de décision que le pointage réel ; aucune écriture."""
    from app.modules.portal.routes import _employee_portal_block_reason

    cfg = readonly_config(db)
    timed = _TimedEngine(engine)
    decision = analyze_frames(timed, frames, cfg, require_liveness=True)
    if timed.unreadable == len(frames):
        raise _error(422, "INVALID_IMAGE", "Image illisible (fichier corrompu)")
    base: dict[str, Any] = {
        "mode": "TEST", "recorded": False, "site_id": site.id, "config_version": cfg.version,
        "engine": engine.engine_id, "frames": len(frames), "quality": decision.quality,
        "liveness": _liveness(decision.state, decision, cfg.liveness_threshold),
        "match": None, "employee": None, "reason_code": None, "disclaimer": DISCLAIMER,
        "timings_ms": {k: round(v, 1) for k, v in timed.timings.items()},
    }
    if decision.state != "OK":
        return {**base, "state": decision.state, "message": decision.reasons[0] if decision.reasons else "", "reasons": decision.reasons}
    start = time.perf_counter()
    candidates = readonly_candidates(db, site.id, today)
    scored = sorted(((cosine(decision.face.embedding, crypto.decrypt_vector(t.embedding_encrypted)), e)
                     for e, t in candidates), key=lambda x: x[0], reverse=True)
    base["timings_ms"]["matching"] = round((time.perf_counter() - start) * 1000, 1)
    top = scored[0][0] if scored else None
    second = scored[1][0] if len(scored) > 1 else None
    base["match"] = {"candidates": len(scored), "confidence": round(top, 4) if top is not None else None,
                     "threshold": cfg.recognition_threshold, "review_margin": cfg.review_margin}
    if top is None or top < cfg.recognition_threshold:
        return {**base, "state": "UNKNOWN_FACE", "message": "VISAGE INCONNU", "reasons": []}
    if second is not None and second >= cfg.recognition_threshold and top - second < cfg.review_margin:
        # Deux candidats proches : aucune identité n'est révélée.
        base["match"]["second_confidence"] = round(second, 4)
        return {**base, "state": "AMBIGUOUS", "message": "Reconnaissance ambiguë entre deux employés", "reasons": []}
    if top < cfg.recognition_threshold + cfg.review_margin:
        return {**base, "state": "REVIEW_REQUIRED", "message": "Reconnaissance incertaine — nouvel essai", "reasons": []}
    employee = scored[0][1]
    if not consent_admissible(db, employee.id):
        return {**base, "state": "REFUSED", "reason_code": "CONSENT_REQUIRED",
                "message": "Consentement biométrique non admissible pour cet employé", "reasons": []}
    blocked = _employee_portal_block_reason(employee)
    if blocked:
        return {**base, "state": "REFUSED", "reason_code": "EMPLOYEE_INACTIVE", "message": f"Employé non actif : {blocked}",
                "reasons": [], "employee": _employee_out(employee, site.name)}
    return {**base, "state": "RECOGNIZED", "message": "Employé reconnu (test — aucun pointage)", "reasons": [],
            "employee": _employee_out(employee, site.name)}
