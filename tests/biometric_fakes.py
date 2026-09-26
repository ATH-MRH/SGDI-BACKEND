"""Moteur facial simulé et déterministe pour les tests métier (le vrai moteur OpenCV est testé
à part, sur de vraies images, dans test_biometrics_engine_real.py).

Une « image » est un JSON : {"faces": [{"who": "A", "score": 0.95, "px": 150, "sharp": 400,
"live": 0.99}], "noise": 3}. Le gabarit dépend de `who` (même personne ⇒ même vecteur,
légèrement bruité par `noise`), la vignette de `noise` (trames identiques ⇒ image figée)."""
import json
import math
import random

from app.modules.biometrics.engine import FaceObservation, FrameAnalysis


def frame(*faces, noise=None):
    return json.dumps({"faces": list(faces), "noise": random.random() if noise is None else noise}).encode()


def face(who, *, score=0.95, px=150, sharp=400.0, live=0.99, jitter=0.0):
    return {"who": who, "score": score, "px": px, "sharp": sharp, "live": live, "jitter": jitter}


def _vector(who: str, jitter: float, noise: float) -> list[float]:
    rng = random.Random(who)
    base = [rng.uniform(-1, 1) for _ in range(128)]
    if jitter:
        noise_rng = random.Random(f"{who}-{noise}")
        base = [v + noise_rng.uniform(-jitter, jitter) for v in base]
    norm = math.sqrt(sum(v * v for v in base))
    return [v / norm for v in base]


class FakeFaceEngine:
    engine_id = "fake-engine-test"

    def analyze(self, image: bytes) -> FrameAnalysis:
        data = json.loads(image)
        noise = data.get("noise", 0)
        faces = [FaceObservation(
            bbox=(10, 10, f["px"], f["px"]), detection_score=f["score"], face_px=f["px"], sharpness=f["sharp"],
            brightness=120.0, embedding=_vector(f["who"], f.get("jitter", 0.0), noise), liveness_real=f["live"],
            signature=[noise] * 256,
        ) for f in data["faces"]]
        return FrameAnalysis(width=640, height=480, faces=faces)
