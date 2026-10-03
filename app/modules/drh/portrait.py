"""Portrait de présentation de la Fiche de position (DRH) — « photo d'identité ».

Deux objets distincts :

- la PHOTO SOURCE (fiche employé, /uploads/photos/…) : jamais modifiée ici ; c'est elle que
  voient la biométrie (LOT B), l'audit et le bouton « Aperçu » ;
- le PORTRAIT DE PRÉSENTATION, dérivé : visage agrandi et centré, tête entière, haut des
  épaules, fond BLANC réel (personne détourée), format 3:4. Il ne sert qu'à l'affichage DRH.

Traitement, une seule fois par photo (cache `employee_portraits`, lié à l'empreinte SHA-256 de
la photo source et recalculé quand elle change) :

  photo source → détection du visage (YuNet, OpenCV Zoo) → cadre portrait autour de la tête
  → segmentation de la personne (PP-HumanSeg, OpenCV Zoo, Apache-2.0) → alpha affiné sur
  les contours (filtre guidé) → composition sur #FFFFFF → JPEG 300×400.

Replis, sans jamais bloquer la fiche ni inventer un détourage : modèle de segmentation
indisponible ⇒ portrait recadré sur le visage, sans détourage (CROPPED) ; aucun visage
détecté ou OpenCV absent ⇒ cadrage centré haut (CENTERED). La méthode est renvoyée au
frontend (en-tête X-Portrait-Method) et journalisée, jamais l'image.
"""
from __future__ import annotations

import hashlib
import io
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.drh.models import Employee
from app.modules.drh.portrait_models import EmployeePortrait

logger = logging.getLogger("sgdi.drh.portrait")

OUT_W, OUT_H = 300, 400             # 3:4, affiché en 120×160 (net jusqu'à une densité de 2,5)
HEAD_FILL = 0.66                    # la tête occupe environ 2/3 de la hauteur du portrait
HEAD_FILL_MAX = 0.80                # resserrement maximal quand la photo s'arrête sous les épaules
TOP_MARGIN = 0.05                   # petite marge blanche au-dessus du crâne
JPEG_QUALITY = 90
DETECT_MAX_SIDE = 640               # YuNet est fiable sur une image ramenée à 640 px
# Tête estimée à partir de la boîte du visage YuNet (du haut du front au menton) : mêmes
# marges que le contrôle du cercle de capture (app/modules/biometrics/framing.py).
HEAD_TOP, HEAD_SIDE, HEAD_BOTTOM = 0.40, 0.12, 0.08

SEGMENTATION_MODEL = ("human_segmentation_pphumanseg_2023mar.onnx", "552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24")
SEG_SIZE = 192

METHOD_SEGMENTED = "SEGMENTED"      # visage + détourage : fond blanc réel
METHOD_CROPPED = "CROPPED"          # visage, sans détourage (modèle indisponible)
METHOD_CENTERED = "CENTERED"        # aucun visage détecté : cadrage centré haut


@dataclass
class Portrait:
    image: bytes
    method: str


# ── Modèles (chargés une fois, empreintes vérifiées) ──────────────────────────────────────
_lock = threading.Lock()
_models: dict[str, Any] = {}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_models() -> dict[str, Any]:
    """{"cv2", "detector", "segmenter"} — chaque élément peut manquer (repli)."""
    with _lock:
        if _models.get("_loaded"):
            return _models
        _models["_loaded"] = True
        try:
            import cv2
            import numpy  # noqa: F401
        except ImportError:
            logger.warning("Portrait DRH : OpenCV indisponible — cadrage centré sans détourage")
            return _models
        _models["cv2"] = cv2
        from app.modules.biometrics.engine import MODEL_FILES

        base = Path(settings.biometric_models_dir)
        name, expected = MODEL_FILES["detector"]
        if (base / name).is_file() and _sha256(base / name) == expected:
            _models["detector"] = cv2.FaceDetectorYN.create(str(base / name), "", (320, 320), 0.6, 0.3, 50)
        name, expected = SEGMENTATION_MODEL
        if (base / name).is_file() and _sha256(base / name) == expected:
            # Moteur « classique » d'OpenCV DNN : le nouveau moteur d'OpenCV 5 décale le masque
            # de ce modèle (mesuré) ; le classique reproduit la démo de référence de l'OpenCV Zoo.
            _models["segmenter"] = cv2.dnn.readNetFromONNX(str(base / name), engine=cv2.dnn.ENGINE_CLASSIC)
        if "segmenter" not in _models:
            logger.warning("Portrait DRH : modèle de segmentation absent ou refusé — portrait sans détourage")
        return _models


