"""Cadrage d'une photo prise par un terminal (LOT C1 — correctif « cercle de capture »).

Le terminal n'envoie plus l'image complète de sa caméra : il envoie le CARRÉ qui englobe le
cercle de capture affiché à l'écran (même géométrie pour le dessin du cercle, le contrôle et le
recadrage — voir `guideGeometry` dans pointeur-borne.js). Le cercle est donc le cercle inscrit
dans l'image reçue : centre au milieu du carré, rayon = moitié du côté.

Règle : la TÊTE ENTIÈRE doit être contenue dans une zone sûre intérieure au cercle. Le moteur
ne fournit qu'une boîte de VISAGE (YuNet : du haut du front au menton, oreilles à peine
incluses — mesuré sur de vrais portraits). La tête est donc estimée de façon conservatrice en
agrandissant cette boîte (cheveux, oreilles, menton), puis l'ellipse de la tête doit être
entièrement dans la zone sûre. Le centre seul ne suffit jamais.

Repère : coordonnées en pixels de l'image reçue (non miroir). L'écran du terminal est un
MIROIR : une tête trop à droite dans l'image apparaît trop à GAUCHE à l'écran ; les consignes
gauche/droite sont formulées pour ce que la personne voit.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

SAFE_RATIO = 0.90          # zone sûre : 90 % du rayon du cercle (bordure de 4 px + marge visuelle)
HEAD_TOP = 0.40            # cheveux / sommet du crâne au-dessus de la boîte du visage (× hauteur)
HEAD_SIDE = 0.12           # oreilles / côtés de la tête (× largeur, de chaque côté)
HEAD_BOTTOM = 0.08         # menton (× hauteur)
MIN_HEAD_FILL = 0.50       # tête plus petite que 50 % du diamètre sûr : trop loin
SQUARE_TOLERANCE = 2       # px : l'image reçue doit être le carré du cercle
ELLIPSE_POINTS = 32

INSTRUCTIONS = {
    "OK": "Position correcte — restez immobile",
    "NO_FACE": "Placez votre visage dans le cercle",
    "MULTIPLE_FACES": "Une seule personne devant la caméra",
    "TOO_FAR": "Approchez-vous",
    "TOO_CLOSE": "Reculez-vous",
    "TOO_LEFT": "Déplacez-vous légèrement vers la droite",
    "TOO_RIGHT": "Déplacez-vous légèrement vers la gauche",
    "TOO_HIGH": "Descendez légèrement",
    "TOO_LOW": "Montez légèrement",
    "BLURRED": "Restez immobile",
    "QUALITY_FAILED": "Regardez la caméra, face à la lumière",
    "NOT_CROPPED": "Restez immobile",
}


@dataclass(frozen=True)
class Framing:
    state: str

    @property
    def ok(self) -> bool:
        return self.state == "OK"

    @property
    def instruction(self) -> str:
        return INSTRUCTIONS[self.state]


def is_guide_crop(width: int, height: int) -> bool:
    return width > 0 and height > 0 and abs(width - height) <= SQUARE_TOLERANCE


def head_box(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    """Boîte de la tête estimée (x, y, largeur, hauteur) à partir de la boîte du visage."""
    x, y, w, h = bbox
    return (x - HEAD_SIDE * w, y - HEAD_TOP * h, w * (1 + 2 * HEAD_SIDE), h * (1 + HEAD_TOP + HEAD_BOTTOM))


def assess(bbox: tuple[float, float, float, float], width: int, height: int) -> Framing:
    """Position de la tête dans le cercle inscrit de l'image (width × height, carrée)."""
    side = min(width, height)
    cx, cy, radius = width / 2, height / 2, SAFE_RATIO * side / 2
    hx, hy, hw, hh = head_box(bbox)
    if hw > 2 * radius or hh > 2 * radius:
        return Framing("TOO_CLOSE")                       # la tête ne peut pas tenir dans la zone
    if hh < MIN_HEAD_FILL * 2 * radius:
        return Framing("TOO_FAR")
    ex, ey, ax, ay = hx + hw / 2, hy + hh / 2, hw / 2, hh / 2
    inside = all(math.hypot(ex + ax * math.cos(t) - cx, ey + ay * math.sin(t) - cy) <= radius
                 for t in (2 * math.pi * k / ELLIPSE_POINTS for k in range(ELLIPSE_POINTS)))
    if inside:
        return Framing("OK")
    dx, dy = ex - cx, ey - cy
    if abs(dy) >= abs(dx):
        return Framing("TOO_HIGH" if dy < 0 else "TOO_LOW")
    # Écran miroir : tête à droite dans l'image ⇒ à gauche pour la personne qui se regarde.
    return Framing("TOO_LEFT" if dx > 0 else "TOO_RIGHT")
