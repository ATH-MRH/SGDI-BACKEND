"""Moteur facial — interface + implémentation OpenCV (licences compatibles usage commercial).

Modèles (empreintes vérifiées au chargement ; un fichier différent est refusé) :
- détection  : YuNet face_detection_yunet_2023mar.onnx (MIT, OpenCV Zoo)
- gabarit    : SFace face_recognition_sface_2021dec.onnx (Apache-2.0, OpenCV Zoo), 128 dim.
- liveness   : MiniFASNetV2 2.7_80x80 (Apache-2.0, Minivision Silent-Face-Anti-Spoofing,
               export ONNX QingHeYang/Silent-Face-Anti-Spoofing-onnx) — classe 1 = visage réel.
Dépendances optionnelles (requirements-biometric.txt) : opencv-python-headless, numpy.
Sans elles ou sans modèles, le moteur est « indisponible » et aucune fonction biométrique
ne s'exécute (jamais de repli silencieux).
"""
from __future__ import annotations

import hashlib
import math
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

MODEL_FILES = {
    "detector": ("face_detection_yunet_2023mar.onnx", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    "recognizer": ("face_recognition_sface_2021dec.onnx", "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
    "liveness": ("2.7_80x80_MiniFASNetV2.onnx", "0cbe5caec95c31de9d2ef845cb85407d76aecd1b6a2c0e343f7d35306bfbccb8"),
}
ENGINE_ID = "opencv-yunet2023mar-sface2021dec-minifasnetv2"


class EngineUnavailable(RuntimeError):
    pass


@dataclass
class FaceObservation:
    bbox: tuple[int, int, int, int]
    detection_score: float
    face_px: int
    sharpness: float
    brightness: float
    embedding: list[float] = field(repr=False)
    liveness_real: float | None
    signature: list[float] = field(repr=False)   # vignette 16x16 normalisée (contrôle image figée)


@dataclass
class FrameAnalysis:
    width: int
    height: int
    faces: list[FaceObservation]


class FaceEngine(Protocol):
    engine_id: str

    def analyze(self, image: bytes) -> FrameAnalysis: ...


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class OpenCvFaceEngine:
    engine_id = ENGINE_ID

    def __init__(self, models_dir: str):
        try:
            import cv2  # noqa: F401
            import numpy  # noqa: F401
        except ImportError as exc:  # dépendances optionnelles absentes
            raise EngineUnavailable("opencv-python-headless / numpy non installés (requirements-biometric.txt)") from exc
        base = Path(models_dir)
        paths = {}
        for role, (name, expected) in MODEL_FILES.items():
            path = base / name
            if not path.is_file():
                raise EngineUnavailable(f"Modèle manquant : {name}")
            if _sha256(path) != expected:
                raise EngineUnavailable(f"Empreinte SHA-256 inattendue pour {name} — modèle refusé")
            paths[role] = path
        import cv2
        self._cv2 = cv2
        self._np = __import__("numpy")
        self._lock = threading.Lock()   # les objets OpenCV ne sont pas réentrants
        self._detector = cv2.FaceDetectorYN.create(str(paths["detector"]), "", (320, 320), 0.5, 0.3, 50)
        self._recognizer = cv2.FaceRecognizerSF.create(str(paths["recognizer"]), "")
        self._liveness = cv2.dnn.readNetFromONNX(str(paths["liveness"]))

    def _liveness_crop(self, img, bbox):
        # Recadrage ×2.7 centré, identique au projet d'origine (CropImage._get_new_box).
        cv2, np = self._cv2, self._np
        h, w = img.shape[:2]
        x, y, bw, bh = bbox
        scale = min((h - 1) / max(bh, 1), (w - 1) / max(bw, 1), 2.7)
        nw, nh = bw * scale, bh * scale
        cx, cy = x + bw / 2, y + bh / 2
        left, top, right, bottom = cx - nw / 2, cy - nh / 2, cx + nw / 2, cy + nh / 2
        if left < 0:
            right -= left; left = 0
        if top < 0:
            bottom -= top; top = 0
        if right > w - 1:
            left -= right - w + 1; right = w - 1
        if bottom > h - 1:
            top -= bottom - h + 1; bottom = h - 1
        crop = img[int(top):int(bottom) + 1, int(left):int(right) + 1]
        return cv2.resize(crop, (80, 80)).astype(np.float32).transpose(2, 0, 1)[None]

    def analyze(self, image: bytes) -> FrameAnalysis:
        cv2, np = self._cv2, self._np
        img = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Image illisible")
        h, w = img.shape[:2]
        factor = 1280 / max(h, w)
        if factor < 1:
            img = cv2.resize(img, (int(w * factor), int(h * factor)))
            h, w = img.shape[:2]
        faces_out: list[FaceObservation] = []
        with self._lock:
            self._detector.setInputSize((w, h))
            _, faces = self._detector.detect(img)
            for face in (faces if faces is not None else []):
                x, y, bw, bh = (int(round(v)) for v in face[:4])
                bbox = (max(0, x), max(0, y), max(1, bw), max(1, bh))
                region = img[bbox[1]:bbox[1] + bbox[3], bbox[0]:bbox[0] + bbox[2]]
                if region.size == 0:
                    continue
                gray = cv2.resize(cv2.cvtColor(region, cv2.COLOR_BGR2GRAY), (112, 112))
                sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                signature = (cv2.resize(gray, (16, 16)).astype(np.float32) / 255.0).flatten().tolist()
                aligned = self._recognizer.alignCrop(img, face)
                embedding = self._recognizer.feature(aligned).flatten().astype(float).tolist()
                self._liveness.setInput(self._liveness_crop(img, bbox))
                logits = self._liveness.forward()[0].astype(float)
                probs = np.exp(logits - logits.max()); probs = probs / probs.sum()
                faces_out.append(FaceObservation(
                    bbox=bbox, detection_score=float(face[-1]), face_px=min(bbox[2], bbox[3]),
                    sharpness=sharpness, brightness=float(gray.mean()), embedding=embedding,
                    liveness_real=float(probs[1]), signature=signature,
                ))
        return FrameAnalysis(width=w, height=h, faces=faces_out)


_engine: FaceEngine | None = None
_engine_error: str | None = None
_engine_lock = threading.Lock()


def get_engine() -> FaceEngine:
    """Moteur partagé (chargé une fois). Lève EngineUnavailable si non configurable."""
    global _engine, _engine_error
    from app.core.config import settings

    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is None:
            try:
                _engine = OpenCvFaceEngine(settings.biometric_models_dir)
                _engine_error = None
            except EngineUnavailable as exc:
                _engine_error = str(exc)
                raise
    return _engine


def set_engine(engine: FaceEngine | None) -> None:
    """Injection (tests, ou moteur alternatif validé)."""
    global _engine
    _engine = engine