def reset_models() -> None:
    """Tests : rechargement des modèles (répertoire changé)."""
    with _lock:
        _models.clear()


# ── Rendu ─────────────────────────────────────────────────────────────────────────────────
def _guided(cv2, guide, src, radius: int, eps: float):
    box = lambda x: cv2.boxFilter(x, -1, (2 * radius + 1, 2 * radius + 1), normalize=True, borderType=cv2.BORDER_REFLECT)  # noqa: E731
    mean_i, mean_p = box(guide), box(src)
    a = (box(guide * src) - mean_i * mean_p) / (box(guide * guide) - mean_i * mean_i + eps)
    b = mean_p - a * mean_i
    return box(a) * guide + box(b)


def _portrait_box(face: tuple[float, float, float, float], image_h: float) -> tuple[float, float, float, float]:
    """Cadre 3:4 (gauche, haut, largeur, hauteur) centré sur la tête, petite marge au-dessus.
    Si la photo s'arrête avant le bas du cadre (photo carrée de la tablette, cadrage serré), le
    cadre est resserré jusqu'au bas de la photo (tête ≤ 80 % de la hauteur) : pas de bande
    blanche sous les épaules ; au-delà, le reste est blanc (rien n'est inventé)."""
    x, y, w, h = face
    head_x, head_y, head_w, head_h = x - HEAD_SIDE * w, y - HEAD_TOP * h, w * (1 + 2 * HEAD_SIDE), h * (1 + HEAD_TOP + HEAD_BOTTOM)
    height = head_h / HEAD_FILL
    if head_y - TOP_MARGIN * height + height > image_h:
        fitted = (image_h - head_y) / (1 - TOP_MARGIN)
        height = max(fitted, head_h / HEAD_FILL_MAX)
    width = height * OUT_W / OUT_H
    return head_x + head_w / 2 - width / 2, head_y - TOP_MARGIN * height, width, height


