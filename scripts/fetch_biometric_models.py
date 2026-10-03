"""Télécharge les modèles biométriques et vérifie leur SHA-256 (build Docker).

Sources FIGÉES sur un commit de leurs dépôts d'origine (docs/biometrics.md §2) : le build
échoue au moindre écart d'empreinte. Aucun binaire n'est versionné dans Git ; le moteur
(app/modules/biometrics/engine.py, MODEL_FILES) revérifie ces mêmes empreintes au chargement.

Usage : python scripts/fetch_biometric_models.py <répertoire_cible>
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

ZOO = "https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models"
FAS = "https://raw.githubusercontent.com/QingHeYang/Silent-Face-Anti-Spoofing-onnx/584d4421d7ac42c59e640796f46e886b0095367a/onnx"
MODELS = {
    # YuNet — détection (MIT, OpenCV Zoo)
    "face_detection_yunet_2023mar.onnx": (
        f"{ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    # SFace — gabarit 128 dimensions (Apache-2.0, OpenCV Zoo)
    "face_recognition_sface_2021dec.onnx": (
        f"{ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
    # MiniFASNetV2 — liveness (Apache-2.0, Minivision, export ONNX)
    "2.7_80x80_MiniFASNetV2.onnx": (
        f"{FAS}/2.7_80x80_MiniFASNetV2.onnx",
        "0cbe5caec95c31de9d2ef845cb85407d76aecd1b6a2c0e343f7d35306bfbccb8"),
}

# Modèles NON biométriques, téléchargés au même endroit et de la même manière (commit figé,
# SHA-256 vérifié). PP-HumanSeg — segmentation de la personne (Apache-2.0, PaddleSeg, OpenCV
# Zoo) : sert UNIQUEMENT au portrait de présentation de la fiche DRH (fond blanc), jamais au
# moteur facial ni à une référence biométrique (app/modules/drh/portrait.py).
PORTRAIT_MODELS = {
    "human_segmentation_pphumanseg_2023mar.onnx": (
        f"{ZOO}/human_segmentation_pphumanseg/human_segmentation_pphumanseg_2023mar.onnx",
        "552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24"),
}


def main(target: str) -> None:
    out = Path(target)
    out.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in {**MODELS, **PORTRAIT_MODELS}.items():
        with urllib.request.urlopen(url, timeout=180) as response:
            data = response.read()
        digest = hashlib.sha256(data).hexdigest()
        if digest != expected:
            raise SystemExit(f"{name} : SHA-256 inattendu ({digest}) — modèle refusé")
        (out / name).write_bytes(data)
        print(f"{name} : {len(data)} octets, SHA-256 vérifié")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "models")