def render(source: bytes) -> Portrait:
    """Portrait de présentation à partir des OCTETS de la photo source (lus, jamais réécrits)."""
    models = _load_models()
    cv2 = models.get("cv2")
    if cv2 is None:
        return _centered_pil(source)
    import numpy as np

    bgr = cv2.imdecode(np.frombuffer(source, dtype=np.uint8), cv2.IMREAD_COLOR)    # orientation EXIF appliquée
    if bgr is None:
        raise ValueError("Photo illisible")
    h0, w0 = bgr.shape[:2]
    face = None
    if models.get("detector") is not None:
        k = min(1.0, DETECT_MAX_SIDE / max(h0, w0))
        small = cv2.resize(bgr, (max(1, round(w0 * k)), max(1, round(h0 * k))), interpolation=cv2.INTER_AREA) if k < 1 else bgr
        with _lock:
            models["detector"].setInputSize((small.shape[1], small.shape[0]))
            _, faces = models["detector"].detect(small)
        if faces is not None and len(faces):
            best = max(faces, key=lambda f: f[2] * f[3])
            face = tuple(float(v) / k for v in best[:4])
    if face is None:
        left, top, width, height = _centered_box(w0, h0)
        method = METHOD_CENTERED
    else:
        left, top, width, height = _portrait_box(face, h0)
        method = METHOD_SEGMENTED if models.get("segmenter") is not None else METHOD_CROPPED
    # Source → portrait (hors de l'image : blanc, rien n'est inventé).
    to_out = cv2.getAffineTransform(np.float32([[left, top], [left + width, top], [left, top + height]]),
                                    np.float32([[0, 0], [OUT_W, 0], [0, OUT_H]]))
    crop = cv2.warpAffine(bgr, to_out, (OUT_W, OUT_H), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    inside = cv2.warpAffine(np.ones((h0, w0), np.float32), to_out, (OUT_W, OUT_H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    if method == METHOD_SEGMENTED:
        # Segmentation sur un contexte CARRÉ plus large que le portrait (épaules visibles par le modèle).
        side, cx, cy = 1.5 * height, left + width / 2, top + height / 2
        to_ctx = cv2.getAffineTransform(np.float32([[cx - side / 2, cy - side / 2], [cx + side / 2, cy - side / 2], [cx - side / 2, cy + side / 2]]),
                                        np.float32([[0, 0], [SEG_SIZE, 0], [0, SEG_SIZE]]))
        ctx = cv2.warpAffine(bgr, to_ctx, (SEG_SIZE, SEG_SIZE), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
        blob = cv2.dnn.blobFromImage((cv2.cvtColor(ctx, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0 - 0.5) / 0.5)
        with _lock:
            models["segmenter"].setInput(blob)
            person = models["segmenter"].forward()[0, 1]              # probabilités « personne » (softmax incluse)
        ctx_to_out = np.vstack([to_out, [0, 0, 1]]) @ np.vstack([cv2.invertAffineTransform(to_ctx), [0, 0, 1]])
        mask = cv2.warpAffine(person.astype(np.float32), ctx_to_out[:2], (OUT_W, OUT_H), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        alpha = np.clip(_guided(cv2, gray, mask, 8, 1e-3), 0, 1)             # contours (cheveux, oreilles) suivis
        alpha = np.clip((alpha - 0.25) / 0.5, 0, 1) * inside
    else:
        alpha = inside
    white = np.full(crop.shape, 255.0, np.float32)
    out = crop.astype(np.float32) * alpha[..., None] + white * (1 - alpha[..., None])
    ok, encoded = cv2.imencode(".jpg", np.clip(out, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise ValueError("Encodage du portrait impossible")
    return Portrait(encoded.tobytes(), method)


def _centered_box(w0: int, h0: int) -> tuple[float, float, float, float]:
    """Sans visage : cadre 3:4 le plus grand possible, centré horizontalement, calé en haut."""
    width = min(w0, h0 * OUT_W / OUT_H)
    height = width * OUT_H / OUT_W
    return (w0 - width) / 2, 0.0, width, height


def _centered_pil(source: bytes) -> Portrait:
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(source)) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        left, top, width, height = _centered_box(*img.size)
        cropped = img.crop((round(left), round(top), round(left + width), round(top + height))).resize((OUT_W, OUT_H))
    out = io.BytesIO()
    cropped.save(out, format="JPEG", quality=JPEG_QUALITY)
    return Portrait(out.getvalue(), METHOD_CENTERED)


# ── Cache par employé ─────────────────────────────────────────────────────────────────────
_employee_locks: dict[int, threading.Lock] = {}


def portrait_for(db: Session, employee: Employee) -> Portrait | None:
    """Une génération à la fois par employé (dans ce processus) : deux affichages simultanés de
    la même fiche ne calculent pas deux fois le portrait."""
    with _lock:
        employee_lock = _employee_locks.setdefault(employee.id, threading.Lock())
    with employee_lock:
        db.expire_all()
        return _portrait_for(db, employee)


def _portrait_for(db: Session, employee: Employee) -> Portrait | None:
    """Portrait de la photo ACTUELLE de la fiche (None si aucune photo sur disque). Lecture de la
    photo seulement ; le cache est recalculé si l'empreinte de la photo a changé."""
    from app.modules.biometrics.service import _employee_photo_path

    path = _employee_photo_path(employee)
    if path is None:
        return None
    source = path.read_bytes()
    fingerprint = hashlib.sha256(source).hexdigest()
    row = db.execute(select(EmployeePortrait).where(EmployeePortrait.employee_id == employee.id)).scalar_one_or_none()
    if row is not None and row.source_sha256 == fingerprint:
        return Portrait(row.image, row.method)
    result = render(source)
    logger.info("Portrait DRH généré (employé %s, méthode %s)", employee.id, result.method)
    try:
        if row is None:
            with db.begin_nested():
                db.add(EmployeePortrait(employee_id=employee.id, source_sha256=fingerprint, method=result.method,
                                        image=result.image, width=OUT_W, height=OUT_H))
        else:
            row.source_sha256, row.method, row.image = fingerprint, result.method, result.image
        db.commit()
    except IntegrityError:
        db.rollback()                                   # calcul concurrent : le résultat reste valable
    return result
